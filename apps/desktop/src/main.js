import * as THREE from 'three';
import './styles.css';
import {
  RuntimeBridge,
  formatDiagnosticError,
} from './runtime-bridge.js';

const frontendBuildId = __BIRDIE_DESKTOP_BUILD_ID__;

const app = document.querySelector('#app');
app.innerHTML = `<canvas id="birdie-core" aria-label="Birdie startet"></canvas><section id="panel" hidden><strong>BIRDIE</strong><span id="state">STARTING</span><small id="runtime-status">Runtime verbindet…</small><small id="component-status">Core · Voice</small><small id="diagnostic-status">Build ${frontendBuildId}</small><button id="mic-toggle" type="button" disabled>Mikrofon wird initialisiert…</button></section>`;

const canvas = document.querySelector('#birdie-core');
const panel = document.querySelector('#panel');
const stateLabel = document.querySelector('#state');
const runtimeStatus = document.querySelector('#runtime-status');
const componentStatus = document.querySelector('#component-status');
const diagnosticStatus = document.querySelector('#diagnostic-status');
const micToggle = document.querySelector('#mic-toggle');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.z = 3.2;
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(220, 220, false);
renderer.setClearColor(0x000000, 0);

const geometry = new THREE.SphereGeometry(0.82, 64, 64);
const pos = geometry.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const y = pos.getY(i);
  const z = pos.getZ(i);
  const fold = Math.exp(-((x - 0.48) ** 2 + (y + 0.42) ** 2) * 8) * 0.09;
  pos.setXYZ(i, x * 0.84 - fold, y, z * 0.72);
}
geometry.computeVertexNormals();

const mantle = new THREE.Mesh(
  geometry,
  new THREE.MeshPhysicalMaterial({
    color: 0x063c2c,
    transparent: true,
    opacity: 0.48,
    roughness: 0.2,
    metalness: 0.08,
    transmission: 0.15,
    emissive: 0x05271e,
    emissiveIntensity: 0.65,
  }),
);
scene.add(mantle);

const field = new THREE.Mesh(
  new THREE.SphereGeometry(0.58, 48, 48),
  new THREE.MeshBasicMaterial({
    color: 0x16a46b,
    transparent: true,
    opacity: 0.32,
  }),
);
field.scale.set(0.84, 1, 0.72);
scene.add(field);

const meridianCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.55, -0.38, 0.52),
  new THREE.Vector3(-0.2, 0.22, 0.72),
  new THREE.Vector3(0.28, 0.58, 0.44),
  new THREE.Vector3(0.52, 0.02, 0.5),
  new THREE.Vector3(0.35, -0.48, 0.48),
]);
const meridian = new THREE.Mesh(
  new THREE.TubeGeometry(meridianCurve, 48, 0.014, 8, false),
  new THREE.MeshBasicMaterial({ color: 0xd5ad55, transparent: true }),
);
scene.add(meridian);

const presets = {
  IDLE: [0.38, 0.18, 0.12, 0.20],
  SPEECH_DETECTED: [0.74, 0.62, 0.48, 0.28],
  LISTENING: [0.82, 0.92, 0.40, 0.22],
  THINKING: [0.78, 0.24, 0.64, 0.52],
  SPEAKING: [0.92, 0.64, 0.72, 0.48],
  WORKING: [0.84, 0.34, 0.90, 0.60],
  SUCCESS: [1, 0.78, 0.52, 0.96],
  ERROR: [0.54, 0.12, 0.08, 0.16],
  OFFLINE: [0.16, 0.04, 0.02, 0.05],
};

let presenceState = 'OFFLINE';
const started = performance.now();
let microphoneState = 'UNAVAILABLE';
let microphoneTarget = null;
let microphoneTimeout = null;
let runtimeReady = false;
const components = new Map();

let inputTarget = 0;
let inputEnvelope = 0;
let inputVadProbability = 0;
let inputUpdatedAt = 0;
let outputTarget = 0;
let outputEnvelope = 0;
let outputUpdatedAt = 0;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function applyPresence(snapshot) {
  if (!presets[snapshot.state]) return;
  presenceState = snapshot.state;
  stateLabel.textContent = snapshot.state;
  canvas.setAttribute('aria-label', `Birdie: ${snapshot.state}`);
}

function applyInputAudio(signal) {
  inputTarget = clamp01(signal.level);
  inputVadProbability = clamp01(signal.vadProbability);
  inputUpdatedAt = performance.now();
}

function applyOutputAudio(signal) {
  outputTarget = clamp01(signal.level);
  outputUpdatedAt = performance.now();
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

const bridge = new RuntimeBridge({
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

canvas.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
});

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

bridge.connect().catch((error) => {
  bridge.reportDiagnostic(
    'ERROR',
    `stage=main.connect exception=${formatDiagnosticError(error)}`,
  );
  renderBridgeError('main.connect', error);
});

function approach(current, target, attack, release) {
  return current + (target - current) * (target > current ? attack : release);
}

function frame(now) {
  const t = (now - started) / 1000;
  if (now - inputUpdatedAt > 140) {
    inputTarget = 0;
    inputVadProbability = 0;
  }
  if (now - outputUpdatedAt > 140) outputTarget = 0;

  inputEnvelope = approach(inputEnvelope, inputTarget, 0.32, 0.11);
  outputEnvelope = approach(outputEnvelope, outputTarget, 0.42, 0.16);

  const [presence, aperture, flow, gold] = presets[presenceState];
  const inputIsForeground =
    presenceState === 'SPEECH_DETECTED' || presenceState === 'LISTENING';
  const outputIsForeground = presenceState === 'SPEAKING';
  const activeInput = inputEnvelope * (inputIsForeground ? 1 : 0.12);
  const activeOutput = outputEnvelope * (outputIsForeground ? 1 : 0);
  const audioEnergy = Math.max(activeInput, activeOutput);
  const attention = inputIsForeground ? inputVadProbability : 0;

  const breath = 1 + Math.sin(t * 0.95) * 0.008;
  const mantleAudio = 1 + audioEnergy * 0.002;
  mantle.scale.set(
    breath * mantleAudio,
    breath * (1 - 0.002 * Math.cos(t)) * mantleAudio,
    breath,
  );

  const apertureScale = aperture * 0.025 + attention * 0.008;
  const fieldAudio = audioEnergy * 0.026;
  field.scale.set(
    0.84 * (1 + apertureScale + fieldAudio * 0.72),
    1 + apertureScale + fieldAudio,
    0.72 * (1 + fieldAudio * 0.45),
  );
  const fieldOpacityTarget = 0.18 + presence * 0.34 + audioEnergy * 0.10;
  field.material.opacity += (fieldOpacityTarget - field.material.opacity) * 0.08;
  field.rotation.y += 0.0008 + flow * 0.0015 + audioEnergy * 0.0012;

  const meridianOpacityTarget = Math.min(
    1,
    0.4 + gold * 0.6 + activeOutput * 0.14,
  );
  meridian.material.opacity +=
    (meridianOpacityTarget - meridian.material.opacity) * 0.12;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
