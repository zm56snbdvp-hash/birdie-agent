import CaptureCore
import Combine
import Foundation
import QuickLookThumbnailing
import UIKit
import UniformTypeIdentifiers

@MainActor
final class ShareCaptureModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case preview
        case saving
        case saved(URL)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var payloads: [CapturePayload] = []
    @Published private(set) var thumbnails: [UUID: UIImage] = [:]
    @Published var selectedIntent: CaptureIntent = .remember
    @Published private(set) var isObscured = false

    var showsCancellationAction: Bool {
        switch phase {
        case .loading, .preview:
            true
        case .saving, .saved, .failed:
            false
        }
    }

    private let extensionContext: NSExtensionContext
    private let store: CaptureQueueStore
    private let stager: CaptureFileStager
    private let itemID = UUID()
    private var committed = false
    private var wasCancelled = false
    private var loadingTask: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []

    init(
        extensionContext: NSExtensionContext,
        store: CaptureQueueStore,
        stager: CaptureFileStager
    ) {
        self.extensionContext = extensionContext
        self.store = store
        self.stager = stager
        observePrivacyState()
    }

    deinit {
        loadingTask?.cancel()
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        if !committed {
            try? stager.discardStagedFiles(itemID: itemID)
        }
    }

    func load(inputItems: [Any]) {
        loadingTask?.cancel()
        wasCancelled = false
        thumbnails = [:]
        phase = .loading
        loadingTask = Task {
            do {
                let providers = inputItems
                    .compactMap { $0 as? NSExtensionItem }
                    .flatMap { $0.attachments ?? [] }
                guard !providers.isEmpty else {
                    throw CaptureCoreError.invalidPayload("Es wurde kein Inhalt geteilt.")
                }
                guard providers.count <= CaptureLimits.maximumPartCount else {
                    throw CaptureCoreError.invalidPayload("Es können höchstens 20 Inhalte übernommen werden.")
                }

                var loaded: [CapturePayload] = []
                var totalBytes: Int64 = 0
                for provider in providers {
                    try Task.checkCancellation()
                    let payload = try await load(provider: provider)
                    try Task.checkCancellation()
                    guard !wasCancelled else { throw CancellationError() }
                    loaded.append(payload)
                    if let thumbnail = await thumbnail(for: payload) {
                        try Task.checkCancellation()
                        thumbnails[payload.id] = thumbnail
                    }
                    totalBytes += payload.byteCount ?? Int64(payload.inlineText?.utf8.count ?? 0)
                    guard totalBytes <= CaptureLimits.maximumTotalBytes else {
                        throw CaptureCoreError.invalidPayload("Die Auswahl darf zusammen höchstens 250 MB groß sein.")
                    }
                }
                try Task.checkCancellation()
                guard !wasCancelled else { throw CancellationError() }
                payloads = loaded
                phase = .preview
            } catch {
                try? stager.discardStagedFiles(itemID: itemID)
                thumbnails = [:]
                if !(error is CancellationError), !wasCancelled {
                    phase = .failed(error.localizedDescription)
                }
            }
            loadingTask = nil
        }
    }

    func commit() {
        guard phase == .preview, !payloads.isEmpty else { return }
        phase = .saving
        do {
            let item = CaptureItem(
                id: itemID,
                source: .shareExtension,
                intent: selectedIntent,
                status: .queued,
                payloads: payloads,
                originalStorageConsent: .confirmed
            )
            _ = try store.enqueue(item)
            committed = true
            try? store.markForOpening(id: item.id)
            phase = .saved(item.deepLink)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func finish() {
        extensionContext.completeRequest(returningItems: nil)
    }

    func cancel() {
        wasCancelled = true
        loadingTask?.cancel()
        if !committed {
            try? stager.discardStagedFiles(itemID: itemID)
        }
        thumbnails = [:]
        extensionContext.cancelRequest(withError: CocoaError(.userCancelled))
    }

    private func load(provider: NSItemProvider) async throws -> CapturePayload {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            return try await loadURL(provider: provider)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            return try await loadText(provider: provider)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            return try await loadFile(
                provider: provider,
                typeIdentifier: UTType.pdf.identifier,
                kind: .pdf
            )
        }
        if let type = provider.registeredTypeIdentifiers
            .compactMap(UTType.init)
            .first(where: { $0.conforms(to: .image) }) {
            return try await loadFile(
                provider: provider,
                typeIdentifier: type.identifier,
                kind: .image
            )
        }
        guard let identifier = provider.registeredTypeIdentifiers.first(where: {
            $0 != UTType.item.identifier && $0 != UTType.data.identifier
        }) ?? provider.registeredTypeIdentifiers.first else {
            throw CaptureCoreError.invalidPayload("Der Inhaltstyp wird nicht unterstützt.")
        }
        return try await loadFile(provider: provider, typeIdentifier: identifier, kind: .file)
    }

    private func loadURL(provider: NSItemProvider) async throws -> CapturePayload {
        let stager = stager
        let itemID = itemID
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
                do {
                    if let error { throw error }
                    let url = (item as? URL) ?? (item as? NSURL).map { $0 as URL }
                    guard let url else {
                        throw CaptureCoreError.invalidPayload("Die URL ist ungültig.")
                    }
                    if url.isFileURL {
                        let payload = try stager.stageFile(
                            at: url,
                            itemID: itemID,
                            kind: captureKind(for: url),
                            typeIdentifier: nil
                        )
                        continuation.resume(returning: payload)
                    } else {
                        let text = url.absoluteString
                        guard text.utf8.count <= CaptureLimits.maximumTextBytes else {
                            throw CaptureCoreError.invalidPayload("Die URL ist zu lang.")
                        }
                        continuation.resume(returning: CapturePayload(
                            kind: .url,
                            displayName: url.host ?? "URL",
                            typeIdentifier: UTType.url.identifier,
                            inlineText: text,
                            byteCount: Int64(text.utf8.count)
                        ))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func loadText(provider: NSItemProvider) async throws -> CapturePayload {
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
                do {
                    if let error { throw error }
                    let text: String?
                    if let value = item as? String {
                        text = value
                    } else if let value = item as? NSString {
                        text = value as String
                    } else if let data = item as? Data {
                        text = String(data: data, encoding: .utf8)
                    } else {
                        text = nil
                    }
                    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                        throw CaptureCoreError.invalidPayload("Der Text ist leer oder unlesbar.")
                    }
                    guard text.utf8.count <= CaptureLimits.maximumTextBytes else {
                        throw CaptureCoreError.invalidPayload("Text darf höchstens 1 MB groß sein.")
                    }
                    continuation.resume(returning: CapturePayload(
                        kind: .text,
                        displayName: "Geteilter Text",
                        typeIdentifier: UTType.plainText.identifier,
                        inlineText: text,
                        byteCount: Int64(text.utf8.count)
                    ))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func loadFile(
        provider: NSItemProvider,
        typeIdentifier: String,
        kind: CapturePayloadKind
    ) async throws -> CapturePayload {
        let stager = stager
        let itemID = itemID
        let suggestedName = provider.suggestedName
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                do {
                    if let error { throw error }
                    guard let url else {
                        throw CaptureCoreError.invalidPayload("Die Datei ist nicht verfügbar.")
                    }
                    let payload = try stager.stageFile(
                        at: url,
                        itemID: itemID,
                        kind: kind,
                        displayName: suggestedName ?? url.lastPathComponent,
                        typeIdentifier: typeIdentifier
                    )
                    continuation.resume(returning: payload)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func thumbnail(for payload: CapturePayload) async -> UIImage? {
        guard [.image, .pdf].contains(payload.kind),
              let relativePath = payload.relativeFilePath,
              let fileURL = try? store.resolvedStagedFile(
                relativePath: relativePath,
                itemID: itemID
              ) else { return nil }
        let request = QLThumbnailGenerator.Request(
            fileAt: fileURL,
            size: CGSize(width: 180, height: 180),
            scale: UIScreen.main.scale,
            representationTypes: .thumbnail
        )
        return await withCheckedContinuation { continuation in
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, _ in
                continuation.resume(returning: representation?.uiImage)
            }
        }
    }

    private func observePrivacyState() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: Notification.Name("UIApplicationWillResignActiveNotification"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.isObscured = true
                self?.thumbnails = [:]
            }
        })
        observers.append(center.addObserver(
            forName: Notification.Name("UIApplicationDidBecomeActiveNotification"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.isObscured = false }
        })
        observers.append(center.addObserver(
            forName: Notification.Name("NSExtensionHostDidEnterBackground"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.isObscured = true
                self?.thumbnails = [:]
            }
        })
        observers.append(center.addObserver(
            forName: Notification.Name("NSExtensionHostWillResignActive"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.isObscured = true
                self?.thumbnails = [:]
            }
        })
        observers.append(center.addObserver(
            forName: Notification.Name("NSExtensionHostDidBecomeActive"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.isObscured = false }
        })
    }
}

private func captureKind(for fileURL: URL) -> CapturePayloadKind {
    guard let type = UTType(filenameExtension: fileURL.pathExtension) else { return .file }
    if type.conforms(to: .pdf) { return .pdf }
    if type.conforms(to: .image) { return .image }
    return .file
}
