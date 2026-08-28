import CryptoKit
import Foundation
import UniformTypeIdentifiers

public actor RecallRepository: BirdieRecallIntakeV1, BirdieRecallSearchV1 {
    private let disk: RecallProtectedDisk
    private let externalIndex: any RecallExternalIndexing
    private let semanticRanker: any RecallSemanticRanking
    private let textExtractor: any RecallTextExtracting
    private let now: @Sendable () -> Date
    private let calendar: Calendar
    private var state: RecallDiskStateV1
    private var accessEpoch: UInt64 = 0

    public static func live() async throws -> RecallRepository {
        try await LiveRecallRepositoryStore.shared.load()
    }

    fileprivate static func makeLiveRepository() throws -> RecallRepository {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let root = base
            .appendingPathComponent("BirdieRecall", isDirectory: true)
            .appendingPathComponent("V1", isDirectory: true)
        return try RecallRepository(
            rootDirectory: root,
            keyProvider: KeychainRecallVaultKeyProvider(),
            externalIndex: CoreSpotlightRecallIndex(),
            semanticRanker: NoopRecallSemanticRanker(),
            textExtractor: LocalRecallTextExtractor(),
            now: Date.init,
            calendar: .autoupdatingCurrent
        )
    }

    init(
        rootDirectory: URL,
        keyProvider: any RecallVaultKeyProviding,
        externalIndex: any RecallExternalIndexing = NoopRecallExternalIndex(),
        semanticRanker: any RecallSemanticRanking = NoopRecallSemanticRanker(),
        textExtractor: any RecallTextExtracting = NoopRecallTextExtractor(),
        now: @escaping @Sendable () -> Date = Date.init,
        calendar: Calendar = .autoupdatingCurrent
    ) throws {
        let encryptionKey = try keyProvider.loadOrCreateKey()
        let disk = RecallProtectedDisk(rootDirectory: rootDirectory, encryptionKey: encryptionKey)
        try disk.prepare()

        var loaded = try disk.loadState(now: now())
        let persistedRevision = loaded.revision
        let activeItems = loaded.items.filter { $0.pendingDeletion == nil }.map(\.item)
        let expectedIDs = Set(activeItems.map(\.id))
        if loaded.localIndex.itemIdentifiers != expectedIDs {
            loaded.localIndex = .rebuilding(from: activeItems)
            loaded.requiresExternalIndexSync = loaded.requiresExternalIndexSync ||
                loaded.settings.isSpotlightEnabled
            loaded.revision &+= 1
        }

        self.disk = disk
        self.externalIndex = externalIndex
        self.semanticRanker = semanticRanker
        self.textExtractor = textExtractor
        self.now = now
        self.calendar = calendar
        self.state = loaded
        try disk.saveState(loaded, expectedRevision: persistedRevision)
    }

    public func prepareForUse() async throws {
        try disk.removeOrphanedAttachments(
            referencedRelativePaths: state.items.compactMap(\.attachmentRelativePath)
        )
        try await resumePendingDeletions()
        if !state.settings.isEnabled, !state.items.isEmpty {
            let changedAt = now()
            _ = try await delete(
                identifiers: state.items.map(\.id),
                scope: .killSwitch,
                reason: "Unterbrochene Kill-Switch-Löschung fortgesetzt",
                prepareState: { state in
                    Self.disableRecallForKillSwitch(&state, changedAt: changedAt)
                }
            )
        }
        _ = try await purgeExpired()
        if state.requiresExternalIndexSync || state.settings.isSpotlightEnabled {
            try await synchronizeExternalIndex()
        }
    }

    public func currentSettings() -> RecallSettingsV1 {
        state.settings
    }

    public func allItems() -> [RecallItemV1] {
        let currentTime = now()
        return state.items
            .filter { record in
                record.pendingDeletion == nil &&
                    (record.item.retention.expiresAt.map { $0 > currentTime } ?? true)
            }
            .map(\.item)
            .sorted {
                if $0.capturedAt != $1.capturedAt { return $0.capturedAt > $1.capturedAt }
                return $0.id.uuidString < $1.id.uuidString
            }
    }

    public func deletionHistory() -> [RecallDeletionReceiptV1] {
        state.deletionReceipts.sorted { $0.completedAt > $1.completedAt }
    }

    func suspendAccess() {
        accessEpoch &+= 1
    }

    @discardableResult
    public func ingest(_ capture: CaptureItemV1) async throws -> RecallItemV1 {
        guard state.settings.isEnabled else { throw BirdieRecallError.disabled }
        let intakeAccessEpoch = accessEpoch
        let validated = try validate(capture)
        let sourceInspection = try validated.localFileURL.map(disk.inspectAttachmentSource)
        let fingerprint = try intakeFingerprint(for: validated, sourceInspection: sourceInspection)

        if let existing = state.items.first(where: { $0.id == validated.id }) {
            guard existing.intakeFingerprint == fingerprint else {
                throw BirdieRecallError.duplicateConflict(validated.id)
            }
            return existing.item
        }

        let createdAt = now()
        let retention = try resolveRetention(validated.retention, createdAt: createdAt)
        let intakeRevision = state.revision
        let locallyExtractedText: String?
        if validated.extractedText == nil, let sourceURL = validated.localFileURL {
            do {
                locallyExtractedText = try await textExtractor.extractText(
                    from: sourceURL,
                    kind: validated.kind
                )
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                locallyExtractedText = nil
            }
        } else {
            locallyExtractedText = nil
        }

        // Text extraction is an actor suspension point. Recheck the stable ID before copying.
        if let existing = state.items.first(where: { $0.id == validated.id }) {
            guard existing.intakeFingerprint == fingerprint else {
                throw BirdieRecallError.duplicateConflict(validated.id)
            }
            return existing.item
        }
        try Task.checkCancellation()
        guard state.settings.isEnabled else { throw BirdieRecallError.disabled }
        guard accessEpoch == intakeAccessEpoch else { throw CancellationError() }
        guard state.revision == intakeRevision else { throw BirdieRecallError.intakeInterrupted }
        var importedAttachment: RecallImportedAttachment?
        if let sourceURL = validated.localFileURL {
            importedAttachment = try disk.importAttachment(
                from: sourceURL,
                itemID: validated.id,
                kind: validated.kind
            )
            if let sourceInspection,
               (sourceInspection.byteCount != importedAttachment?.metadata.byteCount ||
                sourceInspection.sha256 != importedAttachment?.metadata.sha256) {
                try? disk.removeAttachment(relativePath: importedAttachment?.relativePath)
                throw BirdieRecallError.invalidPayload("Die ausgewählte Datei hat sich während der Übernahme verändert.")
            }
        }

        let item = RecallItemV1(
            schemaVersion: RecallItemV1.currentSchemaVersion,
            id: validated.id,
            kind: validated.kind,
            title: validated.title,
            provenance: validated.provenance,
            capturedAt: validated.capturedAt,
            createdAt: createdAt,
            tags: validated.tags,
            note: validated.note,
            linkURL: validated.linkURL,
            extractedText: validated.extractedText ?? locallyExtractedText,
            summary: validated.summary,
            retention: retention,
            attachment: importedAttachment?.metadata
        )
        let record = RecallStoredItemV1(
            item: item,
            attachmentRelativePath: importedAttachment?.relativePath,
            intakeFingerprint: fingerprint,
            pendingDeletion: nil
        )

        var updated = state
        updated.items.append(record)
        updated.localIndex.upsert(item)
        if updated.settings.isSpotlightEnabled { updated.requiresExternalIndexSync = true }
        do {
            try commit(updated)
        } catch {
            try? disk.removeAttachment(relativePath: importedAttachment?.relativePath)
            throw error
        }

        if state.requiresExternalIndexSync {
            try await synchronizeExternalIndex()
        }
        return item
    }

    public func search(_ query: RecallSearchQueryV1) async throws -> [RecallSearchResultV1] {
        guard state.settings.isEnabled else { throw BirdieRecallError.disabled }
        try await purgeExpiredWithoutBlockingLocalFeatures()
        let searchRevision = state.revision
        let deterministicResults = try RecallDeterministicSearch.search(
            query: query,
            records: state.items.filter { record in
                record.item.retention.expiresAt.map { $0 > now() } ?? true
            },
            index: state.localIndex,
            now: now(),
            calendar: calendar
        )
        let semanticResults: [RecallSearchResultV1]?
        do {
            semanticResults = try await semanticRanker.rerank(
                query: query,
                deterministicResults: deterministicResults
            )
        } catch {
            // Optional adapters may never make Recall search unavailable or non-deterministic.
            semanticResults = nil
        }

        // Ranking is a suspension point. Never return items deleted while an optional
        // adapter was running, and never leak a pre-kill-switch snapshot.
        guard state.settings.isEnabled else { throw BirdieRecallError.disabled }
        if state.revision != searchRevision {
            let refreshedAt = now()
            return try RecallDeterministicSearch.search(
                query: query,
                records: state.items.filter { record in
                    record.pendingDeletion == nil &&
                        (record.item.retention.expiresAt.map { $0 > refreshedAt } ?? true)
                },
                index: state.localIndex,
                now: refreshedAt,
                calendar: calendar
            )
        }
        guard let semanticResults else { return deterministicResults }
        return safeSemanticOrdering(semanticResults, baseline: deterministicResults)
    }

    @discardableResult
    public func forget(_ identifier: UUID) async throws -> RecallDeletionReceiptV1 {
        guard state.items.contains(where: { $0.id == identifier }) else {
            throw BirdieRecallError.itemNotFound(identifier)
        }
        return try await delete(
            identifiers: [identifier],
            scope: .singleItem,
            reason: "Vom Nutzer einzeln vergessen"
        )
    }

    @discardableResult
    public func forget(_ identifiers: Set<UUID>) async throws -> RecallDeletionReceiptV1 {
        let existing = identifiers.filter { id in state.items.contains(where: { $0.id == id }) }
        guard !existing.isEmpty else {
            throw BirdieRecallError.invalidPayload("Keine vorhandenen Recall-Elemente ausgewählt.")
        }
        return try await delete(
            identifiers: existing.sorted { $0.uuidString < $1.uuidString },
            scope: .selectedItems,
            reason: "Vom Nutzer gesammelt vergessen"
        )
    }

    @discardableResult
    public func forgetAll() async throws -> RecallDeletionReceiptV1 {
        try await delete(
            identifiers: state.items.map(\.id),
            scope: .allItems,
            reason: "Vom Nutzer vollständig gelöscht"
        )
    }

    @discardableResult
    public func purgeExpired() async throws -> RecallDeletionReceiptV1? {
        let currentTime = now()
        let expired = state.items.compactMap { record -> UUID? in
            guard record.pendingDeletion == nil,
                  let expiresAt = record.item.retention.expiresAt,
                  expiresAt <= currentTime
            else { return nil }
            return record.id
        }
        guard !expired.isEmpty else { return nil }
        return try await delete(
            identifiers: expired,
            scope: .expiredItems,
            reason: "Aufbewahrungsdauer abgelaufen"
        )
    }

    @discardableResult
    public func engageKillSwitch() async throws -> RecallDeletionReceiptV1 {
        let changedAt = now()
        return try await delete(
            identifiers: state.items.map(\.id),
            scope: .killSwitch,
            reason: "Recall-Kill-Switch aktiviert",
            prepareState: { state in
                Self.disableRecallForKillSwitch(&state, changedAt: changedAt)
            }
        )
    }

    public func enableRecall() throws {
        var updated = state
        updated.settings.isEnabled = true
        updated.settings.changedAt = now()
        try commit(updated)
    }

    public func setSpotlightEnabled(_ enabled: Bool) async throws {
        var updated = state
        updated.settings.isSpotlightEnabled = enabled
        updated.settings.changedAt = now()
        updated.requiresExternalIndexSync = true
        try commit(updated)
        try await synchronizeExternalIndex()
    }

    public func setDefaultRetentionDays(_ days: Int?, applyToExisting: Bool) async throws {
        if let days, !(1...3_650).contains(days) { throw BirdieRecallError.invalidRetention }
        let changedAt = now()
        var updated = state
        updated.settings.defaultRetentionDays = days
        updated.settings.changedAt = changedAt

        if applyToExisting {
            for index in updated.items.indices where updated.items[index].pendingDeletion == nil {
                let expiration = days.flatMap { calendar.date(byAdding: .day, value: $0, to: changedAt) }
                updated.items[index].item.retention = RecallRetentionV1(
                    status: expiration == nil ? .kept : .expires,
                    expiresAt: expiration
                )
            }
            if updated.settings.isSpotlightEnabled { updated.requiresExternalIndexSync = true }
        }
        try commit(updated)
        _ = try await purgeExpired()
        if state.requiresExternalIndexSync { try await synchronizeExternalIndex() }
    }

    public func makePortableExport() async throws -> RecallPortableExportV1 {
        try await purgeExpiredWithoutBlockingLocalFeatures()
        let exportTime = now()
        let records = state.items.filter { record in
            record.pendingDeletion == nil &&
                (record.item.retention.expiresAt.map { $0 > exportTime } ?? true)
        }
        var attachments: [String: Data] = [:]
        var attachmentKeys: [String: String] = [:]
        for record in records {
            guard let relativePath = record.attachmentRelativePath else { continue }
            let key = "attachment:\(record.id.uuidString.lowercased())"
            attachments[key] = try disk.attachmentData(relativePath: relativePath)
            attachmentKeys[record.id.uuidString.lowercased()] = key
        }
        return RecallPortableExportV1(
            manifest: RecallExportManifestV1(
                schemaVersion: RecallExportManifestV1.currentSchemaVersion,
                exportedAt: exportTime,
                settings: state.settings,
                items: records.map(\.item),
                deletionReceipts: state.deletionReceipts,
                attachmentKeys: attachmentKeys
            ),
            attachments: attachments
        )
    }

    func containsInLocalIndex(_ identifier: UUID) -> Bool {
        state.localIndex.itemIdentifiers.contains(identifier)
    }

    private func delete(
        identifiers: [UUID],
        scope: RecallDeletionScopeV1,
        reason: String,
        prepareState: ((inout RecallDiskStateV1) -> Void)? = nil
    ) async throws -> RecallDeletionReceiptV1 {
        let uniqueIDs = Array(Set(identifiers)).sorted { $0.uuidString < $1.uuidString }
        let requestedAt = now()
        let operation = RecallPendingDeletionV1(
            operationIdentifier: UUID(),
            scope: scope,
            reason: reason,
            requestedAt: requestedAt
        )

        if uniqueIDs.isEmpty {
            if scope == .killSwitch { try disk.removeAllAttachments() }
            let receipt = RecallDeletionReceiptV1(
                id: UUID(),
                operationIdentifier: operation.operationIdentifier,
                scope: scope,
                reason: reason,
                requestedAt: requestedAt,
                completedAt: now(),
                itemIdentifiers: []
            )
            var updated = state
            prepareState?(&updated)
            updated.deletionReceipts.append(receipt)
            if scope == .killSwitch { updated.requiresExternalIndexSync = true }
            try commit(updated)
            if state.requiresExternalIndexSync { try await synchronizeExternalIndex() }
            return receipt
        }

        var pendingState = state
        prepareState?(&pendingState)
        for index in pendingState.items.indices where uniqueIDs.contains(pendingState.items[index].id) {
            pendingState.items[index].pendingDeletion = operation
            pendingState.items[index].item.retention = RecallRetentionV1(
                status: .pendingDeletion,
                expiresAt: pendingState.items[index].item.retention.expiresAt
            )
        }
        pendingState.localIndex.remove(uniqueIDs)
        if pendingState.settings.isSpotlightEnabled || pendingState.requiresExternalIndexSync || scope == .killSwitch {
            pendingState.requiresExternalIndexSync = true
        }
        try commit(pendingState)

        return try await finalizePendingDeletion(operationIdentifier: operation.operationIdentifier)
    }

    private func resumePendingDeletions() async throws {
        let operations = Set(state.items.compactMap { $0.pendingDeletion?.operationIdentifier })
        for operationIdentifier in operations.sorted(by: { $0.uuidString < $1.uuidString }) {
            _ = try await finalizePendingDeletion(operationIdentifier: operationIdentifier)
        }
    }

    private func finalizePendingDeletion(operationIdentifier: UUID) async throws -> RecallDeletionReceiptV1 {
        let records = state.items.filter {
            $0.pendingDeletion?.operationIdentifier == operationIdentifier
        }
        guard let operation = records.first?.pendingDeletion else {
            if let existing = state.deletionReceipts.first(where: {
                $0.operationIdentifier == operationIdentifier
            }) {
                return existing
            }
            throw BirdieRecallError.persistence("Offene Löschoperation ohne Datensatz.")
        }

        for record in records {
            try disk.removeAttachment(relativePath: record.attachmentRelativePath)
        }
        if operation.scope == .killSwitch {
            try disk.removeAllAttachments()
        }

        let identifiers = records.map(\.id).sorted { $0.uuidString < $1.uuidString }
        let receipt = RecallDeletionReceiptV1(
            id: UUID(),
            operationIdentifier: operation.operationIdentifier,
            scope: operation.scope,
            reason: operation.reason,
            requestedAt: operation.requestedAt,
            completedAt: now(),
            itemIdentifiers: identifiers
        )
        var completed = state
        completed.items.removeAll { identifiers.contains($0.id) }
        completed.localIndex.remove(identifiers)
        if !completed.deletionReceipts.contains(where: {
            $0.operationIdentifier == operation.operationIdentifier
        }) {
            completed.deletionReceipts.append(receipt)
        }
        try commit(completed)

        if state.requiresExternalIndexSync {
            try await synchronizeExternalIndex()
        }
        return receipt
    }

    private func synchronizeExternalIndex() async throws {
        for _ in 0..<3 {
            let revision = state.revision
            let shouldIndex = state.settings.isEnabled && state.settings.isSpotlightEnabled
            let syncTime = now()
            let activeItems = state.items.filter { record in
                record.pendingDeletion == nil &&
                    (record.item.retention.expiresAt.map { $0 > syncTime } ?? true)
            }.map(\.item)
            do {
                try await externalIndex.removeAll()
                if shouldIndex { try await externalIndex.upsert(activeItems) }
            } catch {
                throw BirdieRecallError.externalIndexCleanup(error.localizedDescription)
            }

            // Actor methods are reentrant at each await. Never clear a newer dirty revision.
            guard state.revision == revision else { continue }
            var synchronized = state
            synchronized.requiresExternalIndexSync = false
            try commit(synchronized)
            return
        }
        throw BirdieRecallError.externalIndexCleanup(
            "Der Index wurde während der Bereinigung wiederholt geändert; ein späterer Start versucht es erneut."
        )
    }

    private func purgeExpiredWithoutBlockingLocalFeatures() async throws {
        do {
            _ = try await purgeExpired()
        } catch let error as BirdieRecallError {
            guard case .externalIndexCleanup = error else { throw error }
            // The encrypted state and local index are already clean. Keep local search/export
            // available; the persisted dirty marker retries optional Spotlight on next use.
        }
    }

    private func safeSemanticOrdering(
        _ proposed: [RecallSearchResultV1],
        baseline: [RecallSearchResultV1]
    ) -> [RecallSearchResultV1] {
        let baselineByIdentifier = Dictionary(uniqueKeysWithValues: baseline.map { ($0.id, $0) })
        var seen: Set<UUID> = []
        var ordered = proposed.compactMap { candidate -> RecallSearchResultV1? in
            guard seen.insert(candidate.id).inserted else { return nil }
            // An adapter may reorder only. Stored content, scores and matched terms remain
            // the locally computed values and it may not introduce an unknown item.
            return baselineByIdentifier[candidate.id]
        }
        ordered.append(contentsOf: baseline.filter { seen.insert($0.id).inserted })
        return ordered
    }

    private static func disableRecallForKillSwitch(
        _ state: inout RecallDiskStateV1,
        changedAt: Date
    ) {
        state.settings.isEnabled = false
        state.settings.isSpotlightEnabled = false
        state.settings.changedAt = changedAt
        state.requiresExternalIndexSync = true
    }

    private func commit(_ newState: RecallDiskStateV1) throws {
        var versionedState = newState
        versionedState.revision = state.revision &+ 1
        try disk.saveState(versionedState, expectedRevision: state.revision)
        state = versionedState
    }

    private func resolveRetention(
        _ request: RecallRetentionRequestV1,
        createdAt: Date
    ) throws -> RecallRetentionV1 {
        let expiration: Date?
        switch request {
        case .defaultPolicy:
            expiration = state.settings.defaultRetentionDays.flatMap {
                calendar.date(byAdding: .day, value: $0, to: createdAt)
            }
        case .keepForever:
            expiration = nil
        case .until(let date):
            guard date > createdAt else { throw BirdieRecallError.invalidRetention }
            expiration = date
        }
        return RecallRetentionV1(
            status: expiration == nil ? .kept : .expires,
            expiresAt: expiration
        )
    }

    private func validate(_ capture: CaptureItemV1) throws -> CaptureItemV1 {
        guard capture.contractVersion == CaptureItemV1.currentContractVersion else {
            throw BirdieRecallError.invalidContractVersion(capture.contractVersion)
        }

        let title = capture.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 500 else {
            throw BirdieRecallError.invalidPayload("Ein Titel mit höchstens 500 Zeichen ist erforderlich.")
        }
        let note = try normalizedOptionalText(capture.note, name: "Notiz", maximum: 200_000)
        let extractedText = try normalizedOptionalText(
            capture.extractedText,
            name: "Extrahierter Text",
            maximum: 500_000
        )
        let summary = try normalizedOptionalText(capture.summary, name: "Zusammenfassung", maximum: 20_000)
        let tags = try normalizedTags(capture.tags)
        let sourceApplication = try normalizedOptionalText(
            capture.provenance.sourceApplication,
            name: "Quell-App",
            maximum: 200
        )
        let sourceItemIdentifier = try normalizedOptionalText(
            capture.provenance.sourceItemIdentifier,
            name: "Quell-ID",
            maximum: 500
        )
        let provenance = RecallProvenanceV1(
            channel: capture.provenance.channel,
            sourceApplication: sourceApplication,
            sourceItemIdentifier: sourceItemIdentifier,
            submittedAt: capture.provenance.submittedAt
        )

        var contentTypeIdentifier = capture.contentTypeIdentifier?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        switch capture.kind {
        case .note:
            guard let note, capture.linkURL == nil, capture.localFileURL == nil else {
                throw BirdieRecallError.invalidPayload("Eine Notiz benötigt ausschließlich Notiztext.")
            }
            return CaptureItemV1(
                contractVersion: capture.contractVersion,
                id: capture.id,
                kind: capture.kind,
                title: title,
                provenance: provenance,
                capturedAt: capture.capturedAt,
                tags: tags,
                note: note,
                extractedText: extractedText,
                summary: summary,
                retention: capture.retention
            )
        case .link:
            guard let link = capture.linkURL, capture.note == nil, capture.localFileURL == nil else {
                throw BirdieRecallError.invalidPayload("Ein Link benötigt ausschließlich eine vollständige URL.")
            }
            guard let scheme = link.scheme?.lowercased(),
                  ["http", "https"].contains(scheme),
                  link.host != nil
            else { throw BirdieRecallError.unsupportedLinkScheme }
            return CaptureItemV1(
                contractVersion: capture.contractVersion,
                id: capture.id,
                kind: capture.kind,
                title: title,
                provenance: provenance,
                capturedAt: capture.capturedAt,
                tags: tags,
                linkURL: link,
                extractedText: extractedText,
                summary: summary,
                retention: capture.retention
            )
        case .screenshot, .photo, .pdf:
            guard let fileURL = capture.localFileURL,
                  capture.note == nil,
                  capture.linkURL == nil,
                  fileURL.isFileURL
            else {
                throw BirdieRecallError.invalidPayload("Dieser Typ benötigt eine bewusst ausgewählte lokale Datei.")
            }
            if contentTypeIdentifier?.isEmpty != false {
                contentTypeIdentifier = UTType(filenameExtension: fileURL.pathExtension)?.identifier
            }
            guard let contentTypeIdentifier,
                  let contentType = UTType(contentTypeIdentifier)
            else {
                throw BirdieRecallError.invalidPayload("Der lokale Dateityp ist unbekannt.")
            }
            if capture.kind == .pdf, !contentType.conforms(to: .pdf) {
                throw BirdieRecallError.invalidPayload("Ein PDF-Element muss eine PDF-Datei enthalten.")
            }
            if capture.kind != .pdf, !contentType.conforms(to: .image) {
                throw BirdieRecallError.invalidPayload("Foto und Screenshot müssen eine Bilddatei enthalten.")
            }
            return CaptureItemV1(
                contractVersion: capture.contractVersion,
                id: capture.id,
                kind: capture.kind,
                title: title,
                provenance: provenance,
                capturedAt: capture.capturedAt,
                tags: tags,
                localFileURL: fileURL,
                contentTypeIdentifier: contentTypeIdentifier,
                extractedText: extractedText,
                summary: summary,
                retention: capture.retention
            )
        }
    }

    private func normalizedOptionalText(
        _ value: String?,
        name: String,
        maximum: Int
    ) throws -> String? {
        guard let value else { return nil }
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return nil }
        guard cleaned.count <= maximum else {
            throw BirdieRecallError.invalidPayload("\(name) überschreitet \(maximum) Zeichen.")
        }
        return cleaned
    }

    private func normalizedTags(_ tags: [String]) throws -> [String] {
        guard tags.count <= 20 else {
            throw BirdieRecallError.invalidPayload("Höchstens 20 Tags sind erlaubt.")
        }
        var seen: Set<String> = []
        var result: [String] = []
        for tag in tags {
            let cleaned = tag.trimmingCharacters(in: .whitespacesAndNewlines)
            guard cleaned.count <= 50 else {
                throw BirdieRecallError.invalidPayload("Ein Tag überschreitet 50 Zeichen.")
            }
            guard !cleaned.isEmpty else { continue }
            let key = RecallTextNormalizer.normalized(cleaned)
            if seen.insert(key).inserted { result.append(cleaned) }
        }
        return result.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private func intakeFingerprint(
        for capture: CaptureItemV1,
        sourceInspection: RecallSourceFileInspection?
    ) throws -> String {
        let payload = RecallIntakeFingerprintPayload(
            contractVersion: capture.contractVersion,
            id: capture.id,
            kind: capture.kind,
            title: capture.title,
            provenance: capture.provenance,
            capturedAt: capture.capturedAt,
            tags: capture.tags,
            note: capture.note,
            linkURL: capture.linkURL,
            contentTypeIdentifier: capture.contentTypeIdentifier,
            extractedText: capture.extractedText,
            summary: capture.summary,
            retention: capture.retention,
            sourceFilename: sourceInspection?.filename,
            sourceByteCount: sourceInspection?.byteCount,
            sourceSHA256: sourceInspection?.sha256
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private actor LiveRecallRepositoryStore {
    static let shared = LiveRecallRepositoryStore()
    private var repository: RecallRepository?

    func load() throws -> RecallRepository {
        if let repository { return repository }
        let created = try RecallRepository.makeLiveRepository()
        repository = created
        return created
    }
}

private struct RecallIntakeFingerprintPayload: Codable {
    let contractVersion: Int
    let id: UUID
    let kind: RecallItemKindV1
    let title: String
    let provenance: RecallProvenanceV1
    let capturedAt: Date
    let tags: [String]
    let note: String?
    let linkURL: URL?
    let contentTypeIdentifier: String?
    let extractedText: String?
    let summary: String?
    let retention: RecallRetentionRequestV1
    let sourceFilename: String?
    let sourceByteCount: Int64?
    let sourceSHA256: String?
}
