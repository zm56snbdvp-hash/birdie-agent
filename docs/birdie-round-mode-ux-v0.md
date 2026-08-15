# Birdie App Round Mode UX V0 — Mobile Sandbox Prototype

Status: **sandbox prototype only**
Branch: `feature/birdie-round-mode-v0`
Depends on: TASK-049 + TASK-050 validated Round Mode domain behavior

## Purpose

Prototype the mobile product journey before any platform, deployment or hardware-identification decision. The UX consumes synthetic sandbox data only and is intentionally framework-neutral.

## Prototype surfaces

The prototype covers six screen states:

1. **Round** — current hole, score summary, Ball in Play, switch and lost actions.
2. **Scorecard** — strokes plus optional putts/penalties; course data remains reference-only.
3. **My Golf** — round-history/card concept using synthetic data.
4. **My Birdie Collection** — collection cards and object state without choosing an identification technology.
5. **Lost in the Wild** — privacy-safe Last Seen output; exact coordinates are never rendered.
6. **You Found a Birdie** — identification journey only; ownership transfer and Coin effects remain disabled.

## Mobile interaction model

Primary navigation is deliberately limited to three bottom-nav destinations: Round, My Golf and Collection. Contextual flows such as Scorecard, Lost in the Wild and You Found a Birdie open from those primary surfaces.

The prototype is contained in:

- `prototype/round-mode/index.html`
- `prototype/round-mode/styles.css`
- `prototype/round-mode/app.mjs`
- `src/round-mode/ux-prototype.mjs`

No framework dependency is added. This is a UX decision aid, not a platform commitment.

## Privacy rules

The UX uses the TASK-050 privacy contract:

- private Last Seen values render as **Private location saved**;
- latitude/longitude are never exposed by the UX view model;
- approximate labels may be shown only when the underlying visibility is not PRIVATE;
- no real course or GPS facts are fabricated.

## Product boundaries

This prototype does **not**:

- choose a native, web or PWA production platform;
- choose a hardware-identification technology;
- deploy or merge to `main`;
- write to BirdieOS Production;
- create a physical Birdie identity;
- transfer ownership;
- create Birdie Coin, badge, reward or balance effects;
- use real user location, course or score data.

## Running locally

Serve the repository with any local static file server and open `prototype/round-mode/index.html`. The page is intentionally static/sandbox-only and imports the local UX view-model module.

## Acceptance

Run the full repository test suite:

```bash
npm test
```

TASK-051 acceptance requires:

- all repository tests passing;
- all six required UX screens represented;
- mobile viewport + constrained phone-shell layout;
- private Last Seen redaction verified;
- no concrete hardware-identification choice in prototype sources;
- no transfer, Coin, Production or deployment effect.
