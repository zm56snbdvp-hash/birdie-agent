import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../birdie-os/community-write-gate.gs", import.meta.url),
  "utf8"
);

const TARGET = "WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011";

function loadGate(properties = {}) {
  const sandbox = {
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            return Object.prototype.hasOwnProperty.call(properties, name)
              ? properties[name]
              : null;
          }
        };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "community-write-gate.gs" });
  return sandbox;
}

function validResolverRequest(overrides = {}) {
  return {
    action: "updateCommunityIdentityResolution",
    workItemId: TARGET,
    resolverVersion: "v1",
    idempotencyKey: `IDENTITY|${TARGET}|v1`,
    source: "Birdie Agent",
    ...overrides
  };
}

test("global write gate preserves existing controlled-write allowance", () => {
  const gate = loadGate({ BIRDIE_OS_WRITE_ENABLED: "true" });
  assert.equal(gate.birdieControlledWriteAllowed_({ action: "addIdea" }), true);
});

test("all writes remain disabled when neither global nor narrow gate is enabled", () => {
  const gate = loadGate();
  assert.equal(gate.birdieControlledWriteAllowed_(validResolverRequest()), false);
  assert.equal(gate.birdieControlledWriteAllowed_({ action: "addIdea" }), false);
});

test("narrow resolver gate allows only the exact configured work item", () => {
  const gate = loadGate({
    BIRDIE_OS_WRITE_ENABLED: "false",
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: "true",
    BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID: TARGET
  });

  assert.equal(gate.birdieControlledWriteAllowed_(validResolverRequest()), true);
  assert.equal(
    gate.birdieControlledWriteAllowed_(
      validResolverRequest({ workItemId: "WORK-SOMETHING-ELSE" })
    ),
    false
  );
});

test("narrow resolver gate cannot be used for another write action", () => {
  const gate = loadGate({
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: "true",
    BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID: TARGET
  });
  assert.equal(
    gate.birdieControlledWriteAllowed_({
      ...validResolverRequest(),
      action: "coinCreateProfile"
    }),
    false
  );
});

test("narrow resolver gate requires resolver v1 and the exact idempotency key", () => {
  const gate = loadGate({
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: "true",
    BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID: TARGET
  });

  assert.equal(
    gate.birdieControlledWriteAllowed_(
      validResolverRequest({ resolverVersion: "v2" })
    ),
    false
  );
  assert.equal(
    gate.birdieControlledWriteAllowed_(
      validResolverRequest({ idempotencyKey: "wrong-key" })
    ),
    false
  );
});

test("narrow resolver gate requires Birdie Agent source marker", () => {
  const gate = loadGate({
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: "true",
    BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID: TARGET
  });
  assert.equal(
    gate.birdieControlledWriteAllowed_(
      validResolverRequest({ source: "Something Else" })
    ),
    false
  );
});

test("narrow resolver gate fails closed without an exact configured target", () => {
  const gate = loadGate({
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: "true"
  });
  assert.equal(gate.birdieControlledWriteAllowed_(validResolverRequest()), false);
});

test("assert helper throws WRITE_DISABLED for a blocked request", () => {
  const gate = loadGate();
  assert.throws(
    () => gate.birdieAssertControlledWriteAllowed_(validResolverRequest()),
    /WRITE_DISABLED/
  );
});
