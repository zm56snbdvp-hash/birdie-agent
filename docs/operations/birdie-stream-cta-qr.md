# Birdie Stream — CTA-/QR-Freigabefluss

Der aktuelle Stand ist absichtlich `DRAFT`: Eine HTTPS-Zieladresse und ein lokal erzeugtes, gehashtes QR-Raster sind konfiguriert, aber der Scan aus der finalen OBS-MKV und der take-bezogene WebView-Payload-Nachweis fehlen noch. Bei einer historischen read-only Sichtung wirkte die Zielseite wie eine Marken-/Instagram-Landingpage ohne sichtbares Formular oder erkennbare Tracking-Skripte. Dieser visuelle Befund ist kein aktueller Seiten-Audit; Inhalt, Datenschutzverhalten und Erreichbarkeit sind gegenwärtig `UNVERIFIED`. Die Seite ist kein belegter Sale- oder Lead-Tracking-Endpunkt.

## Lokaler Konfigurationsvertrag

In `apps/desktop/public/stream-mode.json` werden nur diese CTA-Felder gesetzt:

```json
{
  "ctaLabel": "BIRDIEWORLD",
  "ctaText": "Die Reise beginnt hier",
  "ctaUrl": "https://birdie-and-breakfast.wnrkgdmqfc.chatgpt.site/",
  "ctaStatus": "DRAFT",
  "qrImage": "/assets/birdie-stream-cta.png",
  "qrTarget": "https://birdie-and-breakfast.wnrkgdmqfc.chatgpt.site/",
  "qrSha256": "c482e0de1e1928c5fa23712bc0373527be963b57fda33070118e97cd911fc228",
  "qrScanVerified": false
}
```

Der Zieltyp kann Instagram, Landingpage oder Shop sein. Er muss eine kanonische öffentliche HTTPS-Seite sein. Ein dedizierter Messpfad wie `/birdie-stream` wäre nur nach ausdrücklicher zukünftiger Konfiguration, Deployment und Verifikation zulässig; der aktuelle Stand behauptet weder diesen Pfad noch dessen Existenz. Tokens oder personenbezogene Queryparameter sind unzulässig. Credentials, Fragment, Querystring, Remote-QR-Bilder, Traversal und percent-encodierte QR-Pfade werden verworfen.

## Founder-Freigabe in genau dieser Reihenfolge

1. Genau ein Ziel und ein Angebot festlegen, zum Beispiel Paid-Pilot-Anfrage.
2. `ctaUrl` und `qrTarget` bytegleich auf die kanonische HTTPS-Adresse setzen.
3. QR offline mit dem gepinnten Einmal-Generator `npx --yes qrcode@1.5.4` erzeugen und als lokales PNG/WebP unter `apps/desktop/public/assets/` ablegen. SVG wird wegen aktiver Inhalte und externer Referenzen abgelehnt.
4. SHA-256 der finalen Assetdatei berechnen und als 64-stelligen Kleinbuchstabenwert in `qrSha256` eintragen.
5. Lokal mit `?mode=stream&demo=loop&qrVerify=local` prüfen: Nur nach Hash- und exaktem Payload-PASS erscheint das Raster als `VERIFY ONLY`; `conversionReady=false` und der Link bleibt gesperrt. Die normale sowie jede Private-CTA-Quelle dürfen keinen Preview-Blob erzeugen.
6. Den lokalen `05_QR_VERIFY`-Take als 1920×1080-MKV aufzeichnen. Nicht nur das Originalbild scannen, weil OBS-Skalierung und Kompression Fehler erzeugen können.
7. Die finale OBS-MKV-Probe auf einem zweiten Gerät scannen und die exakte Zieladresse prüfen.
8. Nur bei exakter Zieladresse `qrScanVerified=true` und `ctaStatus=READY` setzen. Der Runtime-Decode muss über den nativen `BarcodeDetector` oder den gebundenen lokalen `jsQR`-Fallback exakt einen bytegleichen Payload liefern; fehlende Decoder, null/mehrere Codes, Decodefehler oder Mismatch lassen `conversionReady=false`.
9. Read-only-Preflight und einen vollständigen 72-Sekunden-Loop wiederholen.

Die Streamansicht vergrößert echte QR-Assets auf ungefähr 161 px bei 1080p, enthält eine helle Quiet Zone und nutzt pixelgenaue Skalierung. `DRAFT CTA` verschwindet erst, wenn alle Konvertierungsbedingungen erfüllt sind.

## Lokale Abnahme

- sichtbare URL stimmt exakt mit `qrTarget` überein;
- lokaler QR-Pfad enthält weder `..`, `%`, Query noch Fragment;
- Hash stimmt mit dem finalen Asset überein;
- Scan aus der 1920×1080-MKV öffnet das richtige Ziel;
- Zielseite zeigt dasselbe Angebot wie CTA-Text;
- keine Secrets, Login-Parameter oder persönlichen Kennungen im URL-Bild;
- `window.__birdieStream.getMetrics().config.conversionReady === true`;
- `qrAssetHashVerified=true`, `qrPayloadVerified=true` und `qrPayloadStatus=PASS`; das decodierte Ziel selbst wird nicht in Evidence kopiert;
- `node scripts/check-birdie-stream-readiness.mjs --plan-only` meldet `repositoryPlanStatus=PASS`, und `qrAssetEvidence=PASS` weist den SHA-256 der tatsächlich gelesenen Rasterdatei nach. Der normale Aufruf bleibt bis zur vollständigen OBS-/Soak-/MKV-Evidenz absichtlich mit `founderGo=STOP` ungleich null.

Der private CTA-Test unterdrückt jedes konfigurierte QR-Asset unabhängig von dessen Status. Er kann daher nie als versteckter öffentlicher Scanpfad dienen.

Bis dahin ist die Demo ausschließlich als stille, synthetische lokale UI-Demo vorführbar. Der aktuelle Founder- und Conversion-Status bleibt `STOP`.
