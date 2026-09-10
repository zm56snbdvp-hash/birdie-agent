# BIRDIE 5 — Round 3: original recovered deployment bundle matched

Stand: 10.09.2026

## Ergebnis

Round 2 hat den recovered Shot-Handler bereits anhand eines später gehärteten Founder-Test-Bundles lokalisiert. Round 3 schließt jetzt die historische Quellenkette mit dem **ungepatchten Recovery-Bundle**, dessen SHA-256 exakt zum GitHub-Deployment-Manifest passt.

Das ist der stärkste bislang verfügbare Beleg für den damaligen deployten `/spiel`-Gameplay-Bundle. Es ist weiterhin **kein Nachweis einer heutigen Live-Revision** und kein Grund, minifiziertes Build-Output produktiv zu editieren.

## Verifizierte Original-Recovery-Quelle

Library-Artefakt: `birdie-score-full-recovery.zip`.

Darin tatsächlich gelesen:

- `assets/game-app-D-PPPVPB.js` — 59.338 Bytes — SHA-256 `1a3efa0dc9a03ac597b8856fc9c2692071fbbb917b56cae1d3d8f8cb0f42981c`
- `assets/game-engine-BHNViZ1-.js` — 51.984 Bytes — SHA-256 `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`

Beide Werte stimmen exakt mit `recovery/birdie-score-live-20260904/recovered/bundle-manifest.json` auf Recovery-Revision `6dc644372661ed4317227c6b332dc74fef8eb8e5` überein.

Die Recovery-Route-Map ordnet `game-app-D-PPPVPB.js` dem Feature `game` / der Produktstrecke `/spiel` und `game-engine-BHNViZ1-.js` der Game-Engine zu. Der Recovery-Checkpoint nennt dafür `deploymentVersion a19bcfc2-99f0-46c4-8fb1-892a368f6e73`.

## Originaler compiled Host

Im ungepatchten `game-app-D-PPPVPB.js`:

- Spielkomponente: `Xe({loadout:e})`, am Ende als `GameApp` exportiert.
- Shot-Stop/Resolve-Handler: `On()`.
- Primäraktions-/Phasenhandler: `kn()`.
- `kn()` ruft `On()` ausschließlich bei Phase `TIMING` auf.
- Phasenfluss: `PLAN -> TIMING -> RESULT` bzw. `HOLE_COMPLETE`.

Der echte Resolve-Aufruf in `On()` ist der importierte Engine-Alias `o(...)` mit gleichzeitig verfügbaren Inputs:

```js
let t=o({
  remaining:c,
  lie:m,
  strokeNumber:g+1,
  player:e.player,
  club:z,
  ball:B,
  hole:R,
  timingMeter:St,
  spin:V,
  tactic:H,
  mode:k,
  aimLateral:U.lateral,
  targetDistance:U.forward
}), r=g+1+t.penalty;
```

Im Originalbundle importiert `GameApp` Engine-Export `a` als `o`. Im unveränderten Engine-Bundle wird die Simulationsfunktion `Vn` als Export `a` ausgegeben. Ihr Funktionskörper entspricht der rekonstruierten `simulateShot`-Logik.

## Exakter Integrationsslot

`On()` besitzt bereits den Shot-Lock. Nach dem einmaligen Resolver-Aufruf wird gegebenenfalls die bestehende Max-9/PICK-UP-Normalisierung auf `t` angewendet. **Der Canyon-v2-Snapshot gehört danach und vor die vorhandenen Result-/Position-/Stroke-/Remaining-/Lie-State-Commits.**

Im lesbaren Originalsource soll das bislang inline gebaute Resolver-Objekt als `input` benannt werden, der vorhandene Resolver genau einmal laufen und anschließend das final normalisierte Result an `prepareCourseShot(stableShotId, input, result)` gehen.

Wichtig: Derselbe `GameApp` enthält während `PLAN` zusätzlich eine Engine-Berechnung mit festem `timingMeter: 50`, um Ziel-/Flugvorschau zu erzeugen. **Diese Plan-Simulation ist nicht der akzeptierte Schlag und darf niemals einen Canyon-Snapshot triggern.** Nur `On()` mit dem tatsächlich gestoppten Timing ist der Anschluss.

## Hole / Setup belegt

Am Resolve-Punkt liegen die geforderten Werte gleichzeitig vor:

- `R = s[n]` — aktuelle Lochdefinition
- `c` — Restdistanz unmittelbar vor dem Schlag

Sie gehen als `hole:R` und `remaining:c` in den Resolver. Damit kann `prepareCourseShot` `holeId` und `remainingBefore` korrekt konservieren, bevor die App `remaining` auf das neue Result aktualisiert.

## Bestehender Host-Render-Snapshot

Der recovered Host besitzt bereits `[F,Tt]` als Shot-Render-State. Nach der Auflösung schreibt `On()` unter anderem Club, vorheriges Lie, Cards, Mode, Aim, Target, Start, Flight-Ende, Endpunkt, Curve und `output:t`. Die bestehende SVG-Flugdarstellung hängt daran.

Canyon v2 soll deshalb keinen zweiten Gameplay-Controller erfinden. Im Originalsource ist entweder ein separater reiner `courseShot`-Presentation-State oder eine nicht serialisierte Erweiterung des bestehenden Render-Snapshots möglich; in beiden Fällen wird `prepareCourseShot` nur einmal je akzeptiertem `On()`-Durchlauf aufgerufen.

## Stable Visual Shot ID

Im ungepatchten Bundle wurde keine bestehende `shotId`, `roundId`, UUID-/Session-/Idempotenz-ID im Gameplay-Handler gefunden. Für die rein visuelle Deduplication ist daher im Originalsource ein komponentenlokaler monotoner `useRef`-Sequenzwert die kleinste Ergänzung, sofern der echte Workspace keine autoritative Event-ID besitzt. Diese ID ist ausschließlich Presentation Identity.

Der Snapshot bleibt während der Darstellung stabil und wird beim Übergang `RESULT -> PLAN`, beim Lochwechsel und beim Restart geleert, damit `CourseScene` anschließend den neuen Setup-Abstand statt des alten Shots zeigt.

## Tatsächliche Course-/Asset-Struktur

Der ungepatchte `GameApp` verwendet im Course-Bereich bereits `/assets/course-emerald-opening.png` als statisches Course-Artwork und enthält darüber die bestehende Aim-/Timing-/Result-/Flugdarstellung. Der Hauptbundle lädt `./game-app-D-PPPVPB.js` dynamisch über den Vinext/Vite-Runtime-Chunk-Loader und führt Abhängigkeiten unter `assets/...`.

Damit passt `/assets/emerald-canyon-v2.webp` zur bestehenden Runtime-URL-Konvention. Weiterhin fehlt aber der originale Source-/Public-Ordner bzw. die Vinext/Vite/Sites-Buildkonfiguration, die dieses Asset im maintainable Workspace bereitstellt.

Der Canyon-Renderer darf nicht blind als zweite Ball-/Flugschicht über die bestehende SVG-Flugdarstellung gelegt werden. Die originale Course-Visual-Schicht muss im lesbaren Source gezielt ersetzt/integriert werden, während Aim-/Timing-/HUD-Interaktion erhalten bleibt.

## Patch-Entscheidung

**Kein Source-Patch erstellt.**

Der tatsächliche historische compiled Zielhandler ist nun eindeutig belegt, aber die originale maintainable Next/Vinext/Codex-Sites-Quelldatei, aus der `Xe`/`On`/`kn` gebaut wurden, fehlt weiterhin. Ein Patch gegen minifiziertes Build-Output wäre nicht der geforderte belastbare App-Integrationspatch.

## Jetzt exakt benötigter Workspace-Fund

Nur noch die Original-Quelldatei suchen, die anhand dieser Strings eindeutig erkennbar ist:

- `Timing läuft · im goldenen Fenster stoppen`
- `Equipment liegt · 5er-Starthand + 1 Loch-Draw · 5 Aktionskarten bereit`
- `Maximal 9 Schläge · Loch beendet`
- `PLAN`, `TIMING`, `RESULT`, `HOLE_COMPLETE`

Dazu den statischen Asset-Source-Ordner / die Vinext-Vite-Sites-Buildkonfiguration lesen. Danach kann der kleine **nicht angewendete** Source-Patch geschrieben werden.

## Status

`HISTORICAL_DEPLOYED_BUNDLE_MATCHED` / `RECOVERED_HANDLER_IDENTIFIED` / `ORIGINAL_MAINTAINABLE_SOURCE_UNPROVEN` / `CURRENT_LIVE_REVISION_UNPROVEN` / `NO_DEPLOYMENT`.
