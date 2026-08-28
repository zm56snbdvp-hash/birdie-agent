import SwiftUI

struct BirdiePhoneRootView: View {
    @StateObject private var pocketRelayModel = PocketRelayViewModel()

    var body: some View {
        TabView {
            PocketRelayView(model: pocketRelayModel)
                .tabItem {
                    Label("Pocket Relay", systemImage: "iphone.and.arrow.forward")
                }

            BirdiePhoneSetupView()
                .tabItem {
                    Label("Watch", systemImage: "applewatch")
                }
        }
    }
}
