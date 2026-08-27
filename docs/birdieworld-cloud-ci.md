# BirdieWorld Cloud CI

Goal: remove the Cloud Mac from the normal BirdieWorld WebGL release loop.

## Pipeline

Build-only dispatch → Unity 6000.0.76f1 WebGL build → provenance + file manifest → immutable review artifact. A later production dispatch downloads that exact accepted artifact; it never rebuilds it.

The workflow is `.github/workflows/birdieworld-webgl-deploy.yml`.

## One-time GitHub configuration

Unity Personal builds require:

- `UNITY_LICENSE` — contents of the active `.ulf` Unity license file
- `UNITY_EMAIL` — Unity account email
- `UNITY_PASSWORD` — Unity account password

Create a `birdieworld-production` environment that:

- uses custom deployment-branch policies with exactly one branch rule named `main` and no tag or wildcard rule;
- defines `BIRDIEWORLD_FOUNDER_REVIEWER_LOGIN` as the exact GitHub login of the Founder;
- requires that exact Founder as a reviewer;
- prevents self-review and admin bypass;
- holds these environment-only secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `BIRDIEWORLD_INVITE_GATE_HMAC_KEY` — a random secret of at least 32 bytes, also held by the Founder who performs the live host-protection check.

The workflow queries the environment configuration and its concrete branch-policy list. It fails unless the configured Founder is the sole required reviewer, self-review and admin bypass are disabled, and the only deployment policy is the exact `main` branch. GitHub gates environment jobs before granting environment secrets.

## Cloud Mac extraction helpers

After Unity has an active Personal license, locate it with:

```bash
find /Library "$HOME/Library" -name 'Unity_lic.ulf' -print 2>/dev/null
```

After a successful Vercel CLI deployment, locate the linked project metadata with:

```bash
find "$HOME/Desktop/birdie-agent/clients/unity/BirdieWorld/Builds/WebGL" -path '*/.vercel/project.json' -print -exec cat {} \;
```

Create a Vercel token in the account used for `birdieworld-beta`. Store the three Unity values as repository Actions secrets and the four release values only on the protected environment.

## Fresh invite-only receipt

Immediately after checking the exact Vercel project and its invite-only protection, create a receipt bound to that project and the accepted manifest. Supply the two printed values to the production dispatch within 30 minutes:

```bash
read -rsp 'Invite-gate HMAC key: ' BIRDIEWORLD_INVITE_GATE_HMAC_KEY && echo
export BIRDIEWORLD_INVITE_GATE_HMAC_KEY VERCEL_ORG_ID='org_...' VERCEL_PROJECT_ID='prj_...'
export ACCEPTED_MANIFEST_SHA256='64-hex-digest-from-the-reviewed-artifact'
node <<'NODE'
const crypto = require('node:crypto');
const checkedAt = new Date().toISOString();
const payload = [
  'birdieworld-invite-v1',
  process.env.VERCEL_ORG_ID,
  process.env.VERCEL_PROJECT_ID,
  process.env.ACCEPTED_MANIFEST_SHA256,
  checkedAt
].join('\n');
const receipt = crypto.createHmac('sha256', process.env.BIRDIEWORLD_INVITE_GATE_HMAC_KEY)
  .update(payload)
  .digest('hex');
console.log(`invite_gate_checked_at=${checkedAt}`);
console.log(`invite_gate_receipt=${receipt}`);
NODE
unset BIRDIEWORLD_INVITE_GATE_HMAC_KEY ACCEPTED_MANIFEST_SHA256 VERCEL_ORG_ID VERCEL_PROJECT_ID
```

## Release behavior

- `workflow_dispatch` defaults to `build-only`.
- Builds are uploaded as a GitHub artifact even when Vercel credentials are absent.
- Each artifact contains `birdieworld-build.json` plus `birdieworld-files.sha256`; the summary prints its run ID, source SHA and manifest digest.
- `production` must run from `main` and requires the exact `GO_BIRDIEWORLD_CHARACTER_BETA_02`, accepted run ID, accepted source SHA and accepted manifest digest.
- The accepted run must be this workflow's successful `build-review-artifact` job on `main`; a production run cannot be reused as build evidence.
- The manifest must seal every regular file and the required release files. Hidden paths, symlinks, missing files and extras are rejected before `npx` runs.
- A fresh invite-only receipt binds the exact Vercel org/project, accepted manifest digest and check timestamp. It expires after 30 minutes.
- The production path pins Vercel CLI `59.5.0`; it never floats on `latest`.
- Every GitHub Action is pinned to an immutable commit SHA.
- Production runs are serialized and never canceled by a newer build.

Once a full CI build succeeds, the artifact can be reviewed without a Cloud Mac. Updating `birdieworld-beta.vercel.app` remains a separate Founder-approved action.
