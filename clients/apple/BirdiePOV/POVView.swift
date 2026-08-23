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
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color(red: 0.01, green: 0.10, blue: 0.07))

                if let image = controller.currentFrame {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .blur(radius: 18)
                        .saturation(0.72)
                        .brightness(-0.19)
                        .overlay(Color(red: 0.01, green: 0.12, blue: 0.08).opacity(0.42))

                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(width: proxy.size.height * 9.0 / 16.0)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "eyeglasses")
                            .font(.system(size: 40, weight: .light))
                        Text("Meta POV Preview")
                            .font(.headline)
                        Text("Start the glasses camera to see the 16:9 Twitch composition.")
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 24)
                    }
                }

                if controller.isHUDEnabled {
                    BirdieHUDPreview(
                        game: controller.hudGame,
                        mission: controller.hudMission,
                        isLive: controller.twitch.isLive
                    )
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            statusRow("Meta", controller.registrationText)
            statusRow("Camera", controller.cameraStatus)
            statusRow("Twitch", controller.twitch.status)
            statusRow("HUD", controller.isHUDEnabled ? "Burned into stream" : "Off")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private var metaControls: some View {
        VStack(spacing: 12) {
            HStack {
                Button("Connect Meta") { controller.connectGlasses() }
                    .buttonStyle(.borderedProminent)
                Button("Disconnect") { controller.disconnectGlasses() }
                    .buttonStyle(.bordered)
            }

            Button(controller.previewButtonTitle) {
                controller.startGlassesPreview()
            }
            .buttonStyle(.borderedProminent)
            .disabled(controller.isGlassesStreaming || controller.isPreviewTransitioning)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
    }

    private var twitchControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Twitch")
                .font(.headline)

            Toggle("Burn Birdie HUD into stream", isOn: $controller.isHUDEnabled)
                .tint(Color(red: 0.20, green: 0.78, blue: 0.48))

            if controller.isHUDEnabled {
                VStack(spacing: 10) {
                    TextField("Game", text: $controller.hudGame)
                    TextField("Mission / format", text: $controller.hudMission)
                }
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(12)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

                HStack {
                    Label("1920 × 1080", systemImage: "rectangle")
                    Spacer()
                    Label("6,000 kbit/s", systemImage: "waveform.path.ecg")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(red: 0.86, green: 0.72, blue: 0.31))

                Text("The preview mirrors the layout. The native compositor burns it into every outgoing RTMP video frame.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

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

private struct BirdieHUDPreview: View {
    let game: String
    let mission: String
    let isLive: Bool

    private let green = Color(red: 0.16, green: 0.75, blue: 0.45)
    private let gold = Color(red: 0.87, green: 0.71, blue: 0.28)

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(
                        LinearGradient(
                            colors: [green.opacity(0.9), gold.opacity(0.8), green.opacity(0.55)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1.5
                    )

                HStack(spacing: 0) {
                    leftPanel
                        .frame(width: proxy.size.width * 0.29)
                    Spacer(minLength: proxy.size.width * 0.38)
                    rightPanel
                        .frame(width: proxy.size.width * 0.29)
                }
                .padding(proxy.size.width * 0.02)

                RoundedRectangle(cornerRadius: 12)
                    .stroke(gold.opacity(0.82), lineWidth: 1.5)
                    .frame(width: proxy.size.height * 9.0 / 16.0)
                    .padding(.vertical, 4)
            }
        }
        .allowsHitTesting(false)
    }

    private var leftPanel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("BIRDIE & BREAKFAST")
                .font(.system(size: 8, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(1)
            Text("FOUNDER POV")
                .font(.system(size: 6, weight: .bold, design: .monospaced))
                .tracking(0.8)
                .foregroundStyle(gold)
            Spacer()
            Text(game.isEmpty ? "LIVE POV" : game.uppercased())
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundStyle(gold)
                .lineLimit(1)
            Text(mission.isEmpty ? "BIRDIE & BREAKFAST" : mission.uppercased())
                .font(.system(size: 9, weight: .black))
                .foregroundStyle(.white)
                .lineLimit(2)
            Spacer()
            Text("@BIRDIEANDBREAKFAST")
                .font(.system(size: 5, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(1)
        }
        .padding(8)
        .background(Color(red: 0.01, green: 0.13, blue: 0.09).opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(gold.opacity(0.55), lineWidth: 1))
    }

    private var rightPanel: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Circle()
                    .fill(isLive ? Color.red : green)
                    .frame(width: 6, height: 6)
                Text(isLive ? "LIVE" : "PREVIEW")
                    .font(.system(size: 7, weight: .black, design: .monospaced))
            }
            .foregroundStyle(.white)
            Text("00:00:00")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(gold)
            Spacer()
            Text("META GLASSES")
                .font(.system(size: 6, weight: .bold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.68))
            Text("VERTICAL POV")
                .font(.system(size: 9, weight: .black))
                .foregroundStyle(.white)
            Text("1080P · 6 MBPS")
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundStyle(gold)
            Spacer()
            Text("UNCROPPED POV\nTWITCH 16:9 CANVAS")
                .font(.system(size: 5, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.72))
        }
        .padding(8)
        .background(Color(red: 0.01, green: 0.13, blue: 0.09).opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(gold.opacity(0.55), lineWidth: 1))
    }
}
