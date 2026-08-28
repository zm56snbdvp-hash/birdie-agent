import ActivityKit
import Foundation

/// The deliberately small, token-free projection shared by the phone app and
/// the Live Activity extension. Detailed blocker messages and credentials never
/// cross the extension boundary.
public struct BirdieLiveMissionAttributes: ActivityAttributes, Hashable, Sendable {
    public static let maximumDuration: TimeInterval = 8 * 60 * 60

    public struct ContentState: Codable, Hashable, Sendable {
        public let recordVersion: Int
        public let status: Status
        public let progress: Double
        public let currentStepIndex: Int
        public let currentStepTotal: Int
        public let currentStepTitle: StepTitle
        public let blockerCategory: BlockerCategory?
        public let allowsPause: Bool
        public let allowsCancel: Bool
        public let containsSensitiveDetails: Bool

        public init(
            recordVersion: Int,
            status: Status,
            progress: Double,
            currentStepIndex: Int,
            currentStepTotal: Int,
            currentStepTitle: StepTitle,
            blockerCategory: BlockerCategory?,
            allowsPause: Bool,
            allowsCancel: Bool
        ) throws {
            guard recordVersion >= 1 else {
                throw ValidationError.invalidRecordVersion
            }
            guard progress.isFinite, (0 ... 1).contains(progress) else {
                throw ValidationError.invalidProgress
            }
            guard currentStepTotal > 0,
                  currentStepIndex > 0,
                  currentStepIndex <= currentStepTotal else {
                throw ValidationError.invalidStep
            }
            self.recordVersion = recordVersion
            self.status = status
            self.progress = progress
            self.currentStepIndex = currentStepIndex
            self.currentStepTotal = currentStepTotal
            self.currentStepTitle = currentStepTitle
            self.blockerCategory = blockerCategory
            self.allowsPause = allowsPause && !status.isTerminal
            self.allowsCancel = allowsCancel && !status.isTerminal
            self.containsSensitiveDetails = true
        }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            try self.init(
                recordVersion: values.decode(Int.self, forKey: .recordVersion),
                status: values.decode(Status.self, forKey: .status),
                progress: values.decode(Double.self, forKey: .progress),
                currentStepIndex: values.decode(Int.self, forKey: .currentStepIndex),
                currentStepTotal: values.decode(Int.self, forKey: .currentStepTotal),
                currentStepTitle: values.decode(StepTitle.self, forKey: .currentStepTitle),
                blockerCategory: values.decodeIfPresent(BlockerCategory.self, forKey: .blockerCategory),
                allowsPause: values.decode(Bool.self, forKey: .allowsPause),
                allowsCancel: values.decode(Bool.self, forKey: .allowsCancel)
            )
            let containsSensitiveDetails = try values.decode(Bool.self, forKey: .containsSensitiveDetails)
            guard containsSensitiveDetails else {
                throw ValidationError.privacyRedactionRequired
            }
        }

        private enum CodingKeys: String, CodingKey {
            case recordVersion
            case status
            case progress
            case currentStepIndex
            case currentStepTotal
            case currentStepTitle
            case blockerCategory
            case allowsPause
            case allowsCancel
            case containsSensitiveDetails
        }
    }

    public enum Status: String, Codable, CaseIterable, Hashable, Sendable {
        case queued
        case running
        case paused
        case blocked
        case succeeded
        case failed
        case cancelled
        case expired

        public var isTerminal: Bool {
            switch self {
            case .succeeded, .failed, .cancelled, .expired:
                true
            case .queued, .running, .paused, .blocked:
                false
            }
        }
    }

    public enum StepTitle: String, Codable, CaseIterable, Hashable, Sendable {
        case preparation = "Vorbereitung"
        case review = "Pruefung"
        case execution = "Ausfuehrung"
        case completion = "Abschluss"
        case waitingForApproval = "Wartet auf Freigabe"
    }

    /// A safe category for public surfaces. Raw backend codes and messages stay
    /// in the containing app and are never included in ActivityKit content.
    public enum BlockerCategory: String, Codable, CaseIterable, Hashable, Sendable {
        case approvalRequired = "approval_required"
        case connectivity
        case dependency
        case policy
        case unknown
    }

    public enum ValidationError: LocalizedError, Equatable, Sendable {
        case missingMissionID
        case missingTitle
        case invalidDuration
        case invalidRecordVersion
        case invalidProgress
        case invalidStep
        case privacyRedactionRequired

        public var errorDescription: String? {
            switch self {
            case .missingMissionID:
                "Die Mission-ID fehlt."
            case .missingTitle:
                "Der Missionstitel fehlt."
            case .invalidDuration:
                "Eine Live Mission muss positiv und auf höchstens acht Stunden begrenzt sein."
            case .invalidRecordVersion:
                "Die Versionsnummer der Mission ist ungültig."
            case .invalidProgress:
                "Der Missionsfortschritt muss zwischen 0 und 1 liegen."
            case .invalidStep:
                "Der aktuelle Missionsschritt ist ungültig."
            case .privacyRedactionRequired:
                "Sensible Live-Mission-Inhalte müssen als solche markiert bleiben."
            }
        }
    }

    public let missionID: String
    public let title: String
    public let startedAt: Date
    public let hardEndAt: Date

    public init(
        missionID: String,
        title: String,
        startedAt: Date,
        hardEndAt: Date
    ) throws {
        guard isValidBirdieMissionID(missionID) else {
            throw ValidationError.missingMissionID
        }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.count <= 80 else {
            throw ValidationError.missingTitle
        }
        let duration = hardEndAt.timeIntervalSince(startedAt)
        guard duration > 0, duration <= Self.maximumDuration else {
            throw ValidationError.invalidDuration
        }

        self.missionID = missionID
        self.title = title
        self.startedAt = startedAt
        self.hardEndAt = hardEndAt
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            missionID: values.decode(String.self, forKey: .missionID),
            title: values.decode(String.self, forKey: .title),
            startedAt: values.decode(Date.self, forKey: .startedAt),
            hardEndAt: values.decode(Date.self, forKey: .hardEndAt)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case missionID = "missionId"
        case title
        case startedAt
        case hardEndAt
    }
}

public enum BirdieLiveMissionDeepLinkIntent: String, Codable, Hashable, Sendable {
    case open
    case pause
    case cancel
}

public struct BirdieLiveMissionDeepLink: Equatable, Hashable, Sendable {
    public static let scheme = "birdie"
    public static let host = "missions"

    public let missionID: String
    public let intent: BirdieLiveMissionDeepLinkIntent

    public init(missionID: String, intent: BirdieLiveMissionDeepLinkIntent) {
        self.missionID = missionID
        self.intent = intent
    }

    public var url: URL? {
        guard isValidBirdieMissionID(missionID) else { return nil }
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = Self.host
        components.path = "/\(missionID)"
        components.queryItems = [URLQueryItem(name: "intent", value: intent.rawValue)]
        return components.url
    }

    public init?(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == Self.scheme,
              components.host?.lowercased() == Self.host,
              components.user == nil,
              components.password == nil,
              components.port == nil else {
            return nil
        }

        let pathComponents = components.path.split(separator: "/", omittingEmptySubsequences: true)
        guard pathComponents.count == 1 else { return nil }
        let identifier = String(pathComponents[0])
        guard components.fragment == nil,
              components.percentEncodedPath == "/\(identifier)",
              isValidBirdieMissionID(identifier) else {
            return nil
        }

        let intent: BirdieLiveMissionDeepLinkIntent
        if components.query == nil {
            intent = .open
        } else {
            guard let queryItems = components.queryItems,
                  queryItems.count == 1,
                  queryItems[0].name == "intent",
                  let intentValue = queryItems[0].value,
                  let parsedIntent = BirdieLiveMissionDeepLinkIntent(rawValue: intentValue) else {
                return nil
            }
            intent = parsedIntent
        }

        self.missionID = identifier
        self.intent = intent
    }
}

private func isValidBirdieMissionID(_ value: String) -> Bool {
    let allowedCharacters = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    )
    return (16 ... 128).contains(value.count)
        && value.unicodeScalars.allSatisfy { allowedCharacters.contains($0) }
}
