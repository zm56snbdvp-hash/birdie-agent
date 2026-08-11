import assert from "node:assert/strict";
import test from "node:test";
import { simpleParser } from "mailparser";
import {
  appendBirdieSignature,
  compileOutgoingMessage,
  selectSentMailbox
} from "../src/mail-service.mjs";

test("Birdie signature is appended to plain text and HTML", () => {
  const result = appendBirdieSignature({
    text: "Herzliche Grüße",
    html: "<p>Herzliche Grüße</p>"
  });

  assert.match(result.text, /Kevin Stroop/);
  assert.match(result.text, /Founder \| Birdie & Breakfast/);
  assert.match(result.text, /www\.birdieandbreakfast\.de/);
  assert.match(result.html, /Kevin Stroop/);
  assert.match(result.html, /Founder \| Birdie &amp; Breakfast/);
});

test("Birdie signature is not duplicated", () => {
  const signed = "Viele Grüße\n\nKevin Stroop\nFounder | Birdie & Breakfast\nwww.birdieandbreakfast.de";
  const result = appendBirdieSignature({ text: signed });
  assert.equal(result.text, signed);
});

test("special-use Sent mailbox is preferred", () => {
  const folders = [
    { path: "Sent", specialUse: "" },
    { path: "Gesendete Objekte", specialUse: "\\Sent" }
  ];
  assert.equal(selectSentMailbox(folders), "Gesendete Objekte");
});

test("localized Sent mailbox is used as fallback", () => {
  const folders = [{ path: "Gesendete Objekte", specialUse: "" }];
  assert.equal(selectSentMailbox(folders), "Gesendete Objekte");
});

test("outgoing message compiles to a reusable MIME buffer", async () => {
  const signed = appendBirdieSignature({ text: "Herzliche Grüße" });
  const outgoing = await compileOutgoingMessage({
    from: { name: "Birdie & Breakfast", address: "kevin@birdiebites.de" },
    to: ["supplier@example.com"],
    subject: "Production approval",
    text: signed.text
  });
  const parsed = await simpleParser(outgoing.message);

  assert.ok(Buffer.isBuffer(outgoing.message));
  assert.equal(parsed.subject, "Production approval");
  assert.match(parsed.text, /Kevin Stroop/);
  assert.deepEqual(outgoing.envelope.to, ["supplier@example.com"]);
});
