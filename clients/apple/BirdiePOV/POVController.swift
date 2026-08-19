import AVFoundation
import Combine
import Foundation
import MWDATCamera
import MWDATCore
import UIKit

@MainActor
final class POVController: ObservableObject {
    @Published private(set) var registrationState: RegistrationState
    @Published private(set) var cameraStatus = "Glasses not streaming"
    @Published private(set) var currentFrame: UIImage?
    @Published private(set) var isGlassesStreaming = false
    @Published var errorMessage: String?

    let twitch = TwitchBroadcaster()

    private let wearables = Wearables.shared
    private let deviceSelector: AutoDeviceSelector
    private var deviceSession: DeviceSession?
    private var camera: MWDATCamera.Camera?

    private var registrationTask: Task<Void, Never>?
    private var sessionStateToken: AnyListenerToken?
    private var sessionErrorToken: AnyListenerToken?
    private var streamStateToken: AnyListenerToken?
    private var streamFrameToken: AnyListenerToken?
    private var streamErrorToken: AnyListenerToken?

    init() {
        registrationState = Wearables.shared.registrationState
        deviceSelector = AutoDeviceSelector(wearables: Wearables.shared)
        twitch.configureAudioSession()

        registrationTask = Task { [weak self] in
            guard let self else { return }
            for await state in wearables.registrationStateStream() {
                self.registrationState = state
            }
        }
    }

    deinit {
        registrationTask?.cancel()
        deviceSession?.stop()
    }

    var registrationText: String {
        String(describing: registrationState)
    }

    func connectGlasses() {
        Task {
            do {
                try await wearables.startRegistration()
            } catch {
                errorMessage = "Meta registration failed: \(error.localizedDescription)"
            }
        }
    }

    func disconnectGlasses() {
        Task {
            await stopEverything()
            do {
                try await wearables.startUnregistration()
            } catch {
                errorMessage = "Meta unregistration failed: \(error.localizedDescription)"
            }
        }
    }

    func startGlassesPreview() {
        guard deviceSession == nil else { return }
        cameraStatus = "Checking camera permission…"

        Task {
            do {
                let permission = try await wearables.checkPermissionStatus(.camera)
                if permission != .granted {
                    let requested = try await wearables.requestPermission(.camera)
                    guard requested == .granted else {
                        errorMessage = "Camera permission was not granted in Meta AI."
                        cameraStatus = "Camera permission required"
                        return
                    }
                }

                let session = try wearables.createSession(deviceSelector: deviceSelector)
                deviceSession = session
                observeSession(session)
                cameraStatus = "Connecting to glasses…"
                try session.start()
            } catch {
                errorMessage = "Could not start glasses session: \(error.localizedDescription)"
                cleanupSession()
            }
        }
    }

    func startTwitch(streamKey: String) {
        Task {
            await twitch.start(streamKey: streamKey)
        }
    }

    func stopEverything() async {
        cameraStatus = "Stopping…"
        camera?.stop()
        camera = nil
        deviceSession?.stop()
        await twitch.stop()
        isGlassesStreaming = false
        currentFrame = nil
        cameraStatus = "Glasses not streaming"
    }

    private func observeSession(_ session: DeviceSession) {
        sessionStateToken = session.statePublisher.listen { [weak self, weak session] state in
            Task { @MainActor in
                guard let self, let session else { return }
                switch state {
                case .started:
                    self.cameraStatus = "Glasses connected"
                    self.beginCamera(on: session)
                case .starting:
                    self.cameraStatus = "Connecting to glasses…"
                case .paused:
                    self.cameraStatus = "Glasses session paused"
                case .stopping:
                    self.cameraStatus = "Stopping glasses session…"
                case .stopped, .idle:
                    self.isGlassesStreaming = false
                    self.currentFrame = nil
                    self.cleanupCamera()
                    self.cleanupSession()
                }
            }
        }

        sessionErrorToken = session.errorPublisher.listen { [weak self] error in
            Task { @MainActor in
                self?.errorMessage = "Glasses session error: \(error.localizedDescription)"
            }
        }
    }

    private func beginCamera(on session: DeviceSession) {
        guard camera == nil else { return }

        let config = StreamConfiguration(
            videoCodec: .raw,
            resolution: .high,
            frameRate: 24
        )

        do {
            guard let camera = try session.addCamera(config: config) else {
                errorMessage = "Meta DAT could not create a camera stream."
                return
            }
            self.camera = camera
            observeStream(camera.stream)
            cameraStatus = "Starting POV camera…"
            camera.stream.start()
        } catch {
            errorMessage = "Could not start POV camera: \(error.localizedDescription)"
            cleanupCamera()
        }
    }

    private func observeStream(_ stream: MWDATCamera.Stream) {
        streamStateToken = stream.statePublisher.listen { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .streaming:
                    self.isGlassesStreaming = true
                    self.cameraStatus = "POV camera live"
                case .paused:
                    self.isGlassesStreaming = false
                    self.cameraStatus = "POV camera paused"
                case .waitingForDevice:
                    self.cameraStatus = "Waiting for glasses…"
                case .starting:
                    self.cameraStatus = "Starting POV camera…"
                case .stopping:
                    self.cameraStatus = "Stopping POV camera…"
                case .stopped:
                    self.isGlassesStreaming = false
                    self.currentFrame = nil
                    self.cleanupCamera()
                }
            }
        }

        streamFrameToken = stream.videoFramePublisher.listen { [weak self] frame in
            guard let self else { return }

            // Feed the raw glasses frame into HaishinKit. HaishinKit performs
            // the H.264 encoding required by Twitch RTMP.
            self.twitch.appendVideo(frame.sampleBuffer)

            if let image = frame.makeUIImage() {
                Task { @MainActor in
                    self.currentFrame = image
                }
            }
        }

        streamErrorToken = stream.errorPublisher.listen { [weak self] error in
            Task { @MainActor in
                self?.errorMessage = "POV stream error: \(error.localizedDescription)"
            }
        }
    }

    private func cleanupCamera() {
        streamStateToken = nil
        streamFrameToken = nil
        streamErrorToken = nil
        camera = nil
    }

    private func cleanupSession() {
        sessionStateToken = nil
        sessionErrorToken = nil
        deviceSession = nil
    }
}
