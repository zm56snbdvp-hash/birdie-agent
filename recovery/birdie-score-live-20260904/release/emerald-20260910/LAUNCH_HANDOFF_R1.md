# Emerald UI — Design Freeze / Launch-Preflight R1

10.09.2026. Eigener Entwickler-Preflight; keine unabhängige Produktionsfreigabe.

## Festgehaltener Stand

Kevin hat die Pass-06-Ansicht visuell freigegeben und die Weiterarbeit Richtung Launch beauftragt. Produktcode und freigegebene HTML bleiben in dieser Runde unverändert. Kein neuer Course-Kandidat, kein Merge, kein Deployment.

Quellstand: `1bbb178cdbed1f6478c0f066513e2dead1e6336f` auf `feature/birdieworld-emerald-world-ui-pass01-20260910`.

Freigegebene HTML: `BirdieWorld_Emerald_Motion_Pass06.html`, 1171620 Bytes, SHA-256 `0fadc5f767bc4cf76e06efb26555828083c7da76e506f21db0f8a57ac6ec632a`. Diese Bytes sind unverändert geblieben.

## Tatsächlich neu ausgeführte React-Prüfung

**27/27 PASS.** Die tatsächlichen Pass-06-Module CourseScene, EmeraldShotMotion und Phasenadapter wurden in der tatsächlichen vorhandenen React-/ReactDOM-Produktionsruntime des historischen R2-SAFE-Recovery-Hosts gemountet. Gemeldete Runtime: React 19.2.6. Keine alternative React-Implementierung und keine bloße Source-Regex-Prüfung.

Nachgewiesen: genau eine Course-Canvas; keine frühe Ergebnisanzeige; keine React-Updates pro Rendererframe; simulierte hidden-document-Pause; identische immutable Props ohne Replay; Reset und Lochwechsel im Flug; OS- und Prop-Reduced-Motion; sichtbare Kartenhand bei Reduktion; Putt ohne Flight; Wasserstrafe; Qualitätswechsel ohne neuen Resolve; Ablehnung ungeprüfter Shot-Kopien und wiederverwendeter IDs mit anderer Objektidentität; explizites Unmount/Remount ohne späte Observerupdates; 320/390/768/1280-Pixel-Ansichten ohne horizontalen Seitenüberlauf.

Null uncaught Exceptions, null Hydration-Recoveries und null externe HTTP(S)-Requests im vollständigen Lauf. Der portable Browser-Harness blockiert externe HTTP(S)-Requests zusätzlich und schreibt bei Abbruch einen FAIL statt einen scheinbar grünen Teillauf.

Frisch wiederholt: **36/36 Node** (15 Adapter + 4 Motion-Codegrenzen + 17 Course-Flight), **37/37 Standalone-Browser**, **5/5 TSX-Syntax**, strikter Adapter-Typecheck Exit 0. Überlappende Suiten nicht zu einer Launch-Prozentzahl addieren.

## Reproduzierbare Belege und Werkzeuge

Gemeinsamer Drive-Ordner: https://drive.google.com/drive/folders/1r7GhkNNnZznO8j9lo_5S9r4vRedu0VOn

Vollständiges Paket: https://drive.google.com/file/d/14Wb4ZBJJ9pg6ivPbxbcPlCG4w91j1hL_/view

`BirdieWorld_Emerald_LaunchPrep_R1.zip`, 2102531 Bytes, SHA-256 `f85f7e821f66721ac23d7dcdee96fd8eb5e95be77dacbf9bda9cfb995406d881`.

Ausführlicher Handoff: https://drive.google.com/file/d/1nnr-upjwiAt2KLMmsCUu1UW7yQlcKx7B/view

Das Paket enthält die unveränderte freigegebene HTML, benötigte unveränderte Sourcekopien mit Git-Blob-Prüfsummen, zwei historische Runtime-Testabhängigkeiten mit Lizenzhinweisen, neue ausführbare `build-emerald-react-probe.cjs`, `emerald-react-probe.fixture.js`, `verify-emerald-react-mount.py`, vollständige Rohberichte/Logs, Screenshots, Launch-Manifest und SHA-256-Inventar. Keine Fontdateien, Secrets oder Produktionsdaten.

Reproduktion im entpackten Paket:

```sh
node tools/build-emerald-react-probe.cjs source reference-runtime probe.json
python tools/verify-emerald-react-mount.py --payload probe.json --out react-qa
```

Vorhandenes Node/TypeScript und Python/Playwright/Chromium erforderlich; `--chromium` bei abweichendem Browserpfad. Keine API-Schlüssel.

## Prüfgrenzen

Die React-Fixture mountet CourseScene und Motion, NICHT den kompletten GameApp-/Router-/Login-/Karten-/Booster-/Scorecard-Host. Historische Produktions-React-Runtime: kein Entwicklungs-StrictMode-Doppel-Effect-Nachweis. Explizites Unmount/Remount ist geprüft. Keine physischen Geräte, Safari/WebKit oder heutige Live-Revision getestet.

Besonders wichtig: Der React-Branch verwendet weiter den v1-Renderer; die freigegebene DOM-/Canvas-Vorschau enthält zusätzlich das Canyon-v2-Artwork. Der React-Mount-PASS beweist nicht den fertigen Artwork-Transplant in die gesamte Original-App.

## Prompter-Abgleich / keine weitere Konkurrenzfassung

B5 R10 prüfte den realen abgeschnittenen Skin noch an Revision `02699ac13eb9b74edcbfc782d281cacc118fb102`. Seit `1bbb178...` ist dieser Defekt repariert; Syntax- und React-Mount-Nachweise beziehen sich auf den neueren Stand. Der Original-Host-Einwand bleibt bestehen.

Candidate D.1 existiert inzwischen. B1s gelesener Bericht beschreibt ergänzende technische Verifikation an HTML-SHA `64f0fd72b1c5be0b23cdc125a6d36e0b4b6df782d5d54b2cd21e46f0569fff62`, ohne organisatorisch unabhängiges B7/B4-GO. Daneben liegt B6 R2.1 mit separater Identität und zusätzlichen Korrekturen. Diese Quellen wurden gelesen, nicht hier erneut getestet oder ungeprüft kombiniert.

Prompter: genau eine bestehende Integrationslinie weiterführen, B6-Ownerprüfung und B7/B4 auf dieselben finalen Hashes beziehen. B5s Kontextwechsel- und Renderer-/Artwork-Fault-Fixtures auf der ausgewählten Kombination erneut ausführen. Unsere UI-Tests ersetzen diese Swing-Integrationstests nicht. Keine D.2/E-Fassung nur zur Umbenennung erzeugen.

## Noch offen bis Produktion

1. Eindeutig belegter ursprünglicher bearbeitbarer Sites-/Codex-Workspace **BirdieWorld — Golf, Karten & Fortschritt**: Route/Mount, akzeptierter Shot-Handler inklusive Normalisierung, Build/Lockfile, Assets und aktueller Versionsbezug. Keine Secrets. Erneute GitHub-/Drive-/Library-Suche lieferte Recovery/Build/Handoff, keinen bewiesenen vollständigen Originalhost.
2. Freigegebene Canyon-Darstellung plus ausgewählte Swing-Fassung dort integrieren und den vollständigen Host bauen. Das verbundene Vercel-Supporter-Beta-Projekt ist laut Source-Recovery-Audit die ausgeschlossene Unity/WebGL-Linie und wurde nicht als Ersatz genutzt.
3. Testsystem-Rundlauf: Login/Reload, Deck, gespeicherte Scorecard, Booster-Retry und kanonischer Wallet-/Ledger-Abgleich; physisches iPhone/Safari und Android; Preview und belastbarer Rücknahmeweg für genau diesen Build.

**Entscheidung: DESIGN_FROZEN / REACT_SLICE_PASS / ORIGINAL_HOST_AND_FULL_APP_RELEASE_UNPROVEN / NO_DEPLOYMENT.** Dieser Handoff startet keine anderen Chats automatisch und überschreibt keine unabhängigen Gate-Entscheidungen.
