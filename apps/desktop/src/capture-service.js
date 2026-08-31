export const MAX_CAPTURE_TEXT_LENGTH = 4_000;

function timestamp(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeCaptureEntry(value) {
  const id = String(value?.id ?? '').trim();
  const text = String(value?.text ?? '');
  const createdAt = timestamp(value?.createdAt);
  if (!id || !text || createdAt === null) return null;
  return Object.freeze({ id, text, createdAt });
}

export function normalizeCaptureList(value) {
  const entries = Array.isArray(value) ? value : value?.entries;
  if (!Array.isArray(entries)) return Object.freeze([]);
  return Object.freeze(entries.map(normalizeCaptureEntry).filter(Boolean).sort((left, right) => right.createdAt - left.createdAt));
}

export class CaptureService {
  constructor(nativeBridge) {
    this.nativeBridge = nativeBridge;
    this.entries = Object.freeze([]);
    this.listeners = new Set();
    this.operationTail = Promise.resolve();
  }
  getEntries() { return this.entries; }
  subscribe(listener) { this.listeners.add(listener); listener(this.entries); return () => this.listeners.delete(listener); }
  load() {
    return this.#enqueue(async () => {
      this.entries = normalizeCaptureList(await this.nativeBridge.listCaptures());
      this.#notify();
      return this.entries;
    });
  }
  add(text) {
    return this.#enqueue(async () => {
      const normalizedText = String(text ?? '').trim();
      if (!normalizedText) throw new Error('CAPTURE.TEXT_REQUIRED');
      if (normalizedText.length > MAX_CAPTURE_TEXT_LENGTH) throw new Error('CAPTURE.TEXT_TOO_LONG');
      const result = await this.nativeBridge.addCapture(normalizedText);
      const entry = normalizeCaptureEntry(result?.entry ?? result);
      if (!entry) this.entries = normalizeCaptureList(await this.nativeBridge.listCaptures());
      else this.entries = normalizeCaptureList([entry, ...this.entries]);
      this.#notify();
      return entry;
    });
  }
  delete(id) {
    return this.#enqueue(async () => {
      const normalizedId = String(id ?? '').trim();
      if (!normalizedId) throw new Error('CAPTURE.ID_REQUIRED');
      await this.nativeBridge.deleteCapture(normalizedId);
      this.entries = Object.freeze(this.entries.filter((entry) => entry.id !== normalizedId));
      this.#notify();
      return this.entries;
    });
  }
  #enqueue(operation) { const pending = this.operationTail.then(operation, operation); this.operationTail = pending.catch(() => {}); return pending; }
  #notify() { for (const listener of this.listeners) listener(this.entries); }
}
