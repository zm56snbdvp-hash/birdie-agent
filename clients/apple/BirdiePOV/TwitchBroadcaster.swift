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
    private let hudCompositor = BirdieHUDCompositor()
    private var hudDescriptor = BirdieHUDDescriptor(
        isEnabled: true,
        title: "BIRDIE & BREAKFAST",
        game: "WORLD OF WARCRAFT",
        mission: "TEE BUILDER // LIVE BUILD",
        handle: "@BIRDIEANDBREAKFAST"
    )
    private var hasAcceptedVideoFrame = false
    private var isProcessingVideoFrame = false
    private var liveStartedAt: Date?
    private var didReportCompositorFallback = false

    func updateHUD(_ descriptor: BirdieHUDDescriptor) {
        hudDescriptor = descriptor
    }

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
        isProcessingVideoFrame = false
        liveStartedAt = nil
        didReportCompositorFallback = false
        do {
            let settings = VideoCodecSettings(
                videoSize: .init(width: 1080, height: 1920),
                bitRate: 6_000_000,
                profileLevel: kVTProfileLevel_H264_High_4_1 as String,
                scalingMode: .trim,
                maxKeyFrameIntervalDuration: 2,
                expectedFrameRate: 24
            )
            try await stream.setVideoSettings(settings)
            try await connection.connect("rtmp://live.twitch.tv/app")
            try await stream.publish(key)
            isLive = true
            liveStartedAt = Date()
            status = "Publishing 1080 × 1920 at 6,000 kbit/s — verify Twitch reception"
        } catch {
            let publishError = error.localizedDescription
            isLive = false
            hasAcceptedVideoFrame = false
            isProcessingVideoFrame = false
            liveStartedAt = nil
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
        isProcessingVideoFrame = false
        liveStartedAt = nil
        do {
            try await connection.close()
            status = "Twitch disconnected"
        } catch {
            status = "Twitch stop error: \(error.localizedDescription)"
        }
    }

    nonisolated func appendVideo(_ sampleBuffer: CMSampleBuffer) {
        Task { @MainActor [weak self] in
            guard let self, self.isLive, !self.isProcessingVideoFrame else { return }
            self.isProcessingVideoFrame = true
            defer { self.isProcessingVideoFrame = false }

            let descriptor = self.hudDescriptor
            let elapsed = self.liveStartedAt.map { Date().timeIntervalSince($0) } ?? 0
            let outgoingBuffer: CMSampleBuffer
            let hasBurnedInHUD: Bool

            if let composited = await self.hudCompositor.composite(
                   sampleBuffer,
                   descriptor: descriptor,
                   elapsed: elapsed
               ) {
                outgoingBuffer = composited
                hasBurnedInHUD = descriptor.isEnabled
            } else {
                // Never sacrifice the camera feed because of a compositor failure.
                // The broadcaster falls back to the original sample and makes the
                // degraded state visible in-app on the first accepted frame.
                outgoingBuffer = sampleBuffer
                hasBurnedInHUD = false
                self.didReportCompositorFallback = true
            }

            do {
                try await self.stream.append(outgoingBuffer)
                if !self.hasAcceptedVideoFrame {
                    self.hasAcceptedVideoFrame = true
                    if descriptor.isEnabled, hasBurnedInHUD {
                        self.status = "Video + Birdie HUD publishing — verify Twitch reception"
                    } else if self.didReportCompositorFallback {
                        self.status = "Video publishing without native HUD — compositor fallback"
                    } else {
                        self.status = "Video publishing — Birdie HUD is off"
                    }
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
        isProcessingVideoFrame = false
        liveStartedAt = nil

        do {
            try await connection.close()
            status = "Twitch video error: \(message)"
        } catch {
            status = "Twitch video error: \(message) · cleanup error: \(error.localizedDescription)"
        }
    }
}
