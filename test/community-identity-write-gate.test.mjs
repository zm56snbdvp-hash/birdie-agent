import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const gateSource = await readFile(
  new URL('../birdie-os/community-identity-write-gate.gs', import.meta.url),
  'utf8'
);

function loadGate(properties = {}) {
  const context = {
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
  vm.createContext(context);
  vm.runInContext(gateSource, context);
  return context.birdieCommunityIdentityNarrowWriteGateAllows_;
}

function exactRequest(overrides = {}) {
  const workItemId =
    overrides.workItemId || 'WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011';
  return {
    action: 'updateCommunityIdentityResolution',
    workItemId,
    resolverVersion: 'v1',
    idempotencyKey: `IDENTITY|${workItemId}|v1`,
    write: {
      processedBy: 'ZAPIER_IDENTITY_RESOLVER'
    },
    ...overrides
  };
}

const target = 'WORK-INSTAGRAM-TAGGED-MEDIA-17887962831440011';
const enabledProps = {
  BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: 'true',
  BIRDIE_IDENTITY_RESOLVER_WRITE_ITEM_ID: target
};

test('narrow identity write gate allows only the exact scoped resolver request', () => {
  const gate = loadGate(enabledProps);
  assert.equal(gate(exactRequest()), true);
});

test('narrow identity write gate remains closed when disabled', () => {
  const gate = loadGate({
    ...enabledProps,
    BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED: 'false'
  });
  assert.equal(gate(exactRequest()), false);
});

test('narrow identity write gate rejects another work item', () => {
  const gate = loadGate(enabledProps);
  assert.equal(
    gate(exactRequest({ workItemId: 'WORK-OTHER' })),
    false
  );
});

test('narrow identity write gate rejects non-resolver actions', () => {
  const gate = loadGate(enabledProps);
  assert.equal(gate(exactRequest({ action: 'coinCreateClaim' })), false);
});

test('narrow identity write gate rejects wrong resolver version', () => {
  const gate = loadGate(enabledProps);
  assert.equal(gate(exactRequest({ resolverVersion: 'v2' })), false);
});

test('narrow identity write gate rejects wrong idempotency key', () => {
  const gate = loadGate(enabledProps);
  assert.equal(gate(exactRequest({ idempotencyKey: 'wrong' })), false);
});

test('narrow identity write gate rejects wrong processor', () => {
  const gate = loadGate(enabledProps);
  const request = exactRequest();
  request.write = { processedBy: 'OTHER_PROCESSOR' };
  assert.equal(gate(request), false);
});
