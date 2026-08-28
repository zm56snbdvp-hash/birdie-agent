import {
  DesktopCommandStatus,
} from '../../../packages/protocol/src/contract.mjs';
import { desktopCommandFingerprint } from '../../../packages/protocol/src/desktop-command.mjs';

const TERMINAL = new Set([
  DesktopCommandStatus.ACKNOWLEDGED,
  DesktopCommandStatus.REJECTED,
  DesktopCommandStatus.FAILED,
  DesktopCommandStatus.TIMEOUT,
]);

export class DesktopCommandLedger {
  constructor({ maximumEntries = 512, now = () => Date.now() } = {}) {
    this.maximumEntries = maximumEntries;
    this.now = now;
    this.entries = new Map();
  }

  register(command, context = {}) {
    const fingerprint = desktopCommandFingerprint(command);
    const existing = this.entries.get(command.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Object.freeze({ kind: 'CONFLICT', entry: this.#copy(existing) });
      return Object.freeze({ kind: 'REPLAY', entry: this.#copy(existing) });
    }
    this.#prune(Math.max(0, this.maximumEntries - 1));
    if (this.entries.size >= this.maximumEntries) {
      return Object.freeze({ kind: 'CAPACITY', entry: null });
    }
    const timestamp = this.now();
    const entry = {
      command,
      fingerprint,
      status: DesktopCommandStatus.SENT,
      errorCode: null,
      requesterConnectionId: context.requesterConnectionId ?? null,
      requestId: context.requestId ?? null,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
    };
    this.entries.set(command.commandId, entry);
    return Object.freeze({ kind: 'NEW', entry: this.#copy(entry) });
  }

  retarget(commandId, command) {
    const entry = this.entries.get(commandId);
    if (!entry || TERMINAL.has(entry.status)) return null;
    entry.command = command;
    entry.updatedAtMs = this.now();
    return this.#copy(entry);
  }

  complete(commandId, status, errorCode = null) {
    const entry = this.entries.get(commandId);
    if (!entry || TERMINAL.has(entry.status)) return null;
    if (!TERMINAL.has(status)) throw new Error(`DESKTOP.COMMAND.STATUS_INVALID:${status}`);
    entry.status = status;
    entry.errorCode = errorCode;
    entry.updatedAtMs = this.now();
    return this.#copy(entry);
  }

  timeout(commandId) {
    return this.complete(commandId, DesktopCommandStatus.TIMEOUT, 'DESKTOP.COMMAND.TIMEOUT');
  }

  get(commandId) {
    const entry = this.entries.get(commandId);
    return entry ? this.#copy(entry) : null;
  }

  pending() {
    return [...this.entries.values()]
      .filter((entry) => !TERMINAL.has(entry.status))
      .map((entry) => this.#copy(entry));
  }

  isTerminal(commandId) {
    const entry = this.entries.get(commandId);
    return Boolean(entry && TERMINAL.has(entry.status));
  }

  #copy(entry) {
    return Object.freeze({ ...entry, command: entry.command });
  }

  #prune(targetSize = this.maximumEntries) {
    if (this.entries.size <= targetSize) return;
    for (const [commandId, entry] of this.entries) {
      if (!TERMINAL.has(entry.status)) continue;
      this.entries.delete(commandId);
      if (this.entries.size <= targetSize) return;
    }
  }
}
