import Foundation

public enum LensProfile: String, Codable, CaseIterable, Hashable, Sendable {
    case document
    case receipt
    case businessCard
    case whiteboard
    case errorMessage

    public var title: String {
        switch self {
        case .document: "Dokument"
        case .receipt: "Rechnung"
        case .businessCard: "Visitenkarte"
        case .whiteboard: "Whiteboard"
        case .errorMessage: "Fehlermeldung"
        }
    }

    public var captureSource: CaptureSource {
        switch self {
        case .document: .document
        case .receipt: .receipt
        case .businessCard: .businessCard
        case .whiteboard: .whiteboard
        case .errorMessage: .errorMessage
        }
    }
}

public struct LensAnalysis: Equatable, Sendable {
    public let suggestions: [CaptureSuggestion]
    public let containsSensitiveData: Bool
    public let redactedText: String

    public init(suggestions: [CaptureSuggestion], containsSensitiveData: Bool, redactedText: String) {
        self.suggestions = suggestions
        self.containsSensitiveData = containsSensitiveData
        self.redactedText = redactedText
    }
}

public enum LensAnalyzer {
    public static func analyze(text: String, profile: LensProfile) -> LensAnalysis {
        let lines = text
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var suggestions: [CaptureSuggestion] = []

        if let title = lines.first {
            suggestions.append(.init(kind: .title, label: "Titel", value: String(title.prefix(120))))
        }

        switch profile {
        case .document:
            if !lines.isEmpty {
                suggestions.append(.init(
                    kind: .summary,
                    label: "Kurzvorschau",
                    value: lines.prefix(3).joined(separator: " · ")
                ))
            }
        case .receipt:
            if let amount = firstMatch(
                pattern: #"(?i)(?:summe|gesamt|total)?\s*[:=]?\s*(\d{1,6}[,.]\d{2})\s*(?:€|EUR)"#,
                text: text
            ) {
                suggestions.append(.init(kind: .amount, label: "Möglicher Betrag", value: amount))
            }
            if let date = firstMatch(
                pattern: #"\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b"#,
                text: text
            ) {
                suggestions.append(.init(kind: .dueDate, label: "Mögliches Datum", value: date))
            }
        case .businessCard:
            if let email = firstMatch(
                pattern: #"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"#,
                text: text
            ) {
                suggestions.append(.init(kind: .contact, label: "Mögliche E-Mail", value: email))
            }
            if let phone = firstMatch(
                pattern: #"(?<!\w)(?:\+?\d[\d ()/-]{6,}\d)(?!\w)"#,
                text: text
            ) {
                suggestions.append(.init(kind: .contact, label: "Mögliche Telefonnummer", value: phone))
            }
        case .whiteboard:
            for line in lines where line.range(
                of: #"^(?:[-•*]|\[ ?\]|TODO\b)"#,
                options: [.regularExpression, .caseInsensitive]
            ) != nil {
                suggestions.append(.init(kind: .task, label: "Mögliche Aufgabe", value: String(line.prefix(180))))
            }
        case .errorMessage:
            if let code = firstMatch(
                pattern: #"(?i)\b(?:0x[0-9a-f]{4,}|[A-Z][A-Z0-9_\-]{2,}\d{2,}|(?:error|fehler)\s*[:#]?\s*\d{2,})\b"#,
                text: text
            ) {
                suggestions.append(.init(kind: .errorCode, label: "Möglicher Fehlercode", value: code))
            }
        }

        let redactionPatterns = [
            #"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"#,
            #"(?<!\w)(?:\+?\d[\d ()/-]{6,}\d)(?!\w)"#,
            #"(?i)\b[A-Z]{2}\d{2}(?:[ ]?\d){11,30}\b"#,
            #"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"#
        ]
        var redacted = text
        var containsSensitiveData = false
        for pattern in redactionPatterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(redacted.startIndex..., in: redacted)
            if regex.firstMatch(in: redacted, range: range) != nil {
                containsSensitiveData = true
                redacted = regex.stringByReplacingMatches(
                    in: redacted,
                    range: range,
                    withTemplate: "[redigiert]"
                )
            }
        }

        return LensAnalysis(
            suggestions: suggestions,
            containsSensitiveData: containsSensitiveData,
            redactedText: redacted
        )
    }

    private static func firstMatch(pattern: String, text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(
                in: text,
                range: NSRange(text.startIndex..., in: text)
              ) else { return nil }
        let selectedRange = match.numberOfRanges > 1 && match.range(at: 1).location != NSNotFound
            ? match.range(at: 1)
            : match.range(at: 0)
        guard let range = Range(selectedRange, in: text) else { return nil }
        return String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public enum CaptureDeepLink {
    public static func configuredScheme(bundle: Bundle = .main) -> String {
        let configured = (
            bundle.object(forInfoDictionaryKey: "BirdieURLScheme") as? String
        )
        return validScheme(configured) ?? "birdie"
    }

    public static func url(
        for itemID: UUID,
        scheme: String? = nil
    ) -> URL {
        var components = URLComponents()
        components.scheme = validScheme(scheme) ?? configuredScheme()
        components.host = "capture"
        components.path = "/\(itemID.uuidString.lowercased())"
        return components.url!
    }

    public static func itemID(
        from url: URL,
        scheme: String? = nil
    ) -> UUID? {
        let expectedScheme = (scheme ?? configuredScheme()).lowercased()
        guard url.scheme?.lowercased() == expectedScheme,
              url.host?.lowercased() == "capture",
              url.query == nil,
              url.fragment == nil else { return nil }
        let components = url.pathComponents.filter { $0 != "/" }
        guard components.count == 1 else { return nil }
        return UUID(uuidString: components[0])
    }

    private static func validScheme(_ rawValue: String?) -> String? {
        guard let candidate = rawValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
              !candidate.isEmpty,
              URLComponents(string: "\(candidate)://capture")?.scheme == candidate
        else { return nil }
        return candidate
    }
}
