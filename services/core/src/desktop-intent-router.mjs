import { createHash } from 'node:crypto';
import { DesktopApp, DesktopCommandName } from '../../../packages/protocol/src/contract.mjs';

function normalized(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREFIX = '(?:birdie\\s+)?';
const OPEN = '(?:öffne|oeffne|zeig|zeige|open|show|starte|start)';
const OPTIONAL_ARTICLE = '(?:(?:mir|me)\\s+)?(?:(?:das|den|die|the)\\s+)?';

// This is deliberately an allowlist. Voice transcripts never become shell
// commands or executable paths; they can only select these known applications.
const ROUTES = Object.freeze([
  ['(?:browser|internet|chrome|firefox)', DesktopApp.BROWSER],
  ['(?:rechner|taschenrechner|calculator)', DesktopApp.CALCULATOR],
  ['(?:dateien|ordner|explorer|files?|file explorer)', DesktopApp.FILES],
  ['(?:notizblock|editor|notepad)', DesktopApp.NOTEPAD],
  ['(?:einstellungen|settings)', DesktopApp.SETTINGS],
  ['(?:terminal|powershell|konsole)', DesktopApp.TERMINAL],
].map(([target, appId]) => Object.freeze({
  expression: new RegExp(`^${PREFIX}${OPEN}\\s+${OPTIONAL_ARTICLE}${target}$`, 'u'),
  name: DesktopCommandName.APP_OPEN,
  args: Object.freeze({ appId }),
})));

const SHORT_COMMANDS = Object.freeze(new Map([
  ['browser', DesktopApp.BROWSER],
  ['rechner', DesktopApp.CALCULATOR],
  ['dateien', DesktopApp.FILES],
  ['notizblock', DesktopApp.NOTEPAD],
  ['einstellungen', DesktopApp.SETTINGS],
  ['terminal', DesktopApp.TERMINAL],
]));

export class DesktopIntentRouter {
  route(input, { allowShortCommands = false } = {}) {
    const text = normalized(input);
    if (!text) return Object.freeze({ matched: false, reason: 'EMPTY' });
    if (allowShortCommands && SHORT_COMMANDS.has(text)) {
      return Object.freeze({
        matched: true,
        name: DesktopCommandName.APP_OPEN,
        args: Object.freeze({ appId: SHORT_COMMANDS.get(text) }),
      });
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
