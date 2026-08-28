export const COMMAND_STATUS = Object.freeze({ SENT: 'SENT', ACKNOWLEDGED: 'ACKNOWLEDGED', REJECTED: 'REJECTED', FAILED: 'FAILED', TIMEOUT: 'TIMEOUT' });
const TERMINAL = new Set([COMMAND_STATUS.ACKNOWLEDGED, COMMAND_STATUS.REJECTED, COMMAND_STATUS.FAILED, COMMAND_STATUS.TIMEOUT]);

export function normalizeCommandStatus(value) {
  const candidate = String(value ?? '').trim().toUpperCase();
  if (candidate === 'ACK' || candidate === 'ACCEPTED' || candidate === 'SUCCESS') return COMMAND_STATUS.ACKNOWLEDGED;
  if (candidate === 'ERROR') return COMMAND_STATUS.FAILED;
  return Object.hasOwn(COMMAND_STATUS, candidate) ? candidate : null;
}

function defaultIdFactory() {
  return globalThis.crypto?.randomUUID?.() ?? `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeErrorCode(error) {
  const text = String(error?.message ?? error ?? '');
  const match = text.match(/[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+/);
  return match?.[0] ?? 'DESKTOP.COMMAND.SUBMIT_FAILED';
}

export class CommandCenterModel {
  constructor(nativeBridge, { now = () => Date.now(), idFactory = defaultIdFactory, timeoutMs = 8_000, setTimeoutFn = globalThis.setTimeout?.bind(globalThis), clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis), historyLimit = 24 } = {}) {
    this.nativeBridge = nativeBridge;
    this.now = now;
    this.idFactory = idFactory;
    this.timeoutMs = timeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.historyLimit = historyLimit;
    this.entries = [];
    this.listeners = new Set();
    this.timers = new Map();
  }
  getEntries() { return Object.freeze(this.entries.map((entry) => Object.freeze({ ...entry }))); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getEntries()); return () => this.listeners.delete(listener); }
  async submit(text) {
    const normalizedText = String(text ?? '').trim();
    if (!normalizedText) throw new Error('DESKTOP.COMMAND.TEXT_REQUIRED');
    const issuedAtMs = Number(this.now());
    const commandId = String(this.idFactory());
    const entry = { commandId, text: normalizedText, status: COMMAND_STATUS.SENT, errorCode: null, issuedAtMs, expiresAtMs: issuedAtMs + this.timeoutMs, updatedAtMs: issuedAtMs };
    this.entries.unshift(entry);
    this.#trimHistory();
    this.#scheduleTimeout(commandId);
    this.#notify();
    try {
      const result = await this.nativeBridge.submitDesktopIntent({ commandId, text: normalizedText, issuedAtMs: entry.issuedAtMs, expiresAtMs: entry.expiresAtMs });
      if (result?.status) this.applyStatus(result);
    } catch (error) {
      this.applyStatus({ commandId, status: COMMAND_STATUS.FAILED, errorCode: safeErrorCode(error) });
    }
    return this.entries.find((candidate) => candidate.commandId === commandId) ?? null;
  }
  applyStatus(payload = {}) {
    const commandId = String(payload.commandId ?? '');
    const nextStatus = normalizeCommandStatus(payload.status);
    if (!commandId || !nextStatus) return false;
    const entry = this.entries.find((candidate) => candidate.commandId === commandId);
    if (!entry || TERMINAL.has(entry.status)) return false;
    entry.status = nextStatus;
    entry.errorCode = payload.errorCode ? String(payload.errorCode) : null;
    entry.updatedAtMs = Number(this.now());
    if (TERMINAL.has(nextStatus)) this.#clearTimer(commandId);
    this.#notify();
    return true;
  }
  dispose() { for (const commandId of this.timers.keys()) this.#clearTimer(commandId); this.listeners.clear(); }
  #scheduleTimeout(commandId) {
    if (typeof this.setTimeoutFn !== 'function') return;
    const timer = this.setTimeoutFn(() => { this.timers.delete(commandId); this.applyStatus({ commandId, status: COMMAND_STATUS.TIMEOUT }); }, this.timeoutMs);
    this.timers.set(commandId, timer);
  }
  #clearTimer(commandId) {
    const timer = this.timers.get(commandId);
    if (timer !== undefined && typeof this.clearTimeoutFn === 'function') this.clearTimeoutFn(timer);
    this.timers.delete(commandId);
  }
  #trimHistory() { const removed = this.entries.splice(this.historyLimit); for (const entry of removed) this.#clearTimer(entry.commandId); }
  #notify() { const entries = this.getEntries(); for (const listener of this.listeners) listener(entries); }
}
