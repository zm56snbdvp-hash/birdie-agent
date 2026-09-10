# BIRDIE 5 — Canyon v2 Integration Handoff

Stand: 10.09.2026

## Zweck

Diese Ablage ist ausschließlich die Übergabe des BIRDIE-5-Integrations-Scouts für die echte BirdieWorld-Schlag/Karten/Score-App. Sie enthält keine Deployment- oder Produktionsänderung.

## WICHTIG — ROUND 2

`ROUND2_RECOVERED_HANDLER.md` zuerst nach diesem README lesen.

Seit dem ersten Scoutlauf ist ein zusätzliches gespeichertes Recovery-/Founder-Test-Artefakt gefunden und tatsächlich gelesen worden. Dadurch ist der **recovered compiled Shot-Handler** jetzt eindeutig lokalisiert: `GameApp` (`Xe`) → `On()` → genau ein Engine-Aufruf `o(...)` / Engine-Export `a` (`Vn`) → danach Result-/Shot-/Position-/Remaining-/Lie-State-Commit.

Damit ist der alte Satz „Shot-Handler nicht identifiziert“ für den recovered compiled Host überholt. Weiterhin **nicht belegt** sind jedoch der originale lesbare Codex/Sites-Quellbaum und die Identität der heutigen Live-Revision. Daher bleibt jede direkte Produktionsintegration gesperrt.

## Kanonische Ablagen

### Google Drive
Ordner: `Emerald_Canyon_v2__Chat_Birdies / 03_ERGEBNISSE / BIRDIE_5_App_Integration`

- ZIP: https://drive.google.com/file/d/1fqjp9gqr5BTDdLIlq3DKe1BIIcPc3ej_/view?usp=drivesdk
- Integrationsprotokoll: https://drive.google.com/file/d/11oHoDBSZJLai44D3z_B8x4Iy02w1ldKX/view?usp=drivesdk
- Quellenregister: https://drive.google.com/file/d/1B6xkGqKT2rL1My1QpUcmHdj-44am5mZY/view?usp=drivesdk
- Handoff-README: https://drive.google.com/file/d/1PEbsr22d_sQWLhZRhBJx5-K7F5qH2eXq/view?usp=drivesdk
- Zentraler Canyon-v2-Startpunkt: `00_START_HIER — CANYON V2 — CHAT BIRDIES`

### GitHub
Repository: `zm56snbdvp-hash/birdie-agent`
Handoff-Branch: `handoff/birdie5-canyon-v2-integration-20260910`
Ursprüngliche Basis: `feature/birdieworld-course-flight-v1-20260910` @ `ba8c08e866d2633c7fb9e02e267ad52d38c1850c`

Pfad im Branch: `integration/canyon-v2/`

## Reihenfolge für die Fortsetzung

1. Dieses README lesen.
2. `ROUND2_RECOVERED_HANDLER.md` lesen — neuester Stand zum recovered Host.
3. `INTEGRATIONSPROTOKOLL.md` als ursprünglichen Scoutbefund lesen; dortige „v2 fehlt“- und „Handler nicht identifiziert“-Aussagen sind historischer Stand und werden durch Round 2 teilweise superseded.
4. `QUELLEN.md` als fixiertes Quellenregister des ersten Scoutlaufs verwenden.
5. Canyon v2 aus dem zentralen Drive-OS lesen; `README_CANYON_V2.md` ist dort inzwischen verfügbar.
6. Nächster sicherer Build-Schritt: lokaler recovered-host integration candidate gegen den identifizierten `On()`-Slot. Keine zweite `simulateShot`-Auflösung und keine Progress-/Coinwrites bei Animationsende.
7. Vor jeder echten App-/Live-Integration aktuelle Source-/Deployment-Identität erneut belegen. Einen historischen minifizierten Bundle niemals blind als aktuelle Produktion behandeln.

## Statushinweis

Die Aussage im ursprünglichen Scout-Protokoll, dass das Repository während der Untersuchung unverändert blieb und keine Pushes erfolgten, beschreibt den ersten Scout-Lauf selbst. Danach wurde auf ausdrückliche Nutzeranweisung ausschließlich Handoff-Dokumentation auf diesen separaten Branch geschrieben. Der untersuchte Feature-Branch und Produktcode wurden dadurch nicht verändert.

**Aktueller Stand:** `RECOVERED_HANDLER_IDENTIFIED`; `ORIGINAL_SOURCE_UNPROVEN`; `CURRENT_LIVE_REVISION_UNPROVEN`; `NO_DEPLOYMENT`.
