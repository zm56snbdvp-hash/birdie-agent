import Foundation

public enum BirdieRouteSource: String, Codable, Hashable, Sendable {
    case app
    case appIntent
    case control
    case widget
    case externalDeepLink
}

/// A route is a preview request. Handling a route must never execute its domain action.
public struct BirdieRoute: Codable, Hashable, Identifiable, Sendable {
    public static var scheme: String {
        guard let scheme = (
            Bundle.main.object(forInfoDictionaryKey: "BirdieURLScheme") as? String
        )?.trimmingCharacters(in: .whitespacesAndNewlines), !scheme.isEmpty else {
            preconditionFailure("BirdieURLScheme is missing or empty")
        }
        return scheme
    }
    public static let host = "action"
    public static let maximumDraftLength = 2_000

    public let id: UUID
    public let action: BirdieActionKind
    public let source: BirdieRouteSource
    public let focus: BirdieFocusContext?
    public let draft: String?
    public let createdAt: Date

    public init(
        id: UUID = UUID(),
        action: BirdieActionKind,
        source: BirdieRouteSource,
        focus: BirdieFocusContext? = nil,
        draft: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.action = action
        self.source = source
        self.focus = focus
        self.draft = Self.sanitizedDraft(draft)
        self.createdAt = createdAt
    }

    public var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = Self.host
        components.path = "/\(action.rawValue)"
        var items = [URLQueryItem(name: "source", value: source.rawValue)]
        if let focus {
            items.append(URLQueryItem(name: "focus", value: focus.rawValue))
        }
        // Drafts are app-only state. Never place them in URLs, where other apps,
        // diagnostics, screenshots, or sync services could observe them.
        components.queryItems = items
        return components.url!
    }

    public init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        guard
            components.scheme?.lowercased() == Self.scheme,
            components.host?.lowercased() == Self.host,
            components.user == nil,
            components.password == nil,
            components.port == nil,
            components.fragment == nil
        else { return nil }

        let actionPath = components.percentEncodedPath
        guard
            let action = BirdieActionKind.allCases.first(
                where: { actionPath == "/\($0.rawValue)" }
            )
        else { return nil }

        guard components.percentEncodedQuery == nil || components.queryItems != nil else {
            return nil
        }
        let query = components.queryItems ?? []
        let allowedQueryNames: Set<String> = ["source", "focus"]
        guard query.allSatisfy({ allowedQueryNames.contains($0.name) && $0.value != nil }) else {
            return nil
        }

        let groupedQuery = Dictionary(grouping: query, by: \.name)
        guard groupedQuery.values.allSatisfy({ $0.count == 1 }) else { return nil }

        if let sourceValue = groupedQuery["source"]?.first?.value,
           BirdieRouteSource(rawValue: sourceValue) == nil {
            return nil
        }

        let focus: BirdieFocusContext?
        if let focusValue = groupedQuery["focus"]?.first?.value {
            guard let parsedFocus = BirdieFocusContext(rawValue: focusValue) else { return nil }
            focus = parsedFocus
        } else {
            focus = nil
        }

        self.init(
            action: action,
            source: .externalDeepLink,
            focus: focus
        )
    }

    static func sanitizedDraft(_ draft: String?) -> String? {
        guard let draft else { return nil }
        var filtered = ""
        for scalar in draft.unicodeScalars where !isUnsafeDraftScalar(scalar) {
            filtered.append(contentsOf: String(scalar))
        }
        let clean = filtered.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        return String(clean.prefix(maximumDraftLength))
    }

    private static func isUnsafeDraftScalar(_ scalar: Unicode.Scalar) -> Bool {
        if CharacterSet.controlCharacters.contains(scalar) { return true }
        switch scalar.value {
        case 0x061C, 0x200E...0x200F, 0x202A...0x202E, 0x2066...0x2069:
            return true
        default:
            return false
        }
    }
}

public enum BirdieSharedContainer {
    public static var suiteName: String {
        guard let suiteName = (
            Bundle.main.object(forInfoDictionaryKey: "BirdieSharedSuiteName") as? String
        )?.trimmingCharacters(in: .whitespacesAndNewlines), !suiteName.isEmpty else {
            preconditionFailure("BirdieSharedSuiteName is missing or empty")
        }
        return suiteName
    }

    public static var defaults: UserDefaults {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            preconditionFailure("Birdie shared container is unavailable: \(suiteName)")
        }
        return defaults
    }
}

public final class BirdiePendingRouteStore: @unchecked Sendable {
    public static let shared = BirdiePendingRouteStore()
    public static let didChangeNotification = Notification.Name("BirdiePendingRouteDidChange")

    private let defaults: UserDefaults
    private let key = "birdie.pending-route.v1"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let lock = NSLock()
    private let maxAge: TimeInterval
    private let now: () -> Date

    public init(
        defaults: UserDefaults = .standard,
        maxAge: TimeInterval = 5 * 60,
        now: @escaping () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.maxAge = max(0, maxAge)
        self.now = now
    }

    public func stage(_ route: BirdieRoute) {
        lock.lock()
        let safeRoute = BirdieRoute(
            id: route.id,
            action: route.action,
            source: route.source,
            focus: route.focus,
            draft: route.draft,
            createdAt: route.createdAt
        )
        guard let data = try? encoder.encode(safeRoute) else {
            lock.unlock()
            return
        }
        defaults.set(data, forKey: key)
        lock.unlock()
        NotificationCenter.default.post(name: Self.didChangeNotification, object: nil)
    }

    public func consume() -> BirdieRoute? {
        lock.lock()
        defer { lock.unlock() }
        guard defaults.object(forKey: key) != nil else { return nil }
        defer { defaults.removeObject(forKey: key) }
        guard let data = defaults.data(forKey: key),
              let route = try? decoder.decode(BirdieRoute.self, from: data)
        else { return nil }

        let age = now().timeIntervalSince(route.createdAt)
        guard age.isFinite, age >= 0, age <= maxAge else { return nil }
        return BirdieRoute(
            id: route.id,
            action: route.action,
            source: route.source,
            focus: route.focus,
            draft: route.draft,
            createdAt: route.createdAt
        )
    }
}
