export const ACCOUNT_TYPES = Object.freeze(["PRIVATE", "B2B", "TEAM"]);

export const CLAIM_DECISIONS = Object.freeze(["APPROVE", "REJECT"]);
export const REDEMPTION_DECISIONS = Object.freeze([
  "APPROVE",
  "REJECT",
  "FULFILL",
  "CANCEL"
]);

export const ACTION_DEFINITIONS = Object.freeze({
  PROFILE_REGISTERED: { accountTypes: ACCOUNT_TYPES, points: 1 },
  INSTAGRAM_VERIFIED: { accountTypes: ["PRIVATE", "B2B"], points: 1 },
  IG_COMMENT: {
    accountTypes: ["PRIVATE"],
    points: 1,
    sourceTypes: ["INSTAGRAM"],
    approvalMode: "MANUAL_APPROVAL",
    frequencyRule: "PER_DISTINCT_COMMENT",
    version: "V1",
    status: "ACTIVE",
    rolloutMode: "CONTROLLED_E2E"
  },
  COMMUNITY_CONTRIBUTION: { accountTypes: ["PRIVATE"], points: 1 },
  STORY_SHARE_TAGGED: { accountTypes: ["PRIVATE", "B2B"], points: 2 },
  UGC_APPROVED: { accountTypes: ["PRIVATE"], points: 3 },
  PRODUCT_REVIEW_VERIFIED: { accountTypes: ["PRIVATE"], points: 3 },
  REFERRAL_VERIFIED: { accountTypes: ["PRIVATE"], points: 5 },
  STARTER_KIT_PURCHASE: { accountTypes: ["PRIVATE"], points: 5 },
  BOOSTER_ORDER_PURCHASE: { accountTypes: ["PRIVATE"], points: 2 },
  COMMUNITY_HELP: { accountTypes: ["PRIVATE"], minPoints: 1, maxPoints: 10 },
  B2B_PROFILE_VERIFIED: { accountTypes: ["B2B"], points: 2 },
  B2B_FEED_OR_REEL: { accountTypes: ["B2B"], points: 4 },
  B2B_REFERRAL_VERIFIED: { accountTypes: ["B2B"], points: 8 },
  B2B_COMMUNITY_ACTION: { accountTypes: ["B2B"], minPoints: 5, maxPoints: 20 },
  B2B_PRODUCT_OR_EVENT_SUPPORT: {
    accountTypes: ["B2B"],
    minPoints: 5,
    maxPoints: 25
  }
});

export const LEVELS = Object.freeze([
  { code: "TEE_STARTER", name: "Tee Starter", minimum: 0 },
  { code: "FAIRWAY_FRIEND", name: "Fairway Friend", minimum: 10 },
  { code: "CLUBHOUSE_BIRDIE", name: "Clubhouse Birdie", minimum: 25 },
  { code: "FLOCK_CAPTAIN", name: "Flock Captain", minimum: 50 },
  { code: "BIRDIE_LEGEND", name: "Birdie Legend", minimum: 100 }
]);

export const PILOT_REWARDS = Object.freeze([
  {
    rewardId: "RW-PRIVATE-WALLPAPER",
    accountType: "PRIVATE",
    name: "Exklusives Birdie-Wallpaper",
    price: 5,
    fulfillmentType: "DIGITAL"
  },
  {
    rewardId: "RW-PRIVATE-SUPPORTER-WALL",
    accountType: "PRIVATE",
    name: "Name auf der digitalen Supporter Wall",
    price: 10,
    fulfillmentType: "MANUAL"
  },
  {
    rewardId: "RW-PRIVATE-EARLY-ACCESS",
    accountType: "PRIVATE",
    name: "Early Access zum nächsten Produktdrop",
    price: 15,
    fulfillmentType: "DIGITAL"
  },
  {
    rewardId: "RW-B2B-INTERACTION",
    accountType: "B2B",
    name: "Ehrlicher Account-Besuch und passende Interaktion",
    price: 10,
    fulfillmentType: "MANUAL"
  },
  {
    rewardId: "RW-B2B-STORY-MENTION",
    accountType: "B2B",
    name: "Story-Erwähnung als Supporter",
    price: 20,
    fulfillmentType: "MANUAL"
  },
  {
    rewardId: "RW-B2B-SUPPORTER-WALL",
    accountType: "B2B",
    name: "B2B-Profil auf der Supporter Wall",
    price: 25,
    fulfillmentType: "MANUAL"
  }
]);

export const BADGE_DEFINITIONS = Object.freeze({
  FOUNDING_BIRDIE: {
    name: "Founding Birdie",
    founderApprovalRequired: true
  },
  FIRST_FLOCK: {
    name: "First Flock",
    founderApprovalRequired: true
  },
  DAY_ONE_SUPPORTER: {
    name: "Day One Supporter",
    founderApprovalRequired: true
  },
  COMMUNITY_BUILDER: {
    name: "Community Builder",
    founderApprovalRequired: false
  }
});

export function getLevel(lifetimeBirdies) {
  const points = Number(lifetimeBirdies);

  if (!Number.isFinite(points) || points < 0) {
    return LEVELS[0];
  }

  return LEVELS.reduce(
    (current, level) => (points >= level.minimum ? level : current),
    LEVELS[0]
  );
}

export function getPublicCoinConfig() {
  return {
    unit: { singular: "Birdie", plural: "Birdies" },
    transferable: false,
    cashValue: false,
    expiresInV1: false,
    accountTypes: ACCOUNT_TYPES,
    actions: ACTION_DEFINITIONS,
    levels: LEVELS,
    badges: BADGE_DEFINITIONS,
    pilotRewards: PILOT_REWARDS
  };
}
