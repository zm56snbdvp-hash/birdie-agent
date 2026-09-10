# BIRDIE 5 — Canyon Integration Handoff

Stand: 10.09.2026

## WICHTIG — zuerst lesen

1. **`ROUND6_RECOVERED_HOST_PATCH_MANIFEST.md`** — exakter, nicht angewendeter recovered-host Patch-Manifest: baseline-hashgebunden, genau eine 159-Byte-Insertion.
2. **`ROUND5_BRIDGE_AUDIT_AND_R2.md`** — aktueller kanonischer BIRDIE-5-Bridge-Stand und Begründung für R2 SAFE.
3. `ROUND3_ORIGINAL_DEPLOYED_BUNDLE_MATCH.md` — historischer ungepatchter 59.338-Byte-Gameplay-Bundle und Recovery-Fingerprint.
4. `ROUND2_RECOVERED_HANDLER.md` — exakter recovered Shot-Handler `On()` und Integrationsslot.
5. `ROUND4_PROMPTER_NEXT_STEP.md` — Historie der Candidate-A/B-Zusammenführung.
6. `INTEGRATIONSPROTOKOLL.md` / `QUELLEN.md` — ursprünglicher Scoutstand und Quellenregister; frühere Aussagen wie „Handler nicht identifiziert“ sind historisch.

Maschinenlesbar zusätzlich: `RECOVERED_HOST_R2_SAFE.patch.json`.

## Aktueller kanonischer Stand

### Course Candidate B
Für gemeinsame Canyon-QA gilt ausschließlich der Master-Candidate:

- `BirdieWorld_Emerald_Canyon_v3_Candidate_B.html`
- 637136 Bytes
- SHA-256 `b4181a38e5eac1b1455c180443d4f89df4aad73e94ac3bed3308762f8eea9e1f`

Der separate 637133-Byte/`a9db...` Integrator-Handoff ist nicht der kanonische Master.

### Recovered-host Bridge
Die bisherige `BirdieWorld_Canyon_v3_Candidate_B_RecoveredHost_Bridge.zip` ist **SUPERSEDED — DO NOT PROMOTE**.

Grund: Sie erbte aus einem älteren Canyon-v2-RecoveredHost-Kandidaten eine Host-Re-Registrierung von Tee/Cup-Koordinaten. Diese Konstanten werden im recovered Host auch durch `Fe(...)` zur Berechnung von `aimLateral` und `targetDistance` verwendet und sind daher nicht rein dekorativ.

Neuer kanonischer BIRDIE-5-Bridge-Kandidat:

- `BirdieWorld_Canyon_v3_Candidate_B_RecoveredHost_Bridge_R2_SAFE.zip`
- ZIP SHA-256 `c1451dd959d3aea8700341f3f383e7959f6e904280f8d420c5f3bdcb78e22175`
- Drive: https://drive.google.com/file/d/1wgTKxvKBtF5rOlLRwrXJ-f4G74gXj3AP/view

R2 startet erneut vom unveränderten Founder-v5.4-Recovery-Host. In beiden `game-app-D-PPPVPB.js`-Kopien besteht der semantische Unterschied zur Baseline aus exakt **einer 159-Byte-Insert-Operation**: dem optionalen Präsentationscallback nach dem vorhandenen Engine-Resolve + PICK-UP-Normalisierung und vor den bestehenden State-Commits. Die ursprüngliche Host-Geometrie bleibt bytegleich erhalten. Die Engine ist byte-identisch zur Baseline.

Baseline GameApp SHA-256: `5e20cd816850ab60fc6a66ac9eaeac77963f1de764bed63fe0921a4660e964b2`.  
R2 GameApp SHA-256: `58ef56b562407cb685800044b4acd67fd7c7ce7a121d99f108f425c7215bb3b6`.  
Passive Runtime SHA-256: `812cd459ee3de2ce3e46d4727b8274a83245b53bd238ecf021337a9713a331a3`.

R2 fügt bewusst kein lokales Ersatzbild für den recovered Host hinzu. Es ist ein sauberer **Shot -> Presentation Bridge Proof**, kein behaupteter finaler Artwork-Transplant.

## Recovered Handler

Historisch belegt:

`/spiel` → `game-app-D-PPPVPB.js` → `GameApp` (`Xe`) → `kn()` bei `TIMING` → `On()` → genau ein Engine-Resolve → vorhandene PICK-UP-Normalisierung → Result-/Position-/Stroke-/Remaining-/Lie-State-Commits.

Die PLAN-Vorsimulation mit Timing 50 ist ausdrücklich **nicht** der akzeptierte Shot und darf keinen Canyon-Snapshot/Bridge-Callback auslösen.

## R2-Prüfung

- JS/MJS Syntax: **50/50 PASS**
- Founder Preflight: **PASS**
- Canyon Runtime: **6/6 PASS**
- Bridge Boundary: **10/10 PASS**
- Recovered Gameplay: **32 PASS / 1 FAIL Result accessibility**
- unveränderte Founder-v5.4-Baseline: **derselbe 32 PASS / 1 FAIL**

Der einzelne Accessibility-Fail ist damit reproduziert vorbestehend und keine Canyon-Regression.

## Candidate C

`BirdieWorld_Canyon_v3_Candidate_C_RecoveredHost.zip` ist ein separater BIRDIE-6/BIRDIE-SWING-Spielmechanik-Kandidat. Er verändert über `window.__birdieSwingTimingOverride` den an den bestehenden `On()`-Pfad übergebenen Timingwert und übernimmt außerdem die ältere Host-Re-Registrierung. Er gehört in die BIRDIE-6-Interaction-QA und ersetzt den minimal-invasiven BIRDIE-5-R2-Bridge nicht.

## Weiterhin offen

- originaler lesbarer Next/Vinext/Codex-Sites-Quellbaum
- heutige Live-Revision
- finaler maintainable Artwork-Asset-Transplant
- Safari / physische Geräte
- Production / Deployment

Feature-Branch und Produktionscode bleiben unverändert.

**Status:** `RECOVERED_HANDLER_IDENTIFIED` · `MASTER_CANDIDATE_B_PINNED` · `R2_SAFE_BRIDGE_READY_FOR_INDEPENDENT_QA` · `PATCH_MANIFEST_PINNED` · `OLD_BRIDGE_SUPERSEDED` · `ORIGINAL_SOURCE_UNPROVEN` · `CURRENT_LIVE_UNPROVEN` · `NO_DEPLOYMENT`.
