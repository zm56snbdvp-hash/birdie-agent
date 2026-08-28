import CryptoKit
import Foundation
import Security

enum PocketRelayContract {
    static let commandVersion = "pocket-relay.command.v1"
    static let tokenProofVersion = "pocket-relay.token-proof.v1"
    static let pairingVersion = "pocket-relay.pairing.v1"
    static let apiPrefix = "/pocket-relay/v1"
    static let maximumCommandTTL: TimeInterval = 120
    static let maximumClockSkew: TimeInterval = 30
    static let maximumInlineFileBytes = 5 * 1024 * 1024
    static let approvalMethod = "explicit_iphone_confirmation"
}

enum PocketRelayRisk: String, Codable, Sendable {
    case low
    case medium
    case high
}

struct PocketRelayActionDescriptor: Sendable {
    let scope: String
    let risk: PocketRelayRisk
    let expectedEffect: String
}

enum PocketRelayAction: String, Codable, CaseIterable, Identifiable, Sendable {
    case openLink = "link.open.v1"
    case sendFileToPC = "file.send_to_pc.v1"
    case fetchFileToIPhone = "file.fetch_to_iphone.v1"
    case startWorkflow = "workflow.start.v1"
    case pauseWorkflow = "workflow.pause.v1"
    case cancelWorkflow = "workflow.cancel.v1"
    case getWorkflowResult = "workflow.result.get.v1"
    case lockPC = "pc.lock.v1"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .openLink: "Link am PC öffnen"
        case .sendFileToPC: "Datei an PC senden"
        case .fetchFileToIPhone: "Freigegebene Datei holen"
        case .startWorkflow: "Workflow starten"
        case .pauseWorkflow: "Workflow pausieren"
        case .cancelWorkflow: "Workflow abbrechen"
        case .getWorkflowResult: "Workflow-Ergebnis abrufen"
        case .lockPC: "PC sperren"
        }
    }

    var descriptor: PocketRelayActionDescriptor {
        switch self {
        case .openLink:
            PocketRelayActionDescriptor(
                scope: "https_link",
                risk: .low,
                expectedEffect: "Der ausgewählte HTTPS-Link wird im Standardbrowser des Ziel-PCs geöffnet."
            )
        case .sendFileToPC:
            PocketRelayActionDescriptor(
                scope: "selected_file_upload",
                risk: .high,
                expectedEffect: "Die ausdrücklich ausgewählte iPhone-Datei wird an den freigegebenen PC-Eingang übertragen."
            )
        case .fetchFileToIPhone:
            PocketRelayActionDescriptor(
                scope: "approved_host_export",
                risk: .high,
                expectedEffect: "Die zuvor am PC freigegebene Datei wird auf das iPhone übertragen."
            )
        case .startWorkflow:
            PocketRelayActionDescriptor(
                scope: "registered_workflow",
                risk: .high,
                expectedEffect: "Der bereits registrierte Birdie-Workflow wird gestartet oder fortgesetzt."
            )
        case .pauseWorkflow:
            PocketRelayActionDescriptor(
                scope: "registered_workflow",
                risk: .medium,
                expectedEffect: "Der laufende Birdie-Workflow wird an einem sicheren Übergabepunkt pausiert."
            )
        case .cancelWorkflow:
            PocketRelayActionDescriptor(
                scope: "registered_workflow",
                risk: .high,
                expectedEffect: "Der ausgewählte Birdie-Workflow wird abgebrochen; bereits bestätigte externe Effekte werden nicht zurückgerollt."
            )
        case .getWorkflowResult:
            PocketRelayActionDescriptor(
                scope: "registered_workflow",
                risk: .low,
                expectedEffect: "Status und freigegebenes Ergebnis des ausgewählten Birdie-Workflows werden abgerufen."
            )
        case .lockPC:
            PocketRelayActionDescriptor(
                scope: "host_session_lock",
                risk: .high,
                expectedEffect: "Die interaktive Sitzung des Ziel-PCs wird gesperrt."
            )
        }
    }
}

enum PocketRelayCommandState: String, Codable, CaseIterable, Sendable {
    case queued
    case running
    case paused
    case completed
    case failed
    case cancelled

    func canTransition(to next: PocketRelayCommandState) -> Bool {
        if next == self { return true }
        switch self {
        case .queued:
            return [.running, .failed, .cancelled].contains(next)
        case .running:
            return [.paused, .completed, .failed, .cancelled].contains(next)
        case .paused:
            return [.running, .failed, .cancelled].contains(next)
        case .completed, .failed, .cancelled:
            return false
        }
    }

    var title: String {
        switch self {
        case .queued: "Wartet"
        case .running: "Läuft"
        case .paused: "Pausiert"
        case .completed: "Abgeschlossen"
        case .failed: "Fehlgeschlagen"
        case .cancelled: "Abgebrochen"
        }
    }
}

struct PocketRelayTargetDevice: Codable, Equatable, Sendable {
    let deviceId: String
    let deviceName: String
    let platform: String

    func validated() throws -> PocketRelayTargetDevice {
        guard platform == "windows" else {
            throw PocketRelayLocalError.contract("Pocket Relay v1 erlaubt nur ein freigegebenes Windows-Ziel.")
        }
        try PocketRelayValidation.requireOpaqueID(deviceId, field: "target.deviceId")
        guard (1...80).contains(deviceName.count), deviceName == deviceName.trimmingCharacters(in: .whitespacesAndNewlines) else {
            throw PocketRelayLocalError.contract("Der Zielgerätename ist ungültig.")
        }
        return self
    }
}

struct PocketRelayFileMetadata: Codable, Equatable, Sendable {
    let fileName: String
    let contentType: String
    let sizeBytes: Int
    let sha256: String

    func validated() throws -> PocketRelayFileMetadata {
        try PocketRelayValidation.requireLeafFileName(fileName)
        guard (3...128).contains(contentType.count),
              contentType.range(
                of: "^[A-Za-z0-9!#$&^_.+-]{1,64}/[A-Za-z0-9!#$&^_.+-]{1,64}$",
                options: .regularExpression
              ) != nil
        else {
            throw PocketRelayLocalError.contract("Der Dateityp ist ungültig.")
        }
        guard (1...PocketRelayContract.maximumInlineFileBytes).contains(sizeBytes) else {
            throw PocketRelayLocalError.contract("Dateien müssen zwischen 1 Byte und 5 MiB groß sein.")
        }
        guard sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw PocketRelayLocalError.contract("Der Datei-Fingerprint ist ungültig.")
        }
        return self
    }
}

enum PocketRelayPayloadReference: Codable, Equatable, Sendable {
    case link(url: String)
    case fileUpload(PocketRelayFileMetadata)
    case fileFetch(exportId: String)
    case workflowStart(workflowId: String, inputRef: String?, runId: String, expectedRevision: Int)
    case workflow(workflowId: String, runId: String, expectedRevision: Int)
    case workflowResult(workflowId: String, runId: String, knownRevision: Int?)
    case lockPC

    private enum Kind: String, Codable {
        case link
        case fileUpload
        case fileFetch
        case workflowStart
        case workflow
        case workflowResult
        case lockPC
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case url
        case file
        case exportId
        case workflowId
        case inputRef
        case runId
        case expectedRevision
        case knownRevision
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .link:
            self = .link(url: try container.decode(String.self, forKey: .url))
        case .fileUpload:
            self = .fileUpload(try container.decode(PocketRelayFileMetadata.self, forKey: .file))
        case .fileFetch:
            self = .fileFetch(exportId: try container.decode(String.self, forKey: .exportId))
        case .workflowStart:
            self = .workflowStart(
                workflowId: try container.decode(String.self, forKey: .workflowId),
                inputRef: try container.decodeIfPresent(String.self, forKey: .inputRef),
                runId: try container.decode(String.self, forKey: .runId),
                expectedRevision: try container.decode(Int.self, forKey: .expectedRevision)
            )
        case .workflow:
            self = .workflow(
                workflowId: try container.decode(String.self, forKey: .workflowId),
                runId: try container.decode(String.self, forKey: .runId),
                expectedRevision: try container.decode(Int.self, forKey: .expectedRevision)
            )
        case .workflowResult:
            self = .workflowResult(
                workflowId: try container.decode(String.self, forKey: .workflowId),
                runId: try container.decode(String.self, forKey: .runId),
                knownRevision: try container.decodeIfPresent(Int.self, forKey: .knownRevision)
            )
        case .lockPC:
            self = .lockPC
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .link(let url):
            try container.encode(Kind.link, forKey: .kind)
            try container.encode(url, forKey: .url)
        case .fileUpload(let file):
            try container.encode(Kind.fileUpload, forKey: .kind)
            try container.encode(file, forKey: .file)
        case .fileFetch(let exportId):
            try container.encode(Kind.fileFetch, forKey: .kind)
            try container.encode(exportId, forKey: .exportId)
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            try container.encode(Kind.workflowStart, forKey: .kind)
            try container.encode(workflowId, forKey: .workflowId)
            try container.encodeIfPresent(inputRef, forKey: .inputRef)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflow(let workflowId, let runId, let expectedRevision):
            try container.encode(Kind.workflow, forKey: .kind)
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflowResult(let workflowId, let runId, let knownRevision):
            try container.encode(Kind.workflowResult, forKey: .kind)
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encodeIfPresent(knownRevision, forKey: .knownRevision)
        case .lockPC:
            try container.encode(Kind.lockPC, forKey: .kind)
        }
    }

    func validate(for action: PocketRelayAction) throws {
        switch (action, self) {
        case (.openLink, .link(let value)):
            _ = try PocketRelayValidation.normalizedHTTPSURL(value)
        case (.sendFileToPC, .fileUpload(let metadata)):
            _ = try metadata.validated()
        case (.fetchFileToIPhone, .fileFetch(let exportId)):
            try PocketRelayValidation.requireOpaqueID(exportId, field: "payload.exportId")
        case (.startWorkflow, .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision)):
            try PocketRelayValidation.requireOpaqueID(workflowId, field: "payload.workflowId")
            if let inputRef { try PocketRelayValidation.requireOpaqueID(inputRef, field: "payload.inputRef") }
            try PocketRelayValidation.requireUUID(runId, field: "payload.runId")
            try PocketRelayValidation.requireRevision(expectedRevision, field: "payload.expectedRevision")
        case (.pauseWorkflow, .workflow(let workflowId, let runId, let expectedRevision)),
             (.cancelWorkflow, .workflow(let workflowId, let runId, let expectedRevision)):
            try PocketRelayValidation.requireOpaqueID(workflowId, field: "payload.workflowId")
            try PocketRelayValidation.requireUUID(runId, field: "payload.runId")
            try PocketRelayValidation.requireRevision(expectedRevision, field: "payload.expectedRevision")
        case (.getWorkflowResult, .workflowResult(let workflowId, let runId, let knownRevision)):
            try PocketRelayValidation.requireOpaqueID(workflowId, field: "payload.workflowId")
            try PocketRelayValidation.requireUUID(runId, field: "payload.runId")
            if let knownRevision {
                try PocketRelayValidation.requireRevision(knownRevision, field: "payload.knownRevision")
            }
        case (.lockPC, .lockPC):
            break
        default:
            throw PocketRelayLocalError.contract("Aktion und Daten-Scope passen nicht zusammen.")
        }
    }

    var publicSummary: String {
        switch self {
        case .link(let url):
            return url
        case .fileUpload(let file):
            return "\(file.fileName) · \(ByteCountFormatter.string(fromByteCount: Int64(file.sizeBytes), countStyle: .file)) · SHA-256 \(file.sha256.prefix(12))…"
        case .fileFetch(let exportId):
            return "Freigabe-ID: \(exportId)"
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            let base = "Workflow: \(workflowId) · Lauf: \(runId) · Revision: \(expectedRevision)"
            return inputRef.map { "\(base) · Input: \($0)" } ?? base
        case .workflow(let workflowId, let runId, let expectedRevision):
            return "Workflow: \(workflowId) · Lauf: \(runId) · Revision: \(expectedRevision)"
        case .workflowResult(let workflowId, let runId, let knownRevision):
            let revision = knownRevision.map { String($0) } ?? "unbekannt"
            return "Workflow: \(workflowId) · Lauf: \(runId) · Bekannte Revision: \(revision)"
        case .lockPC:
            return "Bestätigungscode: LOCK_PC"
        }
    }
}

private enum PocketRelayWirePayload: Encodable {
    case link(String)
    case file(PocketRelayFileMetadata, Data)
    case export(String)
    case workflowStart(String, String?, String, Int)
    case workflow(String, String, Int)
    case workflowResult(String, String, Int?)
    case lock

    private enum CodingKeys: String, CodingKey {
        case url
        case fileName
        case contentType
        case sizeBytes
        case sha256
        case contentBase64
        case exportId
        case workflowId
        case inputRef
        case runId
        case expectedRevision
        case knownRevision
        case confirmation
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .link(let url):
            try container.encode(url, forKey: .url)
        case .file(let metadata, let data):
            try container.encode(metadata.fileName, forKey: .fileName)
            try container.encode(metadata.contentType, forKey: .contentType)
            try container.encode(metadata.sizeBytes, forKey: .sizeBytes)
            try container.encode(metadata.sha256, forKey: .sha256)
            try container.encode(data.base64EncodedString(), forKey: .contentBase64)
        case .export(let exportId):
            try container.encode(exportId, forKey: .exportId)
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encodeIfPresent(inputRef, forKey: .inputRef)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflow(let workflowId, let runId, let expectedRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflowResult(let workflowId, let runId, let knownRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encodeIfPresent(knownRevision, forKey: .knownRevision)
        case .lock:
            try container.encode("LOCK_PC", forKey: .confirmation)
        }
    }
}

private enum PocketRelayDisclosureData: Encodable {
    case link(String)
    case file(PocketRelayFileMetadata)
    case export(String)
    case workflowStart(String, String?, String, Int)
    case workflow(String, String, Int)
    case workflowResult(String, String, Int?)
    case lock

    private enum CodingKeys: String, CodingKey {
        case url
        case fileName
        case contentType
        case sizeBytes
        case sha256
        case exportId
        case workflowId
        case inputRef
        case runId
        case expectedRevision
        case knownRevision
        case confirmation
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .link(let url):
            try container.encode(url, forKey: .url)
        case .file(let metadata):
            try container.encode(metadata.fileName, forKey: .fileName)
            try container.encode(metadata.contentType, forKey: .contentType)
            try container.encode(metadata.sizeBytes, forKey: .sizeBytes)
            try container.encode(metadata.sha256, forKey: .sha256)
        case .export(let exportId):
            try container.encode(exportId, forKey: .exportId)
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encodeIfPresent(inputRef, forKey: .inputRef)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflow(let workflowId, let runId, let expectedRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        case .workflowResult(let workflowId, let runId, let knownRevision):
            try container.encode(workflowId, forKey: .workflowId)
            try container.encode(runId, forKey: .runId)
            try container.encodeIfPresent(knownRevision, forKey: .knownRevision)
        case .lock:
            try container.encode("LOCK_PC", forKey: .confirmation)
        }
    }
}

private struct PocketRelayDisclosure: Encodable {
    let targetDevice: String
    let scope: String
    let data: PocketRelayDisclosureData
    let expectedEffect: String
}

private struct PocketRelayApproval: Encodable {
    let method: String
    let commandId: String
    let approvedAt: String
}

private struct PocketRelayWireCommand: Encodable {
    let version: String
    let commandId: String
    let idempotencyKey: String
    let deviceId: String
    let nonce: String
    let issuedAt: String
    let expiresAt: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let scope: String
    let payload: PocketRelayWirePayload
    let disclosure: PocketRelayDisclosure
    let approval: PocketRelayApproval?
}

private struct PocketRelayCommandEffectProjection: Encodable {
    let version: String
    let commandId: String
    let idempotencyKey: String
    let deviceId: String
    let action: PocketRelayAction
    let target: PocketRelayTargetDevice
    let scope: String
    let payload: PocketRelayWirePayload
    let disclosure: PocketRelayDisclosure
}

struct PocketRelayReceiptExpectation: Sendable {
    let commandId: String
    let idempotencyKey: String
    let deviceId: String
    let targetDeviceId: String
    let action: PocketRelayAction
    let scope: String
    let risk: PocketRelayRisk
    let expectedEffect: String
    let commandBytesDigest: String
    let commandEffectDigest: String
    let approvalDigest: String?
    let payloadDigest: String
}

struct PocketRelayCommandMaterial: Sendable {
    let bytes: Data
    let nonce: String
    let issuedAt: Date
    let expiresAt: Date
    let receiptExpectation: PocketRelayReceiptExpectation
}

enum PocketRelayCommandBuilder {
    static func build(
        record: PocketRelayQueueRecord,
        deviceId: String,
        fileData: Data?,
        now: Date
    ) throws -> PocketRelayCommandMaterial {
        try record.target.validated()
        try record.payload.validate(for: record.action)
        try PocketRelayValidation.requireOpaqueID(deviceId, field: "command.deviceId")
        guard record.sourceDeviceId == deviceId else {
            throw PocketRelayLocalError.contract("Der Queue-Eintrag ist an eine andere iPhone-Geräteidentität gebunden.")
        }

        let issuedAt = now
        let expiresAt = now.addingTimeInterval(90)
        let nonce = try PocketRelayEncoding.randomBase64URL(byteCount: 32)
        let payload: PocketRelayWirePayload
        let disclosureData: PocketRelayDisclosureData

        switch record.payload {
        case .link(let value):
            let normalized = try PocketRelayValidation.normalizedHTTPSURL(value)
            payload = .link(normalized)
            disclosureData = .link(normalized)
        case .fileUpload(let metadata):
            let validated = try metadata.validated()
            guard let fileData else { throw PocketRelayLocalError.fileReselectionRequired }
            guard fileData.count == validated.sizeBytes else {
                throw PocketRelayLocalError.contract("Die ausgewählte Datei hat sich seit der Freigabe verändert.")
            }
            let digest = SHA256.hash(data: fileData).map { String(format: "%02x", $0) }.joined()
            guard digest == validated.sha256 else {
                throw PocketRelayLocalError.contract("Die ausgewählte Datei hat sich seit der Freigabe verändert.")
            }
            payload = .file(validated, fileData)
            disclosureData = .file(validated)
        case .fileFetch(let exportId):
            payload = .export(exportId)
            disclosureData = .export(exportId)
        case .workflowStart(let workflowId, let inputRef, let runId, let expectedRevision):
            payload = .workflowStart(workflowId, inputRef, runId, expectedRevision)
            disclosureData = .workflowStart(workflowId, inputRef, runId, expectedRevision)
        case .workflow(let workflowId, let runId, let expectedRevision):
            payload = .workflow(workflowId, runId, expectedRevision)
            disclosureData = .workflow(workflowId, runId, expectedRevision)
        case .workflowResult(let workflowId, let runId, let knownRevision):
            payload = .workflowResult(workflowId, runId, knownRevision)
            disclosureData = .workflowResult(workflowId, runId, knownRevision)
        case .lockPC:
            payload = .lock
            disclosureData = .lock
        }

        let descriptor = record.action.descriptor
        var approval: PocketRelayApproval?
        if descriptor.risk == .high {
            guard let approvedAt = record.approvedAt,
                  now.timeIntervalSince(approvedAt) <= PocketRelayContract.maximumCommandTTL + PocketRelayContract.maximumClockSkew,
                  approvedAt <= issuedAt.addingTimeInterval(5)
            else {
                throw PocketRelayLocalError.approvalRequired
            }
            approval = PocketRelayApproval(
                method: PocketRelayContract.approvalMethod,
                commandId: record.id.uuidString.lowercased(),
                approvedAt: PocketRelayTimestamp.string(from: approvedAt)
            )
        }

        let commandId = record.id.uuidString.lowercased()
        let idempotencyKey = record.idempotencyKey.uuidString.lowercased()
        let disclosure = PocketRelayDisclosure(
            targetDevice: record.target.deviceName,
            scope: descriptor.scope,
            data: disclosureData,
            expectedEffect: descriptor.expectedEffect
        )
        let command = PocketRelayWireCommand(
            version: PocketRelayContract.commandVersion,
            commandId: commandId,
            idempotencyKey: idempotencyKey,
            deviceId: deviceId,
            nonce: nonce,
            issuedAt: PocketRelayTimestamp.string(from: issuedAt),
            expiresAt: PocketRelayTimestamp.string(from: expiresAt),
            action: record.action,
            target: record.target,
            scope: descriptor.scope,
            payload: payload,
            disclosure: disclosure,
            approval: approval
        )

        let commandBytes = try PocketRelayEncoding.wireEncoder.encode(command)
        let effect = PocketRelayCommandEffectProjection(
            version: PocketRelayContract.commandVersion,
            commandId: commandId,
            idempotencyKey: idempotencyKey,
            deviceId: deviceId,
            action: record.action,
            target: record.target,
            scope: descriptor.scope,
            payload: payload,
            disclosure: disclosure
        )
        let payloadBytes = try PocketRelayEncoding.wireEncoder.encode(payload)
        let effectBytes = try PocketRelayEncoding.wireEncoder.encode(effect)
        let approvalBytes = try approval.map { try PocketRelayEncoding.wireEncoder.encode($0) }

        return PocketRelayCommandMaterial(
            bytes: commandBytes,
            nonce: nonce,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            receiptExpectation: PocketRelayReceiptExpectation(
                commandId: commandId,
                idempotencyKey: idempotencyKey,
                deviceId: deviceId,
                targetDeviceId: record.target.deviceId,
                action: record.action,
                scope: descriptor.scope,
                risk: descriptor.risk,
                expectedEffect: descriptor.expectedEffect,
                commandBytesDigest: PocketRelayEncoding.sha256Hex(commandBytes),
                commandEffectDigest: PocketRelayEncoding.sha256Hex(effectBytes),
                approvalDigest: approvalBytes.map { PocketRelayEncoding.sha256Hex($0) },
                payloadDigest: PocketRelayEncoding.sha256Hex(payloadBytes)
            )
        )
    }
}

enum PocketRelayValidation {
    private static let opaqueIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"

    static func requireOpaqueID(_ value: String, field: String) throws {
        guard value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              value.range(of: opaqueIDPattern, options: .regularExpression) != nil
        else {
            throw PocketRelayLocalError.contract("\(field) ist keine gültige freigegebene ID.")
        }
    }

    static func requireUUID(_ value: String, field: String) throws {
        guard value.range(
            of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            options: [.regularExpression, .caseInsensitive]
        ) != nil else {
            throw PocketRelayLocalError.contract("\(field) muss eine UUID sein.")
        }
    }

    static func requireRevision(_ value: Int, field: String) throws {
        guard (0...2_147_483_647).contains(value) else {
            throw PocketRelayLocalError.contract("\(field) muss eine nichtnegative sichere Ganzzahl sein.")
        }
    }

    static func requireLeafFileName(_ value: String) throws {
        let unsafeCharacters = CharacterSet(charactersIn: "<>:\"/\\|?*")
        let containsControlCharacter = value.unicodeScalars.contains { $0.value <= 0x1f }
        let baseName = value.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
            .first.map(String.init)?.uppercased() ?? ""
        let reservedNames: Set<String> = [
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
        ]
        guard (1...255).contains(value.count),
              value != ".", value != "..",
              value.rangeOfCharacter(from: unsafeCharacters) == nil,
              !containsControlCharacter,
              !value.hasSuffix("."), !value.hasSuffix(" "),
              !reservedNames.contains(baseName),
              value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            throw PocketRelayLocalError.contract("Nur ein portabler Dateiname ohne Pfad, Stream oder reservierten Windows-Gerätenamen ist erlaubt.")
        }
    }

    static func normalizedHTTPSURL(_ value: String) throws -> String {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean == value, clean.count >= 9, clean.count <= 2_048,
              var components = URLComponents(string: clean),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil
        else {
            throw PocketRelayLocalError.contract("Nur HTTPS-Links ohne eingebettete Zugangsdaten sind erlaubt.")
        }
        components.scheme = "https"
        guard components.url != nil else {
            throw PocketRelayLocalError.contract("Der HTTPS-Link ist ungültig.")
        }
        return clean
    }
}

enum PocketRelayTimestamp {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    static func date(from value: String) throws -> Date {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value), value.hasSuffix("Z") { return date }
        let basic = ISO8601DateFormatter()
        basic.formatOptions = [.withInternetDateTime]
        if let date = basic.date(from: value), value.hasSuffix("Z") { return date }
        throw PocketRelayLocalError.contract("Der Host hat einen ungültigen UTC-Zeitstempel geliefert.")
    }
}

enum PocketRelayEncoding {
    static var wireEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decodeBase64URL(_ value: String) throws -> Data {
        guard !value.isEmpty,
              value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
        else {
            throw PocketRelayLocalError.contract("Der Host hat ungültiges base64url geliefert.")
        }
        let remainder = value.count % 4
        let padding = remainder == 0 ? "" : String(repeating: "=", count: 4 - remainder)
        let base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding
        guard let data = Data(base64Encoded: base64), base64URL(data) == value else {
            throw PocketRelayLocalError.contract("Der Host hat nicht-kanonisches base64url geliefert.")
        }
        return data
    }

    static func randomBase64URL(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw PocketRelayLocalError.keychain(status) }
        return base64URL(Data(bytes))
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

indirect enum PocketRelayJSONValue: Codable, Equatable, Sendable {
    case object([String: PocketRelayJSONValue])
    case array([PocketRelayJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: PocketRelayJSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([PocketRelayJSONValue].self) { self = .array(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var compactDescription: String {
        switch self {
        case .object(let value): return value.keys.sorted().joined(separator: ", ")
        case .array(let value): return "\(value.count) Einträge"
        case .string(let value): return String(value.prefix(240))
        case .number(let value): return String(value)
        case .bool(let value): return value ? "Ja" : "Nein"
        case .null: return "Kein Ergebnis"
        }
    }
}

enum PocketRelayLocalError: LocalizedError, Sendable {
    case unconfigured
    case insecureHost
    case contract(String)
    case keychain(OSStatus)
    case notPaired
    case approvalRequired
    case approvalSnapshotChanged
    case fileReselectionRequired
    case receiptInvalid
    case stateTransition(PocketRelayCommandState, PocketRelayCommandState)

    var errorDescription: String? {
        switch self {
        case .unconfigured: "Pocket Relay ist nicht konfiguriert. Hinterlege zuerst einen sicheren Host."
        case .insecureHost: "Der Host muss HTTPS verwenden. Nur ein Debug-Build darf HTTP zu localhost nutzen."
        case .contract(let message): message
        case .keychain(let status): "Pocket-Relay-Keychain-Fehler: \(status)"
        case .notPaired: "Dieses iPhone ist noch nicht mit einem Pocket-Relay-Host gekoppelt."
        case .approvalRequired: "Diese Hochrisiko-Aktion muss auf dem iPhone erneut ausdrücklich freigegeben werden."
        case .approvalSnapshotChanged: "Der angezeigte Auftrag hat sich vor der Freigabe geändert. Prüfe ihn erneut."
        case .fileReselectionRequired: "Die Datei wird nicht in der Offline-Queue gespeichert und muss erneut ausgewählt werden."
        case .receiptInvalid: "Die signierte Audit-Quittung des Hosts konnte nicht verifiziert werden."
        case .stateTransition(let from, let to): "Ungültiger Statuswechsel von \(from.rawValue) nach \(to.rawValue)."
        }
    }
}
