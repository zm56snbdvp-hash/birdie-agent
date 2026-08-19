import AVFoundation
import Foundation
import HaishinKit
import RTMPHaishinKit
import VideoToolbox

@MainActor
final class TwitchBroadcaster: ObservableObject {
    @Published private(set) var isLive = false
    @Published private(set) var status = "Twitch disconnected"
    @Published private(set) var audioRouteStatus = "Audio not configured"

    private let connection = RTMPConnection()
    private lazy var stream = RTMPStream(connection: connection)

    /// Birdie POV audio policy:
    /// - Prefer the Ray-Ban Meta HFP microphone as input.
    /// - Never intentionally use the glasses as playback output.
    /// - Default playback to the phone speaker; the user can select external speakers
    ///   through the normal iOS route picker when available.
    func configureAudioSession() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.allowBluetoothHFP, .allowAirPlay, .defaultToSpeaker]
            )
            try audioSession.setActive(true)

            preferRayBanMicrophone(on: audioSession)
            keepPlaybackOffGlasses(on: audioSession)
            updateAudioRouteStatus(audioSession)
        } catch {
            status = "Audio setup failed: \(error.localizedDescription)"
            audioRouteStatus = "Audio route failed"
        }
    }

    private func preferRayBanMicrophone(on audioSession: AVAudioSession) {
        guard let inputs = audioSession.availableInputs else { return }

        let preferred = inputs.first { input in
            guard input.portType == .bluetoothHFP else { return false }
            let name = input.portName.lowercased()
            return name.contains("ray-ban") || name.contains("rayban") || name.contains("meta")
        } ?? inputs.first(where: { $0.portType == .bluetoothHFP })

        guard let preferred else { return }
        try? audioSession.setPreferredInput(preferred)
    }

    private func keepPlaybackOffGlasses(on audioSession: AVAudioSession) {
        let outputs = audioSession.currentRoute.outputs
        let glassesAreOutput = outputs.contains { output in
            let name = output.portName.lowercased()
            let looksLikeGlasses = name.contains("ray-ban") || name.contains("rayban") || name.contains("meta")
            return looksLikeGlasses && (output.portType == .bluetoothHFP || output.portType == .bluetoothA2DP)
        }

        if glassesAreOutput {
            // Keep the glasses as microphone input while moving playback away from them.
            // iOS may re-negotiate the route depending on connected hardware, so the
            // route is re-checked whenever configureAudioSession() is called.
            try? audioSession.overrideOutputAudioPort(.speaker)
        }
    }

    private func updateAudioRouteStatus(_ audioSession: AVAudioSession) {
        let input = audioSession.currentRoute.inputs.first?.portName ?? "no mic"
        let output = audioSession.currentRoute.outputs.first?.portName ?? "no output"
        audioRouteStatus = "Mic: \(input) · Playback: \(output)"
    }

    func start(streamKey: String) async {
        let key = streamKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            status = "Enter Twitch stream key"
            return
        }

        // Re-assert the preferred microphone/output route immediately before going live.
        configureAudioSession()

        status = "Connecting to Twitch…"
        do {
            let settings = VideoCodecSettings(
                videoSize: .init(width: 720, height: 1280),
                bitRate: 2_500_000,
                profileLevel: kVTProfileLevel_H264_High_3_1 as String,
                scalingMode: .trim,
                maxKeyFrameIntervalDuration: 2,
                expectedFrameRate: 24
            )
            try await stream.setVideoSettings(settings)
            try await connection.connect("rtmp://live.twitch.tv/app")
            try await stream.publish(key)
            isLive = true
            status = "LIVE on Twitch"
        } catch {
            isLive = false
            status = "Twitch error: \(error.localizedDescription)"
        }
    }

    func stop() async {
        do {
            try await connection.close()
        } catch {
            // Connection may already be closed; converge local state either way.
        }
        isLive = false
        status = "Twitch disconnected"
    }

    nonisolated func appendVideo(_ sampleBuffer: CMSampleBuffer) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await self.stream.append(sampleBuffer)
        }
    }
}
