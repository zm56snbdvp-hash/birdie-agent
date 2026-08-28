import XCTest
@testable import BirdiePhone

final class BirdieActionContractTests: XCTestCase {
    func testPublicActionIdentifiersStayStable() {
        XCTAssertEqual(
            BirdieActionKind.allCases.map(\.rawValue),
            ["ask", "capture-thought", "briefing", "next-step"]
        )
        XCTAssertEqual(BirdieActionKind.contractVersion, 1)
        XCTAssertEqual(
            BirdieActionKind.allCases.map { BirdieActionEntity(kind: $0).id },
            BirdieActionKind.allCases.map(\.rawValue)
        )
    }

    func testIntentPolicyNeverAllowsDirectDomainExecution() {
        XCTAssertTrue(BirdieActionCatalog.contracts.allSatisfy { !$0.allowsDirectIntentExecution })
        XCTAssertEqual(
            BirdieActionCatalog.contract(for: .ask).risk,
            .stagedExternalAction
        )
        XCTAssertEqual(
            BirdieActionCatalog.contract(for: .captureThought).risk,
            .stagedWrite
        )
        XCTAssertTrue(BirdieActionCatalog.contract(for: .ask).requiresInAppConfirmation)
        XCTAssertTrue(BirdieActionCatalog.contract(for: .captureThought).requiresInAppConfirmation)
    }

    func testFocusNeverChangesExecutionPolicy() {
        let baseline = BirdieActionCatalog.contracts.map {
            "\($0.kind.rawValue)|\($0.risk.rawValue)|\($0.requiresInAppConfirmation)"
        }
        for _ in BirdieFocusContext.allCases {
            XCTAssertEqual(
                BirdieActionCatalog.contracts.map {
                    "\($0.kind.rawValue)|\($0.risk.rawValue)|\($0.requiresInAppConfirmation)"
                },
                baseline
            )
        }
    }
}
