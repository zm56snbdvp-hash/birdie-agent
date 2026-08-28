import Foundation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class RecallViewModel: ObservableObject {
    @Published private(set) var items: [RecallItemV1] = []
    @Published private(set) var searchResults: [RecallSearchResultV1] = []
    @Published private(set) var settings = RecallSettingsV1()
    @Published private(set) var deletionHistory: [RecallDeletionReceiptV1] = []
    @Published var queryText = ""
    @Published var filters = RecallSearchFiltersV1()
    @Published var navigationPath: [UUID] = []
    @Published var selectedTab = 0
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var exportDocument: RecallExportDocument?
    @Published var isExporting = false

    private var repository: RecallRepository?
    private var accessGeneration: UInt64 = 0
    private var activeOperations: [UUID: Task<Void, Never>] = [:]
    private var startingGeneration: UInt64?
    private var backgroundSuspensionTask: Task<Void, Never>?
    private let repositoryProvider: @Sendable () async throws -> RecallRepository

    init(
        repository: RecallRepository? = nil,
        repositoryProvider: @escaping @Sendable () async throws -> RecallRepository = {
            try await RecallRepository.live()
        }
    ) {
        self.repository = repository
        self.repositoryProvider = repositoryProvider
    }

    var displayedItems: [RecallItemV1] {
        let hasFilters = !filters.sourceChannels.isEmpty ||
            !filters.kinds.isEmpty ||
            filters.capturedFrom != nil ||
            filters.capturedBefore != nil
        if !queryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasFilters {
            return searchResults.map(\.item)
        }
        return items
    }

    func start() async {
        guard repository == nil else {
            await refresh()
            return
        }
        let generation = accessGeneration
        guard startingGeneration != generation else { return }
        startingGeneration = generation
        defer {
            if startingGeneration == generation { startingGeneration = nil }
        }
        await perform { generation in
            if let backgroundSuspensionTask = self.backgroundSuspensionTask {
                await backgroundSuspensionTask.value
                try self.validateAccess(generation)
                self.backgroundSuspensionTask = nil
            }
            let repository = try await self.repositoryProvider()
            try self.validateAccess(generation)
            self.repository = repository
            try await repository.prepareForUse()
            try await self.reload(from: repository, generation: generation)
        }
    }

    func refresh() async {
        guard let repository else {
            await start()
            return
        }
        await perform { generation in
            try await repository.prepareForUse()
            try await self.reload(from: repository, generation: generation)
            try await self.runSearch(using: repository, generation: generation)
        }
    }

    func lockForBackground() {
        accessGeneration &+= 1
        activeOperations.values.forEach { $0.cancel() }
        let suspendedRepository = repository
        repository = nil
        items = []
        searchResults = []
        deletionHistory = []
        queryText = ""
        filters = RecallSearchFiltersV1()
        navigationPath = []
        exportDocument = nil
        isExporting = false
        errorMessage = nil
        isBusy = false
        let priorSuspensionTask = backgroundSuspensionTask
        backgroundSuspensionTask = Task {
            await priorSuspensionTask?.value
            await suspendedRepository?.suspendAccess()
        }
    }

    func runSearch() async {
        guard let repository else { return }
        await perform { generation in
            try await self.runSearch(using: repository, generation: generation)
        }
    }

    func ingest(_ capture: CaptureItemV1) async -> Bool {
        guard let repository else { return false }
        var succeeded = false
        await perform { generation in
            _ = try await repository.ingest(capture)
            try await self.reload(from: repository, generation: generation)
            try await self.runSearch(using: repository, generation: generation)
            try self.validateAccess(generation)
            succeeded = true
        }
        return succeeded
    }

    func forget(_ identifier: UUID) async {
        guard let repository else { return }
        await perform { generation in
            _ = try await repository.forget(identifier)
            try self.validateAccess(generation)
            self.navigationPath.removeAll { $0 == identifier }
            try await self.reload(from: repository, generation: generation)
            try await self.runSearch(using: repository, generation: generation)
        }
    }

    func forgetAll() async {
        guard let repository else { return }
        await perform { generation in
            _ = try await repository.forgetAll()
            try self.validateAccess(generation)
            self.navigationPath = []
            try await self.reload(from: repository, generation: generation)
            self.searchResults = []
        }
    }

    func engageKillSwitch() async {
        guard let repository else { return }
        await perform { generation in
            _ = try await repository.engageKillSwitch()
            try self.validateAccess(generation)
            self.navigationPath = []
            self.queryText = ""
            self.filters = RecallSearchFiltersV1()
            try await self.reload(from: repository, generation: generation)
            self.searchResults = []
        }
    }

    func enableRecall() async {
        guard let repository else { return }
        await perform { generation in
            try await repository.enableRecall()
            try await self.reload(from: repository, generation: generation)
        }
    }

    func setSpotlightEnabled(_ enabled: Bool) async {
        guard let repository else { return }
        await perform { generation in
            try await repository.setSpotlightEnabled(enabled)
            try await self.reload(from: repository, generation: generation)
        }
    }

    func setDefaultRetentionDays(_ days: Int?, applyToExisting: Bool) async {
        guard let repository else { return }
        await perform { generation in
            try await repository.setDefaultRetentionDays(days, applyToExisting: applyToExisting)
            try await self.reload(from: repository, generation: generation)
            try await self.runSearch(using: repository, generation: generation)
        }
    }

    func prepareExport() async {
        guard let repository else { return }
        await perform { generation in
            let export = try await repository.makePortableExport()
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try self.validateAccess(generation)
            self.exportDocument = RecallExportDocument(data: try encoder.encode(export))
            self.isExporting = true
        }
    }

    func openDeepLink(_ url: URL) async {
        if repository == nil { await start() }
        guard url.scheme?.lowercased() == "birdie",
              url.host?.lowercased() == "recall",
              url.pathComponents.count == 3,
              url.pathComponents[1] == "item",
              let identifier = UUID(uuidString: url.pathComponents[2]),
              items.contains(where: { $0.id == identifier })
        else { return }
        selectedTab = 0
        navigationPath = [identifier]
    }

    func openSpotlightIdentifier(_ value: String) async {
        guard value.hasPrefix("recall:"),
              let identifier = UUID(uuidString: String(value.dropFirst("recall:".count)))
        else { return }
        if repository == nil { await start() }
        guard items.contains(where: { $0.id == identifier }) else { return }
        selectedTab = 0
        navigationPath = [identifier]
    }

    func item(with identifier: UUID) -> RecallItemV1? {
        items.first { $0.id == identifier }
    }

    private func runSearch(using repository: RecallRepository, generation: UInt64) async throws {
        let hasFilters = !filters.sourceChannels.isEmpty ||
            !filters.kinds.isEmpty ||
            filters.capturedFrom != nil ||
            filters.capturedBefore != nil
        if queryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !hasFilters {
            try validateAccess(generation)
            searchResults = []
            return
        }
        let results = try await repository.search(
            RecallSearchQueryV1(text: queryText, filters: filters)
        )
        try validateAccess(generation)
        searchResults = results
    }

    private func reload(from repository: RecallRepository, generation: UInt64) async throws {
        let updatedSettings = await repository.currentSettings()
        let updatedItems = await repository.allItems()
        let updatedDeletionHistory = await repository.deletionHistory()
        try validateAccess(generation)
        settings = updatedSettings
        items = updatedItems
        deletionHistory = updatedDeletionHistory
    }

    private func validateAccess(_ generation: UInt64) throws {
        try Task.checkCancellation()
        guard generation == accessGeneration else { throw CancellationError() }
    }

    private func perform(
        _ operation: @escaping @MainActor (UInt64) async throws -> Void
    ) async {
        let operationIdentifier = UUID()
        let generation = accessGeneration
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try self.validateAccess(generation)
                try await operation(generation)
                try self.validateAccess(generation)
            } catch is CancellationError {
                // Background locking intentionally cancels in-flight UI work without an alert.
            } catch {
                guard generation == self.accessGeneration else { return }
                self.errorMessage = error.localizedDescription
            }
        }
        activeOperations[operationIdentifier] = task
        isBusy = true
        await task.value
        activeOperations[operationIdentifier] = nil
        isBusy = !activeOperations.isEmpty
    }
}

struct RecallExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let data: Data

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
