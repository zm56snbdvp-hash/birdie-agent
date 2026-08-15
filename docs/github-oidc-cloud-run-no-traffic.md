# GitHub OIDC to Cloud Run: Stage-A absent-bundle no-traffic lane

## Boundary

This packet prepares one manual **Stage A** deployment lane for Birdie Agent
`2.9.0` at source SHA `eeaf5d7e33451ed6ea9338d6cf5022be95db9277`.
It can build, push and create one tagged Cloud Run revision with zero traffic.
`STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT` is a release-evidence lane, not an
application feature flag. It proves that the BirdieWorld **user-auth** names
and the Meta inbound **activation** names are absent, outbound Instagram access
remains absent, and no Apps Script deployment is evaluated.

The revision inherits the existing core runtime configuration and governed
agent keys. Core, Coin, mail, Framer and agent-key administrative routes are
not disabled or authenticated-tested by this lane. The workflow executes no
authenticated application call and proves only that unauthenticated Coin
writes fail closed.

This lane cannot move traffic, change public invocation, deploy Apps Script,
configure or subscribe Meta, approve Coin economics, or release a BirdieWorld
client. A successful receipt **does not authorize traffic** or any capability
activation.

The workflow accepts no long-lived Google credential. GitHub requests a
short-lived OIDC token, Google validates the immutable repository identity and
the environment gate, and a dedicated deployer service account uses the four
required scoped bindings described below. Effective project-level grants must
also be audited before dispatch.

## Immutable identities

| Field | Required value |
| --- | --- |
| GitHub repository | `zm56snbdvp-hash/birdie-agent` |
| Repository ID | `1329217661` |
| Owner ID | `315131667` |
| Branch | `refs/heads/main` |
| Environment | `birdie-cloud-run-no-traffic` |
| Event | `workflow_dispatch` |
| Workflow ref | `zm56snbdvp-hash/birdie-agent/.github/workflows/deploy-cloud-run-no-traffic.yml@refs/heads/main` |
| OIDC subject | `repo:zm56snbdvp-hash/birdie-agent:environment:birdie-cloud-run-no-traffic` |
| Google project | `gen-lang-client-0251788487` |
| Region | `europe-west3` |
| Cloud Run service | `birdie-agent` |
| Runtime service account | `893591677320-compute@developer.gserviceaccount.com` |
| Release-evidence lane | `STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT` |

GitHub's default environment subject is checked together with the numeric
repository and owner IDs. The numeric claims make a rename or namespace
takeover fail closed; do not remove them from the Google attribute condition.

> **Pre-merge blocker:** keep this pull request in Draft until a fresh export
> proves the required `main` ruleset, the protected
> `birdie-cloud-run-no-traffic` environment, its required reviewer, its exact
> `main`-only deployment branch policy, and all five environment variables.
> A ruleset or reviewer alone is not sufficient. Merely naming an environment
> in a workflow does not prove that its protection is complete.

## Provider coordinates and bootstrap receipt

The provider resources already exist. Do not recreate or rename them for this
release. Export their live configuration and compare it with these reviewed
coordinates:

- Workload Identity pool/provider: `github-birdie-agent`
- Deployer: `birdie-github-deployer@gen-lang-client-0251788487.iam.gserviceaccount.com`
- Artifact repository: `birdie-agent-releases`
- Runtime identity: `893591677320-compute@developer.gserviceaccount.com`

The provider attribute condition must remain exactly:

```text
assertion.sub == 'repo:zm56snbdvp-hash/birdie-agent:environment:birdie-cloud-run-no-traffic'
  && assertion.repository_id == '1329217661'
  && assertion.repository_owner_id == '315131667'
  && assertion.ref == 'refs/heads/main'
  && assertion.environment == 'birdie-cloud-run-no-traffic'
  && assertion.event_name == 'workflow_dispatch'
  && assertion.workflow_ref == 'zm56snbdvp-hash/birdie-agent/.github/workflows/deploy-cloud-run-no-traffic.yml@refs/heads/main'
```

Use read-only provider checks from a trusted, authenticated Google Cloud shell:

```bash
set -euo pipefail

PROJECT_ID='gen-lang-client-0251788487'
REGION='europe-west3'
SERVICE='birdie-agent'
POOL_ID='github-birdie-agent'
PROVIDER_ID='github-birdie-agent'
DEPLOYER_SA_ID='birdie-github-deployer'
RUNTIME_SA='893591677320-compute@developer.gserviceaccount.com'
ARTIFACT_REPOSITORY='birdie-agent-releases'

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER_SA="$DEPLOYER_SA_ID@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --workload-identity-pool "$POOL_ID" \
  --format='yaml(name,state,attributeMapping,attributeCondition)'

PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository_id/1329217661"
gcloud iam service-accounts get-iam-policy "$DEPLOYER_SA" \
  --project "$PROJECT_ID" \
  --format=json

gcloud artifacts repositories get-iam-policy "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --format=json

gcloud run services get-iam-policy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format=json

gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" \
  --project "$PROJECT_ID" \
  --format=json

gcloud projects get-iam-policy "$PROJECT_ID" --format=json | \
  jq --arg deployer "serviceAccount:$DEPLOYER_SA" \
     --arg runtime "serviceAccount:$RUNTIME_SA" '
    [.bindings[]? | {
      role,
      members:[.members[]? | select(. == $deployer or . == $runtime)]
    } | select(.members | length > 0)] | sort_by(.role)
  '
```

The receipt must show the existing `roles/iam.workloadIdentityUser`,
`roles/artifactregistry.writer`, `roles/run.developer`, and
`roles/iam.serviceAccountUser` bindings for the exact principals above, plus
the filtered project-level role export for both service accounts. Do not
grant Project Editor, Owner, Cloud Run Admin, Service Account Admin, or
service-account-key creation. Keep the deployment identity separate from the
Cloud Run runtime identity.

## GitHub environment gate

Complete and export this section before merging the Draft PR. Protect `main`:
require pull requests, require the exact
`PR Tests / test` check, block force-pushes and deletion, and require review-thread
resolution. Then create environment `birdie-cloud-run-no-traffic` and:

1. Restrict deployment branches to `main` only.
2. Add the Founder as required reviewer and record the approved self-review
   behavior. Do not treat 0% default traffic as an access-control boundary: the
   tagged candidate URL is directly addressable. Every later capability or
   traffic activation still needs a new exact Founder approval.
3. Add exactly these environment variables (not secrets):

   - `GCP_WIF_PROVIDER`: full provider name returned by the final command above.
   - `GCP_DEPLOYER_SERVICE_ACCOUNT`: the dedicated deployer email.
   - `GCP_RUNTIME_SERVICE_ACCOUNT`: the existing Cloud Run runtime identity.
   - `GCP_ARTIFACT_REPOSITORY`: the dedicated Docker repository ID.
   - `BIRDIE_NO_TRAFFIC_ENVIRONMENT_GUARD`: exact value
     `BIRDIE_NO_TRAFFIC_PROTECTED_V1`. Its absence makes an accidentally
     auto-created environment fail before cloud authentication.

The workflow intentionally contains no `secrets.*` reference and no JSON key
fallback. Before the first run, export the environment configuration and the
four scoped IAM policies as the bootstrap receipt. Record identifiers and
fingerprints only; never record tokens, key material, or runtime values.

## Preflight and manual run

1. Export the effective project roles of both the deployer and
   `893591677320-compute@developer.gserviceaccount.com`, plus the Cloud Run
   service IAM policy. Resolve unexpected broad grants before dispatch; this
   audit cannot be deferred because the tagged candidate is directly
   addressable even at 0% default traffic.
2. Confirm the current Cloud Run service uses exactly
   `893591677320-compute@developer.gserviceaccount.com`. Stage A preserves this
   identity; it does not migrate it.
3. Confirm these four existing core variable names are present in the single
   application container:
   `BIRDIE_AGENT_API_KEY`, `BIRDIE_OS_API_KEY`, `BIRDIE_OS_BASE`, and
   `OPENAI_API_KEY`. The workflow reads names only, never values.
4. Confirm all nine Stage-A activation names are absent from that container:
   `BIRDIE_APP_BIRDIE_ID_CLAIM`, `BIRDIE_APP_OAUTH_AUDIENCE`,
   `BIRDIE_APP_OAUTH_ISSUER`, `BIRDIE_APP_OAUTH_JWKS_URL`, `META_APP_SECRET`,
   `META_INSTAGRAM_ACCOUNT_ID`, `META_INSTAGRAM_USERNAME`,
   `META_WEBHOOK_VERIFY_TOKEN`, and `META_INSTAGRAM_ACCESS_TOKEN`. Do not add
   placeholders. Outbound Instagram activity remains a separate Founder gate.
5. From Actions on `main`, select
   **Deploy Cloud Run Stage-A candidate (no traffic)**.
6. Enter the full release SHA and exact confirmation
   `DEPLOY_BIRDIE_AGENT_STAGE_A_NO_TRAFFIC_EEAF5D7`.
7. Approve the protected GitHub environment only after checking the exact
   repository IDs, workflow, branch, SHA, release version, runtime identity,
   and `STAGE_A_META_BIRDIEWORLD_USERAUTH_ABSENT` evidence lane.

The run verifies source tests and credentials exclusions, then a job with no
OIDC permission builds with the
official Node `22.23.1-slim` multi-platform image pinned to index digest
`sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`
and passes the immutable image tar plus its GitHub artifact digest to the
protected deployment job. Only that job may request a cloud token. It then
verifies current configuration, current IAM, and the single 100% traffic
revision. It deploys the image by digest with
`gcloud run deploy --no-traffic`, checks the previous revision still owns 100%
and the candidate owns 0%, and proves the fail-closed route contract:

- Root: `200`, version `2.9.0`, BirdieWorld `AUTH_GATE_NOT_CONFIGURED`.
- BirdieWorld read: `503`, `BIRDIE_APP_AUTH_NOT_CONFIGURED`.
- Meta challenge GET: `503`, `META_CONFIG_MISSING`.
- Signed-looking Meta POST: `503`, `META_CONFIG_MISSING`.
- Unauthenticated Coin POST: `401`, `UNAUTHORIZED`.
- Unauthenticated health: `401`.

It then uploads only a sanitized Stage-A receipt. No runtime
environment-variable value, secret, token, direct candidate URL, or response
body is included; the receipt retains only the candidate URL's SHA-256.

The root response proves only that the candidate started with the expected
version and disabled BirdieWorld state; it is not a BirdieOS connectivity
proof. In release `2.9.0`, root `.meta == "SIGNED_WEBHOOK_CONTROLLED"` is a
static route label, not evidence that Meta is configured. Readiness is proven
instead by the explicit `META_CONFIG_MISSING` route checks. The workflow does
not copy an application API key into GitHub. A controlled, authenticated,
read-only health check remains required before any future traffic decision.

## After the run

A green Stage-A receipt proves only build, OIDC, registry, one new image
revision, one exact 0%-allocation tag bound to that revision, unchanged default
100% traffic, unchanged runtime-configuration/IAM fingerprints, and the narrow
absent-bundle route behavior above. It does not prove that authenticated write
surfaces are impossible; those remain behind the existing governed key and are
recorded as `NOT_EVALUATED_EXISTING_GOVERNED_KEY`. It is not an activation-ready
candidate. Keep the receipt private because the tagged zero-traffic URL is
directly addressable. Archive the sanitized receipt in BirdieOS and stop.

Next, perform the governed Apps Script inventory and in-place deployment under
a fresh release-specific Founder approval. That later receipt must include the
unchanged deployment ID/URL, previous and new numeric versions, dispatcher
before/after SHA-256, minimal route diff, API-key-before-handler proof,
immutable `BIRDIE_WORLD_V1_CUTOVER_AT`, canonical readback, and zero economic
writes. Stage A verifies the reviewed Apps Script source hashes only; it records
the live Apps Script deployment as `NOT_EVALUATED_STAGE_A`.

Meta inbound configuration and BirdieWorld auth each require a separately
governed later 0%-traffic revision. Meta subscription, outbound Instagram,
Coin approval, and any traffic movement remain distinct Founder gates with
their own rollback receipts. The Stage-A receipt does not authorize traffic,
provider subscription, public activation, or Coin writes.

If any verification fails, preserve the failed run and candidate revision for
audit. Do not retry by loosening identity, IAM, environment, traffic, auth, or
signature checks. A zero-traffic revision can be deleted later under a separate
cleanup decision; no ledger or Apps Script record is changed by this lane.

## References

- Google GitHub Actions authentication: <https://github.com/google-github-actions/auth>
- GitHub OIDC security reference: <https://docs.github.com/en/actions/reference/security/oidc>
- GitHub deployment environments: <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- Cloud Run deploy command: <https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy>
- Cloud Run IAM roles: <https://docs.cloud.google.com/run/docs/reference/iam/roles>
