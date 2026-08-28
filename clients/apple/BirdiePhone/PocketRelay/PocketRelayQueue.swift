import CryptoKit
import Foundation

struct PocketRelayStateHistoryEntry: Codable, Equatable, Sendable {
    let state: PocketRelayCommandState
    let at: Date
    let reason: String
}

struct PocketRelayAuditSummary: Codable, Equatable, Sendable {
    let receiptSHA256: String
    let signature: String
    let algorithm: String
    let verifiedAt: Date
    let idempotentReplay: Bool
}

struct PocketRelayWorkflowCursor: Codable, Equatable, Identifiable, Sendable {
    var id: String { storageKey ?? "unbound|\(workflowId)|\(runId)" }

    // Optional only so queue-v1 files written before device binding can still be
    // decoded. Unbound legacy cursors are discarded by the store and are never
    // accepted as workflow authority.
    let sourceDeviceId: String?
    let targetDeviceId: String?
    let workflowId: String
    let runId: String
    let revision: Int
    let inputRef: String?
    let state: PocketRelayCommandState
    let updatedAt: Date

    var storageKey: String? {
        guard let sourceDeviceId, let targetDeviceId else { return nil }
        return "\(sourceDeviceId)|\(targetDeviceId)|\(workflowId)"
    }

    static func extract(
        from value: PocketRelayJSONValue?,
        sourceDeviceId: String,
        targetDeviceId: String,
        at date: Date = Date()
    ) -> PocketRelayWorkflowCursor? {
        guard case .object(let object) = value,
              case .string(let workflowId) = object["workflowId"],
              case .string(let runId) = object["runId"],
              case .number(let revisionNumber) = object["revision"],
              revisionNumber.rounded(.towardZero) == revisionNumber,
              revisionNumber >= 0,
              revisionNumber <= 2_147_483_647,
              case .string(let stateText) = object["state"],
              let state = PocketRelayCommandState(rawValue: stateText)
        else { return nil }
        let inputRef: String?
        switch object["inputRef"] {
        case .some(.string(let value)):
            guard (try? PocketRelayValidation.requireOpaqueID(value, field: "result.inputRef")) != nil else {
                return nil
            }
            inputRef = value
        case .some(.null):
            inputRef = nil
        default:
            return nil
        }
        let revision = Int(revisionNumber)
        guard (try? PocketRelayValidation.requireOpaqueID(sourceDeviceId, field: "result.sourceDeviceId")) != nil,
              (try? PocketRelayValidation.requireOpaqueID(targetDeviceId, field: "result.targetDeviceId")) != nil,
              (try? PocketRelayValidation.requireOpaqueID(workflowId, field: "result.workflowId")) != nil,
              (try? PocketRelayValidation.requireUUID(runId, field: "result.runId")) != nil
        else { return nil }
        return PocketRelayWorkflowCursor(
            sourceDeviceId: sourceDeviceId,
            targetDeviceId: targetDeviceId,
            workflowId: workflowId,
            runId: runId,
            revision: revision,
            inputRef: inputRef,
            state: state,
            updatedAt: date
        )
    }
}

private struct PocketRelayQueuePersistence: Codable {
    let version: String
    let records: [PocketRelayQueueRecord]
    let workflowCursors: [PocketRelayWorkflowCursor]
}

struct PocketRelayQueueRecord: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let idempotencyKey: UUID
    let createdAt: Date
    let sourceDeviceId: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let payload: PocketRelayPayloadReference
    var approvedAt: Date?
    var approvedEffectFingerprint: String?
    var state: PocketRelayCommandState
    var history: [PocketRelayStateHistoryEntry]
    var retryCount: Int
    var nextRetryAt: Date?
    var lastErrorCode: String?
    var lastErrorMessage: String?
    var audit: PocketRelayAuditSummary?

    func effectFingerprint() throws -> String {
        let projection = PocketRelayQueueEffectProjection(
            id: id,
            idempotencyKey: idempotencyKey,
            createdAt: createdAt,
            sourceDeviceId: sourceDeviceId,
            action: action,
            target: target,
            payload: payload,
            scope: action.descriptor.scope,
            expectedEffect: action.descriptor.expectedEffect
        )
        return PocketRelayEncoding.sha256Hex(try PocketRelayEncoding.wireEncoder.encode(projection))
    }

    func recordFingerprint() throws -> String {
        PocketRelayEncoding.sha256Hex(try PocketRelayEncoding.wireEncoder.encode(self))
    }

    func requiresFreshApproval(at now: Date) -> Bool {
        guard action.descriptor.risk == .high else { return false }
        guard let approvedAt else { return true }
        // Reapprove before the host's skew-tolerant lease boundary so command
        // signing, transport and admission cannot consume the entire margin.
        return now.timeIntervalSince(approvedAt) > PocketRelayContract.maximumCommandTTL
    }
}

private struct PocketRelayQueueEffectProjection: Encodable {
    let id: UUID
    let idempotencyKey: UUID
    let createdAt: Date
    let sourceDeviceId: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let payload: PocketRelayPayloadReference
    let scope: String
    let expectedEffect: String
}

actor PocketRelayQueueStore {
    private let fileManager: FileManager
    private let fileURL: URL
    private var loaded = false
    private var cachedRecords: [PocketRelayQueueRecord] = []
    private var cachedWorkflowCursors: [String: PocketRelayWorkflowCursor] = [:]

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let root = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.fileURL = root
            .appendingPathComponent("Birdie", isDirectory: true)
            .appendingPathComponent("PocketRelay", isDirectory: true)
            .appendingPathComponent("queue-v1.json", isDirectory: false)
    }

    func records() throws -> [PocketRelayQueueRecord] {
        try loadIfNeeded()
        return cachedRecords.sorted { $0.createdAt > $1.createdAt }
    }

    func workflowCursors() throws -> [PocketRelayWorkflowCursor] {
        try loadIfNeeded()
        return cachedWorkflowCursors.values.sorted { $0.updatedAt > $1.updatedAt }
    }

    func saveWorkflowCursor(
        _ cursor: PocketRelayWorkflowCursor,
        replacingTerminalRun: Bool = false
    ) throws {
        try loadIfNeeded()
        guard let sourceDeviceId = cursor.sourceDeviceId,
              let targetDeviceId = cursor.targetDeviceId,
              let storageKey = cursor.storageKey
        else {
            throw PocketRelayLocalError.contract("Ein Workflow-Cursor ohne Gerätebindung wird nicht übernommen.")
        }
        try PocketRelayValidation.requireOpaqueID(sourceDeviceId, field: "result.sourceDeviceId")
        try PocketRelayValidation.requireOpaqueID(targetDeviceId, field: "result.targetDeviceId")
        try PocketRelayValidation.requireOpaqueID(cursor.workflowId, field: "result.workflowId")
        try PocketRelayValidation.requireUUID(cursor.runId, field: "result.runId")
        try PocketRelayValidation.requireRevision(cursor.revision, field: "result.revision")
        if let inputRef = cursor.inputRef {
            try PocketRelayValidation.requireOpaqueID(inputRef, field: "result.inputRef")
        }
        if let existing = cachedWorkflowCursors[storageKey] {
            if existing.runId == cursor.runId {
                guard existing.inputRef == cursor.inputRef else {
                    throw PocketRelayLocalError.contract("Die Input-Referenz eines Workflow-Laufs ist unveränderlich.")
                }
                if cursor.revision < existing.revision { return }
                if cursor.revision == existing.revision, cursor.state != existing.state {
                    throw PocketRelayLocalError.contract("Gleiche Workflow-Revisionen dürfen keinen unterschiedlichen Zustand haben.")
                }
            } else {
                let terminalStates: [PocketRelayCommandState] = [.completed, .failed, .cancelled]
                guard replacingTerminalRun, terminalStates.contains(existing.state) else {
                    throw PocketRelayLocalError.contract("Ein anderer aktiver Workflow-Lauf darf den verifizierten Cursor nicht ersetzen.")
                }
            }
        }
        cachedWorkflowCursors[storageKey] = cursor
        try persist()
    }

    func enqueue(
        commandId: UUID,
        idempotencyKey: UUID,
        sourceDeviceId: String,
        action: PocketRelayAction,
        target: PocketRelayTargetDevice,
        payload: PocketRelayPayloadReference,
        approvedAt: Date?
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        guard !cachedRecords.contains(where: {
            $0.id == commandId || $0.idempotencyKey == idempotencyKey
        }) else {
            throw PocketRelayLocalError.contract("Diese unveränderliche Befehlsfreigabe wurde bereits vorgemerkt.")
        }
        try PocketRelayValidation.requireOpaqueID(sourceDeviceId, field: "queue.sourceDeviceId")
        try payload.validate(for: action)
        _ = try target.validated()
        if action.descriptor.risk == .high, approvedAt == nil {
            throw PocketRelayLocalError.approvalRequired
        }
        if action.descriptor.risk != .high, approvedAt != nil {
            throw PocketRelayLocalError.contract("Eine iPhone-Freigabe ist nur für Hochrisiko-Aktionen zulässig.")
        }

        let now = Date()
        var record = PocketRelayQueueRecord(
            id: commandId,
            idempotencyKey: idempotencyKey,
            createdAt: now,
            sourceDeviceId: sourceDeviceId,
            action: action,
            target: target,
            payload: payload,
            approvedAt: approvedAt,
            approvedEffectFingerprint: nil,
            state: .queued,
            history: [PocketRelayStateHistoryEntry(state: .queued, at: now, reason: "created")],
            retryCount: 0,
            nextRetryAt: nil,
            lastErrorCode: nil,
            lastErrorMessage: nil,
            audit: nil
        )
        if action.descriptor.risk == .high {
            record.approvedEffectFingerprint = try record.effectFingerprint()
        }
        cachedRecords.append(record)
        try persist()
        return record
    }

    func record(id: UUID) throws -> PocketRelayQueueRecord? {
        try loadIfNeeded()
        return cachedRecords.first { $0.id == id }
    }

    func beginAttempt(
        id: UUID,
        reason: String,
        expectedEffectFingerprint: String? = nil,
        expectedRecordFingerprint: String? = nil
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            try validateApprovalSnapshot(
                record,
                expectedEffectFingerprint: expectedEffectFingerprint,
                expectedRecordFingerprint: expectedRecordFingerprint
            )
            if record.action.descriptor.risk == .high {
                guard let approvedEffectFingerprint = record.approvedEffectFingerprint,
                      try record.effectFingerprint() == approvedEffectFingerprint
                else { throw PocketRelayLocalError.approvalSnapshotChanged }
            }
            try transition(&record, to: .running, reason: reason)
            record.nextRetryAt = nil
            record.lastErrorCode = nil
            record.lastErrorMessage = nil
        }
    }

    func pause(
        id: UUID,
        code: String,
        message: String,
        retryAt: Date?,
        incrementRetry: Bool
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            try transition(&record, to: .paused, reason: code)
            if incrementRetry { record.retryCount += 1 }
            record.nextRetryAt = retryAt
            record.lastErrorCode = String(code.prefix(80))
            record.lastErrorMessage = String(message.prefix(320))
        }
    }

    func finish(
        id: UUID,
        state: PocketRelayCommandState,
        reason: String,
        audit: PocketRelayAuditSummary?,
        errorCode: String? = nil,
        errorMessage: String? = nil
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        guard [.completed, .failed, .cancelled, .paused, .running].contains(state) else {
            throw PocketRelayLocalError.stateTransition(.running, state)
        }
        return try update(id: id) { record in
            try transition(&record, to: state, reason: reason)
            record.audit = audit
            record.nextRetryAt = nil
            if state == .completed {
                record.lastErrorCode = nil
                record.lastErrorMessage = nil
            } else if state == .failed {
                record.lastErrorCode = errorCode.map { String($0.prefix(80)) }
                record.lastErrorMessage = errorMessage.map { String($0.prefix(320)) }
            }
        }
    }

    func scheduleStatusPoll(
        id: UUID,
        at date: Date,
        audit: PocketRelayAuditSummary
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            guard record.state == .running else {
                throw PocketRelayLocalError.stateTransition(record.state, .running)
            }
            record.nextRetryAt = date
            record.audit = audit
            record.lastErrorCode = nil
            record.lastErrorMessage = nil
        }
    }

    func fail(id: UUID, code: String, message: String) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            try transition(&record, to: .failed, reason: code)
            record.lastErrorCode = String(code.prefix(80))
            record.lastErrorMessage = String(message.prefix(320))
            record.nextRetryAt = nil
        }
    }

    func cancel(id: UUID) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            try transition(&record, to: .cancelled, reason: "cancelled_on_iphone")
            record.nextRetryAt = nil
        }
    }

    func failAllActive(
        code: String,
        message: String,
        excluding excludedRecordIDs: Set<UUID> = []
    ) throws {
        try loadIfNeeded()
        var changed = false
        for index in cachedRecords.indices where [.queued, .running, .paused].contains(cachedRecords[index].state)
            && !excludedRecordIDs.contains(cachedRecords[index].id) {
            try transition(&cachedRecords[index], to: .failed, reason: code)
            cachedRecords[index].lastErrorCode = String(code.prefix(80))
            cachedRecords[index].lastErrorMessage = String(message.prefix(320))
            cachedRecords[index].nextRetryAt = nil
            changed = true
        }
        if changed { try persist() }
    }

    func reapprove(
        id: UUID,
        expectedEffectFingerprint: String,
        expectedRecordFingerprint: String,
        at: Date
    ) throws -> PocketRelayQueueRecord {
        try loadIfNeeded()
        return try update(id: id) { record in
            try validateApprovalSnapshot(
                record,
                expectedEffectFingerprint: expectedEffectFingerprint,
                expectedRecordFingerprint: expectedRecordFingerprint
            )
            guard record.action.descriptor.risk == .high else {
                throw PocketRelayLocalError.contract("Diese Aktion benötigt keine erneute Freigabe.")
            }
            guard record.state == .paused else {
                throw PocketRelayLocalError.stateTransition(record.state, .running)
            }
            record.approvedAt = at
            record.approvedEffectFingerprint = expectedEffectFingerprint
            record.nextRetryAt = nil
            record.lastErrorCode = nil
            record.lastErrorMessage = nil
            record.history.append(PocketRelayStateHistoryEntry(
                state: .paused,
                at: at,
                reason: "explicit_iphone_reapproval"
            ))
        }
    }

    private func validateApprovalSnapshot(
        _ record: PocketRelayQueueRecord,
        expectedEffectFingerprint: String?,
        expectedRecordFingerprint: String?
    ) throws {
        if let expectedEffectFingerprint,
           try record.effectFingerprint() != expectedEffectFingerprint {
            throw PocketRelayLocalError.approvalSnapshotChanged
        }
        if let expectedRecordFingerprint,
           try record.recordFingerprint() != expectedRecordFingerprint {
            throw PocketRelayLocalError.approvalSnapshotChanged
        }
    }

    func eligible(at date: Date) throws -> [PocketRelayQueueRecord] {
        try loadIfNeeded()
        return cachedRecords
            .filter { record in
                guard record.state == .queued || record.state == .paused || record.state == .running else { return false }
                return record.nextRetryAt.map { $0 <= date } ?? true
            }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func recoverInterruptedAttempts() throws {
        try loadIfNeeded()
        var changed = false
        for index in cachedRecords.indices where cachedRecords[index].state == .running {
            try transition(&cachedRecords[index], to: .paused, reason: "app_restarted_before_receipt")
            cachedRecords[index].nextRetryAt = Date()
            cachedRecords[index].lastErrorCode = "RECONNECT_REQUIRED"
            cachedRecords[index].lastErrorMessage = "Der Hoststatus wird nach Wiederverbindung erneut idempotent abgefragt."
            changed = true
        }
        if changed { try persist() }
    }

    private func update(
        id: UUID,
        mutation: (inout PocketRelayQueueRecord) throws -> Void
    ) throws -> PocketRelayQueueRecord {
        guard let index = cachedRecords.firstIndex(where: { $0.id == id }) else {
            throw PocketRelayLocalError.contract("Der Queue-Eintrag wurde nicht gefunden.")
        }
        try mutation(&cachedRecords[index])
        try persist()
        return cachedRecords[index]
    }

    private func transition(
        _ record: inout PocketRelayQueueRecord,
        to state: PocketRelayCommandState,
        reason: String
    ) throws {
        guard record.state.canTransition(to: state) else {
            throw PocketRelayLocalError.stateTransition(record.state, state)
        }
        guard record.state != state else { return }
        record.state = state
        record.history.append(PocketRelayStateHistoryEntry(
            state: state,
            at: Date(),
            reason: String(reason.prefix(160))
        ))
    }

    private func loadIfNeeded() throws {
        guard !loaded else { return }
        guard (try? fileURL.checkResourceIsReachable()) == true else {
            cachedRecords = []
            cachedWorkflowCursors = [:]
            loaded = true
            return
        }
        let data = try Data(contentsOf: fileURL)
        if let persistence = try? JSONDecoder().decode(PocketRelayQueuePersistence.self, from: data) {
            guard persistence.version == "pocket-relay.queue.v1" else {
                throw PocketRelayLocalError.contract("Die Offline-Queue verwendet eine unbekannte Version.")
            }
            cachedRecords = persistence.records
            cachedWorkflowCursors = [:]
            for cursor in persistence.workflowCursors {
                // Legacy cursors carried no source/target binding. They must not
                // become capabilities after pairing with another host.
                guard let storageKey = cursor.storageKey,
                      let sourceDeviceId = cursor.sourceDeviceId,
                      let targetDeviceId = cursor.targetDeviceId,
                      (try? PocketRelayValidation.requireOpaqueID(sourceDeviceId, field: "cursor.sourceDeviceId")) != nil,
                      (try? PocketRelayValidation.requireOpaqueID(targetDeviceId, field: "cursor.targetDeviceId")) != nil,
                      (try? PocketRelayValidation.requireOpaqueID(cursor.workflowId, field: "cursor.workflowId")) != nil,
                      (try? PocketRelayValidation.requireUUID(cursor.runId, field: "cursor.runId")) != nil,
                      (try? PocketRelayValidation.requireRevision(cursor.revision, field: "cursor.revision")) != nil
                else { continue }
                if let existing = cachedWorkflowCursors[storageKey],
                   existing.revision > cursor.revision {
                    continue
                }
                cachedWorkflowCursors[storageKey] = cursor
            }
        } else {
            cachedRecords = try JSONDecoder().decode([PocketRelayQueueRecord].self, from: data)
            cachedWorkflowCursors = [:]
        }
        loaded = true
    }

    private func persist() throws {
        let directory = fileURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let snapshot = PocketRelayQueuePersistence(
            version: "pocket-relay.queue.v1",
            records: cachedRecords,
            workflowCursors: Array(cachedWorkflowCursors.values)
        )
        let data = try PocketRelayEncoding.wireEncoder.encode(snapshot)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }
}
