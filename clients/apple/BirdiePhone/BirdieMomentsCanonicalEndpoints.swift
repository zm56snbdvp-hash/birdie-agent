import Foundation

extension BirdieMomentsAPIEndpoints {
    static func birdieMoments(baseURL: URL) -> BirdieMomentsAPIEndpoints {
        BirdieMomentsAPIEndpoints(
            startAppStorePurchase: { momentId in
                try makeURL(
                    baseURL: baseURL,
                    segments: ["api", "moments", momentId, "app-store", "start"]
                )
            },
            confirmAppStorePurchase: { purchaseId in
                try makeURL(
                    baseURL: baseURL,
                    segments: ["api", "moment-purchases", purchaseId, "app-store", "confirm"]
                )
            },
            recoverAppStorePurchase: {
                try makeURL(
                    baseURL: baseURL,
                    segments: ["api", "moment-purchases", "app-store", "recover"]
                )
            }
        )
    }

    private static func makeURL(baseURL: URL, segments: [String]) throws -> URL {
        guard let expectedScheme = baseURL.scheme, !expectedScheme.isEmpty,
              let expectedHost = baseURL.host, !expectedHost.isEmpty else {
            throw BirdieMomentsAPIError.invalidResponse
        }

        var url = baseURL
        for segment in segments {
            let value = segment.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty,
                  !value.contains("/"),
                  value != ".",
                  value != ".." else {
                throw BirdieMomentsAPIError.invalidPayload
            }
            url.appendPathComponent(value)
        }

        guard url.scheme == expectedScheme, url.host == expectedHost else {
            throw BirdieMomentsAPIError.invalidResponse
        }
        return url
    }
}
