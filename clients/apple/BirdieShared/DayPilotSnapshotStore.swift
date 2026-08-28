import Foundation

public final class DayPilotSnapshotStore: @unchecked Sendable {
    public static let shared = DayPilotSnapshotStore()

    private let defaults: UserDefaults
    private let key = "birdie.day-pilot.snapshot.v1"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let lock = NSLock()
    private let maxAge: TimeInterval

    public init(
        defaults: UserDefaults = BirdieSharedContainer.defaults,
        maxAge: TimeInterval = 6 * 60 * 60
    ) {
        self.defaults = defaults
        self.maxAge = max(0, maxAge)
    }

    public func save(_ snapshot: DayPilotSnapshot) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: key)
    }

    public func load(now: Date = Date()) -> DayPilotSnapshot {
        lock.lock()
        defer { lock.unlock() }
        guard defaults.object(forKey: key) != nil else { return .placeholder(now: now) }
        guard let data = defaults.data(forKey: key),
              let snapshot = try? decoder.decode(DayPilotSnapshot.self, from: data)
        else {
            defaults.removeObject(forKey: key)
            return .placeholder(now: now)
        }

        let age = now.timeIntervalSince(snapshot.generatedAt)
        guard age.isFinite, age >= 0, age <= maxAge else {
            defaults.removeObject(forKey: key)
            return .placeholder(now: now)
        }
        return snapshot
    }
}

public final class BirdieThoughtStore: @unchecked Sendable {
    public static let shared = BirdieThoughtStore()

    private let defaults: UserDefaults
    private let key = "birdie.confirmed-thoughts.v1"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func saveConfirmed(_ thought: String) {
        guard let clean = BirdieRoute.sanitizedDraft(thought) else { return }
        var values = defaults.stringArray(forKey: key) ?? []
        values.insert(clean, at: 0)
        defaults.set(Array(values.prefix(50)), forKey: key)
    }

    public func recent(limit: Int = 3) -> [String] {
        let stored = defaults.stringArray(forKey: key) ?? []
        let sanitized = stored.compactMap(BirdieRoute.sanitizedDraft)
        if sanitized != stored {
            defaults.set(Array(sanitized.prefix(50)), forKey: key)
        }
        return Array(sanitized.prefix(max(0, limit)))
    }
}
