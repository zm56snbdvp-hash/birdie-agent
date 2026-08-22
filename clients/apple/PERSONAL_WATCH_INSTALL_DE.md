# Birdie kostenlos auf Kevins eigener Apple Watch

Dieser Weg verwendet Apples kostenloses **Personal Team**. Er braucht keine
Apple-Developer-Program-Mitgliedschaft, kein TestFlight und keinen App Store.
Die Installation ist ausschließlich für Kevins eigene Geräte gedacht.

## Was bereits vorbereitet ist

- `BirdiePersonal.xcodeproj` wird automatisch auf GitHub erzeugt.
- Die persönlichen Bundle-IDs sind von den späteren App-Store-IDs getrennt.
- iPhone-App, Watch-App und Watch-Komplikation werden gemeinsam gebaut.
- Der CI-Build prüft das Projekt ohne Signatur, bevor das Paket angeboten wird.

## Einmalige Voraussetzungen

- ein **lokaler Mac** mit aktuellem Xcode
- Kevins kostenlose Apple-ID
- iPhone und Apple Watch sind miteinander gekoppelt
- Entwickler-Modus ist auf iPhone und Apple Watch aktiviert
- Mac, iPhone und Watch befinden sich im selben lokalen WLAN

Ein Cloud-Mac kann die Geräte im heimischen WLAN nicht entdecken. Ab iOS 27
kann Xcode ein iPhone erstmals drahtlos koppeln. Bei älteren iOS-Versionen ist
für die erste Kopplung weiterhin eine funktionierende Kabelverbindung nötig.

## Paket herunterladen

1. GitHub-Repository `zm56snbdvp-hash/birdie-agent` öffnen.
2. `Actions` > `Birdie Personal Watch Project` öffnen.
3. Den neuesten grünen Lauf auf `main` auswählen.
4. Unter `Artifacts` das Paket `Birdie-Personal-Watch-Xcode` herunterladen.
5. Beide ZIP-Ebenen entpacken und `apple/BirdiePersonal.xcodeproj` öffnen.

## Kostenlos signieren und installieren

1. In Xcode `Settings` > `Accounts` öffnen und Kevins Apple-ID hinzufügen.
2. Im Projektnavigator `BirdiePersonal` auswählen.
3. Bei `Signing & Capabilities` für `BirdiePhone`, `BirdieWatch` und
   `BirdieWatchWidget` jeweils Kevins **Personal Team** auswählen.
4. `Automatically manage signing` eingeschaltet lassen.
5. In Xcodes Device Hub `Pair Nearby Device...` wählen und das iPhone koppeln.
   Vertrauen auf iPhone und Watch bestätigen.
6. Als Run-Ziel das gekoppelte iPhone mit seiner Apple Watch auswählen.
7. Scheme `BirdiePersonal` wählen und den Run-Button drücken.

Xcode installiert die iPhone-Begleit-App und die zugehörige Watch-App. Falls
watchOS die Watch-App nicht automatisch einblendet, in der iPhone-App `Watch`
unter `Verfügbare Apps` bei Birdie auf `Installieren` tippen.

## Sieben-Tage-Regel

Kostenlose Personal-Team-Provisioning-Profile laufen nach sieben Tagen ab.
Danach das Projekt erneut in Xcode öffnen, dasselbe Run-Ziel wählen und noch
einmal `Run` drücken. Quellcode und Einstellungen bleiben erhalten.

## Sicherheitsgrenze

Keine Apple-ID, kein Passwort und kein Signaturzertifikat gehören in GitHub,
BirdieOS oder Chat. Die Anmeldung und Signatur passieren ausschließlich lokal
in Xcode auf dem verwendeten Mac.
