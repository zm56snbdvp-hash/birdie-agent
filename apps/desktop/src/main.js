import './styles.css';
import { RuntimeBridge, formatDiagnosticError } from './runtime-bridge.js';

const BUILD_ID = __BIRDIE_DESKTOP_BUILD_ID__;

// Birdie is intentionally headless in the desktop alpha. The WebView exists
// only as a native IPC/event anchor; all user-facing work is voice-first and
// desktop.app.open commands are executed by the Tauri host.
const app = document.querySelector('#app');
document.documentElement.dataset.buildId = BUILD_ID;

function startHeadless() {
  app?.replaceChildren();
  document.documentElement.dataset.birdieMode = 'headless';
  document.body.dataset.birdieMode = 'headless';

  const state = {
    runtime: 'CONNECTING',
    presence: 'OFFLINE',
    microphone: 'UNAVAILABLE',
    components: new Map(),
  };

  function updateRuntimeSnapshot(snapshot) {
    state.runtime = String(snapshot?.lifecycle ?? 'UNKNOWN').toUpperCase();
    state.presence = String(snapshot?.presence?.state ?? 'OFFLINE').toUpperCase();
    state.microphone = String(snapshot?.microphoneState ?? 'UNAVAILABLE').toUpperCase();
    document.body.dataset.runtime = state.runtime.toLowerCase();
    document.body.dataset.presence = state.presence.toLowerCase();
    document.body.dataset.microphone = state.microphone.toLowerCase();
  }

  const bridge = new RuntimeBridge({
    onSnapshot: updateRuntimeSnapshot,
    onPresence: (snapshot) => {
      state.presence = String(snapshot?.state ?? 'OFFLINE').toUpperCase();
      document.body.dataset.presence = state.presence.toLowerCase();
    },
    onStatus: (status) => {
      state.runtime = status;
      document.body.dataset.runtime = String(status).toLowerCase();
    },
    onComponent: (event) => {
      if (event?.component) state.components.set(event.component, event.status);
    },
    onError: ({ stage, detail }) => {
      document.body.dataset.runtimeError = String(stage ?? detail ?? 'unknown').slice(0, 120);
    },
    onDiagnostic: ({ stage, detail }) => {
      document.body.dataset.lastDiagnostic = `${stage ?? 'unknown'}:${detail ?? ''}`.slice(0, 240);
    },
  });

  bridge.reportDiagnostic('DESKTOP_FRONTEND', `buildId=${BUILD_ID} mode=headless`);

  window.__birdieRuntime = Object.freeze({
    state,
    reconnect: () => bridge.connect(),
    dispose: () => bridge.dispose(),
  });

  void bridge.connect().catch((error) => {
    document.body.dataset.runtime = 'offline';
    document.body.dataset.runtimeError = formatDiagnosticError(error).slice(0, 120);
  });
}

function startStream() {
  document.documentElement.dataset.birdieMode = 'stream';
  document.body.dataset.birdieMode = 'stream';
  void import('./stream-mode.js')
    .then(({ startStreamMode }) => startStreamMode({ app, buildId: BUILD_ID }))
    .catch(() => {
      document.body.dataset.streamReady = 'failed';
      Object.assign(document.body.style, {
        width: '100vw',
        height: '100vh',
        visibility: 'visible',
        background: '#020a08',
        color: '#eef4da',
      });
      if (app) {
        app.textContent = 'BIRDIE STREAM MODE // STARTFEHLER';
        Object.assign(app.style, {
          display: 'grid',
          width: '100vw',
          height: '100vh',
          placeItems: 'center',
        });
      }
    });
}

function startOperatorConsole() {
  document.documentElement.dataset.birdieMode = 'operator';
  document.body.dataset.birdieMode = 'operator';
  void import('./stream-launch-console.js')
    .then(({ startStreamLaunchConsole }) => startStreamLaunchConsole({ app, buildId: BUILD_ID }))
    .catch(() => {
      document.body.dataset.operatorReady = 'failed';
      Object.assign(document.body.style, {
        width: '100vw',
        height: '100vh',
        visibility: 'visible',
        background: '#070a0f',
        color: '#eef4da',
      });
      if (app) {
        app.textContent = 'BIRDIE OPERATOR CONSOLE // LOCAL STARTFEHLER';
        Object.assign(app.style, {
          display: 'grid',
          width: '100vw',
          height: '100vh',
          placeItems: 'center',
        });
      }
    });
}

function startPrivateSaleTest() {
  document.documentElement.dataset.birdieMode = 'private-sale';
  document.body.dataset.birdieMode = 'private-sale';
  void import('./stream-private-sale.js')
    .then(({ startPrivateSaleTest: start }) => start({ app, buildId: BUILD_ID }))
    .catch(() => {
      document.body.dataset.privateSaleReady = 'failed';
      Object.assign(document.body.style, { visibility: 'visible', background: '#07100d', color: '#eef4da' });
      if (app) app.textContent = 'BIRDIE PRIVATE CTA TEST // LOCAL STARTFEHLER';
    });
}

const requestedMode = new URLSearchParams(window.location.search).get('mode');
if (requestedMode === 'stream') startStream();
else if (requestedMode === 'operator') startOperatorConsole();
else if (requestedMode === 'private-sale') startPrivateSaleTest();
else startHeadless();
