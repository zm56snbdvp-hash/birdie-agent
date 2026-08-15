# GitHub OIDC to Cloud Run: governed no-traffic lane

## Boundary

This packet prepares one manual deployment lane for Birdie Agent `2.9.0` at
source SHA `eeaf5d7e33451ed6ea9338d6cf5022be95db9277`. It can build, push and create
one tagged Cloud Run revision with zero traffic. It cannot move traffic, change
public invocation, deploy Apps Script, configure Meta, approve Coin economics,
or release a BirdieWorld client.

The workflow accepts no long-lived Google credential. GitHub requests a
short-lived OIDC token, Google validates the immutable repository identity and
the environment gate, and a dedicated deployer service account receives only
the four permissions described below.

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

GitHub's default environment subject is checked together with the numeric
repository and owner IDs. The numeric claims make a rename or namespace
takeover fail closed; do not remove them from the Google attribute condition.

> **Pre-merge blocker:** `main` is currently unprotected and the repository has
> no GitHub environment. Keep this pull request in Draft, keep the Google WIF
> binding disabled, and do not merge until `main` has required PR checks and
> `birdie-cloud-run-no-traffic` exists with branch restriction and a required
> reviewer. Merely naming a missing environment in a workflow does not create
> an approval gate.

## One-time provider bootstrap

Complete and export the **GitHub environment gate** below before running any of
these commands. In particular, do not create the Workload Identity User binding
while the named environment is absent or unprotected.

Run this setup from a trusted founder workstation with an authenticated Google
Cloud administrator. It is intentionally not performed by the workflow.
Review every identifier and replace the two values marked `CHANGE_ME`.

```bash
set -euo pipefail

PROJECT_ID='gen-lang-client-0251788487'
REGION='europe-west3'
SERVICE='birdie-agent'
POOL_ID='github-birdie-agent'
PROVIDER_ID='github-birdie-agent'
DEPLOYER_SA_ID='birdie-github-deployer'
RUNTIME_SA='CHANGE_ME_RUNTIME_SERVICE_ACCOUNT'
ARTIFACT_REPOSITORY='CHANGE_ME_DEDICATED_DOCKER_REPOSITORY'

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER_SA="$DEPLOYER_SA_ID@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create "$DEPLOYER_SA_ID" \
  --project "$PROJECT_ID" \
  --display-name 'GitHub Birdie Agent no-traffic deployer'

gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --repository-format docker \
  --description 'Immutable Birdie Agent release images'

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --display-name 'GitHub Birdie Agent'

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --workload-identity-pool "$POOL_ID" \
  --display-name 'GitHub Birdie Agent immutable identity' \
  --issuer-uri 'https://token.actions.githubusercontent.com' \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.event_name=assertion.event_name,attribute.workflow_ref=assertion.workflow_ref' \
  --attribute-condition "assertion.sub == 'repo:zm56snbdvp-hash/birdie-agent:environment:birdie-cloud-run-no-traffic' && assertion.repository_id == '1329217661' && assertion.repository_owner_id == '315131667' && assertion.ref == 'refs/heads/main' && assertion.environment == 'birdie-cloud-run-no-traffic' && assertion.event_name == 'workflow_dispatch' && assertion.workflow_ref == 'zm56snbdvp-hash/birdie-agent/.github/workflows/deploy-cloud-run-no-traffic.yml@refs/heads/main'"

PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository_id/1329217661"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "$PRINCIPAL_SET"

gcloud artifacts repositories add-iam-policy-binding "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --role roles/artifactregistry.writer \
  --member "serviceAccount:$DEPLOYER_SA"

gcloud run services add-iam-policy-binding "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --role roles/run.developer \
  --member "serviceAccount:$DEPLOYER_SA"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project "$PROJECT_ID" \
  --role roles/iam.serviceAccountUser \
  --member "serviceAccount:$DEPLOYER_SA"

gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --workload-identity-pool "$POOL_ID" \
  --format='value(name)'
```

Do not grant Project Editor, Owner, Cloud Run Admin, Service Account Admin, or
service-account-key creation. Keep the deployment identity separate from the
Cloud Run runtime identity.

## GitHub environment gate

Perform this section before the provider bootstrap and before merging this
Draft PR. Protect `main`: require pull requests, require the exact
`PR Tests / test` check, block force-pushes and deletion, and require review-thread
resolution. Then create environment `birdie-cloud-run-no-traffic` and:

1. Restrict deployment branches to `main` only.
2. Add the Founder as required reviewer and disallow self-review where the
   repository plan supports it. Preventing self-review requires a second
   trusted reviewer when the Founder also dispatches the workflow.
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

1. Complete the reviewed in-place Apps Script deployment first. Its receipt
   must include deployment/version IDs, dispatcher before/after SHA-256,
   minimal route diff, API-key-before-handler proof, immutable
   `BIRDIE_WORLD_V1_CUTOVER_AT`, and canonical readback.
2. Confirm the current Cloud Run service already uses the exact runtime service
   account and already contains every required Meta/Birdie App/runtime variable
   name. The workflow reads values only into runner-local files and never logs
   or uploads them.
3. Confirm `META_INSTAGRAM_ACCESS_TOKEN` is absent. Outbound Instagram activity
   remains a different Founder gate.
4. From Actions on `main`, select **Deploy Cloud Run candidate (no traffic)**.
5. Enter the full release SHA, numeric Apps Script version, SHA-256 of the
   immutable Apps Script receipt, and the exact confirmation
   `DEPLOY_BIRDIE_AGENT_NO_TRAFFIC_EEAF5D7`.
6. Approve the protected GitHub environment only after checking the run is for
   the exact repository IDs, workflow, branch, SHA, and release version above.

The run verifies source tests and credentials exclusions, then a job with no
OIDC permission builds with the
official Node `22.23.1-slim` multi-platform image pinned to index digest
`sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3`
and passes the immutable image tar plus its GitHub artifact digest to the
protected deployment job. Only that job may request a cloud token. It then
verifies current configuration,
current IAM, and the single 100% traffic revision. It deploys
the image by digest with `gcloud run deploy --no-traffic`, checks the previous
revision still owns 100%, verifies the candidate's public root contract, a 401
for an unauthenticated BirdieWorld read, a 401 for a bad Meta signature, and
then uploads only a sanitized receipt.

The root response proves that the candidate started with the expected version;
it is not a BirdieOS connectivity proof. The workflow deliberately checks that
unauthenticated `/health` is rejected and does not copy an application API key
into GitHub. A separate controlled, authenticated, read-only health check is
required before any future traffic decision.

## After the run

A green no-traffic receipt is evidence for a candidate, not authorization to
go live. Review Cloud Run logs and the tagged candidate, archive the sanitized
receipt in BirdieOS, and stop. Traffic movement requires a later, separately
named exact Founder command and its own rollback receipt. Apps Script, Meta
subscription, Coin approval, and the BirdieWorld client also remain separate
gates.

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
