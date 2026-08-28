import CoreGraphics
import Foundation
import Vision

struct OnDeviceTextRecognizer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "de.birdie.capture.vision", qos: .userInitiated)

    func recognize(images: [CGImage]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    var pages: [String] = []
                    for image in images {
                        let request = VNRecognizeTextRequest()
                        request.recognitionLevel = .accurate
                        request.usesLanguageCorrection = true
                        request.automaticallyDetectsLanguage = true
                        let handler = VNImageRequestHandler(cgImage: image, options: [:])
                        try handler.perform([request])
                        let text = (request.results ?? [])
                            .compactMap { $0.topCandidates(1).first?.string }
                            .joined(separator: "\n")
                        if !text.isEmpty { pages.append(text) }
                    }
                    continuation.resume(returning: pages.joined(separator: "\n\n— Seite —\n\n"))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
