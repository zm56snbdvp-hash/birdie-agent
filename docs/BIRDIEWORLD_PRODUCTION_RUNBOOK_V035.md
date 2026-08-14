# BirdieWorld V0.3.5 Production Runbook

Status: **release candidate preparation only**

Production, the merge into `main`, a canonical domain assignment and public
publication remain blocked until the Founder gives the exact confirmation
`GO_BIRDIEWORLD_PRODUCTION_V035`.

## Pinned candidate

- Source PR: `#20`
- Source head: `146252a3541541c01576e68d47001dbe4448bcd6`
- Target branch: `main`
- App: `client/birdie-app-v1`
- Visual contract: Immersive Estate V0.3.5
- Unity contract: `birdieworld-estate-handoff-v1`
- Existing review URL: `https://birdie-app-v1-immersive-estate-v035.vercel.app/`
- Important: the existing review URL predates the final Unity-handoff head and
  is not production evidence for this candidate.

## Required evidence before merge

1. Release-candidate pull request is mergeable against the current `main`.
2. Root repository tests pass in GitHub CI.
3. Strict app and Playwright TypeScript checks pass.
4. Production build passes and the build artifact is retained.
5. All desktop, phone and WebGL-fallback Playwright gates pass without retry.
6. Founder opens the candidate on a real phone and records `PASSED` for the
   first view, one-thumb movement, all three destinations, return flow and
   installability.

## Required production pins

Before any deployment, record all of the following as protected environment
values or equivalent release inputs:

- `BIRDIEWORLD_PRODUCTION_DOMAIN`: canonical HTTPS URL, not a review URL.
- `BIRDIEWORLD_PRODUCTION_PROJECT_ID`: exact production Vercel project.
- `BIRDIEWORLD_PRODUCTION_TEAM_ID`: exact Vercel team.
- `BIRDIEWORLD_RELEASE_SHA`: exact merged SHA being deployed.
- `GITHUB_SHA`: must equal the release SHA.
- `BIRDIEWORLD_MAIN_INTEGRATION=PASSED`.
- `BIRDIEWORLD_PHONE_REVIEW=PASSED`.
- `BIRDIEWORLD_PRODUCTION_CONFIRMATION=GO_BIRDIEWORLD_PRODUCTION_V035`.

Run `npm run check:birdieworld-production`. A non-zero exit means stop; do not
deploy around the gate.

## Production sequence

1. Confirm the current `main` SHA and successful release-candidate CI.
2. Complete and record the Founder phone review.
3. Obtain the exact Founder production confirmation.
4. Pin the canonical project, team, domain and merged SHA.
5. Run the production gate.
6. Deploy the exact build artifact produced from that SHA.
7. Verify `/`, `/manifest.webmanifest` and `/sw.js` return HTTP 200.
8. Re-run the phone arrival, destination and return smoke on the canonical URL.
9. Record deployment ID, project ID, domain, SHA, CI run and evidence artifact
   IDs in BirdieOS.

## Rollback

If any post-deploy smoke fails, immediately route the canonical domain back to
the previously verified deployment. Do not rebuild from a moving branch. Record
the failing deployment ID and symptom, then revert the integration commit on a
new branch. The existing review project is visual reference only and must not be
mistaken for the canonical production rollback target.
