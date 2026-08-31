import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrainStatus,
  DevelopmentAcknowledgementBrain,
  DisabledBrain,
  createBrainFromEnvironment,
} from '../src/brain.mjs';

test('disabled Brain fails closed without response text', async () => {
  const result = await new DisabledBrain().respond({
    turnId: 'turn-disabled',
    transcript: 'private user content',
    language: 'de',
  });

  assert.equal(result.status, BrainStatus.UNAVAILABLE);
  assert.equal(result.text, '');
  assert.equal(result.errorCode, 'BRAIN.PROVIDER.UNAVAILABLE');
});

test('development acknowledgement never repeats user content', async () => {
  const secret = 'Meine geheime Kontonummer ist 123456';
  const result = await new DevelopmentAcknowledgementBrain().respond({
    turnId: 'turn-dev',
    transcript: secret,
    language: 'de-DE',
  });

  assert.equal(result.status, BrainStatus.COMPLETED);
  assert.equal(
    result.text,
    'Ich bin da. Der lokale Birdie Dialogpfad funktioniert.',
  );
  assert.equal(result.text.includes(secret), false);
  assert.equal(result.provider, 'development-ack');
});

test('development acknowledgement rejects invalid requests', async () => {
  const result = await new DevelopmentAcknowledgementBrain().respond({
    turnId: 'turn-invalid',
    transcript: '   ',
    language: 'de',
  });
  assert.equal(result.status, BrainStatus.FAILED);
  assert.equal(result.errorCode, 'BRAIN.REQUEST.INVALID');
});

test('Brain selection is disabled unless explicitly requested', () => {
  const defaultSelection = createBrainFromEnvironment({});
  assert.equal(defaultSelection.provider, 'disabled');
  assert.equal(defaultSelection.status, 'UNAVAILABLE');

  const development = createBrainFromEnvironment({
    BIRDIE_BRAIN_PROVIDER: 'development-ack',
  });
  assert.equal(development.provider, 'development-ack');
  assert.equal(development.status, 'READY');

  const unknown = createBrainFromEnvironment({
    BIRDIE_BRAIN_PROVIDER: 'mystery-provider',
  });
  assert.equal(unknown.provider, 'disabled');
  assert.equal(unknown.errorCode, 'BRAIN.PROVIDER.UNKNOWN');
});
