# Birdie Stream-to-Sale — drei lokale Showvarianten

Diese Datei beschreibt drei exakt fünfzehnminütige, vollständig lokale und synthetische Showvarianten. Die maschinenlesbare Quelle ist `ops/stream/birdie-stream-sale-shows.json`. Sie autorisiert weder eine öffentliche Übertragung noch eine Aufnahme, Veröffentlichung, Nachricht, Buchung, Reservierung oder Zahlung.

## Gemeinsamer Vertrag

- Jede Variante läuft von `0` bis exakt `900000 ms`; Segmente sind lückenlos und überschneiden sich nicht.
- Erlaubt sind ausschließlich die lokalen Szenen `00_START`, `01_STREAM`, `02_STREAM_BACKUP`, `03_CLIP_30`, `04_CLIP_60`, `09_BRB`, `10_END` und `99_SAFE` aus dem Birdie-OBS-Szenenplan.
- Alle Wechsel sind harte lokale Cuts. `99_SAFE` ist die einzige Fehlerszene; nach einem Fehler wird derselbe Take nicht fortgesetzt.
- Jeder Voice-Cue ist `voice:synthetic-ui-loop`: eine deterministische visuelle Zustands-Fixture, kein Mikrofon-, STT-, Runtime- oder Audio-Nachweis.
- Jeder CTA und jedes Offer bleibt `DRAFT` mit `NO_EXTERNAL_ACTION`. Es gibt keine URL, kein Formular, keine Nachricht, keine echten Konditionen und keine Zahlungszusage.
- `LOCAL_INTEREST_SIGNAL_ONLY` beschreibt nur die spätere Funnel-Position. Im heutigen Fixture wird weder ein Lead erzeugt noch ein Sale behauptet.

Die Segmentrechnung ist für alle drei Varianten identisch:

| Rolle | Showzeit | Millisekunden | Dauer |
| --- | ---: | ---: | ---: |
| `HOOK` | 00:00–01:00 | 0–60000 | 60000 |
| `SEGMENT_1` | 01:00–04:00 | 60000–240000 | 180000 |
| `SEGMENT_2` | 04:00–08:00 | 240000–480000 | 240000 |
| `SEGMENT_3` | 08:00–12:00 | 480000–720000 | 240000 |
| `CTA` | 12:00–14:00 | 720000–840000 | 120000 |
| `CLOSE` | 14:00–15:00 | 840000–900000 | 60000 |
| **Summe** | **15:00** | **0–900000** | **900000** |

## Variante `PRODUCT`

Hook: „Ein Wunsch wird in Birdie zu einem sichtbaren, nachvollziehbaren Arbeitszustand.“ Direkt danach folgt die Grenze: lokale synthetische UI, keine reale Voice-, PC- oder Verkaufswirkung.

| Zeit | Szene / Voice | Showinhalt | CTA-/Offer-Draft |
| ---: | --- | --- | --- |
| 00:00–01:00 | `00_START` → `01_STREAM`; `IDLE` | Produktversprechen und ehrliche Demo-Grenze | Produktidee ansehen / Orientierung |
| 01:00–04:00 | `01_STREAM`; `LISTENING` | Sieben verständliche Zustände statt Black Box | Zustandsführung vormerken / State-Walkthrough |
| 04:00–08:00 | `01_STREAM`; `WORKING` | Von Absicht über Arbeit zum synthetischen `SUCCESS` | Privaten Produkt-Review planen |
| 08:00–12:00 | `09_BRB` → `01_STREAM` → `02_STREAM_BACKUP` → `01_STREAM`; `THINKING` | Evidence, Datenschutz, beaufsichtigter Backup- und SAFE-Vertrag | Safety-Briefing vormerken |
| 12:00–14:00 | `01_STREAM`; `SPEAKING` | Draft-Angebot sichtbar einordnen; keine Navigation oder Anfrage | Beaufsichtigte Produktvorschau anfragen |
| 14:00–15:00 | `10_END`; `SUCCESS` | Nutzen und offene Gates zusammenfassen | Vorschau beendet / keine Conversion-Behauptung |

Clip-Momente:

| ID | In–Out | Bild / Hook |
| --- | ---: | --- |
| `product-clip-01` | 00:15–00:45 | `01_STREAM` · „Ein Wunsch wird sichtbar.“ |
| `product-clip-02` | 01:35–02:20 | `01_STREAM` · „Sieben Zustände statt Black Box.“ |
| `product-clip-03` | 04:35–05:20 | `01_STREAM` · „Vom Wunsch zum sichtbaren Arbeitsstand.“ |
| `product-clip-04` | 08:55–09:40 | `01_STREAM` · „Safety ist Teil des Produkts.“ |
| `product-clip-05` | 12:15–13:00 | `01_STREAM` · „Eine ehrliche Draft-Einladung.“ |

Fail-closed: unerwartete Szene, Privacy-Risiko, aktive Audioquelle, falsche State-Reihenfolge, unbekannte Pflichtperformance oder ein nicht mehr als Draft markierter CTA führen über die fokussierte OBS-Oberfläche zu `99_SAFE`, stoppen den lokalen Take und halten `externalActionCount=0`.

## Variante `APP_DEMO`

Hook: „Birdie zeigt bei jedem Schritt, was die App gerade versteht, plant und darstellt.“ Die Demo behauptet ausdrücklich weder ein funktionierendes Mikrofon noch STT, Runtime-Verbindung oder PC-Steuerung.

| Zeit | Szene / Voice | Showinhalt | CTA-/Offer-Draft |
| ---: | --- | --- | --- |
| 00:00–01:00 | `00_START` → `01_STREAM`; `IDLE` | App-Prinzip und synthetische Grenze | App-Prinzip ansehen / Orientierung |
| 01:00–04:00 | `01_STREAM`; `LISTENING` | Listening, Thinking und Working als lokale visuelle States | State-Tour vormerken |
| 04:00–08:00 | `01_STREAM`; `WORKING` | Lesbarkeit, Reaktionsfolge und synthetischer `SUCCESS` | Beaufsichtigte App-Demo planen |
| 08:00–12:00 | `09_BRB` → `01_STREAM` → `02_STREAM_BACKUP` → `01_STREAM`; `THINKING` | Error-Grenze, Low-End-Backup und SAFE-Pfad | Readiness-Review vormerken |
| 12:00–14:00 | `01_STREAM`; `SPEAKING` | Private App-Session als Draft, ohne Kontakt- oder Buchungsaktion | Private App-Session anfragen |
| 14:00–15:00 | `10_END`; `SUCCESS` | Demo beenden; Runtime und echte Voice bleiben `UNKNOWN` | App-Demo beendet / keine Conversion-Behauptung |

Clip-Momente:

| ID | In–Out | Bild / Hook |
| --- | ---: | --- |
| `app-demo-clip-01` | 00:15–00:45 | `01_STREAM` · „Eine App, die ihren Zustand zeigt.“ |
| `app-demo-clip-02` | 01:35–02:20 | `01_STREAM` · „Listening ohne Voice-Behauptung.“ |
| `app-demo-clip-03` | 04:35–05:20 | `01_STREAM` · „Thinking und Working werden lesbar.“ |
| `app-demo-clip-04` | 09:45–10:30 | `02_STREAM_BACKUP` · „Fallback statt schwarzem Bild.“ |
| `app-demo-clip-05` | 12:15–13:00 | `01_STREAM` · „Private App-Demo, ehrlich als Draft.“ |

Fail-closed: zusätzlich zu Bild-, Audio- und Privacy-Fehlern beendet jede unbelegte Runtime- oder Voice-Behauptung den Take. Der Operator schaltet per fokussierter OBS-Oberfläche auf `99_SAFE`, stoppt lokal und beginnt bei Bedarf einen neuen Take von `00_START`.

## Variante `BIRDIEWORLD_HOTEL`

Hook: „Eine ruhige Ankunft, ein sichtbarer Wunsch und Birdie als lokaler Begleiter durch eine Hotelidee.“ Die Variante ist nur eine Konzeptreise: keine reale Unterkunft, Verfügbarkeit, Reservierung, Gästedaten oder Zahlungszusage.

| Zeit | Szene / Voice | Showinhalt | CTA-/Offer-Draft |
| ---: | --- | --- | --- |
| 00:00–01:00 | `00_START` → `01_STREAM`; `IDLE` | Hotelidee eröffnen und Buchungsgrenze nennen | Hotel-Konzept ansehen |
| 01:00–04:00 | `01_STREAM`; `LISTENING` | Fiktive Ankunft und synthetische Wunschaufnahme | Ankunftsreise vormerken |
| 04:00–08:00 | `01_STREAM`; `WORKING` | Personalisierte Tagesidee ohne reale Daten oder Leistungsversprechen | Konzeptreise prüfen |
| 08:00–12:00 | `09_BRB` → `01_STREAM` → `02_STREAM_BACKUP` → `01_STREAM`; `THINKING` | Privatsphäre, Safety und Offline-Fallback | Founder-Konzeptreview vormerken |
| 12:00–14:00 | `01_STREAM`; `SPEAKING` | Privates Konzeptreview als Draft, ohne Buchung oder Kontaktaufnahme | Private Konzeptsession anfragen |
| 14:00–15:00 | `10_END`; `SUCCESS` | Konzeptreise ohne Verfügbarkeits- oder Verkaufszusage schließen | Konzeptreise beendet / keine Conversion-Behauptung |

Clip-Momente:

| ID | In–Out | Bild / Hook |
| --- | ---: | --- |
| `birdieworld-hotel-clip-01` | 00:15–00:45 | `01_STREAM` · „Eine ruhige digitale Ankunft.“ |
| `birdieworld-hotel-clip-02` | 01:35–02:20 | `01_STREAM` · „Ein Wunsch wird zur sichtbaren Konzeptreise.“ |
| `birdieworld-hotel-clip-03` | 04:35–05:20 | `01_STREAM` · „Ein fiktiver Tag, ohne Gästedaten.“ |
| `birdieworld-hotel-clip-04` | 08:55–09:40 | `01_STREAM` · „Privatsphäre vor Hotelmagie.“ |
| `birdieworld-hotel-clip-05` | 12:15–13:00 | `01_STREAM` · „Konzeptinteresse ohne Buchungsdruck.“ |

Fail-closed: sobald reale Gast-/Objektdaten, eine Buchungs-, Verfügbarkeits- oder Zahlungsbehauptung, eine aktive Audioquelle oder ein nicht lokaler CTA erscheint, sofort über die fokussierte OBS-Oberfläche zu `99_SAFE`, lokalen Take stoppen, Grund und `UNKNOWN`s protokollieren und keine Außenaktion auslösen.

## Ehrlicher Teststatus

Die drei Varianten sind strukturell als lokale JSON-Fixtures beschrieben. Sie wurden noch nicht in Echtzeit über fünfzehn Minuten gespielt, nicht in einer OBS-CEF-Instanz ausgeführt, nicht als MKV geprüft und nicht auf Audioinhalt, Szenenlatenz, Dropped Frames oder Operator-Timing vermessen. Die Szene `02_STREAM_BACKUP` ist nur ein geplanter lokaler Cue; ihr realer Wechsel bleibt `UNPROVEN`. Ebenso sind alle CTA-/Offer-Texte reine Drafts ohne Conversion-Funktion.

Bis ein beaufsichtigter privater Take dieselbe Varianten-ID, einen lückenlosen Show-Clock-Trace, OBS-Stats, Audio-/Privacy-Review und einen bestätigten `99_SAFE`-Pfad trägt, lautet die Entscheidung für Live, Publish und Sale unverändert `STOP`.
