import XCTest
@testable import BirdiePhone

final class BirdieIntentContractTests: XCTestCase {
    func testSiriIntentsOnlyStageForegroundPreviews() {
        XCTAssertTrue(AskBirdieIntent.openAppWhenRun)
        XCTAssertTrue(CaptureThoughtIntent.openAppWhenRun)
        XCTAssertTrue(BirdieBriefingIntent.openAppWhenRun)
        XCTAssertTrue(BirdieNextStepIntent.openAppWhenRun)

        XCTAssertEqual(AskBirdieIntent(question: "Hallo").question, "Hallo")
        XCTAssertEqual(CaptureThoughtIntent(thought: "Idee").thought, "Idee")
        XCTAssertEqual(AskBirdieIntent.authenticationPolicy, .requiresLocalDeviceAuthentication)
        XCTAssertEqual(CaptureThoughtIntent.authenticationPolicy, .requiresLocalDeviceAuthentication)
    }

    func testControlOpenIntentCarriesStableEntity() {
        XCTAssertEqual(OpenBirdieActionIntent(.ask).target.id, "ask")
        XCTAssertEqual(OpenBirdieActionIntent(.captureThought).target.kind, .captureThought)
        XCTAssertEqual(OpenBirdieActionIntent(.briefing).target.kind, .briefing)
        XCTAssertEqual(OpenBirdieActionIntent(.nextStep).target.kind, .nextStep)
        XCTAssertEqual(OpenBirdieActionIntent.authenticationPolicy, .requiresLocalDeviceAuthentication)
    }

    func testIntentCoordinatorCanOnlyStageSystemPreviewRoutes() throws {
        let stager = RouteStagerSpy()
        let coordinator = BirdieIntentCoordinator(stager: stager)

        try coordinator.stagePreview(
            action: .captureThought,
            source: .appIntent,
            draft: "Noch nicht gespeichert"
        )

        XCTAssertEqual(stager.routes.count, 1)
        XCTAssertEqual(stager.routes.first?.action, .captureThought)
        XCTAssertFalse(BirdieActionCatalog.contract(for: .captureThought).allowsDirectIntentExecution)
        XCTAssertThrowsError(
            try coordinator.stagePreview(action: .ask, source: .externalDeepLink)
        )
    }
}

private final class RouteStagerSpy: BirdieRouteStaging, @unchecked Sendable {
    private(set) var routes = [BirdieRoute]()

    func stage(_ route: BirdieRoute) {
        routes.append(route)
    }
}
