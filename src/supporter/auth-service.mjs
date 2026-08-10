import {
  createHmac,
  randomBytes as secureRandomBytes,
  randomInt as secureRandomInt,
  timingSafeEqual
} from "node:crypto";

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_REQUEST_CODE_MS = 600;

export class SupporterAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SupporterAuthError";
    this.code = code;
    this.status = status;
  }
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupporterAuthError("INVALID_BODY", "Request body must be an object");
  }
  return value;
}

function requireText(value, field, maximum = 240) {
  const text = String(value ?? "").trim();
  if (!text) throw new SupporterAuthError("MISSING_FIELD", `${field} is required`);
  if (text.length > maximum) {
    throw new SupporterAuthError("FIELD_TOO_LONG", `${field} is too long`);
  }
  return text;
}

function normalizeEmail(value) {
  const email = requireText(value, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n\0]/.test(email)) {
    throw new SupporterAuthError("INVALID_EMAIL", "Bitte gib eine gültige E-Mail-Adresse ein");
  }
  return email;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new SupporterAuthError(
      "SUPPORTER_AUTH_NOT_CONFIGURED",
      "Supporter login is not configured",
      503
    );
  }
  return secret;
}

function publicId(prefix, bytes) {
  return `${prefix}-${Buffer.from(bytes).toString("hex").toUpperCase()}`;
}

function digest(secret, purpose, value) {
  return createHmac("sha256", secret).update(`${purpose}:${value}`, "utf8").digest("hex");
}

function loginCode(value) {
  const code = requireText(value, "code", 6);
  if (!/^\d{6}$/.test(code)) {
    throw new SupporterAuthError("INVALID_LOGIN_CODE", "Der Login-Code ist ungültig", 401);
  }
  return code;
}

function sessionToken(value) {
  const token = requireText(value, "sessionToken", 256);
  if (!/^[A-Za-z0-9_-]{40,256}$/.test(token)) {
    throw new SupporterAuthError("INVALID_SESSION", "Die Sitzung ist ungültig", 401);
  }
  return token;
}

function mapAuthFailure(error) {
  const message = String(error?.code || error?.message || error);
  if (
    message.includes("INVALID_LOGIN_CODE") ||
    message.includes("LOGIN_CHALLENGE_EXPIRED") ||
    message.includes("LOGIN_CHALLENGE_LOCKED") ||
    message.includes("LOGIN_CHALLENGE_NOT_FOUND")
  ) {
    return new SupporterAuthError(
      "INVALID_LOGIN_CODE",
      "Der Code ist falsch oder abgelaufen. Bitte fordere einen neuen an.",
      401
    );
  }
  if (
    message.includes("INVALID_SESSION") ||
    message.includes("SESSION_EXPIRED") ||
    message.includes("SESSION_REVOKED") ||
    message.includes("SESSION_NOT_FOUND")
  ) {
    return new SupporterAuthError(
      "INVALID_SESSION",
      "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
      401
    );
  }
  return error;
}

export function createSupporterAuthService({
  birdieOSPost,
  sendLoginCode,
  secret,
  now = () => Date.now(),
  randomBytes = secureRandomBytes,
  randomInt = secureRandomInt,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  if (typeof birdieOSPost !== "function") throw new Error("birdieOSPost dependency is required");
  if (typeof sendLoginCode !== "function") throw new Error("sendLoginCode dependency is required");

  async function post(action, payload) {
    try {
      const result = await birdieOSPost({ action, ...payload });
      return result.data;
    } catch (error) {
      throw mapAuthFailure(error);
    }
  }

  return {
    async requestCode(input) {
      const startedAt = now();
      const authSecret = requireSecret(secret);
      const body = requireObject(input);
      const email = normalizeEmail(body.email);
      const challengeId = publicId("LOGIN", randomBytes(12));
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(now() + LOGIN_CODE_TTL_MS).toISOString();

      let challenge;
      try {
        challenge = await post("coinCreateLoginChallenge", {
          challengeId,
          email,
          emailBucketHash: digest(authSecret, "email-bucket", email),
          codeHash: digest(authSecret, "login-code", `${challengeId}:${code}`),
          expiresAt,
          idempotencyKey: `login-challenge:${challengeId}`,
          source: "Birdie Supporter App"
        });
      } catch (error) {
        if (!String(error?.code || error?.message || error).includes("LOGIN_RATE_LIMITED")) {
          throw error;
        }
        challenge = { accepted: true, deliverable: false };
      }

      if (challenge?.deliverable === true) {
        const deliveryEmail = normalizeEmail(challenge.deliveryEmail);
        if (deliveryEmail !== email) {
          throw new SupporterAuthError(
            "AUTH_RECIPIENT_MISMATCH",
            "Stored profile address does not match the login request",
            409
          );
        }
        await sendLoginCode({
          to: deliveryEmail,
          displayName: challenge.displayName || "Birdie",
          code,
          expiresMinutes: LOGIN_CODE_TTL_MS / 60_000
        });
      }

      const remainingDelay = Math.max(0, MINIMUM_REQUEST_CODE_MS - (now() - startedAt));
      if (remainingDelay) await sleep(remainingDelay);

      return {
        accepted: true,
        challengeId: challenge?.challengeId || challengeId,
        expiresInSeconds: LOGIN_CODE_TTL_MS / 1000,
        message: "Wenn eine aktive Birdie ID zu dieser Adresse gehört, ist dein Code unterwegs."
      };
    },

    async verifyCode(input) {
      const authSecret = requireSecret(secret);
      const body = requireObject(input);
      const challengeId = requireText(body.challengeId, "challengeId", 80);
      const code = loginCode(body.code);

      const verification = await post("coinVerifyLoginChallenge", {
        challengeId,
        codeHash: digest(authSecret, "login-code", `${challengeId}:${code}`),
        source: "Birdie Supporter App"
      });

      const rawToken = Buffer.from(randomBytes(32)).toString("base64url");
      const sessionId = publicId("SESSION", randomBytes(12));
      const expiresAt = new Date(now() + SESSION_TTL_MS).toISOString();
      const session = await post("coinCreateSupporterSession", {
        sessionId,
        challengeId,
        birdieId: verification.birdieId,
        tokenHash: digest(authSecret, "session-token", rawToken),
        expiresAt,
        idempotencyKey: `supporter-session:${sessionId}`,
        source: "Birdie Supporter App"
      });

      return {
        sessionToken: rawToken,
        expiresAt,
        expiresInSeconds: SESSION_TTL_MS / 1000,
        profile: session.profile
      };
    },

    async authorize(rawToken) {
      const authSecret = requireSecret(secret);
      const token = sessionToken(rawToken);
      return post("coinAuthorizeSupporterSession", {
        tokenHash: digest(authSecret, "session-token", token),
        source: "Birdie Supporter App"
      });
    },

    async revoke(rawToken) {
      if (!rawToken) return { revoked: true };
      const authSecret = requireSecret(secret);
      const token = sessionToken(rawToken);
      return post("coinRevokeSupporterSession", {
        tokenHash: digest(authSecret, "session-token", token),
        source: "Birdie Supporter App"
      });
    },

    csrfToken(rawToken) {
      const authSecret = requireSecret(secret);
      return digest(authSecret, "csrf-token", sessionToken(rawToken));
    },

    verifyCsrf(rawToken, suppliedToken) {
      const expected = this.csrfToken(rawToken);
      const supplied = String(suppliedToken || "");
      const expectedBuffer = Buffer.from(expected, "utf8");
      const suppliedBuffer = Buffer.from(supplied, "utf8");
      if (
        expectedBuffer.length !== suppliedBuffer.length ||
        !timingSafeEqual(expectedBuffer, suppliedBuffer)
      ) {
        throw new SupporterAuthError(
          "INVALID_CSRF_TOKEN",
          "Die Sicherheitsprüfung ist fehlgeschlagen. Bitte lade die Seite neu.",
          403
        );
      }
      return true;
    }
  };
}

export const supporterAuthDurations = Object.freeze({
  loginCodeSeconds: LOGIN_CODE_TTL_MS / 1000,
  sessionSeconds: SESSION_TTL_MS / 1000
});
