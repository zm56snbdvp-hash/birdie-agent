# Birdie Watch V0.1

Voice-first Apple Watch companion for Birdie.

## V0.1 UX

- Birdie is the primary surface, not a miniature desktop dashboard.
- Tap the `Mit Birdie sprechen` field and use the native Apple Watch dictation input.
- Birdie's answer is rendered as a short watch-readable response.
- The Inbox section shows up to five unread mail cards.
- Sending mail is a governed action and must never happen from an implicit voice transcript alone.

## Backend contract

The branch introduces `src/watch-router.mjs` with:

- `GET /watch/briefing`
- `POST /watch/command`
- `POST /watch/mail/reply`

`/watch/mail/reply` fails closed unless the request contains:

```json
{
  "founderApproved": true,
  "confirmation": "SEND_EMAIL"
}
```

The existing mail service remains authoritative for IMAP/SMTP execution.

## Security boundary

Do **not** put `BIRDIE_AGENT_API_KEY` into the watch app bundle.

The intended production flow is:

```text
Apple Watch
    |
    | WatchConnectivity / paired-device bootstrap
    v
iPhone Companion
    |
    | obtains short-lived Birdie Watch credential
    v
Birdie Agent /watch/*
    |
    +--> Birdie OS
    +--> Governed Mail Service
```

The watch credential must be scoped to the watch API, stored in Keychain, revocable, and short-lived. Sensitive outbound operations keep their server-side founder-confirmation requirements.

## Xcode integration

Create an iOS app with a paired watchOS app target, then add the Swift files in this directory to the watch target. Add a watchOS Widget Extension separately for the Birdie complication. The complication should be glanceable (Birdie state/unread count) and deep-link to the app rather than execute destructive actions itself.

## Next implementation gate

1. Wire `routeWatchRequest` into `server.mjs` behind a dedicated watch authentication function.
2. Add iPhone companion credential bootstrap with WatchConnectivity.
3. Store the watch credential in Keychain and replace the placeholder provider in `BirdieWatchAPI.swift`.
4. Add the WidgetKit Birdie complication.
5. Add explicit on-watch approval UI for prepared mail sends.
