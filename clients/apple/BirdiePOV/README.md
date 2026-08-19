# Birdie POV

Prototype iOS broadcaster for **Ray-Ban Meta → iPhone → Twitch**.

## What is implemented

- Meta Wearables Device Access Toolkit (`MWDATCore`, `MWDATCamera`)
- registration handoff through the Meta AI app
- camera permission flow
- `DeviceSession` + `Camera` lifecycle
- 720×1280 RAW camera frames at 24 fps
- live on-device preview
- H.264 RTMP publishing through HaishinKit
- Twitch stream key is runtime-only and is not persisted

## First device test

1. Install/update the Meta AI app on the iPhone.
2. Pair the Ray-Ban Meta glasses normally in Meta AI.
3. In Meta AI, enable **Developer Mode** for the glasses.
4. Open `clients/apple/project.yml` and set the Apple `DEVELOPMENT_TEAM` locally if needed. Do not commit signing secrets.
5. From `clients/apple`, run `xcodegen generate`.
6. Open `Birdie.xcodeproj` in Xcode.
7. Select the **BirdiePOV** scheme and the physical iPhone.
8. Build and run.
9. Tap **Connect Meta** and complete the Meta AI registration handoff.
10. Tap **Start POV Camera** and grant camera access when Meta AI asks.
11. Verify that the glasses preview is visible in Birdie POV.
12. Enter a Twitch stream key and tap **Go Live on Twitch**.

## Validation order

Before testing Twitch, verify these layers independently:

1. glasses registration succeeds
2. a `DeviceSession` reaches `.started`
3. the camera stream reaches `.streaming`
4. frames appear in the local preview
5. Twitch RTMP connects
6. Twitch receives correctly oriented 720×1280 video

## Audio

The current prototype deliberately treats video as the first acceptance gate. The AVAudioSession is configured for Bluetooth compatibility, but the production audio source still needs device validation before being wired into the RTMP stream. Preferred order for testing is:

1. Ray-Ban microphone if iOS exposes it as a stable HFP input while DAT video is active
2. iPhone microphone as the guaranteed fallback

This avoids shipping an audio path that destabilizes the glasses video session.

## Security

Never commit a Twitch stream key, Meta client token, Apple certificate, provisioning profile, or signing credential.
