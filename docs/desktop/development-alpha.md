# Birdie Desktop Alpha – lokaler Entwicklungsstart

Birdie Desktop läuft auf einem normalen Windows 11. Der Desktop-Host beaufsichtigt im Entwicklungsmodus zwei lokale Prozesse:

- `birdie-core`: kanonischer Runtime- und Presence-State über `\\.\pipe\birdie.core.control.v1`
- `birdie-voice-host`: WASAPI Capture, Speech Candidates, lokale Addressability und Voice Events

## Voraussetzungen

- Windows 11 x64
- Node.js 22+
- npm
- Rust stable
- CMake 3.24+
- Visual Studio 2022 C++ Build Tools
- WebView2 Runtime

## Ein Befehl

Im Repository-Root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-birdie-desktop-alpha.ps1
```

Der Launcher:

1. baut `birdie-voice-host.exe`,
2. setzt den expliziten Voice-Binary-Pfad,
3. startet Tauri,
4. lässt Tauri `birdie-core` und `birdie-voice` beaufsichtigen,
5. beendet beide Child-Prozesse beim expliziten Birdie-Quit.

## Verbindlicher lokaler Voice-Pfad

```text
WASAPI microphone
→ adaptive local VAD
→ voice.activity.started
→ bounded GateSttRequest in Voice RAM
→ one-slot AddressabilityWorker
→ local IGateStt boundary
→ transcript-derived + acoustic evidence
→ ACCEPT / REJECT / ABSTAIN
→ VoiceHost lifecycle event
→ Birdie Core named pipe
→ canonical Presence projector
→ Tauri bridge
→ Birdie Presence renderer
```

Privacy-Grenzen:

- Der WASAPI-Callback führt keinen STT-Decoder aus.
- Gate-STT läuft ausschließlich im lokalen Voice-Worker.
- Roh-PCM wird weder an Birdie Core noch an Tauri übertragen.
- Das Gate-Transkript verlässt die Evidence Pipeline nicht und wird weder geloggt noch als Runtime-Event veröffentlicht.
- Gate-Audio und Gate-Transkript werden vor der Freigabe ihrer lokalen Buffer überschrieben.
- Die Workerqueue enthält höchstens einen wartenden Kandidaten; ein älterer wartender Kandidat wird vor dem Ersetzen gelöscht.
- Verspätete Ergebnisse können wegen der Activity-ID keinen neueren Kandidaten aktivieren.
- Mute, Capture-Fehler und Shutdown sperren neue Entscheidungen und löschen wartendes Gate-Audio.

## Verhalten ohne lokales Decoder-Modell

Die Pipeline ist live verdrahtet, aber der standardmäßige Provider ist derzeit `UnavailableGateStt`. Damit gilt im normalen Alpha-Modus:

```text
IDLE
→ SPEECH_DETECTED
→ Gate-STT UNAVAILABLE
→ ABSTAIN
→ IDLE
```

Birdie behauptet also nicht, Sprache verstanden zu haben. Es entsteht kein Turn, keine Antwort und kein Cloud-Upload.

Eine explizite Aktivierung – beispielsweise Klick, Hotkey oder später ein verifiziertes Wake-Word – besitzt einen dokumentierten `BYPASSED`-Pfad und kann ohne Gate-STT akzeptiert werden. Triggerlose Sprache darf diesen Pfad nicht verwenden.

## Development Wake Demo

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-birdie-desktop-alpha.ps1 -DevelopmentAutoAccept
```

`DevelopmentAutoAccept` ist ausschließlich für den visuellen End-to-End-Loop. In diesem Modus kann jeder qualifizierende Sprachkandidat als an Birdie gerichtet gelten. Der Launcher zeigt deshalb einen Privacy-Warnhinweis.

Der Modus ist **nicht** für Privacy-, DDSD-, False-Accept- oder Produktfreigabe-Tests zugelassen.

Mit diesem ausdrücklichen Demo-Bypass kann der bekannte Alpha-Trace dargestellt werden:

```text
IDLE
→ SPEECH_DETECTED
→ LISTENING
→ THINKING
→ SPEAKING
→ IDLE
```

## Environment-Schalter

| Variable | Wirkung |
| --- | --- |
| `BIRDIE_VOICE_EXE` | Expliziter Pfad zu `birdie-voice-host.exe` |
| `BIRDIE_MANAGE_CORE=0` | Core-Supervision abschalten |
| `BIRDIE_MANAGE_VOICE=0` | Voice-Supervision abschalten |
| `BIRDIE_CORE_PROGRAM` | Anderes Core-Programm statt `node` |
| `BIRDIE_CORE_SCRIPT` | Anderes Core-Entry-Script |
| `BIRDIE_DEV_AUTO_ACCEPT=1` | Unsicheren Development-Auto-Accept aktivieren |
| `BIRDIE_ENABLE_DEV_SUPERVISOR=1` | Dev-Supervisor in einem Release-Build explizit erlauben |

## Aktuelle Grenze

Implementiert sind lokaler Transport, WASAPI, VAD-/Candidate-Flow, bounded Gate-STT-Schnittstelle, fail-closed Provider, asynchrone Evidence Pipeline, ACCEPT/REJECT/ABSTAIN, State-Projektion, Presence-Rendering und Prozessintegration.

Noch nicht implementiert beziehungsweise noch nicht produktionskalibriert sind:

- ein tatsächlich transkribierendes lokales Gate-STT-Modell und dessen Lizenz-/Modellpaketierung;
- eigenes kommerziell freigegebenes „Hey Birdie“-Wake-Word-Modell;
- Medien-/Loopback-Korrelation;
- Overlap-/Mehrsprecher-Erkennung;
- optionaler Speaker-Verifier;
- strukturierte Follow-up-Fenster aus Birdie Core;
- deutsches Realwelt-Testkorpus und kalibrierte Schwellenwerte;
- vollständige Brain-/TTS-Antwort nach einem akzeptierten Turn;
- produktionsreife AEC-basierte Full-Duplex-Unterbrechung.
