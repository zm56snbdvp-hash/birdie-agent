# Birdie Score / BirdieWorld — Live Recovery 2026-09-04

This branch is a **source-recovery checkpoint**, reconstructed from the currently deployed BirdieWorld browser bundles because the original Codex/Sites workspace is not accessible without additional credits.

It is deliberately isolated from older BirdieWorld implementation branches and **must not be described as the original source tree**.

## Proven deployment identity

- Product title: `BirdieWorld — Golf, Karten & Fortschritt`
- Deployed app artifact compatibility deploymentVersion: `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`
- Recovered card catalog source metadata: `Birdieworld-First-Edition-v1.md`, generated `2026-09-01`
- Recovered canonical identities: **96**

## Recovered current card taxonomy

The actual deployed product taxonomy is retained exactly:

- `PLAYER` — 12
- `CLUB` — 18
- `BALL` — 12
- `SPIN` — 24
- `TACTIC` — 24
- `COURSE` — 6

Do not collapse this into a new speculative taxonomy. `SPIN` and `TACTIC` are real current gameplay families and `BALL` is a first-class equipment family.

## Root cause of the artwork defect

The current canonical catalog and the deployed JPG artwork set are incompatible versions.

The live resolver in `card-artwork-Bc7-dFuR.js` extracts only the three-digit physical number and renders:

`/assets/cards/edition-01/BW-E01-XXX-standard.jpg`

It does **not** validate card ID, family, name, or artwork version. The existing image therefore wins silently even when its identity belongs to a legacy catalog.

Observed legacy artwork ranges:

- 001–048 `COMMUNITY`
- 049–064 `PLACES`
- 065–080 `GEAR`
- 081–092 `MOMENTS`
- 093–096 `SIGNATURE`

This makes all 18 current `CLUB` cards point at legacy `COMMUNITY` / person artwork.

## Recovery policy

`src/domain/card-artwork.ts` is fail-safe:

- card ID must match;
- physical number must match;
- family must match;
- name must match;
- artwork must be explicitly verified;
- otherwise no image is returned.

A UI integrating this contract must render a neutral text/family fallback for `MISSING`, `MISMATCH`, or `UNVERIFIED`. It must never guess another family or blindly build an image path from a number.

## Recovered browser modules

The exact deployed bundle identities and SHA-256 values are preserved in `recovered/bundle-manifest.json`; the downloadable recovery pack retains the immutable browser-bundle evidence. These browser chunks are evidence snapshots, not hand-authored maintainable source.

## API surface recovered from client behavior

Known client calls are recorded in `src/contracts/live-api-contracts.json`, including:

- `/api/deck`
- `/api/boosters/open`
- `/api/starter-set/claim`
- `/api/round`
- `/api/local-duel`
- `/api/local-duel/reward`

Server implementations, authentication internals, D1 schema/migrations and secret configuration are **not recoverable from browser bundles** and remain UNPROVEN until another source artifact is obtained.

## Validation

Run:

```bash
npm test
```

The tests pin catalog cardinality, family ranges, starter deck composition and the proven unsafe number-only artwork resolver contract.

## Release state

**BLOCKED** — this recovery checkpoint proves and contains the card/artwork fix contract but does not reconstruct the complete original server/source tree and does not contain verified replacement artwork.
