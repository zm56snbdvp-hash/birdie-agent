import Foundation

/// Optional ranking extension point. V1 deliberately ships with the no-op adapter below:
/// no backend, embedding service, Apple Intelligence hardware, or network is required.
protocol RecallSemanticRanking: Sendable {
    func rerank(
        query: RecallSearchQueryV1,
        deterministicResults: [RecallSearchResultV1]
    ) async throws -> [RecallSearchResultV1]
}

struct NoopRecallSemanticRanker: RecallSemanticRanking {
    func rerank(
        query: RecallSearchQueryV1,
        deterministicResults: [RecallSearchResultV1]
    ) async throws -> [RecallSearchResultV1] {
        deterministicResults
    }
}
