import AVFoundation
import CaptureCore
import PhotosUI
import SwiftUI
import UIKit
import VisionKit

@MainActor
final class LensCaptureModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case recognizing
        case preview
        case saving
        case saved
    }

    @Published var profile: LensProfile = .document
    @Published var intent: CaptureIntent = .remember
    @Published var includeOriginals = false
    @Published var redactSensitivePreview = true
    @Published var isScannerPresented = false
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var pageImages: [UIImage] = []
    @Published private(set) var recognizedText = ""
    @Published private(set) var suggestions: [CaptureSuggestion] = []
    @Published private(set) var containsSensitiveData = false
    @Published private(set) var redactedText = ""
    @Published private(set) var errorMessage: String?

    private let recognizer = OnDeviceTextRecognizer()
    private var recognitionTask: Task<Void, Never>?
    private var photoLoadTask: Task<Void, Never>?

    deinit {
        recognitionTask?.cancel()
        photoLoadTask?.cancel()
    }

    func requestScan() {
        errorMessage = nil
        guard VNDocumentCameraViewController.isSupported else {
            errorMessage = "Der Dokumentenscanner ist auf diesem Gerät nicht verfügbar."
            return
        }
        Task {
            let authorized: Bool
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                authorized = true
            case .notDetermined:
                authorized = await AVCaptureDevice.requestAccess(for: .video)
            case .denied, .restricted:
                authorized = false
            @unknown default:
                authorized = false
            }
            if authorized {
                isScannerPresented = true
            } else {
                errorMessage = "Kamerazugriff wurde nicht erlaubt. Du kannst alternativ ein einzelnes Bild auswählen."
            }
        }
    }

    func loadPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        photoLoadTask?.cancel()
        errorMessage = nil
        photoLoadTask = Task {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data) else {
                    throw CaptureCoreError.invalidPayload("Das ausgewählte Bild ist nicht lesbar.")
                }
                try Task.checkCancellation()
                accept(images: [image])
            } catch {
                if !Task.isCancelled {
                    errorMessage = error.localizedDescription
                }
            }
            photoLoadTask = nil
        }
    }

    func accept(images: [UIImage]) {
        isScannerPresented = false
        guard !images.isEmpty else { return }
        guard images.count <= CaptureLimits.maximumPartCount else {
            errorMessage = "Ein Scan darf höchstens 20 Seiten enthalten."
            return
        }
        pageImages = images
        phase = .recognizing
        errorMessage = nil
        let cgImages = images.compactMap(\.cgImage)
        guard cgImages.count == images.count else {
            errorMessage = "Mindestens eine Scan-Seite konnte nicht verarbeitet werden."
            phase = .idle
            pageImages = []
            return
        }
        recognitionTask?.cancel()
        recognitionTask = Task {
            do {
                let text = try await recognizer.recognize(images: cgImages)
                try Task.checkCancellation()
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw CaptureCoreError.invalidPayload("Auf dem Scan wurde kein Text erkannt.")
                }
                guard text.utf8.count <= CaptureLimits.maximumTextBytes else {
                    throw CaptureCoreError.invalidPayload("Der erkannte Text überschreitet das sichere Limit von 1 MB.")
                }
                recognizedText = text
                rebuildAnalysis()
                phase = .preview
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
                discardUnconfirmed()
            }
        }
    }

    func scannerFailed(_ error: Error) {
        isScannerPresented = false
        discardUnconfirmed()
        errorMessage = error.localizedDescription
    }

    func profileDidChange() {
        if !recognizedText.isEmpty { rebuildAnalysis() }
    }

    func commit(to appModel: CaptureAppModel, onSaved: () -> Void) {
        guard phase == .preview else { return }
        phase = .saving
        do {
            let originals: [Data]
            if includeOriginals {
                originals = try pageImages.enumerated().map { index, image in
                    guard let data = image.jpegData(compressionQuality: 0.88) else {
                        throw CaptureCoreError.invalidPayload("Scan-Seite \(index + 1) konnte nicht übernommen werden.")
                    }
                    return data
                }
            } else {
                originals = []
            }
            _ = try appModel.enqueueLens(
                profile: profile,
                intent: intent,
                recognizedText: recognizedText,
                suggestions: suggestions,
                containsSensitiveData: containsSensitiveData,
                originalJPEGs: originals
            )
            pageImages = []
            recognizedText = ""
            suggestions = []
            redactedText = ""
            containsSensitiveData = false
            includeOriginals = false
            phase = .saved
            onSaved()
        } catch {
            phase = .preview
            errorMessage = error.localizedDescription
        }
    }

    func discardUnconfirmed() {
        guard phase != .saved else { return }
        recognitionTask?.cancel()
        recognitionTask = nil
        photoLoadTask?.cancel()
        photoLoadTask = nil
        isScannerPresented = false
        pageImages = []
        recognizedText = ""
        suggestions = []
        containsSensitiveData = false
        redactedText = ""
        includeOriginals = false
        if phase != .recognizing { errorMessage = nil }
        phase = .idle
    }

    func startNewScan() {
        phase = .idle
        errorMessage = nil
        pageImages = []
        recognizedText = ""
        suggestions = []
        containsSensitiveData = false
        redactedText = ""
        includeOriginals = false
    }

    private func rebuildAnalysis() {
        let analysis = LensAnalyzer.analyze(text: recognizedText, profile: profile)
        suggestions = analysis.suggestions
        containsSensitiveData = analysis.containsSensitiveData
        redactedText = analysis.redactedText
        if analysis.containsSensitiveData {
            redactSensitivePreview = true
        }
    }
}
