# Birdie Stream Mode — 72-Sekunden-Demo

Der Stream Mode ist eine optionale, lokale 16:9-Ansicht. Der normale Desktop-Agent bleibt headless. Der Demo-Loop ist sichtbar als `DEMO LOOP` gekennzeichnet und spielt genau sieben synthetische Timeline-Zustände ab: `IDLE`, `SPEECH_DETECTED`, `LISTENING`, `THINKING`, `SPEAKING`, `SUCCESS` und `WORKING`. Er ist weder eine Liste aller Presence-Zustände noch ein Nachweis für Runtime, Mikrofon oder PC-Aktionen.

## Konfiguration

Die sichtbaren Texte, der CTA-Link und das lokale QR-Bild liegen in `apps/desktop/public/stream-mode.json`. `qrImage` akzeptiert ausschließlich ein inertes lokales PNG/WebP über einen Root-Pfad wie `/assets/birdie-stream-cta.png`. Keine Tokens, Zugangsdaten, persönlichen Pfade oder URLs mit Query-Parametern eintragen. Die kanonische Birdie-&-Breakfast-Landingpage und der SHA-256 des lokal erzeugten QR-Rasters sind konfiguriert; bis zum Scan aus der finalen OBS-MKV bleibt die CTA bewusst `DRAFT`. Die vollständige Freigabefolge steht in [birdie-stream-cta-qr.md](operations/birdie-stream-cta-qr.md).

## Genau ein Startbefehl

```powershell
npm --prefix apps/desktop run stream
```

Vite startet danach ausschließlich den lokalen Server auf Port 1421 und öffnet absichtlich keinen zweiten Browser-Tab. Für OBS die exakt definierte Browser Source mit 1920 × 1080 verwenden. Die Ansicht selbst bleibt immer 16:9 und letterboxt abweichende Fensterformate. Szenen, Audio und Not-Aus stehen im [OBS-Runbook](operations/birdie-stream-obs-runbook.md).

Für die vollständig lokale Generalprobe mit Preflight, getrenntem Live-/Rehearsal-Verdict, 30-/60-Sekunden-Steuerung und redigierter Telemetrie denselben Server unter `http://127.0.0.1:1421/?mode=operator` öffnen. Das [Launch-Console-Runbook](operations/birdie-stream-launch-console.md) ist dafür die Operator-Quelle; die Console startet weder OBS noch eine Außenaktion.

## Reproduzierbarer Ablauf

| Zeit | Bild und Operator-Cue |
| --- | --- |
| 0–8 s | Birdie ist `IDLE`. Headline und Early-Access-CTA zwei Sekunden stehen lassen, dann sagen: „Das ist Birdie — ein lokaler Voice-Agent für deinen PC.“ |
| 8–19 s | `SPEECH_DETECTED` → `LISTENING`. Auf die deutlich ausschlagende Voice-Anzeige zeigen: „Der synthetische UI-Loop zeigt, wie Birdie auf Voice-Zustände reagieren würde; das ist kein Mikrofontest.“ |
| 19–28 s | `THINKING`. Sagen: „Kein stilles Rätselraten: der aktuelle Zustand bleibt live im Bild.“ |
| 28–44 s | `SPEAKING` → `SUCCESS`. Sagen: „Der synthetische Ablauf trennt Antwort- und Erfolgsanzeige klar.“ Das ist kein Beleg für eine ausgeführte PC-Aktion. |
| 44–52 s | Zweiter `IDLE`-Moment. CTA erneut lesbar stehen lassen. |
| 52–66 s | Zweites Kommando: `LISTENING` → `WORKING`. Sagen: „Der Loop zeigt denselben nachvollziehbaren Ablauf reproduzierbar.“ |
| 66–72 s | `SPEAKING`. Abschluss: „Die CTA-Fläche ist als Draft vorbereitet; Link und QR werden erst nach dem finalen MKV-Scan verwendet.“ Solange `qrScanVerified=false` bleibt, wird niemand zum Scannen aufgefordert. |
| ab 72 s | Der Ablauf beginnt störungsfrei wieder bei `IDLE`; der Loop-Zähler springt auf `01`. |

## Operator-Checkliste

- Browser- oder OBS-Fläche auf 1920 × 1080 einstellen; keine Browserleisten, Benachrichtigungen oder andere Fenster mitschneiden.
- CTA-Text, sichtbare URL und optionales QR-Bild vor der Aufnahme prüfen. Solange `DRAFT CTA` oder der `DEMO`-Platzhalter sichtbar ist, weder zum Scannen auffordern noch einen funktionierenden QR behaupten. Erst einen finalen, lokal gehashten QR aus der OBS-MKV mit einem zweiten Gerät prüfen.
- Oben rechts muss `DEMO LOOP` stehen. Dieser eine lokale Startpfad verwendet bewusst keine Tauri-/Mikrofonverbindung und darf nicht als echte Voice-Evidenz bezeichnet werden.
- `START` muss spätestens nach 2500 ms einen Wert zeigen.
- Im 1080p30-High-WebGL-Pfad in allen sieben Zuständen dieser Timeline mindestens 28 tatsächliche Render-FPS erwarten. Das ist keine Aussage über weitere Runtime-/Presence-Zustände. Low-WebGL erwartet mindestens 24 FPS. Der Static-Pfad zeigt nur einen RAF-Heartbeat und bleibt ohne Screenshot-/Pixelbeleg visuell `UNPROVEN`.
- `ERRORS` muss über einen vollständigen 72-Sekunden-Loop bei `0` bleiben.
- Der Loop-Zähler muss nach 72 Sekunden `LOOP 01 / 72S` anzeigen.
- Bei rotem Signalpunkt, fehlendem CTA, `ERRORS > 0`, schwarzem Canvas oder FPS unter den Grenzwerten nicht aufnehmen.

## Messwerte

Die sichtbare Telemetrie misst im WebGL-Pfad die Zeit bis zum ersten tatsächlich erzeugten Birdie-Frame, echte Renderframes pro Sekunde und lokale Seiten-/Runtimefehler. Im Static-Pfad bleibt `START` bewusst unbelegt und `RAF … HZ` ist nur ein Browser-Heartbeat, kein visueller FPS-Beweis. Dieselben Werte sind im Seitenkontext dieser konkreten Browser-Instanz über `window.__birdieStream.getMetrics()` und als JSON über `window.__birdieStream.getEvidenceJson()` verfügbar; es werden keine Diagnosepfade, Transkripte oder Fehlerdetails ins Bild geschrieben. Unterstützt ist das Auslesen in einem lokalen Prüf-Browser per Entwicklerkonsole oder autorisierter lokaler Browser-Automation. OBS stellt für seine Browser Source in diesem Setup keinen verifizierten Evidence-Export bereit: JSON aus einer parallel geöffneten Browser-Instanz belegt weder die konkrete OBS-CEF-Instanz noch MKV-Dauer, OBS-Drops oder Audio. Für einen OBS-Take müssen deshalb Browser-Evidence, OBS-Statistik und MKV-Metadaten getrennt erfasst und manuell demselben Take zugeordnet werden. Ein WebGL-Verlust schaltet sticky auf den statischen Core, bleibt aber als `ERRORS > 0` ein STOP.

Ein grüner 72-Sekunden-Loop ist nur der kurze Demo-Gate-Nachweis. Er ersetzt weder den getrennten 600.000-ms-Soak noch dessen Mindestzahl von acht abgeschlossenen Loops.

## Nächster Cashflow-Schritt

Konfiguriere die CTA-Fläche mit genau einem echten, messbaren Paid-Pilot-Buchungslink.
