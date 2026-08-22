import SwiftUI

enum BirdiePalette {
    static let green = Color(red: 0.035, green: 0.245, blue: 0.155)
    static let gold = Color(red: 0.84, green: 0.69, blue: 0.31)
}

struct BirdieBrandMark: View {
    var size: CGFloat = 48

    var body: some View {
        ZStack {
            Circle()
                .fill(BirdiePalette.green)
            Circle()
                .stroke(BirdiePalette.gold.opacity(0.9), lineWidth: max(1.5, size * 0.045))
                .padding(size * 0.08)
            Text("B")
                .font(.system(size: size * 0.48, weight: .semibold, design: .serif))
                .foregroundStyle(BirdiePalette.gold)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
