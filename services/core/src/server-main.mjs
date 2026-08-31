import { createBrainFromEnvironment } from './brain.mjs';
import { BirdieIpcServer } from './ipc-server.mjs';

const brainSelection = createBrainFromEnvironment(process.env);
const server = new BirdieIpcServer({
  brain: brainSelection.status === 'READY'
    ? brainSelection.brain
    : null,
});

async function shutdown(signal) {
  try {
    await server.stop();
  } finally {
    process.exit(signal === 'SIGINT' ? 130 : 0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await server.start();
console.log('Birdie Core listening on \\.\\pipe\\birdie.core.control.v1');
console.log(
  `Birdie Brain provider=${brainSelection.provider} ` +
  `status=${brainSelection.status}` +
  (brainSelection.errorCode ? ` error=${brainSelection.errorCode}` : ''),
);
