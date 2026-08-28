import {
  DesktopCommandName,
  DesktopCommandStatus,
  DesktopMode,
  DesktopModule,
  DesktopApp,
} from './contract.mjs';

export const DESKTOP_COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const DESKTOP_CONNECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const DESKTOP_COMMAND_MAX_LIFETIME_MS = 30_000;
export const DESKTOP_INTENT_MAX_TEXT_LENGTH = 500;

const MODULES = new Set(Object.values(DesktopModule));
const MODES = new Set(Object.values(DesktopMode));
const APPS = new Set(Object.values(DesktopApp));
const RESULT_STATUSES = new Set([
  DesktopCommandStatus.ACKNOWLEDGED,
  DesktopCommandStatus.REJECTED,
  DesktopCommandStatus.FAILED,
]);
const ORIGINS = new Set(['VOICE', 'COMMAND_CENTER']);

function fail(errorCode) { return Object.freeze({ ok: false, errorCode }); }
function pass(value) { return Object.freeze({ ok: true, value: Object.freeze(value) }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, expected) {
  if (!object(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function boundedString(value, maximum = 256, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : undefined;
}
function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function validateDesktopIntentSubmission(payload, { nowMs = Date.now() } = {}) {
  if (!exactKeys(payload, ['commandId', 'text', 'issuedAtMs', 'expiresAtMs'])) return fail('DESKTOP.INTENT.SCHEMA_INVALID');
  if (!DESKTOP_COMMAND_ID_PATTERN.test(String(payload.commandId ?? ''))) return fail('DESKTOP.COMMAND.ID_INVALID');
  const text = boundedString(payload.text, DESKTOP_INTENT_MAX_TEXT_LENGTH);
  if (!text) return fail('DESKTOP.INTENT.TEXT_INVALID');
  const issuedAtMs = timestamp(payload.issuedAtMs);
  const expiresAtMs = timestamp(payload.expiresAtMs);
  if (issuedAtMs === null || expiresAtMs === null || expiresAtMs <= issuedAtMs) return fail('DESKTOP.COMMAND.DEADLINE_INVALID');
  if (expiresAtMs - issuedAtMs > DESKTOP_COMMAND_MAX_LIFETIME_MS) return fail('DESKTOP.COMMAND.LIFETIME_INVALID');
  if (issuedAtMs > nowMs + 5_000) return fail('DESKTOP.COMMAND.FUTURE');
  if (expiresAtMs <= nowMs) return fail('DESKTOP.COMMAND.EXPIRED');
  return pass({ commandId: payload.commandId, text, issuedAtMs, expiresAtMs });
}

export function validateDesktopCommandEnvelope(payload, { nowMs = Date.now(), allowExpired = false } = {}) {
  if (!exactKeys(payload, ['commandId', 'name', 'args', 'issuedAtMs', 'expiresAtMs', 'target', 'provenance'])) return fail('DESKTOP.COMMAND.SCHEMA_INVALID');
  if (!DESKTOP_COMMAND_ID_PATTERN.test(String(payload.commandId ?? ''))) return fail('DESKTOP.COMMAND.ID_INVALID');
  const issuedAtMs = timestamp(payload.issuedAtMs);
  const expiresAtMs = timestamp(payload.expiresAtMs);
  if (issuedAtMs === null || expiresAtMs === null || expiresAtMs <= issuedAtMs) return fail('DESKTOP.COMMAND.DEADLINE_INVALID');
  if (expiresAtMs - issuedAtMs > DESKTOP_COMMAND_MAX_LIFETIME_MS) return fail('DESKTOP.COMMAND.LIFETIME_INVALID');
  if (issuedAtMs > nowMs + 5_000) return fail('DESKTOP.COMMAND.FUTURE');
  if (!allowExpired && expiresAtMs <= nowMs) return fail('DESKTOP.COMMAND.EXPIRED');
  if (!exactKeys(payload.target, ['instanceId', 'connectionId'])) return fail('DESKTOP.COMMAND.TARGET_INVALID');
  const instanceId = boundedString(payload.target.instanceId, 128);
  const connectionId = boundedString(payload.target.connectionId, 128);
  if (
    !instanceId ||
    !connectionId ||
    !DESKTOP_COMMAND_ID_PATTERN.test(instanceId) ||
    !DESKTOP_CONNECTION_ID_PATTERN.test(connectionId)
  ) return fail('DESKTOP.COMMAND.TARGET_INVALID');
  const provenanceKeys = ['origin', 'sourceComponent', 'sourceInstanceId', 'sessionId', 'eventId', 'turnId', 'traceId'];
  if (!exactKeys(payload.provenance, provenanceKeys)) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  const origin = boundedString(payload.provenance.origin, 32);
  if (!ORIGINS.has(origin)) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  const provenance = {
    origin,
    sourceComponent: boundedString(payload.provenance.sourceComponent, 128),
    sourceInstanceId: boundedString(payload.provenance.sourceInstanceId, 128),
    sessionId: boundedString(payload.provenance.sessionId, 256, { nullable: true }),
    eventId: boundedString(payload.provenance.eventId, 256, { nullable: true }),
    turnId: boundedString(payload.provenance.turnId, 256, { nullable: true }),
    traceId: boundedString(payload.provenance.traceId, 256, { nullable: true }),
  };
  if (!provenance.sourceComponent || !provenance.sourceInstanceId || Object.values(provenance).some((value) => value === undefined)) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  if (!DESKTOP_COMMAND_ID_PATTERN.test(provenance.sourceInstanceId)) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  if (
    origin === 'VOICE' &&
    (
      provenance.sourceComponent !== 'birdie-voice' ||
      provenance.sessionId === null ||
      provenance.eventId === null ||
      provenance.turnId === null ||
      provenance.traceId === null
    )
  ) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  if (
    origin === 'COMMAND_CENTER' &&
    (
      provenance.sourceComponent !== 'birdie-desktop' ||
      provenance.sessionId === null ||
      provenance.eventId !== null ||
      provenance.turnId !== null ||
      provenance.traceId !== null
    )
  ) return fail('DESKTOP.COMMAND.PROVENANCE_INVALID');
  let args;
  if (payload.name === DesktopCommandName.MODULE_OPEN) {
    if (!exactKeys(payload.args, ['moduleId']) || !MODULES.has(payload.args.moduleId)) return fail('DESKTOP.COMMAND.ARGS_INVALID');
    args = { moduleId: payload.args.moduleId };
  } else if (payload.name === DesktopCommandName.SURFACE_SET_MODE) {
    if (!exactKeys(payload.args, ['mode']) || !MODES.has(payload.args.mode)) return fail('DESKTOP.COMMAND.ARGS_INVALID');
    args = { mode: payload.args.mode };
  } else if (payload.name === DesktopCommandName.APP_OPEN) {
    if (!exactKeys(payload.args, ['appId']) || !APPS.has(payload.args.appId)) return fail('DESKTOP.COMMAND.ARGS_INVALID');
    args = { appId: payload.args.appId };
  } else {
    return fail('DESKTOP.COMMAND.UNKNOWN');
  }
  return pass({
    commandId: payload.commandId,
    name: payload.name,
    args: Object.freeze(args),
    issuedAtMs,
    expiresAtMs,
    target: Object.freeze({ instanceId, connectionId }),
    provenance: Object.freeze(provenance),
  });
}

export function validateDesktopCommandResult(payload, { nowMs = Date.now() } = {}) {
  if (!exactKeys(payload, ['commandId', 'connectionId', 'status', 'errorCode', 'completedAtMs'])) return fail('DESKTOP.COMMAND.RESULT_SCHEMA_INVALID');
  if (!DESKTOP_COMMAND_ID_PATTERN.test(String(payload.commandId ?? ''))) return fail('DESKTOP.COMMAND.ID_INVALID');
  if (!DESKTOP_CONNECTION_ID_PATTERN.test(String(payload.connectionId ?? ''))) return fail('DESKTOP.COMMAND.CONNECTION_INVALID');
  if (!RESULT_STATUSES.has(payload.status)) return fail('DESKTOP.COMMAND.RESULT_STATUS_INVALID');
  const completedAtMs = timestamp(payload.completedAtMs);
  if (completedAtMs === null) return fail('DESKTOP.COMMAND.RESULT_TIME_INVALID');
  if (completedAtMs > nowMs + 5_000) return fail('DESKTOP.COMMAND.RESULT_TIME_INVALID');
  const errorCode = payload.errorCode === null ? null : boundedString(payload.errorCode, 128);
  if (errorCode === undefined) return fail('DESKTOP.COMMAND.RESULT_ERROR_INVALID');
  if (payload.status === DesktopCommandStatus.ACKNOWLEDGED && errorCode !== null) return fail('DESKTOP.COMMAND.RESULT_ERROR_INVALID');
  if (payload.status !== DesktopCommandStatus.ACKNOWLEDGED && errorCode === null) return fail('DESKTOP.COMMAND.RESULT_ERROR_REQUIRED');
  return pass({ commandId: payload.commandId, connectionId: payload.connectionId, status: payload.status, errorCode, completedAtMs });
}

export function desktopCommandFingerprint(command) {
  return JSON.stringify({
    name: command.name,
    args: command.args,
    issuedAtMs: command.issuedAtMs,
    expiresAtMs: command.expiresAtMs,
    targetInstanceId: command.target.instanceId,
    provenance: command.provenance,
  });
}
