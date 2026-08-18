import test from "node:test";
import assert from "node:assert/strict";
import { routeWatchRequest } from "../src/watch-router.mjs";

function harness({ method, path, body = {}, mailService = {}, handleChat = async () => ({}) }) {
  let result;
  const req = { method };
  const res = {};
  const url = new URL(`https://birdie.local${path}`);
  const json = (_res, status, payload) => { result = { status, payload }; };
  const readBody = async () => body;
  return {
    invoke: async () => {
      const handled = await routeWatchRequest({ req, res, url, json, readBody, mailService, handleChat });
      return { handled, result };
    }
  };
}

test("watch briefing returns a compact unread inbox", async () => {
  const mailService = {
    async listRecentMail() {
      return [
        { uid: 41, subject: "Muster", from: "supplier@example.com", seen: false, preview: "Sample ready" },
        { uid: 42, subject: "Order", from: "shop@example.com", seen: false, preview: "New order" }
      ];
    }
  };
  const { handled, result } = await harness({ method: "GET", path: "/watch/briefing", mailService }).invoke();
  assert.equal(handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.unreadCount, 2);
  assert.equal(result.payload.data.inbox[0].uid, 41);
  assert.equal(result.payload.data.primaryAction, "READ_INBOX");
});

test("watch command forwards transcript to Birdie chat", async () => {
  let received;
  const handleChat = async (message) => {
    received = message;
    return { intent: "GENERAL", answer: "Alles klar.", authoritative: true, source: "OPENAI+BIRDIE_OS" };
  };
  const { result } = await harness({
    method: "POST",
    path: "/watch/command",
    body: { utterance: "Was ist heute wichtig?" },
    handleChat
  }).invoke();
  assert.equal(received, "Was ist heute wichtig?");
  assert.equal(result.payload.data.answer, "Alles klar.");
});

test("watch reply fails closed without founder SEND_EMAIL confirmation", async () => {
  const mailService = { sendMail: async () => { throw new Error("must not send"); } };
  await assert.rejects(
    () => harness({
      method: "POST",
      path: "/watch/mail/reply",
      body: { to: "a@example.com", subject: "Re: Test", text: "Hallo" },
      mailService
    }).invoke(),
    (error) => error.code === "FOUNDER_CONFIRMATION_REQUIRED" && error.status === 403
  );
});

test("watch reply sends only after exact founder confirmation", async () => {
  let sentPayload;
  const mailService = {
    async sendMail(payload) {
      sentPayload = payload;
      return { accepted: true };
    }
  };
  const { result } = await harness({
    method: "POST",
    path: "/watch/mail/reply",
    body: {
      to: "a@example.com",
      subject: "Re: Test",
      text: "Hallo",
      founderApproved: true,
      confirmation: "SEND_EMAIL"
    },
    mailService
  }).invoke();
  assert.equal(sentPayload.confirmation, "SEND_EMAIL");
  assert.equal(sentPayload.founderApproved, true);
  assert.equal(result.payload.action, "WATCH_MAIL_SEND");
});
