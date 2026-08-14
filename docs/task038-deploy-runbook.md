# TASK-038 Provider Deployment Runbook

This is the operator handoff for Birdie Agent `2.8.0`. It intentionally
integrates the reviewed TASK-038 feature head
`338bd58beeb220e9da52018c94146c8382f84bb4` into current `main`
`5bc3941ea6ab46eb1b58756b39b5b99b757df796`. Never deploy the feature head
by itself: it predates the current Birdie Family and Framer read-stability
work.

The provider order is mandatory:

1. update the existing authoritative Apps Script web-app deployment;
2. verify it read-only;
3. deploy Birdie Agent to a no-traffic Cloud Run revision;
4. verify the tagged revision read-only;
5. move traffic to that exact revision.

Stop on any mismatch. Do not activate `IG_COMMENT`, run a live Coin flow, or
change a live row as part of these provider deployments. The canonical Coin
Action Catalog row remains `DRAFT` until both deployment receipts pass.

## Release preflight

Work only from the reviewed pull-request head supplied in the release receipt.

```bash
set -euo pipefail

RELEASE_SHA="<reviewed-pr-head-sha>"
git fetch --prune origin main release/task038-ig-comment-v2-8-0
git switch --detach "$RELEASE_SHA"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"

npm ci
npm test
node --check server.mjs
node --check src/mcp-server.mjs
node --check < birdie-os/coin-system.gs
node --check < birdie-os/community-identity.gs
node --check < birdie-os/social-coin-events.gs
```

Expected result: `117` tests pass and no syntax check fails. Verify the Apps
Script release files before copying them:

```bash
sha256sum birdie-os/coin-system.gs \
  birdie-os/community-identity.gs \
  birdie-os/social-coin-events.gs
```

Expected SHA-256 values:

```text
1c0814c60387336701200844967c03454af90980688e85153520f6540f0d5841  birdie-os/coin-system.gs
57f3034b7f2d00fa90bca8ba0cb5e9dcc0d0bbc32367f27d739ba51224dfddfb  birdie-os/community-identity.gs
ec2b5f3771aa4152df620584cb3d69f6154e31e3b3a81f5efeee63b94880522a  birdie-os/social-coin-events.gs
```

## 1. Apps Script first

Use the existing authoritative Apps Script project. Preserve its Script ID,
web-app deployment ID and URL, execution identity, access policy, manifest,
dispatcher, Script Properties, and every unrelated source file. In particular,
preserve `BIRDIE_COIN_SPREADSHEET_ID`. Do not create a new project or a new
web-app deployment.

Before changing anything, record:

- Script ID;
- current production deployment ID and version;
- current web-app URL;
- `clasp deployments` output;
- the downloaded source and manifest.

Clone the exact existing project into a new temporary directory:

```bash
SCRIPT_ID="<authoritative-script-id>"
APPS_DIR="$(mktemp -d)"
cd "$APPS_DIR"
clasp --version
clasp clone-script "$SCRIPT_ID"
clasp pull
clasp list-deployments
clasp show-file-status
```

Confirm the current dispatcher still routes all `coin*` actions to
`handleBirdieCoinAction_` and these three community actions to
`handleCommunityIdentityAction_`:

```text
communityWorkItem
birdieProfiles
updateCommunityIdentityResolution
```

Copy only the three reviewed `.gs` modules from the detached release checkout
into their matching project files:

```text
birdie-os/coin-system.gs
birdie-os/community-identity.gs
birdie-os/social-coin-events.gs
```

Review the complete local diff before pushing. It must add or replace only
those modules; the dispatcher and manifest may be changed only if the exact
routing checks above prove that a route is missing. Then:

```bash
clasp show-file-status
clasp push
clasp create-version "Birdie Agent 2.8.0 TASK-038"
clasp list-versions
clasp list-deployments
```

Record the newly printed immutable version as `NEW_VERSION`, and identify the
already existing production web-app deployment as `DEPLOYMENT_ID`. Update that
deployment in place:

```bash
NEW_VERSION="<new-version-number>"
DEPLOYMENT_ID="<existing-production-deployment-id>"
PREVIOUS_VERSION="<recorded-production-version>"

clasp update-deployment "$DEPLOYMENT_ID" \
  --versionNumber "$NEW_VERSION" \
  --description "Birdie Agent 2.8.0 TASK-038"
clasp list-deployments
```

The deployment ID and web-app URL must be unchanged, and the listed version
must now be `NEW_VERSION`. Do not run `setupBirdieCoinSystem_()` again on an
initialized system.

Run only authenticated, read-only checks against the canonical web-app URL:

- health succeeds;
- `birdieProfiles` succeeds;
- the response contains no secret values;
- `IG_COMMENT` remains `DRAFT` in the Coin Action Catalog.

If any check fails, redeploy the previously recorded version to the exact same
deployment ID:

```bash
clasp update-deployment "$DEPLOYMENT_ID" \
  --versionNumber "$PREVIOUS_VERSION" \
  --description "Rollback TASK-038 Apps Script"
```

Save the Apps Script deployment receipt before continuing: release SHA, Script
ID, unchanged deployment ID and URL, previous and new version, UTC timestamp,
operator, and read-only check results. Do not include keys or secret values.

## 2. Cloud Run second

Known service coordinates:

```text
project: gen-lang-client-0251788487
service: birdie-agent
region: europe-west3
target version: 2.8.0
```

Start again from the clean detached `RELEASE_SHA`. Back up the exact live
service, IAM policy, current traffic, environment-variable names and Secret
Manager references:

```bash
set -euo pipefail

PROJECT_ID="gen-lang-client-0251788487"
SERVICE="birdie-agent"
REGION="europe-west3"
BACKUP_DIR="$(mktemp -d)"

test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"

gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format=export > "$BACKUP_DIR/service-before.yaml"
gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format=json > "$BACKUP_DIR/service-before.json"
gcloud run services get-iam-policy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format=json > "$BACKUP_DIR/iam-before.json"

jq -r '.spec.template.spec.containers[0].env[]?.name' \
  "$BACKUP_DIR/service-before.json" | sort
```

The runtime must preserve at least these configured names and references:

```text
BIRDIE_OS_BASE
OPENAI_API_KEY
BIRDIE_AGENT_API_KEY
BIRDIE_FAMILY_API_KEY
BIRDIE_OS_API_KEY
FRAMER_PROJECT_URL
FRAMER_API_KEY
MAIL_USER
MAIL_PASSWORD
```

Also preserve the service account, ingress, IAM, CPU/memory, concurrency,
timeout, min/max scaling, VPC settings, all additional environment variables,
and every Secret Manager binding. `BIRDIE_OS_BASE` is required at startup;
there is deliberately no source fallback.

Record the exact revision or revisions receiving traffic. This runbook assumes
one revision currently receives 100 percent; stop and preserve the existing
split manually if that is not true:

```bash
OLD_REVISION="$(jq -r '
  .status.traffic[] |
  select((.percent // 0) == 100 and .revisionName != null) |
  .revisionName
' "$BACKUP_DIR/service-before.json")"
test -n "$OLD_REVISION"
test "$(printf '%s\n' "$OLD_REVISION" | wc -l | tr -d ' ')" = "1"

ORIGINAL_TRAFFIC="$(jq -r '
  [.status.traffic[] |
    select((.percent // 0) > 0 and .revisionName != null) |
    "\(.revisionName)=\(.percent)"] |
  join(",")
' "$BACKUP_DIR/service-before.json")"
test -n "$ORIGINAL_TRAFFIC"
```

Deploy the clean source with no production traffic:

```bash
SHORT_SHA="$(git rev-parse --short=8 "$RELEASE_SHA")"
SUFFIX="task038-${SHORT_SHA}"
TAG="$SUFFIX"
NEW_REVISION="${SERVICE}-${SUFFIX}"

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --revision-suffix "$SUFFIX" \
  --tag "$TAG" \
  --no-traffic \
  --quiet
```

Re-read the service and confirm that configuration, IAM and secret references
remain unchanged except for the expected image, revision, tag and deployment
metadata. Resolve the tagged candidate URL:

```bash
gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format=json > "$BACKUP_DIR/service-candidate.json"

TAG_URL="$(jq -r --arg tag "$TAG" '
  .status.traffic[] | select(.tag == $tag) | .url
' "$BACKUP_DIR/service-candidate.json")"
test -n "$TAG_URL"
```

Run only read-only candidate checks. Enter the API key silently and never put
it in chat, a file, shell history, or the deployment receipt:

```bash
read -r -s -p "Birdie Agent API key: " AGENT_TOKEN
printf '\n'

curl -fsS "$TAG_URL/" |
  jq -e '.success == true and .status == "ONLINE" and .version == "2.8.0"'

curl -fsS -H "X-Birdie-Agent-Key: ${AGENT_TOKEN}" \
  "$TAG_URL/health" |
  jq -e '.success == true and .agent == "ONLINE"'

curl -sS -H "X-Birdie-Agent-Key: ${AGENT_TOKEN}" \
  "$TAG_URL/not-found" |
  jq -e '
    .error == "NOT_FOUND" and
    (.routes | index("POST /coin/profiles/{birdieId}/instagram") != null) and
    (.routes | index("POST /community/identity/resolve") != null) and
    (.routes | index("POST /family/mcp") != null) and
    (.routes | index("POST /coin/social-events/{eventId}/instagram-comment/claim") != null) and
    (.routes | index("POST /coin/social-events/{eventId}/instagram-comment/written") != null)
  '
```

If the candidate passes, move traffic by exact revision name. Never use
`LATEST`:

```bash
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --to-revisions="${NEW_REVISION}=10,${OLD_REVISION}=90"

# Repeat the read-only production checks, then complete the rollout.
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --to-revisions="${NEW_REVISION}=100"

unset AGENT_TOKEN
```

Rollback always targets the recorded old revision explicitly:

```bash
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --to-revisions="$ORIGINAL_TRAFFIC"
```

Save the Cloud Run receipt: release SHA, previous and new exact revision,
image digest, unchanged configuration/IAM result, traffic changes, UTC
timestamps, operator, and read-only check results. Do not include secret
values.

## 3. Stop after provider receipts

Provider success does not authorize an economic write. Keep the exact
`IG_COMMENT` rule `DRAFT`. A controlled live E2E additionally requires one
producer-attested `SOCIAL_COIN_EVENTS` event and one exact linked
`COMMUNITY WORK QUEUE` item. At source-review time, no such IG-comment work
item exists, so the E2E remains blocked until that prerequisite arrives and is
read back exactly.
