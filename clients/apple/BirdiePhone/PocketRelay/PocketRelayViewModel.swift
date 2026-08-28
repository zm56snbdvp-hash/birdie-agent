import Combine
import CryptoKit
import Foundation
import Network
import UniformTypeIdentifiers

@MainActor
final class PocketRelayConnectivityMonitor: ObservableObject {
    @Published private(set) var isOnline = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "de.birdieandbreakfast.pocket-relay.network")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.isOnline = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

struct PocketRelaySelectedFile: Sendable {
    let metadata: PocketRelayFileMetadata
    let data: Data
}

struct PocketRelayApprovalDraft: Identifiable, Sendable {
    let id: UUID
    let idempotencyKey: UUID
    let sourceDeviceId: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let payload: PocketRelayPayloadReference
    let scope: String
    let expectedEffect: String
    let dataSummary: String
    let fileData: Data?
}

struct PocketRelayRetryApprovalDraft: Identifiable, Sendable {
    let id: UUID
    let recordId: UUID
    let sourceDeviceId: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let scope: String
    let expectedEffect: String
    let dataSummary: String
    let effectFingerprint: String
    let recordFingerprint: String
}

struct PocketRelayFetchedFile: Sendable {
    let metadata: PocketRelayFileMetadata
    let data: Data

    static func extract(from value: PocketRelayJSONValue?) throws -> PocketRelayFetchedFile? {
        guard case .object(let result) = value,
              case .object(let file) = result["file"]
        else { return nil }
        guard case .string(let fileName) = file["fileName"],
              case .string(let contentType) = file["contentType"],
              case .number(let sizeNumber) = file["sizeBytes"],
              sizeNumber.rounded(.towardZero) == sizeNumber,
              sizeNumber >= 1,
              sizeNumber <= Double(PocketRelayContract.maximumInlineFileBytes),
              case .string(let sha256) = file["sha256"],
              case .string(let contentBase64) = file["contentBase64"],
              let data = Data(base64Encoded: contentBase64)
        else {
            throw PocketRelayLocalError.contract("Der Host hat eine ungültige Dateiantwort geliefert.")
        }
        let canonical = data.base64EncodedString().replacingOccurrences(of: "=", with: "")
        guard canonical == contentBase64.replacingOccurrences(of: "=", with: "") else {
            throw PocketRelayLocalError.contract("Die Host-Datei ist nicht kanonisch base64-kodiert.")
        }
        let metadata = try PocketRelayFileMetadata(
            fileName: fileName,
            contentType: contentType,
            sizeBytes: Int(sizeNumber),
            sha256: sha256
        ).validated()
        guard data.count == metadata.sizeBytes,
              PocketRelayEncoding.sha256Hex(data) == metadata.sha256
        else {
            throw PocketRelayLocalError.contract("Größe oder SHA-256 der Host-Datei stimmt nicht mit der signierten Antwort überein.")
        }
        return PocketRelayFetchedFile(metadata: metadata, data: data)
    }
}

enum PocketRelayConnectionStatus: Equatable, Sendable {
    case unconfigured
    case paired
    case offline
    case revoked
    case killSwitch

    var title: String {
        switch self {
        case .unconfigured: "Nicht gekoppelt"
        case .paired: "Sicher gekoppelt"
        case .offline: "Offline · Befehle werden sicher vorgemerkt"
        case .revoked: "Zugriff wurde am PC widerrufen"
        case .killSwitch: "Pocket Relay wurde am PC deaktiviert"
        }
    }
}

@MainActor
final class PocketRelayViewModel: ObservableObject {
    @Published private(set) var pairedSession: PocketRelaySession?
    @Published private(set) var queueRecords: [PocketRelayQueueRecord] = []
    @Published private(set) var workflowCursors: [PocketRelayWorkflowCursor] = []
    @Published private(set) var proposedWorkflowRunId = UUID()
    @Published private(set) var selectedFile: PocketRelaySelectedFile?
    @Published private(set) var fetchedFile: PocketRelayFetchedFile?
    @Published private(set) var connectionStatus: PocketRelayConnectionStatus = .unconfigured
    @Published private(set) var isNetworkAvailable = false
    @Published private(set) var isBusy = false
    @Published var statusMessage: String?
    @Published var lastResult: String?

    private let signer: PocketRelayDeviceSigner
    private let credentialStore: PocketRelayCredentialStore
    private let queueStore: PocketRelayQueueStore
    private let connectivity: PocketRelayConnectivityMonitor
    private let client: PocketRelayHostClient
    private var cancellables: Set<AnyCancellable> = []
    private var volatileFileBodies: [UUID: Data] = [:]
    private var processingCommands: Set<UUID> = []
    private var activeCommands: Set<UUID> = []
    private var retryTask: Task<Void, Never>?
    private var hasStarted = false

    init() {
        let signer = PocketRelayDeviceSigner()
        let credentials = PocketRelayCredentialStore()
        let connectivity = PocketRelayConnectivityMonitor()
        self.signer = signer
        self.credentialStore = credentials
        self.queueStore = PocketRelayQueueStore()
        self.connectivity = connectivity
        self.client = PocketRelayHostClient(signer: signer, credentials: credentials)

        connectivity.$isOnline
            .removeDuplicates()
            .sink { [weak self] online in
                Task { @MainActor in
                    guard let self else { return }
                    self.isNetworkAvailable = online
                    self.updateConnectionStatus()
                    if online { await self.retryEligibleCommands() }
                }
            }
            .store(in: &cancellables)
    }

    deinit {
        retryTask?.cancel()
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        do {
            try await queueStore.recoverInterruptedAttempts()
            do {
                pairedSession = try await client.currentSession()
            } catch {
                pairedSession = nil
                connectionStatus = .unconfigured
                statusMessage = "Die gespeicherte Pocket-Relay-Kopplung war ungültig und wurde sicher verworfen."
            }
            queueRecords = try await queueStore.records()
            workflowCursors = try await queueStore.workflowCursors()
            updateConnectionStatus()
            if isNetworkAvailable { await retryEligibleCommands() }
            scheduleNextRetry()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func pair(hostURL: String, pairingCode: String, deviceName: String) async {
        guard !isBusy, activeCommands.isEmpty, processingCommands.isEmpty else {
            statusMessage = "Warte, bis alle laufenden Pocket-Relay-Aufträge sicher abgeschlossen sind."
            return
        }
        isBusy = true
        var shouldRetry = false
        do {
            pairedSession = try await client.pair(
                hostURLText: hostURL,
                pairingCode: pairingCode,
                deviceName: deviceName
            )
            connectionStatus = isNetworkAvailable ? .paired : .offline
            statusMessage = "Dieses iPhone ist jetzt gerätegebunden mit \(pairedSession?.targetDevice.deviceName ?? "dem PC") gekoppelt."
            shouldRetry = isNetworkAvailable
        } catch let error as PocketRelayHostError where error.isKillSwitch {
            connectionStatus = .killSwitch
            statusMessage = error.localizedDescription
        } catch {
            statusMessage = error.localizedDescription
        }
        isBusy = false
        if shouldRetry { await retryEligibleCommands() }
    }

    func disconnect() async {
        guard !isBusy, activeCommands.isEmpty, processingCommands.isEmpty else {
            statusMessage = "Die Kopplung kann erst nach Abschluss aller laufenden Aufträge entfernt werden."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            try await client.disconnect()
            pairedSession = nil
            connectionStatus = .unconfigured
            statusMessage = "Die lokale Pocket-Relay-Kopplung und der kurzlebige Token wurden entfernt."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func selectFile(_ url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let values = try url.resourceValues(forKeys: [.nameKey, .fileSizeKey, .contentTypeKey, .isRegularFileKey])
            guard values.isRegularFile == true else {
                throw PocketRelayLocalError.contract("Es muss eine einzelne reguläre Datei ausgewählt werden.")
            }
            let size = values.fileSize ?? 0
            guard (1...PocketRelayContract.maximumInlineFileBytes).contains(size) else {
                throw PocketRelayLocalError.contract("Die ausgewählte Datei muss zwischen 1 Byte und 5 MiB groß sein.")
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            let name = values.name ?? url.lastPathComponent
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            let metadata = PocketRelayFileMetadata(
                fileName: name,
                contentType: values.contentType?.preferredMIMEType ?? "application/octet-stream",
                sizeBytes: data.count,
                sha256: digest
            )
            selectedFile = PocketRelaySelectedFile(metadata: try metadata.validated(), data: data)
            statusMessage = "Datei ausdrücklich ausgewählt. Inhalt wird nur im Arbeitsspeicher gehalten."
        } catch {
            selectedFile = nil
            statusMessage = error.localizedDescription
        }
    }

    func clearSelectedFile() {
        selectedFile = nil
    }

    func dataSummary(
        action: PocketRelayAction,
        link: String,
        exportId: String,
        workflowId: String,
        inputRef: String
    ) -> String {
        do {
            return try payloadReference(
                action: action,
                link: link,
                exportId: exportId,
                workflowId: workflowId,
                inputRef: inputRef
            ).publicSummary
        } catch {
            return "Vollständige, gültige Daten erforderlich"
        }
    }

    func makeApprovalDraft(
        action: PocketRelayAction,
        link: String,
        exportId: String,
        workflowId: String,
        inputRef: String
    ) throws -> PocketRelayApprovalDraft {
        guard !isBusy, connectionStatus != .killSwitch, connectionStatus != .revoked else {
            throw PocketRelayLocalError.contract("Pocket Relay ist am Ziel-PC deaktiviert oder widerrufen.")
        }
        guard let pairedSession else { throw PocketRelayLocalError.notPaired }
        let payload = try payloadReference(
            action: action,
            link: link,
            exportId: exportId,
            workflowId: workflowId,
            inputRef: inputRef
        )
        try payload.validate(for: action)
        _ = try pairedSession.targetDevice.validated()
        try PocketRelayValidation.requireOpaqueID(pairedSession.deviceId, field: "draft.sourceDeviceId")

        let fileData: Data?
        if case .fileUpload(let metadata) = payload {
            guard let selectedFile,
                  selectedFile.metadata == metadata,
                  selectedFile.data.count == metadata.sizeBytes,
                  PocketRelayEncoding.sha256Hex(selectedFile.data) == metadata.sha256
            else { throw PocketRelayLocalError.fileReselectionRequired }
            fileData = selectedFile.data
        } else {
            fileData = nil
        }

        let descriptor = action.descriptor
        return PocketRelayApprovalDraft(
            id: UUID(),
            idempotencyKey: UUID(),
            sourceDeviceId: pairedSession.deviceId,
            action: action,
            target: pairedSession.targetDevice,
            payload: payload,
            scope: descriptor.scope,
            expectedEffect: descriptor.expectedEffect,
            dataSummary: payload.publicSummary,
            fileData: fileData
        )
    }

    func makeRetryApprovalDraft(id: UUID) throws -> PocketRelayRetryApprovalDraft {
        guard connectionStatus != .killSwitch, connectionStatus != .revoked else {
            throw PocketRelayLocalError.contract("Pocket Relay ist am Ziel-PC deaktiviert oder widerrufen.")
        }
        guard let record = queueRecords.first(where: { $0.id == id }), record.state == .paused else {
            throw PocketRelayLocalError.approvalSnapshotChanged
        }
        guard record.action.descriptor.risk == .high else {
            throw PocketRelayLocalError.contract("Diese Aktion benötigt keine Hochrisiko-Freigabe.")
        }
        return PocketRelayRetryApprovalDraft(
            id: UUID(),
            recordId: record.id,
            sourceDeviceId: record.sourceDeviceId,
            action: record.action,
            target: record.target,
            scope: record.action.descriptor.scope,
            expectedEffect: record.action.descriptor.expectedEffect,
            dataSummary: record.payload.publicSummary,
            effectFingerprint: try record.effectFingerprint(),
            recordFingerprint: try record.recordFingerprint()
        )
    }

    func enqueue(draft: PocketRelayApprovalDraft, explicitlyApproved: Bool) async {
        do {
            guard !isBusy, connectionStatus != .killSwitch, connectionStatus != .revoked else {
                throw PocketRelayLocalError.contract("Pocket Relay ist am Ziel-PC deaktiviert oder widerrufen.")
            }
            guard let pairedSession = try await client.currentSession() else {
                throw PocketRelayLocalError.notPaired
            }
            self.pairedSession = pairedSession
            let descriptor = draft.action.descriptor
            guard pairedSession.deviceId == draft.sourceDeviceId,
                  pairedSession.targetDevice == draft.target,
                  descriptor.scope == draft.scope,
                  descriptor.expectedEffect == draft.expectedEffect,
                  draft.payload.publicSummary == draft.dataSummary
            else { throw PocketRelayLocalError.approvalSnapshotChanged }
            try draft.payload.validate(for: draft.action)

            let isHighRisk = descriptor.risk == .high
            guard isHighRisk == explicitlyApproved else {
                if isHighRisk { throw PocketRelayLocalError.approvalRequired }
                throw PocketRelayLocalError.approvalSnapshotChanged
            }
            if case .fileUpload(let metadata) = draft.payload {
                guard let fileData = draft.fileData,
                      fileData.count == metadata.sizeBytes,
                      PocketRelayEncoding.sha256Hex(fileData) == metadata.sha256
                else { throw PocketRelayLocalError.fileReselectionRequired }
            } else if draft.fileData != nil {
                throw PocketRelayLocalError.approvalSnapshotChanged
            }

            let record = try await queueStore.enqueue(
                commandId: draft.id,
                idempotencyKey: draft.idempotencyKey,
                sourceDeviceId: pairedSession.deviceId,
                action: draft.action,
                target: draft.target,
                payload: draft.payload,
                approvedAt: isHighRisk ? Date().addingTimeInterval(pairedSession.serverClockOffset) : nil
            )
            if connectionStatus == .killSwitch || connectionStatus == .revoked {
                let code = connectionStatus == .revoked ? "DEVICE_REVOKED" : "RELAY_KILL_SWITCH_ACTIVE"
                _ = try await queueStore.fail(
                    id: record.id,
                    code: code,
                    message: "Pocket Relay wurde während der Freigabe am Ziel-PC deaktiviert."
                )
                await refreshQueue()
                statusMessage = "Der freigegebene Auftrag wurde nicht gesendet, weil Pocket Relay deaktiviert wurde."
                return
            }
            if case .fileUpload(let metadata) = draft.payload, let fileData = draft.fileData {
                volatileFileBodies[record.id] = fileData
                if let currentSelection = selectedFile,
                   currentSelection.metadata == metadata,
                   currentSelection.data == fileData {
                    selectedFile = nil
                }
            }
            if case .workflowStart(_, _, let runId, _) = draft.payload,
               proposedWorkflowRunId.uuidString.lowercased() == runId {
                proposedWorkflowRunId = UUID()
            }
            await refreshQueue()
            statusMessage = isNetworkAvailable
                ? "Befehl sicher vorgemerkt und wird jetzt übertragen."
                : "Befehl metadata-only vorgemerkt. Beim Reconnect wird er frisch signiert."
            if isNetworkAvailable { await process(id: record.id) }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func retry(id: UUID) async {
        do {
            guard !isBusy, connectionStatus != .killSwitch, connectionStatus != .revoked else {
                throw PocketRelayLocalError.contract("Pocket Relay ist am Ziel-PC deaktiviert oder widerrufen.")
            }
            guard let record = try await queueStore.record(id: id) else { return }
            guard record.action.descriptor.risk != .high else { throw PocketRelayLocalError.approvalRequired }
            await refreshQueue()
            guard isNetworkAvailable else {
                statusMessage = "Der Befehl bleibt bis zur nächsten sicheren Verbindung pausiert."
                return
            }
            await process(id: id)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func retry(approvalDraft: PocketRelayRetryApprovalDraft) async {
        do {
            guard !isBusy, connectionStatus != .killSwitch, connectionStatus != .revoked else {
                throw PocketRelayLocalError.contract("Pocket Relay ist am Ziel-PC deaktiviert oder widerrufen.")
            }
            guard let pairedSession = try await client.currentSession() else {
                throw PocketRelayLocalError.notPaired
            }
            self.pairedSession = pairedSession
            let descriptor = approvalDraft.action.descriptor
            guard descriptor.risk == .high,
                  descriptor.scope == approvalDraft.scope,
                  descriptor.expectedEffect == approvalDraft.expectedEffect,
                  pairedSession.deviceId == approvalDraft.sourceDeviceId,
                  pairedSession.targetDevice == approvalDraft.target
            else { throw PocketRelayLocalError.approvalSnapshotChanged }

            let reapproved = try await queueStore.reapprove(
                id: approvalDraft.recordId,
                expectedEffectFingerprint: approvalDraft.effectFingerprint,
                expectedRecordFingerprint: approvalDraft.recordFingerprint,
                at: Date().addingTimeInterval(pairedSession.serverClockOffset)
            )
            let postApprovalFingerprint = try reapproved.recordFingerprint()
            await refreshQueue()
            guard isNetworkAvailable else {
                statusMessage = "Der exakt freigegebene Befehl bleibt bis zur nächsten sicheren Verbindung pausiert."
                return
            }
            await process(
                id: approvalDraft.recordId,
                expectedEffectFingerprint: approvalDraft.effectFingerprint,
                expectedRecordFingerprint: postApprovalFingerprint
            )
        } catch {
            statusMessage = error.localizedDescription
            await refreshQueue()
        }
    }

    func cancel(id: UUID) async {
        guard !processingCommands.contains(id), !activeCommands.contains(id) else {
            statusMessage = "Der Befehl wurde bereits signiert übertragen. Ein lokaler Abbruch würde einen möglichen PC-Effekt nicht rückgängig machen."
            return
        }
        do {
            _ = try await queueStore.cancel(id: id)
            volatileFileBodies[id] = nil
            await refreshQueue()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func retryEligibleCommands() async {
        guard !isBusy, isNetworkAvailable, pairedSession != nil, connectionStatus != .killSwitch, connectionStatus != .revoked else {
            return
        }
        do {
            let eligible = try await queueStore.eligible(at: Date())
            for record in eligible {
                if Task.isCancelled || connectionStatus == .killSwitch || connectionStatus == .revoked { return }
                await process(id: record.id)
            }
            scheduleNextRetry()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func process(
        id: UUID,
        expectedEffectFingerprint: String? = nil,
        expectedRecordFingerprint: String? = nil
    ) async {
        guard !processingCommands.contains(id),
              !isBusy,
              isNetworkAvailable,
              connectionStatus != .killSwitch,
              connectionStatus != .revoked
        else { return }
        processingCommands.insert(id)
        var isActiveCommand = false
        var processingRecord: PocketRelayQueueRecord?
        defer {
            processingCommands.remove(id)
            if isActiveCommand { activeCommands.remove(id) }
        }

        do {
            guard var record = try await queueStore.record(id: id),
                  record.state == .queued || record.state == .paused || record.state == .running
            else { return }
            processingRecord = record
            guard let pairedSession else { throw PocketRelayLocalError.notPaired }
            guard record.sourceDeviceId == pairedSession.deviceId,
                  record.target == pairedSession.targetDevice
            else {
                _ = try await queueStore.fail(
                    id: id,
                    code: "TARGET_NOT_PAIRED",
                    message: "Der vorgemerkte Befehl gehört zu einer anderen iPhone-/Ziel-PC-Kopplung."
                )
                await refreshQueue()
                return
            }

            record = try await queueStore.beginAttempt(
                id: id,
                reason: "signed_delivery_attempt",
                expectedEffectFingerprint: expectedEffectFingerprint,
                expectedRecordFingerprint: expectedRecordFingerprint
            )
            processingRecord = record
            await refreshQueue()
            let hostNow = Date().addingTimeInterval(pairedSession.serverClockOffset)
            if record.action.descriptor.risk == .high, record.requiresFreshApproval(at: hostNow) {
                _ = try await queueStore.pause(
                    id: id,
                    code: "IPHONE_REAPPROVAL_REQUIRED",
                    message: PocketRelayLocalError.approvalRequired.localizedDescription,
                    retryAt: nil,
                    incrementRetry: false
                )
                await refreshQueue()
                return
            }
            if case .fileUpload = record.payload, volatileFileBodies[id] == nil {
                _ = try await queueStore.fail(
                    id: id,
                    code: "FILE_RESELECTION_REQUIRED",
                    message: PocketRelayLocalError.fileReselectionRequired.localizedDescription
                )
                await refreshQueue()
                return
            }

            guard connectionStatus != .killSwitch, connectionStatus != .revoked else {
                _ = try? await queueStore.fail(
                    id: id,
                    code: connectionStatus == .revoked ? "DEVICE_REVOKED" : "RELAY_KILL_SWITCH_ACTIVE",
                    message: "Pocket Relay wurde vor der Übertragung am Ziel-PC deaktiviert."
                )
                await refreshQueue()
                return
            }

            activeCommands.insert(id)
            isActiveCommand = true
            let outcome = try await client.execute(record: record, fileData: volatileFileBodies[id])
            let response = outcome.response
            let audit = outcome.audit
            if try await handleVerifiedControlFailure(
                response: response,
                audit: audit,
                record: record
            ) {
                await refreshQueue()
                return
            }
            guard currentSessionMatches(record) else {
                try await settleVerifiedResponseFromStaleSession(
                    response: response,
                    audit: audit,
                    record: record
                )
                await refreshQueue()
                return
            }

            let verifiedCursor: PocketRelayWorkflowCursor?
            let verifiedFile: PocketRelayFetchedFile?
            if response.success {
                verifiedCursor = try validatedWorkflowCursor(from: response.result, for: record)
                verifiedFile = try PocketRelayFetchedFile.extract(from: response.result)
                if let verifiedCursor {
                    try await queueStore.saveWorkflowCursor(
                        verifiedCursor,
                        replacingTerminalRun: record.action == .startWorkflow
                    )
                }
            } else {
                verifiedCursor = nil
                verifiedFile = nil
            }

            // Publish response-derived UI only after every action-specific
            // result component has validated and any cursor commit succeeded.
            lastResult = response.result?.compactDescription
            if let executionError = response.error {
                statusMessage = executionError.message
            }
            if let verifiedFile {
                fetchedFile = verifiedFile
                statusMessage = "Die signierte Host-Datei ist geprüft und kann jetzt an einem ausdrücklich gewählten Ort gesichert werden."
            }

            switch response.state {
            case .completed, .failed, .cancelled, .paused:
                _ = try await queueStore.finish(
                    id: id,
                    state: response.state,
                    reason: "host_receipt_\(response.state.rawValue)",
                    audit: audit,
                    errorCode: response.error?.code,
                    errorMessage: response.error?.message
                )
                if response.state != .paused { volatileFileBodies[id] = nil }
            case .running:
                let pollAt = Date().addingTimeInterval(2)
                _ = try await queueStore.scheduleStatusPoll(id: id, at: pollAt, audit: audit)
                scheduleRetry(at: pollAt)
            case .queued:
                let retryAt = Date().addingTimeInterval(2)
                _ = try await queueStore.pause(
                    id: id,
                    code: "HOST_QUEUED",
                    message: "Der Host hat den Befehl angenommen und noch nicht gestartet.",
                    retryAt: retryAt,
                    incrementRetry: false
                )
                scheduleRetry(at: retryAt)
            }
            await refreshQueue()
        } catch let error as PocketRelayHostError {
            await handleHostError(error, id: id, record: processingRecord)
        } catch PocketRelayLocalError.approvalRequired {
            do {
                _ = try await queueStore.pause(
                    id: id,
                    code: "IPHONE_REAPPROVAL_REQUIRED",
                    message: PocketRelayLocalError.approvalRequired.localizedDescription,
                    retryAt: nil,
                    incrementRetry: false
                )
            } catch { statusMessage = error.localizedDescription }
            await refreshQueue()
        } catch PocketRelayLocalError.approvalSnapshotChanged {
            statusMessage = PocketRelayLocalError.approvalSnapshotChanged.localizedDescription
            await refreshQueue()
        } catch {
            await reconcileStoredSession()
            do {
                _ = try await queueStore.fail(
                    id: id,
                    code: "LOCAL_COMMAND_FAILED",
                    message: error.localizedDescription
                )
            } catch { statusMessage = error.localizedDescription }
            await refreshQueue()
        }
    }

    private func handleVerifiedControlFailure(
        response: PocketRelayCommandResponse,
        audit: PocketRelayAuditSummary,
        record: PocketRelayQueueRecord
    ) async throws -> Bool {
        guard response.state == .failed, let executionError = response.error else { return false }
        guard executionError.code == "DEVICE_REVOKED"
                || executionError.code == "RELAY_KILL_SWITCH_ACTIVE"
        else { return false }

        _ = try await queueStore.finish(
            id: record.id,
            state: .failed,
            reason: "verified_signed_\(executionError.code)",
            audit: audit,
            errorCode: executionError.code,
            errorMessage: executionError.message
        )
        volatileFileBodies[record.id] = nil

        guard currentSessionMatches(record) else {
            statusMessage = "Die signierte Steuerantwort gehörte zu einer früheren Gerätekopplung. Nur der alte Queue-Eintrag wurde abgeschlossen."
            return true
        }

        retryTask?.cancel()

        if executionError.code == "DEVICE_REVOKED" {
            try? await credentialStore.clear()
            pairedSession = nil
            connectionStatus = .revoked
            try await queueStore.failAllActive(
                code: executionError.code,
                message: executionError.message,
                excluding: activeCommands
            )
        } else {
            connectionStatus = .killSwitch
            try await queueStore.failAllActive(
                code: executionError.code,
                message: executionError.message,
                excluding: activeCommands
            )
        }
        volatileFileBodies.removeAll()
        fetchedFile = nil
        lastResult = nil
        statusMessage = executionError.message
        return true
    }

    private func handleHostError(
        _ error: PocketRelayHostError,
        id: UUID,
        record: PocketRelayQueueRecord?
    ) async {
        let appliesToCurrentSession = record.map { currentSessionMatches($0) } ?? false
        do {
            if error.isRemoteRevocation {
                _ = try await queueStore.fail(id: id, code: error.code, message: error.message)
                if appliesToCurrentSession {
                    try? await credentialStore.clear()
                    pairedSession = nil
                    connectionStatus = .revoked
                    try await queueStore.failAllActive(
                        code: error.code,
                        message: error.message,
                        excluding: activeCommands
                    )
                }
            } else if error.isKillSwitch {
                if appliesToCurrentSession {
                    connectionStatus = .killSwitch
                    _ = try await queueStore.pause(
                        id: id,
                        code: error.code,
                        message: error.message,
                        retryAt: nil,
                        incrementRetry: false
                    )
                    try await queueStore.failAllActive(
                        code: error.code,
                        message: error.message,
                        excluding: activeCommands
                    )
                } else {
                    _ = try await queueStore.fail(
                        id: id,
                        code: "STALE_SESSION_CONTEXT",
                        message: "Die Kill-Switch-Antwort gehörte zu einer früheren Gerätekopplung."
                    )
                }
            } else if error.isTransient {
                let record = try await queueStore.record(id: id)
                let attempts = (record?.retryCount ?? 0) + 1
                let delay = min(pow(2, Double(min(attempts, 6))), 60)
                let retryAt = Date().addingTimeInterval(delay)
                _ = try await queueStore.pause(
                    id: id,
                    code: error.code,
                    message: error.message,
                    retryAt: retryAt,
                    incrementRetry: true
                )
                scheduleRetry(at: retryAt)
            } else {
                _ = try await queueStore.fail(id: id, code: error.code, message: error.message)
            }
            if (error.isRemoteRevocation || error.isKillSwitch),
               appliesToCurrentSession {
                retryTask?.cancel()
                volatileFileBodies.removeAll()
                fetchedFile = nil
                lastResult = nil
            }
            statusMessage = error.localizedDescription
        } catch {
            statusMessage = error.localizedDescription
        }
        await refreshQueue()
    }

    private func payloadReference(
        action: PocketRelayAction,
        link: String,
        exportId: String,
        workflowId: String,
        inputRef: String
    ) throws -> PocketRelayPayloadReference {
        let reference: PocketRelayPayloadReference
        switch action {
        case .openLink:
            reference = .link(url: try PocketRelayValidation.normalizedHTTPSURL(link))
        case .sendFileToPC:
            guard let selectedFile else {
                throw PocketRelayLocalError.contract("Wähle die zu sendende Datei ausdrücklich aus.")
            }
            reference = .fileUpload(selectedFile.metadata)
        case .fetchFileToIPhone:
            reference = .fileFetch(exportId: exportId.trimmingCharacters(in: .whitespacesAndNewlines))
        case .startWorkflow:
            let cleanWorkflowId = workflowId.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanInput = inputRef.trimmingCharacters(in: .whitespacesAndNewlines)
            if let cursor = currentWorkflowCursor(for: cleanWorkflowId) {
                switch cursor.state {
                case .paused:
                    reference = .workflowStart(
                        workflowId: cleanWorkflowId,
                        inputRef: cursor.inputRef,
                        runId: cursor.runId,
                        expectedRevision: cursor.revision
                    )
                case .queued, .running:
                    throw PocketRelayLocalError.contract("Dieser Workflow-Lauf ist bereits aktiv und kann nicht erneut gestartet werden.")
                case .completed, .failed, .cancelled:
                    reference = .workflowStart(
                        workflowId: cleanWorkflowId,
                        inputRef: cleanInput.isEmpty ? nil : cleanInput,
                        runId: proposedWorkflowRunId.uuidString.lowercased(),
                        expectedRevision: 0
                    )
                }
            } else {
                reference = .workflowStart(
                    workflowId: cleanWorkflowId,
                    inputRef: cleanInput.isEmpty ? nil : cleanInput,
                    runId: proposedWorkflowRunId.uuidString.lowercased(),
                    expectedRevision: 0
                )
            }
        case .pauseWorkflow, .cancelWorkflow:
            let cleanWorkflowId = workflowId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let cursor = currentWorkflowCursor(for: cleanWorkflowId) else {
                throw PocketRelayLocalError.contract("Für diesen Workflow ist kein verifizierter Lauf-/Revisions-Cursor auf dem iPhone vorhanden.")
            }
            reference = .workflow(
                workflowId: cleanWorkflowId,
                runId: cursor.runId,
                expectedRevision: cursor.revision
            )
        case .getWorkflowResult:
            let cleanWorkflowId = workflowId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let cursor = currentWorkflowCursor(for: cleanWorkflowId) else {
                throw PocketRelayLocalError.contract("Für diesen Workflow ist kein verifizierter Lauf-Cursor auf dem iPhone vorhanden.")
            }
            reference = .workflowResult(
                workflowId: cleanWorkflowId,
                runId: cursor.runId,
                knownRevision: cursor.revision
            )
        case .lockPC:
            reference = .lockPC
        }
        try reference.validate(for: action)
        return reference
    }

    private func refreshQueue() async {
        do {
            queueRecords = try await queueStore.records()
            workflowCursors = try await queueStore.workflowCursors()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func workflowCursor(for workflowId: String) -> PocketRelayWorkflowCursor? {
        let clean = workflowId.trimmingCharacters(in: .whitespacesAndNewlines)
        return currentWorkflowCursor(for: clean)
    }

    private func currentWorkflowCursor(for workflowId: String) -> PocketRelayWorkflowCursor? {
        guard let pairedSession else { return nil }
        return workflowCursors.first {
            $0.workflowId == workflowId
                && $0.sourceDeviceId == pairedSession.deviceId
                && $0.targetDeviceId == pairedSession.targetDevice.deviceId
        }
    }

    private func validatedWorkflowCursor(
        from result: PocketRelayJSONValue?,
        for record: PocketRelayQueueRecord
    ) throws -> PocketRelayWorkflowCursor? {
        let isWorkflowAction = [
            PocketRelayAction.startWorkflow,
            .pauseWorkflow,
            .cancelWorkflow,
            .getWorkflowResult
        ].contains(record.action)
        guard isWorkflowAction else { return nil }
        guard let cursor = PocketRelayWorkflowCursor.extract(
            from: result,
            sourceDeviceId: record.sourceDeviceId,
            targetDeviceId: record.target.deviceId
        ) else {
            throw PocketRelayLocalError.contract("Die signierte Workflow-Antwort enthält keinen gültigen Lauf-Cursor.")
        }

        switch record.payload {
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            guard cursor.workflowId == workflowId,
                  cursor.runId == runId,
                  cursor.revision == expectedRevision + 1,
                  cursor.inputRef == inputRef,
                  cursor.state == .running
            else { throw PocketRelayLocalError.receiptInvalid }
        case .workflow(let workflowId, let runId, let expectedRevision):
            let expectedState: PocketRelayCommandState = record.action == .pauseWorkflow ? .paused : .cancelled
            guard cursor.workflowId == workflowId,
                  cursor.runId == runId,
                  cursor.revision == expectedRevision + 1,
                  cursor.state == expectedState
            else { throw PocketRelayLocalError.receiptInvalid }
        case .workflowResult(let workflowId, let runId, let knownRevision):
            guard cursor.workflowId == workflowId,
                  cursor.runId == runId,
                  knownRevision.map({ cursor.revision >= $0 }) ?? true
            else { throw PocketRelayLocalError.receiptInvalid }
        default:
            throw PocketRelayLocalError.receiptInvalid
        }
        return cursor
    }

    private func currentSessionMatches(_ record: PocketRelayQueueRecord) -> Bool {
        guard let pairedSession else { return false }
        return pairedSession.deviceId == record.sourceDeviceId
            && pairedSession.targetDevice == record.target
    }

    private func settleVerifiedResponseFromStaleSession(
        response: PocketRelayCommandResponse,
        audit: PocketRelayAuditSummary,
        record: PocketRelayQueueRecord
    ) async throws {
        let terminalState: PocketRelayCommandState
        let errorCode: String?
        let errorMessage: String?
        switch response.state {
        case .completed, .failed, .cancelled:
            terminalState = response.state
            errorCode = response.error?.code
            errorMessage = response.error?.message
        case .queued, .running, .paused:
            terminalState = .failed
            errorCode = "STALE_SESSION_CONTEXT"
            errorMessage = "Die verifizierte Host-Antwort gehört zu einer früheren Gerätekopplung."
        }
        _ = try await queueStore.finish(
            id: record.id,
            state: terminalState,
            reason: "verified_stale_session_\(response.state.rawValue)",
            audit: audit,
            errorCode: errorCode,
            errorMessage: errorMessage
        )
        volatileFileBodies[record.id] = nil
        statusMessage = "Die signierte Antwort gehörte zu einer früheren Gerätekopplung. Resultat und Workflow-Cursor wurden nicht übernommen."
    }

    func clearFetchedFile() {
        fetchedFile = nil
    }

    private func updateConnectionStatus() {
        guard pairedSession != nil else {
            if connectionStatus != .revoked, connectionStatus != .killSwitch {
                connectionStatus = .unconfigured
            }
            return
        }
        guard connectionStatus != .killSwitch, connectionStatus != .revoked else { return }
        connectionStatus = isNetworkAvailable ? .paired : .offline
    }

    private func reconcileStoredSession() async {
        do {
            pairedSession = try await client.currentSession()
        } catch {
            pairedSession = nil
        }
        if pairedSession == nil,
           connectionStatus != .revoked,
           connectionStatus != .killSwitch {
            connectionStatus = .unconfigured
        }
    }

    private func scheduleNextRetry() {
        let dates = queueRecords.compactMap { record -> Date? in
            guard record.state == .paused || record.state == .running else { return nil }
            return record.nextRetryAt
        }
        guard let earliest = dates.min() else { return }
        scheduleRetry(at: earliest)
    }

    private func scheduleRetry(at date: Date) {
        retryTask?.cancel()
        let delay = max(0, date.timeIntervalSinceNow)
        retryTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            await self?.retryEligibleCommands()
        }
    }
}
