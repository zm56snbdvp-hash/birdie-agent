# BIRDIE 5 — Canyon v2 Integration Handoff

Stand: 10.09.2026

## Zweck

Diese Ablage ist ausschließlich die Übergabe des BIRDIE-5-Integrations-Scouts für die echte BirdieWorld-Schlag/Karten/Score-App. Sie enthält keine Deployment- oder Produktionsänderung.

## WICHTIG — NEUESTE REIHENFOLGE

1. **`ROUND3_ORIGINAL_DEPLOYED_BUNDLE_MATCH.md` zuerst lesen.** Dort ist jetzt zusätzlich der ungepatchte 59.338-Byte-Gameplay-Bundle mit exakt dem SHA-256 aus dem Recovery-Deployment-Manifest belegt.
2. Danach `ROUND2_RECOVERED_HANDLER.md` für den später gehärteten Founder-Test-Host und die zusätzliche Meter-/Input-Härtung lesen.
3. `INTEGRATIONSPROTOKOLL.md` ist der ursprüngliche Scoutstand; Aussagen wie „v2 fehlt“ oder „Handler nicht identifiziert“ sind historisch und durch Round 2/3 superseded.
4. `QUELLEN.md` bleibt Quellenregister des ersten Scoutlaufs.

## Aktueller Integrationsbefund

Der **historische recovered compiled Shot-Handler ist eindeutig identifiziert**:

`/spiel` → `game-app-D-PPPVPB.js` → `GameApp` (`Xe`) → `kn()` bei `TIMING` → `On()` → genau ein tatsächlicher Engine-Resolve → vorhandene PICK-UP-Normalisierung → Result-/Position-/Stroke-/Remaining-/Lie-State-Commits.

Der ungepatchte Gameplay-Bundle aus `birdie-score-full-recovery.zip` hat SHA-256 `1a3efa0dc9a03ac597b8856fc9c2692071fbbb917b56cae1d3d8f8cb0f42981c` und stimmt exakt mit dem GitHub-Recovery-Manifest überein. Die Engine `game-engine-BHNViZ1-.js` stimmt ebenfalls mit SHA-256 `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b` überein.

Wichtig: Während `PLAN` gibt es zusätzlich eine Engine-Berechnung mit festem Timing 50 für die Ziel-/Flugvorschau. **Diese ist nicht der akzeptierte Shot und darf keinen Canyon-Snapshot auslösen.** Der Canyon-Snapshot gehört nur in `On()` nach dem realen Resolve und der vorhandenen lokalen Result-Normalisierung.

Am Resolve-Punkt sind aktuelle Lochdefinition und Setup-Restdistanz bereits gleichzeitig vorhanden. Eine bestehende autoritative Shot-ID ist dagegen im historischen Bundle nicht belegt; eine rein visuelle Sequence-ID darf nur als Presentation Identity ergänzt werden, sofern der echte Originalworkspace keine bessere Event-ID besitzt.

## Was weiterhin fehlt

Der originale lesbare Next/Vinext/Codex-Sites-Quellbaum und die heutige Live-Revision sind weiterhin **nicht belegt**. Deshalb kein Patch gegen minifiziertes Output und kein Deployment.

Gesucht wird jetzt nur noch die Original-Quelldatei, die sich anhand folgender Strings wiedererkennen lässt:

- `Timing läuft · im goldenen Fenster stoppen`
- `Equipment liegt · 5er-Starthand + 1 Loch-Draw · 5 Aktionskarten bereit`
- `Maximal 9 Schläge · Loch beendet`
- Phasen `PLAN`, `TIMING`, `RESULT`, `HOLE_COMPLETE`

Zusätzlich wird der statische Asset-Source-Ordner / die Vinext-Vite-Sites-Buildkonfiguration benötigt. Der historische Runtime-Host nutzt bereits absolute `/assets/...`-Course-URLs; `/assets/emerald-canyon-v2.webp` passt deshalb zur Runtime-Konvention, aber der maintainable Source-Pfad ist noch nicht belegt.

## Kanonische Ablagen

### Google Drive
Ordner: `Emerald_Canyon_v2__Chat_Birdies / 03_ERGEBNISSE / BIRDIE_5_App_Integration`

- Neuester Detailstand: `00_LATEST_STATUS_HANDLER_FOUND.md`
  - https://drive.google.com/file/d/1snD8pqvnuXoviuTE9S8KYyAUv28s0gJo/view?usp=drivesdk
- ZIP: https://drive.google.com/file/d/1fqjp9gqr5BTDdLIlq3DKe1BIIcPc3ej_/view?usp=drivesdk
- ursprüngliches Integrationsprotokoll: https://drive.google.com/file/d/11oHoDBSZJLai44D3z_B8x4Iy02w1ldKX/view?usp=drivesdk
- Quellenregister: https://drive.google.com/file/d/1B6xkGqKT2rL1My1QpUcmHdj-44am5mZY/view?usp=drivesdk

### GitHub
Repository: `zm56snbdvp-hash/birdie-agent`
Branch: `handoff/birdie5-canyon-v2-integration-20260910`
Pfad: `integration/canyon-v2/`

Der Feature-Branch `feature/birdieworld-course-flight-v1-20260910` und Produktionscode bleiben unverändert.

## Status

`HISTORICAL_DEPLOYED_BUNDLE_MATCHED` · `RECOVERED_HANDLER_IDENTIFIED` · `ORIGINAL_MAINTAINABLE_SOURCE_UNPROVEN` · `CURRENT_LIVE_REVISION_UNPROVEN` · `NO_DEPLOYMENT`.
