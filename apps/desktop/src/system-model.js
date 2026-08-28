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

export function projectSystemState(state, nowMs, staleAfterMs) {
  const lastCoreMessageAt = epochMs(state.lastCoreMessageAt);
  const disconnected = new Set(['OFFLINE', 'DISCONNECTED', 'DEGRADED']);
  const stale = disconnected.has(state.ipcState)
    ? true
    : lastCoreMessageAt === null ? null : nowMs - lastCoreMessageAt > staleAfterMs;
  return Object.freeze({ ...state, lastCoreMessageAt, stale });
}

export class SystemModel {
  constructor(nativeBridge, { now = () => Date.now(), staleAfterMs = 3_000 } = {}) {
    this.nativeBridge = nativeBridge;
    this.now = now;
    this.staleAfterMs = staleAfterMs;
    this.listeners = new Set();
    this.state = {
      coreStatus: UNKNOWN,
      voiceStatus: UNKNOWN,
      microphoneState: UNAVAILABLE,
      presenceState: UNKNOWN,
      brainState: UNAVAILABLE,
      ipcState: UNKNOWN,
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
    this.#merge({
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
      microphoneState: status(snapshot.microphoneState, this.state.microphoneState),
      presenceState: status(presenceFrom(snapshot), this.state.presenceState),
      brainState: status(snapshot.brainState, this.state.brainState),
    });
  }

  updateRuntimeStatus(runtimeStatus) {
    const normalized = status(runtimeStatus);
    if (normalized === 'CONNECTING') this.#merge({ ipcState: 'CONNECTING' });
    else if (normalized === 'OFFLINE') this.#merge({ ipcState: 'OFFLINE', connectionId: null });
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
