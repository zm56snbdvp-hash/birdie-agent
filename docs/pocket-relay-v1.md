# Pocket Relay v1

## Ziel und Sicherheitsgrenze

Pocket Relay macht das iPhone zu einer eng begrenzten, nachvollziehbaren
Fernbedienung. Es ist ausdrücklich **kein** Remote-Shell-, Remote-Desktop-,
Clipboard- oder allgemeiner Dateisystemzugang. Der bestehende Watch-Bearer,
`/watch/command`, BirdieOS-Query-Keys und die lokale Desktop-Pipe aus PR #64
sind keine geeigneten Remote-Sicherheitsgrenzen und werden nicht verwendet.

Der in diesem Slice enthaltene Host ist ausschließlich ein loopback-gebundener
Mock. Er simuliert Effekte und markiert `productionEffectsEnabled: false`.
Es wird kein Produktionsendpunkt in `server.mjs` aktiviert.

## Architektur

```text
iPhone UI
  -> explizite Review (Ziel, Scope, Daten, Effekt)
  -> persistente Metadata-Queue
  -> kurzlebiger, an den Geräteschlüssel gebundener Token
  -> Ed25519-signierte exakte Command-Bytes
  -> Pocket Relay v1 Gateway / Mock Host
  -> Contract + Replay + Idempotenz + Approval Policy
  -> abbrechbare Effect-Lease (Device, Kill-Switch, Command-/Approval-Ablauf)
  -> PocketRelayBridge
       -> Mock (dieser Slice)
       -> später: enger Windows/BirdieOS-Adapter
  <- signierter Audit Receipt
```

Der iPhone-Geräteschlüssel wird mit `Curve25519.Signing` erzeugt und als
`ThisDeviceOnly`-Keychain-Eintrag gespeichert. Das ist ein softwaregebundener
Geräteschlüssel, keine Secure-Enclave-Attestation. Ein späteres Hardware-Key-
Upgrade darf den Wire-Vertrag über einen neuen Algorithmus erweitern, aber
nicht stillschweigend ändern.

## Exakte Allowlist

| Action | Scope | Risiko | Zulässige Daten | Erwarteter Effekt |
| --- | --- | --- | --- | --- |
| `link.open.v1` | `https_link` | niedrig | credential-freie HTTPS-URL | Standardbrowser am Ziel-PC öffnet den Link |
| `file.send_to_pc.v1` | `selected_file_upload` | hoch | explizit ausgewählte Datei; Leaf-Name, MIME, Größe, SHA-256, Mock-Bytes | Datei geht in den freigegebenen PC-Eingang |
| `file.fetch_to_iphone.v1` | `approved_host_export` | hoch | opake `exportId` aus Host-Freigabe | freigegebene Datei wird zum iPhone übertragen |
| `workflow.start.v1` | `registered_workflow` | hoch | `workflowId`, UUID-`runId`, `expectedRevision`, optional opake `inputRef` | Workflow startet oder wird fortgesetzt |
| `workflow.pause.v1` | `registered_workflow` | mittel | `workflowId`, `runId`, `expectedRevision` | exakt dieser Lauf pausiert am sicheren Übergabepunkt |
| `workflow.cancel.v1` | `registered_workflow` | hoch | `workflowId`, `runId`, `expectedRevision` | exakt dieser Lauf wird abgebrochen; bestätigte externe Effekte bleiben bestehen |
| `workflow.result.get.v1` | `registered_workflow` | niedrig | `workflowId`, `runId`, optional `knownRevision` | autoritativer Status, Revision und freigegebenes Ergebnis exakt dieses Laufs werden gelesen |
| `pc.lock.v1` | `host_session_lock` | hoch | feste Bestätigung `LOCK_PC` | interaktive Windows-Sitzung wird gesperrt |

Alle unbekannten Actions und Felder werden abgewiesen. Dateinamen dürfen
keine Pfadseparatoren enthalten. URLs mit `http:`, `file:`, Credentials oder
anderen Schemes sind verboten. Es gibt keine Felder für Shell, Skript,
Argumentliste, Clipboard oder freie Hostpfade.

Ein neuer Workflow-Lauf verwendet eine frische UUID-`runId` und Revision `0`.
Jede Host-Transition erhöht die Revision. Pause, Fortsetzen und Cancel müssen
den zuletzt receipt-gebundenen `(runId, revision)`-Cursor senden; stale
Mutationen werden mit einem Konflikt abgewiesen. Der reine Result-Read bindet
die `runId`, behandelt `knownRevision` aber nur als Client-Hinweis und liefert
die autoritative Revision. So kann das iPhone eine offline erfolgte
Host-Transition ohne Revisionsraten erkennen. Eine `runId` darf für denselben
Workflow nie wiederverwendet werden. Host-interne Completion-/Failure-
Callbacks binden `workflowId`, `runId` und `expectedRevision`, damit ein
verspäteter Callback keinen Folgelauf verändern kann. Der Mock behält die
letzten 20 abgeschlossenen Läufe pro Workflow für den Result-Read.
`workflow.start.v1` ist in
diesem generischen v1 konservativ hochriskant. Ein Produktionskatalog muss
zusätzlich pro Workflow Version, Input-/Result-Schema, Risiko, Scope und
exakten Effekt festschreiben; ein bloßer String-Set genügt nicht.

## Pairing, Token und Signatur

1. Das iPhone erzeugt einmalig ein Ed25519-Schlüsselpaar und speichert nur den
   privaten Schlüssel device-only im Keychain.
2. Das explizite Pairing registriert den öffentlichen Schlüssel am Host.
3. Der Host stellt einen kurzlebigen HMAC-signierten Zugriffstoken mit
   `sub=deviceId`, Audience, Ablaufzeit und `cnf=SHA-256(publicKey)` aus.
4. Nach Ablauf fordert das iPhone mit einem separat signierten, kurzlebigen
   Token-Proof und einmaliger Nonce einen neuen Token an.
5. Jeder Command wird als exakte JSON-Bytefolge base64url-kodiert und mit dem
   Geräteschlüssel signiert. Der Host verifiziert erst Tokenbindung und
   Signatur, dann Vertrag, Ziel, Ablaufzeit, Nonce, Idempotenz und Approval.

Das Pairing dieses Slices ist nur eine Mock-/Entwicklungszeremonie: Der
Pairing-Wert ist wiederverwendbar und besitzt weder Ablaufzeit noch
Rate-Limiting; der Receipt-Key kommt aus derselben Pairing-Antwort. Produktion
benötigt einen einmaligen, kurzlebigen Pairing-Grant, Rate-Limits und einen
authentisierten beziehungsweise gepinnten Host-/Receipt-Key-Transcript. Die
iPhone-App bleibt ohne build-time konfigurierte Host-URL fail-closed.

API-Prefix: `/pocket-relay/v1`

- `POST /pair`
- `POST /token`
- `POST /commands`
- `GET /health` (Mock-Metadaten, keine Credentials)

Ein Command enthält mindestens:

- `version`, `commandId`, `idempotencyKey`
- Quell-`deviceId` und genaues Zielgerät
- zufällige `nonce`, `issuedAt`, `expiresAt` (maximal 120 Sekunden)
- Allowlist-`action`, festen `scope` und streng typisierte `payload`
- `disclosure` mit Zielgerät, Scope, sichtbaren Daten und erwartetem Effekt
- bei hohem Risiko eine an `commandId` gebundene, frische
  `explicit_iphone_confirmation`

Die native App erzeugt vor jedem Sende-Task einen unveränderlichen
Freigabeentwurf. Er bindet Command- und Idempotenz-ID, Quellgerät, Ziel,
Action, Scope, erwarteten Effekt, die exakt validierte Payload und bei Uploads
den ausgewählten Dateiinhalt. Das High-Risk-Alert zeigt ausschließlich diesen
Snapshot; Queue-Aufnahme und Retry prüfen dessen Effekt- und Record-Fingerprint
noch einmal atomar. Änderungen an Formular, Kopplung oder Queue-Zustand führen
zur erneuten Prüfung statt zu einem still veränderten Auftrag.

Die v1-Mock-Freigabe beweist eine explizite UI-Confirmation innerhalb des
signierten Commands, aber keine hardware-attestierte User Presence. Vor einem
realen Hochrisiko-Effekt muss ein Produktionshost zusätzlich eine einmalige,
kurzlebige Challenge atomar verbrauchen, die Device, Ziel und Effektdigest
bindet.

Die Signatur liegt außen neben `signedCommand`; dadurch verifiziert der Host
die **exakten** vom iPhone signierten Bytes und benötigt keine
sprachübergreifend fragile JSON-Rekanonisierung.

Der native Client nutzt eine ephemere Session ohne Cache, Cookies oder
Credential-Store, folgt keinen Redirects und bricht Antworten oberhalb von
12 MiB bereits beim Empfang ab. Dadurch werden Pairing-, Token- oder
dateitragende Command-Bodies nicht an einen umleitenden Origin weitergegeben.
Auch aus dem Keychain geladene Sessions werden vor Anzeige und Verwendung
erneut gegen die aktuelle Release-/Debug-Host-Policy, Geräte-/Ziel-IDs,
Tokenform, Clock-Offset und den 32-Byte-Receipt-Key geprüft. Eine alte Session
kann damit eine inzwischen strengere Build-Konfiguration nicht umgehen.

## Replay, Idempotenz und Receipts

- Eine Nonce ist pro Device einmalig. Ein identischer Transport-Retry wird als
  Replay erkannt und führt keinen zweiten Effekt aus.
- Dieselbe `(deviceId, idempotencyKey)` plus derselbe Effektdigest liefert
  denselben signierten Receipt.
- Derselbe Key mit einem anderen Effektdigest endet mit
  `IDEMPOTENCY_CONFLICT`.
- Der Audit Receipt enthält nur Metadaten und Digests, niemals Token,
  Pairing-Code oder Dateiinhalt. Er wird vom Host mit einem separaten
  Ed25519-Schlüssel signiert.
- Der Client akzeptiert nicht nur eine gültige Receipt-Signatur, sondern bindet
  Version, Command-/Idempotenz-ID, Device, Ziel, Action, Scope, Payload-,
  Effekt- und Result-Digest, State und Error exakt an Command und Response.
- Der Mock reserviert eine Idempotenzwirkung vor dem ersten asynchronen
  Bridge-Aufruf. Parallele Duplikate warten auf dieselbe Receipt; ein
  unbekannter Post-Effect-Status blockiert automatische Neuausführung.
- Nach der Admission erzeugt der Host eine abbrechbare Effect-Lease. Revoke
  oder Kill-Switch brechen deren `AbortSignal` ab; unmittelbar vor jedem
  Commit muss der Adapter zusätzlich Device-Status sowie Command- und bei
  Hochrisikoaktionen Approval-Ablauf über `assertActive()` prüfen. Der Mock
  führt keinen Effekt ohne diese Lease aus.
- Der in-process Mock-Admin-Hook `revokeDevice()` blockiert Token und Commands
  sofort; er ist **kein** Remote-Management-Endpunkt. Ein Produktionssystem
  benötigt dafür eine getrennt authentisierte Admin-Plane. Der Host-Kill-
  Switch blockiert Pairing, Token-Refresh und Authentisierung fail-closed.

Der Mock hält Device-, Nonce-, Idempotenz- und Receipt-Daten absichtlich nur
im Speicher. Ein Produktionshost braucht dafür atomare, persistente Stores,
Rotation, Ratenlimits, Recovery und überprüfte Receipt-Key-Verwahrung.
Auch gebrauchte Workflow-Run-IDs und aktive Effect-Leases brauchen dort eine
dauerhafte beziehungsweise transaktionale Durchsetzung.

## Offline und Reconnect

Die iPhone-App verwendet eine eigenständige Zustandsmaschine:

```text
queued -> running -> completed
   |          |  \-> failed
   |          |  \-> cancelled
   |          \-> paused -> running
   \-> failed/cancelled
```

Nur Metadata wird dauerhaft gequeued. Nonce, Gültigkeitszeit und Signatur
werden bei einem tatsächlichen Sendeversuch frisch erstellt; abgelaufene
signierte Envelopes werden nie blind wiederverwendet. Nach Reconnect wird der
Device-/Tokenstatus erneut geprüft. Ein `DEVICE_REVOKED`-Ergebnis leert die
Session und stoppt Retries. Ein Result-Read sendet die bekannte Revision, darf
aber die receipt-gebundene autoritative Revision des exakt adressierten Laufs
übernehmen. Bei einer offline gequeueten Datei muss die App die explizite
Dateiauswahl vor dem Versand erneut bestätigen, statt versteckt einen freien
Pfad zu speichern.

Workflow-Cursor sind an `(sourceDeviceId, targetDeviceId, workflowId)`
gebunden; ungebundene Legacy-Cursor werden verworfen. Pairing und lokales
Trennen sind gesperrt, solange ein Command vorbereitet oder übertragen wird.
Bei parallel laufenden Requests stoppt ein verifiziertes Revoke/Kill-Switch
alle noch nicht übertragenen Aufträge, lässt bereits in-flight Requests aber
mit ihrer jeweils eigenen signierten Receipt abschließen. Eine verspätete
Receipt aus einer früheren Kopplung darf nur deren Queue-Record samt Audit
terminalisieren und niemals Credentials, Cursor, Datei oder UI-Ergebnis einer
neuen Kopplung verändern.

## Lokaler Mock und Tests

Self-contained Smoke ohne Credentials in Logs:

```bash
npm run smoke:pocket-relay
```

Manueller Mock (Pairing-Wert nur in der lokalen Prozessumgebung setzen):

```powershell
$env:POCKET_RELAY_MOCK_PAIRING_CODE = '<runtime-only-value>'
npm run mock:pocket-relay
```

Der Smoke nutzt den JavaScript-Referenzclient gegen den Node-Mock; er ist kein
physischer iPhone-/Windows-Test. Er prüft Pairing, device-bound Token, signierte Commands, identischen
Replay, beide Dateirichtungen, Start/Pause/Fortsetzen/Offline-Ergebnis-Read, signierten
und vollständig gebundenen Receipt, den in-process Revoke-Hook und Kill-Switch. Contract-/Security-/State-Tests laufen
mit `npm test`. Ein zusätzlicher Source-Contract-Test hält native Action-
Werte, Scopes/Risiken, Reconnect-Felder, MIME-Regel, Keychain-, Receipt- und
Transportgrenzen mit dem Node-Vertrag synchron.

Apple-Code wird durch den vorhandenen rekursiven XcodeGen-Source-Glob in die
iPhone-App aufgenommen. Die bestehende GitHub-Action generiert das Projekt und
baut den Simulator ohne Signing. Auf Windows sind `xcodegen`/`xcodebuild` nicht
verfügbar; die macOS-CI ist deshalb das Apple-Build-Gate.

## Produktionsgrenzen

- Kein Produktions-Gateway, kein Cloud-Relay und kein Port-Forwarding in
  diesem Slice.
- Keine reale Windows-Sperre, kein Browserstart und keine reale Dateiablage im
  Mock.
- Kein direkter Zugriff des iPhones auf die Pipe aus PR #64.
- Keine direkte Weiterleitung in freie BirdieOS-Tasks. Nur registrierte,
  versionierte Workflows dürfen später einen Adapter erhalten.
- Inline-Dateibytes sind auf 5 MiB begrenzt und nur eine Mock-
  Conformance-Lösung. Opake, kurzlebige Upload-Grants wären ein neuer,
  versionierter Datenvertrag; bis dahin bleibt Datei-Produktion deaktiviert.
  Der spätere Vertrag braucht Quarantäne/Scanning und einen explizit
  ausgewählten Ziel-Scope.

Der genaue nächste Integrationsschritt steht in
[`pocket-relay-windows-adapter-v1.md`](pocket-relay-windows-adapter-v1.md).
