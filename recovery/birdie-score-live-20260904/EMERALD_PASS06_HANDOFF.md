# Emerald World UI — Pass 06 / Stabilisierung und Renderer-Synchronisation

Datum: 2026-09-10. Ausschließlich Golf-/Karten-/Booster-App, NICHT MMORPG/Unity.
Basis: `02699ac13eb9b74edcbfc782d281cacc118fb102` auf `feature/birdieworld-emerald-world-ui-pass01-20260910`.

## Tatsächliche Korrekturen

Die bisherige `EmeraldWorldSkin.tsx` (Blob `10e62423027921956192530df8fdc42fb0f093ad`) endete mitten im CSS-Template bei `linear-gradient(145deg,#0a`. Abschluss und Komponentenexport fehlten. Der vorangegangene Stand war daher nicht kompilierbar. Jetzt sind Basis und Collectible-CSS vollständig in zwei lesbar getrennten Modulen, der Skin exportiert wieder korrekt.

Pass 05 verwendete drei vom Renderer unabhängige Timeouts. Der Renderer pausiert bei document.hidden und außerhalb des sichtbaren Bereichs. Dadurch konnte die UI vor dem Ball fertig sein. Diese zweite Uhr wurde entfernt.

`emerald-presentation.ts` liest den existierenden Controller-Status und beobachtet dessen Canvas-Phasenattribut. Nur ein vom Renderer abgeschlossenes, passendes Shot-Objekt darf den Result Rift anzeigen. Objektidentität, Shot-ID und Loch-ID müssen passen. Wiederholte Paints derselben Phase verursachen keine wiederholten React-State-Updates. Observer und Listener werden bereinigt. Putts erzeugen keinen künstlichen Flugzustand.

`CourseScene` akzeptiert den ausschließlich für UI-Feedback vorgesehenen Callback `onPresentationChange`. Im GameApp ist dieser nur mit `setPresentation` verbunden. Niemals Coin-, Karten-, Round- oder Gameplay-Writes daran hängen. Die existierende drawAtHoleStart-Auflösung und Sechs-Loch-Grenze bleiben erhalten.

Die Kartenhand ist lesbar horizontal scrollbar statt auf schmalen Geräten zusammengequetscht. Regeln lassen sich rein informativ aufklappen. Spieler und Equipment bleiben auch mobil über ein Details-Element erreichbar. OS-Reduced-Motion und der lokale Bewegungsschalter lassen die Hand sichtbar, ohne dekorative Animationen.

## Testumfang — keine künstliche Vollfreigabe

Lokal durchgeführt: 15/15 neue Adapter-Tests, 4/4 aktualisierte Motion-Source-Guards, 17/17 vorhandene Course-Flight-Tests, Syntaxtranspilation der 5 geänderten TSX-Dateien. Der reine Adapter wird zusätzlich strikt typgeprüft.

Die offline DOM/Canvas-Vorschau läuft mit dem tatsächlichen Adapter und den tatsächlich kompilierten, unveränderten Renderern: 37/37 Chromium-Prüfungen, einschließlich Replay ohne neuen Resolve, Reset, simulierter hidden-tab-Pause, tatsächlicher Intersection-Pause, OS-/App-Reduced-Motion, Putt, Wasserstrafe, v1/v2-Wechsel, Disposal, 320/390/768/1280 Pixel. Keine Anwendungsfehler und keine Netzwerkrequests in diesem Lauf. Die Vorschau enthält fünf unveränderliche Katalogbeispiele aus cards-spin.json, kein aktives Deck und keine erfundenen Artworks.

Die historischen Pass-01–04-Source-Guards wurden an Versionen und die aktuelle Komponentenverdrahtung angepasst, ihre fachlichen API-/Kataloggrenzen bleiben erhalten. Der komplette Recovery-Repository-Testlauf wurde in dieser Sitzung NICHT ausgeführt. React/ReactDOM und der vollständige Originalhost standen in der lokalen Laufzeit nicht bereit. TSX-Syntaxtranspilation ist KEIN React-Mount-Test, KEIN kompletter React-Typecheck und KEIN Live-Build. Safari, physische Mobilgeräte und Windows-Dateiöffnung sind nicht abgenommen.

## Unverändert / Integrationsgrenze

Keine Änderung an `shot-engine.ts`, `course-flight.ts`, `course-scene.ts`, Kartenkatalog, Artwork-Resolver, card-state, Booster-/Starter-Endpunkten, Wallet/Ledger, Preis oder Deckvalidierung. Der wiederhergestellte React-Host verwendet weiter den vorhandenen v1-Renderer. Die lokale Vorschau zeigt zusätzlich das separat gelieferte Canyon-v2-Artwork; das ist KEINE Integration der gemeinsamen Canyon-C.1-/v3-Kandidaten und ersetzt keine unabhängige QA-Linie.

Kein Merge. Kein Deployment. Kein Live-API-Aufruf. Die wartbare ursprüngliche Live-App muss vor Übernahme eindeutig zugeordnet, vollständig gebaut und unabhängig getestet werden. Insbesondere React-Lifecycle/StrictMode, tatsächliche Route-Mounts, Dialoge/Bedienung und bestehende Core-Regressions bleiben Release-Gates.

## Reproduktion

Im vollständigen Recovery-Ordner:

```sh
node tools/verify-emerald-ui.mjs
node --experimental-strip-types --test tests/emerald-presentation.test.mjs tests/emerald-world-pass05.test.mjs tests/course-flight.test.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM src/features/game/emerald-presentation.ts
```

Danach zusätzlich den gesamten vorhandenen `npm test`-/Host-Typecheck ausführen; nicht allein auf Source-Regex-Guards vertrauen.

Das begleitende Chat-Paket `BirdieWorld_Emerald_Pass06_Implementierung.zip` enthält die eigenständige HTML, Quellkopien, Preview-Buildskript/Template, Browser-Testskript, Screenshots, Testprotokolle und SHA-256-Manifest. Die HTML ist eine Entwicklungsvorschau, keine veröffentlichte App.
