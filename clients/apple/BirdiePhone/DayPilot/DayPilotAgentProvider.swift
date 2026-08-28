import Foundation

struct DayPilotRemoteTask: Decodable, Equatable, Sendable {
    let id: String
    let title: String
    let dueAt: Date?

    init(id: String, title: String, dueAt: Date?) {
        self.id = id
        self.title = title
        self.dueAt = dueAt
    }
}

struct DayPilotRemoteSnapshot: Decodable, Equatable, Sendable {
    let contractVersion: Int
    let generatedAt: Date
    let nextTask: DayPilotRemoteTask?
    let briefing: String
    let openApprovals: [DayPilotApproval]

    init(
        contractVersion: Int = 1,
        generatedAt: Date,
        nextTask: DayPilotRemoteTask?,
        briefing: String,
        openApprovals: [DayPilotApproval]
    ) {
        self.contractVersion = contractVersion
        self.generatedAt = generatedAt
        self.nextTask = nextTask
        self.briefing = briefing
        self.openApprovals = openApprovals
    }
}

protocol DayPilotRemoteProviding: Sendable {
    func load() async throws -> DayPilotRemoteSnapshot
}

struct DayPilotAgentProvider: DayPilotRemoteProviding {
    private let loader: @Sendable () async throws -> DayPilotRemoteSnapshot

    init(loader: @escaping @Sendable () async throws -> DayPilotRemoteSnapshot) {
        self.loader = loader
    }

    init(client: BirdieAgentClient = BirdieAgentClient()) {
        self.loader = { try await client.fetchDayPilot() }
    }

    func load() async throws -> DayPilotRemoteSnapshot {
        try await loader()
    }
}
