import * as defaultMailService from "./mail-service.mjs";

function ok(json, res, data, extra = {}) {
  json(res, 200, {
    success: true,
    source: "BIRDIE_WATCH",
    governed: true,
    ...extra,
    data
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function compactMessage(message) {
  return {
    uid: message.uid,
    subject: message.subject || "(Ohne Betreff)",
    from: message.from || message.sender || "",
    date: message.date || null,
    unread: message.seen === false || message.unread === true,
    flagged: message.flagged === true,
    preview: message.preview || message.textPreview || message.snippet || ""
  };
}

function compactDayPilotTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return null;
  const id = normalizeText(task.id || task.taskId);
  const title = normalizeText(task.title || task.task || task.name);
  if (!id || !title) return null;
  const dueAt = task.dueAt || task.date || null;
  if (dueAt !== null && (!Number.isFinite(Date.parse(String(dueAt))))) return null;
  return { id, title, dueAt: dueAt ? new Date(dueAt).toISOString() : null };
}

function compactApproval(approval) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return null;
  const id = normalizeText(approval.id || approval.approvalId);
  const title = normalizeText(approval.title || approval.name);
  const detail = normalizeText(approval.detail || approval.description);
  if (!id || !title || !detail) return null;
  return { id, title, detail };
}

function compactDayPilot(data) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const generatedAt = value.generatedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(String(generatedAt)))) {
    const error = new Error("generatedAt must be an ISO date");
    error.code = "INVALID_DAY_PILOT_SNAPSHOT";
    error.status = 502;
    throw error;
  }
  const briefing = normalizeText(value.briefing || value.summary || value.message);
  const approvals = Array.isArray(value.openApprovals)
    ? value.openApprovals.map(compactApproval).filter(Boolean).slice(0, 20)
    : [];
  return {
    contractVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    nextTask: compactDayPilotTask(value.nextTask),
    briefing,
    openApprovals: approvals
  };
}

export async function routeWatchRequest({
  req,
  res,
  url,
  json,
  readBody,
  handleChat,
  mailService = defaultMailService,
  dayPilotProvider = async () => ({})
}) {
  if (!url.pathname.startsWith("/watch/")) return false;

  if (req.method === "GET" && url.pathname === "/watch/briefing") {
    const messages = await mailService.listRecentMail({
      limit: 8,
      unreadOnly: true,
      mailbox: "INBOX"
    });
    const items = Array.isArray(messages) ? messages : (messages?.messages || []);
    ok(json, res, {
      unreadCount: items.length,
      inbox: items.slice(0, 5).map(compactMessage),
      primaryAction: items.length ? "READ_INBOX" : "TALK_TO_BIRDIE"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/watch/day-pilot/v1") {
    const data = await dayPilotProvider();
    ok(json, res, compactDayPilot(data));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/watch/command") {
    const body = await readBody(req);
    const utterance = normalizeText(body.utterance || body.message);
    if (!utterance) {
      const error = new Error("utterance is required");
      error.code = "INVALID_WATCH_COMMAND";
      error.status = 400;
      throw error;
    }

    const result = await handleChat(utterance);
    ok(json, res, {
      utterance,
      intent: result.intent,
      answer: result.answer,
      authoritative: result.authoritative === true,
      source: result.source
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/watch/mail/reply") {
    const body = await readBody(req);
    const to = normalizeText(body.to);
    const subject = normalizeText(body.subject);
    const text = normalizeText(body.text);
    if (!to || !subject || !text) {
      const error = new Error("to, subject and text are required");
      error.code = "INVALID_WATCH_REPLY";
      error.status = 400;
      throw error;
    }

    if (body.founderApproved !== true || body.confirmation !== "SEND_EMAIL") {
      const error = new Error("Explicit founder confirmation required: SEND_EMAIL");
      error.code = "FOUNDER_CONFIRMATION_REQUIRED";
      error.status = 403;
      throw error;
    }

    const sent = await mailService.sendMail({
      to,
      subject,
      text,
      html: body.html,
      replyToUid: body.replyToUid,
      founderApproved: true,
      confirmation: "SEND_EMAIL"
    });
    ok(json, res, sent, {
      action: "WATCH_MAIL_SEND",
      founderApproved: true
    });
    return true;
  }

  return false;
}
