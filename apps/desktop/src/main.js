import './styles.css';
import { BirdieField } from './birdie-field.js';
import { hasVisualProfile } from './birdie-visual-state.js';
import { CaptureService, MAX_CAPTURE_TEXT_LENGTH } from './capture-service.js';
import { CommandCenterModel } from './command-center-model.js';
import { FocusService, FOCUS_STATUS } from './focus-service.js';
import {
  MODULE_IDS,
  listModules,
  moduleIdForKeyboardEvent,
  normalizeModuleId,
} from './module-registry.js';
import { RuntimeBridge, formatDiagnosticError } from './runtime-bridge.js';
import { SurfaceController, INTERACTION_MODES } from './surface-controller.js';
import { SystemModel } from './system-model.js';

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
    <nav id="module-rail" aria-label="Birdie Module"></nav>
    <main id="module-stage">
      <header class="stage-heading">
        <div>
          <small class="eyebrow">BIRDIE // FUNCTION LAYER</small>
          <h1 id="active-module-label">Command Center</h1>
        </div>
        <button id="release-overlay" type="button" title="Präsenzmodus (Esc)">
          <span aria-hidden="true">×</span><span class="sr-only">Zurück in den Präsenzmodus</span>
        </button>
      </header>

      <section class="module-view" data-module-view="COMMAND_CENTER" aria-labelledby="command-center-title">
        <div class="module-intro">
          <p class="module-index">01 // COMMAND_CENTER</p>
          <h2 id="command-center-title">Sag Birdie, was geöffnet werden soll.</h2>
          <p>Lokaler, typisierter Befehlspfad. Unbekannte Absichten werden abgelehnt und nie als Erfolg dargestellt.</p>
        </div>
        <form id="command-form" class="command-form">
          <label for="command-input">Desktop-Befehl</label>
          <div class="command-line">
            <input id="command-input" name="command" maxlength="500" autocomplete="off" placeholder="Öffne Focus" required />
            <button type="submit">Senden</button>
          </div>
          <small>Beispiele: „Öffne System“, „Starte Focus“, „Geh in den Hintergrund“</small>
        </form>
        <p id="command-error" class="inline-error" role="alert" hidden></p>
        <ol id="command-history" class="command-history" aria-label="Befehlsstatus"></ol>
      </section>

      <section class="module-view" data-module-view="SYSTEM" aria-labelledby="system-title" hidden>
        <div class="module-intro">
          <p class="module-index">02 // SYSTEM</p>
          <h2 id="system-title">Der lokale Runtime-Zustand, ohne Schönfärbung.</h2>
          <p>Fehlende oder veraltete Signale bleiben sichtbar als UNKNOWN, UNAVAILABLE oder STALE.</p>
        </div>
        <div class="system-toolbar">
          <span id="system-freshness" class="state-chip">UNKNOWN</span>
          <button id="system-refresh" class="quiet-button" type="button">Neu lesen</button>
        </div>
        <dl id="system-grid" class="system-grid">
          <div><dt>Core</dt><dd data-system-value="coreStatus">UNKNOWN</dd></div>
          <div><dt>Voice</dt><dd data-system-value="voiceStatus">UNKNOWN</dd></div>
          <div><dt>Mikrofon</dt><dd data-system-value="microphoneState">UNAVAILABLE</dd></div>
          <div><dt>Presence</dt><dd data-system-value="presenceState">UNKNOWN</dd></div>
          <div><dt>Brain</dt><dd data-system-value="brainState">UNAVAILABLE</dd></div>
          <div><dt>IPC</dt><dd data-system-value="ipcState">UNKNOWN</dd></div>
          <div><dt>Verbindung</dt><dd data-system-value="connectionId">NICHT GEMELDET</dd></div>
          <div><dt>Letzte Core-Nachricht</dt><dd data-system-value="lastCoreMessageAt">NICHT GEMELDET</dd></div>
          <div><dt>Globaler Shortcut</dt><dd data-system-value="globalShortcutStatus">UNKNOWN</dd></div>
        </dl>
        <p id="system-error" class="inline-error" role="alert" hidden></p>
      </section>

      <section class="module-view" data-module-view="FOCUS" aria-labelledby="focus-title" hidden>
        <div class="module-intro">
          <p class="module-index">03 // FOCUS</p>
          <h2 id="focus-title">Eine Aufgabe. Eine belastbare Deadline.</h2>
          <p>Der Zustand wird lokal gespeichert und nach Neustart anhand der Deadline rekonstruiert.</p>
        </div>
        <div class="focus-orbit" aria-live="polite">
          <span id="focus-clock">00:00</span>
          <small id="focus-status">IDLE</small>
        </div>
        <form id="focus-form" class="focus-form">
          <label for="focus-task">Aufgabe</label>
          <input id="focus-task" maxlength="1000" autocomplete="off" placeholder="Woran willst du jetzt arbeiten?" required />
          <label for="focus-duration">Dauer in Minuten</label>
          <input id="focus-duration" type="number" min="1" max="1440" step="1" value="25" required />
          <button id="focus-start" type="submit">Fokus starten</button>
        </form>
        <div class="focus-actions" aria-label="Focus Steuerung">
          <button id="focus-pause" type="button">Pausieren</button>
          <button id="focus-resume" type="button">Fortsetzen</button>
          <button id="focus-complete" type="button">Abschließen</button>
          <button id="focus-reset" class="quiet-button" type="button">Zurücksetzen</button>
        </div>
        <p id="focus-error" class="inline-error" role="alert" hidden></p>
      </section>

      <section class="module-view" data-module-view="CAPTURE" aria-labelledby="capture-title" hidden>
        <div class="module-intro">
          <p class="module-index">04 // CAPTURE</p>
          <h2 id="capture-title">Gedanken landen hier — und nur hier.</h2>
          <p>Lokale, persistente Ablage auf diesem Gerät. Kein externer Dienst und keine simulierte Synchronisation.</p>
        </div>
        <form id="capture-form" class="capture-form">
          <label for="capture-input">Gedanke oder Notiz</label>
          <textarea id="capture-input" maxlength="${MAX_CAPTURE_TEXT_LENGTH}" rows="4" placeholder="Festhalten, bevor es weg ist …" required></textarea>
          <div><small id="capture-count">0 / ${MAX_CAPTURE_TEXT_LENGTH}</small><button type="submit">Lokal sichern</button></div>
        </form>
        <p id="capture-error" class="inline-error" role="alert" hidden></p>
        <ol id="capture-list" class="capture-list" aria-label="Lokale Captures"></ol>
      </section>
    </main>

    <aside id="runtime-strip" aria-label="Runtime Steuerung">
      <div class="panel-heading"><strong>RUNTIME</strong><span class="panel-live">LOCAL</span></div>
      <small id="component-status">Core CONNECTING · Voice CONNECTING</small>
      <small id="diagnostic-status">Build ${frontendBuildId}</small>
      <button id="mic-toggle" type="button" disabled>Mikrofon wird initialisiert…</button>
      <small class="panel-hint"><kbd>Esc</kbd> Presence · <kbd>Ctrl</kbd>+<kbd>1–4</kbd> Module · <kbd>Ctrl</kbd>+<kbd>K</kbd> Command</small>
    </aside>
  </section>
`;

const $ = (selector) => document.querySelector(selector);
const canvas = $('#birdie-core');
const panel = $('#panel');
const moduleRail = $('#module-rail');
const activeModuleLabel = $('#active-module-label');
const stateLabel = $('#state');
const runtimeStatus = $('#runtime-status');
const componentStatus = $('#component-status');
const diagnosticStatus = $('#diagnostic-status');
const micToggle = $('#mic-toggle');
const releaseOverlay = $('#release-overlay');
const commandForm = $('#command-form');
const commandInput = $('#command-input');
const commandHistory = $('#command-history');
const systemRefresh = $('#system-refresh');
const focusForm = $('#focus-form');
const focusTask = $('#focus-task');
const focusDuration = $('#focus-duration');
const captureForm = $('#capture-form');
const captureInput = $('#capture-input');

for (const module of listModules()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.module = module.id;
  button.setAttribute('aria-label', `${module.label} (${module.shortcut})`);
  button.innerHTML = `<span>${module.key.padStart(2, '0')}</span><strong>${module.shortLabel}</strong><kbd>${module.shortcut.replace('Ctrl+', '^')}</kbd>`;
  moduleRail.append(button);
}

document.body.dataset.interaction = 'ambient';
document.body.dataset.presence = 'offline';
document.body.dataset.module = MODULE_IDS.COMMAND_CENTER.toLowerCase();

let bridge;
let surface;
let systemModel;
let focusService;
let captureService;
let commandCenter;

const field = new BirdieField(canvas, {
  onReady(viewport) {
    bridge?.reportDiagnostic(
      'IMMERSIVE_READY',
      `viewport=${viewport.width}x${viewport.height} pixelRatio=${viewport.pixelRatio.toFixed(2)} core=full-viewport`,
    );
  },
  onContextState(status, detail = '') {
    bridge?.reportDiagnostic('IMMERSIVE_CONTEXT', `status=${status}${detail ? ` ${detail}` : ''}`);
  },
});

let presenceState = 'OFFLINE';
let microphoneState = 'UNAVAILABLE';
let microphoneTarget = null;
let microphoneTimeout = null;
let runtimeReady = false;
const components = new Map();

function setInlineError(selector, error = null) {
  const element = $(selector);
  element.hidden = !error;
  element.textContent = error ? formatDiagnosticError(error) : '';
}

function reportUiError(stage, error, selector) {
  setInlineError(selector, error);
  bridge.reportDiagnostic('ERROR', `stage=${stage} exception=${formatDiagnosticError(error)}`);
}

function applyPresence(snapshot) {
  if (!hasVisualProfile(snapshot?.state)) return;
  presenceState = snapshot.state;
  field.setPresence(snapshot.state);
  document.body.dataset.presence = snapshot.state.toLowerCase();
  stateLabel.textContent = snapshot.state;
  canvas.setAttribute('aria-label', `Birdie: ${snapshot.state}`);
}

function renderMicrophone() {
  if (microphoneTarget !== null) {
    micToggle.disabled = true;
    micToggle.textContent = microphoneTarget ? 'Mikrofon wird eingeschaltet…' : 'Mikrofon wird ausgeschaltet…';
    return;
  }
  const labels = {
    ENABLED: 'Mikrofon aus',
    MUTED_BY_USER: 'Mikrofon an',
    PERMISSION_DENIED: 'Mikrofon-Berechtigung fehlt',
    UNAVAILABLE: 'Mikrofon erneut verbinden',
  };
  micToggle.disabled = !runtimeReady || microphoneState === 'PERMISSION_DENIED';
  micToggle.textContent = labels[microphoneState] ?? 'Mikrofonstatus unbekannt';
}

function confirmMicrophone(nextState) {
  microphoneState = nextState;
  if (microphoneTarget !== null) {
    const expected = microphoneTarget ? 'ENABLED' : 'MUTED_BY_USER';
    if ([expected, 'UNAVAILABLE', 'PERMISSION_DENIED'].includes(nextState)) {
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
    bridge.reportDiagnostic('MAIN_STATE', `presence.state=${presenceState} presence.revision=${snapshot?.revision ?? 'missing'}`);
    bridge.reportDiagnostic(
      'DOM_STATE',
      `state=${stateLabel.textContent} runtime=${runtimeStatus.textContent} microphone=${micToggle.textContent}`,
    );
  },
  onAudioInput(signal) { field.setInputAudio(signal); },
  onAudioOutput(signal) { field.setOutputAudio(signal); },
  onSnapshot(snapshot) {
    if (snapshot?.microphoneState) confirmMicrophone(snapshot.microphoneState);
    systemModel?.updateRuntimeSnapshot(snapshot);
  },
  onStatus(status, metadata) {
    runtimeReady = status === 'READY';
    runtimeStatus.textContent = runtimeReady ? 'Wake-on-Speak · Local first' : status === 'OFFLINE' ? 'Runtime offline' : 'Runtime verbindet…';
    runtimeStatus.title = metadata?.reason ?? '';
    if (status === 'OFFLINE') applyPresence({ state: 'OFFLINE' });
    systemModel?.updateRuntimeStatus(status);
    renderMicrophone();
    bridge.reportDiagnostic(
      'DOM_STATE',
      `state=${stateLabel.textContent} runtime=${runtimeStatus.textContent} microphone=${micToggle.textContent}`,
    );
  },
  onComponent(component) {
    if (!component?.component) return;
    components.set(component.component, component);
    systemModel?.updateComponent(component);
    renderComponents();
  },
  onSurface(snapshot) { surface?.applyNativeState(snapshot); },
  onCommandStatus(status) { commandCenter?.applyStatus(status); },
  onDiagnostic({ stage, detail }) {
    if (stage === 'ERROR') diagnosticStatus.dataset.error = 'true';
    if (stage === 'ERROR' || diagnosticStatus.dataset.error !== 'true') {
      diagnosticStatus.textContent = `${stage}: ${detail}`;
      diagnosticStatus.title = detail;
    }
  },
  onError({ stage, error }) { renderBridgeError(stage, error); },
});

surface = new SurfaceController(bridge);
systemModel = new SystemModel(bridge);
focusService = new FocusService(bridge);
captureService = new CaptureService(bridge);
commandCenter = new CommandCenterModel(bridge);

function renderSurface(snapshot) {
  const control = snapshot.mode === INTERACTION_MODES.CONTROL;
  const activeModule = normalizeModuleId(snapshot.activeModule) ?? MODULE_IDS.COMMAND_CENTER;
  document.body.dataset.interaction = control ? 'control' : 'ambient';
  document.body.dataset.module = activeModule.toLowerCase();
  panel.hidden = !control;
  for (const button of moduleRail.querySelectorAll('button')) {
    const selected = button.dataset.module === activeModule;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  }
  for (const view of document.querySelectorAll('[data-module-view]')) {
    view.hidden = view.dataset.moduleView !== activeModule;
  }
  activeModuleLabel.textContent = listModules().find(({ id }) => id === activeModule)?.label ?? activeModule;
  systemModel.updateSurface(snapshot);
  if (control) focusModuleField(activeModule);
}

function focusModuleField(moduleId) {
  const target = {
    [MODULE_IDS.COMMAND_CENTER]: commandInput,
    [MODULE_IDS.FOCUS]: focusTask,
    [MODULE_IDS.CAPTURE]: captureInput,
  }[moduleId];
  if (!target || target.disabled) return;
  requestAnimationFrame(() => {
    target.focus({ preventScroll: true });
    bridge?.reportDiagnostic(
      moduleId === MODULE_IDS.COMMAND_CENTER ? 'COMMAND_FOCUS' : 'MODULE_FOCUS',
      `activeElement=${document.activeElement?.id || document.activeElement?.tagName || 'missing'}`,
    );
  });
}

surface.subscribe(renderSurface);

commandCenter.subscribe((entries) => {
  commandHistory.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    const command = document.createElement('strong');
    const status = document.createElement('span');
    const metadata = document.createElement('small');
    command.textContent = entry.text;
    status.textContent = entry.status;
    status.dataset.status = entry.status;
    metadata.textContent = `${entry.commandId}${entry.errorCode ? ` · ${entry.errorCode}` : ''}`;
    heading.append(command, status);
    item.append(heading, metadata);
    commandHistory.append(item);
  }
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Noch kein Desktop-Befehl in dieser Sitzung.';
    commandHistory.append(empty);
  }
});

function displaySystemValue(value) {
  if (value === null || value === undefined || value === '') return 'NICHT GEMELDET';
  return String(value);
}

systemModel.subscribe((snapshot) => {
  componentStatus.textContent = `Core ${snapshot.coreStatus} · Voice ${snapshot.voiceStatus}`;
  for (const element of document.querySelectorAll('[data-system-value]')) {
    const key = element.dataset.systemValue;
    if (key === 'lastCoreMessageAt') {
      element.textContent = snapshot.lastCoreMessageAt === null
        ? 'NICHT GEMELDET'
        : new Date(snapshot.lastCoreMessageAt).toLocaleString('de-DE');
      element.title = snapshot.lastCoreMessageAt === null ? '' : new Date(snapshot.lastCoreMessageAt).toISOString();
    } else {
      element.textContent = displaySystemValue(snapshot[key]);
    }
  }
  const freshness = $('#system-freshness');
  freshness.textContent = snapshot.stale === true ? 'STALE' : snapshot.stale === false ? 'LIVE' : 'UNKNOWN';
  freshness.dataset.status = freshness.textContent;
});

function formatRemaining(durationMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(durationMs) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

focusService.subscribe((focus) => {
  $('#focus-clock').textContent = formatRemaining(focus.remainingMs);
  $('#focus-status').textContent = focus.status;
  if (document.activeElement !== focusTask) focusTask.value = focus.task;
  const active = focus.status === FOCUS_STATUS.RUNNING || focus.status === FOCUS_STATUS.PAUSED;
  focusTask.disabled = active;
  focusDuration.disabled = active;
  $('#focus-start').disabled = active;
  $('#focus-pause').disabled = focus.status !== FOCUS_STATUS.RUNNING;
  $('#focus-resume').disabled = focus.status !== FOCUS_STATUS.PAUSED;
  $('#focus-complete').disabled = !active;
  $('#focus-reset').disabled = focus.status === FOCUS_STATUS.IDLE && !focus.task;
});

captureService.subscribe((entries) => {
  const list = $('#capture-list');
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement('li');
    const text = document.createElement('p');
    const footer = document.createElement('div');
    const timestamp = document.createElement('time');
    const remove = document.createElement('button');
    text.textContent = entry.text;
    timestamp.dateTime = new Date(entry.createdAt).toISOString();
    timestamp.textContent = new Date(entry.createdAt).toLocaleString('de-DE');
    remove.type = 'button';
    remove.textContent = 'Löschen';
    remove.dataset.captureDelete = entry.id;
    footer.append(timestamp, remove);
    item.append(text, footer);
    list.append(item);
  }
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Noch keine lokalen Captures.';
    list.append(empty);
  }
});

async function invokeUi(stage, selector, operation) {
  setInlineError(selector);
  try {
    return await operation();
  } catch (error) {
    reportUiError(stage, error, selector);
    return null;
  }
}

moduleRail.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-module]');
  if (!button) return;
  void invokeUi('desktop.module.open', '#command-error', () => surface.openModule(button.dataset.module));
});

releaseOverlay.addEventListener('click', () => {
  void invokeUi('desktop.surface.escape', '#command-error', () => surface.escape());
});

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat) return;
  if (event.key === 'Escape' && surface.getState().mode === INTERACTION_MODES.CONTROL) {
    event.preventDefault();
    void invokeUi('desktop.surface.escape', '#command-error', () => surface.escape());
    return;
  }
  const moduleId = moduleIdForKeyboardEvent(event);
  if (!moduleId) return;
  event.preventDefault();
  const focusCommand = event.ctrlKey && String(event.key ?? '').toLowerCase() === 'k';
  void invokeUi('desktop.module.shortcut', '#command-error', async () => {
    const snapshot = await surface.openModule(moduleId);
    if (focusCommand) focusModuleField(MODULE_IDS.COMMAND_CENTER);
    return snapshot;
  });
});

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = commandInput.value;
  const result = await invokeUi('desktop.command.submit', '#command-error', () => commandCenter.submit(text));
  if (result) commandInput.value = '';
});

systemRefresh.addEventListener('click', () => {
  void refreshSystem();
});

focusForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await invokeUi('focus.start', '#focus-error', () => focusService.start({
    task: focusTask.value,
    durationMs: Number(focusDuration.value) * 60_000,
  }));
});

$('#focus-pause').addEventListener('click', () => void invokeUi('focus.pause', '#focus-error', () => focusService.pause()));
$('#focus-resume').addEventListener('click', () => void invokeUi('focus.resume', '#focus-error', () => focusService.resume()));
$('#focus-complete').addEventListener('click', () => void invokeUi('focus.complete', '#focus-error', () => focusService.complete()));
$('#focus-reset').addEventListener('click', () => void invokeUi('focus.reset', '#focus-error', () => focusService.reset()));

captureInput.addEventListener('input', () => {
  $('#capture-count').textContent = `${captureInput.value.length} / ${MAX_CAPTURE_TEXT_LENGTH}`;
});

captureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const entry = await invokeUi('capture.add', '#capture-error', () => captureService.add(captureInput.value));
  if (entry) {
    captureInput.value = '';
    $('#capture-count').textContent = `0 / ${MAX_CAPTURE_TEXT_LENGTH}`;
  }
});

$('#capture-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-capture-delete]');
  if (!button) return;
  void invokeUi('capture.delete', '#capture-error', () => captureService.delete(button.dataset.captureDelete));
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
    renderBridgeError('main.microphone', error);
  }
});

window.__birdieSetInteractionMode = (enabled) => {
  const control = Boolean(enabled);
  document.body.dataset.interaction = control ? 'control' : 'ambient';
  panel.hidden = !control;
};
window.__birdieRequestControlMode = () => {
  void invokeUi('desktop.surface.control', '#command-error', () => surface.setInteractionMode(true));
};

if (import.meta.env.DEV) {
  window.__birdiePreview = ({ state = 'IDLE', input = 0, output = 0, vad = 0 } = {}) => {
    applyPresence({ state });
    field.setInputAudio({ level: input, vadProbability: vad });
    field.setOutputAudio({ level: output });
  };
}

bridge.reportDiagnostic('DESKTOP_FRONTEND', `buildId=${frontendBuildId} location=${window.location.href}`);
field.start();

bridge.connect()
  .then(async () => {
    const initializers = [
      ['surface.initialize', '#command-error', () => surface.initialize()],
      ['system.load', '#system-error', () => refreshSystem()],
      ['focus.load', '#focus-error', () => focusService.load()],
      ['capture.load', '#capture-error', () => captureService.load()],
    ];
    await Promise.all(initializers.map(([stage, selector, operation]) => invokeUi(stage, selector, operation)));
  })
  .catch((error) => renderBridgeError('main.connect', error));

const focusClock = setInterval(() => void invokeUi('focus.tick', '#focus-error', () => focusService.tick()), 1_000);
let systemRefreshInFlight = false;
async function refreshSystem() {
  if (systemRefreshInFlight) return;
  systemRefreshInFlight = true;
  try {
    await invokeUi('system.refresh', '#system-error', () => systemModel.refresh());
  } finally {
    systemRefreshInFlight = false;
  }
}
const systemClock = setInterval(() => {
  systemModel.notifyClockChanged();
  void refreshSystem();
}, 1_000);

window.addEventListener('beforeunload', () => {
  clearInterval(focusClock);
  clearInterval(systemClock);
  clearTimeout(microphoneTimeout);
  commandCenter.dispose();
  bridge.dispose();
  if (surface.getState().mode === INTERACTION_MODES.CONTROL) void bridge.setInteractionMode(false);
  field.dispose();
}, { once: true });
