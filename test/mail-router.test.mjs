import test from "node:test";
import assert from "node:assert/strict";
import { routeMailRequest } from "../src/mail-router.mjs";

function harness({ method, path, body = {} }) {
  let output;
  const service = {
    getMailHealth: async () => ({ access: "FULL_CONTROL_GOVERNED" }),
    listMailFolders: async () => [{ path: "INBOX" }],
    bootstrapBirdieFolders: async () => ({ created: ["Birdie OS"] }),
    listRecentMail: async (input) => [{ uid: 1, ...input }],
    getMessage: async (input) => ({ subject: "Hello", ...input }),
    getMessageAttachment: async (input) => ({ contentBase64: "QQ==", ...input }),
    updateMessageFlags: async (input) => input,
    moveMessage: async (input) => input,
    deleteMessage: async (input) => input,
    sendMail: async (input) => ({ messageId: "test", approved: input.founderApproved })
  };
  return {
    req: { method },
    res: {},
    url: new URL(path, "https://birdie.test"),
    json: (_res, status, payload) => { output = { status, payload }; },
    readBody: async () => body,
    service,
    result: () => output
  };
}

test("message detail route exposes governed full access", async () => {
  const h = harness({ method: "GET", path: "/mail/messages/284?mailbox=INBOX" });
  assert.equal(await routeMailRequest(h), true);
  assert.equal(h.result().status, 200);
  assert.equal(h.result().payload.readOnly, false);
  assert.equal(h.result().payload.governed, true);
  assert.equal(h.result().payload.data.uid, "284");
});

test("folder bootstrap route is available", async () => {
  const h = harness({ method: "POST", path: "/mail/folders/bootstrap" });
  assert.equal(await routeMailRequest(h), true);
  assert.deepEqual(h.result().payload.data.created, ["Birdie OS"]);
});

test("send route passes explicit founder approval to the service", async () => {
  const h = harness({
    method: "POST",
    path: "/mail/send",
    body: { founderApproved: true, confirmation: "SEND_EMAIL", to: "hello@example.com" }
  });
  assert.equal(await routeMailRequest(h), true);
  assert.equal(h.result().payload.founderApproved, true);
  assert.equal(h.result().payload.data.approved, true);
});

test("delete route forwards mode and approval payload", async () => {
  const h = harness({
    method: "DELETE",
    path: "/mail/messages/278",
    body: { mode: "trash", founderApproved: true, confirmation: "MOVE_TO_TRASH" }
  });
  assert.equal(await routeMailRequest(h), true);
  assert.equal(h.result().payload.data.uid, "278");
  assert.equal(h.result().payload.data.mode, "trash");
});

test("unmatched mail path remains available to the main router", async () => {
  const h = harness({ method: "GET", path: "/mail/unknown" });
  assert.equal(await routeMailRequest(h), false);
  assert.equal(h.result(), undefined);
});
