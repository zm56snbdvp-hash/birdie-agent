# Birdie Agent

Current service version: **2.6.2**

Production bridge between **ChatGPT / Chatty**, the **Birdie Agent** running on Google Cloud Run, and the authoritative **Birdie OS** backend.

## Architecture

```text
ChatGPT / Chatty
      |
      | HTTPS + BIRDIE_AGENT_API_KEY
      v
Birdie Agent (Cloud Run)
      |
      | BIRDIE_OS_API_KEY
      v
Birdie OS (Google Apps Script)
      |
      v
Authoritative Birdie & Breakfast company data
```

Birdie OS is the source of truth for live company state. The Birdie Agent may phrase and operationalize that data, but it must not invent live company facts.

## Required environment variables

- `OPENAI_API_KEY` — OpenAI API key used by the Birdie Agent.
- `OPENAI_MODEL` — optional; defaults to `gpt-5`.
- `BIRDIE_AGENT_API_KEY` — shared secret used by ChatGPT/clients to authenticate to the Birdie Agent.
- `BIRDIE_OS_API_KEY` — secret used by the Birdie Agent to authenticate to Birdie OS.
- `BIRDIE_OS_BASE` — Birdie OS Google Apps Script Web App URL. A default is currently present in `server.mjs`; production should still set this explicitly in Cloud Run.
- `PORT` — supplied by Cloud Run; defaults to `8080` locally.
- `MAIL_USER` — IONOS mailbox login and enforced sender address.
- `MAIL_PASSWORD` — IONOS mailbox password, supplied only through Secret Manager.
- `MAIL_IMAP_HOST` / `MAIL_IMAP_PORT` — optional; default to `imap.ionos.de:993`.
- `MAIL_SMTP_HOST` / `MAIL_SMTP_PORT` — optional; default to `smtp.ionos.de:465`.
- `MAIL_SIGNATURE_TEXT` / `MAIL_SIGNATURE_HTML` — optional server-side signature overrides. When omitted, Birdie uses Kevin Stroop's standard Founder signature.
- `BIRDIE_OAUTH_ISSUER` — optional Auth0 issuer override; defaults to the Birdie EU tenant.
- `BIRDIE_MCP_RESOURCE` — optional OAuth audience/resource override; defaults to the Cloud Run origin.
- `BIRDIE_OAUTH_JWKS_URL` — optional JWKS endpoint override for tests or a non-standard identity provider.

Never commit real secret values to GitHub.

## HTTP API

All routes except `GET /` require either:

```http
Authorization: Bearer <BIRDIE_AGENT_API_KEY>
```

or:

```http
X-Birdie-Agent-Key: <BIRDIE_AGENT_API_KEY>
```

### `GET /`

Public service status.

### `GET /health`

Checks the Birdie Agent and the upstream Birdie OS connection.

### `GET /startup`

Returns the authenticated Birdie OS health state and current live briefing in one startup-safe response. The response is automatically compacted below the GPT Actions payload limit when the upstream result is unexpectedly large.

### `GET /briefing`

Returns the current authoritative live briefing from Birdie OS. Oversized upstream data is compacted and marked with `truncated: true` instead of failing with `ResponseTooLargeError`.

### `GET /next-task`

Returns the authoritative next task from Birdie OS and a concise Birdie-formatted answer.

### `POST /chat`

Primary Chatty ↔ Birdie communication endpoint.

Request:

```json
{
  "message": "Gib mir meinen nächsten Task"
}
```

Response shape:

```json
{
  "success": true,
  "intent": "NEXT_TASK",
  "source": "BIRDIE_OS",
  "authoritative": true,
  "data": {},
  "answer": "..."
}
```

For general messages the agent loads the current Birdie OS live briefing before generating an answer. For next-task intent it uses the dedicated Birdie OS `nextTask` action and does not substitute another task.

## Chatty MCP Mail Bridge

Version 2.6 exposes a streamable HTTP MCP endpoint at:

```text
https://birdie-agent-893591677320.europe-west3.run.app/mcp
```

It accepts the existing `BIRDIE_AGENT_API_KEY` for trusted direct clients and Auth0 OAuth 2.1 access tokens for ChatGPT Plugins. It exposes these tools:

- `birdie_mail_health`
- `birdie_mail_list`
- `birdie_mail_get`
- `birdie_mail_folders`
- `birdie_mail_update_flags`
- `birdie_mail_move`
- `birdie_mail_send`
- `birdie_mail_delete`

Reading is automatic. Flag updates and folder moves are controlled mailbox changes. Sending requires `founderApproved=true` with the exact `SEND_EMAIL` confirmation. Deletion requires explicit approval and defaults to moving a message to trash; permanent deletion additionally requires the exact `DELETE_PERMANENTLY` confirmation. These checks are enforced by the mail service, not only by the model instructions.

For the ChatGPT desktop app, add the server as a **Streamable HTTP** MCP server and enter the Bearer token through the secure MCP settings UI. Never paste the token into a chat or commit it to the repository. Restart the app after saving the MCP server, then use `/mcp` to confirm that `birdie-mail` is connected.

The server publishes OAuth protected-resource metadata at:

```text
https://birdie-agent-893591677320.europe-west3.run.app/.well-known/oauth-protected-resource
```

Auth0 access tokens are verified against the configured issuer, JWKS signature, resource audience, expiration and per-tool permission. The production Auth0 issuer is `https://dev-dfveukr86fg3e8fr.eu.auth0.com/`; it can be overridden with `BIRDIE_OAUTH_ISSUER`. The canonical resource identifier defaults to the Cloud Run service origin and can be overridden with `BIRDIE_MCP_RESOURCE`.

### Auth0 tenant configuration

1. In **Settings → Advanced**, enable **Resource Parameter Compatibility Profile** and **Client ID Metadata Document Registration**.
2. Create an Auth0 API named `Birdie Mail MCP` with identifier `https://birdie-agent-893591677320.europe-west3.run.app`, signing algorithm `RS256` and the RFC 9068 authorization access-token profile.
3. Add permissions `mail.read`, `mail.write`, `mail.send` and `mail.delete`.
4. Enable RBAC and **Add Permissions in the Access Token** for the API.
5. Create a `Birdie Founder` role, grant all four permissions and assign the role only to the approved Birdie founder account.
6. In the ChatGPT plugin OAuth settings, prefer **Client Identifier Metadata Document (CIMD)**. Never paste an Auth0 password or client secret into chat or the repository.

### `POST /ideas`

Creates an idea in Birdie OS through the controlled write path.

### `POST /tasks/{taskId}`

Updates allowed operational task fields only. The server restricts task writes to a whitelist and contains founder-approval protection for sensitive completion flows.

## Governed Mail API

Version 2.3 adds authenticated IONOS IMAP/SMTP access:

- `GET /mail/health`
- `GET /mail/messages?limit=20&unread=true&mailbox=INBOX`
- `GET /mail/messages/{uid}`
- `GET /mail/messages/{uid}/attachments/{index}`
- `GET /mail/folders`
- `POST /mail/folders/bootstrap`
- `PATCH /mail/messages/{uid}`
- `POST /mail/messages/{uid}/move`
- `DELETE /mail/messages/{uid}`
- `POST /mail/send`

Reading, folder bootstrap, moving and flag updates are authenticated operational actions. Sending and deletion additionally require explicit founder approval in every request:

- send: `{"founderApproved":true,"confirmation":"SEND_EMAIL"}`
- move to trash: `{"founderApproved":true,"confirmation":"MOVE_TO_TRASH"}`
- permanent deletion: `{"founderApproved":true,"confirmation":"DELETE_PERMANENTLY","mode":"permanent"}`

Every successful Birdie SMTP send receives the server-side Birdie & Breakfast signature and is appended as a read MIME copy to the IONOS `\\Sent` mailbox. A failed Sent-copy append is reported separately and never causes an already delivered message to be resent.

The From address is fixed to `MAIL_USER`. Secrets, message bodies and attachment data are never written to repository logs. Action logs contain metadata only.

## Birdie Coin API

Sprint 01 adds an internal, authenticated API for Birdie ID profiles, action claims, the append-only Coin Ledger and Reward Shop reservations. Birdie OS remains the persistent source of truth; Cloud Run validates and routes requests but does not keep an ephemeral balance.

Routes:

- `GET /coin/config`
- `POST /coin/profiles`
- `GET /coin/profiles/{birdieId}`
- `POST /coin/profiles/{birdieId}/instagram`
- `GET /coin/profiles/{birdieId}/ledger`
- `POST /coin/profiles/{birdieId}/badges`
- `POST /coin/claims`
- `POST /coin/claims/{claimId}/decision`
- `GET /coin/rewards?accountType=PRIVATE`
- `GET /coin/admin/queue`
- `POST /coin/redemptions`
- `POST /coin/redemptions/{redemptionId}/decision`
- `POST /coin/opening-balances`

All Coin write requests require an idempotency key. Supporters cannot provide their own point amount. Opening balance migrations additionally require explicit founder approval.

The Instagram route links a normalized, owner-submitted handle to an existing
ACTIVE canonical profile. It never creates a claim, badge, reward, registration
credit or Coin transaction, and it never replaces a different existing handle.

See [`docs/birdie-coin-sprint-01.md`](docs/birdie-coin-sprint-01.md) for Apps Script integration and deployment steps.
Use [`docs/task038-controlled-e2e.md`](docs/task038-controlled-e2e.md) for the
fail-closed deployment and person-bound TASK-038 verification sequence.

## Local run

```bash
npm install
npm start
```

Example health request:

```bash
curl -H "Authorization: Bearer $BIRDIE_AGENT_API_KEY" \
  http://localhost:8080/health
```

Example chat request:

```bash
curl -X POST http://localhost:8080/chat \
  -H "Authorization: Bearer $BIRDIE_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Gib mir meinen nächsten Task"}'
```

## Google Cloud Run

Deploy the repository as the `birdie-agent` service and configure all secrets as Cloud Run environment variables / Secret Manager references. Do not bake secrets into the container image or repository.

After deployment, verify in this order:

1. `GET /` returns `status: ONLINE`.
2. Authenticated `GET /health` reaches Birdie OS successfully.
3. Authenticated `GET /next-task` returns `source: BIRDIE_OS` and `authoritative: true`.
4. Authenticated `POST /chat` successfully handles both a next-task request and a general company-state request.
5. Authenticated MCP initialization at `POST /mcp` lists all eight governed Birdie Mail tools.
6. Only then connect the endpoint as the production Chatty/Birdie MCP server or action.

## Governance

- Birdie OS remains authoritative for live company facts.
- No live data may be invented when the upstream source is unavailable.
- External financial, legal, reputational, or irreversible actions require explicit founder approval.
- Secrets must never be returned in API responses or committed to GitHub.
