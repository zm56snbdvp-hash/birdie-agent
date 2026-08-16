# BirdieWorld Wallet Projection V1

BirdieWorld receives a read-only wallet projection. `COIN_TRANSACTIONS` remains the sole economic authority; displayed balance is the sum of canonical `APPROVED` transaction amounts for exactly one Birdie ID, including approved negative rows. Pending/rejected/other-user rows are excluded.

## Identity boundary
Unity Authentication is a session provider only. The server must verify the Unity token, derive the immutable Unity Player ID, resolve exactly one explicit ACTIVE Player-ID → Birdie-ID binding, and fail closed for zero/ambiguous/conflicting matches. Username/email/display name are never identity keys and client-supplied `birdieId` is never accepted. This branch creates no new canonical identity store.

## Contract
Schema: `birdieworld-wallet-projection/v1`. Unbound users receive `balanceAvailable=false` and `balance=null` (never substitute zero). Projection authority is `COIN_TRANSACTIONS`, mode `SUM_APPROVED_TRANSACTION_AMOUNTS`, and `readOnly=true`. Exact duplicate transaction replay is idempotent; a reused transaction ID with divergent canonical fields is a hard conflict.

Reserved future self route: `GET /birdieworld/v1/me/wallet`. Before activation it requires server-side Unity token verification, authoritative explicit binding storage, fresh canonical ledger read, self-owner authorization and cross-user isolation tests. There is no wallet write route.

`BirdieWorldWalletProjection.cs` is a DTO/parser only; it validates schema, read-only status and canonical authority. It never calculates authority or mutates Coins.

## Scope
This work is isolated on `feature/birdieworld-wallet-projection-v1`, branched from PR #32 head. PR #32 remains separate. No Coin award/approval, wallet mutation, redemption change, Production identity binding, API activation, deployment, merge, payment, quest or progression change is authorized by this contract.
