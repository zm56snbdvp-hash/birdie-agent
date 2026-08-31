# Birdie Stream Rehearsal Evidence

Evidence-ID: `stream-rehearsal-birdie-stream-show-15min-v1`

Scope: `LOCAL_SYNTHETIC_REHEARSAL` · External actions: `LOCKED`

Report-Erzeugungszeit: **UNKNOWN** (`OMITTED_FOR_DETERMINISTIC_REPLAY`). Vergleichs-Input: `birdie-stream-launch-console-20260830T083657Z`, erfasst `2026-08-30T08:36:57.3938576Z`. Dieser historische Input ist kein aktueller Host-/Browserstatus.

## Entscheidungen

- Lokale Pipeline: **PASS**
- Strikter Performance-Regressionsvergleich: **UNKNOWN**
- Deskriptive Gates des historischen Vergleichs-Inputs: **PASS**
- Evidence-Vollständigkeit: **HOLD**
- Beaufsichtigter Live-Test: **STOP**
- Veröffentlichung: **LOCKED**

Die Marker wurden im Modus `SIMULATED` geprüft. Eine synthetische 15-Minuten-Timeline ist kein Echtzeit-Dauernachweis.

## Performance gegen Baseline

Der strikte Vergleich ist nur bei identischer Dauer, Timeline, Producer, Source-Owner, vollständigem Fingerprint und ruhigem Host gültig. Deltas des historischen Report-Inputs sind andernfalls nur deskriptiv; die `current`-Schlüssel in der Tabelle benennen lediglich den Vergleichsslot.

| Gate | Status | Beobachtet | Erwartet |
| --- | --- | --- | --- |
| first-frame | PASS | `{"current":112,"baseline":null}` | current <= 2500; baseline delta intentionally not evaluated |
| fps-p10 | PASS | `{"current":29.7,"baseline":null}` | current >= 28; baseline delta intentionally not evaluated |
| p95-frame | PASS | `{"current":40.1,"baseline":null}` | current <= 55; baseline delta intentionally not evaluated |
| max-frame-gap | PASS | `{"current":40,"baseline":null}` | current <= 1000; baseline delta intentionally not evaluated |
| errors | PASS | `{"current":0,"baseline":null}` | current = 0; baseline delta intentionally not evaluated |
| measurement-mode | PASS | `{"current":"REAL_BROWSER","baseline":"BASELINE_REPLAY"}` | REAL_BROWSER current + real/replayed baseline |
| duration-comparability | UNKNOWN | `{"current":30000,"baseline":601572}` | equal observation duration |
| timeline-comparability | UNKNOWN | `{"current":"CLIP_30","baseline":"LOOP"}` | equal timeline ID |
| producer-comparability | UNKNOWN | `{"current":"OPERATOR_IFRAME","baseline":"PARALLEL_LOCAL_BROWSER"}` | equal producer ID |
| source-owner-comparability | UNKNOWN | `{"current":"OPERATOR_IFRAME","baseline":"DIRECT_PAGE"}` | equal source owner |
| comparison-fingerprint | UNKNOWN | `{"current":null,"baseline":null}` | matching complete comparison fingerprint |
| quiet-host | UNKNOWN | `{"current":"UNKNOWN","baseline":"CONFOUNDED"}` | PASS for both runs |

## Checks

- Szenenvertrag: **PASS**; echte aktuelle OBS-Wechsel: **UNKNOWN**.
- Geplanter Audio-Capture-Vertrag: **PASS**; tatsächliches aktuelles Abhören: **UNKNOWN**.
- Synthetische Voice-Marker: **PASS**; echtes Mikrofon: **UNKNOWN**.
- CTA-Draft sichtbar: **PASS**; Production-Ziel: **STOP**.
- Aktuelle OBS Render-/Encoding-Drops: **UNKNOWN / UNKNOWN**.
- Netzwerk-Drops im lokalen Nicht-Stream: **NOT_APPLICABLE**; für Live: **UNKNOWN**.

## Frühere OBS-Referenz (kein strikter Vergleich)

- Frames: 18503 output / 18506 drawn / 18523 attempted.
- Render-Lag: 17 Frames (918 ppm); Encoding-Skips: 17 Frames (918 ppm).
- Szenen-Cues: 11 PASS, 1 delayed, 2 FAIL; globale SAFE/Stop-Pfade: FAIL/FAIL.
- Audio: 48000 Hz, 2 Kanäle, Mixer-Maximum 0; Decode/Hörprüfung: UNKNOWN/UNKNOWN.

## Explizite UNKNOWNs

- `SHOW_15_REALTIME_DURATION`
- `STRICT_PERFORMANCE_COMPARISON_FINGERPRINT`
- `STRICT_PERFORMANCE_MATCHED_TIMELINE`
- `QUIET_HOST_CURRENT`
- `OBS_RENDER_DROPPED_FRAMES_CURRENT`
- `OBS_ENCODING_DROPPED_FRAMES_CURRENT`
- `NETWORK_DROPPED_FRAMES_LIVE`
- `AUDIO_CONTENT_LISTENING_CURRENT`
- `OBS_SCENE_SWITCHES_CURRENT`
- `REAL_MICROPHONE_CURRENT`
- `CTA_QR_PRODUCTION_CURRENT`

## Shortform-Cues

| Clip | Start | Ende | Länge |
| --- | ---: | ---: | ---: |
| short-01 | 00:15 | 00:45 | 30s |
| short-02 | 01:35 | 02:20 | 45s |
| short-03 | 04:35 | 05:20 | 45s |
| short-04 | 08:55 | 09:40 | 45s |
| short-05 | 12:15 | 13:00 | 45s |

Dieser Report ist lokal und redigiert. Er startet weder OBS noch Aufnahme, Stream, Upload oder Außenaktion.
