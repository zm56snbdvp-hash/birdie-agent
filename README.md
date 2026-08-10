# Birdie Agent

Current service version: **2.1.0**

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

### `GET /briefing`

Returns the current authoritative live briefing from Birdie OS.

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

### `POST /ideas`

Creates an idea in Birdie OS through the controlled write path.

### `POST /tasks/{taskId}`

Updates allowed operational task fields only. The server restricts task writes to a whitelist and contains founder-approval protection for sensitive completion flows.

## Birdie Coin API

Sprint 01 adds an internal, authenticated API for Birdie ID profiles, action claims, the append-only Coin Ledger and Reward Shop reservations. Birdie OS remains the persistent source of truth; Cloud Run validates and routes requests but does not keep an ephemeral balance.

Routes:

- `GET /coin/config`
- `POST /coin/profiles`
- `GET /coin/profiles/{birdieId}`
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

See [`docs/birdie-coin-sprint-01.md`](docs/birdie-coin-sprint-01.md) for Apps Script integration and deployment steps.

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
5. Only then connect the endpoint as the production Chatty/Birdie action.

## Governance

- Birdie OS remains authoritative for live company facts.
- No live data may be invented when the upstream source is unavailable.
- External financial, legal, reputational, or irreversible actions require explicit founder approval.
- Secrets must never be returned in API responses or committed to GitHub.
