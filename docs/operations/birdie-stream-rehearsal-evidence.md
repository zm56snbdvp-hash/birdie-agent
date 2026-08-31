# Birdie Stream — lokale Rehearsal-/Evidence-Pipeline

Diese Pipeline prüft das kanonische 15-Minuten-Show-Skript deterministisch gegen lokale Fixtures und vorhandene redigierte Evidence. Sie startet weder Browser, Birdie, OBS, Aufnahme, Stream, Mikrofon noch eine externe Aktion.

## Genau ein Evidence-Befehl

```powershell
node scripts/run-birdie-stream-rehearsal-evidence.mjs --synthetic --write
```

`--synthetic` ist Pflicht. Ohne dieses Flag bricht das Skript geschlossen ab. `--write` erzeugt ausschließlich zwei lokale, redigierte Dateien:

- `ops/evidence/birdie-stream-rehearsal-pipeline-20260830.json`
- `ops/evidence/birdie-stream-rehearsal-pipeline-20260830.md`

Eingaben sind das Show-Fixture `ops/stream/birdie-stream-show-15min.json`, die vorhandene Generalprobe `birdie-stream-general-rehearsal-20260830.json` und der lokale 30-Sekunden-Console-Take `birdie-stream-launch-console-20260830.json`. Ihre SHA-256-Digests, Evidence-IDs und Capture-Zeiten werden im Report referenziert; lokale absolute Pfade, URLs, Transkripte, freie Fehlertexte und Secrets werden nicht übernommen. Die Wall-Clock-Erzeugungszeit bleibt absichtlich `UNKNOWN/OMITTED_FOR_DETERMINISTIC_REPLAY`, damit serialize→replay und der kanonische Hash reproduzierbar bleiben.

## Was der Lauf belegt

- exakt `900000 ms` geplante Show-Dauer und sechs lückenlose Rollen-Segmente;
- eindeutige, streng monotone Marker für Szene, Audio, Voice, CTA, Clip, Fallback und Operator;
- deterministische serialize/replay-fähige Marker-Fixture mit maximal `250 ms` zulässiger synthetischer Drift;
- genau fünf gebundene Shortform-Clip-Fenster;
- absolute Browser-Gates des historischen 2026-08-30-Vergleichs-Inputs für First Frame, P10-FPS, P95-Framezeit, Max-Gap und Fehlerzahl;
- fail-closed Entscheidungen mit Priorität `STOP > UNKNOWN > PASS` sowie einen kanonischen SHA-256 des Reports.

Ein synthetischer Marker-PASS ist nur ein Vertrags-/Replay-Nachweis. Er ist kein 15-Minuten-Echtzeit-, OBS-, Audio-, Mikrofon-, CTA-, QR- oder Live-Nachweis.

## Strikter Baseline-Vergleich

Ein Regressions-PASS ist ausschließlich erlaubt, wenn beide Läufe denselben vollständigen Vergleichsfingerprint besitzen: Build-/Bundle-Baum, Producer, Source-Owner, Show/Marker/Fixture, Stream-/OBS-/Audio-Konfiguration, Timeline und Dauer, Renderer/Viewport/DPR/FPS, Browser/OS/Hardware/GPU/OBS sowie Clock/Sampler/Cadence/Warm-up. Zusätzlich müssen beide Läufe als ruhiger Host belegt sein.

Die vorhandenen Runs erfüllen das nicht:

- Baseline: `LOOP`, `601572 ms`, parallele direkte Browserinstanz, Host `CONFOUNDED`;
- Report-Vergleichs-Input, erfasst am 2026-08-30: `birdie-stream-launch-console-20260830T083657Z`, `CLIP_30`, `30000 ms`, Operator-iframe, Quiet-Host unbekannt. Er ist kein aktueller Host-/Browserstatus.

Darum sind `258 → 112 ms` First Frame, `26.0 → 29.7 FPS` P10, `50.1 → 40.1 ms` P95 und `710 → 40 ms` Max-Gap nur deskriptive Unterschiede. Der strikte Regression-Status bleibt `UNKNOWN / INCOMPATIBLE`.

## OBS-, Audio- und Szenenreferenz

Die frühere lokale OBS-Aufnahme hatte 17 Render-Lag-Frames aus 18.523 Versuchen (`918 ppm`) und 17 Encoding-Skips aus 18.520 Versuchen (`918 ppm`). Da kein öffentlicher Stream aktiv war, sind Netzwerk-Drops lokal `NOT_APPLICABLE` und für einen späteren Live-Test `UNKNOWN`, nicht null.

Normale Szenen-Cues lagen höchstens `252 ms` neben dem Plan; die 30-/60-Sekunden-Holds dauerten `30048/60019 ms`. Globale SAFE- und Stop-Pfade aus einer anderen App schlugen fehl. Nur OBS-fokussierte Pfade bestanden. Die Aufnahme enthielt einen 48-kHz-Stereo-AAC-Container und null sichtbare Mixerquellen, aber keinen PCM-/Hörnachweis; Audioinhalt und Privacy bleiben `UNKNOWN`.

## Erwarteter Rollup

| Entscheidung | Erwartung |
| --- | --- |
| lokaler Fixture-/Report-Lauf | `PASS` |
| deskriptive Gates des historischen Report-Vergleichs-Inputs | `PASS` |
| strikter Baseline-Regressionsvergleich | `UNKNOWN` |
| Evidence-Vollständigkeit | `HOLD` |
| beaufsichtigter Live-Test | `STOP` |
| Veröffentlichung/Außenaktion | `LOCKED` |

Jede Plan-, Marker- oder absolute Performanceverletzung des eingebundenen Vergleichs-Inputs macht die lokale Pipeline `STOP`. Ein fehlender, veralteter oder inkompatibler Nachweis darf nie zu einem aktuellen Host-/Browser-`PASS` hochgestuft werden.
