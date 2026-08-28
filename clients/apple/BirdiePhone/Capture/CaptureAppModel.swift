import CaptureCore
import Combine
import Foundation
import UIKit

@MainActor
final class CaptureAppModel: ObservableObject {
    @Published private(set) var items: [CaptureItem] = []
    @Published var navigationPath: [UUID] = []
    @Published private(set) var configurationError: String?
    @Published private(set) var isPrivacyProtected = true

    private let store: CaptureQueueStore?
    private let stager: CaptureFileStager?
    private let processor: CaptureQueueProcessor?
    private var observers: [NSObjectProtocol] = []
    private var sceneIsActive = false
    private var retryTimerTask: Task<Void, Never>?

    init(bundle: Bundle = .main) {
        do {
            guard let identifier = bundle.object(
                forInfoDictionaryKey: "BirdieAppGroupIdentifier"
            ) as? String else {
                throw CaptureCoreError.appGroupUnavailable("BirdieAppGroupIdentifier")
            }
            let locations = try CaptureStoreLocations.appGroup(identifier)
            let store = try CaptureQueueStore(locations: locations)
            self.store = store
            self.stager = CaptureFileStager(locations: locations)
            self.processor = CaptureQueueProcessor(
                store: store,
                adapter: LocalCaptureMockAdapter(locations: locations)
            )
            try? store.cleanupOrphanedStaging(olderThan: Date().addingTimeInterval(-3_600))
        } catch {
            self.store = nil
            self.stager = nil
            self.processor = nil
            self.configurationError = error.localizedDescription
        }
        observeProtectedData()
        updatePrivacyProtection()
        refresh()
    }

    deinit {
        retryTimerTask?.cancel()
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    func refresh() {
        guard !isPrivacyProtected, let store else {
            items = []
            return
        }
        do {
            items = try store.allItems()
            configurationError = nil
        } catch {
            configurationError = error.localizedDescription
        }
    }

    func processQueue() {
        guard let processor else { return }
        Task {
            await processor.processDueItems()
            refresh()
        }
    }

    func retry(itemID: UUID) {
        guard let processor else { return }
        Task {
            await processor.retryNow(itemID: itemID)
            refresh()
        }
    }

    func delete(itemID: UUID) {
        guard let store else { return }
        do {
            try store.delete(id: itemID)
            navigationPath.removeAll { $0 == itemID }
            refresh()
        } catch {
            configurationError = error.localizedDescription
        }
    }

    @discardableResult
    func handle(deepLink: URL) -> Bool {
        guard let itemID = CaptureDeepLink.itemID(from: deepLink),
              (try? store?.item(id: itemID)) != nil else { return false }
        refresh()
        navigationPath = [itemID]
        return true
    }

    func setSceneActive(_ isActive: Bool) {
        sceneIsActive = isActive
        updatePrivacyProtection()
        if isActive {
            refresh()
            if navigationPath.isEmpty, let store {
                do {
                    if let pendingID = try store.consumePendingOpen() {
                        navigationPath = [pendingID]
                    }
                } catch {
                    configurationError = error.localizedDescription
                }
            }
            processQueue()
            startRetryTimer()
        } else {
            retryTimerTask?.cancel()
            retryTimerTask = nil
        }
    }

    @discardableResult
    func enqueueLens(
        profile: LensProfile,
        intent: CaptureIntent,
        recognizedText: String,
        suggestions: [CaptureSuggestion],
        containsSensitiveData: Bool,
        originalJPEGs: [Data]
    ) throws -> CaptureItem {
        guard let store, let stager else {
            throw CaptureCoreError.appGroupUnavailable("BirdieCapture")
        }
        guard recognizedText.utf8.count <= CaptureLimits.maximumTextBytes else {
            throw CaptureCoreError.invalidPayload("OCR-Text darf höchstens 1 MB groß sein.")
        }
        let totalOriginalBytes = originalJPEGs.reduce(Int64(recognizedText.utf8.count)) {
            $0 + Int64($1.count)
        }
        guard originalJPEGs.count + 1 <= CaptureLimits.maximumPartCount,
              totalOriginalBytes <= CaptureLimits.maximumTotalBytes else {
            throw CaptureCoreError.invalidPayload("Der Scan umfasst zu viele oder zu große Originalseiten.")
        }
        let itemID = UUID()
        var payloads = [CapturePayload(
            kind: .recognizedText,
            displayName: "On-Device OCR",
            typeIdentifier: "public.utf8-plain-text",
            inlineText: recognizedText,
            byteCount: Int64(recognizedText.utf8.count)
        )]
        do {
            for (index, data) in originalJPEGs.enumerated() {
                payloads.append(try stager.stageData(
                    data,
                    itemID: itemID,
                    kind: .image,
                    displayName: "Scan-\(index + 1).jpg",
                    typeIdentifier: "public.jpeg"
                ))
            }
            let item = CaptureItem(
                id: itemID,
                source: profile.captureSource,
                intent: intent,
                status: .queued,
                payloads: payloads,
                suggestions: suggestions,
                originalStorageConsent: .confirmed,
                originalPolicy: originalJPEGs.isEmpty ? .derivedTextOnly : .includeOriginals,
                containsSensitiveData: containsSensitiveData
            )
            _ = try store.enqueue(item)
            refresh()
            processQueue()
            navigationPath = [item.id]
            return item
        } catch {
            try? stager.discardStagedFiles(itemID: itemID)
            throw error
        }
    }

    func item(id: UUID) -> CaptureItem? {
        items.first { $0.id == id }
    }

    private func observeProtectedData() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIApplication.protectedDataWillBecomeUnavailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.updatePrivacyProtection() }
        })
        observers.append(center.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.updatePrivacyProtection() }
        })
    }

    private func updatePrivacyProtection() {
        isPrivacyProtected = !sceneIsActive || !UIApplication.shared.isProtectedDataAvailable
        if isPrivacyProtected {
            items = []
        }
    }

    private func startRetryTimer() {
        guard retryTimerTask == nil else { return }
        retryTimerTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 30_000_000_000)
                } catch {
                    return
                }
                self?.processQueue()
            }
        }
    }
}
