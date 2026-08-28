import SwiftUI

struct BirdieButtonView: View {
    @ObservedObject var router: BirdieAppRouter

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(BirdieActionCatalog.contracts, id: \.kind) { contract in
                Button {
                    router.open(contract.kind)
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: contract.systemImageName)
                            .font(.title3.weight(.semibold))
                        Text(contract.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        Text(contract.requiresInAppConfirmation ? "Vorschau zuerst" : "Nur anzeigen")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
                    .padding(12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .accessibilityHint(contract.subtitle)
            }
        }
    }
}
