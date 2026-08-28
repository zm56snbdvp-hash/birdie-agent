import test from "node:test";
import assert from "node:assert/strict";
import { routeWatchRequest } from "../src/watch-router.mjs";

function harness({
  method,
  path,
  body = {},
  mailService = {},
  handleChat = async () => ({}),
  dayPilotProvider = async () => ({})
}) {
  let result;
  const req = { method };
  const res = {};
  const url = new URL(`https://birdie.local${path}`);
  const json = (_res, status, payload) => { result = { status, payload }; };
  const readBody = async () => body;
  return {
    invoke: async () => {
      const handled = await routeWatchRequest({
        req,
        res,
        url,
        json,
        readBody,
        mailService,
        handleChat,
        dayPilotProvider
      });
      return { handled, result };
    }
  };
}

test("day pilot returns a bounded read-only snapshot contract", async () => {
  const { handled, result } = await harness({
    method: "GET",
    path: "/watch/day-pilot/v1",
    dayPilotProvider: async () => ({
      generatedAt: "2026-08-28T08:00:00Z",
      nextTask: { taskId: "task-1", task: "Angebot prüfen", dueAt: "2026-08-28T09:30:00Z" },
      briefing: "Ein Termin steht an.",
      openApprovals: [
        { approvalId: "approval-1", title: "Mail prüfen", detail: "Vor dem Senden ansehen" },
        { approvalId: "bad", title: "", detail: "wird verworfen" }
      ]
    })
  }).invoke();

  assert.equal(handled, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.data, {
    contractVersion: 1,
    generatedAt: "2026-08-28T08:00:00.000Z",
    nextTask: { id: "task-1", title: "Angebot prüfen", dueAt: "2026-08-28T09:30:00.000Z" },
    briefing: "Ein Termin steht an.",
    openApprovals: [{ id: "approval-1", title: "Mail prüfen", detail: "Vor dem Senden ansehen" }]
  });
});

test("day pilot rejects malformed provider timestamps", async () => {
  await assert.rejects(
    () => harness({
      method: "GET",
      path: "/watch/day-pilot/v1",
      dayPilotProvider: async () => ({ generatedAt: "not-a-date" })
    }).invoke(),
    (error) => error.code === "INVALID_DAY_PILOT_SNAPSHOT" && error.status === 502
  );
});

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
