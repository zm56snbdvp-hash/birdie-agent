import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHA_WATCHDOGS_MS, watchdogForPresence } from '../src/watchdogs.mjs';

test('alpha watchdogs match frozen QA budgets', () => {
  assert.equal(watchdogForPresence('SPEECH_DETECTED'), 2_000);
  assert.equal(watchdogForPresence('LISTENING'), 20_000);
  assert.equal(watchdogForPresence('THINKING'), 30_000);
  assert.equal(watchdogForPresence('SPEAKING'), 90_000);
  assert.equal(watchdogForPresence('IDLE'), null);
  assert.equal(ALPHA_WATCHDOGS_MS.RUNTIME_HEARTBEAT, 5_000);
});
