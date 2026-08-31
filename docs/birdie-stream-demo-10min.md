# Birdie Stream — 10-Minuten-Demo und Clip-Cues

Die Demo ist synthetisch und sichtbar als `DEMO LOOP` markiert. Sie belegt die lokale Ansicht, die Kommunikation der genau sieben Timeline-Zustände und deren synthetische visuelle Voice-Reaktion; sie beweist weder ein reales Mikrofon, eingehendes Audio noch eine echte PC-Aktion. Der Standard-Take ist ein stilles visuelles Programm: Browser-, Desktop- und Operator-Audio bleiben aus.

## 10-Minuten-Ablauf

| Zeit | Operator-Cue | Bild / Gate | Fallback |
| --- | --- | --- | --- |
| 00:00–00:30 | „Diese synthetische UI-Demo zeigt, wie Birdie PC-Steuerung sichtbar und verständlich machen soll.“ | Headline, `DEMO LOOP`, `IDLE`, CTA komplett im Bild; keine echte Aktion behaupten | schwarzer Core: `99_SAFE`, Take stoppen |
| 00:30–01:12 | „Hier zeigt der synthetische UI-Loop die vorgesehenen Voice-Zustände; das ist kein Live-Mikrofontest.“ | Voice-Wave und Timeline-Zustände beobachten | `ERRORS > 0`: `99_SAFE`, Take stoppen |
| 01:12–02:24 | ersten vollen Loop ohne Eingriff laufen lassen | Loop-Zähler `01`, dann `02`; alle sieben Timeline-Zustände in der definierten Reihenfolge | falsche Reihenfolge: Take stoppen |
| 02:24–03:30 | lokale/living-topography Story erzählen | `LISTENING`, `THINKING`, `SPEAKING` klar unterscheidbar | FPS High unter Gate: `99_SAFE`, Take stoppen |
| 03:30–04:30 | CTA erklären, aber Draft-Grenze nennen | `DRAFT CTA` und URL lesbar | QR fehlt: niemals Scan behaupten |
| 04:30–05:30 | Static-Pfad als ungeprüften Notpfad erklären | nur nach sichtbarer Operator-Vorschau einmal zu `02_STREAM_BACKUP`; Label `STATIC BACKUP`, `RAF` ist kein Renderer-FPS-Beleg | jedes Artefakt oder fehlende Vorschau: `99_SAFE` |
| 05:30–06:30 | zurück zur Hauptszene | Cut auf `01_STREAM`, kein Reload, State läuft weiter | schwarzer Frame: `99_SAFE`, Take stoppen |
| 06:30–07:30 | 30-/60-Sekunden-Cut erklären | Cues unten verwenden, nichts veröffentlichen | Timing unklar: kein Clip-Claim |
| 07:30–08:30 | lokale Browser-Evidence öffnen oder vorlesen | Startup, Renderer-FPS, p95, Errors, Loopzahl; noch kein OBS-/MKV-Beleg | Evidence `STOP`: Take stoppen |
| 08:30–09:15 | Datenschutz und Not-Aus zeigen | `99_SAFE`, Mikrofon aus, dann zurück | Hotkey fehlt: Founder STOP |
| 09:15–10:00 | Paid-Pilot-CTA und ehrliche Grenze | genau ein Angebot, keine Live-Behauptung | CTA noch Draft: nur private Produktdemo |

## 30-Sekunden-Clip

URL für eine eigene OBS-Browserquelle:

```text
http://127.0.0.1:1421/?mode=stream&demo=loop&clip=30
```

- 00–04 s: Hook — „Sag es. Birdie macht es.“
- 04–11 s: synthetische Voice-Reaktion und `LISTENING`; keine Spracherkennung behaupten.
- 11–20 s: Denken und Antwort.
- 20–24 s: erfolgreicher Abschluss.
- 24–30 s: CTA-Endcard vollständig stehen lassen.

Der Codevertrag summiert exakt 30.000 ms und beginnt am Loop-Rand wieder bei `IDLE`. Generalprobe `birdie-stream-rehearsal-20260830T050017Z` aktivierte die refresh-on-activate-Quelle in der lokalen OBS-MKV für 30,048 s (`300,174–330,222 s`) und zeigte den erwarteten Startframe. Damit ist das Operator-Timing `PASS`; ein separat exportierter und vollständig privat geprüfter Social-Clip bleibt `UNPROVEN`.

## 60-Sekunden-Clip

```text
http://127.0.0.1:1421/?mode=stream&demo=loop&clip=60
```

- 00–07 s: Produktversprechen und CTA im ersten Frame.
- 07–17 s: synthetischer `SPEECH_DETECTED`-/`LISTENING`-Übergang; keine erkannte Stimme behaupten.
- 17–30 s: Denken und lokale Arbeit.
- 30–44 s: Antwort und Erfolg.
- 44–60 s: Endcard, Paid-Pilot-Angebot und klare Demo-Grenze.

Der Codevertrag summiert exakt 60.000 ms. Generalprobe `birdie-stream-rehearsal-20260830T050017Z` aktivierte die refresh-on-activate-Quelle in der lokalen OBS-MKV für 60,019 s (`330,222–390,241 s`) und zeigte den erwarteten Startframe. Damit ist das Operator-Timing `PASS`; ein separat exportierter und vollständig privat geprüfter Social-Clip bleibt `UNPROVEN`.

Für beide Shotlists gilt als Operator-Cue: Quelle erst auf dem Szenenwechsel aktivieren, Startframe visuell bestätigen, während des Clips keine andere Szene oder Quelle anfassen und am Ende hart auf die nächste geprüfte Szene schneiden. Bei schwarzem Frame, `ERRORS > 0`, unlesbarer CTA oder sichtbarem Fremdinhalt sofort auf `99_SAFE` wechseln und den Take verwerfen.

## Operator-Sprache bei Fehlern

- Static-Pfad nach geprüfter Vorschau: „Das ist der statische Demo-Notpfad. Er zeigt synthetische Zustände; seine visuelle Performance ist damit nicht belegt.“
- CTA noch Draft: „Der Conversion-Link wird vor Veröffentlichung Founder-freigegeben; heute zeigen wir nur die lokale Produktdemo.“
- Mikrofon nicht belegt: „Dieser Ablauf ist ein reproduzierbarer UI-Demo-Loop, kein Live-Mikrofontest.“
- Runtime offline: nicht überspielen; zu `99_SAFE` und Take beenden.

## Zehn-Minuten-Soak

Der Soak läuft getrennt vom gesprochenen Ablauf zehn Minuten ohne Szenenwechsel. Ein einzelner grüner 72-Sekunden-Loop ist ausdrücklich kein Soak-Beleg. Akzeptanz: mindestens 600.000 ms, mindestens acht abgeschlossene 72-Sekunden-Loops, alle sieben Zustände der Demo-Timeline in korrekter Reihenfolge beobachtet, `ERRORS 0`, keine Lücke über 1000 ms, keine schwarze Fläche und keine sensiblen Inhalte. Weitere Runtime-/Presence-Zustände sind dadurch nicht abgedeckt.

Lokaler Nachtmissionsstand: High-WebGL lief 615.012 ms mit acht Loops und `ERRORS 0`, verfehlte aber mit einem aktiven Zustands-p10 von 25,7 FPS das 28-FPS-Gate. Low-WebGL lief 612.258 ms mit acht Loops und `ERRORS 0`, verfehlte unter gleichzeitiger systemweiter CPU-Sättigung sowohl den aktiven Zustands-p10 (14,0 statt 24 FPS) als auch das p95-Framezeit-Gate (79,9 statt höchstens 60 ms). Beide Soaks sind deshalb `FAIL`, nicht `PASS`. Der Static-Pfad bleibt visuell/performancebezogen `UNPROVEN`; er darf vor einem Take nur nach einer sauberen Operator-Vorschau verwendet werden und ersetzt kein Soak-Gate.

`window.__birdieStream.getEvidenceJson()` kann nur im Seitenkontext der jeweils geprüften Browser-Instanz ausgelesen werden. Für die OBS Browser Source existiert in diesem Setup kein verifizierter direkter Export. Evidence einer parallelen Browser-Instanz darf daher nicht als Evidence der OBS-Quelle ausgegeben werden. Ein OBS-Soak bleibt `UNPROVEN`, bis lokale Browser-Evidence, OBS-Statistik und MKV-Metadaten getrennt gespeichert und eindeutig demselben Take zugeordnet sind.
