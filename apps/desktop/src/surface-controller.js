import { normalizeModuleId } from './module-registry.js';

export const INTERACTION_MODES = Object.freeze({ AMBIENT: 'AMBIENT', CONTROL: 'CONTROL' });

const DEFAULT_STATE = Object.freeze({
  mode: INTERACTION_MODES.AMBIENT,
  activeModule: null,
  revision: -1,
  globalShortcutStatus: 'UNKNOWN',
});

function normalizeRevision(value, fallback = -1) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : fallback;
}

export function normalizeSurfaceState(value, fallback = DEFAULT_STATE) {
  const mode = String(value?.mode ?? '').toUpperCase();
  const normalizedMode = Object.hasOwn(INTERACTION_MODES, mode) ? mode : fallback.mode;
  const activeModule = normalizedMode === INTERACTION_MODES.CONTROL
    ? normalizeModuleId(value?.activeModule)
    : null;
  return Object.freeze({
    mode: normalizedMode,
    activeModule,
    revision: normalizeRevision(value?.revision, fallback.revision),
    globalShortcutStatus: String(value?.globalShortcutStatus ?? fallback.globalShortcutStatus ?? 'UNKNOWN').toUpperCase(),
  });
}

function fingerprint(state) {
  return `${state.mode}:${state.activeModule ?? '-'}:${state.revision}:${state.globalShortcutStatus}`;
}

export class SurfaceController {
  constructor(nativeBridge) {
    this.nativeBridge = nativeBridge;
    this.state = DEFAULT_STATE;
    this.listeners = new Set();
    this.transitionTail = Promise.resolve();
  }

  getState() { return this.state; }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  applyNativeState(payload) {
    const mode = String(payload?.mode ?? '').toUpperCase();
    const revision = Number(payload?.revision);
    if (
      !Object.hasOwn(INTERACTION_MODES, mode) ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      (mode === INTERACTION_MODES.CONTROL &&
        payload?.activeModule !== null &&
        payload?.activeModule !== undefined &&
        !normalizeModuleId(payload.activeModule))
    ) {
      return false;
    }
    const next = normalizeSurfaceState(payload, this.state);
    if (next.revision < this.state.revision) return false;
    if (fingerprint(next) === fingerprint(this.state)) return false;
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
    return true;
  }

  initialize() {
    return this.#enqueue(async () => {
      const state = await this.nativeBridge.getSurfaceState();
      this.applyNativeState(state);
      return this.state;
    });
  }

  openModule(moduleId) {
    const normalized = normalizeModuleId(moduleId);
    if (!normalized) return Promise.reject(new Error(`DESKTOP.MODULE.UNKNOWN:${moduleId}`));
    return this.#enqueue(async () => {
      if (this.state.mode === INTERACTION_MODES.CONTROL && this.state.activeModule === normalized) return this.state;
      return this.#confirmNativeTransition(() => this.nativeBridge.openModule(normalized));
    });
  }

  setInteractionMode(enabled) {
    const requestedMode = enabled ? INTERACTION_MODES.CONTROL : INTERACTION_MODES.AMBIENT;
    return this.#enqueue(async () => {
      if (this.state.mode === requestedMode && (requestedMode === INTERACTION_MODES.CONTROL || this.state.activeModule === null)) return this.state;
      return this.#confirmNativeTransition(() => this.nativeBridge.setInteractionMode(Boolean(enabled)));
    });
  }

  escape() {
    return this.#enqueue(async () => {
      if (this.state.mode !== INTERACTION_MODES.CONTROL) return this.state;
      return this.#confirmNativeTransition(() => this.nativeBridge.setInteractionMode(false));
    });
  }

  #enqueue(operation) {
    const pending = this.transitionTail.then(operation, operation);
    this.transitionTail = pending.catch(() => {});
    return pending;
  }

  async #confirmNativeTransition(invoke) {
    const result = await invoke();
    if (!this.applyNativeState(result)) {
      const confirmed = await this.nativeBridge.getSurfaceState();
      this.applyNativeState(confirmed);
    }
    return this.state;
  }
}
