# BirdieWorld Canyon — Candidate C.1 + recovered-host R2 SAFE

Stand: 2026-09-10

## Entscheidung

`BirdieWorld_Canyon_v3_Candidate_C_RecoveredHost.zip` ist **SUPERSEDED / DO NOT PROMOTE**. BIRDIE 5 hat nach dessen Erstellung belegt, dass dieser ältere C-Host die frühere Tee/Cup-Re-Registrierung `120/1186 -> 782/333` geerbt hatte. Diese Konstanten speisen die recovered Aim-Abbildung und sind deshalb nicht rein präsentational.

## Candidate C.1 standalone

Neue lokale Master-Vorschau:

- `BirdieWorld_Emerald_Canyon_v3_Candidate_C1.html`
- SHA-256 `288e790df065fb48ab62c458713731988cea389f1d015c115641e41927a34963`
- Drive-Ordner: `BIRDIE_MASTER_Canyon_v3_Candidate_C1`

Korrekturen gegenüber Candidate C nach UI-Preflight:

1. keyboard-accessible Fallback unter den Testoptionen; er nutzt denselben `resolveMappedShot()`-Pfad und keinen zweiten Resolver,
2. Mobile: großer Motor-Hitbox bleibt, Idle-Visual-Chrome wird stark verkleinert/transparent, damit der Canyon Hauptdarsteller bleibt,
3. Follow-through wird klar als Abschlussgefühl nach bereits feststehendem Impact-Ergebnis bezeichnet,
4. Candidate-only package/build-script-Abweichungen sind dokumentiert.

Frisch ausgeführt: Canyon 27/27 PASS, Shot Effects 9/9 PASS, Birdie Swing 10/10 PASS, C.1 Chromium 24/24 PASS; 0 Browserfehler, 0 HTTP(S)-Requests.

## Neuer recovered-host Kandidat

- `BirdieWorld_Canyon_v3_Candidate_C1_RecoveredHost_R2_SAFE.zip`
- ZIP SHA-256 `12880303e9e6ba0271fac87640caaeb20fc81e59b266b444ca373380a67da67c`
- Drive-ID `1ko0kcWPueQMHEiktIgQZz20ippforTnb`

Basis ist **BIRDIE 5 R2 SAFE**, nicht der alte Candidate-C-Host. Die recovered Host-Geometrie bleibt `y={x:512,y:1365}, b={x:520,y:195}`. Die unsafe Re-Registrierung ist nicht vorhanden. Die Engine bleibt SHA-256 `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`.

C.1 ergänzt auf R2 SAFE nur den BIRDIE-SWING-Hook um den bereits belegten `On()`-Resolver: ein optionaler geclampter `timingMeter` wird an den existierenden Handler delegiert; der Swing-Runtime ruft die Engine nicht direkt auf. Der passive R2-Canyon-Callback nach Resolve/PICK-UP und vor State-Commit bleibt erhalten.

Host-Prüfungen lokal: JS/MJS Syntax 54/54 PASS, Canyon Runtime 6/6 PASS, Bridge Boundary 10/10 PASS, Swing Hook/Safety 15/15 PASS, Founder Preflight PASS. Recovered Gameplay bleibt 32 PASS / 1 vorbestehender `Result accessibility` FAIL wie die Founder-v5.4-Baseline.

## QA

BIRDIE 3, BIRDIE 4 und BIRDIE 7 haben im OS neue Requests für exakt Candidate C.1 erhalten. BIRDIE 7 soll den echten Game-Feel-Gate `GO / GO WITH CHANGES / REWORK / REJECT` vergeben. Kein Deployment, kein Produktbranch-Merge, keine Live-/Coin-/Round-/Card-Mutation.