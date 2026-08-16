# BirdieWorld Wallet Projection V1

BirdieWorld receives a read-only wallet projection. `COIN_TRANSACTIONS` remains the sole economic authority; displayed balance is the sum of canonical `APPROVED` transaction amounts for exactly one Birdie ID, including approved negative rows. Pending/rejected/other-user rows are excluded.

## Canonical Unity identity boundary
Unity Authentication is a session provider only. After server-side token verification, the immutable Unity Player ID is resolved against the existing canonical `BIRDIE_PROFILES` source. The profile schema may contain the optional exact-link field `unityPlayerId`. Exactly one `ACTIVE` profile must carry the exact Player ID. Zero matches are UNBOUND; duplicate/conflicting matches are a hard failure. Username, email, display name and Instagram handle are never Unity identity keys. Client-supplied `birdieId` is never accepted.

There is no second Unity identity store. `birdie-os/unity-identity.gs` is read-only and returns only `birdieId`, `status` and `unityPlayerId` from `BIRDIE_PROFILES`. If the `unityPlayerId` column does not exist, Unity identity is explicitly reported as not configured and the wallet remains unavailable. No code in this branch adds the column or writes profile values.

## Contract
Schema: `birdieworld-wallet-projection/v1`. Unbound users receive `balanceAvailable=false` and `balance=null` (never substitute zero). Projection authority is `COIN_TRANSACTIONS`, mode `SUM_APPROVED_TRANSACTION_AMOUNTS`, and `readOnly=true`. Exact duplicate transaction replay is idempotent; a reused transaction ID with divergent canonical fields is a hard conflict.

Reserved future self route: `GET /birdieworld/v1/me/wallet`. Before activation it requires server-side Unity token verification, a configured canonical profile link, fresh canonical ledger read, self-owner authorization and cross-user isolation tests. There is no wallet write route.

`BirdieWorldWalletProjection.cs` is a DTO/parser only; it validates schema, read-only status and canonical authority. It never calculates authority or mutates Coins.

## Scope
This work is isolated on `feature/birdieworld-wallet-projection-v1`, branched from PR #32 head. PR #32 remains separate. No Coin award/approval, wallet mutation, redemption change, Production profile mutation, API activation, deployment, merge, payment, quest or progression change is authorized by this contract.
