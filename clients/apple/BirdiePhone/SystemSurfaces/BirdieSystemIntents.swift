import AppIntents

private enum BirdieIntentLauncher {
    static func stage(_ action: BirdieActionKind, draft: String? = nil) throws {
        try BirdieIntentCoordinator.shared.stagePreview(
            action: action,
            source: .appIntent,
            draft: draft
        )
    }
}

struct AskBirdieIntent: AppIntent {
    static let title: LocalizedStringResource = "Birdie fragen"
    static let description = IntentDescription(
        "Öffnet eine sichere Vorschau in Birdie. Die Frage wird erst nach Bestätigung in der App gesendet."
    )
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Frage", description: "Optionaler Fragenentwurf")
    var question: String?

    init() { question = nil }
    init(question: String?) { self.question = question }

    static var parameterSummary: some ParameterSummary {
        Summary("Birdie fragen: \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try BirdieIntentLauncher.stage(.ask, draft: question)
        return .result(dialog: "Ich öffne die Vorschau. Es wurde noch nichts an Birdie gesendet.")
    }
}

struct CaptureThoughtIntent: AppIntent {
    static let title: LocalizedStringResource = "Gedanke merken"
    static let description = IntentDescription(
        "Öffnet einen Entwurf. Birdie speichert den Gedanken erst nach Bestätigung in der App."
    )
    static let openAppWhenRun = true
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Gedanke", description: "Optionaler Gedankenentwurf")
    var thought: String?

    init() { thought = nil }
    init(thought: String?) { self.thought = thought }

    static var parameterSummary: some ParameterSummary {
        Summary("Gedanke merken: \(\.$thought)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try BirdieIntentLauncher.stage(.captureThought, draft: thought)
        return .result(dialog: "Der Gedanke ist nur als Vorschau geöffnet und noch nicht gespeichert.")
    }
}

struct BirdieBriefingIntent: AppIntent {
    static let title: LocalizedStringResource = "Birdie Briefing"
    static let description = IntentDescription("Öffnet das schreibgeschützte Day-Pilot-Briefing.")
    static let openAppWhenRun = true

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try BirdieIntentLauncher.stage(.briefing)
        return .result(dialog: "Ich öffne dein Day-Pilot-Briefing.")
    }
}

struct BirdieNextStepIntent: AppIntent {
    static let title: LocalizedStringResource = "Birdie nächster Schritt"
    static let description = IntentDescription("Öffnet den nächsten Schritt im Day Pilot.")
    static let openAppWhenRun = true

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try BirdieIntentLauncher.stage(.nextStep)
        return .result(dialog: "Ich öffne deinen nächsten Schritt.")
    }
}
