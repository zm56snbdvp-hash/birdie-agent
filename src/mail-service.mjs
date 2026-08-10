import { ImapFlow } from "imapflow";

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    const error = new Error(`${name} is missing.`);
    error.code = "MAIL_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  return value;
}

function getConfig() {
  return {
    host: process.env.MAIL_IMAP_HOST || "imap.ionos.de",
    port: Number(process.env.MAIL_IMAP_PORT || 993),
    secure: true,
    auth: {
      user: requireEnv("MAIL_USER"),
      pass: requireEnv("MAIL_PASSWORD")
    },
    logger: false
  };
}

async function withClient(fn) {
  const client = new ImapFlow(getConfig());

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

export async function getMailHealth() {
  return withClient(async (client) => {
    const lock = await client.getMailboxLock("INBOX");

    try {
      return {
        provider: "IONOS",
        protocol: "IMAP",
        host: getConfig().host,
        mailbox: "INBOX",
        authenticated: true,
        exists: client.mailbox?.exists ?? null
      };
    } finally {
      lock.release();
    }
  });
}

export async function listRecentMail({ limit = 20, unreadOnly = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  return withClient(async (client) => {
    const lock = await client.getMailboxLock("INBOX");

    try {
      const exists = client.mailbox?.exists || 0;

      if (!exists) {
        return [];
      }

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

        if (unreadOnly && flags.includes("\\Seen")) {
          continue;
        }

        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "",
          from: (msg.envelope?.from || []).map((address) => ({
            name: address.name || "",
            address: address.address || ""
          })),
          to: (msg.envelope?.to || []).map((address) => ({
            name: address.name || "",
            address: address.address || ""
          })),
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
    } finally {
      lock.release();
    }
  });
}
