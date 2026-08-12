/**
 * BirdieOS domain dispatcher for modular domain actions.
 *
 * The authoritative Apps Script doPost handler can delegate requests here after
 * its existing API authentication/validation layer. This file does not replace
 * or weaken that outer auth layer.
 */
function handleBirdieDomainAction_(request) {
  request = request || {};
  var action = String(request.action || "");
  if (action.indexOf("coin") === 0) return handleBirdieCoinAction_(request);
  if (action.indexOf("dna") === 0) return handleBirdieDnaAction_(request);
  throw new Error("UNKNOWN_BIRDIE_DOMAIN_ACTION");
}
