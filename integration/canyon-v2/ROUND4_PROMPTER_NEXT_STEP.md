# BIRDIE 5 — Round 4: Prompter next step

Stand: 10.09.2026

## 1. Original maintainable source search

Gezielte Library- und GitHub-Suche nach den eindeutigen UI-/Handler-Strings des historischen `/spiel`-Bundles ergab keine lesbare Original-Next/Vinext/Codex-Sites-Quelldatei.

Gesucht wurde unter anderem nach:

- `Timing läuft · im goldenen Fenster stoppen`
- `Equipment liegt · 5er-Starthand + 1 Loch-Draw · 5 Aktionskarten bereit`
- `Maximal 9 Schläge · Loch beendet`
- gemeinsam `PLAN`, `TIMING`, `RESULT`, `HOLE_COMPLETE`

Gefunden wurden nur Recovery-/QA-/Patch-Artefakte und gebaute Bundles. Damit bleibt der maintainable Originalsource weiterhin **UNPROVEN**. Kein Patch gegen minifiziertes Build-Output erstellen.

## 2. Candidate A ist nicht zu verwerfen

`BirdieWorld_Emerald_Canyon_v3_Candidate_A.zip` ist eine lokale gemeinsame Kandidatin aus BIRDIE 1 + BIRDIE 2.

Sie pinnt `preview/course-canyon-v2.html` unverändert auf SHA-256:

`faef7185a50d6cdbafb57d91b10b4fb854a0e0857a95f3bc9c8a2db474cb09f5`

## 3. BIRDIE 3 ist inzwischen vorhanden und konfliktfrei ergänzbar

Neuer Handoff: `BIRDIE3_Canyon_UI_Handoff.zip`.

BIRDIE 3 ändert laut Handoff ausschließlich `preview/course-canyon-v2.html`.

Seine `source-integrity.json` belegt:

- baseline SHA-256: `faef7185a50d6cdbafb57d91b10b4fb854a0e0857a95f3bc9c8a2db474cb09f5`
- modified SHA-256: `04cf1048537a9a0554795676f3289384ce22df1b8e662b2cafc63055af96f9d0`
- alle Baseline-HTML-IDs erhalten
- nur neue Accessibility-ID `timing-help`
- Runtime-JavaScript-Block byte-identisch zur v2-Basis

Der Baseline-Hash ist exakt derselbe, den Candidate A für diese Datei als unverändert pinnt. Damit liegt **kein Dateikonflikt mit den BIRDIE-1/2-Änderungen in Candidate A** vor.

## 4. Nächster Prompter-Schritt

Der nächste gemeinsame lokale Kandidat sollte deshalb aus:

1. Candidate A (BIRDIE 1 + BIRDIE 2),
2. plus exakt dem freigegebenen BIRDIE-3-Diff auf `preview/course-canyon-v2.html`

gebildet werden.

Danach neu bauen und die vorhandenen Candidate-/Canyon-/Birdie-3-Prüfungen auf **genau dieser neuen gemeinsamen Datei** erneut ausführen. Erst dann BIRDIE 4 zur unabhängigen QA auf diese eindeutige Kandidatenkennung ansetzen.

Nicht Candidate A als final/v3-abgenommen ausgeben; Candidate A entstand vor Eintreffen von BIRDIE 3.

## 5. App-Integration bleibt davon getrennt

Der historische recovered Handler ist inzwischen eindeutig belegt (`/spiel` -> `game-app-D-PPPVPB.js` -> `GameApp/Xe` -> `kn()` TIMING -> `On()` -> einmaliger Engine-Resolve -> PICK-UP-Normalisierung -> State-Commits).

Für Canyon gilt weiterhin:

- niemals die PLAN-Vorsimulation mit Timing 50 verwenden;
- `prepareCourseShot(stableShotId, input, result)` ausschließlich einmal im akzeptierten `On()`-Resolve-Pfad, nach vorhandener Result-Normalisierung;
- Hole und `remainingBefore` aus dem vorhandenen Resolver-Input konservieren;
- keine Gameplay-/Coin-/Round-/Card-Writes aus der Animation;
- keinen zweiten Ball-/Flight-Controller über die bestehende Shot-Visualisierung legen.

Ein maintainable Source-Patch wartet weiterhin auf die Original-Quelldatei, die zu `game-app-D-PPPVPB.js` gebaut wurde, plus deren Asset-/Vinext/Vite/Sites-Buildpfad.

## Status

`BIRDIE3_MERGE_PATH_PROVEN` / `CANDIDATE_A_INTERMEDIATE` / `RECOVERED_HANDLER_IDENTIFIED` / `ORIGINAL_MAINTAINABLE_SOURCE_UNPROVEN` / `NO_DEPLOYMENT`.
