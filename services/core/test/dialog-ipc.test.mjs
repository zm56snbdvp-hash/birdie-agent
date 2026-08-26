import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DataClassification,
  IpcRole,
} from '../../../packages/protocol/src/contract.mjs';
import { DevelopmentAcknowledgementBrain } from '../src/brain.mjs';
import { BirdieIpcServer } from '../src/ipc-server.mjs';
import { connectIpcClient } from './helpers/ipc-client.mjs';

function pipeName(label) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\birdie-dialog-${label}-${process.pid}-${Date.now()}`;
  }
  return path.join(
    os.tmpdir(),
    `birdie-dialog-${label}-${process.pid}-${Date.now()}.sock`,
  );
}

function event(name, sequence, {
  turnId = null,
  payload = {},
  dataClassification = DataClassification.OPERATIONAL,
} = {}) {
  return {
    contract_version: '1.0',
    kind: 'event',
    name,
    event_id: `dialog-${sequence}-${name}`,
    source: 'birdie-voice-dialog-test',
    timestamp_utc: new Date(
      Date.UTC(2026, 7, 26, 12, 0, 0, sequence),
    ).toISOString(),
    monotonic_ms: sequence,
    source_sequence: sequence,
    trace_id: 'trace-dialog-ipc',
    session_id: 'session-dialog-ipc',
    turn_id: turnId,
    data_classification: dataClassification,
    payload,
  };
}

async function withServer(label, callback) {
  const name = pipeName(label);
  if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  const server = new BirdieIpcServer({
    pipeName: name,
    brain: new DevelopmentAcknowledgementBrain(),
  });
  await server.start();
  try {
    await callback(server, name);
  } finally {
    await server.stop();
    if (process.platform !== 'win32' && fs.existsSync(name)) fs.unlinkSync(name);
  }
}

function publish(client, requestId, payload) {
  client.send({
    type: 'runtime.event.publish',
    requestId,
    payload,
  });
}

test('classified transcript becomes a Voice output and completes Presence', async () => {
  await withServer('success', async (_server, name) => {
    const observer = await connectIpcClient(name, {
      role: IpcRole.OBSERVER,
      component: 'dialog-observer',
    });
    const voice = await connectIpcClient(name, {
      role: IpcRole.VOICE,
      component: 'dialog-voice',
    });

    try {
      publish(voice, 'ready', event('component.ready', 1));
      publish(voice, 'activity', event('voice.activity.started', 2));
      publish(voice, 'accepted', event('voice.activation.accepted', 3, {
        turnId: 'turn-dialog-ipc',
        payload: {
          turn_id: 'turn-dialog-ipc',
          activation_mode: 'WAKE_ON_SPEAK',
        },
      }));
      publish(voice, 'captured', event('voice.utterance.captured', 4, {
        turnId: 'turn-dialog-ipc',
        payload: {
          activity_id: 'activity-dialog-ipc',
          utterance_id: 'utterance-dialog-ipc',
          duration_ms: 900,
        },
      }));
      publish(voice, 'finalized', event('voice.utterance.finalized', 5, {
        turnId: 'turn-dialog-ipc',
        dataClassification: DataClassification.CONTENT,
        payload: {
          activity_id: 'activity-dialog-ipc',
          utterance_id: 'utterance-dialog-ipc',
          transcript: 'Birdie, bist du da?',
          language: 'de-DE',
          confidence: 0.94,
        },
      }));

      const command = await voice.waitFor(
        (message) =>
          message.type === 'voice.command' &&
          message.payload?.name === 'voice.output.play',
        3_000,
      );
      assert.equal(command.payload.turn_id, 'turn-dialog-ipc');
      assert.equal(
        command.payload.text,
        'Ich bin da. Der lokale Birdie Dialogpfad funktioniert.',
      );
      assert.equal(command.payload.language, 'de-DE');
      assert.equal(
        command.payload.data_classification,
        DataClassification.CONTENT,
      );
      assert.ok(command.payload.output_id.startsWith('output-turn-dialog-ipc-'));

      publish(voice, 'output-started', event('voice.output.started', 6, {
        turnId: 'turn-dialog-ipc',
        payload: { output_id: command.payload.output_id },
      }));
      const speaking = await observer.waitFor(
        (message) =>
          message.type === 'runtime.presence.changed' &&
          message.payload?.state === 'SPEAKING',
      );
      assert.equal(speaking.payload.activeTurnId, 'turn-dialog-ipc');

      publish(voice, 'output-completed', event('voice.output.completed', 7, {
        turnId: 'turn-dialog-ipc',
        payload: { output_id: command.payload.output_id },
      }));
      const idle = await observer.waitFor(
        (message) =>
          message.type === 'runtime.presence.changed' &&
          message.payload?.state === 'IDLE' &&
          message.payload?.reason === 'voice.output.completed',
      );
      assert.equal(idle.payload.activeTurnId, null);

      const observerSerialization = JSON.stringify(observer.messages);
      assert.equal(
        observerSerialization.includes('Birdie, bist du da?'),
        false,
        'observer must never receive the user transcript',
      );
      assert.equal(
        observerSerialization.includes('Der lokale Birdie Dialogpfad'),
        false,
        'observer must never receive Brain response text',
      );
    } finally {
      observer.socket.destroy();
      voice.socket.destroy();
    }
  });
});

test('transcript content with operational classification is rejected', async () => {
  await withServer('classification', async (_server, name) => {
    const voice = await connectIpcClient(name, {
      role: IpcRole.VOICE,
      component: 'classification-voice',
    });

    try {
      publish(voice, 'bad-classification', event(
        'voice.utterance.finalized',
        1,
        {
          turnId: 'turn-bad-classification',
          dataClassification: DataClassification.OPERATIONAL,
          payload: {
            transcript: 'This must not be telemetry.',
            language: 'en',
          },
        },
      ));

      const error = await voice.waitFor(
        (message) => message.requestId === 'bad-classification',
      );
      assert.equal(error.type, 'error');
      assert.equal(
        error.error,
        'CONTRACT.CONTENT_CLASSIFICATION_REQUIRED',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        voice.messages.some(
          (message) =>
            message.type === 'voice.command' &&
            message.payload?.name === 'voice.output.play',
        ),
        false,
      );
    } finally {
      voice.socket.destroy();
    }
  });
});
