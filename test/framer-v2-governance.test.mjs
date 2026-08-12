import test from "node:test";
import assert from "node:assert/strict";

import {
  getFramerCmsWritePolicy,
  getFramerCollectionWriteEligibility
} from "../src/framer-service.mjs";
import { routeFramerRequest } from "../src/framer-router.mjs";

test("Framer CMS writes are disabled when allowlist is empty", () => {
  const policy = getFramerCmsWritePolicy({ FRAMER_CMS_WRITE_ALLOWLIST: "" });
  assert.equal(policy.mode, "ALLOWLIST_ONLY");
  assert.equal(policy.writeEnabled, false);
  assert.deepEqual(policy.allowedCollections, []);
  assert.equal(policy.collectionOwnership, "USER_MANAGED_ONLY");
  assert.equal(policy.permissionModel, "FRAMER_ENFORCED_FAIL_CLOSED");
  assert.equal(policy.applyConfirmation, "APPLY_FRAMER_CMS_CHANGE");
  assert.equal(policy.previewConfirmation, "PUBLISH_FRAMER_PREVIEW");
  assert.equal(policy.productionConfirmation, "DEPLOY_FRAMER_PRODUCTION");
  assert.equal(policy.optimisticLock, "SHA256_ITEM_STATE");
});

test("Framer CMS allowlist is explicit and trimmed", () => {
  const policy = getFramerCmsWritePolicy({
    FRAMER_CMS_WRITE_ALLOWLIST: " Launch ,FAQ, collection-123 "
  });
  assert.equal(policy.writeEnabled, true);
  assert.deepEqual(policy.allowedCollections, ["Launch", "FAQ", "collection-123"]);
});

test("Framer CMS writes allow only explicitly allowlisted user-managed collections", () => {
  const env = { FRAMER_CMS_WRITE_ALLOWLIST: "Launch,collection-123" };

  assert.equal(
    getFramerCollectionWriteEligibility(
      { id: "collection-123", name: "Launch", managedBy: "user", readonly: false },
      env
    ).eligible,
    true
  );

  const anotherPlugin = getFramerCollectionWriteEligibility(
    { id: "collection-123", name: "Launch", managedBy: "anotherPlugin", readonly: false },
    env
  );
  assert.equal(anotherPlugin.eligible, false);
  assert.equal(anotherPlugin.code, "FRAMER_COLLECTION_NOT_USER_MANAGED");

  const missingOwner = getFramerCollectionWriteEligibility(
    { id: "collection-123", name: "Launch", readonly: false },
    env
  );
  assert.equal(missingOwner.eligible, false);
  assert.equal(missingOwner.code, "FRAMER_COLLECTION_NOT_USER_MANAGED");

  const readonly = getFramerCollectionWriteEligibility(
    { id: "collection-123", name: "Launch", managedBy: "user", readonly: true },
    env
  );
  assert.equal(readonly.eligible, false);
  assert.equal(readonly.code, "FRAMER_COLLECTION_READ_ONLY");

  const notAllowlisted = getFramerCollectionWriteEligibility(
    { id: "collection-999", name: "Blog", managedBy: "user", readonly: false },
    env
  );
  assert.equal(notAllowlisted.eligible, false);
  assert.equal(notAllowlisted.code, "FRAMER_COLLECTION_NOT_ALLOWED");
});

test("Framer CMS apply rejects without exact founder confirmation before any write", async () => {
  const req = { method: "POST" };
  const url = new URL("https://birdie.test/framer/cms/apply");
  const res = {};
  let jsonCalled = false;

  await assert.rejects(
    routeFramerRequest({
      req,
      res,
      url,
      json() {
        jsonCalled = true;
      },
      async readBody() {
        return {
          collectionId: "collection-123",
          itemId: "item-456",
          fieldData: { title: { value: "October" } },
          confirmation: "Go"
        };
      }
    }),
    (error) => {
      assert.equal(error.code, "FOUNDER_CONFIRMATION_REQUIRED");
      assert.equal(error.status, 403);
      assert.match(error.message, /APPLY_FRAMER_CMS_CHANGE/);
      return true;
    }
  );

  assert.equal(jsonCalled, false);
});

test("Framer config never exposes secrets", async () => {
  const originalProject = process.env.FRAMER_PROJECT_URL;
  const originalKey = process.env.FRAMER_API_KEY;
  process.env.FRAMER_PROJECT_URL = "https://framer.com/projects/test";
  process.env.FRAMER_API_KEY = "secret-test-key";

  try {
    let response;
    await routeFramerRequest({
      req: { method: "GET" },
      res: {},
      url: new URL("https://birdie.test/framer/config"),
      json(_res, status, body) {
        response = { status, body };
        return true;
      },
      async readBody() {
        return {};
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.configured, true);
    assert.equal(response.body.secretExposed, false);
    assert.equal(JSON.stringify(response).includes("secret-test-key"), false);
  } finally {
    if (originalProject === undefined) delete process.env.FRAMER_PROJECT_URL;
    else process.env.FRAMER_PROJECT_URL = originalProject;
    if (originalKey === undefined) delete process.env.FRAMER_API_KEY;
    else process.env.FRAMER_API_KEY = originalKey;
  }
});
