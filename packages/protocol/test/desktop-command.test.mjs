import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDesktopCommandEnvelope,
  validateDesktopCommandResult,
  validateDesktopIntentSubmission,
} from '../src/desktop-command.mjs';

function command(overrides = {}) {
  return {
    commandId: 'command-1234',
    name: 'desktop.module.open',
    args: { moduleId: 'SYSTEM' },
    issuedAtMs: 1_000,
    expiresAtMs: 6_000,
    target: { instanceId: 'desktop-instance', connectionId: 'connection-1234' },
    provenance: {
      origin: 'VOICE',
      sourceComponent: 'birdie-voice',
      sourceInstanceId: 'voice-session',
      sessionId: 'voice-session',
      eventId: 'event-1234',
      turnId: 'turn-1234',
      traceId: 'trace-1234',
    },
    ...overrides,
  };
}

test('desktop intent schema rejects extra keys, future clocks, and expired deadlines', () => {
  assert.equal(validateDesktopIntentSubmission({
    commandId: 'command-1234',
    text: 'System',
    issuedAtMs: 1_000,
    expiresAtMs: 2_000,
  }, { nowMs: 1_500 }).ok, true);
  assert.equal(validateDesktopIntentSubmission({
    commandId: 'command-1234', text: 'System', issuedAtMs: 1_000, expiresAtMs: 2_000, shell: true,
  }, { nowMs: 1_500 }).errorCode, 'DESKTOP.INTENT.SCHEMA_INVALID');
  assert.equal(validateDesktopIntentSubmission({
    commandId: 'command-1234', text: 'System', issuedAtMs: 7_000, expiresAtMs: 8_000,
  }, { nowMs: 1_000 }).errorCode, 'DESKTOP.COMMAND.FUTURE');
  assert.equal(validateDesktopIntentSubmission({
    commandId: 'command-1234', text: 'System', issuedAtMs: 1_000, expiresAtMs: 2_000,
  }, { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.EXPIRED');
});

test('desktop command schema is exact, typed, targeted, and time bounded', () => {
  assert.equal(validateDesktopCommandEnvelope(command(), { nowMs: 2_000 }).ok, true);
  assert.equal(validateDesktopCommandEnvelope(command({
    name: 'desktop.app.open',
    args: { appId: 'CALCULATOR' },
  }), { nowMs: 2_000 }).ok, true);
  assert.equal(validateDesktopCommandEnvelope(command({
    name: 'desktop.app.open',
    args: { appId: 'POWERSHELL_WITH_ARBITRARY_ARGS' },
  }), { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.ARGS_INVALID');
  assert.equal(validateDesktopCommandEnvelope(command({ args: { moduleId: 'SHELL' } }), { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.ARGS_INVALID');
  assert.equal(validateDesktopCommandEnvelope(command({ issuedAtMs: 8_000, expiresAtMs: 9_000 }), { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.FUTURE');
  assert.equal(validateDesktopCommandEnvelope({ ...command(), extra: true }, { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.SCHEMA_INVALID');
  const missingProvenance = command();
  delete missingProvenance.provenance.traceId;
  assert.equal(validateDesktopCommandEnvelope(missingProvenance, { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.PROVENANCE_INVALID');
});

test('desktop result schema correlates terminal status with error and rejects future time', () => {
  assert.equal(validateDesktopCommandResult({
    commandId: 'command-1234',
    connectionId: 'connection-1234',
    status: 'ACKNOWLEDGED',
    errorCode: null,
    completedAtMs: 2_000,
  }, { nowMs: 2_000 }).ok, true);
  assert.equal(validateDesktopCommandResult({
    commandId: 'command-1234',
    connectionId: 'connection-1234',
    status: 'FAILED',
    errorCode: null,
    completedAtMs: 2_000,
  }, { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.RESULT_ERROR_REQUIRED');
  assert.equal(validateDesktopCommandResult({
    commandId: 'command-1234',
    connectionId: 'connection-1234',
    status: 'ACKNOWLEDGED',
    errorCode: null,
    completedAtMs: 8_000,
  }, { nowMs: 2_000 }).errorCode, 'DESKTOP.COMMAND.RESULT_TIME_INVALID');
});
