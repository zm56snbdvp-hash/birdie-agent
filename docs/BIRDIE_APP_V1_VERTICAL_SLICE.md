# Birdie App V1 vertical slice

Status: **IN PROGRESS — sandbox only**

## Decision

Birdie App V1 is a responsive web-first client. The implementation uses React, TypeScript and Three.js for the compact comic 3D hotel hub. The client remains Capacitor-ready, while all backend contracts stay engine-neutral so a later native Unity client can reuse them.

Client work is isolated from Birdie Agent production code. This branch starts from the verified Round Mode baseline `52de11105956b3f075976fd6ab635484129ea51a` and must not be mixed into Birdie DNA PR #16.

## First vertical slice

The first slice contains:

- one visible avatar with curated color presets
- a Birdie & Breakfast hotel exterior
- keyboard and touch movement
- three world hotspots
  - Golf History
  - one sandbox Ball Passport in the Ball Vault
  - personal Birdie text-chat shell
- a non-WebGL compatibility view
- explicit sandbox labels and no production records

## Personal Birdie boundary

The app never calls internal BirdieOS routes directly. A later user-facing gateway may expose only allowlisted, per-user capabilities:

- read own profile and golf preferences
- read own rounds and derived golf statistics
- read owned privacy-safe Ball Passports
- maintain an inspectable/resettable personal Birdie conversation

Denied by architecture:

- BirdieOS tasks and operating data
- finance, pricing and supplier records
- company mail and legal records
- secrets and deployment controls
- other users' private data

## Acceptance gate

PASS when:

1. the scene renders on a supported WebGL browser;
2. the avatar can move by keyboard and touch;
3. each of the three hotspots opens a usable product panel;
4. the chat shell accepts a user message and returns a clearly identified sandbox response;
5. lint, production build, artifact validation and rendered HTML tests pass;
6. no production data, model call, Coin posting, external publication or production deployment occurs.

## Current validation

- ESLint: PASS
- Production build: PASS
- Rendered HTML test: PASS
- Sites artifact validation: PASS
- Visual compatibility view: PASS
- Cloud-browser WebGL interaction: not available in the isolated QA browser; the app falls back cleanly instead of crashing

## Non-goals

No full Sims-style slider editor, hotel interior, multiplayer, voice, live GPS/course integration, QR/NFC choice, real wallet balance, production authentication, production API write or public release is part of this slice.
