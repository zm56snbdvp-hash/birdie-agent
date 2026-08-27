import './styles.css';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { BirdieField } from './birdie-field.js';
import { hasVisualProfile } from './birdie-visual-state.js';
import {
  RuntimeBridge,
  formatDiagnosticError,
} from './runtime-bridge.js';

const frontendBuildId = __BIRDIE_DESKTOP_BUILD_ID__;

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="field-chrome" aria-hidden="true">
    <span class="edge edge-top"></span>
    <span class="edge edge-right"></span>
    <span class="edge edge-bottom"></span>
    <span class="edge edge-left"></span>
    <span class="horizon horizon-a"></span>
    <span class="horizon horizon-b"></span>
  </div>
  <canvas id="birdie-core" aria-label="Birdie startet"></canvas>
  <div id="presence-readout" role="status" aria-live="polite">
    <span class="readout-mark" aria-hidden="true"></span>
    <span class="readout-name">BIRDIE</span>
    <span id="state">STARTING</span>
    <small id="runtime-status">Runtime verbindet…</small>
  </div>
  <section id="panel" hidden aria-label="Birdie Steuerung">
    <div class="panel-heading">
      <strong>BIRDIE // CONTROL</strong>
      <span class="panel-live">LOCAL</span>
    </div>
    <small id="component-status">Core · Voice</small>
    <small id="diagnostic-status">Build ${frontendBuildId}</small>
    <button id="mic-toggle" type="button" disabled>Mikrofon wird initialisiert…</button>
    <button id="release-overlay" type="button">Zurück in den Präsenzmodus</button>
    <small class="panel-hint">Sofort-Escape: ESC</small>
  </section>
`;

const canvas = document.querySelector('#birdie-core');
const panel = document.querySelector('#panel');
const stateLabel = document.querySelector('#state');
const runtimeStatus = document.querySelector('#runtime-status');
const componentStatus = document.querySelector('#component-status');
const diagnosticStatus = document.querySelector('#diagnostic-status');
const micToggle = document.querySelector('#mic-toggle');
const releaseOverlay = document.querySelector('#release-overlay');

document.body.dataset.interaction = 'ambient';
document.body.dataset.presence = 'offline';

let bridge;
const field = new BirdieField(canvas, {
  onReady(viewport) {
    bridge.reportDiagnostic(
      'IMMERSIVE_READY',
      `viewport=${viewport.width}x${viewport.height} pixelRatio=${viewport.pixelRatio.toFixed(2)} core=full-viewport`,
    );
  },
  onContextState(status, detail = '') {
    bridge.reportDiagnostic(
      'IMMERSIVE_CONTEXT',
      `status=${status}${detail ? ` ${detail}` : ''}`,
    );
  },
});

let presenceState = 'OFFLINE';
let microphoneState = 'UNAVAILABLE';
let microphoneTarget = null;
let microphoneTimeout = null;
let runtimeReady = false;
const components = new Map();

function applyPresence(snapshot) {
  if (!hasVisualProfile(snapshot.state)) return;
  presenceState = snapshot.state;
  field.setPresence(snapshot.state);
  document.body.dataset.presence = snapshot.state.toLowerCase();
  stateLabel.textContent = snapshot.state;
  canvas.setAttribute('aria-label', `Birdie: ${snapshot.state}`);
}

function applyInputAudio(signal) {
  field.setInputAudio(signal);
}

function applyOutputAudio(signal) {
  field.setOutputAudio(signal);
}

function renderMicrophone() {
  if (microphoneTarget !== null) {
    micToggle.disabled = true;
    micToggle.textContent = microphoneTarget
      ? 'Mikrofon wird eingeschaltet…'
      : 'Mikrofon wird ausgeschaltet…';
    return;
  }

  switch (microphoneState) {
    case 'ENABLED':
      micToggle.disabled = !runtimeReady;
      micToggle.textContent = 'Mikrofon aus';
      break;
    case 'MUTED_BY_USER':
      micToggle.disabled = !runtimeReady;
      micToggle.textContent = 'Mikrofon an';
      break;
    case 'PERMISSION_DENIED':
      micToggle.disabled = true;
      micToggle.textContent = 'Mikrofon-Berechtigung fehlt';
      break;
    default:
      micToggle.disabled = !runtimeReady;
      micToggle.textContent = 'Mikrofon erneut verbinden';
      break;
  }
}

function confirmMicrophone(nextState) {
  microphoneState = nextState;
  if (microphoneTarget !== null) {
    const expected = microphoneTarget ? 'ENABLED' : 'MUTED_BY_USER';
    if (
      nextState === expected ||
      nextState === 'UNAVAILABLE' ||
      nextState === 'PERMISSION_DENIED'
    ) {
      microphoneTarget = null;
      clearTimeout(microphoneTimeout);
      microphoneTimeout = null;
    }
  }
  renderMicrophone();
}

function renderComponents() {
  const core = components.get('birdie-core')?.status ?? 'CONNECTING';
  const voice = components.get('birdie-voice')?.status ?? 'CONNECTING';
  componentStatus.textContent = `Core ${core} · Voice ${voice}`;
}

function renderBridgeError(stage, error) {
  const detail = formatDiagnosticError(error);
  runtimeReady = false;
  runtimeStatus.textContent = `Bridge-Fehler: ${stage}`;
  runtimeStatus.title = detail;
  diagnosticStatus.textContent = detail;
  diagnosticStatus.title = detail;
  diagnosticStatus.dataset.error = 'true';
  applyPresence({ state: 'ERROR' });
  renderMicrophone();
}

bridge = new RuntimeBridge({
  onPresence(snapshot) {
    applyPresence(snapshot);
    bridge.reportDiagnostic(
      'MAIN_STATE',
      `presence.state=${presenceState} presence.revision=${snapshot?.revision ?? 'missing'}`,
    );
    bridge.reportDiagnostic(
      'DOM_STATE',
      `state=${stateLabel.textContent} runtime=${runtimeStatus.textContent} microphone=${micToggle.textContent}`,
    );
  },
  onAudioInput: applyInputAudio,
  onAudioOutput: applyOutputAudio,
  onSnapshot(snapshot) {
    if (snapshot?.microphoneState) confirmMicrophone(snapshot.microphoneState);
    bridge.reportDiagnostic(
      'MAIN_STATE',
      `snapshot.microphoneState=${snapshot?.microphoneState ?? 'missing'} snapshot.brainState=${snapshot?.brainState ?? 'missing'}`,
    );
  },
  onStatus(status, metadata) {
    runtimeReady = status === 'READY';
    runtimeStatus.textContent = runtimeReady
      ? 'Wake-on-Speak · Local first'
      : status === 'OFFLINE'
        ? 'Runtime offline'
        : 'Runtime verbindet…';
    runtimeStatus.title = metadata?.reason ?? '';
    if (status === 'OFFLINE') applyPresence({ state: 'OFFLINE' });
    renderMicrophone();
    bridge.reportDiagnostic(
      'MAIN_STATE',
      `runtime.status=${status} runtimeReady=${runtimeReady} reason=${metadata?.reason ?? 'missing'}`,
    );
    bridge.reportDiagnostic(
      'DOM_STATE',
      `state=${stateLabel.textContent} runtime=${runtimeStatus.textContent} microphone=${micToggle.textContent}`,
    );
  },
  onComponent(component) {
    if (!component?.component) return;
    components.set(component.component, component);
    renderComponents();
  },
  onDiagnostic({ stage, detail }) {
    if (stage === 'ERROR') diagnosticStatus.dataset.error = 'true';
    if (stage === 'ERROR' || diagnosticStatus.dataset.error !== 'true') {
      diagnosticStatus.textContent = `${stage}: ${detail}`;
      diagnosticStatus.title = detail;
    }
  },
  onError({ stage, error }) {
    renderBridgeError(stage, error);
  },
});

bridge.reportDiagnostic(
  'DESKTOP_FRONTEND',
  `buildId=${frontendBuildId} location=${window.location.href}`,
);

function renderInteractionMode(enabled) {
  const interactive = Boolean(enabled);
  document.body.dataset.interaction = interactive ? 'control' : 'ambient';
  panel.hidden = !interactive;
}

async function requestInteractionMode(enabled) {
  const requested = Boolean(enabled);

  // CONTROL must be visibly escapable before native cursor capture is enabled.
  // When releasing CONTROL, keep that escape UI visible until native confirms
  // that the full-screen surface is click-through again.
  if (requested) renderInteractionMode(true);
  try {
    await tauriInvoke('desktop_set_interaction_mode', { enabled: requested });
    renderInteractionMode(requested);
  } catch (error) {
    renderInteractionMode(requested ? false : true);
    bridge.reportDiagnostic(
      'ERROR',
      `stage=desktop.interaction enabled=${requested} exception=${formatDiagnosticError(error)}`,
    );
  }
}

window.__birdieSetInteractionMode = renderInteractionMode;
window.__birdieRequestControlMode = () => {
  void requestInteractionMode(true);
};

releaseOverlay.addEventListener('click', () => {
  void requestInteractionMode(false);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.dataset.interaction === 'control') {
    void requestInteractionMode(false);
  }
});

if (import.meta.env.DEV) {
  window.__birdiePreview = ({ state = 'IDLE', input = 0, output = 0, vad = 0 } = {}) => {
    applyPresence({ state });
    field.setInputAudio({ level: input, vadProbability: vad });
    field.setOutputAudio({ level: output });
  };
}

micToggle.addEventListener('click', async () => {
  if (microphoneTarget !== null) return;
  microphoneTarget = microphoneState !== 'ENABLED';
  renderMicrophone();

  microphoneTimeout = setTimeout(() => {
    microphoneTarget = null;
    runtimeStatus.textContent = 'Keine Voice-Bestätigung erhalten';
    renderMicrophone();
  }, 5_000);

  try {
    await bridge.setMicrophoneEnabled(microphoneTarget);
  } catch (error) {
    clearTimeout(microphoneTimeout);
    microphoneTimeout = null;
    microphoneTarget = null;
    bridge.reportDiagnostic(
      'ERROR',
      `stage=main.microphone exception=${formatDiagnosticError(error)}`,
    );
    renderBridgeError('main.microphone', error);
  }
});

field.start();
bridge.connect().catch((error) => {
  bridge.reportDiagnostic(
    'ERROR',
    `stage=main.connect exception=${formatDiagnosticError(error)}`,
  );
  renderBridgeError('main.connect', error);
});

window.addEventListener(
  'beforeunload',
  () => {
    if (document.body.dataset.interaction === 'control') {
      void tauriInvoke('desktop_set_interaction_mode', { enabled: false });
    }
    field.dispose();
  },
  { once: true },
);
