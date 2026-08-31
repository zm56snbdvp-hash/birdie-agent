# Birdie Desktop Alpha – lokaler Entwicklungsstart

Birdie Desktop läuft auf einem normalen Windows 11. Der Desktop-Host beaufsichtigt im Entwicklungsmodus zwei lokale Prozesse:

- `birdie-core`: kanonischer Runtime-, Turn- und Presence-State über `\\.\pipe\birdie.core.control.v1`
- `birdie-voice-host`: WASAPI, Addressability, lokale Transkription und Sprachausgabe

## Voraussetzungen

- Windows 11 x64
- Node.js 22+
- npm
- Rust stable
- CMake 3.24+
- Visual Studio 2022 C++ Build Tools
- WebView2 Runtime
- Git

## Schnellster vollständiger Test

Im Repository-Root:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -FullVoiceDemo
```

`FullVoiceDemo` richtet bei Bedarf den geprüften `whisper.cpp`-Source-Stand und das verifizierte mehrsprachige `base`-Modell ein, baut den nativen Voice Host und aktiviert ausdrücklich:

- echte lokale Whisper-Addressability;
- vollständige lokale Conversation-STT nach `ACCEPT`;
- den deterministischen Development-Brain;
- Windows SAPI als vorläufige Systemstimme.

Sobald Birdie `IDLE` anzeigt, sage klar:

> Birdie, bist du da?

Der erwartete Ablauf ist:

```text
IDLE
→ SPEECH_DETECTED
→ lokales Gate-STT
→ ACCEPT
→ LISTENING
→ Endpoint
→ vollständige lokale Conversation-STT
→ THINKING
→ Development-Brain
→ Windows SAPI
→ SPEAKING
→ IDLE
```

Die hörbare Antwort lautet im deutschen Development-Test:

> Ich bin da. Der lokale Birdie Dialogpfad funktioniert.

Dieser Modus validiert den kompletten lokalen technischen Dialogpfad. Er verwendet noch nicht Birdies finales AI-Brain und noch nicht Kevins finale Birdie-Stimme.

## Weitere Startmodi

### Fail-closed ohne Decoder

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1
```

Birdie zeigt Speech Candidates sichtbar an, öffnet aber keinen Turn, solange kein lokaler Gate-STT-Provider konfiguriert ist.

### Unsichere Motion-/Integrationsdemo

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -DevelopmentAutoAccept
```

Dieser Modus akzeptiert jeden qualifizierten Speech Candidate absichtlich automatisch. Er ist ausschließlich für Presence, IPC und Motion gedacht und nicht für Privacy-, Wake-on-Speak- oder Release-Tests.

### Nur echte lokale Erkennung, ohne Antwort

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-birdie-desktop-alpha.ps1 `
  -GateSttProvider WhisperCpp `
  -SetupWhisperCpp `
  -GateSttModelName base `
  -GateSttLanguage de
```

Dieser Modus validiert Mikrofon, VAD, Whisper, Addressability, Core-IPC und Presence, lässt Brain und TTS aber bewusst deaktiviert.

## Reproduzierbares Whisper-Setup

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

Manuelle Einrichtung:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\setup-birdie-whisper-cpp.ps1 `
  -Model base
```

## Verbindlicher lokaler Voice-Pfad

```text
WASAPI microphone
→ adaptive local VAD
→ bounded GateSttRequest in Voice RAM
→ one-slot AddressabilityWorker
→ local whisper.cpp
→ ACCEPT / REJECT / ABSTAIN
→ accepted utterance endpoint
→ ConversationSttWorker
→ content-classified voice.utterance.finalized
→ Birdie Core TurnCoordinator
→ Brain provider
→ content-classified voice.output.play
→ TtsOutputWorker
→ Windows SAPI
→ voice.output.started / completed
→ canonical Presence projector
→ Tauri Presence renderer
```

## Privacy- und Sicherheitsgrenzen

- Der WASAPI-Callback führt keinen STT-Decoder aus.
- Gate-STT und Conversation-STT laufen ausschließlich in lokalen, begrenzten Workern.
- Roh-PCM wird weder an Birdie Core noch an Tauri übertragen.
- Das kurze Gate-Transkript verlässt die Addressability-Pipeline nicht.
- Erst der ausdrücklich akzeptierte vollständige Nutzerturn wird als `content` an Birdie Core übergeben.
- Transkript- oder Antworttext mit `operational`-Klassifizierung wird abgelehnt.
- Gate- und Conversation-Audio werden nach Verarbeitung überschrieben.
- Verspätete Ergebnisse können wegen Activity- und Turn-ID keinen neueren Turn verändern.
- Mute, Capture-Fehler und Shutdown sperren neue Entscheidungen und löschen wartende Audiodaten.
- Brain und TTS sind standardmäßig deaktiviert und müssen für den Development-Dialog ausdrücklich eingeschaltet werden.
- Barge-in bleibt deaktiviert, bis eine echte AEC-Referenzstrecke existiert.

## Launcher-Parameter

| Parameter | Wirkung |
| --- | --- |
| `-FullVoiceDemo` | richtet den kompletten lokalen Development-Dialog ein |
| `-GateSttProvider WhisperCpp` | aktiviert den lokalen nativen Decoder |
| `-SetupWhisperCpp` | richtet geprüften Source und Modell automatisch ein |
| `-GateSttModelName base` | wählt das verifizierte mehrsprachige Testmodell |
| `-GateSttLanguage de` | priorisiert Deutsch |
| `-GateSttThreads 4` | setzt die lokalen Inferenz-Threads |
| `-GateSttCpuOnly` | deaktiviert GPU-/Flash-Attention-Nutzung |
| `-BrainProvider DevelopmentAck` | aktiviert die deterministische lokale Testantwort |
| `-TtsProvider WindowsSapi` | aktiviert die installierte Windows-Systemstimme |
| `-TtsRate` / `-TtsVolume` | steuert die vorläufige SAPI-Ausgabe |
| `-SkipVoiceBuild` | verwendet einen bereits gebauten passenden Voice Host |

`DevelopmentAutoAccept` und der echte Whisper-Provider dürfen nicht kombiniert werden.

## Aktuelle Grenze

Implementiert und automatisiert getestet sind:

- Desktop Presence und Prozessaufsicht;
- WASAPI und echter Mikrofon-Privacy-State;
- lokale Audio-Reaktion;
- Whisper-basierte Addressability;
- `ACCEPT`, `REJECT` und `ABSTAIN`;
- vollständige lokale Conversation-STT;
- klassifizierter Turn-Transport;
- deterministischer Development-Brain;
- Windows-SAPI-Ausgabe;
- `SPEAKING → IDLE` nach abgeschlossener Ausgabe.

Noch nicht produktionsfertig sind:

- Birdies echtes AI-Brain statt der Development-Bestätigung;
- Kevins finale Birdie-Stimme statt Windows SAPI;
- deutsches Realwelt-Testkorpus und kalibrierte Schwellenwerte;
- eigenes kommerziell freigegebenes „Hey Birdie“-Wake-Word-Modell;
- Medien-/Loopback-Korrelation;
- Overlap-/Mehrsprecher-Erkennung;
- optionaler Speaker-Verifier;
- strukturierte Follow-up-Fenster aus Birdie Core;
- produktionsreife AEC-basierte Full-Duplex-Unterbrechung.
