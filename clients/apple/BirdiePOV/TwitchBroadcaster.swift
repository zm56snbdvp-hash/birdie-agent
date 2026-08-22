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
    private var hasAcceptedVideoFrame = false

    /// Birdie POV audio policy:
    /// - Prefer the Ray-Ban Meta HFP microphone as input.
    /// - Never intentionally use the glasses as playback output.
    /// - Default playback to the phone speaker; the user can select external speakers
    ///   through the normal iOS route picker when available.
    private func configureAudioSession() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .videoChat,
                options: [.allowBluetoothHFP, .allowAirPlay, .defaultToSpeaker]
            )
            try audioSession.setActive(true)

            try preferRayBanMicrophone(on: audioSession)
            try keepPlaybackOffGlasses(on: audioSession)
            updateAudioRouteStatus(audioSession)
        } catch {
            status = "Audio setup failed: \(error.localizedDescription)"
            audioRouteStatus = "Audio route failed"
        }
    }

    private func preferRayBanMicrophone(on audioSession: AVAudioSession) throws {
        guard let inputs = audioSession.availableInputs else { return }

        let preferred = inputs.first { input in
            guard input.portType == .bluetoothHFP else { return false }
            let name = input.portName.lowercased()
            return name.contains("ray-ban") || name.contains("rayban") || name.contains("meta")
        } ?? inputs.first(where: { $0.portType == .bluetoothHFP })

        guard let preferred else { return }
        try audioSession.setPreferredInput(preferred)
    }

    private func keepPlaybackOffGlasses(on audioSession: AVAudioSession) throws {
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
            try audioSession.overrideOutputAudioPort(.speaker)
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

        // The controller only enters this method after the glasses video gate passed.
        // Audio samples are not published yet; this only prepares the future route.
        configureAudioSession()

        status = "Connecting to Twitch…"
        hasAcceptedVideoFrame = false
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
            status = "Publishing to Twitch — verify channel reception"
        } catch {
            let publishError = error.localizedDescription
            isLive = false
            hasAcceptedVideoFrame = false
            do {
                try await connection.close()
                status = "Twitch publish error: \(publishError)"
            } catch {
                status = "Twitch publish error: \(publishError) · cleanup error: \(error.localizedDescription)"
            }
        }
    }

    func stop() async {
        isLive = false
        hasAcceptedVideoFrame = false
        do {
            try await connection.close()
            status = "Twitch disconnected"
        } catch {
            status = "Twitch stop error: \(error.localizedDescription)"
        }
    }

    nonisolated func appendVideo(_ sampleBuffer: CMSampleBuffer) {
        Task { @MainActor [weak self] in
            guard let self, self.isLive else { return }
            do {
                try await self.stream.append(sampleBuffer)
                if !self.hasAcceptedVideoFrame {
                    self.hasAcceptedVideoFrame = true
                    self.status = "Video publishing — verify Twitch channel reception"
                }
            } catch {
                await self.handleVideoAppendFailure(error)
            }
        }
    }

    private func handleVideoAppendFailure(_ appendError: Error) async {
        let message = appendError.localizedDescription
        isLive = false
        hasAcceptedVideoFrame = false

        do {
            try await connection.close()
            status = "Twitch video error: \(message)"
        } catch {
            status = "Twitch video error: \(message) · cleanup error: \(error.localizedDescription)"
        }
    }
}
