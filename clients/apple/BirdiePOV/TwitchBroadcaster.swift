import AVFoundation
import Foundation
import HaishinKit
import RTMPHaishinKit
import VideoToolbox

@MainActor
final class TwitchBroadcaster: ObservableObject {
    @Published private(set) var isLive = false
    @Published private(set) var status = "Twitch disconnected"

    private let connection = RTMPConnection()
    private lazy var stream = RTMPStream(connection: connection)

    func configureAudioSession() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try audioSession.setActive(true)
        } catch {
            status = "Audio setup failed: \(error.localizedDescription)"
        }
    }

    func start(streamKey: String) async {
        let key = streamKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            status = "Enter Twitch stream key"
            return
        }

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
