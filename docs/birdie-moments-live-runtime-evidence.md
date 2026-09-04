# Birdie Moments — recovered BirdieWorld runtime evidence

This note records observations from the deployed BirdieWorld browser artifacts contained in `birdie-score-full-recovery-patched-v4.zip`. It does **not** claim access to the original ChatGPT Sites server source, D1 schema, secrets, or production storage.

## Deployment identity

Recovered page metadata identifies the currently reconstructed BirdieWorld deployment as:

- product: `BirdieWorld — Golf, Karten & Fortschritt`
- deployed Site host observed in the recovered page: `birdie-score.wnrkgdmqfc.chatgpt.site`
- scorecard bundle: `golf-scorecard-Dut-vRpH.js`
- recovered app shell bundle: `index-BiRW1UFt.js`

The recovery checkpoint's route/module map identifies the active product routes `/deck`, `/duell`, `/fortschritt`, `/karten`, `/scorecard`, and `/spiel`. No `/moments` route is present in the recovered deployed route map.

## Scorecard persistence contract recovered from deployed bundle

The deployed scorecard client loads the current persisted round using:

```text
GET /api/round
Cache-Control intent: no-store
response authority: response.round
```

Saving uses:

```text
POST /api/round
Content-Type: application/json
```

The recovered client serializes only the following scorecard payload fields:

```js
{
  id: existingRoundId ?? undefined,
  courseName,
  playedAt,
  holeCount,
  holes
}
```

Important integration findings:

1. The browser does **not** send `userId` as round ownership authority.
2. The browser does **not** send a trusted `status` or `completed: true` flag.
3. A successful save response is expected to contain `response.round`.
4. The persisted `response.round.status` is used by the client when restoring the round (`completed` vs draft).
5. Therefore Birdie Moments must attach downstream of the canonical server save/commit and must determine completion and ownership from the persisted server-side round, never from request JSON or UI state.

This evidence supports the integration branch's `scorecard-save-adapter.mjs`: Core Scorecard persistence remains authoritative; Moments executes only after a completed persisted result and cannot roll back the Scorecard save.

## Authentication boundary recovered from deployed page

The recovered BirdieWorld page presents the Birdie Account login with the copy:

> Nutze deinen ChatGPT-Zugang. Du brauchst für BirdieWorld kein zusätzliches Passwort.

The recovered login action targets:

```text
/signin-with-chatgpt?return_to=%2F
```

Therefore the deployed authentication mechanism is no longer classified as an unknown external provider: the recovered client is using the ChatGPT Site sign-in/session boundary.

What remains unavailable is the **server-side runtime function that resolves an authenticated ChatGPT Site request/session to BirdieWorld's canonical user id**. The integration branch therefore accepts that resolver only as an injected authoritative callback and never parses a client-supplied `userId`.

## Moment route gap

The recovered deployed route map has `/scorecard` but no `/moments` route. The existing Phase-3/4 Moment detail/reveal/checkout/download logic is therefore not proven to be mounted in the current deployed BirdieWorld app.

This is a concrete integration gap, not merely a missing test:

- post-round reveal needs a real app binding;
- `/moments/:momentId` needs a real authenticated route binding;
- checkout/download endpoints need the same server-resolved Site session user;
- the Digital master must remain behind the existing paid-owner check and private signed-read path.

## Payment / private asset evidence boundary

No real-money Moments checkout/payment-provider implementation or private Digital-master storage adapter is present in the recovered BirdieWorld browser artifacts. Browser artifacts are not sufficient evidence for server-side payment verification or private storage even if such infrastructure exists behind the Site.

Phase-4 remains the canonical contract: payment success is authoritative only after server-side provider verification, and a paid owner receives a short-lived authorized read URL rather than a raw private asset reference.

## Scope boundary

Nothing in this runtime audit changes or takes ownership of:

- Print Phase 5/6 provider/order work;
- card taxonomy/artwork/deck/booster fixes;
- gameplay/power-bar work.

The recovered evidence is used only to narrow the Birdie Moments live integration boundary.