import { createPocketRelayMockHost } from "../../src/pocket-relay/mock-host.mjs";

const pairingCode = String(process.env.POCKET_RELAY_MOCK_PAIRING_CODE || "");
if (pairingCode.length < 8) {
  throw new Error("POCKET_RELAY_MOCK_PAIRING_CODE (minimum 8 characters) is required at runtime");
}

const parsedPort = Number.parseInt(process.env.POCKET_RELAY_MOCK_PORT || "8787", 10);
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65_535) {
  throw new Error("POCKET_RELAY_MOCK_PORT must be a valid TCP port");
}

const host = createPocketRelayMockHost({
  pairingCode,
  killSwitch: process.env.POCKET_RELAY_KILL_SWITCH === "1"
});
const { baseURL } = await host.listen({ host: "127.0.0.1", port: parsedPort });
process.stdout.write(`Pocket Relay v1 mock host listening on ${baseURL}; loopback only; production effects disabled.\n`);

async function shutdown() {
  await host.close();
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
