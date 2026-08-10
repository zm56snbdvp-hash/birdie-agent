import * as defaultMailService from "./mail-service.mjs";

function response(json, res, data, extra = {}) {
  json(res, 200, {
    success: true,
    source: "IONOS_IMAP_SMTP",
    readOnly: false,
    governed: true,
    ...extra,
    data
  });
}

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

export async function routeMailRequest({
  req,
  res,
  url,
  json,
  readBody,
  service = defaultMailService
}) {
  if (req.method === "GET" && url.pathname === "/mail/health") {
    response(json, res, await service.getMailHealth());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/mail/folders") {
    response(json, res, await service.listMailFolders());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/mail/folders/bootstrap") {
    response(json, res, await service.bootstrapBirdieFolders(), { action: "FOLDERS_BOOTSTRAP" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/mail/messages") {
    response(json, res, await service.listRecentMail({
      limit: url.searchParams.get("limit") || 20,
      unreadOnly: url.searchParams.get("unread") === "true",
      mailbox: url.searchParams.get("mailbox") || "INBOX"
    }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/mail/send") {
    response(json, res, await service.sendMail(await readBody(req)), {
      action: "MESSAGE_SEND",
      founderApproved: true
    });
    return true;
  }

  const parts = pathParts(url);
  if (parts[0] !== "mail" || parts[1] !== "messages" || !parts[2]) return false;
  const uid = parts[2];

  if (req.method === "GET" && parts.length === 3) {
    response(json, res, await service.getMessage({
      uid,
      mailbox: url.searchParams.get("mailbox") || "INBOX"
    }));
    return true;
  }

  if (req.method === "GET" && parts[3] === "attachments" && parts[4] != null) {
    response(json, res, await service.getMessageAttachment({
      uid,
      index: parts[4],
      mailbox: url.searchParams.get("mailbox") || "INBOX"
    }));
    return true;
  }

  if (req.method === "PATCH" && parts.length === 3) {
    const body = await readBody(req);
    response(json, res, await service.updateMessageFlags({ uid, ...body }), {
      action: "FLAGS_UPDATE"
    });
    return true;
  }

  if (req.method === "POST" && parts[3] === "move" && parts.length === 4) {
    const body = await readBody(req);
    response(json, res, await service.moveMessage({ uid, ...body }), {
      action: "MESSAGE_MOVE"
    });
    return true;
  }

  if (req.method === "DELETE" && parts.length === 3) {
    const body = await readBody(req);
    response(json, res, await service.deleteMessage({ uid, ...body }), {
      action: body.mode === "permanent" ? "MESSAGE_DELETE_PERMANENT" : "MESSAGE_MOVE_TO_TRASH",
      founderApproved: true
    });
    return true;
  }

  return false;
}
