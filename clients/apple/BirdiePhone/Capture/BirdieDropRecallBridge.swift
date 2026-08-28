import CaptureCore
import Foundation

enum BirdieDropRecallBridgeError: LocalizedError, Equatable {
    case notBirdieDrop
    case requiresSinglePayload
    case captureNotReady
    case unsupportedPayload
    case invalidLink

    var errorDescription: String? {
        switch self {
        case .notBirdieDrop:
            "Nur ausdrücklich über Birdie Drop geteilte Inhalte können in Recall übernommen werden."
        case .requiresSinglePayload:
            "Recall übernimmt genau einen ausgewählten Birdie-Drop-Inhalt pro Eintrag."
        case .captureNotReady:
            "Der Birdie-Drop-Inhalt ist noch nicht lokal zur Prüfung vorbereitet."
        case .unsupportedPayload:
            "Dieser Birdie-Drop-Inhalt kann nicht als Recall-Element übernommen werden."
        case .invalidLink:
            "Der geteilte Link ist ungültig oder verwendet kein HTTP(S)."
        }
    }
}

/// Maps one reviewed, local Birdie-Drop item to the independent Recall V1 contract.
/// The bridge deliberately refuses multi-part captures and never imports Recall storage internals.
enum BirdieDropRecallBridgeV1 {
    static func makeCapture(
        from item: CaptureItem,
        store: CaptureQueueStore
    ) throws -> CaptureItemV1 {
        guard item.source == .shareExtension else {
            throw BirdieDropRecallBridgeError.notBirdieDrop
        }
        guard item.status == .readyForReview else {
            throw BirdieDropRecallBridgeError.captureNotReady
        }
        guard item.payloads.count == 1, let payload = item.payloads.first else {
            throw BirdieDropRecallBridgeError.requiresSinglePayload
        }

        let provenance = RecallProvenanceV1(
            channel: .birdieDrop,
            sourceApplication: "Birdie Drop",
            sourceItemIdentifier: item.id.uuidString.lowercased(),
            submittedAt: item.createdAt
        )
        let summary = item.suggestions.first(where: { $0.kind == .summary })?.value
        let title = payload.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let captureTitle = title.isEmpty ? "Birdie Drop" : title

        switch payload.kind {
        case .url:
            guard let value = payload.inlineText,
                  let url = URL(string: value),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https"].contains(scheme),
                  url.host != nil else {
                throw BirdieDropRecallBridgeError.invalidLink
            }
            return CaptureItemV1(
                id: item.id,
                kind: .link,
                title: captureTitle,
                provenance: provenance,
                capturedAt: item.createdAt,
                linkURL: url,
                summary: summary
            )

        case .text:
            guard let text = payload.inlineText,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw BirdieDropRecallBridgeError.unsupportedPayload
            }
            return CaptureItemV1(
                id: item.id,
                kind: .note,
                title: captureTitle,
                provenance: provenance,
                capturedAt: item.createdAt,
                note: text,
                summary: summary
            )

        case .image, .pdf:
            guard item.originalStorageConsent == .confirmed,
                  let relativePath = payload.relativeFilePath else {
                throw BirdieDropRecallBridgeError.unsupportedPayload
            }
            let localFileURL = try store.resolvedStagedFile(
                relativePath: relativePath,
                itemID: item.id
            )
            return CaptureItemV1(
                id: item.id,
                kind: payload.kind == .image ? .photo : .pdf,
                title: captureTitle,
                provenance: provenance,
                capturedAt: item.createdAt,
                localFileURL: localFileURL,
                contentTypeIdentifier: payload.typeIdentifier,
                summary: summary
            )

        case .recognizedText, .file:
            throw BirdieDropRecallBridgeError.unsupportedPayload
        }
    }
}
