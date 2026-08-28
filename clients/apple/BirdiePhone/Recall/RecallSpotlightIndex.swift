import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

protocol RecallExternalIndexing: Sendable {
    func upsert(_ items: [RecallItemV1]) async throws
    func remove(_ identifiers: [UUID]) async throws
    func removeAll() async throws
}

struct NoopRecallExternalIndex: RecallExternalIndexing {
    func upsert(_ items: [RecallItemV1]) async throws {}
    func remove(_ identifiers: [UUID]) async throws {}
    func removeAll() async throws {}
}

actor CoreSpotlightRecallIndex: RecallExternalIndexing {
    static let domainIdentifier = "de.birdieandbreakfast.birdie.recall.v1"

    private let index = CSSearchableIndex(
        name: "BirdieRecallV1",
        protectionClass: .complete
    )
    private var isOperationInFlight = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []

    func upsert(_ items: [RecallItemV1]) async throws {
        guard !items.isEmpty else { return }
        await acquireExclusiveAccess()
        defer { releaseExclusiveAccess() }
        let searchableItems = items.map(makeSearchableItem)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            index.indexSearchableItems(searchableItems) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    func remove(_ identifiers: [UUID]) async throws {
        guard !identifiers.isEmpty else { return }
        await acquireExclusiveAccess()
        defer { releaseExclusiveAccess() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            index.deleteSearchableItems(withIdentifiers: identifiers.map(Self.searchableIdentifier)) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    func removeAll() async throws {
        await acquireExclusiveAccess()
        defer { releaseExclusiveAccess() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            index.deleteSearchableItems(withDomainIdentifiers: [Self.domainIdentifier]) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    private func acquireExclusiveAccess() async {
        if !isOperationInFlight {
            isOperationInFlight = true
            return
        }
        await withCheckedContinuation { continuation in
            operationWaiters.append(continuation)
        }
    }

    private func releaseExclusiveAccess() {
        if operationWaiters.isEmpty {
            isOperationInFlight = false
        } else {
            operationWaiters.removeFirst().resume()
        }
    }

    private func makeSearchableItem(_ item: RecallItemV1) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.item)
        attributes.title = item.title
        attributes.displayName = item.title
        attributes.contentDescription = safeSnippet(for: item)
        attributes.keywords = item.tags + [item.kind.rawValue]
        attributes.contentCreationDate = item.capturedAt
        attributes.contentURL = item.deepLinkURL
        let searchableItem = CSSearchableItem(
            uniqueIdentifier: Self.searchableIdentifier(item.id),
            domainIdentifier: Self.domainIdentifier,
            attributeSet: attributes
        )
        searchableItem.expirationDate = item.retention.expiresAt ?? .distantFuture
        return searchableItem
    }

    private func safeSnippet(for item: RecallItemV1) -> String? {
        // Keep free-form notes and OCR text out of the system index. The optional
        // summary is the explicitly structured description permitted for Spotlight.
        let candidate = item.summary
        guard let candidate else { return nil }
        return String(candidate.replacingOccurrences(of: "\n", with: " ").prefix(240))
    }

    private static func searchableIdentifier(_ identifier: UUID) -> String {
        "recall:\(identifier.uuidString.lowercased())"
    }
}
