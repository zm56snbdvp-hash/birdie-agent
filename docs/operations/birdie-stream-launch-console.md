# Birdie Stream Launch Console — lokales Operator-Runbook

Die Launch Console ist ein lokales Cockpit für Generalproben. Sie startet weder OBS noch Aufnahme, Stream, Replay Buffer, Virtual Camera, Tauri, Mikrofon oder eine externe URL. `LIVE / PUBLISH` und `LOCAL REHEARSAL` sind absichtlich getrennte Entscheidungen: Eine grüne lokale Sequenz kann den roten Live-Status niemals überstimmen.

## Genau ein Startbefehl

```powershell
npm --prefix apps/desktop run stream
```

Danach ausschließlich lokal öffnen:

```text
http://127.0.0.1:1421/?mode=operator
```

Der bereits dokumentierte Stream-Startpfad bleibt damit unverändert. Die Console läuft im neuen `mode=operator`; die bestehende `mode=stream`-Ansicht und der headless Desktop-Default bleiben getrennt.

## Erster Frame: Pflichtsignale

Vor jeder Generalprobe müssen ohne Scrollen sichtbar sein:

- `EXTERNAL ACTIONS LOCKED`.
- `LIVE / PUBLISH STOP`, solange mindestens ein echter Launch-Blocker besteht.
- sechs Preflight-Zeilen: Bild/Performance, Audio, Voice, CTA/QR, Datenschutz und Fallback/SAFE.
- `LOCAL HOLD`, bis ein vollständiger lokaler Clip gemessen wurde.
- `LOCAL PREVIEW · NOT OBS EVIDENCE` über der eingebetteten same-origin Vorschau.
- `SYNTHETIC VOICE · NO MIC TEST` und `STREAMING OFF` in der Fußzeile.

Der aktuelle Runtime-Status ist ehrlich `STOP`:

1. High-WebGL fiel mit 23,8 FPS p10 am 28-FPS-Gate durch. Low-End CLIP_30 bestand lokal mit mindestens 29,7 FPS am 24-FPS-Gate; ein aktueller Zehn-Minuten-Soak fehlt weiterhin.
2. CTA bleibt Draft: Ziel, lokales QR-Asset, SHA-256 und Browser-Payload sind lokal belegt; finaler MKV-Scan, Founder-READY und eine belegbare Conversion-Strecke fehlen.
3. Globale SAFE-/Stop-Hotkeys waren aus einer anderen App nicht zuverlässig.
4. Die stumme AAC-Spur wurde noch nicht final abgehört.
5. Voice ist in diesem Cockpit ausschließlich synthetisch; es ist kein Mikrofontest.

## Bedienung

1. `30 S STARTEN` oder `60 S STARTEN` startet mit genau einem Klick eine frische lokale Stream-Preview im gewählten Echtzeit-Preset. Ein zweiter Start während eines Laufs wird ignoriert; es entsteht keine zweite Timerkette.
2. Während des Laufs bleibt `LOCAL HOLD`. Zeitcode, Playhead und die aus dem bestehenden Stream-Vertrag abgeleiteten Marken bewegen sich in Echtzeit.
3. Erst an der echten 30.000-/60.000-ms-Grenze werden Preview-Metriken eingefroren. `LOCAL GO` ist nur möglich, wenn Startup, 16:9, Zustandsabdeckung, zustandsbezogene P10-FPS, Frame-Gap, Loop-Grenze und Fehlerzahl ausreichend belegt sind.
4. `FALLBACK` lädt ausschließlich die lokale statische Backup-Preview. Deren RAF-Heartbeat ist kein Renderer-FPS-Beleg.
5. `ERROR TEST` lädt die vorhandene synthetische Error-Fixture. Der erwartete allowlistete Fehlercode muss `LOCAL STOP` auslösen.
6. `LOCAL SAFE` beendet nur die lokale Preview und zeigt einen neutralen Safe-Slate. Die Taste steuert OBS und Windows ausdrücklich nicht.

### Kanonische Clip-Marken

| 30-Sekunden-Clip | Zustand |
| ---: | --- |
| 00:00 | IDLE |
| 00:04 | SPEECH_DETECTED |
| 00:06 | LISTENING |
| 00:11 | THINKING |
| 00:15 | SPEAKING |
| 00:20 | SUCCESS |
| 00:24 | IDLE |
| 00:30 | COMPLETE |

| 60-Sekunden-Clip | Zustand |
| ---: | --- |
| 00:00 | IDLE |
| 00:07 | SPEECH_DETECTED |
| 00:10 | LISTENING |
| 00:17 | THINKING |
| 00:24 | WORKING |
| 00:30 | SPEAKING |
| 00:38 | SUCCESS |
| 00:44 | IDLE |
| 01:00 | COMPLETE |

## Preflight- und Entscheidungsvertrag

Die Priorität ist immer `STOP > HOLD > GO`.

- `STOP`: harter Safety-, Datenschutz-, Output-, Auflösungs-, Performance-, Fehler- oder Vertragsbruch.
- `HOLD`: sicherer lokaler Zustand, aber der erforderliche Nachweis fehlt oder der Echtzeit-Lauf ist noch nicht vollständig.
- `GO`: alle Gates des ausdrücklich benannten lokalen Rehearsal-Scopes sind belegt.

Unbekannte Gates, Statuswerte oder widersprüchliche Daten fallen geschlossen auf `STOP / PREFLIGHT_INVALID`. Reason-IDs folgen einer festen Reihenfolge und werden dedupliziert. Eine etwaige spätere Live-Freigabe braucht weiterhin die separate Founder-/OBS-Abnahme; die Console kann keine Außenfreigabe erteilen.

## Lokale, redigierte Telemetrie

Sichtbar und exportierbar sind nur eine feste Allowlist:

- Renderer, Quality, Timeline und erlaubte Presence-/Runtime-/Mikrofon-Labels.
- Preview-Viewport, First-Frame-, Config-, FPS-/P10-, P95-, Max-Gap-, Loop- und Heap-Zahlen.
- Fehleranzahl und feste Fehlercodes.
- feste Gate-/Reason-IDs.

Nicht übernommen werden Roh-URLs, Credentials, Query-Strings, Build-Zeitpunkte, lokale Pfade, Transkripte, Diagnosetexte, Stacktraces oder freie Fehlermeldungen. Unbekannte Fehlercodes werden `LOCAL_ERROR`. CPU/GPU-Auslastung und OBS-Drops sind im Browser nicht verlässlich verfügbar und werden deshalb nicht erfunden; sie bleiben Gegenstand einer getrennten OBS-/Host-Evidence.

Die Evidence der konkreten Console-Instanz ist lokal abrufbar:

```js
window.__birdieOperator.getEvidenceJson()
```

Das Schema enthält immer:

```json
{
  "schemaVersion": 1,
  "scope": "LOCAL_SYNTHETIC_REHEARSAL",
  "externalActions": "LOCKED",
  "liveDecision": { "state": "STOP", "reasonIds": [] },
  "preflight": [],
  "rehearsal": {
    "preset": "CLIP_30",
    "state": "COMPLETE",
    "decision": "GO",
    "plannedDurationMs": 30000,
    "clockMode": "REALTIME",
    "markers": []
  },
  "telemetry": {},
  "redaction": { "version": 1, "applied": true }
}
```

`LOCAL PREVIEW`-JSON beweist ausschließlich diese lokale Browser-/iframe-Instanz. Es beweist weder OBS-CEF, OBS-Ausgabe-FPS, Audioinhalt, globale Hotkeys noch MKV-Dauer.

## Screenshot- und Demo-Evidence

Für einen lokalen Take denselben Evidence-Namen für Screenshot und JSON verwenden. Pflichtprüfungen bei 1280 × 720 beziehungsweise 1920 × 1080:

- kein horizontaler oder vertikaler Overflow.
- alle sechs Gates, beide Verdicts, der Lock-Banner, SAFE-Taste, CTA-/QR-Draft-Hinweis und Telemetrie sind ohne Scrollen sichtbar.
- Status wird zusätzlich als Text gezeigt, nie nur durch Farbe.
- keine Browserleiste, Benachrichtigung, Benutzername, Pfad, Roh-URL, Token oder Fehlermeldung im Cockpit.
- Screenshot bei `prefers-reduced-motion` bleibt semantisch identisch.
- JSON enthält `externalActions=LOCKED` und `redaction.applied=true`.

## Not-Aus und Rollback

1. Im Cockpit `LOCAL SAFE` drücken. Das ist nur ein lokaler Preview-Abbruch.
2. Falls parallel eine ausdrücklich autorisierte OBS-Probe läuft, den separaten OBS-Notfallpfad aus dem OBS-Runbook verwenden; das Cockpit steuert ihn nicht.
3. Browser-Tab schließen.
4. Den Vite-Prozess im startenden Terminal mit `Ctrl+C` beenden.
5. Prüfen, dass Port 1421 frei ist. Keine Datei, OBS-Szene oder Außenkonfiguration wird von der Console verändert.

## Weiterführende lokale Evidence

- Das exakte 15-Minuten-Skript und fünf Clip-Cues stehen in [`birdie-stream-show-15min.md`](birdie-stream-show-15min.md).
- Der deterministische Report-Befehl, die strikten Baseline-Regeln und die aktuellen UNKNOWNs stehen in [`birdie-stream-rehearsal-evidence.md`](birdie-stream-rehearsal-evidence.md).
- Die fail-closed Founder-Entscheidung für genau einen beaufsichtigten privaten Testlauf steht in [`birdie-stream-founder-supervised-live-go.md`](birdie-stream-founder-supervised-live-go.md).
