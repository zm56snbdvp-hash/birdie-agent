/**
 * Auth0 Post Login Action for BirdieWorld supporter tokens.
 *
 * Source of truth:
 *   event.user.app_metadata.birdie_id
 *
 * This action never derives a Birdie ID from email, nickname, user_id,
 * browser input, or any client-controlled value.
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://birdieandbreakfast.de";
  const birdieId = String(event.user?.app_metadata?.birdie_id || "").trim();

  if (!birdieId) {
    return;
  }

  api.accessToken.setCustomClaim(`${namespace}/birdie_id`, birdieId);
};
