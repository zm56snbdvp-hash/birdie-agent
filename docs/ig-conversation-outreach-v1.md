# IG Conversation Outreach V1 — source-only

Scope: non-economic Instagram conversation/outreach preparation. This branch does not activate Meta subscriptions, messaging runtime, Cloud Run traffic, secrets, deployment, Coin writes, identity links, claims, balances, or catalog rules.

## SOCIAL_OUTREACH_EVENTS
Canonical fields: `outreachEventId`, `channel`, `recipientScopedId`, `instagramHandle`, `triggerEventId`, `intentType`, `templateContentId`, `templateVersion`, `assetReleaseId`, `provider`, `providerMessageId`, `echoMessageId`, `eligibilityState`, `sendStatus`, `sentAt`, `echoAt`, `repliedAt`, `optedInAt`, `correlationConfidence`, `failureCode`, `idempotencyKey`, `notes`.

The ledger is non-economic by contract. It contains no `birdieId`, points, claim approval, transaction, or balance authority.

## Controlled image send
`sendRegisteredImage` accepts only an `assetReleaseId`. The asset registry must resolve it to a RELEASED PNG/JPEG and internally supply the provider URL. Caller-supplied media URLs are not accepted. Fresh `instagram_manage_messages` proof and conversation eligibility are mandatory. A deterministic send key prevents replay. Ambiguous provider results fail closed and prohibit automatic retry. Successful responses retain only provider message ID and bounded metadata; no token, secret, or message body is written to the outreach receipt.

## Outbound echo
Supported `message.is_echo=true` payloads normalize to `IG_OUTBOUND_ECHO`. Echo is non-economic and cannot independently prove identity. Correlation requires provider message ID or a governed correlation key. Unknown or contradictory echoes are quarantined. Native sticker/GIF attachments remain explicitly unverifiable.

## Manual transition command
`STICKER_SENT @handle <assetReleaseId>` maps to `stickerSent(...)`. It creates one founder-attested, idempotent outreach receipt only. It does not touch profiles, claims, Coin transactions, balances, events, or catalog entries.

## Onboarding
Preferred quick reply: `CLAIM MY BIRDIE`; keyword fallback: `BIRDIE`. Either yields `IDENTITY_WELCOME_CLAIM` intent with `coinWriteAllowed=false`. Safe copy until policy/catalog gates are complete: **Eligible, verified interactions can earn Birdie Coins.**

## Provider gates still closed
1. `instagram_manage_messages` permission must be proven live.
2. Messaging webhook subscription/runtime must be separately activated and verified.
3. Conversation eligibility semantics/window must be verified against current Meta policy.
4. Released asset registry needs a production-backed resolver and approved hosted media URL.
5. BirdieOS needs a deployed `SOCIAL_OUTREACH_EVENTS` persistence adapter before any real send path can be enabled.
6. Provider send/echo E2E must be run on one controlled conversation before activation.

No automatic Follow/Like/Repost reward claim is permitted by this contract.
