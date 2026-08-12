const CONTRACT_VERSION = "birdie-app-v1";

const ALLOWED_DOMAINS = Object.freeze([
  "PROFILE_SELF",
  "ROUNDS_SELF",
  "GOLF_STATS_SELF",
  "BALL_PASSPORTS_OWNED",
  "ACHIEVEMENTS_SELF",
  "PERSONAL_BIRDIE_MEMORY_SELF",
  "PUBLIC_BIRDIE_CONTENT"
]);

const DENIED_DOMAIN_HINTS = Object.freeze([
  "TASK", "BIRDIEOS", "FINANCE", "PRICE", "SUPPLIER", "MAIL", "LEGAL", "SECRET", "DEPLOY", "OTHER_USER"
]);

function clone(value) {
  return structuredClone(value);
}

function requireBirdieId(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("birdieId is required");
  return value.trim();
}

function sanitizeText(value, max = 1000) {
  if (typeof value !== "string") throw new TypeError("message must be a string");
  const text = value.trim();
  if (!text) throw new TypeError("message must not be empty");
  return text.slice(0, max);
}

function containsDeniedIntent(text) {
  const upper = text.toUpperCase();
  return DENIED_DOMAIN_HINTS.some((hint) => upper.includes(hint));
}

export function createPersonalBirdieGateway({
  getProfile,
  getGolfHistory,
  getGolfStats,
  getOwnedBallPassports,
  getAchievements = async () => [],
  getPreferences = async () => ({}),
  getPublicBirdieContent = async () => []
}) {
  for (const [name, fn] of Object.entries({ getProfile, getGolfHistory, getGolfStats, getOwnedBallPassports })) {
    if (typeof fn !== "function") throw new TypeError(`${name} dependency is required`);
  }

  async function buildContext(birdieIdInput) {
    const birdieId = requireBirdieId(birdieIdInput);
    const [profile, rounds, golfStats, ballPassports, achievements, preferences, publicContent] = await Promise.all([
      getProfile(birdieId),
      getGolfHistory(birdieId),
      getGolfStats(birdieId),
      getOwnedBallPassports(birdieId),
      getAchievements(birdieId),
      getPreferences(birdieId),
      getPublicBirdieContent()
    ]);

    return clone({
      contractVersion: CONTRACT_VERSION,
      birdieId,
      allowedDomains: [...ALLOWED_DOMAINS],
      profile,
      rounds,
      golfStats,
      ballPassports,
      achievements,
      preferences,
      publicContent
    });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    mode: "SANDBOX",
    allowedDomains: [...ALLOWED_DOMAINS],

    async getContext(birdieId) {
      return buildContext(birdieId);
    },

    async chat({ birdieId: birdieIdInput, message }) {
      const birdieId = requireBirdieId(birdieIdInput);
      const text = sanitizeText(message);
      if (containsDeniedIntent(text)) {
        return {
          contractVersion: CONTRACT_VERSION,
          birdieId,
          mode: "SANDBOX",
          refused: true,
          reply: "I can only use your own golf profile, rounds, stats, owned Ball Passports, achievements, preferences and approved public Birdie content. Internal Birdie & Breakfast operating data is outside my access."
        };
      }

      const context = await buildContext(birdieId);
      const roundCount = Array.isArray(context.rounds) ? context.rounds.length : context.rounds?.rounds?.length ?? 0;
      const ballCount = Array.isArray(context.ballPassports) ? context.ballPassports.length : context.ballPassports?.objects?.length ?? 0;

      return {
        contractVersion: CONTRACT_VERSION,
        birdieId,
        mode: "SANDBOX",
        refused: false,
        reply: `Sandbox Birdie here. I can see ${roundCount} of your rounds and ${ballCount} of your owned Ball Passports. Ask me about your golf story, stats or equipment journey.`,
        contextDomainsUsed: ["PROFILE_SELF", "ROUNDS_SELF", "GOLF_STATS_SELF", "BALL_PASSPORTS_OWNED"]
      };
    }
  };
}

export { ALLOWED_DOMAINS as PERSONAL_BIRDIE_ALLOWED_DOMAINS };
