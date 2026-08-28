import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_INLINE_FILE_BYTES,
  POCKET_RELAY_ALLOWLIST,
  POCKET_RELAY_API_PREFIX,
  POCKET_RELAY_COMMAND_VERSION,
  PocketRelayAction,
  PocketRelayCommandState
} from "../src/pocket-relay/contract.mjs";

const ROOT = new URL("../clients/apple/BirdiePhone/", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("native iPhone allowlist and wire constants stay aligned with the host contract", async () => {
  const swift = await source("PocketRelay/PocketRelayContract.swift");
  const actionBlock = swift.slice(
    swift.indexOf("enum PocketRelayAction:"),
    swift.indexOf("enum PocketRelayCommandState:")
  );
  const swiftActions = [...actionBlock.matchAll(/^\s*case\s+\w+\s*=\s*"([^"]+)"/gmu)]
    .map((match) => match[1]);
  assert.deepEqual(swiftActions, Object.values(PocketRelayAction));

  const stateBlock = swift.slice(
    swift.indexOf("enum PocketRelayCommandState:"),
    swift.indexOf("struct PocketRelayTargetDevice:")
  );
  for (const state of Object.values(PocketRelayCommandState)) {
    assert.match(stateBlock, new RegExp(`\\bcase\\s+${escapeRegExp(state)}\\b`, "u"));
  }

  assert.match(swift, new RegExp(`commandVersion = "${escapeRegExp(POCKET_RELAY_COMMAND_VERSION)}"`, "u"));
  assert.match(swift, new RegExp(`apiPrefix = "${escapeRegExp(POCKET_RELAY_API_PREFIX)}"`, "u"));
  assert.match(swift, new RegExp(`maximumInlineFileBytes = ${MAX_INLINE_FILE_BYTES / 1024 / 1024} \\* 1024 \\* 1024`, "u"));

  const swiftCaseNames = {
    [PocketRelayAction.OPEN_LINK]: "openLink",
    [PocketRelayAction.SEND_FILE_TO_PC]: "sendFileToPC",
    [PocketRelayAction.FETCH_FILE_TO_IPHONE]: "fetchFileToIPhone",
    [PocketRelayAction.START_WORKFLOW]: "startWorkflow",
    [PocketRelayAction.PAUSE_WORKFLOW]: "pauseWorkflow",
    [PocketRelayAction.CANCEL_WORKFLOW]: "cancelWorkflow",
    [PocketRelayAction.GET_WORKFLOW_RESULT]: "getWorkflowResult",
    [PocketRelayAction.LOCK_PC]: "lockPC"
  };
  const descriptorBlock = actionBlock.slice(actionBlock.indexOf("var descriptor:"));
  for (const [action, descriptor] of Object.entries(POCKET_RELAY_ALLOWLIST)) {
    const start = descriptorBlock.indexOf(`case .${swiftCaseNames[action]}:`);
    const next = descriptorBlock.indexOf("case .", start + 6);
    const descriptorCase = descriptorBlock.slice(start, next < 0 ? descriptorBlock.length : next);
    assert.ok(start >= 0, `missing Swift descriptor for ${action}`);
    assert.match(descriptorCase, new RegExp(`scope: "${escapeRegExp(descriptor.scope)}"`, "u"));
    assert.match(descriptorCase, new RegExp(`risk: \\.${descriptor.risk}\\b`, "u"));
    assert.ok(descriptorCase.includes(`expectedEffect: "${descriptor.expectedEffect}"`));
  }
});

test("native result reconnect, file and receipt boundaries remain fail closed", async () => {
  const [contract, queue, security, client, view, viewModel] = await Promise.all([
    source("PocketRelay/PocketRelayContract.swift"),
    source("PocketRelay/PocketRelayQueue.swift"),
    source("PocketRelay/PocketRelaySecurity.swift"),
    source("PocketRelay/PocketRelayClient.swift"),
    source("PocketRelay/PocketRelayView.swift"),
    source("PocketRelay/PocketRelayViewModel.swift")
  ]);
  const all = [contract, queue, security, client, view, viewModel].join("\n");

  assert.match(contract, /case workflowResult\(workflowId: String, runId: String, knownRevision: Int\?\)/u);
  assert.match(contract, /encodeIfPresent\(knownRevision, forKey: \.knownRevision\)/u);
  assert.doesNotMatch(contract, /expectedRevision == 0/u);
  assert.ok(contract.includes("^[A-Za-z0-9!#$&^_.+-]{1,64}/[A-Za-z0-9!#$&^_.+-]{1,64}$"));

  assert.match(security, /Curve25519\.Signing\.PrivateKey/u);
  assert.match(security, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/u);
  assert.match(security, /response\.success == \(response\.state == \.completed && response\.error == nil\)/u);
  assert.match(security, /decoded\.transitions\.count >= 2/u);

  assert.match(queue, /\.completeFileProtection/u);
  assert.match(queue, /var approvedEffectFingerprint: String\?/u);
  assert.match(queue, /expectedEffectFingerprint: String\?/u);
  assert.match(queue, /excluding excludedRecordIDs: Set<UUID>/u);
  assert.match(queue, /let sourceDeviceId: String\?/u);
  assert.match(queue, /let targetDeviceId: String\?/u);
  assert.match(queue, /guard let storageKey = cursor\.storageKey/u);
  assert.match(viewModel, /knownRevision: cursor\.revision/u);
  assert.match(viewModel, /if response\.success/u);
  assert.match(viewModel, /struct PocketRelayApprovalDraft:/u);
  assert.match(viewModel, /let idempotencyKey: UUID/u);
  assert.match(viewModel, /idempotencyKey: draft\.idempotencyKey/u);
  assert.match(viewModel, /currentSessionMatches\(record\)/u);
  assert.match(viewModel, /settleVerifiedResponseFromStaleSession/u);
  assert.match(viewModel, /handleVerifiedControlFailure/u);
  assert.match(viewModel, /DEVICE_REVOKED/u);
  assert.match(viewModel, /RELAY_KILL_SWITCH_ACTIVE/u);
  assert.match(viewModel, /activeCommands\.isEmpty, processingCommands\.isEmpty/u);
  assert.match(view, /prepareCommandDraft\(\)/u);
  assert.match(view, /model\.enqueue\(draft: draft, explicitlyApproved: false\)/u);
  assert.match(view, /model\.retry\(approvalDraft: draft\)/u);
  assert.match(client, /validatedStoredSession/u);
  assert.match(client, /PocketRelayHostURLPolicy\.validate\(stored\.baseURL\.absoluteString\)/u);
  assert.match(client, /validateAccessTokenForm\(stored\.accessToken\)/u);
  assert.match(client, /URLSessionConfiguration\.ephemeral/u);
  assert.match(client, /completionHandler\(nil\)/u);
  assert.match(client, /maximumResponseBytes = 12 \* 1024 \* 1024/u);
  assert.match(client, /scheme == "https"/u);

  assert.doesNotMatch(all, /\b(?:UIPasteboard|NSPasteboard|NSTask|Process|posix_spawn|ShellExecute)\b/u);
  assert.doesNotMatch(all, /\b(?:clipboard|pasteboard)\b/iu);
  const queueRecord = queue.slice(
    queue.indexOf("struct PocketRelayQueueRecord:"),
    queue.indexOf("actor PocketRelayQueueStore")
  );
  assert.doesNotMatch(queueRecord, /\bData\b/u, "offline queue records must not persist file bodies");
});
