import AppIntents

struct BirdieAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskBirdieIntent(),
            phrases: [
                "\(.applicationName) fragen",
                "Frag \(.applicationName)"
            ],
            shortTitle: "Birdie fragen",
            systemImageName: "bubble.left.and.text.bubble.right"
        )
        AppShortcut(
            intent: CaptureThoughtIntent(),
            phrases: [
                "Gedanke mit \(.applicationName) merken",
                "Mit \(.applicationName) einen Gedanken merken"
            ],
            shortTitle: "Gedanke merken",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: BirdieBriefingIntent(),
            phrases: [
                "\(.applicationName) Briefing",
                "Briefing mit \(.applicationName)"
            ],
            shortTitle: "Briefing",
            systemImageName: "sun.horizon"
        )
        AppShortcut(
            intent: BirdieNextStepIntent(),
            phrases: [
                "Nächster Schritt mit \(.applicationName)",
                "Zeig mit \(.applicationName) den nächsten Schritt"
            ],
            shortTitle: "Nächster Schritt",
            systemImageName: "arrow.forward.circle"
        )
    }

    static var shortcutTileColor: ShortcutTileColor = .teal
}
