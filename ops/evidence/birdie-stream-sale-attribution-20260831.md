# Birdie Stream-to-Sale — lokale Attribution Evidence

Scope: `LOCAL_SYNTHETIC_ATTRIBUTION` · External actions: `LOCKED`

- Lokale synthetische Attribution: **PASS**
- Synthetische Baseline-Regression: **PASS**
- Reale View→Sale-Attribution: **UNKNOWN**
- Beaufsichtigter privater Test: **STOP**
- Öffentlicher Stream: **STOP** · Veröffentlichung: **LOCKED**

Showvarianten-Vertrag: **PASS** · Attribution↔Show-Mapping: **PASS**

## Synthetische Funnel

- Baseline: {"eventCount":9,"sessionCount":3,"counts":{"VIEW":3,"CTA":3,"LEAD":2,"SALE":1},"ratesBps":{"ctaPerView":10000,"leadPerCta":6667,"salePerLead":5000,"salePerView":3333},"amountTestCents":4900}
- Current: {"eventCount":10,"sessionCount":3,"counts":{"VIEW":3,"CTA":3,"LEAD":2,"SALE":2},"ratesBps":{"ctaPerView":10000,"leadPerCta":6667,"salePerLead":10000,"salePerView":6667},"amountTestCents":9800}

## Regression (Basispunkte)

| Gate | Baseline | Current | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| cta-per-view | 10000 | 10000 | 0 | PASS |
| lead-per-cta | 6667 | 6667 | 0 | PASS |
| sale-per-lead | 5000 | 10000 | 5000 | PASS |
| sale-per-view | 3333 | 6667 | 3334 | PASS |

## Negative Fixtures

| Fixture | Erwartete erste Verletzung | Beobachtet | Status |
| --- | --- | --- | --- |
| duplicate-event | EVENT_DUPLICATE | EVENT_DUPLICATE | PASS |
| sequence-out-of-order | SEQUENCE_OUT_OF_ORDER | SEQUENCE_OUT_OF_ORDER | PASS |
| event-time-out-of-order | EVENT_TIME_OUT_OF_ORDER | EVENT_TIME_OUT_OF_ORDER | PASS |
| missing-consent | LEAD_CONSENT_MISSING | LEAD_CONSENT_MISSING | PASS |
| session-attribution-drift | SESSION_ATTRIBUTION_DRIFT | SESSION_ATTRIBUTION_DRIFT | PASS |
| sale-without-lead | FUNNEL_STAGE_SKIPPED | FUNNEL_STAGE_SKIPPED | PASS |
| stale-window | ATTRIBUTION_WINDOW_EXPIRED | ATTRIBUTION_WINDOW_EXPIRED | PASS |
| pii-field | EVENT_FIELD_NOT_ALLOWED | EVENT_FIELD_NOT_ALLOWED | PASS |
| external-event | EVENT_EXTERNAL_OR_NON_SYNTHETIC | EVENT_EXTERNAL_OR_NON_SYNTHETIC | PASS |

Alle Events sind synthetisch, redigiert und lokal. Es wurden keine echten Views, Leads, Sales, Zahlungen oder Außenaktionen erzeugt.
