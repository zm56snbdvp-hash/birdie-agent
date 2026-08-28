# Birdie Recall V1

## Zweck und Datenschutzgrenze

Birdie Recall speichert nur Inhalte, die eine Person ausdrücklich in der
iPhone-App auswählt oder die Birdie Drop ausdrücklich als `CaptureItemV1`
übergibt. V1 akzeptiert genau die Herkunftskanäle `manualSelection` und
`birdieDrop` sowie die Typen `link`, `screenshot`, `photo`, `pdf` und `note`.

Recall durchsucht weder die gesamte Fotomediathek noch Benachrichtigungen,
Zwischenablage, Nachrichten oder andere App-Daten. Der iOS-Fotopicker gibt nur
das ausgewählte Bild weiter; der Dateipicker erlaubt genau ein ausgewähltes
PDF. Links werden gespeichert, aber nicht automatisch geöffnet oder
abgerufen. Es gibt keinen Upload-, Sync-, Backend- oder Embedding-Aufruf.
Explizit übergebener extrahierter Text wird übernommen; fehlt er bei einer
bewusst ausgewählten Bild- oder PDF-Datei, versucht ein lokaler
Vision-/PDFKit-Adapter best-effort die Textextraktion. Optionale
Zusammenfassungen werden ausschließlich mit dem Capture übergeben.

## Datenmodell

`CaptureItemV1` ist das kleine Übergabeobjekt. Nach erfolgreicher Prüfung wird
daraus ein `RecallItemV1` mit folgenden dauerhaft gespeicherten Informationen:

| Bereich | Gespeicherte Daten |
| --- | --- |
| Identität | stabile `UUID`, `schemaVersion = 1` |
| Inhalt | Typ, Titel, Tags, optional Notiz, HTTP(S)-URL, extrahierter Text und Zusammenfassung |
| Herkunft | Kanal, optionale Quell-App, optionale Quell-ID, Übergabezeit |
| Zeit | Erfassungszeit und lokale Erstellungszeit |
| Aufbewahrung | Status `kept`, `expires` oder vorübergehend `pendingDeletion`; optionales Ablaufdatum |
| Datei | ursprünglicher Dateiname, UTI, Bytezahl und SHA-256; der interne Dateipfad bleibt ein Implementierungsdetail |

Die stabile Capture-ID ist zugleich die Recall-ID. Ein identischer Retry mit
derselben ID ist idempotent und liefert das vorhandene Element. Dieselbe ID
mit abweichendem, kanonisch geprüftem Inhalt wird als `duplicateConflict`
abgewiesen. Unbekannte Vertragsversionen scheitern geschlossen.

Die Herkunftsfelder beschreiben die Angabe des Intake-Aufrufers; V1
authentifiziert `sourceApplication` oder `sourceItemIdentifier` nicht als
externe Attestation.

## Öffentlicher Intake-Vertrag

Der öffentliche Swift-Vertrag liegt in
`clients/apple/BirdiePhone/Recall/RecallContracts.swift`:

```swift
public struct CaptureItemV1: Codable, Hashable, Identifiable, Sendable {
    public static let currentContractVersion = 1

    public let contractVersion: Int
    public let id: UUID
    public let kind: RecallItemKindV1
    public let title: String
    public let provenance: RecallProvenanceV1
    public let capturedAt: Date
    public let tags: [String]
    public let note: String?
    public let linkURL: URL?
    public let localFileURL: URL?
    public let contentTypeIdentifier: String?
    public let extractedText: String?
    public let summary: String?
    public let retention: RecallRetentionRequestV1
}

public protocol BirdieRecallIntakeV1: Sendable {
    @discardableResult
    func ingest(_ capture: CaptureItemV1) async throws -> RecallItemV1
}
```

`RecallProvenanceV1` enthält `channel`, optional `sourceApplication`, optional
`sourceItemIdentifier` und `submittedAt`. Die Aufbewahrungsanforderung ist
`.defaultPolicy`, `.keepForever` oder `.until(Date)`.

Die Payload-Regeln sind typabhängig und gegenseitig ausschließend:

| Typ | Erforderliche Payload | Abgewiesene Kombinationen |
| --- | --- | --- |
| `note` | nichtleere `note` | URL oder Datei |
| `link` | vollständige `http`- oder `https`-URL mit Host | Notiz, Datei oder anderes URL-Schema |
| `screenshot`, `photo` | bewusst ausgewählte lokale Bilddatei und gültiger Bild-UTI | Notiz, URL oder Nicht-Bild |
| `pdf` | bewusst ausgewählte lokale PDF-Datei und PDF-UTI | Notiz, URL oder Nicht-PDF |

Zusätzlich gelten maximal 500 Zeichen für den Titel, 20 normalisierte Tags zu
je maximal 50 Zeichen, 200.000 Zeichen für Notizen, 500.000 für extrahierten
Text, 20.000 für Zusammenfassungen und 100 MiB pro Datei. Recall liest eine
security-scoped Datei nur für die Übernahme, verifiziert sie per SHA-256,
kopiert sie in den eigenen geschützten Bereich und verändert die Quelldatei
nicht. Nach der Kopie wird der Inhalt selbst geprüft: Bilder müssen über
ImageIO bis zu den Pixeln des ersten Frames decodierbar sein, PDFs über PDFKit
mindestens eine Seite liefern. Die
gespeicherte UTI stammt aus dieser Prüfung, nicht bloß aus der Behauptung des
Intake-Aufrufers.

Beispiel für die spätere Birdie-Drop-Übergabe:

```swift
let capture = CaptureItemV1(
    id: stableDropUUID,
    kind: .link,
    title: "Hotel Seeblick",
    provenance: RecallProvenanceV1(
        channel: .birdieDrop,
        sourceApplication: "Birdie Drop",
        sourceItemIdentifier: stableDropItemID,
        submittedAt: submittedAt
    ),
    capturedAt: capturedAt,
    tags: ["Reise", "Hotel"],
    linkURL: URL(string: "https://example.com/hotel")!,
    extractedText: explicitlyProvidedText,
    summary: explicitlyProvidedSummary,
    retention: .defaultPolicy
)

let stored = try await recallIntake.ingest(capture)
```

Birdie Drop darf bei Datei-Captures nur eine lokal verfügbare, vom Nutzer
ausgewählte Datei-URL übergeben. Es darf weder eine Cloud-URL als
`localFileURL` tarnen noch Recall zu einem Quellenscan verwenden.

## Öffentlicher Suchvertrag

```swift
public struct RecallSearchFiltersV1: Codable, Hashable, Sendable {
    public var sourceChannels: Set<RecallIntakeChannelV1>
    public var kinds: Set<RecallItemKindV1>
    public var capturedFrom: Date?     // einschließlich
    public var capturedBefore: Date?   // ausschließlich
}

public struct RecallSearchQueryV1: Codable, Hashable, Sendable {
    public static let currentContractVersion = 1
    public let contractVersion: Int
    public var text: String
    public var filters: RecallSearchFiltersV1
    public var limit: Int              // 1...200, Standard 50
}

public struct RecallSearchResultV1: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID { item.id }
    public let item: RecallItemV1
    public let score: Double
    public let matchedTerms: [String]
}

public protocol BirdieRecallSearchV1: Sendable {
    func search(_ query: RecallSearchQueryV1) async throws
        -> [RecallSearchResultV1]
}
```

Leere Filtermengen bedeuten „alle Quellen“ beziehungsweise „alle Typen“.
Datumsfilter sind harte Grenzen. Text- und Filterbedingungen werden gemeinsam
angewendet; abgelaufene oder zur Löschung markierte Elemente werden nicht
geliefert.

## Deterministische lokale Suche

Die lokale Suche benötigt keine Apple-Intelligence-Hardware, kein Modell und
kein Netzwerk. Der verschlüsselt gespeicherte Index normalisiert Groß- und
Kleinschreibung sowie Diakritika und gewichtet Treffer deterministisch:

| Feld | Gewicht |
| --- | ---: |
| Titel | 6 |
| Tag | 5 |
| Dateiname oder Link-Host | 3 |
| URL oder Zusammenfassung | 2 |
| Notiz | 1,5 |
| extrahierter Text oder Quell-App | 1 |

Exakte Terme erhalten das volle Gewicht; Präfixtreffer ab vier Zeichen 65 %.
Bei gleicher Punktzahl folgen neueres Erfassungsdatum und danach die stabile
UUID. Dadurch bleiben Ergebnisreihenfolgen reproduzierbar.

„gestern“/`yesterday`, „heute“/`today`, „vorgestern“ und ein Datum im Format
`YYYY-MM-DD` werden als lokales Tagesfenster interpretiert. Deshalb findet
beispielsweise „Wo war das Hotel von gestern?“ einen gestrigen Eintrag mit dem
Term „Hotel“. Diese Erkennung ist bewusst klein und regelbasiert, nicht
allgemeines Sprachverständnis.

`RecallSemanticRanking` ist ein optionaler Adapterpunkt. V1 verwendet
`NoopRecallSemanticRanker`. Wenn ein späterer Adapter fehlschlägt, gibt das
Repository weiterhin die deterministischen lokalen Ergebnisse zurück.

Beim Start wird ein inkonsistenter lokaler Index aus den aktiven Elementen
neu aufgebaut. Der Index enthält gewichtete Terme, keine separaten
Originaldateien.

## Core Spotlight und Deep Links

Core Spotlight ist standardmäßig ausgeschaltet und muss in den
Recall-Einstellungen ausdrücklich aktiviert werden. Der private Index nutzt
die Protection Class `complete`, die Domain
`de.birdieandbreakfast.birdie.recall.v1` und ist weder für Public Indexing noch
für Handoff freigegeben. Übergeben werden nur Titel, ein auf 240 Zeichen
gekürzter Ausschnitt aus Zusammenfassung, Notiz oder extrahiertem Text, Tags,
Typ, Erfassungsdatum, Ablaufdatum und der Deep Link. Dauerhaft aufbewahrte
Elemente erhalten für Spotlight ein fernes Ablaufdatum. Originaldatei und
Thumbnail werden nicht an Spotlight übergeben.

Jedes Element besitzt den Deep Link:

```text
birdie://recall/item/<uuid-in-kleinbuchstaben>
```

Die App akzeptiert nur dieses Schema, diesen Host und genau diesen Pfad. Sie
öffnet nur eine UUID, die noch im lokalen Recall-Bestand existiert, wechselt
zum Recall-Tab und navigiert zum Detail. Beim Abschalten von Spotlight, bei
Löschung und beim Kill-Switch wird die gesamte Recall-Spotlight-Domain
bereinigt und aus den verbleibenden aktiven Elementen gegebenenfalls neu
aufgebaut. Schlägt die Systemindex-Bereinigung fehl, bleibt ein Sync-Marker
für den nächsten `prepareForUse()`-Versuch erhalten und der Fehler wird
sichtbar gemacht. Eine Reparatur des lokalen Index darf diesen Marker auch bei
deaktiviertem Spotlight nicht zurücksetzen.

## Lokaler Schutz

Der Live-Bestand liegt unter `Application Support/BirdieRecall/V1` und wird
nicht in iCloud oder einen Birdie-Backenddienst geladen.

- `recall-store.v1.vault` enthält Einstellungen, Metadaten, Intake-Fingerprints,
  Löschbelege und den lokalen Suchindex. Sein JSON-Klartext wird mit AES-GCM
  verschlüsselt; das Dateiformat beginnt mit `BRV1`.
- Der Live-Zugriff verwendet pro App-Prozess genau einen serialisierten
  Repository-Actor. Zusätzlich vergleicht jeder Vault-Commit die erwartete
  persistierte Revision unter einem Prozess-Lock; veralteter Zustand darf
  neuere Daten nicht überschreiben.
- Ein zufälliger 256-Bit-Schlüssel liegt im Keychain unter
  `de.birdieandbreakfast.birdie.recall` / `recall-vault-key-v1` mit
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Er wird nicht zwischen
  Geräten synchronisiert.
- Unter iOS erhalten Vault, Verzeichnisse und lokale Dateikopien
  `NSFileProtectionComplete`. Der gesamte Recall-Bereich wird von Geräte- und
  iCloud-Backups ausgeschlossen.
- Die kurzlebige Datei, die der System-Fotopicker für eine bewusste Auswahl
  erzeugt, erhält ebenfalls `NSFileProtectionComplete` und wird nach
  Intake-Erfolg, Fehler oder Task-Abbruch entfernt.
- Ausgewählte Bild- und PDF-Originale werden als separate lokale Dateien
  gespeichert. Sie sind durch iOS Data Protection geschützt, aber in V1 nicht
  zusätzlich als AES-GCM-Payload verschlüsselt. Metadaten enthalten SHA-256
  und Bytezahl; kanonisierte Pfade verhindern Zugriff außerhalb des
  Attachment-Verzeichnisses.

Der Schutz gilt für den App-Speicher. Ein ausdrücklich erzeugter Export hat
eine andere Grenze und ist, wie unten beschrieben, unverschlüsselt.

## Aufbewahrung, Löschen und Kill-Switch

Die Standardaufbewahrung beträgt 30 Tage. Zulässig sind 1 bis 3.650 Tage oder
`nil` für dauerhaftes Behalten. Ein Capture kann die Standardrichtlinie
verwenden, dauerhaft bleiben oder ein zukünftiges fixes Ablaufdatum setzen.
Eine geänderte Standarddauer kann optional auf vorhandene Elemente angewendet
werden. Abgelaufene Elemente werden beim Vorbereiten des Repository, vor
Suche und Export sowie nach einer passenden Einstellungsänderung über
denselben auditierten Löschpfad entfernt. Listen, Suche, Export und Spotlight
schließen ein inzwischen abgelaufenes Element auch dann aus, wenn eine
optionale Spotlight-Bereinigung erneut versucht werden muss.

Einzellöschung, Löschung einer ausgewählten ID-Menge, `forgetAll()` und
Ablaufbereinigung folgen einem wiederaufnehmbaren Ablauf:

1. Die Operation wird mit stabiler Operations-ID als `pendingDeletion`
   gespeichert und die IDs werden aus dem lokalen Suchindex entfernt.
2. Lokale Dateikopien werden gelöscht.
3. Datensätze werden entfernt und ein `RecallDeletionReceiptV1` wird im
   verschlüsselten Vault angehängt.
4. Falls nötig, wird Core Spotlight bereinigt beziehungsweise neu aufgebaut.

Eine beim Prozessabbruch offene Löschung wird beim nächsten
`prepareForUse()` fortgesetzt. Beim Start werden außerdem nicht mehr von einem
Vault-Datensatz referenzierte Attachment-Verzeichnisse entfernt; so bleibt
auch ein Prozessabbruch zwischen Dateikopie und Vault-Commit nicht als
unerreichbares Original liegen. Ein Löschbeleg enthält Beleg-ID,
Operations-ID, Scope, Grund, Anforderungs- und Abschlusszeit sowie die
gelöschten UUIDs, aber keinen Titel, Text, Link oder Dateiinhalt. Unterstützte
Scopes sind `singleItem`, `selectedItems`, `expiredItems`, `allItems` und
`killSwitch`.

Der Kill-Switch speichert „deaktiviert“, alle betroffenen
`pendingDeletion`-Marker und die Bereinigung des lokalen Index in derselben
Transaktion, löscht danach sämtliche Attachment-Verzeichnisse und schließt
erst dann den Löschbeleg ab. Ein deaktivierter Bestand mit noch vorhandenen
Elementen wird beim nächsten Start zwingend als unterbrochene
Kill-Switch-Löschung fortgesetzt. Danach
scheitern Intake und Suche mit `disabled`. Ein späteres explizites
`enableRecall()` reaktiviert einen leeren Recall-Bestand; Löschbelege bleiben
als lokale Auditspur erhalten.

## Bewusster Export

`makePortableExport()` wird nur durch eine ausdrückliche Nutzeraktion
aufgerufen. Der JSON-Export enthält ein versioniertes Manifest mit
Exportzeitpunkt, Einstellungen, nicht zur Löschung markierten Elementen,
Löschbelegen und der
Zuordnung der Attachments. Dateidaten sind im JSON als Base64 codiert.

Der Export ist nicht verschlüsselt. Nach Übergabe an den iOS-Dateiexporter
unterliegt er dem vom Nutzer gewählten Speicherort und kann sensible Texte,
URLs, Metadaten, Lösch-UUIDs und Originaldateien enthalten. Es gibt keinen
automatischen Export und keinen automatischen Cloud-Upload.

Beim Wechsel in den Hintergrund werden laufende ViewModel-Tasks abgebrochen,
eine Intake-Epoche im Repository invalidiert und alle im ViewModel gehaltenen
Items, Suchtreffer und Exportdaten geleert. Eine bereits laufende lokale
OCR-/PDF-Extraktion darf danach kein Capture mehr committen.

## Tests, reproduzierbarer Smoke-Test und unsignierter Build

Voraussetzungen sind macOS mit Xcode/iOS-18-Simulator, XcodeGen und `jq`. Vom
Repository-Root aus:

```bash
cd clients/apple
xcodegen generate

runtime="com.apple.CoreSimulator.SimRuntime.iOS-$(xcrun --sdk iphonesimulator --show-sdk-version | tr '.' '-')"
simulator_udid="$(
  xcrun simctl list devices available --json |
    jq -r --arg runtime "$runtime" '
      (.devices[$runtime] // [])
      | map(select(.isAvailable == true and (.name | startswith("iPhone"))))
      | first
      | .udid // empty
    '
)"
test -n "$simulator_udid"
xcrun simctl boot "$simulator_udid" 2>/dev/null || true
xcrun simctl bootstatus "$simulator_udid" -b
```

Die gesamte iPhone-Testsuite einschließlich Intake-/Privacy-, Search-,
Deletion- und Export-Tests:

```bash
xcodebuild \
  -project Birdie.xcodeproj \
  -scheme Birdie \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_udid" \
  -destination-timeout 120 \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  test
```

Der reproduzierbare Recall-Smoke-Test verwendet den festen Zeitpunkt
`2026-08-28T12:00:00Z`, die feste ID
`77777777-7777-4777-8777-777777777777` und einen gestrigen Birdie-Drop-Eintrag
„Hotel Speicherstadt“. Er prüft Intake, „Hotel von gestern?“, Export,
Löschung und einen leeren lokalen Index:

```bash
xcodebuild \
  -project Birdie.xcodeproj \
  -scheme Birdie \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_udid" \
  -destination-timeout 120 \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  -only-testing:BirdiePhoneTests/RecallExportSmokeTests/testReproducibleSmokeHotelYesterdaySearchExportDelete \
  test
```

Unsignierter Apple-Build:

```bash
xcodebuild \
  -project Birdie.xcodeproj \
  -scheme Birdie \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

Für das Personal-Team-Projekt werden stattdessen
`xcodegen generate --spec project.personal.yml`,
`BirdiePersonal.xcodeproj` und das Scheme `BirdiePersonal` verwendet. Die
Workflows `.github/workflows/apple-build.yml` und
`.github/workflows/apple-personal-project.yml` führen Projektgenerierung,
iPhone-Tests und unsignierten Build auf `macos-15` aus; der Personal-Workflow
führt zusätzlich die bestehende Repository-Testsuite mit `npm test` aus.

## Bekannte Grenzen von V1

- Lokale Vision-OCR und PDFKit-Textextraktion sind best-effort und können leer
  bleiben; es gibt keine automatische Link-Metadaten- oder
  Zusammenfassungserzeugung.
- Kein semantisches Modell in V1. Natürliche Sprache bedeutet derzeit
  deterministische Term-/Präfixsuche plus die dokumentierten kleinen
  Datumsregeln.
- Keine Cloud-Synchronisation, geräteübergreifende Suche, Share Extension oder
  fertige Birdie-Drop-Transportimplementierung.
- Kein separates, app-eigenes AES-GCM-Envelope für Bild-/PDF-Dateikopien; sie
  verlassen sich auf `NSFileProtectionComplete`. Der Metadaten- und
  Index-Vault ist AES-GCM-verschlüsselt.
- Spotlight ist ein lokaler iOS-Systemindex außerhalb des Recall-Vaults. Das
  Opt-in übergibt die oben genannten begrenzten Metadaten an diesen Index.
- Löschbelege werden nicht automatisch ausgedünnt und behalten UUIDs,
  Zeitpunkte, Scope und Grund. Der bewusste JSON-Export ist unverschlüsselt.
- Der portable JSON-Export lädt Attachment-Daten für die Base64-Codierung in
  den Speicher; V1 hat noch keinen streamingfähigen Archivexport.
- Ein verlorener oder dauerhaft unzugänglicher Keychain-Schlüssel wird nicht
  über eine Recovery- oder Migrationsoberfläche ersetzt; der vorhandene Vault
  scheitert geschlossen statt unverschlüsselt gelesen zu werden.
- Sensitive ViewModel-Daten werden bei `.background` geleert. V1 blendet bei
  `.inactive` noch kein eigenes Privacy-Overlay über den App-Switcher-Snapshot.
- V1 zielt auf iOS 18; der 100-MiB-Grenzwert ist fest. Migrationen über
  `schemaVersion = 1` hinaus sind noch nicht implementiert und unbekannte
  Versionen werden abgewiesen.

## Genau der nächste Birdie-Drop-Integrationsschritt

Birdie Drop muss als nächsten und einzigen Integrationsschritt seinen bereits
bewusst ausgewählten Inhalt in genau ein `CaptureItemV1` mit
`contractVersion = 1`, `provenance.channel = .birdieDrop`, stabiler UUID und
gegebenenfalls einer security-scoped lokalen Datei-URL abbilden und dieses
Objekt über die injizierte `any BirdieRecallIntakeV1`-Instanz an
`ingest(_:)` übergeben; Recall-Repository, Speicher- oder Indexinternas dürfen
dabei nicht importiert oder dupliziert werden.
