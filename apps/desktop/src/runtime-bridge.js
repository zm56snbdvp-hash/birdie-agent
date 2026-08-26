import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export class RuntimeBridge {
  constructor({
    onSnapshot,
    onPresence,
    onStatus,
    onComponent,
    onAudioInput,
    onAudioOutput,
  }) {
    this.onSnapshot = onSnapshot;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.onComponent = onComponent;
    this.onAudioInput = onAudioInput;
    this.onAudioOutput = onAudioOutput;
    this.lastRevision = -1;
    this.unlisten = [];
    this.refreshTimer = null;
    this.refreshInFlight = false;
  }

  async connect() {
    this.onStatus?.('CONNECTING');

    const stopPresence = await listen(
      'runtime.presence.changed',
      ({ payload }) => {
        const snapshot = payload?.snapshot ?? payload;
        this.#applyPresence(snapshot);
      },
    );
    const stopSnapshot = await listen('runtime.snapshot', ({ payload }) => {
      this.#applySnapshot(payload);
    });
    const stopDisconnected = await listen('runtime.disconnected', () => {
      this.onStatus?.('OFFLINE');
    });
    const stopConnected = await listen('runtime.connected', async () => {
      this.onStatus?.('CONNECTING');
      this.lastRevision = -1;
      await this.#refreshSnapshotSafely();
    });
    const stopSupervisor = await listen(
      'supervisor.component.changed',
      ({ payload }) => this.onComponent?.(payload),
    );
    const stopAudioInput = await listen(
      'runtime.audio.input',
      ({ payload }) => this.onAudioInput?.(this.#normalizeAudio(payload)),
    );
    const stopAudioOutput = await listen(
      'runtime.audio.output',
      ({ payload }) => this.onAudioOutput?.(this.#normalizeAudio(payload)),
    );

    this.unlisten.push(
      stopPresence,
      stopSnapshot,
      stopDisconnected,
      stopConnected,
      stopSupervisor,
      stopAudioInput,
      stopAudioOutput,
    );

    await this.#refreshSnapshotSafely();
    this.refreshTimer = window.setInterval(() => {
      void this.#refreshSnapshotSafely();
    }, 750);
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
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const stop of this.unlisten.splice(0)) stop();
  }

  async #refreshSnapshotSafely() {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      await this.requestSnapshot();
    } catch {
      this.onStatus?.('OFFLINE');
    } finally {
      this.refreshInFlight = false;
    }
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

  #normalizeAudio(payload) {
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    return {
      level: clamp(payload?.level),
      vadProbability: clamp(payload?.vadProbability),
      monotonicMs: Number(payload?.monotonicMs) || 0,
    };
  }
}
