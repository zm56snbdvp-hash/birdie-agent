import Foundation
import PDFKit
import Vision

protocol RecallTextExtracting: Sendable {
    func extractText(from localFileURL: URL, kind: RecallItemKindV1) async throws -> String?
}

struct NoopRecallTextExtractor: RecallTextExtracting {
    func extractText(from localFileURL: URL, kind: RecallItemKindV1) async throws -> String? { nil }
}

struct LocalRecallTextExtractor: RecallTextExtracting {
    private static let maximumExtractedCharacters = 500_000

    func extractText(from localFileURL: URL, kind: RecallItemKindV1) async throws -> String? {
        let extractionTask = Task.detached(priority: .utility) {
            try Task.checkCancellation()
            let accessedSecurityScope = localFileURL.startAccessingSecurityScopedResource()
            defer {
                if accessedSecurityScope { localFileURL.stopAccessingSecurityScopedResource() }
            }

            let text: String?
            switch kind {
            case .pdf:
                text = PDFDocument(url: localFileURL)?.string
            case .photo, .screenshot:
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.recognitionLanguages = ["de-DE", "en-US"]
                let handler = VNImageRequestHandler(url: localFileURL, options: [:])
                try handler.perform([request])
                text = request.results?
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
            case .link, .note:
                text = nil
            }

            try Task.checkCancellation()
            guard let text else { return nil }
            let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { return nil }
            return String(cleaned.prefix(Self.maximumExtractedCharacters))
        }
        return try await withTaskCancellationHandler {
            let result = try await extractionTask.value
            try Task.checkCancellation()
            return result
        } onCancel: {
            extractionTask.cancel()
        }
    }
}
