# BirdieWorld — Emerald World UI Pass 02 Handoff

Stand: 10.09.2026

## Ziel

Die Golf-/Booster-/Karten-App wird gestalterisch konsequent in dieselbe eigenständige Kunstwelt wie Emerald Canyon geführt: tiefes Emerald, fast schwarze Schluchten/Tiefen, organische Flächen, feine Goldadern und eine ruhige hochwertige Hierarchie.

## Implementiert

- `src/components/EmeraldWorldNav.tsx`: gemeinsame Navigation für Start, Spielen, Scorecard, Karten und Fortschritt; presentation-only, mobile touch targets und reduced-motion berücksichtigt.
- `src/features/home/EmeraldWorldHome.tsx`: neue World-first Home-Oberfläche mit vorhandenen Produktpfaden `/spiel`, `/scorecard`, `/karten`, `/fortschritt` und `/deck`; keine Datenwrites.
- `src/features/scorecard/EmeraldScorecardFrame.tsx`: presentation-only Frame für die bestehende echte Scorecard. Er nimmt vorhandene Controls als `children` auf und erzeugt keine Round-/Score-/Save-Authority.
- `src/features/progress/EmeraldProgressOverview.tsx`: presentation-only Fortschrittsoberfläche; zeigt ausschließlich vom Host übergebene Werte.
- Bestehende maintainable Recovery-Surfaces `GameApp`, `CardVault` und `DeckBuilder` verwenden nun die gemeinsame Navigation und `emerald-world-pass-02`.
- `src/features/index.ts` exportiert die drei neuen Surfaces.
- `tests/emerald-world-pass02.test.mjs` ergänzt Source-Guards für Routen, presentation-only Grenzen und bestehende Authority.

## Bewusst nicht verändert

- `shot-engine.ts`, Course-Flight-Physik und Ergebnisberechnung
- Booster-/Starter-/Deck-Endpunkte und Idempotenz
- Coin-, Wallet-, Ledger- oder Round-Authority
- Kartenkatalog und Artwork-Manifest
- minifizierter historischer `/spiel`-Build

## Integrationsgrenze

Die maintainable Originalquelle des historischen Live-Routers sowie der echten `/scorecard`- und `/fortschritt`-Hosts ist weiterhin nicht belegt. Deshalb sind Home, ScorecardFrame und ProgressOverview in diesem Pass als exportierte, integration-ready React-Surfaces angelegt, aber nicht blind in minifiziertes Deployment-Output gepatcht.

## Verifikation

Der GitHub-Branch enthält Source-Guard-Tests. In dieser Chat-Ausführungsumgebung konnte kein Repository-Checkout für eine lokale Node-Ausführung erfolgen, weil der Container keine DNS-/GitHub-Netzverbindung hatte. Daher kein erfundener Runtime-PASS. Source-Readback über den GitHub-Connector ist erfolgt.

## Release

Kein Merge, kein Deployment, kein Publish, kein Coin-/Wallet-/Round-Effekt.
