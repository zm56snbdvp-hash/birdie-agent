import {
  FreshnessState,
  RuntimeLifecycle,
  TransportState,
  projectRuntimeUiState,
} from './runtime-state-contract.js';

const UNKNOWN = 'UNKNOWN';
const UNAVAILABLE = 'UNAVAILABLE';

function status(value, fallback = UNKNOWN) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || fallback;
}

function epochMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function presenceFrom(snapshot) { return snapshot?.presenceState ?? snapshot?.presence?.state; }

function transportFrom(ipcState) {
  const normalized = status(ipcState);
  if (normalized === 'CONNECTED') return TransportState.CONNECTED;
  if (normalized === 'CONNECTING') return TransportState.CONNECTING;
  if (['OFFLINE', 'DISCONNECTED', 'DEGRADED'].includes(normalized)) {
    return TransportState.DISCONNECTED;
  }
  return TransportState.UNKNOWN;
}

export function projectSystemState(state, nowMs, staleAfterMs) {
  const lastCoreMessageAt = epochMs(state.lastCoreMessageAt);
  const transportState = transportFrom(state.ipcState);
  const freshnessState = transportState === TransportState.DISCONNECTED
    ? FreshnessState.STALE
    : lastCoreMessageAt === null
      ? FreshnessState.UNKNOWN
      : nowMs - lastCoreMessageAt > staleAfterMs
        ? FreshnessState.STALE
        : FreshnessState.FRESH;
  const ui = projectRuntimeUiState({
    lifecycle: state.runtimeLifecycle,
    transportState,
    freshnessState,
    presenceState: state.presenceState,
  });
  return Object.freeze({
    ...state,
    lastCoreMessageAt,
    transportState,
    freshnessState,
    uiState: ui.status,
    uiReason: ui.reason,
    stale: freshnessState === FreshnessState.STALE,
  });
}

export class SystemModel {
  constructor(nativeBridge, { now = () => Date.now(), staleAfterMs = 3_000 } = {}) {
    this.nativeBridge = nativeBridge;
    this.now = now;
    this.staleAfterMs = staleAfterMs;
    this.listeners = new Set();
    this.state = {
      runtimeLifecycle: RuntimeLifecycle.STARTING,
      coreStatus: UNKNOWN,
      voiceStatus: UNKNOWN,
      microphoneState: UNAVAILABLE,
      presenceState: UNKNOWN,
      brainState: UNAVAILABLE,
      ipcState: TransportState.CONNECTING,
      connectionId: null,
      lastCoreMessageAt: null,
      mode: 'AMBIENT',
      activeModule: null,
      globalShortcutStatus: UNKNOWN,
    };
  }

  getState() { return projectSystemState(this.state, this.now(), this.staleAfterMs); }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    const snapshot = await this.nativeBridge.getSystemSnapshot();
    this.updateNativeSnapshot(snapshot);
    return this.getState();
  }

  updateNativeSnapshot(snapshot = {}) {
    const hasConnectionId = Object.hasOwn(snapshot, 'connectionId');
    const hasLastCoreMessageAt = Object.hasOwn(snapshot, 'lastCoreMessageAt');
    const inferredLifecycle = snapshot.runtimeLifecycle
      ?? snapshot.lifecycle
      ?? (status(snapshot.coreStatus) === 'READY' ? RuntimeLifecycle.READY : null);
    this.#merge({
      runtimeLifecycle: status(inferredLifecycle, this.state.runtimeLifecycle),
      coreStatus: status(snapshot.coreStatus, this.state.coreStatus),
      voiceStatus: status(snapshot.voiceStatus, this.state.voiceStatus),
      microphoneState: status(snapshot.microphoneState, this.state.microphoneState),
      presenceState: status(presenceFrom(snapshot), this.state.presenceState),
      brainState: status(snapshot.brainState, this.state.brainState),
      ipcState: status(snapshot.ipcState, this.state.ipcState),
      connectionId: hasConnectionId
        ? snapshot.connectionId === null ? null : String(snapshot.connectionId)
        : this.state.connectionId,
      lastCoreMessageAt: hasLastCoreMessageAt
        ? epochMs(snapshot.lastCoreMessageAt)
        : this.state.lastCoreMessageAt,
      mode: status(snapshot.mode, this.state.mode),
      activeModule: Object.hasOwn(snapshot, 'activeModule')
        ? snapshot.activeModule ?? null
        : this.state.activeModule,
      globalShortcutStatus: status(snapshot.globalShortcutStatus, this.state.globalShortcutStatus),
    });
  }

  updateRuntimeSnapshot(snapshot = {}) {
    this.#merge({
      runtimeLifecycle: status(snapshot.lifecycle, this.state.runtimeLifecycle),
      microphoneState: status(snapshot.microphoneState, this.state.microphoneState),
      presenceState: status(presenceFrom(snapshot), this.state.presenceState),
      brainState: status(snapshot.brainState, this.state.brainState),
    });
  }

  updateRuntimeStatus(runtimeStatus) {
    const normalized = status(runtimeStatus);
    if (normalized === 'CONNECTING') this.#merge({ ipcState: 'CONNECTING' });
    else if (normalized === 'OFFLINE') {
      this.#merge({
        runtimeLifecycle: RuntimeLifecycle.DEGRADED,
        ipcState: 'OFFLINE',
        connectionId: null,
      });
    } else if (normalized === 'READY') {
      this.#merge({
        runtimeLifecycle: RuntimeLifecycle.READY,
        ipcState: 'CONNECTED',
      });
    }
  }

  updateComponent(component = {}) {
    const name = String(component.component ?? '').toLowerCase();
    if (name === 'birdie-core') this.#merge({ coreStatus: status(component.status) });
    else if (name === 'birdie-voice') this.#merge({ voiceStatus: status(component.status) });
  }

  updateSurface(surface = {}) {
    this.#merge({
      mode: status(surface.mode, this.state.mode),
      activeModule: surface.activeModule ?? null,
      globalShortcutStatus: status(surface.globalShortcutStatus, this.state.globalShortcutStatus),
    });
  }

  notifyClockChanged() { this.#notify(); }

  #merge(update) { this.state = { ...this.state, ...update }; this.#notify(); }
  #notify() { const projected = this.getState(); for (const listener of this.listeners) listener(projected); }
}

export { UNKNOWN, UNAVAILABLE };
