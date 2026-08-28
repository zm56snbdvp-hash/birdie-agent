import http from "node:http";
import { createMockPocketRelayBridge } from "./bridge.mjs";
import { POCKET_RELAY_API_PREFIX, PocketRelayProtocolError } from "./contract.mjs";
import { PocketRelaySecurity } from "./security.mjs";
import { PocketRelayService } from "./service.mjs";

const MAX_JSON_BODY_BYTES = 12 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw new PocketRelayProtocolError("REQUEST_TOO_LARGE", "request body exceeds mock-host limit", 413);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (!raw.length) throw new PocketRelayProtocolError("REQUEST_BODY_REQUIRED", "JSON request body is required");
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new PocketRelayProtocolError("REQUEST_JSON_INVALID", "request body is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PocketRelayProtocolError("REQUEST_JSON_INVALID", "request body must be a JSON object");
  }
  return value;
}

function errorPayload(error) {
  const isProtocolError = error instanceof PocketRelayProtocolError;
  return {
    success: false,
    error: {
      code: String(error?.code || "POCKET_RELAY_INTERNAL_ERROR"),
      message: isProtocolError
        ? String(error.message).slice(0, 300)
        : "Pocket Relay request failed without exposing host details."
    }
  };
}

export class PocketRelayMockHost {
  constructor({
    pairingCode,
    targetDevice,
    clock,
    security,
    bridge,
    service,
    killSwitch = false
  } = {}) {
    this.bridge = bridge ?? createMockPocketRelayBridge({ targetDevice, clock: clock ? () => new Date(clock()) : undefined });
    const describedTarget = this.bridge.describe().targetDevice;
    this.security = security ?? new PocketRelaySecurity({
      pairingCode,
      targetDevice: describedTarget,
      clock,
      killSwitch
    });
    this.service = service ?? new PocketRelayService({
      security: this.security,
      bridge: this.bridge,
      clock: clock ? () => new Date(clock()) : undefined
    });
    this.server = http.createServer((req, res) => {
      this.#handle(req, res).catch((error) => {
        const candidate = Number.isInteger(error?.status) ? error.status : 500;
        const status = candidate >= 400 && candidate <= 599 ? candidate : 500;
        sendJson(res, status, errorPayload(error));
      });
    });
  }

  async listen({ host = "127.0.0.1", port = 0 } = {}) {
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new PocketRelayProtocolError(
        "MOCK_HOST_LOOPBACK_ONLY",
        "Pocket Relay mock host may bind only to loopback",
        403
      );
    }
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    const hostname = host === "::1" ? "[::1]" : host;
    return { baseURL: `http://${hostname}:${address.port}`, address };
  }

  async close() {
    if (!this.server.listening) return;
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  revokeDevice(deviceId, reason) {
    return this.security.revokeDevice(deviceId, reason);
  }

  setKillSwitch(enabled) {
    this.security.setKillSwitch(enabled);
  }

  async #handle(req, res) {
    const url = new URL(req.url || "/", "http://pocket-relay.invalid");
    if (req.method === "GET" && url.pathname === `${POCKET_RELAY_API_PREFIX}/health`) {
      sendJson(res, 200, {
        success: true,
        version: "pocket-relay.mock-host.v1",
        mock: true,
        productionEffectsEnabled: false,
        targetDevice: this.bridge.describe().targetDevice
      });
      return;
    }

    if (req.method === "POST" && url.pathname === `${POCKET_RELAY_API_PREFIX}/pair`) {
      const result = this.security.pair(await readJson(req));
      sendJson(res, 201, { success: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === `${POCKET_RELAY_API_PREFIX}/token`) {
      const result = this.security.refreshToken(await readJson(req));
      sendJson(res, 200, { success: true, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === `${POCKET_RELAY_API_PREFIX}/commands`) {
      const body = await readJson(req);
      const verified = this.security.verifySignedCommand({
        authorization: req.headers.authorization,
        body
      });
      const result = await this.service.submit(verified);
      const status = result.success ? 200 : (result.error?.status ?? 500);
      sendJson(res, status, result);
      return;
    }

    sendJson(res, 404, errorPayload(new PocketRelayProtocolError("ROUTE_NOT_FOUND", "Pocket Relay mock route not found", 404)));
  }
}

export function createPocketRelayMockHost(options) {
  return new PocketRelayMockHost(options);
}
