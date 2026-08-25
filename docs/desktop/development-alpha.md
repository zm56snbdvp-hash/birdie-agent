# Birdie Desktop Alpha – lokaler Entwicklungsstart

Birdie Desktop läuft auf dem normalen Windows 11. Der Desktop-Host beaufsichtigt im Entwicklungsmodus zwei lokale Prozesse:

- `birdie-core`: kanonischer Runtime- und Presence-State über `\\.\pipe\birdie.core.control.v1`
- `birdie-voice-host`: WASAPI Capture, lokaler Speech Candidate, Voice Events und Audioausgabe

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

## Development Wake Demo

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-birdie-desktop-alpha.ps1 -DevelopmentAutoAccept
```

`DevelopmentAutoAccept` ist ausschließlich für den visuellen End-to-End-Loop. In diesem Modus kann jeder qualifizierende Sprachkandidat als an Birdie gerichtet gelten. Der Launcher zeigt deshalb einen Privacy-Warnhinweis.

Der Modus ist **nicht** für Privacy-, DDSD- oder False-Accept-Tests zugelassen.

## Verbindlicher Live-Pfad

```text
WASAPI microphone
→ birdie-voice-host
→ runtime.event.publish
→ Birdie Core named pipe
→ canonical Presence projector
→ runtime.presence.changed
→ Tauri bridge
→ Birdie Presence renderer
```

Normaler Alpha-Trace:

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

Der lokale Transport, VAD-/Candidate-Flow, State-Projektion, Presence-Rendering und die Prozessintegration sind implementiert. Hochwertige lokale Gate-STT, Wake-Word-Modell und DDSD-Fusionsentscheidung werden als nächste Voice-Schicht ergänzt. Bis dahin ist `DevelopmentAutoAccept` nur eine ausdrücklich markierte Integrationshilfe, keine fertige Adressatenerkennung.
