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
- Git

## Drei Startmodi

### 1. Fail-closed ohne Decoder

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1
```

Birdie zeigt Speech Candidates sichtbar an, öffnet aber keinen Turn, solange kein lokaler Gate-STT-Provider konfiguriert ist.

### 2. Unsichere Motion-/Integrationsdemo

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -DevelopmentAutoAccept
```

Dieser Modus akzeptiert jeden qualifizierten Speech Candidate absichtlich automatisch. Er ist ausschließlich für Presence, IPC und Motion gedacht und nicht für Privacy-, Wake-on-Speak- oder Release-Tests.

### 3. Erster echter lokaler Whisper-Test

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -GateSttProvider WhisperCpp `
  -SetupWhisperCpp `
  -GateSttModelName base `
  -GateSttLanguage de
```

Der Befehl richtet den geprüften Source-Stand und das verifizierte mehrsprachige `base`-Modell automatisch ein, baut den nativen Voice Host und startet Desktop, Core und Voice gemeinsam.

Lokale Standardpfade:

```text
third_party/whisper.cpp
models/whisper/ggml-base.bin
```

Beide Verzeichnisse sind in `.gitignore` ausgeschlossen. Der Setup-Helfer verweigert:

- einen nicht offiziellen Source-Origin;
- eine andere als die geprüfte Revision;
- einen schmutzigen Source-Checkout;
- einen Modell-Hash, der nicht zum gepinnten whisper.cpp-Modellkatalog passt.

## Verbindlicher lokaler Voice-Pfad

```text
WASAPI microphone
→ adaptive local VAD
→ voice.activity.started
→ bounded GateSttRequest in Voice RAM
→ one-slot AddressabilityWorker
→ local whisper.cpp IGateStt
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

## Erwartetes Verhalten beim ersten Test

Direkte Ansprache mit ausreichender Evidenz:

```text
IDLE
→ SPEECH_DETECTED
→ lokales Gate-STT
→ ACCEPT
→ LISTENING
```

Unklare Sprache:

```text
IDLE
→ SPEECH_DETECTED
→ lokales Gate-STT
→ ABSTAIN
→ IDLE
```

Erkannte Nicht-Sprache oder starke negative Evidenz:

```text
IDLE
→ SPEECH_DETECTED
→ REJECT
→ IDLE
```

Der erste reale Test validiert damit Mikrofon, VAD, lokalen Decoder, Addressability, Core-IPC und Presence. Er validiert noch keine vollständige gesprochene Birdie-Antwort.

## Launcher-Parameter für Gate-STT

| Parameter | Wirkung |
| --- | --- |
| `-GateSttProvider WhisperCpp` | aktiviert den lokalen nativen Decoder |
| `-SetupWhisperCpp` | richtet geprüften Source und Modell automatisch ein |
| `-GateSttModelName base` | wählt das verifizierte Modell; `base` ist der erste Teststandard |
| `-GateSttLanguage de` | priorisiert Deutsch |
| `-GateSttThreads 4` | setzt die lokalen Inferenz-Threads |
| `-GateSttCpuOnly` | deaktiviert GPU-/Flash-Attention-Nutzung |
| `-SkipVoiceBuild` | verwendet einen bereits gebauten passenden Voice Host |

`DevelopmentAutoAccept` und der echte Whisper-Provider dürfen nicht kombiniert werden.

## Environment-Schalter

| Variable | Wirkung |
| --- | --- |
| `BIRDIE_VOICE_EXE` | expliziter Pfad zu `birdie-voice-host.exe` |
| `BIRDIE_MANAGE_CORE=0` | Core-Supervision abschalten |
| `BIRDIE_MANAGE_VOICE=0` | Voice-Supervision abschalten |
| `BIRDIE_CORE_PROGRAM` | anderes Core-Programm statt `node` |
| `BIRDIE_CORE_SCRIPT` | anderes Core-Entry-Script |
| `BIRDIE_DEV_AUTO_ACCEPT=1` | unsicheren Development-Auto-Accept aktivieren |
| `BIRDIE_GATE_STT_PROVIDER` | lokalen Gate-STT-Provider wählen |
| `BIRDIE_GATE_STT_MODEL` | absoluten lokalen Modellpfad setzen |
| `BIRDIE_GATE_STT_LANGUAGE` | Gate-Sprache setzen, beispielsweise `de` oder `auto` |
| `BIRDIE_GATE_STT_THREADS` | lokale Decoder-Threads setzen |
| `BIRDIE_ENABLE_DEV_SUPERVISOR=1` | Dev-Supervisor in einem Release-Build explizit erlauben |

## Aktuelle Grenze

Implementiert sind lokaler Transport, WASAPI, VAD-/Candidate-Flow, `whisper.cpp`-Provider, reproduzierbares Source-/Modell-Setup, asynchrone Evidence Pipeline, ACCEPT/REJECT/ABSTAIN, State-Projektion, Presence-Rendering und Prozessintegration.

Noch nicht implementiert beziehungsweise noch nicht produktionskalibriert sind:

- deutsches Realwelt-Testkorpus und kalibrierte Schwellenwerte;
- eigenes kommerziell freigegebenes „Hey Birdie“-Wake-Word-Modell;
- Medien-/Loopback-Korrelation;
- Overlap-/Mehrsprecher-Erkennung;
- optionaler Speaker-Verifier;
- strukturierte Follow-up-Fenster aus Birdie Core;
- vollständige Brain-/TTS-Antwort nach einem akzeptierten Turn;
- produktionsreife AEC-basierte Full-Duplex-Unterbrechung.
