# Birdie POV

Prototype iOS broadcaster for **Ray-Ban Meta → iPhone → Twitch**.

## What is implemented

- Meta Wearables Device Access Toolkit 0.9.0 (`MWDATCore`, `MWDATCamera`)
- registration handoff through the Meta AI app
- camera permission flow
- `DeviceSession` + `Camera` lifecycle
- 720×1280 RAW glasses-camera frames at 24 fps
- live on-device preview
- portrait Full HD (1080×1920) H.264 RTMP output through HaishinKit 2.2.5
- 6,000,000 bps video bitrate with the H.264 High 4.1 profile
- native frame-composited Birdie HUD that is burned into the outgoing video
- an in-app **Birdie HUD** toggle that is on by default
- Twitch stream key is runtime-only and is never persisted

Both Swift package requirements are exact pins in `clients/apple/project.yml`.
XcodeGen also binds the Wi-Fi information and hotspot entitlements required by
the Meta device-access sample configuration.

## Local Meta configuration

The checked-in `Config/Meta.xcconfig` uses the safe Meta AI Developer Mode
defaults (`MetaAppID` 0 and an empty client token). For a registered Wearables
Developer project, create a local override without changing tracked files:

```bash
cd clients/apple/BirdiePOV/Config
cp Meta.local.xcconfig.example Meta.local.xcconfig
```

Replace only the placeholders in `Meta.local.xcconfig`. That file is ignored by
Git. Never place a Meta client token in `Info.plist`, `project.yml`, source code,
or a commit.

## First device test

1. Install/update the Meta AI app on the iPhone.
2. Pair the Ray-Ban Meta glasses normally in Meta AI.
3. In Meta AI, enable **Developer Mode** for the glasses.
4. Set the Apple Personal Team locally in Xcode if needed. Do not commit signing material.
5. From `clients/apple`, run `xcodegen generate`.
6. Open `Birdie.xcodeproj` in Xcode.
7. Select the **BirdiePOV** scheme and the physical iPhone.
8. Build and run.
9. Tap **Connect Meta** and complete the Meta AI registration handoff.
10. Tap **Start POV Camera** and grant camera access when Meta AI asks.
11. Verify that the glasses preview is visible in Birdie POV.
12. Leave **Birdie HUD** enabled for the first test and confirm the HUD appears in the preview.
13. Enter a Twitch stream key and tap **Go Live on Twitch**.
14. Confirm the same HUD is visible in Twitch, then switch the in-app toggle off and on to verify both paths.

## Validation order

Before testing Twitch, verify these layers independently:

1. glasses registration succeeds
2. a `DeviceSession` reaches `.started`
3. the camera stream reaches `.streaming`
4. frames and the default-on Birdie HUD appear in the local preview
5. the HUD toggle changes both the preview and the frame sent to Twitch
6. Twitch RTMP connects
7. Twitch receives correctly oriented 1080×1920 video at the 6,000,000 bps target

The app labels a successful RTMP publish call as **SENDING** rather than
claiming the channel is live. Twitch reception must still be verified on the
channel before marking step 7 successful.

## Video and HUD contract

The glasses still provide the highest available 9:16 RAW camera feed at 24 fps.
Before publishing, Birdie POV composites the Birdie HUD into each native video
frame and sends a portrait Full HD 1080×1920 H.264 stream configured for
6,000,000 bps, H.264 High 4.1, and a two-second maximum keyframe interval. The
HUD is part of the encoded frame rather than a SwiftUI-only overlay, so viewers
receive it on Twitch. The in-app toggle starts enabled and controls whether the
compositor adds the HUD.

The Twitch stream key exists only in the view's in-memory state for the current
app process. Birdie POV does not write it to `UserDefaults`, Keychain, files, or
any other persistence layer.

## Audio

The current prototype deliberately treats video as the first acceptance gate.
It does not configure an audio session during app/controller initialization.
The AVAudioSession route is prepared only when the user starts Twitch after the
Meta camera reaches `.streaming`, but audio samples are not yet attached to the
RTMP stream. The production audio source still needs device validation before
that wiring is added. Preferred order for testing is:

1. Ray-Ban microphone if iOS exposes it as a stable HFP input while DAT video is active
2. iPhone microphone as the guaranteed fallback

This avoids shipping an audio path that destabilizes the glasses video session.

## Verified scope

- Linux contract tests can validate dependency pins, generated-project inputs,
  secret ignores, manual-only TestFlight triggering, and retry/error code paths.
- Xcode project generation, package resolution, signing, iPhone installation,
  glasses preview, RTMP delivery, and Twitch reception require a Mac and real
  devices and are not proven by those contract tests.

## Security

Never commit a Twitch stream key, Meta client token, Apple certificate, provisioning profile, or signing credential.
