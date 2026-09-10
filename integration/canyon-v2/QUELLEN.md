# Quellenregister — BIRDIE 5 / Canyon v2

Gelesen am 10.09.2026 über den GitHub-Connector; ausschließlich Lesezugriffe. Alle Dateilinks sind auf Commit `ba8c08e866d2633c7fb9e02e267ad52d38c1850c` fixiert. Git-Blob-IDs wurden vom Connector geliefert, nicht lokal neu berechnet.

## E01 — Branch-Auflösung

- Repository: `zm56snbdvp-hash/birdie-agent`.
- Branch: `feature/birdieworld-course-flight-v1-20260910`.
- Beobachteter HEAD: `ba8c08e866d2633c7fb9e02e267ad52d38c1850c`.
- Commit-Tree: `e0c3d46e65d09936f4beb36fe760faf48f720f42`.
- Commitzeit UTC: `2026-09-09T22:56:25Z`.
- [Fixierter Commit](https://github.com/zm56snbdvp-hash/birdie-agent/commit/ba8c08e866d2633c7fb9e02e267ad52d38c1850c).
- Committext benennt die ursprüngliche Live-Shot-Handler-Anbindung und vollständige React-Host-Prüfung als offen. Keine im Committext genannten Testzahlen als eigene Ergebnisse verwendet.

## E02–E14 — Gelesene Dateien

### E02 — `README.md`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/README.md)  
Git-Blob: `9442c1c240b01e124946f9c2d4042b872b4ae4d2`.

Recovery aus Browser-Bundles; kein originaler Codex/Sites-Quellbaum; ursprüngliche Release-Blocker bleiben bestehen.

### E03 — `COURSE_FLIGHT_V1.md`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/COURSE_FLIGHT_V1.md)  
Git-Blob: `738e9333bbb77922be41ec669d47d044f26b0df4`.

Abschnitt Host integration contract: originaler Live-Shot-Controller fehlt; vorhandene lokale Tests sind nur historische Dokumentation.

### E04 — `src/features/game/GameApp.tsx`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/src/features/game/GameApp.tsx)  
Git-Blob: `25f2584ad3d87011b58a6c711c893c9754da6097`.

GameApp(); drawForNextHole(); useState(1); CourseScene-Mount. Kein Shot-Resolver in dieser vollständigen gelesenen Datei.

### E05 — `src/features/game/CourseScene.tsx`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/src/features/game/CourseScene.tsx)  
Git-Blob: `b3b78cfe55b11557081a9346d76840d572b218dc`.

CourseSceneProps und CourseScene(); setHole/play/reset; kein separates Setup-Distanz-Prop und kein Completion-Schreibcallback.

### E06 — `src/features/game/course-flight.ts`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/src/features/game/course-flight.ts)  
Git-Blob: `8702d24d1e64700da20dff536e8f228ae3986e6b`.

prepareCourseShot(); isPreparedCourseShot(); sampleCourseShot(); WeakSet, Object.freeze, remainingBefore und exakte Result-Endkoordinaten.

### E07 — `src/features/game/course-scene.ts`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/src/features/game/course-scene.ts)  
Git-Blob: `8667c47434a4af3dab4d6c4063d96422d2e23200`.

createCourseScene()/paint(): active?.remainingBefore ?? hole.distance. play(): Loch-ID/Prepared/seen-Prüfung. Cache auf 128 begrenzt; Reset/Lochwechsel leert ihn. Renderer vollständig über überlappende Teilabrufe gelesen.

### E08 — `recovered/route-module-map.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/recovered/route-module-map.json)  
Git-Blob: `e424ebb06651c16bfaa3e1833e4120926ada39fd`.

game → game-app-D-PPPVPB.js; gameEngine → game-engine-BHNViZ1-.js. /spiel steht in knownProductRoutes; eine explizite Route-zu-Bundle-Zuordnung ist darin nicht enthalten.

### E09 — `recovered/deployed-evidence.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/recovered/deployed-evidence.json)  
Git-Blob: `69468f4a5083295756e37689f4b4cf58dd9262ae`.

Historische deploymentVersion; gemeinsamer Artwork-Consumer game-app-D-PPPVPB.js. Kein aktueller Live-Abruf.

### E10 — `recovered/bundle-manifest.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/recovered/bundle-manifest.json)  
Git-Blob: `1b49220b313c65dc338f9c6780e9ec62ac587940`.

Historische Bundle-Namen, Größen und SHA-256-Werte. Die Rohbundles selbst wurden nicht gelesen oder erneut gehasht.

### E11 — `package.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/package.json)  
Git-Blob: `8a16f641429239f038df2fef93059a46f210989f`.

Vorhandene Scripts test/typecheck/verify/verify:course/preview:course; kein vollständiger App-Build in diesem Recovery-Manifest.

### E12 — `tools/build-course-preview.mjs`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/tools/build-course-preview.mjs)  
Git-Blob: `1a28d3fd708ce819b669e13d8a12365f02a03093`.

Drei v1-Module werden mit tsc kompiliert und in eine Offline-HTML eingebettet; nicht ausgeführt.

### E13 — `tsconfig.recovery.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/tsconfig.recovery.json)  
Git-Blob: `24ae0434eca3a67d226c00774e9ad9ed55376189`.

Explizite include-Liste für Domain, Modelle, card-state, shot-engine und card-engine-*.ts, nicht für TSX.

### E14 — `tsconfig.course.json`

[Datei in gelesener Revision](https://github.com/zm56snbdvp-hash/birdie-agent/blob/ba8c08e866d2633c7fb9e02e267ad52d38c1850c/recovery/birdie-score-live-20260904/tsconfig.course.json)  
Git-Blob: `8562285539ca968306551f96a80da9797318c60a`.

include-Liste enthält course-flight.ts und course-scene.ts, nicht die React-TSX-Komponenten.

## E15 — Gezielte Dateibaumsuche

Die Trees wurden aus dem aufgelösten Commit verfolgt:

| Bereich | Git-Tree-ID | Befund |
|---|---|---|
| `recovery/` | `e719854ec8b069601a982222157dc1f1e79718ee` | Produkt-Unterordner `birdie-score-live-20260904`. |
| Produktwurzel | `e272ada3948cca2f2dbb617a349810c6f0960f98` | `COURSE_FLIGHT_V1.md`, Recovery-README, Skripte/TS-Konfiguration; keine `README_CANYON_V2.md` in dieser Wurzel. |
| Produkt-`src/` rekursiv | `eb88856617e2646f6c252ee764c0e5b67ab0a91d` | Recovery-Kartenkomponenten, Shot-Engine, Kartenadapter, v1-Flight/Scene. Kein `course-cinematic.ts` im gelesenen Source-Tree. |
| Produkt-`recovered/` rekursiv | `afd754d25dea86a0502fb2a709bbfb7d9b2949dd` | Nur `bundle-manifest.json`, `deployed-evidence.json`, `route-module-map.json`; keine Original-Bundle-Inhalte in diesem Ordner. |

Die maßgeblichen Produkt-Tree-Antworten waren serverseitig mit `truncated: false` gekennzeichnet. Ein großer, früher Clients-Verzeichnisabruf wurde in der Toolanzeige abgeschnitten und wird NICHT als vollständiger Negativnachweis verwendet; keine Unity-Quelldatei wurde gelesen.

Zusätzliche GitHub-Code-Suchanfragen waren strikt auf dieses Repository begrenzt: `simulateShot` und `game-app-D-PPPVPB`. Beide ergaben keine Treffer. Der Connector sucht dabei nur den Default-Branch; das ist ausdrücklich KEIN Beweis für das Fehlen in allen Branches, Archiven oder Workspaces. Die Hinweisbranch-Dateien wurden unabhängig davon direkt per Commit gelesen. Keine organisationsweite oder Infrastruktur-Suche.

## Historische Quellidentität, nicht Live-Zustand

| Metadatum | Wert aus E08–E10 |
|---|---|
| deploymentVersion | `a19bcfc2-99f0-46c4-8fb1-892a368f6e73` |
| Gameplay-Bundle | `game-app-D-PPPVPB.js` |
| Gameplay-Bundle-Größe | `59338` Bytes |
| Gameplay-Bundle-SHA-256 | `1a3efa0dc9a03ac597b8856fc9c2692071fbbb917b56cae1d3d8f8cb0f42981c` |
| Engine-Bundle | `game-engine-BHNViZ1-.js` |
| Engine-Bundle-Größe | `51984` Bytes |
| Engine-Bundle-SHA-256 | `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b` |

Ein Dateiname samt Manifest-Hash liefert einen präzisen Suchanker, aber weder den Funktionsinhalt noch einen verifizierten Host-Integrationspunkt. Die aktuelle Live-Revision und die Original-Workspace-ID bleiben unbewiesen.

## Tatsächlich ausgeführte Prüfung

Lokales Anhangsverzeichnis aufgelistet (kein ZIP vorhanden), Branch per GitHub aufgelöst, Produkt-Quelldateien und Metadaten gelesen, statische Schnittstellen-/Buildprüfung durchgeführt. Keine v2-README gelesen, kein Test-/Buildkommando ausgeführt, kein Browserlauf, kein Raw-Bundle-Download, kein Aufruf von Live-Spiel-APIs. Die Prüfungsschritte im Protokoll sind eine zukünftige lokale Abnahmespezifikation, keine PASS-Meldung.
