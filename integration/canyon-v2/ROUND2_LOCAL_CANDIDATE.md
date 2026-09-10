# BIRDIE 5 — Round 2 local recovered-host candidate

Stand: 10.09.2026

Status: **LOCAL CANDIDATE BUILT / NOT DEPLOYED**.

## Artefakt

Google Drive Ergebnisordner `BIRDIE_5_App_Integration`:

`BirdieWorld_Canyon_v2_RecoveredHost_Candidate.zip`

Drive file id: `1Za-sV6ql-r2bhdK_xbJQZbF-VN6lp-rt`

SHA-256 der hier gebauten ZIP: `1333fbb5de0562afe080835c7f5fc22ef59df8f90d74b025183feca1c44cb486`.

## Basis

Gespeichertes Library-Artefakt `birdie-score-founder-test-v5.4.zip`, materialisiert und entpackt. Dieses Paket enthält den recovered `GameApp`-Bundle `assets/game-app-D-PPPVPB.js` und die unveränderte recovered Engine `game-engine-BHNViZ1-.js`.

Das ist ein historischer Recovery-/Founder-Test-Host und **kein Nachweis der heutigen Live-Revision**.

## Änderungen im Candidate

1. Das freigegebene Emerald-Canyon-v2-Artwork wurde als lokales `build/assets/course-emerald-opening.png` eingebracht. Die linken 4,5 % werden vor dem Resize abgeschnitten, damit der im Artwork eingebrannte kleine statische Ball nicht als zweiter Spielball erscheint.
2. Das Bild wird auf den vorhandenen 1024×1536-Koordinatenraum des recovered GameApp gelegt.
3. Die rein visuelle Tee-/Cup-Registrierung im recovered GameApp wurde an Canyon v2 angepasst:
   - Tee: `y={x:120,y:1186}`
   - Cup: `b={x:782,y:333}`
4. Die beiden im Founder-Harness vorhandenen Spiegelkopien des GameApp-Bundles wurden gleich angepasst.
5. Die Engine wurde nicht verändert. Auth, Scorecard-Persistenz, Kartenregeln, Shop, Booster, Coins und APIs wurden nicht verändert.

Dieser Candidate nutzt weiterhin die bereits vorhandene recovered SVG-Schlag-/Flugdarstellung. Er ist ein bewusst kleiner Zwischenschritt: **Canyon-Artwork im echten recovered Host mit dessen echter Shot-Steuerung**. Der vollständige Canyon-v2-Cinematic-Canvas-Renderer wird erst im nächsten isolierten Integrationsschritt an den in `ROUND2_RECOVERED_HANDLER.md` identifizierten `On()`-Resolve-Slot gehängt.

## Ausgeführte Prüfungen

- `node --check` über alle 44 JS/MJS-Dateikopien im Candidate: **44/44 PASS**.
- `node preflight-founder.mjs`: **PASS** — React 19.2.6, `hydrateRoot`, GameApp-Adapter, 4 Clubs / 3 Balls / 17 Actions, Bildpfad-Metadaten vorhanden.
- `qa-gameplay.mjs`: Candidate-Ausgabe ist zeilenidentisch zum unberührten v5.4-Baseline-Lauf: **32 PASS / 1 FAIL**. Der FAIL `Result accessibility` ist bereits in der unveränderten v5.4-Basis vorhanden und wurde nicht durch Canyon v2 erzeugt.
- Browsernavigation zu localhost wurde in dieser Ausführungsumgebung durch `ERR_BLOCKED_BY_ADMINISTRATOR` gesperrt. Deshalb wird **kein Browser-/Visual-PASS** für diesen Candidate behauptet. Windows-Founder-Test ist der nächste sichtbare Gate.

## Hashes

- Recovered GameApp vor Candidate: `5e20cd816850ab60fc6a66ac9eaeac77963f1de764bed63fe0921a4660e964b2`
- Candidate GameApp: `c562053252569abade8c53c61cc2a5a1097350b2a89c14818cd0ae09b932ae7d`
- Candidate Canyon PNG: `10a2b7e71780e2bbf6cc1b221f938826702798d465cd6de641e3aa97a9d0b5c8`
- Engine unverändert: `ad735b5f4c93573505257cd55ba86355f9d5c8c22f8c3721ce5db608cba9e42b`

## Start auf Kevins Windows-PC

Paket entpacken und den bereits vorhandenen Founder-Harness wie in v5.4 starten (`START_FOUNDER_TEST.cmd` bzw. `start-founder-test.ps1`). Dieser Test ist lokal. Kein Deployment und keine Produktionsmutation.

## Nächster Schritt

Wenn dieser Art-Registration-Candidate im echten Browser grundsätzlich korrekt sitzt, wird als nächstes der Canyon-v2-Cinematic-Renderer an den belegten `On()`-Resolve-Punkt gehängt. Dabei bleibt der vorhandene Engine-Aufruf einmalig und der Renderer ausschließlich Präsentation.
