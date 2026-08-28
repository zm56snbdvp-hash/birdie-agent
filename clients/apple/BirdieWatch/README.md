# Birdie Watch V1

Voice-first Apple Watch companion for Birdie.

## V1 UX

- Birdie is the primary surface, not a miniature desktop dashboard.
- Tap `Mit Birdie sprechen` and use native Apple Watch dictation.
- Birdie's answer is rendered as a short watch-readable response.
- The Inbox section shows up to five unread mail cards.
- Tap a mail to read its compact preview. Replies and every other controlled
  mutation are reviewed in Birdie Approve on the paired iPhone.
- The Watch cannot send mail or manufacture an approval flag.
- A WidgetKit complication provides a direct Birdie entry point from the watch face.

## Production request path

```text
Apple Watch
    |
    | WatchConnectivity sendMessage
    v
iPhone Companion
    |
    | BIRDIE_WATCH_API_KEY from iPhone Keychain
    v
Birdie Agent /watch/*
    |
    +--> Birdie OS / OpenAI chat path
    +--> Read-only briefing and Birdie chat
```

The watch binary contains no Birdie backend credential.

## Backend routes

- `GET /watch/briefing`
- `POST /watch/command`

The native client does not call the legacy `/watch/mail/reply` route. The iPhone
relay rejects such WatchConnectivity messages locally, including messages that
claim a caller-authored approval flag. The backend route must be removed or
migrated to Birdie Trust before production rollout.

## Credential boundary

Cloud Run receives a dedicated `BIRDIE_WATCH_API_KEY` secret with at least 32 characters. It must be independent from `BIRDIE_AGENT_API_KEY`.

On iPhone, `WatchTokenStore` persists this credential in Keychain using `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. `BirdiePhoneSetupView` is the development/setup surface for connecting or removing the credential. `WatchRelay` reads it only when forwarding a request to Cloud Run.

The Apple Watch receives only request results through WatchConnectivity; it never receives or persists the credential.

## Xcode integration

Create an iOS app with a paired watchOS app target.

### iPhone target

Add:

- `clients/apple/BirdiePhone/WatchRelay.swift`
- `clients/apple/BirdiePhone/WatchTokenStore.swift`
- `clients/apple/BirdiePhone/BirdiePhoneSetupView.swift`

Ensure `WatchRelay.shared` is initialized when the iPhone companion launches.

### watchOS app target

Add the Swift files in `clients/apple/BirdieWatch/`.

### watchOS Widget Extension

Add:

- `clients/apple/BirdieWatchWidget/BirdieWatchWidget.swift`

The complication supports accessory circular, rectangular, and inline families and deep-links into the watch app when tapped.

## Deployment gate

Before production traffic:

1. Create a strong random `BIRDIE_WATCH_API_KEY` in Secret Manager / Cloud Run.
2. Deploy the Birdie Agent revision with that secret bound as an environment variable.
3. Put the same value into the iPhone companion through `BirdiePhoneSetupView`; it is persisted only in Keychain.
4. Verify unauthenticated `/watch/*` returns `401 WATCH_UNAUTHORIZED`.
5. Verify authenticated `/watch/briefing` returns the compact inbox.
6. Verify a voice command reaches `/watch/command` through the paired iPhone.
7. Verify no mail reply control appears and a crafted `mailReply` relay message fails closed.

## Release gates

- Build/sign the paired iOS + watchOS targets in Xcode on a Mac.
- Bind the production Watch secret to Cloud Run without exposing it in source or chat.
- Run paired-device smoke tests on the actual iPhone and Apple Watch.

## Free own-device install

Kevin can install Birdie on his own iPhone and Apple Watch with Xcode's free
Personal Team. GitHub generates a ready-to-open `BirdiePersonal.xcodeproj` and
packages it as the `Birdie-Personal-Watch-Xcode` workflow artifact. The exact
German install flow and the seven-day reprovisioning limit are documented in
[`../PERSONAL_WATCH_INSTALL_DE.md`](../PERSONAL_WATCH_INSTALL_DE.md).
