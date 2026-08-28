import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export const TAURI_EVENTS = Object.freeze({
  PRESENCE_CHANGED: 'runtime:presence-changed',
  SNAPSHOT: 'runtime:snapshot',
  DISCONNECTED: 'runtime:disconnected',
  CONNECTED: 'runtime:connected',
  COMPONENT_CHANGED: 'supervisor:component-changed',
  AUDIO_INPUT: 'runtime:audio-input',
  AUDIO_OUTPUT: 'runtime:audio-output',
  IPC_ERROR: 'runtime:ipc-error',
  SURFACE_CHANGED: 'desktop:surface-changed',
  COMMAND_STATUS: 'desktop:command-status',
});

export const TAURI_EVENT_NAME_PATTERN = /^[A-Za-z0-9\-/:_]+$/;
const KNOWN_PRESENCE_STATES = new Set([
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'WORKING',
  'SUCCESS',
  'ERROR',
  'OFFLINE',
]);

export function formatDiagnosticError(error) {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function evaluateSnapshotStatus(snapshot) {
  const lifecycle = String(snapshot?.lifecycle ?? '').toUpperCase();
  const presenceState = String(snapshot?.presence?.state ?? '').toUpperCase();
  if (lifecycle === 'STARTING') {
    return { status: 'CONNECTING', reason: 'lifecycle=STARTING' };
  }
  if (lifecycle !== 'READY') {
    return { status: 'OFFLINE', reason: `lifecycle=${lifecycle || 'MISSING'}` };
  }
  if (presenceState === 'OFFLINE') {
    return { status: 'OFFLINE', reason: 'presence.state=OFFLINE' };
  }
  if (!KNOWN_PRESENCE_STATES.has(presenceState)) {
    return {
      status: 'OFFLINE',
      reason: `presence.state=${presenceState || 'MISSING'}`,
    };
  }
  return {
    status: 'READY',
    reason: `lifecycle=READY presence.state=${presenceState}`,
  };
}

export function summarizeSnapshot(snapshot) {
  return [
    `bridgeRevision=${snapshot?.bridgeRevision ?? 'missing'}`,
    `lifecycle=${snapshot?.lifecycle ?? 'missing'}`,
    `presence.state=${snapshot?.presence?.state ?? 'missing'}`,
    `presence.revision=${snapshot?.presence?.revision ?? 'missing'}`,
    `microphoneState=${snapshot?.microphoneState ?? 'missing'}`,
    `brainState=${snapshot?.brainState ?? 'missing'}`,
  ].join(' ');
}

function numericRevision(value) {
  if (value === null || value === undefined || value === '') return null;
  const revision = Number(value);
  return Number.isFinite(revision) ? revision : null;
}

function presenceFingerprint(presence, bridgeRevision) {
  return JSON.stringify({
    bridgeRevision,
    revision: presence?.revision ?? null,
    state: presence?.state ?? null,
    reason: presence?.reason ?? null,
  });
}

export class RuntimeBridge {
  constructor(
    {
      onSnapshot,
      onPresence,
      onStatus,
      onComponent,
      onAudioInput,
      onAudioOutput,
      onDiagnostic,
      onError,
      onSurface,
      onCommandStatus,
    },
    {
      invokeFn = tauriInvoke,
      listenFn = tauriListen,
      setIntervalFn = globalThis.setInterval?.bind(globalThis),
      clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
      persistDiagnostics = true,
    } = {},
  ) {
    this.onSnapshot = onSnapshot;
    this.onPresence = onPresence;
    this.onStatus = onStatus;
    this.onComponent = onComponent;
    this.onAudioInput = onAudioInput;
    this.onAudioOutput = onAudioOutput;
    this.onDiagnostic = onDiagnostic;
    this.onError = onError;
    this.onSurface = onSurface;
    this.onCommandStatus = onCommandStatus;
    this.invokeFn = invokeFn;
    this.listenFn = listenFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.persistDiagnostics = persistDiagnostics;
    this.lastRevision = -1;
    this.lastBridgeRevision = -1;
    this.lastLifecycle = null;
    this.lastPresenceFingerprint = null;
    this.lastStatusFingerprint = null;
    this.unlisten = [];
    this.refreshTimer = null;
    this.refreshInFlight = false;
  }

  async connect() {
    this.#emitStatus('CONNECTING', 'connect.start');

    // Prove the command path independently before event registration. If a
    // Tauri event permission or event-name contract regresses, the exact
    // failure remains visible instead of being collapsed into OFFLINE.
    await this.requestSnapshot('connect.pre-listeners');

    try {
      await this.#registerListener(
        TAURI_EVENTS.PRESENCE_CHANGED,
        ({ payload }) => this.#applyPresence(payload),
      );
      await this.#registerListener(TAURI_EVENTS.SNAPSHOT, ({ payload }) => {
        this.#applySnapshot(payload, 'event.runtime-snapshot');
      });
      await this.#registerListener(TAURI_EVENTS.DISCONNECTED, ({ payload }) => {
        const bridgeRevision = numericRevision(payload?.bridgeRevision);
        this.reportDiagnostic(
          'RUNTIME_DISCONNECTED',
          `bridgeRevision=${bridgeRevision ?? 'missing'} payload=${JSON.stringify(payload ?? null)}`,
        );
        if (
          bridgeRevision !== null &&
          bridgeRevision < this.lastBridgeRevision
        ) {
          this.reportDiagnostic(
            'RUNTIME_DISCONNECTED_IGNORED',
            `reason=stale bridgeRevision=${bridgeRevision} lastBridgeRevision=${this.lastBridgeRevision}`,
          );
          return;
        }
        if (bridgeRevision !== null) this.lastBridgeRevision = bridgeRevision;
        this.lastLifecycle = 'DEGRADED';
        this.#emitStatus('OFFLINE', 'event.runtime-disconnected');
      });
      await this.#registerListener(TAURI_EVENTS.CONNECTED, async () => {
        this.#emitStatus('CONNECTING', 'event.runtime-connected');
        await this.#refreshSnapshotSafely('event.runtime-connected');
      });
      await this.#registerListener(
        TAURI_EVENTS.COMPONENT_CHANGED,
        ({ payload }) => this.onComponent?.(payload),
      );
      await this.#registerListener(
        TAURI_EVENTS.AUDIO_INPUT,
        ({ payload }) => this.onAudioInput?.(this.#normalizeAudio(payload)),
      );
      await this.#registerListener(
        TAURI_EVENTS.AUDIO_OUTPUT,
        ({ payload }) => this.onAudioOutput?.(this.#normalizeAudio(payload)),
      );
      await this.#registerListener(TAURI_EVENTS.IPC_ERROR, ({ payload }) => {
        const error = new Error(
          `Core IPC error: ${payload?.error ?? JSON.stringify(payload ?? null)}`,
        );
        this.#reportError('event.runtime-ipc-error', error);
      });
      await this.#registerListener(
        TAURI_EVENTS.SURFACE_CHANGED,
        ({ payload }) => this.onSurface?.(payload),
      );
      await this.#registerListener(
        TAURI_EVENTS.COMMAND_STATUS,
        ({ payload }) => this.onCommandStatus?.(payload),
      );

      await this.requestSnapshot('connect.post-listeners');
      if (typeof this.setIntervalFn !== 'function') {
        throw new Error('RuntimeBridge timer API is unavailable');
      }
      this.refreshTimer = this.setIntervalFn(() => {
        void this.#refreshSnapshotSafely('poll');
      }, 750);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  async requestSnapshot(origin = 'manual') {
    this.reportDiagnostic(
      'TAURI_INVOKE',
      `command=runtime_get_snapshot origin=${origin} lastRevision=${this.lastRevision}`,
    );
    try {
      const snapshot = await this.invokeFn('runtime_get_snapshot', {
        lastRevision: this.lastRevision,
      });
      this.reportDiagnostic(
        'TAURI_INVOKE_RESULT',
        `command=runtime_get_snapshot origin=${origin} ${summarizeSnapshot(snapshot)}`,
      );
      this.#applySnapshot(snapshot, `invoke.${origin}`);
      return snapshot;
    } catch (error) {
      this.#reportError(`invoke.runtime_get_snapshot origin=${origin}`, error);
      throw error;
    }
  }

  async setMicrophoneEnabled(enabled) {
    this.reportDiagnostic(
      'TAURI_INVOKE',
      `command=runtime_set_microphone_enabled enabled=${enabled}`,
    );
    try {
      await this.invokeFn('runtime_set_microphone_enabled', { enabled });
      this.reportDiagnostic(
        'TAURI_INVOKE_RESULT',
        'command=runtime_set_microphone_enabled result=OK',
      );
    } catch (error) {
      this.#reportError('invoke.runtime_set_microphone_enabled', error);
      throw error;
    }
  }

  getSurfaceState() {
    return this.invokeFn('desktop_get_surface_state');
  }

  openModule(moduleId) {
    return this.invokeFn('desktop_open_module', { moduleId });
  }

  setInteractionMode(enabled) {
    return this.invokeFn('desktop_set_interaction_mode', {
      enabled: Boolean(enabled),
    });
  }

  submitDesktopIntent({ commandId, text, issuedAtMs, expiresAtMs }) {
    return this.invokeFn('runtime_submit_desktop_intent', {
      commandId,
      text,
      issuedAtMs,
      expiresAtMs,
    });
  }

  getSystemSnapshot() {
    return this.invokeFn('runtime_get_system_snapshot');
  }

  getFocusState() {
    return this.invokeFn('focus_get_state');
  }

  saveFocusState(state) {
    return this.invokeFn('focus_save_state', { state });
  }

  listCaptures() {
    return this.invokeFn('capture_list');
  }

  addCapture(text) {
    return this.invokeFn('capture_add', { text });
  }

  deleteCapture(id) {
    return this.invokeFn('capture_delete', { id });
  }

  reportDiagnostic(stage, detail) {
    const compact = String(detail ?? '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 2_000);
    this.onDiagnostic?.({ stage, detail: compact });
    if (!this.persistDiagnostics) return;
    try {
      const result = this.invokeFn('runtime_log_frontend', {
        stage,
        detail: compact,
      });
      void Promise.resolve(result).catch((error) => {
        this.onDiagnostic?.({
          stage: 'ERROR',
          detail: `stage=runtime_log_frontend error=${formatDiagnosticError(error)}`,
        });
      });
    } catch (error) {
      this.onDiagnostic?.({
        stage: 'ERROR',
        detail: `stage=runtime_log_frontend error=${formatDiagnosticError(error)}`,
      });
    }
  }

  dispose() {
    if (
      this.refreshTimer !== null &&
      typeof this.clearIntervalFn === 'function'
    ) {
      this.clearIntervalFn(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const stop of this.unlisten.splice(0)) {
      try {
        void Promise.resolve(stop()).catch((error) => {
          this.#reportError('tauri.unlisten', error);
        });
      } catch (error) {
        this.#reportError('tauri.unlisten', error);
      }
    }
  }

  async #registerListener(event, handler) {
    if (!TAURI_EVENT_NAME_PATTERN.test(event)) {
      const error = new Error(`Illegal Tauri event name: ${event}`);
      this.#reportError('tauri.listen.validate', error);
      throw error;
    }
    this.reportDiagnostic('TAURI_LISTEN', `event=${event}`);
    try {
      const stop = await this.listenFn(event, handler);
      this.unlisten.push(stop);
      this.reportDiagnostic('TAURI_LISTEN_RESULT', `event=${event} result=OK`);
    } catch (error) {
      const wrapped = new Error(
        `Tauri listen rejected for ${event}: ${formatDiagnosticError(error)}`,
      );
      this.#reportError('tauri.listen', wrapped);
      throw wrapped;
    }
  }

  async #refreshSnapshotSafely(origin) {
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      await this.requestSnapshot(origin);
    } catch (error) {
      this.#emitStatus(
        'OFFLINE',
        `invoke.rejected=${formatDiagnosticError(error)}`,
      );
    } finally {
      this.refreshInFlight = false;
    }
  }

  #applySnapshot(snapshot, origin) {
    if (!snapshot) {
      this.#reportError(origin, new Error('runtime_get_snapshot returned null'));
      return false;
    }

    const bridgeRevision = numericRevision(snapshot.bridgeRevision);
    if (
      bridgeRevision !== null &&
      bridgeRevision < this.lastBridgeRevision
    ) {
      this.reportDiagnostic(
        'JS_SNAPSHOT_IGNORED',
        `origin=${origin} reason=stale bridgeRevision=${bridgeRevision} lastBridgeRevision=${this.lastBridgeRevision}`,
      );
      return false;
    }

    if (bridgeRevision !== null) this.lastBridgeRevision = bridgeRevision;
    this.lastLifecycle = String(snapshot.lifecycle ?? '').toUpperCase();
    const presence = snapshot.presence ?? snapshot;
    const revision = numericRevision(
      presence?.revision ?? snapshot?.revision,
    );
    this.reportDiagnostic(
      'JS_SNAPSHOT',
      `origin=${origin} ${summarizeSnapshot(snapshot)}`,
    );
    this.onSnapshot?.(snapshot);

    const decision = evaluateSnapshotStatus(snapshot);
    this.#emitStatus(decision.status, `${origin} ${decision.reason}`);

    if (revision !== null) this.lastRevision = revision;
    const fingerprint = presenceFingerprint(presence, bridgeRevision);
    if (fingerprint !== this.lastPresenceFingerprint) {
      this.lastPresenceFingerprint = fingerprint;
      this.onPresence?.(presence);
    }
    return true;
  }

  #applyPresence(payload) {
    if (!payload) return;
    const presence = payload?.snapshot ?? payload?.presence ?? payload;
    const bridgeRevision = numericRevision(payload?.bridgeRevision);
    const revision = numericRevision(presence?.revision);

    if (
      bridgeRevision !== null &&
      bridgeRevision < this.lastBridgeRevision
    ) {
      this.reportDiagnostic(
        'JS_PRESENCE_IGNORED',
        `reason=stale bridgeRevision=${bridgeRevision} lastBridgeRevision=${this.lastBridgeRevision}`,
      );
      return;
    }
    if (
      bridgeRevision === null &&
      revision !== null &&
      revision < this.lastRevision
    ) {
      this.reportDiagnostic(
        'JS_PRESENCE_IGNORED',
        `reason=stale presence.revision=${revision} lastRevision=${this.lastRevision}`,
      );
      return;
    }

    if (bridgeRevision !== null) this.lastBridgeRevision = bridgeRevision;
    if (revision !== null) this.lastRevision = revision;
    const fingerprint = presenceFingerprint(presence, bridgeRevision);
    if (fingerprint === this.lastPresenceFingerprint) return;
    this.lastPresenceFingerprint = fingerprint;
    this.reportDiagnostic(
      'JS_PRESENCE',
      `bridgeRevision=${bridgeRevision ?? 'missing'} presence.state=${presence?.state ?? 'missing'} presence.revision=${presence?.revision ?? 'missing'}`,
    );
    this.onPresence?.(presence);
    const presenceState = String(presence?.state ?? '').toUpperCase();
    if (presenceState === 'OFFLINE') {
      this.#emitStatus('OFFLINE', 'event.runtime-presence presence.state=OFFLINE');
    } else if (this.lastLifecycle === 'READY') {
      this.#emitStatus(
        'READY',
        `event.runtime-presence lifecycle=READY presence.state=${presenceState || 'MISSING'}`,
      );
    }
  }

  #emitStatus(status, reason) {
    const fingerprint = `${status}:${reason}`;
    if (fingerprint === this.lastStatusFingerprint) return;
    this.lastStatusFingerprint = fingerprint;
    this.reportDiagnostic('JS_STATUS', `status=${status} reason=${reason}`);
    this.onStatus?.(status, { reason });
  }

  #reportError(stage, error) {
    const detail = `stage=${stage} exception=${formatDiagnosticError(error)}`;
    // main.js deliberately renders bridge failures as ERROR/OFFLINE. Invalidate
    // the projection dedupe keys so the next authoritative snapshot always
    // restores both the status label and Presence DOM, even when its revisions
    // are unchanged.
    this.lastPresenceFingerprint = null;
    this.lastStatusFingerprint = null;
    this.reportDiagnostic('ERROR', detail);
    this.onError?.({ stage, error, detail });
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
