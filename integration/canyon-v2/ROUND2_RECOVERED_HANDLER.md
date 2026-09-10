# BIRDIE 5 — Round 2: recovered shot-handler finding

Stand: 10.09.2026

## Ergebnis

Der frühere Befund „Shot-Handler nicht identifiziert“ ist für den **recovered compiled host** jetzt überholt. Der originale lesbare Codex/Sites-Quellbaum bleibt weiterhin unbekannt, aber ein gespeichertes Founder-Test-/Recovery-Paket enthält den tatsächlich rekonstruierten Gameplay-Bundle der BirdieWorld-Schlag/Karten/Score-App und macht den Auflösungspunkt eindeutig nachvollziehbar.

Wichtig: Das ist **kein Nachweis der heutigen Live-Revision** und keine Freigabe, kompilierten Code blind zu deployen.

## Neue Quelle

Library-Artefakt: `birdie-score-founder-test-v5.4.zip`

- Library file id: `file_00000000fb9882468c5c3fe01cc7cdb4`
- Größe: 471878 Byte
- lokal materialisierte ZIP SHA-256: `80444e43c1355502a14c912657dc5b91d802232db53cbdc5ebccc6046c51dd05`
- Zielbundle im Paket: `birdie-founder-test-v5.4/build/assets/game-app-D-PPPVPB.js`
- materialisierter Bundle-SHA-256: `5e20cd816850ab60fc6a66ac9eaeac77963f1de764bed63fe0921a4660e964b2`
- Engine im selben Paket: `game-engine-BHNViZ1-.js`, SHA-256 `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`

Das Paket beschreibt weiterhin den historischen recovered production fingerprint `a19bcfc2-99f0-46c4-8fb1-892a368f6e73`. Sein V5.4-Harness enthält spätere lokale Gameplay-/Boot-Härtungen. Deshalb ist der Bundle-Hash nicht mit dem ursprünglichen 59338-Byte-Live-Bundle gleichzusetzen.

## Eindeutig identifizierter recovered Host

`game-app-D-PPPVPB.js` exportiert am Dateiende:

```js
export { Xe as GameApp };
```

Die große Spielkomponente ist im kompilierten Bundle damit `Xe({loadout:e})`.

Der Engine-Import lautet:

```js
import { a as o, ... } from "./game-engine-BHNViZ1-.js";
```

Im Engine-Bundle ist Export `a` die Funktion `Vn(e)`. Ihr Funktionskörper entspricht der rekonstruierten `simulateShot`-Logik; sie verarbeitet `remaining`, `lie`, `strokeNumber`, Player, Club, Ball, Hole, Timing, Spin/Tactic, Mode, Aim und Target und gibt das bekannte `ShotResult` zurück.

## Exakter Shot-Handler / Auflösungspunkt

In `GameApp` ist die Stop-/Resolve-Funktion im kompilierten Bundle `On()`.

Der relevante Ablauf ist eindeutig:

```js
function On(){
  if(zt.current||Ut)return;
  zt.current=!0;
  let timingValue=meterValueRef.current;
  Ct(timingValue);
  let t=o({
    remaining:c,
    lie:m,
    strokeNumber:g+1,
    player:e.player,
    club:z,
    ball:B,
    hole:R,
    timingMeter:timingValue,
    spin:V,
    tactic:H,
    mode:k,
    aimLateral:U.lateral,
    targetDistance:U.forward
  }), r=g+1+t.penalty;
  ...
  wt(t);
  Tt({ ..., output:t });
  bt(u);
  Te(r);
  pe(t.remaining);
  we(t.lie);
  ...
  N(t.holed?`HOLE_COMPLETE`:`RESULT`);
}
```

Damit ist belegt:

1. `On()` ist der recovered Shot-Stop/Resolve-Handler.
2. `o(...)` / Engine-Export `a` wird dort genau einmal für den akzeptierten neuen Schlag aufgerufen.
3. Vor der Auflösung sind die für Canyon v2 benötigten Setup-Werte gleichzeitig verfügbar: `R` = aktuelles Hole, `c` = Restdistanz vor Schlag, `m` = Lie vor Schlag, `g+1` = Stroke, plus Club/Ball/Actions/Mode/Aim.
4. Danach liegt `t` als aufgelöstes Ergebnis vor.
5. Erst anschließend werden Ergebnis, Shot-Snapshot, neue Ballposition, Stroke, `remaining`, `lie`, Discard/Penalty und Phase in React-State übernommen.

**Der kleinste belegte Integrationsslot liegt deshalb nach der finalen lokalen Anpassung von `t` (einschließlich vorhandener Pick-up-Regel), aber vor den State-Commits `wt(t), Tt(...), bt(...), ...`.**

## Bestehender Shot-Snapshot im recovered Host

Der Host besitzt bereits State `[F,Tt]` für einen Shot-Render-Snapshot. `On()` schreibt:

```js
Tt({
  club:z.name,
  from:m,
  cards:a,
  mode:k,
  aim:U.lateral,
  targetDistance:U.distance,
  start:s,
  target:j,
  flightEnd:l,
  end:u,
  curve:V?.curve,
  output:t
})
```

Das ist wichtig: Der echte recovered Host hat also bereits einen akzeptierten, renderbaren Shot-Snapshot und zeichnet daraus die bestehende SVG-Flugbahn. Canyon v2 muss **nicht** einen zweiten Shot-Controller erfinden.

## Empfohlener minimale Canyon-v2-Anschluss

Im lesbaren Originalquellcode wäre die gewünschte Form:

```ts
const input = {
  remaining,
  lie,
  strokeNumber: strokes + 1,
  player: loadout.player,
  club,
  ball,
  hole: currentHole,
  timingMeter: timingValue,
  spin,
  tactic,
  mode,
  aimLateral: aim.lateral,
  targetDistance: aim.forward,
};

let result = simulateShot(input); // vorhandener, einziger Resolver-Aufruf
// vorhandene lokale Pick-up/Result-Normalisierung bleibt davor/danach unverändert

const visualShot = prepareCourseShot(stableVisualShotId, input, result);
setCourseShot(visualShot);

// danach unverändert: Result-/Position-/Stroke-/Remaining-/Lie-State committen
```

`CourseScene` erhält anschließend Canyon-v2-Artwork und denselben aktuellen Hole/Setup-Kontext. Animation ist reine Darstellung; sie darf den State-Commit weder verzögern noch selbst auslösen.

## Shot-ID-Grenze

Im recovered Bundle ist **keine serverseitige/autoritative Shot-ID belegt**. Für die rein visuelle Deduplication kann in der Host-Komponente ein `useRef`-Sequenzwert einmal je tatsächlich akzeptiertem `On()`-Durchlauf erzeugt und im vorbereiteten Snapshot gespeichert werden. Das ist nur Presentation Identity, keine finanzielle/round-idempotency authority. Falls der echte Originalworkspace bereits eine stabile Shot-/event-ID besitzt, hat diese Vorrang.

## Warum noch kein angewendeter Bundle-Patch

Der konkrete Auflösungspunkt ist jetzt eindeutig, aber zwei Grenzen bleiben:

- Der gespeicherte v5.4-Bundle ist ein recovered/Founder-Test-Artefakt, nicht verifiziert als aktuelle Live-Revision.
- Der lesbare Original-Codex/Sites-Quellbaum ist weiterhin nicht vorhanden. Ein direktes Editieren der minifizierten Bundlezeile würde die spätere Wartbarkeit verschlechtern und könnte neuere Live-Änderungen überschreiben.

Daher wurde kein Produktbundle überschrieben und kein Deployment ausgelöst. Der nächste sichere Schritt ist ein **lokaler recovered-host integration candidate**: v2-Runtime als eigenes Asset bauen, nur den identifizierten `On()`-Slot instrumentieren, die vorhandene GameApp/Engine-Progression gegen Fixtures testen und erst danach entscheiden, ob ein nicht angewendeter compiled-candidate sinnvoll ist.

## Zusätzliche verifizierte Recovery-Hinweise

Das gespeicherte `GAMEPLAY_PATCH_REPORT.md` dokumentiert für denselben Gameplay-Strang die Phasen `PLAN -> TIMING -> RESULT/HOLE_COMPLETE`, den exakten Meterwert aus `meterValueRef.current`, den 280-ms Post-Shot-Lock sowie eine getestete Zwei-Schuss-Engineprogression 338 m -> 115,9 m FAIRWAY -> 6,5 m GREEN. `FOUNDER_REVIEW_3_VIEWPORTS.md` nennt `/spiel` als Zielroute und denselben Start/Stop/Result/Weiter-Flow. Diese Belege sind Recovery-/Testartefakte, keine heutige Live-Verifikation.

## Status

**RECOVERED_HANDLER_IDENTIFIED / ORIGINAL_SOURCE_AND_CURRENT_LIVE_REVISION_STILL_UNPROVEN.**

Keine Live-API, kein Deployment, keine Coins-/Runden-/Kartenmutation und keine Änderung am Feature-Branch oder Produktionscode.
