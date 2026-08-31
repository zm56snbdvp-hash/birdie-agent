# Birdie Stream — Wall-Art-Showcase

**Aktueller Status: lokale Showcase-Demo `GO`; Wall-Art-Conversion, QR und öffentlicher Stream `STOP`.** Diese Karte autorisiert keinen Livestream, Upload, Post, Kauf, Deployment oder externen Kontakt. Sie nennt absichtlich weder einen Produktpreis noch eine Shop-Adresse: Im Repository ist derzeit beides nicht belastbar belegt.

## Ein Startbefehl

```powershell
npm --prefix apps/desktop run stream
```

Danach ausschließlich lokal öffnen:

`http://127.0.0.1:1421/?mode=stream&demo=loop&quality=low&showcase=wall-art`

Die Ansicht ist auf `1920 × 1080` beziehungsweise dasselbe `16:9`-Seitenverhältnis ausgelegt. `LOCAL SHOWCASE` bezeichnet den synthetischen UI-Lauf; `STREAMING OFF` ist der öffentliche Ausgangsstatus. Runtime, Mikrofonstatus, FPS, Startzeit und Fehlerzähler müssen sichtbar bleiben.

## 72-Sekunden-Demoablauf

| Zeit | Bild / Operator-Cue | Abbruchbedingung |
| ---: | --- | --- |
| 00:00–00:08 | Hook: `LOCAL SHOWCASE`, `STREAMING OFF` und die leere 16:9-Produktfläche zeigen. „Birdie macht Sprache sichtbar — heute mit einer lokal vorbereiteten Wall-Art-Fläche.“ | Streaming-Status, Safe-Area oder Telemetrie nicht lesbar → `STOP` |
| 00:08–00:20 | Produktfläche: `PRODUKTASSET AUSSTEHEND` und `PRODUCT EVIDENCE · UNPROVEN · STOP` offen benennen. | Ein fremdes/ungeprüftes Bild oder ein Preis erscheint → `STOP` |
| 00:20–00:38 | Synthetische Voice-Reaktion `SPEECH_DETECTED → LISTENING → THINKING` zeigen. „Das ist UI-Reaktion, kein Mikrofon- oder STT-Nachweis.“ | Mikrofon- oder Aktions-PASS wird behauptet → `STOP` |
| 00:38–00:52 | `WORKING/SPEAKING/SUCCESS` und die fünf lokalen Telemetrie-Werte zeigen. | Fehlerzähler über null, Status unlesbar oder Layout abgeschnitten → `STOP` |
| 00:52–01:06 | CTA-Fläche zeigen: `SHOP-EVIDENZ · STOP`, `SHOP TARGET UNPROVEN`; kein QR und kein Link. | QR, klickbarer Link, Shop-GO oder Preis erscheint → `STOP` |
| 01:06–01:12 | Abschluss: „Die Show-Fläche steht. Conversion wird erst nach Produkt-, Shop- und QR-Evidence freigegeben.“ Anschließend lokal schließen oder weiter loopen. | Öffentlicher Ausgang oder externe Navigation → `STOP` |

## Aktuelles Conversion-Ledger

| Gate | Beleg | Status |
| --- | --- | --- |
| Produktasset | kein freigegebenes lokales PNG/WebP, kein zugehöriger SHA-256-Produktbeleg | `UNPROVEN / MISSING` |
| Produkt-/Nutzungsrechte | keine im Take gebundene Freigabe | `UNPROVEN` |
| Live-Produktseite / Checkout | keine belegte kanonische Wall-Art-Produktadresse | `MISSING` |
| Preis | keine freigegebene Preis-Evidence | `UNKNOWN` |
| Wall-Art-QR | vorhandener Landingpage-QR ist kein Wall-Art-Produktnachweis | `UNPROVEN / STOP` |
| Runtime-/Voice-Darstellung | lokaler synthetischer 72-Sekunden-Loop | lokal testbar; kein Mic-/STT-Beleg |
| Öffentliche Übertragung | Ausgänge bleiben aus | `STOP` |

Maschinenlesbarer Check:

```powershell
node scripts/check-birdie-stream-readiness.mjs --plan-only
```

`repositoryPlanStatus=PASS` bestätigt nur den sicheren lokalen OBS-/Repository-Vertrag. Die Wall-Art-Blocker und `founderGo=STOP` bleiben bindend.

## Freigabereihenfolge

1. Ein freigegebenes lokales Produkt-Raster (`PNG` oder `WebP`) plus exakten SHA-256 und Rechte-/Produktbeleg bereitstellen.
2. Eine belegte kanonische öffentliche HTTPS-Produktseite mit echtem Checkout-Ziel bereitstellen. Landingpage, Coin-Shop oder synthetischer Test-Link zählen nicht.
3. Optional einen Preis erst nach Freigabe von Produktseite, Währung, Steuer-/Versanddarstellung und Checkout übernehmen; bis dahin bleibt er `UNKNOWN`.
4. CTA, QR-Payload und Shopziel bytegleich an genau diese Produktseite binden; lokale Hash-/Payload-Prüfung bestehen.
5. Einen finalen privaten `1920 × 1080`-MKV-Take prüfen und den QR von einem zweiten Gerät exakt auf dasselbe Ziel decodieren.
6. Erst danach ein separates Founder-GO für den konkret benannten, beaufsichtigten Kanal einholen. Ohne dieses GO bleibt `STREAMING OFF`.

## Fallback

Bei jedem unbekannten Produkt-/Shop-/Preiswert, sichtbarem Secret, Fremdinhalt, aktiver Audioquelle, schwarzem Frame, Layoutfehler oder `ERRORS > 0`: CTA und QR verborgen lassen, lokale Quelle schließen beziehungsweise in OBS über die fokussierte Oberfläche zu `99_SAFE` wechseln und den Take als `STOP` markieren. Kein automatischer Retry und keine Außenaktion.
