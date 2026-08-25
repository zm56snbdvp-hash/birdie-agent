import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export class RuntimeBridge {
  constructor({ onSnapshot, onPresence, onStatus, onComponent }) {
    this.onSnapshot = onSnapshot;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.onComponent = onComponent;
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
    const stopConnected = await listen('runtime.connected', async () => {
      this.onStatus?.('CONNECTING');
      this.lastRevision = -1;
      try {
        await this.requestSnapshot();
      } catch {
        this.onStatus?.('OFFLINE');
      }
    });
    const stopSupervisor = await listen('supervisor.component.changed', ({ payload }) => {
      this.onComponent?.(payload);
    });

    this.unlisten.push(
      stopPresence,
      stopSnapshot,
      stopDisconnected,
      stopConnected,
      stopSupervisor,
    );
    await this.requestSnapshot();
  }

  async requestSnapshot() {
    const snapshot = await invoke('runtime_get_snapshot', {
      lastRevision: this.lastRevision,
    });
    this.#applySnapshot(snapshot);
    return snapshot;
  }

  async setMicrophoneEnabled(enabled) {
    await invoke('runtime_set_microphone_enabled', { enabled });
  }

  dispose() {
    for (const stop of this.unlisten.splice(0)) stop();
  }

  #applySnapshot(snapshot) {
    if (!snapshot) return;
    const presence = snapshot.presence ?? snapshot;
    const revision = Number(presence.revision ?? snapshot.revision ?? -1);

    // Orthogonal state such as microphone/privacy may change without a new
    // Presence revision. Deliver the snapshot, but never replay old motion.
    this.onSnapshot?.(snapshot);
    this.onStatus?.(this.#statusFromSnapshot(snapshot, presence));

    if (revision > this.lastRevision) {
      this.lastRevision = revision;
      this.onPresence?.(presence);
    }
  }

  #applyPresence(presence) {
    if (!presence) return;
    const revision = Number(presence.revision ?? -1);
    if (revision <= this.lastRevision) return;
    this.lastRevision = revision;
    this.onPresence?.(presence);
  }

  #statusFromSnapshot(snapshot, presence) {
    const lifecycle = String(snapshot?.lifecycle ?? '').toUpperCase();
    if (lifecycle === 'STARTING') return 'CONNECTING';
    if (lifecycle !== 'READY' || presence?.state === 'OFFLINE') return 'OFFLINE';
    return 'READY';
  }
}
