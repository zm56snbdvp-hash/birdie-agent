/**
 * BIRDIE OS — Unity Identity Read V1
 *
 * Read-only canonical resolver input. BIRDIE_PROFILES remains the sole profile source.
 * This file never creates, guesses or writes a Unity identity link.
 */
var BIRDIE_UNITY_PROFILE_SHEET_ = "BIRDIE_PROFILES";

function birdieUnityIdentityProfiles_() {
  var sheet = birdieCommunitySheet_(BIRDIE_UNITY_PROFILE_SHEET_);
  if (sheet.getLastRow() < 2) return { success: true, data: { profiles: [], unityIdentityConfigured: false } };

  var values = sheet.getDataRange().getValues();
  var headers = values.shift();
  var required = ["birdieId", "status"];
  required.forEach(function (header) { if (headers.indexOf(header) === -1) throw new Error("INVALID_BIRDIE_PROFILE_HEADERS"); });

  var unityIndex = headers.indexOf("unityPlayerId");
  if (unityIndex === -1) {
    return { success: true, data: { profiles: [], unityIdentityConfigured: false, reason: "UNITY_PLAYER_ID_COLUMN_MISSING" } };
  }

  var birdieIndex = headers.indexOf("birdieId");
  var statusIndex = headers.indexOf("status");
  var profiles = values.map(function (row) {
    return { birdieId: row[birdieIndex], status: row[statusIndex], unityPlayerId: row[unityIndex] };
  }).filter(function (profile) { return String(profile.unityPlayerId || "").trim() !== ""; });

  return { success: true, data: { profiles: profiles, unityIdentityConfigured: true } };
}
