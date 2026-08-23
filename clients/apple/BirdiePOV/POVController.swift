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
    @Published private(set) var isPreviewTransitioning = false
    @Published var isHUDEnabled = true {
        didSet { syncHUDDescriptor() }
    }
    @Published var hudGame = "WORLD OF WARCRAFT" {
        didSet { syncHUDDescriptor() }
    }
    @Published var hudMission = "TEE BUILDER // LIVE BUILD" {
        didSet { syncHUDDescriptor() }
    }
    @Published var errorMessage: String?

    let twitch = TwitchBroadcaster()

    private let wearables = Wearables.shared
    private let deviceSelector: AutoDeviceSelector
    private var deviceSession: DeviceSession?
    private var camera: MWDATCamera.Camera?

    private var twitchStateToken: AnyCancellable?
    private var registrationTask: Task<Void, Never>?
    private var sessionStateToken: AnyListenerToken?
    private var sessionErrorToken: AnyListenerToken?
    private var streamStateToken: AnyListenerToken?
    private var streamFrameToken: AnyListenerToken?
    private var streamErrorToken: AnyListenerToken?
    private var restartPreviewAfterStop = false

    init() {
        registrationState = Wearables.shared.registrationState
        deviceSelector = AutoDeviceSelector(wearables: Wearables.shared)

        twitchStateToken = twitch.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        syncHUDDescriptor()

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

    var previewButtonTitle: String {
        if isGlassesStreaming {
            return "POV Camera Running"
        }
        if isPreviewTransitioning {
            return "POV Camera Starting…"
        }
        if deviceSession != nil {
            return "Retry POV Camera"
        }
        return "Start POV Camera"
    }

    private var hudDescriptor: BirdieHUDDescriptor {
        BirdieHUDDescriptor(
            isEnabled: isHUDEnabled,
            title: "BIRDIE & BREAKFAST",
            game: hudGame.trimmingCharacters(in: .whitespacesAndNewlines),
            mission: hudMission.trimmingCharacters(in: .whitespacesAndNewlines),
            handle: "@BIRDIEANDBREAKFAST"
        )
    }

    private func syncHUDDescriptor() {
        twitch.updateHUD(hudDescriptor)
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
        guard !isGlassesStreaming, !isPreviewTransitioning else { return }

        if let session = deviceSession {
            if session.state == .started, camera == nil {
                isPreviewTransitioning = true
                beginCamera(on: session)
            } else {
                restartPreviewSession(session)
            }
            return
        }

        beginPreviewSession()
    }

    private func beginPreviewSession() {
        isPreviewTransitioning = true
        cameraStatus = "Checking camera permission…"

        Task { [weak self] in
            guard let self else { return }
            do {
                let permission = try await wearables.checkPermissionStatus(.camera)
                if permission != .granted {
                    let requested = try await wearables.requestPermission(.camera)
                    guard requested == .granted else {
                        errorMessage = "Camera permission was not granted in Meta AI."
                        cameraStatus = "Camera permission required"
                        isPreviewTransitioning = false
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
                cameraStatus = "Session failed — tap to retry"
                isPreviewTransitioning = false
                cleanupSession()
            }
        }
    }

    private func restartPreviewSession(_ session: DeviceSession) {
        restartPreviewAfterStop = true
        isPreviewTransitioning = true
        cameraStatus = "Restarting glasses session…"
        camera?.stop()

        if session.state == .stopped {
            handleStoppedSession()
        } else {
            session.stop()
        }
    }

    func startTwitch(streamKey: String) {
        guard isGlassesStreaming else {
            errorMessage = "Start and verify the POV camera before connecting to Twitch."
            return
        }

        Task {
            await twitch.start(streamKey: streamKey)
        }
    }

    func stopEverything() async {
        restartPreviewAfterStop = false
        isPreviewTransitioning = deviceSession != nil
        cameraStatus = "Stopping…"
        camera?.stop()
        deviceSession?.stop()
        await twitch.stop()
        isGlassesStreaming = false
        currentFrame = nil

        if deviceSession == nil {
            cleanupCamera()
            isPreviewTransitioning = false
            cameraStatus = "Glasses not streaming"
        }
    }

    private func observeSession(_ session: DeviceSession) {
        sessionStateToken = session.statePublisher.listen { [weak self, weak session] state in
            Task { @MainActor in
                guard let self, let session else { return }
                switch state {
                case .started:
                    self.isPreviewTransitioning = true
                    self.cameraStatus = "Glasses connected"
                    self.beginCamera(on: session)
                case .starting:
                    self.isPreviewTransitioning = true
                    self.cameraStatus = "Connecting to glasses…"
                case .paused:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = false
                    self.cameraStatus = "Glasses session paused — tap to retry"
                    self.stopTwitchAfterVideoLoss()
                case .stopping:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = true
                    self.cameraStatus = "Stopping glasses session…"
                case .stopped:
                    self.handleStoppedSession()
                case .idle:
                    // A newly-created session begins idle before start().
                    self.isPreviewTransitioning = true
                }
            }
        }

        sessionErrorToken = session.errorPublisher.listen { [weak self] error in
            Task { @MainActor in
                self?.errorMessage = "Glasses session error: \(error.localizedDescription)"
                self?.cameraStatus = "Session error — tap to retry"
                self?.isGlassesStreaming = false
                self?.isPreviewTransitioning = false
                self?.stopTwitchAfterVideoLoss()
            }
        }
    }

    private func handleStoppedSession() {
        let shouldRestart = restartPreviewAfterStop
        restartPreviewAfterStop = false
        isGlassesStreaming = false
        isPreviewTransitioning = false
        currentFrame = nil
        cleanupCamera()
        cleanupSession()
        cameraStatus = "Glasses not streaming"
        stopTwitchAfterVideoLoss()

        if shouldRestart {
            startGlassesPreview()
        }
    }

    private func beginCamera(on session: DeviceSession) {
        guard camera == nil else {
            isPreviewTransitioning = false
            return
        }

        let config = StreamConfiguration(
            videoCodec: .raw,
            resolution: .high,
            frameRate: 24
        )

        do {
            guard let camera = try session.addCamera(config: config) else {
                errorMessage = "Meta DAT could not create a camera stream."
                cameraStatus = "Camera unavailable — tap to retry"
                isPreviewTransitioning = false
                return
            }
            self.camera = camera
            observeStream(camera.stream)
            cameraStatus = "Starting POV camera…"
            camera.stream.start()
        } catch {
            errorMessage = "Could not start POV camera: \(error.localizedDescription)"
            cameraStatus = "Camera failed — tap to retry"
            isPreviewTransitioning = false
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
                    self.isPreviewTransitioning = false
                    self.cameraStatus = "POV camera live"
                case .paused:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = false
                    self.cameraStatus = "POV camera paused — tap to retry"
                    self.stopTwitchAfterVideoLoss()
                case .waitingForDevice:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = false
                    self.cameraStatus = "Waiting for glasses — tap to retry"
                    self.stopTwitchAfterVideoLoss()
                case .starting:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = true
                    self.cameraStatus = "Starting POV camera…"
                case .stopping:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = true
                    self.cameraStatus = "Stopping POV camera…"
                    self.stopTwitchAfterVideoLoss()
                case .stopped:
                    self.isGlassesStreaming = false
                    self.isPreviewTransitioning = false
                    self.currentFrame = nil
                    self.cleanupCamera()
                    self.cameraStatus = "Camera stopped — tap to retry"
                    self.stopTwitchAfterVideoLoss()
                }
            }
        }

        streamFrameToken = stream.videoFramePublisher.listen { [weak self] frame in
            guard let self else { return }

            // Burn the native HUD into the outgoing glasses frame before
            // HaishinKit performs the H.264 encoding required by Twitch RTMP.
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
                self?.cameraStatus = "POV stream error — tap to retry"
                self?.isGlassesStreaming = false
                self?.isPreviewTransitioning = false
                self?.stopTwitchAfterVideoLoss()
            }
        }
    }

    private func stopTwitchAfterVideoLoss() {
        Task { [weak self] in
            guard let self, self.twitch.isLive else { return }
            await self.twitch.stop()
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
