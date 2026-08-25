import { BirdieIpcServer } from './ipc-server.mjs';

const server = new BirdieIpcServer();

async function shutdown(signal) {
  try { await server.stop(); } finally { process.exit(signal === 'SIGINT' ? 130 : 0); }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await server.start();
console.log('Birdie Core listening on \\.\\pipe\\birdie.core.control.v1');
