# Birdie Stream-to-Sale — lokaler Attributionsvertrag

Dieser Vertrag modelliert `VIEW → CTA → LEAD → SALE` ausschließlich mit lokalen synthetischen Events. Er erzeugt keine echten Views, Kontakte, Leads, Käufe oder Zahlungen und verwendet weder Netzwerk noch PII. `externalActions=LOCKED` ist unveränderlich.

## Genau ein Testbefehl

```powershell
node scripts/run-birdie-stream-sale-attribution.mjs --synthetic --write
```

Der Befehl liest nur `ops/stream/birdie-stream-attribution-fixtures.json` und `ops/stream/birdie-stream-sale-shows.json`. Er schreibt einen redigierten JSON-/Markdown-Report unter `ops/evidence/`. Ohne `--synthetic` oder bei Fingerprint-Mismatch bricht er geschlossen ab.

## Autorisierungsscope

- `CTA_ONLY_LOCAL_BROWSER_E2E=AUTHORIZED_PENDING`: Genau ein neuer rein lokaler Browserlauf ist unter den Bedingungen des separaten [CTA-only Authorization-Receipts](../../ops/evidence/birdie-stream-cta-only-authorization-20260831.json) noch nicht ausgeführt.
- `15_MIN_OBS_RECORDING=STOP`: OBS-Aufnahme, Audio, Mikrofon, MKV, private/unlisted Übertragung und Live bleiben außerhalb dieser Autorisierung.
- Weder ein synthetischer Attribution-PASS noch der CTA-only-Browserlauf kann ein OBS-, Audio-, Privacy- oder Live-Gate erfüllen.

## Eventvertrag

Jedes Event enthält ausschließlich feste opake IDs, eine globale positive `sequenceId`, monotone lokale Fixture-Zeit, Variant-/Offer-/Campaign-/Segment-ID, `synthetic=true`, `externalAction=LOCKED`, Consent-Status und `amountTestCents`. Zusätzliche Felder — insbesondere Name, E-Mail, Telefon, IP, URL, Payment-ID oder Freitext — sind verboten.

| Event | Vorbedingung | Consent | Wert |
| --- | --- | --- | --- |
| `VIEW` | erster Session-Schritt | `NOT_APPLICABLE` | `0` |
| `CTA` | vorheriger VIEW innerhalb 120 s | `NOT_APPLICABLE` | `0` |
| `LEAD` | vorheriger CTA innerhalb 300 s | `GRANTED` | `0` |
| `SALE` | vorheriger LEAD innerhalb 300 s | geerbtes `GRANTED` | nur klarer synthetischer Testwert |

Ein `SALE`-Fixture ist keine Transaktion. Es gibt keine Währung, Zahlungsinformation oder externe Aktion.

## Attribution und Failure-Semantik

- Event-/Sequence-ID müssen eindeutig und Ereignisse global monoton sein.
- Variant, Offer und Campaign dürfen innerhalb einer Session nicht wechseln.
- Funnel-Stufen dürfen weder übersprungen, gedoppelt noch rückwärts abgespielt werden.
- `LEAD` ohne `GRANTED`, Sale ohne Lead oder ein abgelaufenes Zeitfenster ist `STOP`.
- Nicht gemessene reale Views/Leads/Sales bleiben `UNKNOWN`; synthetische Raten dürfen nie als Nachfrage oder Umsatz ausgegeben werden.
- Negative Fixtures müssen exakt ihre erste erwartete Invariant-Verletzung reproduzieren. Nachträgliches Sortieren oder Reparieren ist verboten.

Das Korpus enthält Minimaltraces für Duplicate, Sequence-/Zeit-Out-of-order, fehlenden Consent, Variant-/Campaign-Drift, Sale ohne Lead, stale Window, PII-Feld und externen Eventpfad.

## Synthetische Baseline

Baseline und Current verwenden denselben kanonischen Schema-/Policy-/Allowlist-Fingerprint und je drei lokale Sessions. Die View-Exposure ist gleich. Baseline endet bei `3 VIEW / 3 CTA / 2 LEAD / 1 SALE`; Current bei `3 / 3 / 2 / 2`. Der automatische Vergleich arbeitet nur in ganzzahligen Basispunkten und erlaubt keine Verschlechterung jenseits der definierten Toleranzen.

Ein synthetischer Regression-PASS bedeutet ausschließlich: derselbe Fixture-Vertrag reproduziert ohne Invariant-Bruch mindestens die Baseline-Raten. Reale Attribution, Demand, Leadqualität, Umsatz und Geld bleiben `UNKNOWN`; der private 15-Minuten-/OBS-Test und jeder öffentliche Stream bleiben `STOP`, bis die separate Founder-Karte unterzeichnet ist. Die ausstehende CTA-only-Autorisierung ändert daran nichts.
