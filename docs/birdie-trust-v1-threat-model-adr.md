# Birdie Trust v1: Threat Model und Architekturentscheidung

Status: **clientseitig implementiert, lokaler Backend-Referenzadapter vorhanden, Produktionsintegration blockiert**, 28. August 2026. Der Vertrag ist in
`clients/apple/Contracts/v1/birdie-trust.openapi.json` festgeschrieben. Er enthaelt
bewusst keine Produktions-URL, keinen OAuth-Issuer, keine APNs-Zugangsdaten und
keinen Schluessel.

## Entscheidung

Birdie Approve ist eine zentrale, serverautoritative Inbox. Eine Karte liefert nach
authentisiertem Abruf das exakte Ziel, die kanonische beabsichtigte Nutzlast samt
SHA-256-Digest, Risiko, Ablaufzeit, Quelle und aktuelle `recordVersion`. Der Client
darf genehmigen, ablehnen oder eine konkrete Aenderung als Patch vorschlagen. Er
darf die Aktion selbst nicht ausfuehren.

`payloadDigest` ist `SHA-256(RFC8785({actionKind,target,changes}))`. Dadurch kann
der Client pruefen und anzeigen, welche serverkanonische Ziel-/Aenderungsnutzlast
vorliegt. Beliebige, nicht dargestellte `target.attributes` sind in v1 bewusst
nicht erlaubt. Der spaetere `actionDigest` bindet nach dem normativen
`ApprovalActionDigestPayload` zusaetzlich Approval-ID,
`recordVersion`, effektive (gegebenenfalls bearbeitete) Aenderungen und Intent.

Jede Zustandsmutation verwendet einen Zwei-Schritt-Flow:

1. Der Client fordert fuer Ressource, `recordVersion`, beabsichtigte Aktion,
   `deviceBindingId` und `idempotencyKey` eine Challenge an.
2. Der Server liefert eine kryptographisch zufaellige Nonce mit 30 bis hoechstens
   120 Sekunden Laufzeit, `maxAttempts = 1` und einen Digest der gebundenen Aktion.
3. Bei rotem Risiko oder irreversibler Wirkung fordert die iPhone-App unmittelbar
   vorher `LocalAuthentication` an. Die App bildet anschliessend den kanonischen
   Client-Digest aus Challenge, Nonce, Ressource, Version, Aktion, Idempotency-Key
   und dem Kontext-Digest der lokalen Autorisierung.
4. Eine fuer die App registrierte App-Attest-Assertion signiert diesen Digest. Der
   Server loest die opaque Apple-`keyId` ueber seine Registrierung auf eine davon
   getrennte `deviceBindingId` und den authentisierten Benutzer auf. Er prueft
   Benutzer-Token, App-Attest-Key, Device Binding, Nonce, TTL,
   `recordVersion`, Aktions-Digest und Idempotenz in **einer** Transaktion. Erst
   danach wird die Nonce konsumiert und die Entscheidung oder der Mission-Befehl
   geschrieben.
5. Die Antwort enthaelt einen unveraenderlichen Receipt und einen Verweis auf den
   append-only Audit-Eintrag. Receipt und Audit-Head tragen eine rohe Ed25519-
   Signatur ueber RFC-8785-kanonisiertes JSON; `keyId` waehlt den vertrauenswuerdig
   verteilten Server-Public-Key. Der Client akzeptiert Receipt, Resultat und lokalen
   Audit-Eintrag erst nach Ed25519-Pruefung; ohne konfiguriertes vertrauenswuerdiges
   Keyset schlaegt Release geschlossen fehl. Das Format ist bewusst kein
   unvollstaendiges JWS.

Ein Retry mit demselben `idempotencyKey` und identischem Request-Digest liefert
denselben Receipt. Derselbe Key mit anderer Nutzlast, eine bereits konsumierte
Nonce oder eine veraltete `recordVersion` schlagen mit `409` fehl. Serverzeit ist
fuer Ablaufentscheidungen massgeblich; Clientzeit dient nur dem Audit.

Ein signierter Request wird vor dem ersten Senden mit kompletter Dateisperre lokal
gespeichert. Bei einem verlorenen Response wird exakt dieselbe Nonce, Assertion,
Decision-ID und derselbe Idempotency-Key erneut gesendet. Nach einem Neustart
rekonziliert `GET /v1/approvals/{approvalId}/decisions/{decisionId}` einen bereits
committeten Receipt. Der Server muss den Idempotenz-Treffer vor der Challenge-TTL
pruefen; nur ein autoritatives `404` nach Challenge-Ablauf erlaubt einen neuen
Foreground-Versuch mit neuem Key.

Alle Trust-v1-Zeitstrings verwenden fuer die signierte Domain exakt UTC und ganze
Sekunden (`YYYY-MM-DDTHH:mm:ssZ`). Alle kanonischen Integer sind auf den
sprachuebergreifend exakten IEEE-754-Bereich bis `2^53 - 1` begrenzt. Damit
kanonisieren Swift und ein spaeteres Backend dieselben semantischen Werte zu
denselben JCS-Bytes.

## Trust Boundaries und Assets

Zu schuetzen sind die Entscheidungsautoritaet von Kevin, fachliche Inhalte und
Ziele, OAuth-/APNs-/ActivityKit-Tokens, App-Attest-Schluessel, die Integritaet von
Mission-Kommandos sowie Nachweis und Reihenfolge aller Entscheidungen.

Die wesentlichen Grenzen sind:

- **Entsperrte iPhone-App:** zeigt vertrauliche Details. Keychain/Secure Enclave,
  `LocalAuthentication` und App Attest liegen auf dieser Seite der Grenze. Ein
  kompromittiertes App-Prozessabbild bleibt ein Risiko; deshalb reicht ein lokales
  Boolean niemals als Serverbeweis.
- **APNs, Notification Service Extension und Sperrbildschirm:** gelten als
  Metadatenkanal. Payloads enthalten nur opaque IDs, Version, groben Status,
  Ablaufzeit und generische Texte. Kein Ziel, Inhalt, Schritt, Blocker, Token,
  Challenge oder Assertion darf diese Grenze passieren.
- **Birdie-Backend:** ist Autoritaet fuer Policy, Version, Ablauf, Challenge-
  Konsum, Idempotenz, Ausfuehrung und Audit. TLS schuetzt den Transport; App Attest
  bindet die konkrete Mutation zusaetzlich an die registrierte App-Instanz.
- **Externe Connectoren und Ausfuehrende:** erhalten erst nach serverseitig
  akzeptierter Entscheidung einen Auftrag. Ihre Resultate werden als neue
  Audit-Ereignisse angehaengt, nicht in einen vorhandenen Eintrag hineineditiert.
- **Apple Watch / WatchConnectivity:** ist eine nicht vertrauenswuerdige,
  eingeschraenkte Anzeige- und Eingabeprojektion. Birdie Trust v1 uebertraegt niemals
  Bearer-, Refresh-, API-, APNs- oder ActivityKit-Tokens an die Watch. Die Watch
  ist niemals Approval-Autoritaet; Challenge, App Attest, lokale Policy und
  Serveraufruf verbleiben auf dem iPhone. Der bestehende direkte Mail-Reply-Pfad
  ist fail-closed gesperrt, damit caller-authored `founderApproved`-Flags die
  Inbox nicht umgehen koennen.
- **Lokale Mocks:** sind ausschliesslich In-Memory-Transport in DEBUG und Tests.
  Sie verwenden keine echte Base URL und keine echten Credentials, persistieren
  keine Secrets und duerfen von einem Produktionsserver nie akzeptiert werden.
  Mock-Receipts sind mit einem nur pro Prozess erzeugten Ed25519-Testkey
  verifizierbar, tragen aber keinerlei Produktionsvertrauen.

## Face ID ist nicht der Serverbeweis

`LAContext.evaluatePolicy` beweist dem lokalen Prozess eine erfolgreiche User-
Presence-Pruefung. Es erzeugt keinen fuer Birdie serverseitig verifizierbaren
biometrischen Beleg und sagt dem Server nicht, *welche* Aktion der Mensch gesehen
hat. Birdie bindet deshalb nur einen Digest des erfolgreichen, frischen lokalen
Kontexts in die App-Attest-Assertion ein. Der Server vertraut fuer rote oder
irreversible Aktionen auf die Kombination aus eigener Risikopolicy, einmaliger
Challenge, registriertem App-Attest-Key und frischem gebundenem Kontext. Biometrie-
Fallback (`deviceOwnerAuthentication`) muss eine ausdrueckliche Serverpolicy sein;
`not_required` ist nur fuer niedrige Risiken erlaubt.

Die initiale App-Attest-Key-Registrierung ist als eigener Challenge- und
Registration-Flow versioniert. Die App erzeugt zuerst einen noch inaktiven Key,
attestiert ihn erst nach der Server-Challenge und speichert ihn erst nach einem
signierten Backend-Acknowledgement zusammen mit der serverseitig vergebenen
`deviceBindingId` als aktive Zuordnung. Apples `keyId` ist ein opaque Bezeichner,
nicht die Device-Binding-ID; Gleichheit der beiden ist weder gefordert noch
zulässig als Sicherheitsannahme. Verlorene oder abgelehnte Registrierungen
ersetzen niemals den bisherigen Key. Die produktive Keychain-Ablage muss vor
Freigabe zusaetzlich nach einem stabilen, authentisierten Benutzer-Subject
namespaced und bei Logout/Accountwechsel gesperrt werden. Der noch inaktive Key
und der vollstaendige Registration-Request werden getrennt geraetegebunden bzw.
mit kompletter Dateisperre gespeichert; bei verlorenem Acknowledgement wird nach
Neustart exakt derselbe idempotente Request wiederholt und erst die verifizierte
Antwort aktiviert die serverseitig vergebene Zuordnung. Attestation-
Pruefung und Counter-Verwaltung fehlen im Backend weiterhin; bis dahin kann der
lokale Mock den UI-Flow simulieren, aber kein Produktions-Receipt erzeugen.

## Sperrbildschirm, Notifications und ActivityKit

Die APNs-Beispiele unter `clients/apple/Contracts/v1/examples/` sind eine Allowlist,
keine Empfehlung fuer zusaetzliche Felder. Bei gesperrtem Geraet bleibt auch der
Notification-Preview-Text generisch. Die Kategorien duerfen Oeffnen, spaeter
erinnern und Ablehnen anbieten. **Keine Kategorie enthaelt `APPROVE`.** Bei roten
Freigaben fuehrt keine Lock-Screen-Aktion die kontrollierte Aktion aus. Ablehnung
und Mission-Pause sind ausschliesslich authentisierte Foreground-Reviews; erst die
App kann danach einen serverseitig gechallengten, idempotenten und device-bound
Befehl senden. Fuer Abbruch gibt es keine Notification-Action; er ist nur in der
App beziehungsweise ueber einen Live-Activity-Deep-Link erreichbar.

Live Mission ist eine auf maximal acht Stunden begrenzte Darstellung eines klar
definierten laufenden Auftrags. Basis ist die Lock-Screen-Live-Activity; Dynamic
Island ist eine optionale Projektion derselben minimalen Daten. Sie zeigt
Fortschritt, aktuellen Schritt, Blocker sowie Pause/Abbruch nur nach Entsperrung in
der App. Sie ist kein allgemeiner Agenten- oder Chatstatus. `ActivityAttributes`
und Push enthalten keine fachliche Approval-Nutzlast und keine Zugriffstokens. Ein
Remote-Activity-Update verwendet nur generische Step-Titel, eine grobe Blocker-
Kategorie und `containsSensitiveDetails = true`; der Push-Token bleibt ausserhalb
der JSON-Payload und wird niemals an die Watch repliziert.

`staleDate` beendet die Activity-Shell nicht. Sobald ActivityKit den Inhalt als
stale markiert, rendert deshalb jede Lock-Screen-/Dynamic-Island-Variante nur noch
den generischen Hinweis „Status nicht mehr aktuell / Auftrag darf nicht
weiterlaufen“, keine alte Mission, keinen Schritt, Fortschritt, Blocker oder
Pause-/Abbruch-Link. Das verhindert eine falsche Fortsetzungsbehauptung, ersetzt
aber kein Ende-Ereignis. **Produktionsblocker:** Das Backend muss spaetestens zum
fachlichen `hardEndAt` ein ActivityKit-`event=end` senden oder die App muss einen
gleichwertig verlaesslichen Background-Cleanup nachweisen; ohne einen dieser
Pfade darf die Remote-Live-Activity-Konfiguration nicht produktiv aktiviert
werden.

## Bedrohungen und Gegenmassnahmen

| Bedrohung | Kontrolle | Verbleibendes Risiko |
| --- | --- | --- |
| Wiederholung einer Genehmigung | Einmal-Nonce, kurze TTL, atomarer Consume, Challenge an Aktion/Version/Geraet gebunden | Fehlerhafte Backend-Transaktionen muessen durch Integrationstests ausgeschlossen werden |
| Doppelte Requests durch Netz-Retry | Eindeutiger Idempotency-Key plus Request-Digest; identischer Retry liefert gleichen Receipt | Aufbewahrungsdauer des Idempotenzregisters muss festgelegt werden |
| Verlorener erfolgreicher Response | File-protected Signed-Request-Cache, identischer Retry und Decision-ID-Recovery | Backend muss Lookup und Idempotenz ausreichend lange atomar vorhalten |
| Stale UI genehmigt geaenderte Aktion | `recordVersion` und `actionDigest` in Challenge und Assertion; `409` bei Abweichung | Nutzer muss nach Refresh die neue Aktion erneut pruefen |
| Manipulierter oder geklonter Client | OAuth-Benutzerscope, Device Binding, App Attest und serverseitige Policy | Jailbreak/Runtime-Hooking ist nicht vollstaendig eliminierbar; serverseitige Anomalieerkennung bleibt sinnvoll |
| Gestohlenes oder kurz entsperrtes Geraet | Face ID/Owner Auth unmittelbar vor rot/irreversibel, kurze Challenge | Angreifer mit entsperrtem Geraet kann gruen eingestufte Aktionen versuchen; Risikoklassifikation muss konservativ sein |
| Informationsabfluss ueber APNs/Lock Screen | Feste generische Texte und Feld-Allowlist; Details nur per authentisiertem App-Abruf | Opaque IDs und Zeitpunkt bleiben als Metadaten sichtbar |
| Token-Abfluss an Watch | Tokenfreier WCSession-Handoff; alle Servercalls auf dem iPhone | Pairing-/Session-Missbrauch kann Verfuegbarkeit stoeren, erteilt aber keine Serverautoritaet |
| Audit-Manipulation oder -Luecke | Append-only Sequenz, Hash-Kette, signierte Ereignisse und signierter Vollstaendigkeits-Head | Backend-Key-Kompromittierung erfordert Rotation, externe Verankerung und Incident-Prozess |
| Mock gelangt in Produktion | Build-Flag plus In-Memory-Transport; Produktionsvertrag akzeptiert nur `provider = app_attest`; Release schlaegt ohne Adapter geschlossen fehl | CI muss Release-Binaries auf Mock-Symbole und echte Transportkonfiguration pruefen |
| Geheimnisse in Logs/Crash Reports | Strukturierte Allowlist und Digest statt Payload in Security-Logs | Fachliche Fehlerlogs muessen zusaetzlich redigiert und retention-begrenzt werden |

## Verworfene Alternativen

- **Nur Face ID und ein `approved: true`:** nicht remote pruefbar, nicht an Inhalt
  gebunden und replaybar.
- **Approval direkt aus der Notification:** zu wenig Kontext, Lock-Screen-Leak und
  kein verlaesslicher frischer Beweis fuer rote Aktionen.
- **Ein langlebiger API-Key auf der Watch:** erweitert die Angriffsoberflaeche und
  verletzt die tokenfreie Watch-Grenze.
- **Clientseitig signierter Audit-Log:** ein kompromittierter Client koennte
  Ereignisse auslassen; die serverseitige Ausfuehrungsautoritaet muss auch das
  kanonische Audit fuehren.
- **Live Activity als permanentes Agenten-Praesenzsignal:** verletzt die fachliche
  Begrenzung, verbraucht Systembudget und erhoeht Metadatenabfluss.

## Offene Produktionskonfiguration und naechster Integrationsschritt

Vor Produktion fehlen mindestens: echte API-Basis-URL und Certificate-Pinning-
Entscheidung; OAuth/OIDC-Issuer, Audience und Scopes; Bundle-/Team-/App-Attest-
Environment samt Key-Registrierung und Counter-Persistenz; Receipt-Public-Key-
Discovery, Rotation und Aufbewahrung; APNs Topic, Entitlements und serverseitige
Provider-Authentisierung; Datenbank-Constraints fuer Nonce und Idempotency-Key;
Audit-Retention/Export; ActivityKit-Push-Token-Registrierung und Token-Rotation.
Ausserdem fehlt die Bindung des lokalen Keychain-Records an das authentisierte
Benutzer-Subject. Die vorhandene Fastlane-Konfiguration provisioniert die neue
Live-Activity-App-ID sowie die App-Attest-Capability noch nicht; sie wurde wegen
des Verbots von Signing, Deployment und App-Store-Connect-Aenderungen bewusst
nicht angefasst. Keiner dieser Werte darf aus Beispielen abgeleitet werden.

`project.yml` konfiguriert App Attest getrennt fuer Debug (`development`) und
Release (`production`). `project.personal.yml` enthaelt dieses Entitlement bewusst
nicht, weil ein kostenloses Personal Team App Attest nicht provisionieren kann;
dort ist nur der explizite lokale DEBUG-Mock nutzbar.

Der lokale Referenzschritt ist in `src/birdie-trust-v1-adapter.mjs` umgesetzt und
mit `test/birdie-trust-v1-adapter.test.mjs` abgesichert. Er ist nur mit dem
expliziten Flag `allowLocalMock=true` aktivierbar, hält Approval- und Mission-
Versionen atomar, verbraucht Challenges genau einmal, dedupliziert über den
Idempotency-Key, simuliert Response-Loss nach Commit und signiert testbare
Ed25519-Receipts. Er wird nicht in Produktionsrouten importiert und enthält keine
Produktions-URL, Credentials oder Secrets.

Der **genau naechste Integrationsschritt** ist jetzt die Anbindung eines echten
versionierten Backend-Adapters an dieselben Contract-Endpunkte: authentisierte
Benutzer-/Device-Bindung, Apple-App-Attest-Verifikation mit persistiertem Counter,
Nonce-/Idempotency-Constraints, rotierbare Receipt-Key-Discovery sowie APNs-
Provider und ActivityKit-Token-Registrierung. Diese Werte müssen aus der
verantworteten Produktionskonfiguration kommen; erst danach darf der lokale
Adapter in einem separat geprüften Integrations-Environment ersetzt werden.
