# Birdie Stream — Founder-Karte für einen beaufsichtigten Testlauf

**Aktuelle Entscheidung: `STOP / NO-GO`.** Erlaubt ist nur lokale private Sichtung. Diese Karte autorisiert keinen öffentlichen Stream, Upload, Post, Lead-Kontakt, Kauf, Deployment oder Publish-Schritt.

## Warum der aktuelle Stand STOP ist

| Gate | Evidence | Status |
| --- | --- | --- |
| Browser-Runtime | High-WebGL: voller Loop und null Fehler, aber aktiver P10 bis 23,8 FPS → `STOP`; Low-WebGL nach Auditorfix: 371,7-ms First Frame, P10 ≥29,7 FPS, 40,1-ms P95, 89,9-ms Max-Gap, 0 Fehler | Low-End lokal `PASS`, High `STOP` |
| 15-min Show | Plan/40 Marker/fünf Clips synthetisch replayt; keine Echtzeitdauer | `UNKNOWN` |
| Regression | 30-s Operator-iframe versus 601,572-s Direktbrowser-Loop; Fingerprint/Dauer/Producer verschieden, Baseline-Host `CONFOUNDED` | `UNKNOWN / INCOMPATIBLE` |
| OBS | aktueller echter Preflight im falschen Profil/Collection, 60 statt 30 FPS und Desktop-Audio aktiv; Ausgaben blieben aus | `STOP` |
| Audio | OBS-Geräte-Ingress sichtbar, Kanal gemutet; stabile Aufnahme, AAC-Review, Birdie-STT und Routing nicht belegt | `STOP / UNPROVEN` |
| Voice | UI-Reaktion synthetisch; echter Mic/STT-/Routing-Nachweis fehlt | `UNKNOWN` |
| SAFE/Stop | fokussierter UI-Wechsel zu `99_SAFE` sichtbar; Round-trip enthält Capture-Overhead; globales F11 ohne sichtbaren Zustandswechsel, F12/F10 aktuell unbelegt und historisch fehlgeschlagen | `STOP` |
| CTA/QR | `DRAFT`; kanonisches Ziel, lokales Asset, SHA-256 und Browser-Payload lokal `PASS`; finaler MKV-Scan, Founder-READY und Attribution fehlen | `STOP` |

## Getrennte Autorisierungsscopes

- `15_MIN_OBS_RECORDING=STOP`: Diese Founder-Karte gibt weder eine 15-Minuten-Aufnahme noch OBS, Audio, Mikrofon, private/unlisted Übertragung oder Live frei.
- `CTA_ONLY_LOCAL_BROWSER_E2E=AUTHORIZED_PENDING`: Genau ein neuer, rein lokaler Browser-E2E darf nach Erfüllung der Bedingungen im separaten [CTA-only Authorization-Receipt](../../ops/evidence/birdie-stream-cta-only-authorization-20260831.json) ausgeführt werden.
- Ein CTA-only-Browserlauf kann kein OBS-, Audio-, Mikrofon-, MKV-, Privacy- oder Live-Gate erfüllen und darf diese Karte nicht auf `GO` setzen.

## Founder darf genau einen privaten beaufsichtigten 15-Minuten-/OBS-Test erst auf GO setzen, wenn

- [ ] ein neuer 15-Minuten-Echtzeit-Take exakt dieses Show-Skript mit ausschließlich der OBS-Allowlist ausführt: Birdie Browser Sources sowie die in `00_START`, `09_BRB`, `10_END` und `99_SAFE` vorgesehene inerte `SAFE_SLATE`; keine Monitor-, Fenster-, Game-, Kamera-, Media- oder sonstige Capture-Quelle; außerdem ruhiger Host und vollständiger Vergleichsfingerprint;
- [ ] Startzeit, P10-FPS je Zustand, P95, Max-Gap, Fehler, OBS Render-/Encoding-Drops und Szenenlatenzen take-bezogen alle Gates bestehen;
- [ ] Browser-, OBS- und MKV-Evidence denselben Take-/Build-/Fixture-Hash referenzieren;
- [ ] Audioquellen null bleiben, die finale MKV decodiert und privat abgehört wurde und kein unerwarteter Inhalt vorhanden ist;
- [ ] reale Voice nur dann behauptet wird, wenn Mikrofon/STT/Routing im selben Take bestanden haben; andernfalls bleibt sichtbar `SYNTHETIC VOICE · NO MIC TEST`;
- [ ] SAFE und lokaler Aufnahme-Stop aus einer anderen App in höchstens einer Sekunde zuverlässig funktionieren; das reservierte Stop-Streaming-Hotkey `F9` bleibt unbenutzt;
- [ ] das vorhandene kanonische HTTPS-Ziel, bytegleiche QR-Ziel, lokale Asset-/Payload-Prüfung und der Scan aus der finalen MKV take-bezogen vorliegen; anschließend Founder-READY und eine belegbare Conversion-Strecke freigegeben sind;
- [ ] Datenschutz-Sichtung null Namen, Nachrichten, Pfade, Secrets, Diagnosen oder Fremdinhalte findet.

Ein einziges `STOP`, `FAIL`, `UNKNOWN` oder fehlender Take-Bezug bedeutet weiterhin `STOP`.

## Beaufsichtigter Ablauf und Rollback

1. Öffentliche Outputs, Replay Buffer und Virtual Camera sichtbar aus lassen; nur ausdrücklich autorisierte lokale MKV-Aufnahme verwenden.
2. Bei Privacy-Treffer, schwarzem Bild, falscher Szene, Audioquelle, Error oder Kontrollverlust über die fokussierte OBS-Szenenliste zu `99_SAFE` wechseln.
3. Aufnahme über die sichtbare OBS-Oberfläche stoppen; nicht auf die bisher unzuverlässigen globalen F12/F10-Pfade vertrauen und `F9` nicht drücken.
4. Take `STOP` markieren, Evidence sichern und nicht als Clip verwenden. Kein automatischer Retry.

## Founder-Sign-off

| Feld | Eintrag |
| --- | --- |
| Scope | genau ein privater, beaufsichtigter lokaler 15-Minuten-/OBS-Testlauf; nicht der separat autorisierte CTA-only-Browser-E2E |
| Evidence-ID / Fingerprint | ______________________________ |
| Founder-Entscheidung | `GO` / `STOP` |
| Datum/Uhrzeit | ______________________________ |
| Rollback-Operator bestätigt | ______________________________ |

Ohne vollständig ausgefüllten Sign-off bleibt diese Karte bei `STOP`.
