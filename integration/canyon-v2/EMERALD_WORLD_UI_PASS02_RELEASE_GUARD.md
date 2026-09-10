# Emerald World UI Pass 02 — Release Guard

Status: SOURCE-ONLY / REVIEW CANDIDATE

This branch is intentionally non-production.

Required before any live integration:
1. locate the maintainable host/router source for `/`, `/scorecard` and `/fortschritt`;
2. mount the exported presentation surfaces without duplicating score, round, Coin or navigation authority;
3. run repository tests plus the Emerald pass-01/pass-02 guards;
4. run browser/mobile interaction QA;
5. preserve existing booster idempotency and card/shot authority;
6. separate explicit merge/deployment approval.

No live deployment or production mutation is authorized by this pass.
