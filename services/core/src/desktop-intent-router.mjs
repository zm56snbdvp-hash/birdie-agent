import { createHash } from 'node:crypto';
import {
  DesktopCommandName,
  DesktopMode,
  DesktopModule,
} from '../../../packages/protocol/src/contract.mjs';

function normalized(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREFIX = '(?:birdie\\s+)?';
const OPEN = '(?:öffne|oeffne|zeig|zeige|open|show)';
const OPTIONAL_ARTICLE = '(?:(?:mir|me)\\s+)?(?:(?:das|den|die|the)\\s+)?';

const ROUTES = Object.freeze([
  {
    expression: new RegExp(`^${PREFIX}${OPEN}\\s+${OPTIONAL_ARTICLE}(?:command[ -]?center|kommandozentrale)$`, 'u'),
    name: DesktopCommandName.MODULE_OPEN,
    args: Object.freeze({ moduleId: DesktopModule.COMMAND_CENTER }),
  },
  {
    expression: new RegExp(`^${PREFIX}${OPEN}\\s+${OPTIONAL_ARTICLE}(?:system|systemstatus|system status)$`, 'u'),
    name: DesktopCommandName.MODULE_OPEN,
    args: Object.freeze({ moduleId: DesktopModule.SYSTEM }),
  },
  {
    expression: new RegExp(`^${PREFIX}(?:${OPEN}|starte|start)\\s+${OPTIONAL_ARTICLE}(?:fokus|focus)$`, 'u'),
    name: DesktopCommandName.MODULE_OPEN,
    args: Object.freeze({ moduleId: DesktopModule.FOCUS }),
  },
  {
    expression: new RegExp(`^${PREFIX}${OPEN}\\s+${OPTIONAL_ARTICLE}(?:capture|notizen|quick capture)$`, 'u'),
    name: DesktopCommandName.MODULE_OPEN,
    args: Object.freeze({ moduleId: DesktopModule.CAPTURE }),
  },
  {
    expression: new RegExp(`^${PREFIX}(?:geh|gehe|wechsel|go|switch)(?:\\s+bitte)?\\s+(?:(?:in|into|to)\\s+)?(?:(?:den|the)\\s+)?(?:hintergrund|background)$`, 'u'),
    name: DesktopCommandName.SURFACE_SET_MODE,
    args: Object.freeze({ mode: DesktopMode.AMBIENT }),
  },
  {
    expression: new RegExp(`^${PREFIX}(?:übernimm|uebernimm|take over|control)(?:\\s+bitte)?\\s+(?:(?:den|the)\\s+)?(?:bildschirm|screen)$`, 'u'),
    name: DesktopCommandName.SURFACE_SET_MODE,
    args: Object.freeze({ mode: DesktopMode.CONTROL }),
  },
]);

const SHORT_COMMANDS = Object.freeze(new Map([
  ['command center', [DesktopCommandName.MODULE_OPEN, { moduleId: DesktopModule.COMMAND_CENTER }]],
  ['system', [DesktopCommandName.MODULE_OPEN, { moduleId: DesktopModule.SYSTEM }]],
  ['focus', [DesktopCommandName.MODULE_OPEN, { moduleId: DesktopModule.FOCUS }]],
  ['fokus', [DesktopCommandName.MODULE_OPEN, { moduleId: DesktopModule.FOCUS }]],
  ['capture', [DesktopCommandName.MODULE_OPEN, { moduleId: DesktopModule.CAPTURE }]],
  ['ambient', [DesktopCommandName.SURFACE_SET_MODE, { mode: DesktopMode.AMBIENT }]],
  ['control', [DesktopCommandName.SURFACE_SET_MODE, { mode: DesktopMode.CONTROL }]],
]));

export class DesktopIntentRouter {
  route(input, { allowShortCommands = false } = {}) {
    const text = normalized(input);
    if (!text) return Object.freeze({ matched: false, reason: 'EMPTY' });
    if (allowShortCommands && SHORT_COMMANDS.has(text)) {
      const [name, args] = SHORT_COMMANDS.get(text);
      return Object.freeze({ matched: true, name, args: Object.freeze({ ...args }) });
    }
    const route = ROUTES.find(({ expression }) => expression.test(text));
    if (!route) return Object.freeze({ matched: false, reason: 'NO_MATCH' });
    return Object.freeze({ matched: true, name: route.name, args: route.args });
  }
}

export function voiceDesktopCommandId(event) {
  const identity = [
    event?.session_id ?? '',
    event?.event_id ?? '',
    event?.turn_id ?? '',
    event?.source_sequence ?? '',
  ].join('\u001f');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `desktop-voice-${digest}`;
}
