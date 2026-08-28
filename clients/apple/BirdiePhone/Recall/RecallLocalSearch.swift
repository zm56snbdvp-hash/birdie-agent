import Foundation

struct RecallIndexDocumentV1: Codable, Hashable, Sendable {
    var termWeights: [String: Double]
}

struct RecallLocalSearchIndexV1: Codable, Hashable, Sendable {
    private(set) var documents: [String: RecallIndexDocumentV1] = [:]

    var itemIdentifiers: Set<UUID> {
        Set(documents.keys.compactMap(UUID.init(uuidString:)))
    }

    mutating func upsert(_ item: RecallItemV1) {
        documents[item.id.uuidString.lowercased()] = RecallIndexDocumentV1(
            termWeights: RecallTextNormalizer.weightedTerms(for: item)
        )
    }

    mutating func remove(_ identifiers: some Sequence<UUID>) {
        for identifier in identifiers {
            documents.removeValue(forKey: identifier.uuidString.lowercased())
        }
    }

    func document(for identifier: UUID) -> RecallIndexDocumentV1? {
        documents[identifier.uuidString.lowercased()]
    }

    static func rebuilding(from items: some Sequence<RecallItemV1>) -> RecallLocalSearchIndexV1 {
        var index = RecallLocalSearchIndexV1()
        for item in items { index.upsert(item) }
        return index
    }
}

enum RecallTextNormalizer {
    private static let stopWords: Set<String> = [
        "aber", "am", "an", "auf", "aus", "bei", "bin", "bis", "das", "dem", "den", "der",
        "des", "die", "ein", "eine", "einer", "eines", "für", "hat", "ich", "im", "in", "ist",
        "mit", "nach", "oder", "sein", "und", "von", "vom", "war", "was", "welche", "welcher",
        "welches", "wie", "wo", "zu", "zum", "zur", "gestern", "heute", "vorgestern",
        "a", "an", "and", "at", "from", "in", "is", "of", "on", "or", "the", "to", "was",
        "what", "when", "where", "which", "yesterday", "today"
    ]

    static func normalized(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "de_DE"))
            .lowercased()
    }

    static func terms(in value: String, removingStopWords: Bool = true) -> [String] {
        let scalars = normalized(value).unicodeScalars
        return scalars
            .split { !CharacterSet.alphanumerics.contains($0) }
            .map(String.init)
            .filter { term in
                term.count >= 2 && (!removingStopWords || !stopWords.contains(term))
            }
    }

    static func weightedTerms(for item: RecallItemV1) -> [String: Double] {
        var result: [String: Double] = [:]

        func add(_ value: String?, weight: Double) {
            guard let value else { return }
            for term in terms(in: value, removingStopWords: false) {
                result[term, default: 0] += weight
            }
        }

        add(item.title, weight: 6)
        for tag in item.tags { add(tag, weight: 5) }
        add(item.attachment?.originalFilename, weight: 3)
        add(item.linkURL?.host, weight: 3)
        add(item.linkURL?.absoluteString, weight: 2)
        add(item.summary, weight: 2)
        add(item.note, weight: 1.5)
        add(item.extractedText, weight: 1)
        add(item.provenance.sourceApplication, weight: 1)
        return result
    }
}

enum RecallDeterministicSearch {
    private struct DateWindow {
        let start: Date
        let end: Date
    }

    static func search(
        query: RecallSearchQueryV1,
        records: [RecallStoredItemV1],
        index: RecallLocalSearchIndexV1,
        now: Date,
        calendar: Calendar
    ) throws -> [RecallSearchResultV1] {
        guard query.contractVersion == RecallSearchQueryV1.currentContractVersion else {
            throw BirdieRecallError.invalidContractVersion(query.contractVersion)
        }
        guard (1...200).contains(query.limit) else {
            throw BirdieRecallError.invalidPayload("Das Suchlimit muss zwischen 1 und 200 liegen.")
        }

        let queryTerms = Array(Set(RecallTextNormalizer.terms(in: query.text))).sorted()
        let naturalWindow = naturalDateWindow(in: query.text, now: now, calendar: calendar)
        let effectiveStart = later(query.filters.capturedFrom, naturalWindow?.start)
        let effectiveEnd = earlier(query.filters.capturedBefore, naturalWindow?.end)

        var results: [RecallSearchResultV1] = []
        for record in records where record.pendingDeletion == nil {
            let item = record.item
            guard query.filters.sourceChannels.isEmpty || query.filters.sourceChannels.contains(item.provenance.channel) else {
                continue
            }
            guard query.filters.kinds.isEmpty || query.filters.kinds.contains(item.kind) else { continue }
            guard effectiveStart.map({ item.capturedAt >= $0 }) ?? true else { continue }
            guard effectiveEnd.map({ item.capturedAt < $0 }) ?? true else { continue }
            guard let document = index.document(for: item.id) else { continue }

            var score: Double = naturalWindow == nil ? 0 : 4
            var matchedTerms: [String] = []
            for queryTerm in queryTerms {
                if let exact = document.termWeights[queryTerm] {
                    score += exact
                    matchedTerms.append(queryTerm)
                    continue
                }

                guard queryTerm.count >= 4 else { continue }
                let prefixWeight = document.termWeights
                    .filter { documentTerm, _ in
                        documentTerm.count >= 4 && (
                            documentTerm.hasPrefix(queryTerm) || queryTerm.hasPrefix(documentTerm)
                        )
                    }
                    .map(\.value)
                    .max()
                if let prefixWeight {
                    score += prefixWeight * 0.65
                    matchedTerms.append(queryTerm)
                }
            }

            if !queryTerms.isEmpty, matchedTerms.isEmpty { continue }
            results.append(
                RecallSearchResultV1(
                    item: item,
                    score: score,
                    matchedTerms: matchedTerms.sorted()
                )
            )
        }

        return Array(results.sorted(by: stableOrdering).prefix(query.limit))
    }

    private static func stableOrdering(_ lhs: RecallSearchResultV1, _ rhs: RecallSearchResultV1) -> Bool {
        if lhs.score != rhs.score { return lhs.score > rhs.score }
        if lhs.item.capturedAt != rhs.item.capturedAt { return lhs.item.capturedAt > rhs.item.capturedAt }
        return lhs.item.id.uuidString < rhs.item.id.uuidString
    }

    private static func naturalDateWindow(
        in query: String,
        now: Date,
        calendar: Calendar
    ) -> DateWindow? {
        let normalized = RecallTextNormalizer.normalized(query)
        let dayOffset: Int?
        if containsWord("vorgestern", in: normalized) {
            dayOffset = -2
        } else if containsWord("gestern", in: normalized) || containsWord("yesterday", in: normalized) {
            dayOffset = -1
        } else if containsWord("heute", in: normalized) || containsWord("today", in: normalized) {
            dayOffset = 0
        } else {
            dayOffset = nil
        }

        if let dayOffset,
           let target = calendar.date(byAdding: .day, value: dayOffset, to: now) {
            let start = calendar.startOfDay(for: target)
            guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return nil }
            return DateWindow(start: start, end: end)
        }

        guard let isoDate = firstISODate(in: normalized, calendar: calendar) else { return nil }
        let start = calendar.startOfDay(for: isoDate)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return nil }
        return DateWindow(start: start, end: end)
    }

    private static func containsWord(_ word: String, in value: String) -> Bool {
        RecallTextNormalizer.terms(in: value, removingStopWords: false).contains(word)
    }

    private static func firstISODate(in value: String, calendar: Calendar) -> Date? {
        guard let expression = try? NSRegularExpression(pattern: #"\b(\d{4})-(\d{2})-(\d{2})\b"#),
              let match = expression.firstMatch(
                in: value,
                range: NSRange(value.startIndex..., in: value)
              ),
              match.numberOfRanges == 4,
              let yearRange = Range(match.range(at: 1), in: value),
              let monthRange = Range(match.range(at: 2), in: value),
              let dayRange = Range(match.range(at: 3), in: value),
              let year = Int(value[yearRange]),
              let month = Int(value[monthRange]),
              let day = Int(value[dayRange])
        else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }

    private static func later(_ lhs: Date?, _ rhs: Date?) -> Date? {
        switch (lhs, rhs) {
        case (.none, .none): nil
        case (.some(let value), .none), (.none, .some(let value)): value
        case (.some(let lhs), .some(let rhs)): max(lhs, rhs)
        }
    }

    private static func earlier(_ lhs: Date?, _ rhs: Date?) -> Date? {
        switch (lhs, rhs) {
        case (.none, .none): nil
        case (.some(let value), .none), (.none, .some(let value)): value
        case (.some(let lhs), .some(let rhs)): min(lhs, rhs)
        }
    }
}
