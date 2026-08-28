# Birdie Drop & Birdie Lens – Architekturentscheidung

Status: implementiert als lokaler Capture-Pfad mit einem fail-closed serverseitigen Backend-Scaffold. Der Capture-Vertrag ist dokumentiert, aber noch nicht für Produktionsverkehr freigegeben.

## Entscheidung

`CaptureCore` ist ein extension-sicheres iOS-Framework, das `CaptureItem`, die App-Group-Ablage, Staging, Queue-Zustände, Retry und den versionierten Übergabevertrag enthält. `BirdieShare` übernimmt URLs, Text, Bilder, PDFs und Dateien in einen geschützten lokalen Staging-Bereich. Die Extension führt keine Netzwerkoperation aus. `BirdiePhone` verarbeitet die Queue und `Birdie Lens` nutzt Vision/VisionKit für lokale OCR.

Die vorhandenen Watch-, Mail-, Sprach- und Komplikationspfade bleiben getrennt. Insbesondere werden weder `WatchRelay` noch Watch-Credentials für Capture wiederverwendet.

## Datenfluss

1. Birdie Drop kopiert Dateirepräsentationen per `NSFileCoordinator` in die App Group. Text und URLs bleiben als geschützter lokaler Manifestinhalt; URLs werden nicht automatisch geladen.
2. Erst nachdem alle Teile erfolgreich übernommen wurden, schreibt die Extension atomar `Items/<capture-id>.json`. Ein abgebrochener Vorgang entfernt sein Staging-Verzeichnis.
3. Die Haupt-App liest dieselben Eintragsdateien. Ein persistenter Schlüssel `capture.v1.<uuid>` bleibt über alle Retry-Versuche stabil. Ein opaker Pending-Open-Marker wählt den Eintrag beim nächsten manuellen App-Start aus; die registrierte URL `birdie://capture/<uuid>` kann denselben Pfad von zulässigen Aufrufern öffnen. Die Share Extension behauptet keinen direkten App-Start, weil iOS diesen für Share Extensions nicht verlässlich unterstützt.
4. Der aktuelle `LocalCaptureMockAdapter` schreibt ausschließlich ein versioniertes Prüfmanifest in `MockOutbox`. Er verwendet kein `URLSession`, meldet keine externe Zustellung und löst keine Aktion aus.
5. Ein späterer, separat geprüfter Adapter darf längere Dateiübertragungen nur aus der Haupt-App starten. Dafür ist eine Background-`URLSession` vorgesehen; die Share Extension bleibt davon frei.

Queue-Zustände: `staged/queued → processing → readyForReview`. Transiente Adapterfehler führen mit 30 Sekunden, 2 Minuten, 10 Minuten und 1 Stunde Backoff zu `retryScheduled`; danach folgt `failed`. Ein nach App-Abbruch länger als fünf Minuten verbliebener `processing`-Eintrag wird erneut aufgenommen. Der Queue-Prozessor ist als Actor serialisiert.

## Lokaler Vertrag

`CaptureSubmissionRequest` verwendet den stabilen Token `birdie.capture.v1` und enthält:

- `captureID` und `idempotencyKey`
- Erstellzeit, Quelle und eines der Ziele `remember`, `summarize`, `prepareTask`, `sendToPC`
- Teile mit Typ, Anzeigename, UTType, Größe und optionalem SHA-256; lokale Pfade werden nicht exportiert
- OCR-Vorschläge
- `requiresUserReview: true`
- `originalPolicy: derivedTextOnly | includeOriginals`

Ein Request wird abgelehnt, solange die lokale Übernahme nicht bestätigt ist. `derivedTextOnly` darf keine Bild-, PDF- oder Datei-Originale enthalten. Vor der lokalen Adapterübergabe werden Größe und SHA-256 jeder staged Datei erneut geprüft; veränderte Dateien enden ohne Outbox-Schreibvorgang als permanenter Vertragsfehler.

Ein möglicher HTTP-Vertrag ist bewusst **nicht aktiviert**. Der vorgeschlagene Vertrag ist in [BIRDIE_CAPTURE_BACKEND_CONTRACT.md](BIRDIE_CAPTURE_BACKEND_CONTRACT.md) versioniert. Vor einem Produktionsadapter müssen Authentifizierung, Upload-Handshake, serverseitige Idempotenz, PC-Adressierung und Aufbewahrung separat freigegeben werden. Watch-Token sind dafür ausgeschlossen.

## Lens und Datenschutz

- Kamera-Berechtigung wird erst nach dem Tap auf „Mit Kamera scannen“ angefragt.
- `PhotosPicker` gewährt nur Zugriff auf das ausgewählte Bild; eine globale Fotomediathek-Berechtigung ist nicht nötig.
- `VNRecognizeTextRequest` läuft lokal. Profile: Dokument, Rechnung, Visitenkarte, Whiteboard und Fehlermeldung.
- Ergebnisse sind Vorschläge. Die App legt keine Kontakte, Aufgaben, Mails oder Termine an.
- Originalseiten bleiben vor Bestätigung nur im Speicher. „Originalseiten lokal beilegen“ ist standardmäßig aus; bei Abbruch oder Hintergrundwechsel werden unbestätigte Bilder und OCR-Daten verworfen.
- App-Group-Dateien verwenden `NSFileProtectionComplete`. In inaktiver oder gesperrter Scene ersetzt eine Schutzansicht alle sensiblen Inhalte.
- E-Mail-, Telefon-, IBAN- und Kartenmuster werden in Lens-Vorschauen standardmäßig redigiert. Der Anwender kann die unredigierte Vorschau nur im aktiven, entsperrten Zustand einblenden.
- Löschen entfernt Manifest und ausschließlich die diesem Capture zugeordneten Staging-Dateien.

Limits: maximal 20 Teile, 1 MB Text, 100 MB pro Datei und 250 MB insgesamt. Symlinks und Verzeichnisse werden abgelehnt; verwaistes Staging wird nach einer Stunde bereinigt.

## Prüfung

Plattformneutral:

```sh
node --test test/apple-capture-contract.test.mjs
```

Auf macOS:

```sh
cd clients/apple
xcodegen generate
xcodebuild -project Birdie.xcodeproj -scheme BirdieCaptureTests \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
xcodebuild -project Birdie.xcodeproj -scheme Birdie \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Der vorhandene Personal-Workflow kann den unsignierten Gesamt-Build auf macOS ausführen. `clients/apple/scripts/verify-capture.sh` prüft zusätzlich beide XcodeGen-Specs, den unsignierten Standard-Build, Swift-Unit-Tests, die korrekte Einbettung von Extension und Framework sowie einen Install-/Launch-Smoke auf einem iOS-Simulator. Weil das bereits auf `main` vorhandene Watch-Widget-Bundle dort ohne `NSExtension`-Dictionary nicht installierbar ist, verwendet nur der disposable iPhone-Smoke eine Kopie ohne `Watch/`; der geprüfte Build bleibt unverändert und Watch-Code wird nicht angefasst. Das Skript wird vor dem Draft-PR auf einem isolierten CI-Verifikationsbranch aufgerufen, damit die parallel laufende Watch-Toolchain-Arbeit in PR #60 nicht überschrieben wird.

## Kurzer manueller Smoke-Test

1. App auf einem entsperrten iPhone starten; die Tabs Drop, Lens und Watch müssen sichtbar sein, das vorhandene Watch-Setup unverändert.
2. Aus Safari eine URL und aus Dateien je ein PDF/Bild mit Birdie Drop teilen. Vorschau prüfen, jedes der vier Ziele einmal auswählen, anschließend „Lokal übernehmen“.
3. Flugmodus aktivieren, einen weiteren Eintrag übernehmen, Birdie öffnen und prüfen, dass der Eintrag lokal erhalten bleibt und keine externe Zustellung behauptet wird.
4. Birdie nach dem Share-Vorgang manuell öffnen und prüfen, dass der vorgemerkte Eintrag ausgewählt wird. Zusätzlich einen Eintrag von einem zulässigen Test-Aufrufer per `birdie://capture/<uuid>` öffnen, Retry auslösen und anschließend löschen; Eintrag und Vorschau müssen verschwinden.
5. In Lens jedes Profil öffnen, Kamera erst auf Tap erlauben, einen Beispielscan OCR-verarbeiten lassen und Vorschläge prüfen. Abbrechen muss Bilder und Text verwerfen.
6. Einen Scan zunächst ohne, dann mit aktiviertem Original-Schalter übernehmen. Nur der zweite Eintrag darf Bildteile enthalten.
7. Das Gerät bei sichtbarer OCR-Vorschau sperren beziehungsweise den App-Switcher öffnen. Es darf nur die Schutzansicht sichtbar sein.

Kamera, Host-Verhalten des Share-Sheets, App-Group-Provisionierung und Sperr-Snapshot müssen auf einem realen Gerät abschließend geprüft werden; Simulator- und Contracttests können diese Betriebssystemgrenzen nicht beweisen.
