# BIRDIE 5 — Canyon-v2-Integrationsprotokoll

Stand: 10. September 2026. **Read-only-Scout abgeschlossen; Integrationspatch BLOCKIERT.**

## 1. Gelesene Basis und Grenze

Repository: `zm56snbdvp-hash/birdie-agent`  
Hinweisbranch: `feature/birdieworld-course-flight-v1-20260910`  
Gelesene aktuelle Branch-Revision: `ba8c08e866d2633c7fb9e02e267ad52d38c1850c`  
Commitzeit: `2026-09-09T22:56:25Z` (10.09.2026, 00:56:25 Europe/Berlin).  
Produktpfad: `recovery/birdie-score-live-20260904/`.

Alle folgenden Dateibefunde beziehen sich auf diese unveränderliche Revision, nicht auf einen behaupteten aktuellen Live-Stand. Der Branch enthält den untersuchten v1-Recovery-Stand. Das angekündigte `BirdieWorld_Emerald_Canyon_v2_Entwicklungspaket.zip` war im Chat-Dateibereich nicht vorhanden; `README_CANYON_V2.md` und v2-Artwork konnten deshalb nicht gelesen werden. Die v1-Dokumentation wird nicht als Ersatz für die v2-README ausgegeben. [E01–E03, E15]

## 2. Anschlussbefunde

Pfade in dieser Tabelle sind relativ zum oben genannten Produktpfad. Quellen und Git-Blob-IDs stehen in `QUELLEN.md`.

| Gesuchter Anschluss | Gelesene Datei / Funktion | Beleg und Grenze |
|---|---|---|
| Originaler Shot-Handler | **Nicht identifiziert.** Kein belegter Originaldateipfad, Funktionsname oder Original-Commit. | `GameApp.tsx` enthält den Handler `drawForNextHole()`, aber keinen Shot-Button/Shot-Resolver. Dieser Draw-Handler ist ausdrücklich KEIN Integrationspunkt. [E04] |
| Erfolgreich akzeptierte Schlagauflösung | **Nicht belegt.** | Die v1-Dokumentation benennt den ursprünglichen Live-Controller als fehlend. Akzeptanzzweig, stabile Shot-ID und autoritativer State-Commit sind im gelesenen Recovery-Code nicht nachgewiesen. [E03–E04] |
| Schlagansicht | `src/features/game/GameApp.tsx` → `GameApp()`; nur rekonstruierte Kartenansicht | Mount vorhanden: `<CourseScene hole={COURSE_HOLES[hole - 1]} shot={courseShot}/>`. Die vollständige originale Schlagansicht ist damit NICHT identifiziert. [E04] |
| Snapshot-Adapter | `src/features/game/course-flight.ts` → `prepareCourseShot()` | Übernimmt `input.hole.id`, `input.remaining` und eine eingefrorene Kopie des bereits vorliegenden `result`; keine erneute Simulation. Nur v1-Code geprüft. [E06] |
| Darstellungsübergabe | `src/features/game/CourseScene.tsx` → `CourseScene()` | Props `hole` und optional `shot`; Effects verwenden `setHole()` und `play()`. Keine Schreibaktion bei Animationsende als Prop vorgesehen. [E05] |
| Renderer | `src/features/game/course-scene.ts` → `createCourseScene()`, `paint()`, `play()` | `paint()` nutzt `active?.remainingBefore ?? hole.distance`; `play()` lehnt falsche Loch-ID, nicht vorbereitete Snapshots und bereits gesehene IDs ab. [E07] |

**Zwei konkrete Synchronisationslücken:** `GameApp()` verwaltet das Loch lokal mit `useState(1)` und dem Draw-Button, nicht nachgewiesen aus dem echten Schlag-State. Die gelesene v1-`CourseSceneProps` besitzt außerdem keinen separaten Setup-Abstandsparameter. Im Idle-Zustand nutzt v1 die volle `hole.distance`. Eine korrekte Folge-Schlag-Vorbereitung ist deshalb nicht allein durch Durchreichen von `courseShot` bewiesen. Keine Änderung an `CourseHole.distance` erfinden, um diese Lücke zu verdecken. Die tatsächliche v2-Schnittstelle muss am fehlenden Paket geprüft werden. [E04–E07]

## 3. Kleinster zulässiger Anschluss — Vertrag, kein Patch

Im **originalen vorhandenen Akzeptanzzweig**, nach genau einer akzeptierten Schlagauflösung, einmal `prepareCourseShot(stableShotId, input, result)` aufrufen. Es müssen die bereits verwendeten Eingaben vor der Auflösung und genau deren akzeptiertes Ergebnis sein. Den zurückgegebenen Snapshot im lokalen Darstellungs-State halten und an die vorhandene Schlagansicht / `CourseScene` übergeben. Keine zweite Engine und keinen neuen Shot-Handler bauen.

Die Shot-ID bleibt bei Rerender, Replay und wiederholter Zustellung derselben akzeptierten Auflösung identisch. Der Adapteraufruf gehört nicht in Render, einen Animationseffect oder Animationsende. Der Renderer-Cache ist nur lokal und begrenzt; er wird bei Reset/Lochwechsel geleert und garantiert keine hostweite Einmaligkeit. Ein JSON-Klon verliert in v1 die `WeakSet`-Vorbereitung; den Snapshot deshalb nicht serialisieren oder durch eine zweite Adapter-Modulinstanz schleusen. [E05–E07]

Loch-ID und Setup-Abstand müssen aus demselben autoritativen Schlagkontext stammen: `snapshot.holeId === input.hole.id` und `snapshot.remainingBefore === input.remaining` **vor** dem Schlag. Die Restdistanz nach dem Schlag (`result.remaining`) und die volle Lochlänge sind dafür kein Ersatz. Beim Lochwechsel alte Snapshots nicht am neuen Loch abspielen; Verzögerungen oder Fehler der Grafik dürfen keine neue Schlagauflösung auslösen.

`simulateShot` bleibt ausschließlich Aufgabe des bestehenden Resolvers. Animationsende, Reduced Motion, Replay, Unmount und Grafik-Fallback dürfen weder Runden speichern noch Karten ziehen, Coins verändern oder Belohnungen auslösen. Kartenadapter, Taxonomie, Timing, Landepunkt und bestehende Release-Grenzen bleiben unverändert.

## 4. Artwork und Build

**Belegt ist nur v1:** Der Canvas-Renderer zeichnet prozedural. `tools/build-course-preview.mjs` kompiliert `shot-engine`, `course-flight` und `course-scene` und bettet sie in `dist-course/BirdieWorld_Course_Flight_v1.html` ein. Das ist ein Offline-Preview-Build, kein vollständiger React-App-Build und kein Nachweis für die Einbindung des v2-Artworks. [E07, E12]

**Nicht belegt:** v2-Assetdatei, Import/Asset-URL, tatsächlicher App-Bundler, Base-Pfad und Kopier-/Hashing-Regeln. Weder einen `public/`-Pfad noch einen Asset-Import erfinden. Benötigt werden das v2-Artwork samt Referenz im Paket sowie `package.json`, Lockfile, Build-/Bundlerkonfiguration und ein vorhandener lokaler Asset-Import aus dem echten App-Workspace. Das Preview-Paket darf die App nicht ersetzen.

Bestehende Recovery-Skripte erhalten: `verify`, `verify:course`, `preview:course`. Beide gelesenen TypeScript-Konfigurationen schließen die TSX-Komponenten nicht in ihre jeweiligen `include`-Listen ein. Selbst ein später erfolgreicher Lauf dieser Skripte wäre daher kein vollständiger React-Host-Nachweis. [E11–E14]

## 5. Prüfungsschritte nach Quellenübergabe

**Spezifikation, nicht ausgeführt.** Ausschließlich lokal in einer freigegebenen Arbeitskopie mit Fixtures/Spies; keine Live-APIs oder Produktionsdaten.

| Nr. | Aktion / Voraussetzung | Eindeutiges Soll |
|---|---|---|
| 1 | Echte Auflösung mit einer akzeptierten Fixture instrumentieren. | Adapter genau 1× nach Akzeptanz, mit derselben stabilen ID und den vorhandenen Input-/Resultwerten; Renderer löst keinen Schlag aus. |
| 2 | Abgelehnten oder fehlgeschlagenen Schlag auslösen. | Adapter 0×; kein erfundener Erfolgssnapshot. |
| 3 | Dieselbe akzeptierte Auflösung erneut zustellen; rerendern, remounten, Grafikqualität ändern. | Kein zweiter Adapteraufruf für dieselbe Auflösung; ID bleibt stabil; keine erneuten Spiel-/Belohnungswirkungen. Ein visueller Neustart ist keine erneute Schlagauflösung. |
| 4 | Zweiten Schlag am selben Loch mit anderer Restdistanz, danach Lochwechsel prüfen. | Darstellung und Setup folgen dem gültigen Host-Kontext; Snapshot nutzt Vorher-Distanz, nicht Nachher-Distanz; alter Snapshot wird am neuen Loch nicht abgespielt. |
| 5 | Flug, Putt, Strafdrop und Einlochen bis Ende / Reduced Motion / Replay / Unmount prüfen. | Endkoordinaten entsprechen dem akzeptierten Result; keine zusätzlichen Round-, Draw-, Wallet-, Coin- oder Reward-Aufrufe. |
| 6 | Assetfehler und Canvas-Ausfall lokal simulieren; echten Host-Build unter dessen Base-Pfad starten. | Grafik fällt kontrolliert zurück, ohne neue Auflösung; vorgesehenes lokales Artwork wird korrekt aufgelöst, keine unbeabsichtigten Remote-Assets oder 404. |
| 7 | Vorhandene Regressionen und vollständige TSX-/Host-Prüfung ausführen. | Karten-/Engine-Semantik und vorhandene Prüfscripte unverändert; keine Verwechslung von Preview-Erfolg mit Release-Freigabe. |

## 6. Genau benötigte Übergabe / nächster Handgriff

Bitte das **`BirdieWorld_Emerald_Canyon_v2_Entwicklungspaket.zip`** und einen read-only Quellcodeexport des **originalen Codex/Sites-Workspaces der App mit dem Produkttitel „BirdieWorld — Golf, Karten & Fortschritt“** bereitstellen: Original-Schlagansicht samt Mount/Route, tatsächlicher Shot-Handler einschließlich importiertem Resolver/Hook/Reducer und Akzeptanzzweig, Quelle für stabile Shot-ID/aktuelles Loch/Setup-Restdistanz sowie die genannten Build- und Assetdateien. Dazu gehört die konkrete aktuelle Workspace-/Commit-Kennung; diese ist hier nicht belegt.

Der historische Wiedererkennungsanker aus dem Recovery-Metadatenstand ist `deploymentVersion a19bcfc2-99f0-46c4-8fb1-892a368f6e73`, Feature-Bundle `game-app-D-PPPVPB.js` (59.338 Bytes; SHA-256 in `QUELLEN.md`). Das ist keine aktuelle Live-Verifikation. Ein vorhandenes lokales Archiv genau dieses Bundles samt Sourcemap könnte die Handleridentifikation unterstützen, ersetzt aber nicht den Original-Host-Build für einen Integrationspatch. [E02, E08–E10]

**Abschluss:** Dokumentation erstellt. Kein `.patch`/`.diff` erstellt oder angewendet. Keine lokalen Produkt-/Browser-/Buildtests ausgeführt und keine historischen PASS-Zahlen übernommen. Repository und Live-System blieben während des Scout-Laufs unverändert; keine Deployments, Live-API-Aufrufe oder Produktionsdatenänderungen. Die spätere Handoff-Kopie dieser Dokumentation auf einen separaten Branch erfolgte erst nach Abschluss des Scouts auf ausdrückliche Nutzeranweisung.
