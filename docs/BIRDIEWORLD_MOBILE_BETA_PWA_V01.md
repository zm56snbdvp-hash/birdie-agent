# BirdieWorld Mobile Beta PWA V0.1

## Scope

This distribution pass makes the CI-green Living Arrival V0.2 installable from a mobile browser. It does not add identity, personal persistence, permissions, quests, spendable currency, multiplayer, voice, GPS, merge authority, or a main-production release.

## Product record

- **Observation:** Living Arrival already passes the exact 390 × 844 touch layout gate, but a browser tab does not yet feel like a phone beta.
- **Hypothesis:** A branded Home Screen entry and a bounded offline shell remove installation friction without expanding the product surface.
- **Implementation:** German install manifest, dedicated icons, iOS mobile metadata, safe-area layout, and a versioned same-origin service worker. The worker stores only the static application shell; it explicitly excludes API requests and stores no user state.
- **Counterexample:** An installed icon alone does not prove App Store quality, real-device WebGL behavior, or supporter readiness. Safari's Add-to-Home-Screen action still requires a real iPhone check.
- **Verification:** Repository contracts, strict TypeScript, production build, browser flow, exact 390 × 844 touch layout, manifest/icon delivery, service-worker control, WebGL fallback, all three destinations, return to Birdie, console errors, and baseline accessibility are gated before deployment.
- **Next sensible step:** Founder real-device install and 3D/touch check. TestFlight remains a separate successor only if native distribution is still desirable.

## Version and rollback

- Experience: Living Arrival V0.2
- Distribution: Mobile Beta PWA V0.1
- Rollback: the prior CI-green PR head and its isolated V0.2 review deployment remain unchanged.
