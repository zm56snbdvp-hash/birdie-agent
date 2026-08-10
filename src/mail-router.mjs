import { getMailHealth, listRecentMail } from "./mail-service.mjs";

export async function routeMailRequest({ req, res, url, json }) {
  if (req.method === "GET" && url.pathname === "/mail/health") {
    const data = await getMailHealth();

    json(res, 200, {
      success: true,
      source: "IONOS_IMAP",
      readOnly: true,
      data
    });

    return true;
  }

  if (req.method === "GET" && url.pathname === "/mail/messages") {
    const data = await listRecentMail({
      limit: url.searchParams.get("limit") || 20,
      unreadOnly: url.searchParams.get("unread") === "true"
    });

    json(res, 200, {
      success: true,
      source: "IONOS_IMAP",
      readOnly: true,
      data
    });

    return true;
  }

  return false;
}
