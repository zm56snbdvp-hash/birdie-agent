export const MODULE_IDS = Object.freeze({
  COMMAND_CENTER: 'COMMAND_CENTER',
  SYSTEM: 'SYSTEM',
  FOCUS: 'FOCUS',
  CAPTURE: 'CAPTURE',
});

const DEFINITIONS = Object.freeze([
  Object.freeze({ id: MODULE_IDS.COMMAND_CENTER, label: 'Command Center', shortLabel: 'Command', shortcut: 'Ctrl+1', key: '1' }),
  Object.freeze({ id: MODULE_IDS.SYSTEM, label: 'System', shortLabel: 'System', shortcut: 'Ctrl+2', key: '2' }),
  Object.freeze({ id: MODULE_IDS.FOCUS, label: 'Focus', shortLabel: 'Focus', shortcut: 'Ctrl+3', key: '3' }),
  Object.freeze({ id: MODULE_IDS.CAPTURE, label: 'Capture', shortLabel: 'Capture', shortcut: 'Ctrl+4', key: '4' }),
]);

const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));
const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition.id]));

export function listModules() { return DEFINITIONS; }

export function normalizeModuleId(value) {
  const candidate = String(value ?? '').trim().toUpperCase();
  return BY_ID.has(candidate) ? candidate : null;
}

export function hasModule(value) { return normalizeModuleId(value) !== null; }

export function getModule(value) {
  const id = normalizeModuleId(value);
  return id ? BY_ID.get(id) : null;
}

export function moduleIdForKeyboardEvent(event) {
  if (!event?.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  const key = String(event.key ?? '').toLowerCase();
  if (key === 'k') return MODULE_IDS.COMMAND_CENTER;
  return BY_KEY.get(key) ?? null;
}
