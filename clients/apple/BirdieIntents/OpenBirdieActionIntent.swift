import AppIntents

/// iOS 18 control widgets use OpenIntent so the action executes in the app process.
/// Its perform method stages navigation only; it never executes the represented action.
struct OpenBirdieActionIntent: OpenIntent {
    static let title: LocalizedStringResource = "Birdie öffnen"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Aktion")
    var target: BirdieActionEntity

    init() {
        target = BirdieActionEntity(kind: .ask)
    }

    init(_ action: BirdieActionKind) {
        target = BirdieActionEntity(kind: action)
    }

    func perform() async throws -> some IntentResult {
        try BirdieIntentCoordinator.shared.stagePreview(
            action: target.kind,
            source: .control
        )
        return .result()
    }
}
