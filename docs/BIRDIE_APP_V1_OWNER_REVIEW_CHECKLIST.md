# Birdie App V1 — Owner Review Checklist

Status: owner-review preparation only. No Production deployment or Production data.

## Review target

Branch: `feature/birdie-app-v1-vertical-slice`
PR: #20

The owner-review build must come from the successful GitHub Actions artifact for the exact reviewed head SHA. Do not review an older local export as the acceptance source.

## Desktop / GPU / WebGL

1. App loads without crash on a current GPU-enabled browser.
2. Hotel exterior renders cleanly and does not drop to compatibility mode unexpectedly.
3. Avatar/hotel presentation remains responsive at normal desktop widths.
4. Golf History opens and a round can be selected.
5. Round Detail shows hole-by-hole strokes and only supplied optional putts/penalties.
6. Ball Vault shows the owned sandbox Living Ball.
7. Ball Passport journey preserves PRIVATE/COARSE redaction.
8. Personal Birdie accepts a normal golf question and returns a clearly labeled sandbox answer.
9. Personal Birdie refuses an internal BirdieOS/finance/supplier request.
10. No Production data, auth, wallet, model call, Coin write, object claim/transfer or deployment is triggered.

## iPhone / touch

1. Layout remains usable at mobile width with no horizontal overflow.
2. Golf History round cards are easy to tap.
3. Round Detail remains readable and closable.
4. Ball Vault and Ball Passport remain usable by touch.
5. Personal Birdie input/button remain usable with the software keyboard open.
6. No material text overlap or clipped controls.

## Acceptance record

Record each reviewed head SHA as one of:

- `PASS_OWNER_REVIEW`
- `PASS_WITH_FOLLOWUPS`
- `FAIL_OWNER_REVIEW`

Any visual/product follow-ups should be written as specific issues against the same canonical app lineage. Do not start a second client or repository.

## Gate after owner review

Only after a PASS or explicit Founder decision should the team choose whether to prepare an owner-only hosted checkpoint. A hosted checkpoint is a deployment and remains a separate explicit decision.
