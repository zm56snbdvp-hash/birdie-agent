import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { runRecallSmoke } from "../scripts/birdie-recall-smoke.mjs";

const repositoryRoot = new URL("../", import.meta.url);

async function readSource(relativePath) {
  const source = await readFile(new URL(relativePath, repositoryRoot), "utf8");
  return source.replace(/\r\n?/g, "\n");
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

function declaredCases(source) {
  return [...source.matchAll(/^\s{4}case ([A-Za-z][A-Za-z0-9]*)$/gm)]
    .map((match) => match[1]);
}

const recallDirectory = new URL("clients/apple/BirdiePhone/Recall/", repositoryRoot);
const recallFilenames = (await readdir(recallDirectory))
  .filter((filename) => filename.endsWith(".swift"))
  .sort();
const recallSources = new Map(await Promise.all(
  recallFilenames.map(async (filename) => [filename, await readSource(
    `clients/apple/BirdiePhone/Recall/${filename}`
  )])
));
const recallCorpus = [...recallSources.entries()]
  .map(([filename, source]) => `// ${filename}\n${source}`)
  .join("\n");

const contracts = recallSources.get("RecallContracts.swift");
const localSearch = recallSources.get("RecallLocalSearch.swift");
const repository = recallSources.get("RecallRepository.swift");
const storage = recallSources.get("RecallStorage.swift");
const spotlight = recallSources.get("RecallSpotlightIndex.swift");
const vaultKeyStore = recallSources.get("RecallVaultKeyStore.swift");
const views = recallSources.get("RecallViews.swift");
const viewModel = recallSources.get("RecallViewModel.swift");

for (const [name, source] of [
  ["RecallContracts.swift", contracts],
  ["RecallLocalSearch.swift", localSearch],
  ["RecallRepository.swift", repository],
  ["RecallStorage.swift", storage],
  ["RecallSpotlightIndex.swift", spotlight],
  ["RecallVaultKeyStore.swift", vaultKeyStore],
  ["RecallViews.swift", views],
  ["RecallViewModel.swift", viewModel]
]) {
  assert.equal(typeof source, "string", `${name} must be present`);
}

test("Recall V1 intake is versioned and limited to explicit user-selected channels", () => {
  const channelBlock = between(
    contracts,
    "public enum RecallIntakeChannelV1",
    "public enum RecallItemKindV1"
  );
  assert.deepEqual(declaredCases(channelBlock), ["manualSelection", "birdieDrop"]);

  const kindBlock = between(
    contracts,
    "public enum RecallItemKindV1",
    "public struct RecallProvenanceV1"
  );
  assert.deepEqual(declaredCases(kindBlock), ["link", "screenshot", "photo", "pdf", "note"]);

  const captureBlock = between(
    contracts,
    "public struct CaptureItemV1",
    "public protocol BirdieRecallIntakeV1"
  );
  assert.match(captureBlock, /public static let currentContractVersion = 1/);
  assert.match(captureBlock, /public let id: UUID/);
  assert.match(captureBlock, /public let provenance: RecallProvenanceV1/);
  assert.match(captureBlock, /public let capturedAt: Date/);
  assert.match(captureBlock, /public let tags: \[String\]/);
  assert.match(captureBlock, /public let extractedText: String\?/);
  assert.match(captureBlock, /public let summary: String\?/);
  assert.match(captureBlock, /public let retention: RecallRetentionRequestV1/);
  assert.match(contracts, /`localFileURL` must point to a user-selected local file/);
  assert.match(contracts, /never uploads it/);
  assert.match(contracts, /func ingest\(_ capture: CaptureItemV1\) async throws -> RecallItemV1/);

  assert.match(views, /PhotosPicker\(selection: \$photoSelection, matching: \.images\)/);
  assert.match(views, /\.fileImporter\(/);

  const forbiddenAutomaticSources = [
    [/(?:import\s+Photos\b|\bPHPhotoLibrary\b)/, "whole photo-library access"],
    [/(?:\bUIPasteboard\b|\bNSPasteboard\b|\bgeneralPasteboard\b)/, "clipboard access"],
    [/(?:import\s+UserNotifications\b|\bUNUserNotificationCenter\b)/, "notification access"],
    [/(?:import\s+Messages\b|\bMSMessage\b)/, "message access"],
    [/(?:import\s+CloudKit\b|\bCKContainer\b)/, "CloudKit storage"],
    [/(?:\bURLSession\b|\buploadTask\b)/, "network upload path"]
  ];
  for (const [pattern, boundary] of forbiddenAutomaticSources) {
    assert.doesNotMatch(recallCorpus, pattern, `Recall must not add ${boundary}`);
  }

  const itemBlock = between(
    contracts,
    "public struct RecallItemV1",
    "public struct RecallSettingsV1"
  );
  for (const field of [
    "schemaVersion", "id", "kind", "title", "provenance", "capturedAt", "createdAt",
    "tags", "extractedText", "summary", "retention", "attachment"
  ]) {
    assert.match(itemBlock, new RegExp(`public (?:let|var) ${field}:`), `${field} must remain modeled`);
  }
  assert.match(itemBlock, /birdie:\/\/recall\/item\//);
});

test("Recall vault, attachments, key, and optional Spotlight index stay locally protected", () => {
  assert.match(storage, /import CryptoKit/);
  assert.match(storage, /AES\.GCM\.seal\(cleartext, using: encryptionKey\)/);
  assert.match(storage, /AES\.GCM\.SealedBox\(combined:/);
  assert.match(storage, /AES\.GCM\.open\(sealedBox, using: encryptionKey\)/);
  assert.match(storage, /Data\("BRV1"\.utf8\)/);
  assert.match(storage, /FileProtectionType\.complete/);
  assert.match(storage, /values\.isExcludedFromBackup = true/);
  assert.match(storage, /fileManager\.copyItem\(at: sourceURL, to: incomingURL\)/);
  assert.match(storage, /copiedByteCount <= Self\.maximumAttachmentBytes/);
  assert.match(storage, /CGImageSourceCreateWithURL/);
  assert.match(storage, /CGImageSourceCreateImageAtIndex/);
  assert.match(storage, /PDFDocument\(url: url\)/);
  assert.match(storage, /expectedRevision: UInt64\?/);
  assert.match(storage, /removeOrphanedAttachments\(referencedRelativePaths:/);
  assert.match(storage, /func removeAllAttachments\(\)/);
  assert.match(storage, /validatedAttachmentURL\(relativePath:/);

  assert.match(vaultKeyStore, /SecRandomCopyBytes\(/);
  assert.match(vaultKeyStore, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(vaultKeyStore, /existing\.count == 32/);

  assert.match(spotlight, /CSSearchableIndex\([\s\S]*?protectionClass: \.complete/);
  assert.match(spotlight, /attributes\.contentURL = item\.deepLinkURL/);
  assert.match(spotlight, /item\.retention\.expiresAt \?\? \.distantFuture/);
  assert.match(spotlight, /item\.tags \+ \[item\.kind\.rawValue\]/);
  assert.match(spotlight, /actor CoreSpotlightRecallIndex/);
  assert.match(spotlight, /await acquireExclusiveAccess\(\)/);
  assert.doesNotMatch(spotlight, /CSImportExtension|CSSearchableIndexDelegate/);
  assert.match(contracts, /isSpotlightEnabled: Bool = false/);
  assert.match(
    repository,
    /shouldIndex = state\.settings\.isEnabled && state\.settings\.isSpotlightEnabled/
  );

  assert.match(viewModel, /repository\.makePortableExport\(\)/);
  assert.match(viewModel, /activeOperations\.values\.forEach \{ \$0\.cancel\(\) \}/);
  assert.match(viewModel, /suspendedRepository\?\.suspendAccess\(\)/);
  assert.match(viewModel, /backgroundSuspensionTask\.value/);
  assert.match(repository, /LiveRecallRepositoryStore\.shared\.load\(\)/);
  assert.match(views, /\.completeFileProtection/);
  assert.equal(
    [...recallCorpus.matchAll(/makePortableExport\(\)/g)].length,
    2,
    "export must only exist as the repository API and the explicit UI action"
  );
});

test("deterministic local Hotel-gestern smoke remains available without semantic hardware", async () => {
  const filterBlock = between(
    contracts,
    "public struct RecallSearchFiltersV1",
    "public struct RecallSearchQueryV1"
  );
  assert.match(filterBlock, /sourceChannels: Set<RecallIntakeChannelV1>/);
  assert.match(filterBlock, /kinds: Set<RecallItemKindV1>/);
  assert.match(filterBlock, /capturedFrom: Date\?/);
  assert.match(filterBlock, /capturedBefore: Date\?/);
  assert.match(contracts, /public protocol BirdieRecallSearchV1/);

  assert.match(localSearch, /"gestern"[\s\S]*?"yesterday"/);
  assert.match(localSearch, /containsWord\("gestern", in: normalized\)/);
  assert.match(localSearch, /dayOffset = -1/);
  assert.match(localSearch, /calendar\.startOfDay\(for: target\)/);
  assert.match(localSearch, /if lhs\.score != rhs\.score \{ return lhs\.score > rhs\.score \}/);
  assert.match(localSearch, /return lhs\.item\.id\.uuidString < rhs\.item\.id\.uuidString/);

  const searchBlock = between(
    repository,
    "public func search(_ query: RecallSearchQueryV1)",
    "@discardableResult\n    public func forget(_ identifier: UUID)"
  );
  assert.match(searchBlock, /let deterministicResults = try RecallDeterministicSearch\.search/);
  assert.match(searchBlock, /semanticRanker\.rerank\(/);
  assert.match(searchBlock, /state\.revision != searchRevision/);
  assert.match(searchBlock, /guard state\.settings\.isEnabled else/);
  assert.match(searchBlock, /catch \{[\s\S]*?return deterministicResults/);

  const swiftSmokeTests = await readSource(
    "clients/apple/BirdiePhoneTests/RecallExportSmokeTests.swift"
  );
  assert.match(swiftSmokeTests, /77777777-7777-4777-8777-777777777777/);
  assert.match(swiftSmokeTests, /Wo war das Hotel von gestern\?/);
  assert.match(swiftSmokeTests, /XCTAssertEqual\(hits\.map\(\\\.id\), \[hotelID\]\)/);
  assert.match(swiftSmokeTests, /XCTAssertFalse\(remainsIndexed\)/);

  const result = await runRecallSmoke();
  assert.deepEqual(result.hitIdentifiers, ["77777777-7777-4777-8777-777777777777"]);
  assert.deepEqual(result.matchedTerms, ["hotel"]);
  assert.equal(result.deletedIdentifier, "77777777-7777-4777-8777-777777777777");
  assert.equal(result.localIndexContainsDeletedIdentifier, false);
  assert.equal(result.deletionOperationIdentifier, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("forget, retention, mass deletion, and kill switch clean indices with audit receipts", async () => {
  const deleteBlock = between(
    repository,
    "private func delete(",
    "private func resumePendingDeletions()"
  );
  const removeFromPendingIndex = deleteBlock.indexOf("pendingState.localIndex.remove(uniqueIDs)");
  const commitPendingState = deleteBlock.indexOf("try commit(pendingState)");
  assert.ok(removeFromPendingIndex >= 0 && removeFromPendingIndex < commitPendingState);
  assert.match(deleteBlock, /pendingDeletion = operation/);
  assert.match(deleteBlock, /status: \.pendingDeletion/);

  const finalizeBlock = between(
    repository,
    "private func finalizePendingDeletion(",
    "private func synchronizeExternalIndex()"
  );
  for (const marker of [
    "try disk.removeAttachment(relativePath: record.attachmentRelativePath)",
    "completed.items.removeAll",
    "completed.localIndex.remove(identifiers)",
    "completed.deletionReceipts.append(receipt)",
    "try commit(completed)"
  ]) {
    assert.notEqual(finalizeBlock.indexOf(marker), -1, `${marker} must remain in final deletion`);
  }
  assert.ok(
    finalizeBlock.indexOf("try disk.removeAttachment") < finalizeBlock.indexOf("try commit(completed)"),
    "original attachment removal must precede completion"
  );

  const killSwitchBlock = between(
    repository,
    "public func engageKillSwitch()",
    "public func enableRecall()"
  );
  assert.match(killSwitchBlock, /disableRecallForKillSwitch/);
  assert.match(repository, /state\.settings\.isEnabled = false/);
  assert.match(repository, /state\.settings\.isSpotlightEnabled = false/);
  assert.match(killSwitchBlock, /scope: \.killSwitch/);
  assert.doesNotMatch(killSwitchBlock, /try commit\(/);
  assert.match(repository, /Unterbrochene Kill-Switch-Löschung fortgesetzt/);
  assert.match(
    repository,
    /loaded\.requiresExternalIndexSync = loaded\.requiresExternalIndexSync \|\|/
  );
  assert.match(repository, /public func forgetAll\(\)/);
  assert.match(repository, /public func purgeExpired\(\)/);
  assert.match(repository, /state\.deletionReceipts\.sorted/);

  const synchronizeBlock = repository.slice(repository.indexOf("private func synchronizeExternalIndex()"));
  assert.match(synchronizeBlock, /try await externalIndex\.removeAll\(\)/);
  assert.match(synchronizeBlock, /synchronized\.requiresExternalIndexSync = false/);
  assert.match(spotlight, /deleteSearchableItems\(withDomainIdentifiers:/);

  const deletionTests = await readSource(
    "clients/apple/BirdiePhoneTests/RecallDeletionTests.swift"
  );
  assert.match(deletionTests, /testSingleDeletionRemovesOriginalLocalIndexAndSpotlight/);
  assert.match(deletionTests, /testMassDeletionAndKillSwitchAreAuditedAndBlockAccess/);
  assert.match(deletionTests, /testExpiredItemsUseTheSameAuditedDeletionPathAfterRestart/);
  assert.match(deletionTests, /testStartupRemovesOrphanedOriginalButPreservesReferencedAttachment/);
  assert.match(deletionTests, /testInterruptedKillSwitchStateIsRecoveredAndRemovesEveryOriginal/);
  assert.match(deletionTests, /testLocalIndexRepairPreservesPendingSpotlightCleanupMarker/);
  assert.match(deletionTests, /testBlockedExternalSyncCannotOverwriteNewerIntakeRevision/);
  assert.match(deletionTests, /testStaleRepositoryInstanceCannotOverwriteNewerVaultRevision/);
  const privacyTests = await readSource(
    "clients/apple/BirdiePhoneTests/RecallIntakePrivacyTests.swift"
  );
  assert.match(privacyTests, /testClaimedImageAndPDFTypesRejectUndecodableContentWithoutOrphans/);
});

test("both XcodeGen projects and Apple workflows run unsigned BirdiePhone tests and builds", async () => {
  const [project, personalProject, appleWorkflow, personalWorkflow] = await Promise.all([
    readSource("clients/apple/project.yml"),
    readSource("clients/apple/project.personal.yml"),
    readSource(".github/workflows/apple-build.yml"),
    readSource(".github/workflows/apple-personal-project.yml")
  ]);

  for (const [name, spec, scheme] of [
    ["project.yml", project, "Birdie"],
    ["project.personal.yml", personalProject, "BirdiePersonal"]
  ]) {
    const testTarget = between(spec, "  BirdiePhoneTests:", "\n  BirdieWatch:");
    assert.match(testTarget, /type: bundle\.unit-test/, `${name} must define a unit-test bundle`);
    assert.match(testTarget, /- path: BirdiePhoneTests/);
    assert.match(testTarget, /- target: BirdiePhone/);
    assert.match(testTarget, /TEST_HOST: "\$\(BUILT_PRODUCTS_DIR\)\/Birdie\.app\/Birdie"/);
    assert.match(testTarget, /BUNDLE_LOADER: "\$\(TEST_HOST\)"/);
    const schemeBlock = spec.slice(spec.indexOf(`  ${scheme}:`));
    assert.match(schemeBlock, /test:\n\s+config: Debug\n\s+targets:\n\s+- BirdiePhoneTests/);
  }

  for (const [name, workflow, generateCommand, projectName, scheme] of [
    ["apple-build.yml", appleWorkflow, "xcodegen generate", "Birdie.xcodeproj", "Birdie"],
    [
      "apple-personal-project.yml",
      personalWorkflow,
      "xcodegen generate --spec project.personal.yml",
      "BirdiePersonal.xcodeproj",
      "BirdiePersonal"
    ]
  ]) {
    assert.match(workflow, new RegExp(`run: ${generateCommand.replaceAll(".", "\\.")}`));
    const unitTestStep = between(
      workflow,
      "- name: Run BirdiePhone unit tests",
      name === "apple-build.yml"
        ? "- name: Build without signing"
        : "- name: Verify project without signing"
    );
    assert.match(unitTestStep, new RegExp(`-project ${projectName.replace(".", "\\.")}`));
    assert.match(unitTestStep, new RegExp(`-scheme ${scheme}`));
    assert.match(unitTestStep, /CODE_SIGNING_ALLOWED=NO/);
    assert.match(unitTestStep, /CODE_SIGNING_REQUIRED=NO/);
    assert.match(unitTestStep, /\n\s+test\s*$/);

    const buildStep = workflow.slice(workflow.indexOf(
      name === "apple-build.yml" ? "- name: Build without signing" : "- name: Verify project without signing"
    ));
    assert.match(buildStep, /CODE_SIGNING_ALLOWED=NO/);
    assert.match(buildStep, /CODE_SIGNING_REQUIRED=NO/);
    assert.match(buildStep, /\n\s+build(?:\n|$)/);
  }

  assert.match(personalWorkflow, /- name: Run repository tests\n\s+run: npm test/);
});
