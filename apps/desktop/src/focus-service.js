export const FOCUS_STATUS = Object.freeze({ IDLE: 'IDLE', RUNNING: 'RUNNING', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED' });
export const FOCUS_SCHEMA_VERSION = 1;
export const MAX_FOCUS_TASK_LENGTH = 1_000;
export const MAX_FOCUS_DURATION_MS = 24 * 60 * 60 * 1_000;

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function nullableInteger(value) { return value === null || value === undefined ? null : integer(value, null); }

function knownStatus(value) {
  const candidate = String(value ?? '').toUpperCase();
  return Object.hasOwn(FOCUS_STATUS, candidate) ? candidate : FOCUS_STATUS.IDLE;
}

export function emptyFocusState(nowMs = Date.now()) {
  return Object.freeze({
    schemaVersion: FOCUS_SCHEMA_VERSION,
    task: '',
    durationMs: 0,
    remainingMs: 0,
    status: FOCUS_STATUS.IDLE,
    startedAtMs: null,
    deadlineAtMs: null,
    updatedAtMs: integer(nowMs),
  });
}

export function normalizeFocusState(value, nowMs = Date.now()) {
  const now = integer(nowMs);
  if (!value || Number(value.schemaVersion ?? FOCUS_SCHEMA_VERSION) !== FOCUS_SCHEMA_VERSION) return emptyFocusState(now);
  const task = String(value.task ?? '').slice(0, MAX_FOCUS_TASK_LENGTH);
  const durationMs = Math.min(integer(value.durationMs), MAX_FOCUS_DURATION_MS);
  let remainingMs = Math.min(integer(value.remainingMs), durationMs);
  let focusStatus = knownStatus(value.status);
  const startedAtMs = nullableInteger(value.startedAtMs);
  let deadlineAtMs = nullableInteger(value.deadlineAtMs);
  if (focusStatus === FOCUS_STATUS.RUNNING) {
    if (deadlineAtMs === null || durationMs === 0) {
      focusStatus = FOCUS_STATUS.IDLE;
      remainingMs = 0;
      deadlineAtMs = null;
    } else {
      remainingMs = Math.max(0, deadlineAtMs - now);
      if (remainingMs === 0) {
        focusStatus = FOCUS_STATUS.COMPLETED;
        deadlineAtMs = null;
      }
    }
  } else if (focusStatus === FOCUS_STATUS.COMPLETED) {
    remainingMs = 0;
    deadlineAtMs = null;
  } else if (focusStatus === FOCUS_STATUS.IDLE) {
    deadlineAtMs = null;
  } else {
    deadlineAtMs = null;
  }
  return Object.freeze({
    schemaVersion: FOCUS_SCHEMA_VERSION,
    task,
    durationMs,
    remainingMs,
    status: focusStatus,
    startedAtMs,
    deadlineAtMs,
    updatedAtMs: integer(value.updatedAtMs, now),
  });
}

export function projectFocusState(state, nowMs = Date.now()) {
  if (state.status !== FOCUS_STATUS.RUNNING || state.deadlineAtMs === null) return state;
  const remainingMs = Math.max(0, state.deadlineAtMs - integer(nowMs));
  return Object.freeze({
    ...state,
    remainingMs,
    ...(remainingMs === 0 ? { status: FOCUS_STATUS.COMPLETED, deadlineAtMs: null } : {}),
  });
}

export class FocusService {
  constructor(nativeBridge, { now = () => Date.now() } = {}) {
    this.nativeBridge = nativeBridge;
    this.now = now;
    this.state = emptyFocusState(this.now());
    this.listeners = new Set();
    this.transitionTail = Promise.resolve();
  }

  getState() { return projectFocusState(this.state, this.now()); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }

  load() {
    return this.#enqueue(async () => {
      const persisted = await this.nativeBridge.getFocusState();
      const raw = persisted?.state ?? persisted;
      const wasRunning = String(raw?.status ?? '').toUpperCase() === FOCUS_STATUS.RUNNING;
      this.state = normalizeFocusState(raw, this.now());
      if (wasRunning && this.state.status === FOCUS_STATUS.COMPLETED) await this.#persist(this.state);
      else this.#notify();
      return this.getState();
    });
  }

  start({ task, durationMs }) {
    return this.#enqueue(async () => {
      const normalizedTask = String(task ?? '').trim();
      const normalizedDuration = integer(durationMs);
      if (!normalizedTask) throw new Error('FOCUS.TASK_REQUIRED');
      if (normalizedTask.length > MAX_FOCUS_TASK_LENGTH) throw new Error('FOCUS.TASK_TOO_LONG');
      if (normalizedDuration <= 0 || normalizedDuration > MAX_FOCUS_DURATION_MS) throw new Error('FOCUS.DURATION_INVALID');
      const now = integer(this.now());
      return this.#persist({
        schemaVersion: FOCUS_SCHEMA_VERSION,
        task: normalizedTask,
        durationMs: normalizedDuration,
        remainingMs: normalizedDuration,
        status: FOCUS_STATUS.RUNNING,
        startedAtMs: now,
        deadlineAtMs: now + normalizedDuration,
        updatedAtMs: now,
      });
    });
  }

  pause() {
    return this.#enqueue(async () => {
      if (this.state.status !== FOCUS_STATUS.RUNNING) return this.getState();
      const now = integer(this.now());
      const remainingMs = Math.max(0, (this.state.deadlineAtMs ?? now) - now);
      return this.#persist({ ...this.state, remainingMs, status: remainingMs === 0 ? FOCUS_STATUS.COMPLETED : FOCUS_STATUS.PAUSED, deadlineAtMs: null, updatedAtMs: now });
    });
  }

  resume() {
    return this.#enqueue(async () => {
      if (this.state.status !== FOCUS_STATUS.PAUSED) return this.getState();
      const now = integer(this.now());
      return this.#persist({ ...this.state, status: FOCUS_STATUS.RUNNING, deadlineAtMs: now + this.state.remainingMs, updatedAtMs: now });
    });
  }

  complete() {
    return this.#enqueue(async () => {
      if (this.state.status !== FOCUS_STATUS.RUNNING && this.state.status !== FOCUS_STATUS.PAUSED) return this.getState();
      const now = integer(this.now());
      return this.#persist({ ...this.state, remainingMs: 0, status: FOCUS_STATUS.COMPLETED, deadlineAtMs: null, updatedAtMs: now });
    });
  }

  reset() { return this.#enqueue(() => this.#persist(emptyFocusState(this.now()))); }

  tick() {
    return this.#enqueue(async () => {
      if (this.state.status !== FOCUS_STATUS.RUNNING) return this.getState();
      const projected = this.getState();
      if (projected.remainingMs > 0) { this.#notify(); return projected; }
      return this.#persist({ ...this.state, remainingMs: 0, status: FOCUS_STATUS.COMPLETED, deadlineAtMs: null, updatedAtMs: integer(this.now()) });
    });
  }

  #enqueue(operation) { const pending = this.transitionTail.then(operation, operation); this.transitionTail = pending.catch(() => {}); return pending; }
  async #persist(next) {
    const normalized = normalizeFocusState(next, this.now());
    const saved = await this.nativeBridge.saveFocusState(normalized);
    this.state = normalizeFocusState(saved?.state ?? saved ?? normalized, this.now());
    this.#notify();
    return this.getState();
  }
  #notify() { const projected = this.getState(); for (const listener of this.listeners) listener(projected); }
}
