import {
  DataClassification,
  IpcMessageType,
  IpcRole,
  createEnvelope,
} from '../../packages/protocol/src/contract.mjs';
import { connectIpcClient } from '../../services/core/test/helpers/ipc-client.mjs';

const pipeName = String.raw`\\.\pipe\birdie.core.control.v1`;
const deadline = Date.now() + 15_000;
let client;

while (!client && Date.now() < deadline) {
  try {
    client = await connectIpcClient(pipeName, {
      role: IpcRole.VOICE,
      component: 'birdie-voice',
      instanceId: 'ready-runtime-fixture',
    });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

if (!client) throw new Error('ready runtime fixture could not connect to Core');

let sequence = 0;
function event(name, payload) {
  sequence += 1;
  return createEnvelope({
    name,
    eventId: `ready-runtime-fixture-${sequence}`,
    source: 'birdie-voice',
    monotonicMs: sequence,
    sourceSequence: sequence,
    traceId: 'ready-runtime-fixture',
    sessionId: 'ready-runtime-fixture',
    dataClassification: DataClassification.OPERATIONAL,
    payload,
  });
}

async function publish(requestId, payload) {
  client.send({
    type: IpcMessageType.RUNTIME_EVENT_PUBLISH,
    requestId,
    payload,
  });
  const reply = await client.waitFor(
    (message) =>
      message.requestId === requestId &&
      (message.type === IpcMessageType.RUNTIME_EVENT_ACK ||
        message.type === IpcMessageType.ERROR),
    5_000,
  );
  if (reply.type === IpcMessageType.ERROR) {
    throw new Error(`Core rejected ${requestId}: ${reply.error}`);
  }
}

await publish(
  'ready-runtime-component',
  event('component.ready', { component: 'birdie-voice' }),
);
await publish(
  'ready-runtime-microphone',
  event('voice.privacy.changed', { microphone_state: 'ENABLED' }),
);

console.log('READY_RUNTIME_FIXTURE presence=IDLE microphone=ENABLED');

await new Promise((resolve) => {
  process.once('SIGINT', resolve);
  process.once('SIGTERM', resolve);
});
client.socket.destroy();
