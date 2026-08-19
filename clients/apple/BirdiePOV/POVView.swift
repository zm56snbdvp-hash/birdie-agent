import SwiftUI

struct POVView: View {
    @ObservedObject var controller: POVController
    @State private var streamKey = ""
    @State private var showStreamKey = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    preview
                    statusCard
                    metaControls
                    twitchControls
                }
                .padding()
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Birdie POV")
            .navigationBarTitleDisplayMode(.inline)
            .preferredColorScheme(.dark)
            .alert(
                "Birdie POV",
                isPresented: Binding(
                    get: { controller.errorMessage != nil },
                    set: { if !$0 { controller.errorMessage = nil } }
                )
            ) {
                Button("OK") { controller.errorMessage = nil }
            } message: {
                Text(controller.errorMessage ?? "Unknown error")
            }
        }
    }

    private var preview: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(Color.white.opacity(0.06))

            if let image = controller.currentFrame {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .clipShape(RoundedRectangle(cornerRadius: 24))
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "eyeglasses")
                        .font(.system(size: 40, weight: .light))
                    Text("Meta POV Preview")
                        .font(.headline)
                    Text("Start the glasses camera to see exactly what the stream receives.")
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 24)
                }
            }

            VStack {
                HStack {
                    if controller.twitch.isLive {
                        Label("LIVE", systemImage: "circle.fill")
                            .font(.caption.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    Spacer()
                }
                Spacer()
            }
            .padding(14)
        }
        .aspectRatio(9.0 / 16.0, contentMode: .fit)
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            statusRow("Meta", controller.registrationText)
            statusRow("Camera", controller.cameraStatus)
            statusRow("Twitch", controller.twitch.status)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private var metaControls: some View {
        VStack(spacing: 12) {
            HStack {
                Button("Connect Meta") {
                    controller.connectGlasses()
                }
                .buttonStyle(.borderedProminent)

                Button("Disconnect") {
                    controller.disconnectGlasses()
                }
                .buttonStyle(.bordered)
            }

            Button(controller.isGlassesStreaming ? "POV Camera Running" : "Start POV Camera") {
                controller.startGlassesPreview()
            }
            .buttonStyle(.borderedProminent)
            .disabled(controller.isGlassesStreaming)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
    }

    private var twitchControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Twitch")
                .font(.headline)

            HStack {
                Group {
                    if showStreamKey {
                        TextField("Stream key", text: $streamKey)
                    } else {
                        SecureField("Stream key", text: $streamKey)
                    }
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

                Button {
                    showStreamKey.toggle()
                } label: {
                    Image(systemName: showStreamKey ? "eye.slash" : "eye")
                }
                .buttonStyle(.bordered)
            }

            if controller.twitch.isLive {
                Button("Stop Twitch") {
                    Task { await controller.stopEverything() }
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
            } else {
                Button("Go Live on Twitch") {
                    controller.startTwitch(streamKey: streamKey)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!controller.isGlassesStreaming || streamKey.isEmpty)
                .frame(maxWidth: .infinity)
            }

            Text("The stream key stays in app memory only in this prototype and is not committed to GitHub.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private func statusRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
                .frame(width: 62, alignment: .leading)
            Text(value)
                .fontWeight(.medium)
            Spacer()
        }
        .font(.subheadline)
    }
}
