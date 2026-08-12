/**
 * BIRDIE OS — Community Identity Resolver narrow write gate
 *
 * Purpose:
 * - keep the global BIRDIE_OS_WRITE_ENABLED gate OFF
 * - permit only updateCommunityIdentityResolution
 * - permit only one explicitly scoped work item
 * - require the canonical resolver version/idempotency/processor contract
 *
 * Authoritative Apps Script dispatcher integration:
 *
 *   var globalWriteEnabled = String(
 *     PropertiesService.getScriptProperties().getProperty("BIRDIE_OS_WRITE_ENABLED") || ""
 *   ).toLowerCase() === "true";
 *
 *   var identityNarrowWriteAllowed =
 *     typeof birdieCommunityIdentityNarrowWriteGateAllows_ === "function" &&
 *     birdieCommunityIdentityNarrowWriteGateAllows_(request);
 *
 *   if (!globalWriteEnabled && !identityNarrowWriteAllowed) {
 *     throw new Error("WRITE_DISABLED");
 *   }
 *
 * For one guarded E2E, set only these non-secret Script Properties:
 * - BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=true
 * - BIRDIE_IDENTITY_RESOLVER_WRITE_ITEM_ID=<exact workItemId>
 *
 * Immediately restore BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED=false after the
 * single E2E. Do not change BIRDIE_OS_WRITE_ENABLED for this test.
 */

var BIRDIE_IDENTITY_NARROW_WRITE_ENABLED_PROPERTY_ =
  "BIRDIE_IDENTITY_RESOLVER_WRITE_ENABLED";
var BIRDIE_IDENTITY_NARROW_WRITE_ITEM_PROPERTY_ =
  "BIRDIE_IDENTITY_RESOLVER_WRITE_ITEM_ID";
var BIRDIE_IDENTITY_NARROW_WRITE_ACTION_ =
  "updateCommunityIdentityResolution";
var BIRDIE_IDENTITY_NARROW_WRITE_VERSION_ = "v1";
var BIRDIE_IDENTITY_NARROW_WRITE_PROCESSOR_ =
  "ZAPIER_IDENTITY_RESOLVER";

function birdieCommunityIdentityNarrowWriteGateAllows_(request) {
  request = request || {};

  if (String(request.action || "") !== BIRDIE_IDENTITY_NARROW_WRITE_ACTION_) {
    return false;
  }

  var properties = PropertiesService.getScriptProperties();
  var enabled = String(
    properties.getProperty(BIRDIE_IDENTITY_NARROW_WRITE_ENABLED_PROPERTY_) || ""
  ).toLowerCase();

  if (enabled !== "true") return false;

  var scopedWorkItemId = String(
    properties.getProperty(BIRDIE_IDENTITY_NARROW_WRITE_ITEM_PROPERTY_) || ""
  ).trim();
  var workItemId = String(request.workItemId || "").trim();

  if (!workItemId || scopedWorkItemId !== workItemId) return false;

  if (
    String(request.resolverVersion || "") !==
    BIRDIE_IDENTITY_NARROW_WRITE_VERSION_
  ) {
    return false;
  }

  var expectedIdempotencyKey =
    "IDENTITY|" + workItemId + "|" + BIRDIE_IDENTITY_NARROW_WRITE_VERSION_;

  if (String(request.idempotencyKey || "") !== expectedIdempotencyKey) {
    return false;
  }

  var write = request.write || {};
  if (
    String(write.processedBy || "") !==
    BIRDIE_IDENTITY_NARROW_WRITE_PROCESSOR_
  ) {
    return false;
  }

  return true;
}
