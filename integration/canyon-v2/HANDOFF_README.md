# BIRDIE 5 — Canyon v2 Integration Handoff

Stand: 10.09.2026

## Zweck

Übergabe des BIRDIE-5-Integrations-Scouts für die echte BirdieWorld-Schlag/Karten/Score-App. Keine Deployment- oder Produktionsänderung.

## WICHTIG — NEUESTE REIHENFOLGE

1. **`ROUND4_PROMPTER_NEXT_STEP.md` zuerst lesen.** Dort sind der konfliktfreie BIRDIE-3-Mergepfad auf Candidate A und das Ergebnis der letzten Originalsource-Suche dokumentiert.
2. `ROUND3_ORIGINAL_DEPLOYED_BUNDLE_MATCH.md` lesen: ungepatchter 59.338-Byte-Gameplay-Bundle stimmt exakt mit dem historischen Recovery-Deployment-Manifest überein.
3. `ROUND2_RECOVERED_HANDLER.md` lesen: zusätzlicher später gehärteter Founder-Test-Host und Meter-/Input-Härtung.
4. `INTEGRATIONSPROTOKOLL.md` ist der ursprüngliche Scoutstand; Aussagen wie „v2 fehlt“ oder „Handler nicht identifiziert“ sind historisch und durch Round 2–4 superseded.
5. `QUELLEN.md` bleibt Quellenregister des ersten Scoutlaufs.

## Aktueller Integrationsbefund

Der historische recovered compiled Shot-Handler ist eindeutig identifiziert:

`/spiel` → `game-app-D-PPPVPB.js` → `GameApp` (`Xe`) → `kn()` bei `TIMING` → `On()` → genau ein tatsächlicher Engine-Resolve → vorhandene PICK-UP-Normalisierung → Result-/Position-/Stroke-/Remaining-/Lie-State-Commits.

Der ungepatchte Gameplay-Bundle aus `birdie-score-full-recovery.zip` hat SHA-256 `1a3efa0dc9a03ac597b8856fc9c2692071fbbb917b56cae1d3d8f8cb0f42981c` und stimmt exakt mit dem GitHub-Recovery-Manifest überein. Engine `game-engine-BHNViZ1-.js`: SHA-256 `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`.

Während `PLAN` existiert zusätzlich eine Engine-Vorsimulation mit Timing 50. **Sie ist nicht der akzeptierte Shot und darf keinen Canyon-Snapshot auslösen.** `prepareCourseShot(...)` gehört ausschließlich einmal in `On()` nach dem echten Resolve und der vorhandenen Result-Normalisierung.

Am Resolve-Punkt sind aktuelles Hole und Setup-Restdistanz vorhanden. Eine autoritative Shot-ID ist im historischen Bundle nicht belegt; eine lokale Sequence-ID wäre nur Presentation Identity, falls der Originalworkspace keine echte Event-ID besitzt.

## Gemeinsame Canyon-Kandidatin

`BirdieWorld_Emerald_Canyon_v3_Candidate_A.zip` enthält BIRDIE 1 + 2. BIRDIE 3 traf danach ein.

BIRDIE 3 ändert ausschließlich `preview/course-canyon-v2.html`. Sein Baseline-Hash `faef7185a50d6cdbafb57d91b10b4fb854a0e0857a95f3bc9c8a2db474cb09f5` ist exakt der Hash, den Candidate A für dieselbe Datei als unverändert pinnt. Deshalb ist der Mergepfad konfliktfrei: Candidate A + exakt BIRDIE-3-Diff → neu bauen → gemeinsame Prüfungen → BIRDIE 4 auf genau diese neue Kandidatenkennung ansetzen.

Candidate A nicht als finale gemeinsame v3 ausgeben.

## Was weiterhin fehlt

Die gezielte Library-/GitHub-Suche nach den eindeutigen Originalstrings ergab keine lesbare Original-Next/Vinext/Codex-Sites-Quelldatei. Der maintainable Originalsource und die heutige Live-Revision bleiben unbewiesen. Deshalb kein Patch gegen minifiziertes Output und kein Deployment.

Noch benötigt:

- Original-Quelldatei, die zu `game-app-D-PPPVPB.js` gebaut wurde,
- statischer Asset-Source-/Public-Ordner,
- Vinext/Vite/Sites-Buildkonfiguration.

## Kanonische Ablagen

### Google Drive
`Emerald_Canyon_v2__Chat_Birdies / 03_ERGEBNISSE / BIRDIE_5_App_Integration`

Neuester Prompter-Handoff: `ROUND4_PROMPTER_NEXT_STEP.md`

### GitHub
Repository: `zm56snbdvp-hash/birdie-agent`
Branch: `handoff/birdie5-canyon-v2-integration-20260910`
Pfad: `integration/canyon-v2/`

Feature-Branch und Produktionscode bleiben unverändert.

## Status

`BIRDIE3_MERGE_PATH_PROVEN` · `CANDIDATE_A_INTERMEDIATE` · `HISTORICAL_DEPLOYED_BUNDLE_MATCHED` · `RECOVERED_HANDLER_IDENTIFIED` · `ORIGINAL_MAINTAINABLE_SOURCE_UNPROVEN` · `CURRENT_LIVE_REVISION_UNPROVEN` · `NO_DEPLOYMENT`.
