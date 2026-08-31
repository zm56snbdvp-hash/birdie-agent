# Birdie Stream — kanonische 15-Minuten-Rehearsal

Status: **nur lokale, beaufsichtigte Rehearsal; Live/Publish bleibt `STOP`.** Diese Ablaufkarte startet keine öffentliche Übertragung und autorisiert weder Upload, Post, Nachricht, Kauf, Deployment noch irgendeine externe Aktion. Die maschinenlesbare Quelle ist [`ops/stream/birdie-stream-show-15min.json`](../../ops/stream/birdie-stream-show-15min.json).

Der Take dauert exakt `900000 ms` (`15:00.000`). Alle Intervalle sind links geschlossen und rechts offen (`[startMs,endMs)`); nur die letzte Show-Grenze liegt bei `900000 ms`. Die sechs Segmente decken `0..900000 ms` lückenlos und ohne Überlappung ab.

## Unverhandelbarer lokaler Vertrag

- `scope=LOCAL_SYNTHETIC_REHEARSAL`; öffentliche Ausgänge bleiben aus.
- Bildquellen sind ausschließlich die lokalen Szenen aus `ops/obs/birdie-stream-local.scene-plan.json`.
- Der Capture ist still: Browser Audio, Desktop Audio und Operator-Mikrofon sind aus. Die Operator-Copy darf zur Timing-Probe im Raum gelesen werden, wird aber nicht als Stream-Audio aufgezeichnet.
- `SYNTHETIC VOICE` ist nur eine visuelle UI-Fixture. Sie belegt weder Mikrofon, STT, echte Stimme noch eine ausgeführte PC-Aktion.
- SAFE und Stop werden über die fokussierte OBS-Oberfläche bedient. Die außerhalb von OBS fehlgeschlagenen globalen Pfade `F12` und `F10` sind keine Primärsteuerung; das reservierte `F9` wird nicht benutzt.
- Die kanonisch konfigurierte HTTPS-Zieladresse, der `DRAFT`-Status und das lokal gehashte QR-Raster sind vorbereitet; eine frühere read-only Sichtung ist historisch dokumentiert. Aktueller Seiteninhalt, Datenschutz und Erreichbarkeit sind `UNVERIFIED`. Ohne Scan aus der finalen MKV bleibt Conversion `STOP`; niemand fordert zum Scannen auf.
- Fehlende oder widersprüchliche Evidence ist `UNKNOWN` beziehungsweise `STOP`, nie ein ergänztes `PASS`.

## Exakte Segmentrechnung

| Rolle | Zeit | Start–Ende (ms) | Dauer (ms) | Ziel |
| --- | ---: | ---: | ---: | --- |
| `HOOK` | 00:00–01:00 | 0–60000 | 60000 | Nutzen und synthetische Demo-Grenze |
| `SEGMENT_1` | 01:00–04:00 | 60000–240000 | 180000 | Absicht und sieben UI-Zustände |
| `SEGMENT_2` | 04:00–08:00 | 240000–480000 | 240000 | sichtbarer Arbeitsfluss, keine Wirkungsbehauptung |
| `SEGMENT_3` | 08:00–12:00 | 480000–720000 | 240000 | Evidence, SAFE und beaufsichtigte Rückkehr |
| `CTA` | 12:00–14:00 | 720000–840000 | 120000 | Draft-Grenze und spätere Abnahme |
| `CLOSE` | 14:00–15:00 | 840000–900000 | 60000 | Zusammenfassung ohne Live-GO |
| **Summe** | **15:00** | **0–900000** | **900000** | **exakt** |

## Reproduzierbarer Show-Ablauf

Ein monotones lokales Show-Clock-Signal ist die einzige Zeitquelle. Szene und Cue werden zum geplanten Zeitstempel ausgelöst; `actualAtMs` und `deltaMs` werden getrennt protokolliert. Die Copy wird in normalem Tempo gelesen, danach bleibt das angegebene Bild bis zum nächsten Cue stehen. Kein Cue darf durch „Aufholen“ übersprungen werden.

| Showzeit | Szene / Fixture | Kanonische Operator-Copy und Aktion | Evidence / Fallback |
| ---: | --- | --- | --- |
| 00:00 | `00_START` | Show-Clock starten; ausschließlich die stille `SAFE_SLATE` zeigen. | `m001`; falsche Szene = `STOP` |
| 00:03 | Hook | „Sag es. Birdie macht es sichtbar. Heute zeigen wir ausschließlich einen lokalen synthetischen UI-Ablauf: kein Live-Mikrofon, keine echte PC-Aktion und keine öffentliche Übertragung.“ | `m002`; Operator-Voice wird nicht captured |
| 00:06 | Silent check | Mixer visuell prüfen: null aktive Quellen. | `m003`; aktiver Kanal → OBS-UI `99_SAFE`, Take stoppen |
| 00:10 | `01_STREAM` | Hart schneiden. `DEMO LOOP`, Headline und `DRAFT CTA` müssen vollständig lesbar sein. | `m004`; kein paralleler Browserbeleg wird OBS zugeschrieben |
| 00:15–00:45 | `short-01` | Hook-Bild ruhig laufen lassen; keine UI bedienen. | In/Out `15000/45000` |
| 00:45–01:00 | Hook-Hold | „Birdie soll Arbeit nicht verstecken, sondern verständlich machen.“ | `m006` bei Schwarzbild, ERROR oder Fremdinhalt |
| 01:00–01:12 | Segment 1 | „Ein Voice-first Agent braucht verständliche Zustände. Dieser feste Loop zeigt genau diese Oberfläche.“ | `m007` |
| 01:12–01:35 | Synthetic Voice | `SPEECH_DETECTED` und `LISTENING` beobachten. „Das ist eine visuelle Fixture, kein Mikrofontest.“ | `m008`; mic/STT bleiben `NOT_TESTED` |
| 01:35–02:20 | `short-02` | Die Zustandsfolge ohne Eingriff laufen lassen. | In/Out `95000/140000`; falsche Reihenfolge = Clip verwerfen |
| 02:20–03:00 | State story | „IDLE, SPEECH_DETECTED, LISTENING, THINKING, WORKING, SPEAKING und SUCCESS machen den Ablauf lesbar.“ | Silent-Check `m010` bei 02:00 liegt im laufenden Hold |
| 03:00–03:50 | Claim boundary | „Der Loop belegt weder Spracheingabe noch STT noch eine reale PC-Aktion. Er belegt nur die lokale synthetische Darstellung.“ | `m011` |
| 03:50–04:00 | Gate | Reihenfolge und Fehlerzähler bestätigen. | `m012`; Reihenfolge falsch oder `ERRORS>0` → `99_SAFE`/`STOP` |
| 04:00–04:10 | Segment 2 | `01_STREAM` ohne Reload halten. | `m013` |
| 04:10–04:35 | Visible workflow | „Birdie soll nicht unsichtbar handeln. Jeder Schritt bekommt einen lesbaren Zustand.“ | `m014` |
| 04:35–05:20 | `short-03` | `THINKING`/`WORKING` bis synthetischem `SUCCESS` zeigen. | In/Out `275000/320000` |
| 05:20–06:00 | Wirkung ehrlich einordnen | „SUCCESS ist heute ein deterministischer Demo-Endzustand, kein Nachweis einer ausgeführten PC-Aktion.“ | Silent-Check `m016` bei 05:30; Spurinhalt ohne Review `UNKNOWN` |
| 06:00–07:00 | Synthetic success cycle | `SPEAKING` und `SUCCESS` sichtbar halten. | `m017`; Voice-Audio bleibt `NOT_TESTED` |
| 07:00–07:50 | Performance truth | „High-WebGL fiel mit 23,8 FPS p10 am 28-FPS-Gate durch. Low-End CLIP_30 bestand lokal mit mindestens 29,7 FPS am 24-FPS-Gate; ein aktueller Zehn-Minuten-Soak fehlt.“ | `m018`; Modi und Laufdauern niemals vermischen |
| 07:50–08:00 | Gate | Frame, Gap und Fehlerstatus prüfen. | `m019`; neue Störung oder unbekannte Pflichtmetrik → `99_SAFE`/`STOP` |
| 08:00–08:05 | `09_BRB` | Hart auf die stille Slate schneiden. | `m020` |
| 08:05–08:10 | Segment 3 | „Jetzt proben wir Evidence und den sicheren lokalen Bildpfad — keine Live-Freigabe.“ | `m021` |
| 08:10–08:30 | `01_STREAM` | Nur nach sichtbarer Vorschau per OBS UI zurückschneiden. | `m022` |
| 08:30–08:55 | Known unknowns | „Offen sind der FPS-Retest, verlässliche globale SAFE-/Stop-Pfade und der finale Hörtest der AAC-Spur.“ | `m023` |
| 08:55–09:40 | `short-04` | Safety/Evidence-Erklärung im Hauptbild; Clip endet vor dem Drill. | In/Out `535000/580000` |
| 09:40–09:50 | Drill-Vorbereitung | OBS-Szenenliste fokussieren; `F9` nicht betätigen. | `m025` |
| 09:50–10:00 | Countdown | „SAFE wird gleich über die sichtbare Oberfläche geschaltet, nicht als globaler Hotkey-Nachweis.“ | Bei Kontrollverlust bereits jetzt `99_SAFE`/`STOP` |
| 10:00–10:25 | `99_SAFE` | Per OBS-Szenenliste auf `99_SAFE` klicken und 25 Sekunden halten. | `m026`; Umschaltlatenz protokollieren |
| 10:25–10:50 | SAFE-Hold | „Das beweist den beaufsichtigten UI-Pfad. Der globale F12-Pfad bleibt ungeprüft beziehungsweise blockiert.“ | `m027` |
| 10:50–11:30 | `01_STREAM` | Nur nach sauberer Vorschau per OBS UI zurückkehren. | `m028`; bei Artefakt in `99_SAFE` bleiben |
| 11:30–11:50 | Evidence recap | Lokalen Browser, OBS-Ausgabe, Host und Audio als getrennte Evidence-Ebenen benennen. | Fehlende Ebene bleibt `UNKNOWN` |
| 11:50–12:00 | Gate | SAFE- und Restore-Latenz prüfen. | `m029`; über 2000 ms oder keine Bestätigung → `STOP` |
| 12:00–12:05 | CTA-Prüfszene | `05_QR_VERIFY`, `DRAFT CTA`, lokal verifiziertes Raster und `VERIFY ONLY` vollständig zeigen. | `m030`; Link bleibt gesperrt |
| 12:05–12:15 | No-scan open | „Ziel, Asset, Hash und lokaler Payload sind vorbereitet; der QR bleibt Draft. Bitte nicht scannen.“ | `m031` |
| 12:15–13:00 | `short-05` | CTA im Bild lassen; keine URL öffnen und keinen QR scannen. | In/Out `735000/780000`; `m033` bei 12:30 |
| 13:00–13:20 | Offer boundary | „Heute zeigen wir nur die lokale Produktidee, nicht eine funktionierende Conversion-Strecke.“ | `conversionDeclaredReady=false` |
| 13:20–13:50 | Acceptance | „Vor einem öffentlichen CTA brauchen wir noch den Scan aus der finalen MKV, Founder-READY und eine belegbare Conversion-Strecke; Ziel, QR-Target, Raster-Hash und Browser-Payload sind bereits lokal belegt.“ | `m034` |
| 13:50–14:00 | CTA fallback | No-Scan-Copy wiederholen. | `m035`; erwarteter Fallback, solange CTA/QR unready ist |
| 14:00–14:05 | `10_END` | Hart auf die stille End-Slate schneiden. | `m036` |
| 14:05–14:30 | Close | „Damit ist der lokale Ablauf geprobt. Live bleibt STOP, bis Performance, globale Notpfade, finaler Audio-Review und CTA/QR take-bezogen belegt sind.“ | `m037` |
| 14:30–14:50 | End-Hold | `10_END` unverändert halten; keine neue Quelle öffnen. | Finaler Silent-Check `m038` bei 14:30 |
| 14:50–14:59 | Final gate | Bei Privacy- oder Endcard-Fehler per OBS UI zu `99_SAFE`. | `m039` |
| 14:59–15:00 | Exakter Stop | Ein-Sekunden-Cue. Bei `900000 ms` den lokalen Timer beziehungsweise die ausdrücklich autorisierte lokale Aufnahme über die fokussierte UI beenden. | `m040`; `plannedStopMs=900000`, tatsächliche Abweichung separat protokollieren |

## Lokale Fixture- und Marker-Legende

Die JSON-Marker sind die kanonische Reihenfolge. IDs steigen gemeinsam mit `atMs`; die erlaubten `kind`-Werte sind ausschließlich `SCENE`, `AUDIO`, `VOICE`, `CTA`, `CLIP`, `FALLBACK` und `OPERATOR`.

| Fixture-Präfix | Lokaler Vertrag |
| --- | --- |
| `local-scene:` | Szene aus `ops/obs/birdie-stream-local.scene-plan.json`; keine externe Quelle |
| `audio:` | stiller 48-kHz-Stereo-Containervertrag; null Browser-/Desktop-/Mic-Capture; Inhalt ohne Decode-/Listening-Review `UNKNOWN` |
| `voice:` | synthetische visuelle State-Fixture des lokalen Demo-Loops; kein Mic/STT/Voice-Audio |
| `cta:` | lokale Draft-Konfiguration aus `apps/desktop/public/stream-mode.json`; keine Navigation oder Scan-Aktion |
| `clip:` | In/Out-Cue aus der `clips[]`-Liste; noch kein exportierter oder veröffentlichungsfreier Social-Clip |
| `fallback:` | beaufsichtigter OBS-UI-Pfad zu `99_SAFE` oder Take-Stop; globale Hotkeys sind kein vorausgesetzter Beleg |
| `copy:` / `cue:` | gesprochene Timing-Copy beziehungsweise manuelle Operator-Aktion; im stillen Capture nicht enthalten |

## Clip-Cue-Sheet — fünf Shortform-Ausschnitte

Alle fünf Ausschnitte sind lokale Schnittmarken innerhalb desselben 15-Minuten-Takes. Sie sind weder exportiert noch privat endgeprüft noch zur Veröffentlichung freigegeben. Audio bleibt `SILENT_TRACK`; eine spätere Tonspur oder Caption braucht eine eigene Prüfung.

| ID | In–Out | Länge | Hook / Bild | CTA und Fallback |
| --- | ---: | ---: | --- | --- |
| `short-01` | 00:15–00:45 | 30 s | „Sag es. Birdie macht es sichtbar.“; Headline, `DEMO LOOP`, erster Zustandswechsel | kein Scan; Schwarzbild/ERROR/Fremdinhalt → verwerfen |
| `short-02` | 01:35–02:20 | 45 s | sieben verständliche synthetische Zustände | Caption `SYNTHETIC VOICE · NO MIC TEST`; falsche Reihenfolge → verwerfen |
| `short-03` | 04:35–05:20 | 45 s | vom Wunsch über `THINKING/WORKING` zu synthetischem `SUCCESS` | Caption „keine reale PC-Aktion“; unlesbarer Status → verwerfen |
| `short-04` | 08:55–09:40 | 45 s | „Safety vor Show“ und ehrliche Evidence-Grenzen | kein Live-GO; fehlende Kennzahl als `UNKNOWN` |
| `short-05` | 12:15–13:00 | 45 s | sichtbarer `DRAFT CTA` als ehrliche Launch-Grenze | Caption `NICHT SCANNEN`; keine URL-/QR-Aktion |

## Fail-closed Fallback

Jeder Privacy-Treffer, Fremdinhalt, schwarze Frame, unerwartete Quelle, aktive Audioquelle, falsche State-Reihenfolge, `ERRORS>0`, Timingverlust über 2000 ms oder widersprüchliche Pflichtmetrik beendet die Rehearsal als `STOP`:

1. Über die sichtbare, fokussierte OBS-Szenenliste zu `99_SAFE` wechseln und das Bild bestätigen.
2. Öffentliche Ausgänge aus lassen; insbesondere den reservierten Stop-Streaming-Hotkey `F9` nicht betätigen.
3. Einen lokalen Timer oder eine ausdrücklich autorisierte lokale Aufnahme über die fokussierte UI stoppen; nicht auf den außerhalb von OBS fehlgeschlagenen globalen `F10`-Pfad vertrauen.
4. `reasonId`, geplanten und tatsächlichen Zeitpunkt, Methode, Ergebnisbild und alle `UNKNOWN`s protokollieren. Den Take nicht fortsetzen oder als Clip verwenden.

## Bekannter Baseline-Stand — keine Live-Freigabe

Die Generalprobe `birdie-stream-rehearsal-20260830T050017Z` bleibt nur Vergleichskontext:

| Bereich | Baseline | Entscheidung für dieses Skript |
| --- | --- | --- |
| Browser-Performance | High-WebGL p10 bis `23.8 FPS` bei Gate `>=28 FPS`; Low-End CLIP_30 p10 mindestens `29.7 FPS` bei Gate `>=24 FPS` | High-WebGL `STOP`; Low-End kurzer lokaler Lauf `PASS`; aktueller Zehn-Minuten-Soak `UNPROVEN` |
| OBS-Frames | 17 Render-Lag- und 17 Encoding-Skip-Frames, jeweils `0.1%` | nicht null; striktes Zero-Frame-Gate nicht erfüllt |
| Streaming-Drops | öffentliche Übertragung war aus | `UNKNOWN`/nicht anwendbar; keine Zahl erfinden |
| Hotkeys | globales SAFE `F12` und Stop `F10` außerhalb von OBS fehlgeschlagen | nur fokussierter OBS-UI-Pfad für diese Rehearsal |
| Audio | null sichtbare Mixerquellen; AAC-Inhalt nicht separat decodiert/gehört | Capture-Vertrag belegt, Inhalts-/Privacy-Review `UNKNOWN` |
| Voice | synthetische visuelle Reaktion | Mic/STT/echte Voice `NOT_TESTED` |
| CTA/QR | konfigurierte kanonische HTTPS-Zieladresse, `DRAFT`, lokales QR-Asset + Hash; Seiteneigenschaften aktuell `UNVERIFIED`, finaler MKV-Scan fehlt | Conversion und Veröffentlichung `STOP` |

Eine erfolgreiche Ausführung dieses Skripts belegt deshalb höchstens den exakt getakteten, beaufsichtigten lokalen Show-Ablauf. Sie kann den separaten Founder-, OBS-, Audio-, Performance-, Conversion- oder Publish-Gate nicht überstimmen.
