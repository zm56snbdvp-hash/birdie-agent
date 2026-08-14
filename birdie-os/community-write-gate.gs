/**
 * BIRDIE OS — Narrow Community Identity Resolver Write Gate
 *
 * Purpose:
 * Keep the global BIRDIE_OS_WRITE_ENABLED gate closed while allowing exactly
 * one explicitly configured Community Identity Resolver work item to pass the
 * outer controlled-write gate for a guarded E2E validation.
 *
 * This file is integration-ready source only. Adding it to GitHub does NOT
 * change the authoritative Apps Script deployment or its Script Properties.
 *
 * Required Script Properties for the narrow path:
 * - BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=true
 * - BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID=<exact approved workItemId>
 *
 * Existing global behavior is preserved:
 * - if BIRDIE_OS_WRITE_ENABLED=true, existing controlled write actions remain
 *   allowed by the outer dispatcher as before;
 * - if global writes are not enabled, only the exact resolver request below
 *   may pass this helper.
 */

var BIRDIE_IDENTITY_WRITE_ACTION_ = "updateCommunityIdentityResolution";
var BIRDIE_IDENTITY_WRITE_VERSION_ = "v1";
var BIRDIE_IDENTITY_WRITE_ENABLE_PROPERTY_ =
  "BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED";
var BIRDIE_IDENTITY_WRITE_TARGET_PROPERTY_ =
  "BIRDIE_IDENTITY_RESOLVER_WRITE_WORK_ITEM_ID";

function birdieControlledWriteAllowed_(request) {
  request = request || {};

  var properties = PropertiesService.getScriptProperties();
  var globalWriteEnabled = birdieWriteGateTrue_(
    properties.getProperty("BIRDIE_OS_WRITE_ENABLED")
  );

  // Preserve the existing global controlled-write behavior when explicitly on.
  if (globalWriteEnabled) return true;

  // Fail closed for every non-resolver write while the global gate is off.
  if (String(request.action || "") !== BIRDIE_IDENTITY_WRITE_ACTION_) {
    return false;
  }

  if (
    !birdieWriteGateTrue_(
      properties.getProperty(BIRDIE_IDENTITY_WRITE_ENABLE_PROPERTY_)
    )
  ) {
    return false;
  }

  var allowedWorkItemId = String(
    properties.getProperty(BIRDIE_IDENTITY_WRITE_TARGET_PROPERTY_) || ""
  ).trim();
  var requestedWorkItemId = String(request.workItemId || "").trim();

  // Never allow an unscoped resolver exception.
  if (!allowedWorkItemId || requestedWorkItemId !== allowedWorkItemId) {
    return false;
  }

  if (String(request.resolverVersion || "") !== BIRDIE_IDENTITY_WRITE_VERSION_) {
    return false;
  }

  var expectedIdempotencyKey =
    "IDENTITY|" + allowedWorkItemId + "|" + BIRDIE_IDENTITY_WRITE_VERSION_;
  if (String(request.idempotencyKey || "") !== expectedIdempotencyKey) {
    return false;
  }

  // The outer API-key auth remains authoritative. This additional marker keeps
  // the temporary exception tied to the Birdie Agent resolver path.
  if (String(request.source || "") !== "Birdie Agent") {
    return false;
  }

  return true;
}

function birdieAssertControlledWriteAllowed_(request) {
  if (!birdieControlledWriteAllowed_(request)) {
    throw new Error("WRITE_DISABLED");
  }
  return true;
}

function birdieWriteGateTrue_(value) {
  return String(value || "").trim().toLowerCase() === "true";
}
