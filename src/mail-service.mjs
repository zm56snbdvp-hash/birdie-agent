import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import {
  buildBirdieFolderPaths,
  httpError,
  normalizeMailbox,
  normalizeUid,
  requireFounderApproval
} from "./mail-policy.mjs";

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_SIGNATURE_TEXT = [
  "Kevin Stroop",
  "Founder | Birdie & Breakfast",
  "www.birdieandbreakfast.de"
].join("\n");
const DEFAULT_SIGNATURE_HTML = [
  "<div>",
  "Kevin Stroop<br>",
  "Founder | Birdie &amp; Breakfast<br>",
  '<a href="https://www.birdieandbreakfast.de">www.birdieandbreakfast.de</a>',
  "</div>"
].join("");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw httpError("MAIL_NOT_CONFIGURED", 503, `${name} is missing.`);
  return value;
}

function getImapConfig() {
  return {
    host: process.env.MAIL_IMAP_HOST || "imap.ionos.de",
    port: Number(process.env.MAIL_IMAP_PORT || 993),
    secure: true,
    auth: { user: requireEnv("MAIL_USER"), pass: requireEnv("MAIL_PASSWORD") },
    logger: false
  };
}

function getSmtpConfig() {
  return {
    host: process.env.MAIL_SMTP_HOST || "smtp.ionos.de",
    port: Number(process.env.MAIL_SMTP_PORT || 465),
    secure: true,
    auth: { user: requireEnv("MAIL_USER"), pass: requireEnv("MAIL_PASSWORD") },
    tls: { minVersion: "TLSv1.2" }
  };
}

function audit(action, details = {}) {
  console.log(JSON.stringify({
    type: "BIRDIE_MAIL_ACTION",
    timestamp: new Date().toISOString(),
    action,
    ...details
  }));
}

function containsBirdieSignature(value = "") {
  const normalized = String(value).replace(/<[^>]+>/g, " ");
  return /Kevin\s+Stroop/i.test(normalized) && /Founder\s*\|\s*Birdie\s*(?:&|&amp;)\s*Breakfast/i.test(normalized);
}

export function appendBirdieSignature({ text = "", html } = {}) {
  const signatureText = process.env.MAIL_SIGNATURE_TEXT || DEFAULT_SIGNATURE_TEXT;
  const signatureHtml = process.env.MAIL_SIGNATURE_HTML || DEFAULT_SIGNATURE_HTML;
  const cleanText = String(text || "").trimEnd();
  const cleanHtml = html == null ? undefined : String(html).trimEnd();

  return {
    text: containsBirdieSignature(cleanText)
      ? cleanText
      : `${cleanText}${cleanText ? "\n\n" : ""}${signatureText}`,
    html: cleanHtml == null
      ? undefined
      : containsBirdieSignature(cleanHtml)
        ? cleanHtml
        : `${cleanHtml}${cleanHtml ? "<br><br>" : ""}${signatureHtml}`
  };
}

export function selectSentMailbox(folders = []) {
  return folders.find((folder) => folder.specialUse === "\\Sent")?.path
    || folders.find((folder) => /^(gesendete objekte|sent)$/i.test(folder.path || folder.name || ""))?.path
    || null;
}

export async function compileOutgoingMessage(options) {
  const compiler = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix"
  });
  const compiled = await compiler.sendMail(options);
  return {
    envelope: compiled.envelope,
    message: compiled.message,
    messageId: compiled.messageId
  };
}

async function archiveSentMessage(message) {
  return withClient(async (client) => {
    const folders = await client.list();
    const sentMailbox = selectSentMailbox(folders);
    if (!sentMailbox) throw httpError("SENT_MAILBOX_NOT_FOUND", 503);
    const appended = await client.append(sentMailbox, message, ["\\Seen"], new Date());
    return {
      saved: true,
      mailbox: sentMailbox,
      uid: appended?.uid ?? null
    };
  });
}

async function withClient(fn) {
  const client = new ImapFlow(getImapConfig());
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function withMailbox(mailbox, fn) {
  return withClient(async (client) => {
    const path = normalizeMailbox(mailbox);
    const lock = await client.getMailboxLock(path);
    try {
      return await fn(client, path);
    } finally {
      lock.release();
    }
  });
}

function addresses(value) {
  return (value?.value || []).map((item) => ({
    name: item.name || "",
    address: item.address || ""
  }));
}

function envelopeAddresses(value) {
  return (value || []).map((item) => ({
    name: item.name || "",
    address: item.address || ""
  }));
}

async function fetchParsedMessage(client, uid) {
  const safeUid = normalizeUid(uid);
  const message = await client.fetchOne(safeUid, {
    uid: true,
    envelope: true,
    flags: true,
    internalDate: true,
    source: true
  }, { uid: true });

  if (!message || !message.source) {
    throw httpError("MESSAGE_NOT_FOUND", 404, `Message UID ${safeUid} was not found`);
  }
  if (message.source.length > MAX_MESSAGE_BYTES) {
    throw httpError("MESSAGE_TOO_LARGE", 413, "Message exceeds the 25 MB parsing limit");
  }

  const parsed = await simpleParser(message.source, {
    skipImageLinks: true,
    keepCidLinks: true,
    maxHtmlLengthToParse: 2_000_000
  });
  return { message, parsed, uid: safeUid };
}

function normalizeRecipients(value, field) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  if (field === "to" && entries.length === 0) {
    throw httpError("RECIPIENT_REQUIRED", 400, "At least one recipient is required");
  }
  if (entries.length > 20) {
    throw httpError("TOO_MANY_RECIPIENTS", 400, `${field} supports at most 20 recipients`);
  }
  return entries.map((entry) => {
    const recipient = String(entry).trim();
    if (!recipient || recipient.length > 320 || /[\r\n\0]/.test(recipient)) {
      throw httpError("INVALID_RECIPIENT", 400, `${field} contains an invalid recipient`);
    }
    return recipient;
  });
}

export async function getMailHealth() {
  return withMailbox("INBOX", async (client) => ({
    provider: "IONOS",
    protocol: "IMAP+SMTP",
    imapHost: getImapConfig().host,
    smtpHost: getSmtpConfig().host,
    mailbox: "INBOX",
    authenticated: true,
    exists: client.mailbox?.exists ?? null,
    access: "FULL_CONTROL_GOVERNED",
    founderApprovalRequiredFor: ["SEND", "DELETE"]
  }));
}

export async function listRecentMail({ limit = 20, unreadOnly = false, mailbox = "INBOX" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  return withMailbox(mailbox, async (client, path) => {
    const exists = client.mailbox?.exists || 0;
    if (!exists) return [];

    const sequence = `${Math.max(1, exists - safeLimit * 3 + 1)}:*`;
    const messages = [];
    for await (const msg of client.fetch(sequence, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      bodyStructure: true
    })) {
      const flags = Array.from(msg.flags || []);
      if (unreadOnly && flags.includes("\\Seen")) continue;
      messages.push({
        uid: msg.uid,
        mailbox: path,
        subject: msg.envelope?.subject || "",
        from: envelopeAddresses(msg.envelope?.from),
        to: envelopeAddresses(msg.envelope?.to),
        date: msg.internalDate || msg.envelope?.date || null,
        read: flags.includes("\\Seen"),
        flagged: flags.includes("\\Flagged"),
        hasAttachments: Array.isArray(msg.bodyStructure?.childNodes)
          ? msg.bodyStructure.childNodes.some(
              (node) => String(node.disposition || "").toLowerCase() === "attachment"
            )
          : false
      });
    }

    return messages
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, safeLimit);
  });
}

export async function getMessage({ uid, mailbox = "INBOX" }) {
  return withMailbox(mailbox, async (client, path) => {
    const { message, parsed, uid: safeUid } = await fetchParsedMessage(client, uid);
    const flags = Array.from(message.flags || []);
    return {
      uid: safeUid,
      mailbox: path,
      messageId: parsed.messageId || "",
      subject: parsed.subject || message.envelope?.subject || "",
      from: addresses(parsed.from),
      to: addresses(parsed.to),
      cc: addresses(parsed.cc),
      replyTo: addresses(parsed.replyTo),
      date: parsed.date || message.internalDate || null,
      read: flags.includes("\\Seen"),
      flagged: flags.includes("\\Flagged"),
      text: parsed.text || "",
      htmlAvailable: Boolean(parsed.html),
      attachments: (parsed.attachments || []).map((attachment, index) => ({
        index,
        filename: attachment.filename || `attachment-${index + 1}`,
        contentType: attachment.contentType || "application/octet-stream",
        contentDisposition: attachment.contentDisposition || "attachment",
        size: attachment.size ?? attachment.content?.length ?? null,
        checksum: attachment.checksum || "",
        contentId: attachment.contentId || ""
      }))
    };
  });
}

export async function getMessageAttachment({ uid, index, mailbox = "INBOX" }) {
  return withMailbox(mailbox, async (client, path) => {
    const { parsed, uid: safeUid } = await fetchParsedMessage(client, uid);
    const safeIndex = Number(index);
    if (!Number.isSafeInteger(safeIndex) || safeIndex < 0) {
      throw httpError("INVALID_ATTACHMENT_INDEX", 400, "attachment index must be a non-negative integer");
    }
    const attachment = (parsed.attachments || [])[safeIndex];
    if (!attachment) throw httpError("ATTACHMENT_NOT_FOUND", 404);
    if (attachment.content.length > MAX_ATTACHMENT_BYTES) {
      throw httpError("ATTACHMENT_TOO_LARGE", 413, "Attachment exceeds the 10 MB API limit");
    }
    return {
      uid: safeUid,
      mailbox: path,
      index: safeIndex,
      filename: attachment.filename || `attachment-${safeIndex + 1}`,
      contentType: attachment.contentType || "application/octet-stream",
      size: attachment.content.length,
      contentBase64: attachment.content.toString("base64")
    };
  });
}

export async function listMailFolders() {
  return withClient(async (client) => (await client.list()).map((mailbox) => ({
    path: mailbox.path,
    name: mailbox.name,
    delimiter: mailbox.delimiter || "/",
    specialUse: mailbox.specialUse || "",
    subscribed: mailbox.subscribed === true
  })));
}

export async function bootstrapBirdieFolders() {
  return withClient(async (client) => {
    let mailboxes = await client.list();
    const delimiter = mailboxes.find((mailbox) => mailbox.delimiter)?.delimiter || "/";
    const existing = new Set(mailboxes.map((mailbox) => mailbox.path.toLowerCase()));
    const created = [];
    const unchanged = [];

    for (const path of buildBirdieFolderPaths(delimiter)) {
      if (existing.has(path.toLowerCase())) {
        unchanged.push(path);
        continue;
      }
      await client.mailboxCreate(path);
      existing.add(path.toLowerCase());
      created.push(path);
    }

    audit("FOLDERS_BOOTSTRAP", { createdCount: created.length, unchangedCount: unchanged.length });
    return { delimiter, created, unchanged };
  });
}

export async function updateMessageFlags({ uid, mailbox = "INBOX", read, flagged }) {
  const safeUid = normalizeUid(uid);
  if (typeof read !== "boolean" && typeof flagged !== "boolean") {
    throw httpError("NO_FLAG_UPDATE", 400, "read or flagged must be provided as a boolean");
  }
  return withMailbox(mailbox, async (client, path) => {
    if (typeof read === "boolean") {
      await client[read ? "messageFlagsAdd" : "messageFlagsRemove"](
        safeUid,
        ["\\Seen"],
        { uid: true }
      );
    }
    if (typeof flagged === "boolean") {
      await client[flagged ? "messageFlagsAdd" : "messageFlagsRemove"](
        safeUid,
        ["\\Flagged"],
        { uid: true }
      );
    }
    audit("FLAGS_UPDATE", { uid: safeUid, mailbox: path, read, flagged });
    return { uid: safeUid, mailbox: path, read, flagged };
  });
}

export async function moveMessage({ uid, mailbox = "INBOX", destination }) {
  const safeUid = normalizeUid(uid);
  const target = normalizeMailbox(destination);
  return withMailbox(mailbox, async (client, path) => {
    await client.messageMove(safeUid, target, { uid: true });
    audit("MESSAGE_MOVE", { uid: safeUid, from: path, destination: target });
    return { uid: safeUid, from: path, destination: target };
  });
}

export async function deleteMessage({ uid, mailbox = "INBOX", mode = "trash", ...approval }) {
  requireFounderApproval(approval, mode === "permanent" ? "DELETE_PERMANENTLY" : "MOVE_TO_TRASH");
  const safeUid = normalizeUid(uid);

  if (mode === "permanent") {
    return withMailbox(mailbox, async (client, path) => {
      await client.messageDelete(safeUid, { uid: true });
      audit("MESSAGE_DELETE_PERMANENT", { uid: safeUid, mailbox: path });
      return { uid: safeUid, mailbox: path, mode: "permanent" };
    });
  }
  if (mode !== "trash") throw httpError("INVALID_DELETE_MODE", 400);

  return withClient(async (client) => {
    const folders = await client.list();
    let trash = folders.find((folder) => folder.specialUse === "\\Trash")?.path;
    if (!trash) {
      const delimiter = folders.find((folder) => folder.delimiter)?.delimiter || "/";
      trash = ["Birdie OS", "99 ARCHIVE", "Trash"].join(delimiter);
      if (!folders.some((folder) => folder.path.toLowerCase() === trash.toLowerCase())) {
        await client.mailboxCreate(trash);
      }
    }

    const path = normalizeMailbox(mailbox);
    const lock = await client.getMailboxLock(path);
    try {
      await client.messageMove(safeUid, trash, { uid: true });
    } finally {
      lock.release();
    }
    audit("MESSAGE_MOVE_TO_TRASH", { uid: safeUid, from: path, destination: trash });
    return { uid: safeUid, from: path, destination: trash, mode: "trash" };
  });
}

export async function sendMail(body = {}) {
  requireFounderApproval(body, "SEND_EMAIL");
  const to = normalizeRecipients(body.to, "to");
  const cc = normalizeRecipients(body.cc, "cc");
  const bcc = normalizeRecipients(body.bcc, "bcc");
  const subject = String(body.subject || "").trim();
  const text = String(body.text || "");
  const html = body.html == null ? undefined : String(body.html);
  if (!subject || subject.length > 998 || /[\r\n\0]/.test(subject)) {
    throw httpError("INVALID_SUBJECT", 400);
  }
  if (!text && !html) throw httpError("MESSAGE_BODY_REQUIRED", 400);

  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map((item, index) => {
    const content = Buffer.from(String(item.contentBase64 || ""), "base64");
    if (!content.length || content.length > MAX_ATTACHMENT_BYTES) {
      throw httpError("INVALID_ATTACHMENT", 400, `Attachment ${index} is empty or exceeds 10 MB`);
    }
    return {
      filename: String(item.filename || `attachment-${index + 1}`),
      contentType: String(item.contentType || "application/octet-stream"),
      content
    };
  });

  const sender = requireEnv("MAIL_USER");
  const signed = appendBirdieSignature({ text, html });
  const outgoing = await compileOutgoingMessage({
    from: { name: "Birdie & Breakfast", address: sender },
    to,
    cc,
    bcc,
    subject,
    text: signed.text || undefined,
    html: signed.html,
    attachments
  });
  const transporter = nodemailer.createTransport(getSmtpConfig());
  const info = await transporter.sendMail({
    envelope: outgoing.envelope,
    raw: outgoing.message
  });

  let sentCopy;
  try {
    sentCopy = await archiveSentMessage(outgoing.message);
  } catch (error) {
    sentCopy = {
      saved: false,
      error: error.code || "SENT_COPY_FAILED"
    };
    audit("MESSAGE_SENT_COPY_FAILED", {
      messageId: info.messageId || outgoing.messageId,
      error: sentCopy.error
    });
  }

  audit("MESSAGE_SEND", {
    messageId: info.messageId || outgoing.messageId,
    acceptedCount: info.accepted?.length || 0,
    rejectedCount: info.rejected?.length || 0,
    recipientCount: to.length + cc.length + bcc.length,
    sentCopySaved: sentCopy.saved
  });
  return {
    messageId: info.messageId || outgoing.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    response: info.response || "",
    sentCopy
  };
}
