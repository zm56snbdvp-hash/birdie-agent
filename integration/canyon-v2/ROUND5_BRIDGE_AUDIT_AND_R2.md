# BIRDIE 5 — Round 5: Bridge-Audit + R2 SAFE

Stand: 2026-09-10

## Entscheidung

**Die bisherige `BirdieWorld_Canyon_v3_Candidate_B_RecoveredHost_Bridge.zip` darf nicht weiter als QA-/Promotionskandidat verwendet werden.**

Beim unabhängigen Byte-/Semantikvergleich gegen den unveränderten `birdie-score-founder-test-v5.4` Host wurde festgestellt, dass der bisherige Bridge-Kandidat eine Änderung aus dem älteren Canyon-v2-RecoveredHost-Kandidaten geerbt hatte:

```js
// Baseline v5.4
var ... y={x:512,y:1365},b={x:520,y:195}, ...

// bisherige Bridge
var ... y={x:120,y:1186},b={x:782,y:333}, ...
```

Diese Konstanten sind nicht rein dekorativ. Der recovered Host verwendet `b` und die aktuelle Ballposition in `Fe(...)`, um einen sichtbaren Zielpunkt in `forward` und `lateral` umzuwandeln. Diese Werte werden als `targetDistance` und `aimLateral` an den bestehenden Engine-Resolve weitergegeben. Damit konnte die Re-Registrierung die Aim-Abbildung verändern. Das verletzt die strenge Präsentationsgrenze von BIRDIE 5.

Die Änderung stammt bereits aus `BirdieWorld_Canyon_v2_RecoveredHost_Candidate.zip`; der spätere Candidate-B-Bridge hatte sie nur übernommen.

## R2 SAFE gebaut

Neuer lokaler Kandidat:

`BirdieWorld_Canyon_v3_Candidate_B_RecoveredHost_Bridge_R2_SAFE.zip`

ZIP SHA-256:

`c1451dd959d3aea8700341f3f383e7959f6e904280f8d420c5f3bdcb78e22175`

Drive: https://drive.google.com/file/d/1wgTKxvKBtF5rOlLRwrXJ-f4G74gXj3AP/view

Kanonischer Course-Lab Candidate B im Paket:

- Datei: `BirdieWorld_Emerald_Canyon_v3_Candidate_B.html`
- Bytes: `637136`
- SHA-256: `b4181a38e5eac1b1455c180443d4f89df4aad73e94ac3bed3308762f8eea9e1f`

Damit ist auch die frühere Candidate-B-Ambiguität aufgelöst: Für weitere QA gilt ausschließlich der `BIRDIE_MASTER_Canyon_v3_Candidate_B` Stand mit `b418...`; der separate 637133-Byte/`a9db...` Integrator-Handoff ist nicht der kanonische Master.

## R2-Grenze

R2 startet erneut vom unveränderten Founder-v5.4-Recovery-Host.

Bestehende Dateien, die sich unterscheiden:

1. `build/game-app-D-PPPVPB.js`
2. `build/assets/game-app-D-PPPVPB.js`
3. `build/founder-game.html`

Für **beide GameApp-Kopien** ergibt der semantische Vergleich exakt **eine einzige Insert-Operation**: den optionalen Präsentationscallback nach dem bestehenden Engine-Resolve + PICK-UP-Normalisierung und vor den bestehenden State-Commits:

```js
window.__birdieCanyonRuntime?.play?.({
  holeId:R.id,
  holeDistance:R.distance,
  remainingBefore:c,
  from:m,
  putt:z.kind===`PUTTER`,
  start:s,
  flightEnd:l,
  end:u,
  result:t
});
```

`founder-game.html` unterscheidet sich nur durch das Laden von `/assets/birdie-canyon-runtime.mjs`.

Die Host-Koordinaten `y={x:512,y:1365},b={x:520,y:195}` bleiben unverändert. Die zuvor eingeführte Re-Registrierung `120/1186 -> 782/333` ist in R2 nicht vorhanden.

R2 fügt bewusst **kein lokales Ersatzbild `course-emerald-opening.png`** hinzu. Damit ist R2 ein Anschlussbeweis für Shot -> Presentation, kein behaupteter finaler Artwork-Transplant in den recovered Host.

## Engine und Runtime

Engine SHA-256 in R2:

`ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`

Sie ist byte-identisch zur Founder-v5.4-Baseline.

`birdie-canyon-runtime.mjs` enthält keinen `simulateShot`, `fetch`, XHR, WebSocket, `localStorage`, `sessionStorage` oder `/api/`-Aufruf. Sie erhält nur bereits aufgelöste Koordinaten/Resultdaten und zeichnet einen passiven Overlay-Layer.

## Tatsächlich ausgeführte Prüfungen

- JS/MJS Syntax-Sweep: **50/50 PASS**
- `node preflight-founder.mjs`: **PASS**
- `node build/qa-canyon-runtime.mjs`: **6/6 PASS**
- `node build/qa-bridge-boundary.mjs`: **10/10 PASS**
- R2 `qa-gameplay.mjs`: **32 PASS / 1 FAIL — Result accessibility**
- unveränderte Founder-v5.4-Baseline `qa-gameplay.mjs`: **32 PASS / 1 FAIL — derselbe Result-accessibility-Fail**

Der Accessibility-Fail ist damit als bereits vorhandener Baseline-Fail reproduziert und keine Canyon-Regression.

## Candidate C

Der parallel erschienene `BirdieWorld_Canyon_v3_Candidate_C_RecoveredHost.zip` ist ein separater BIRDIE-6/BIRDIE-SWING-Spielmechanik-Kandidat. Er übernimmt die ältere Host-Re-Registrierung und ergänzt außerdem einen `window.__birdieSwingTimingOverride`, der den an `On()` übergebenen Timingwert beeinflusst. Das kann für die BIRDIE-6-Interaction-QA separat bewertet werden, ist aber **nicht** der minimal-invasive BIRDIE-5-Bridge-Kandidat und ersetzt R2 nicht.

## Noch nicht belegt

- heutige Live-Revision
- originaler lesbarer Next/Vinext/Codex-Sites-Quellbaum
- finaler, sicherer Artwork-Asset-Transplant in den echten maintainable Host
- Safari / physische Geräte
- Production / Deployment

## Nächster Gate-Schritt

BIRDIE 4 soll für den BIRDIE-5-Integrationspfad nur noch folgende Kombination unabhängig prüfen:

1. **Master Candidate B:** SHA-256 `b4181a38e5eac1b1455c180443d4f89df4aad73e94ac3bed3308762f8eea9e1f`
2. **Recovered-host Bridge R2 SAFE:** ZIP SHA-256 `c1451dd959d3aea8700341f3f383e7959f6e904280f8d420c5f3bdcb78e22175`

Die alte Bridge ist **SUPERSEDED — DO NOT PROMOTE**.

Kein Deployment, kein Produktbranch-Push, keine Live-API- oder Produktionsdatenänderung.
