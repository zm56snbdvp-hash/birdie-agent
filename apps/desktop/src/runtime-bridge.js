import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export class RuntimeBridge {
  constructor({ onSnapshot, onPresence, onStatus }) {
    this.onSnapshot = onSnapshot;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.lastRevision = -1;
    this.unlisten = [];
  }

  async connect() {
    this.onStatus?.('CONNECTING');

    const stopPresence = await listen('runtime.presence.changed', ({ payload }) => {
      const snapshot = payload?.snapshot ?? payload;
      this.#applyPresence(snapshot);
    });
    const stopSnapshot = await listen('runtime.snapshot', ({ payload }) => {
      this.#applySnapshot(payload);
    });
    const stopDisconnected = await listen('runtime.disconnected', () => {
      this.onStatus?.('OFFLINE');
    });
    const stopReconnected = await listen('runtime.reconnected', async () => {
      this.lastRevision = -1;
      await this.requestSnapshot();
    });

    this.unlisten.push(stopPresence, stopSnapshot, stopDisconnected, stopReconnected);
    await this.requestSnapshot();
    this.onStatus?.('READY');
  }

  async requestSnapshot() {
    const snapshot = await invoke('runtime_get_snapshot', { lastRevision: this.lastRevision });
    this.#applySnapshot(snapshot);
    return snapshot;
  }

  async setMicrophoneEnabled(enabled) {
    return invoke('runtime_set_microphone_enabled', { enabled });
  }

  dispose() {
    for (const stop of this.unlisten.splice(0)) stop();
  }

  #applySnapshot(snapshot) {
    if (!snapshot) return;
    const presence = snapshot.presence ?? snapshot;
    const revision = Number(presence.revision ?? snapshot.revision ?? -1);
    if (revision <= this.lastRevision) return;
    this.lastRevision = revision;
    this.onSnapshot?.(snapshot);
    this.onPresence?.(presence);
  }

  #applyPresence(presence) {
    if (!presence) return;
    const revision = Number(presence.revision ?? -1);
    if (revision <= this.lastRevision) return;
    this.lastRevision = revision;
    this.onPresence?.(presence);
  }
}
