# Birdie Watch: gekoppelter Geräte-Smoke-Test

Dieser Test ist der letzte manuelle Release-Gate für ein echtes, gekoppeltes
iPhone und eine Apple Watch. Er prüft die komplette Strecke Watch → iPhone →
Birdie Agent, ohne Schlüssel zu protokollieren und ohne unbeabsichtigt eine
Mail zu senden.

## Testprotokoll

Vor dem Start notieren:

- Git-Commit des installierten Builds
- CI-Build-URL oder Personal-Watch-Artefakt
- Xcode-, iOS- und watchOS-Version
- iPhone- und Watch-Modell
- UTC-Zeit des Tests

Niemals den Watch-API-Schlüssel in das Protokoll übernehmen.

## Voraussetzungen

- iPhone und Apple Watch sind gekoppelt; Entwickler-Modus ist aktiviert.
- BirdiePhone, BirdieWatch und die Birdie-Komplikation stammen aus demselben
  Commit und sind installiert.
- Der Live-Status des Birdie Agent meldet `watch: SCOPED_AUTH_READY`.
- Der vorhandene dedizierte Watch-Schlüssel wurde ausschließlich direkt in der
  iPhone-App hinterlegt. Die Watch erhält oder speichert ihn nicht.

## Ablauf

1. Birdie auf iPhone und Watch öffnen. In der iPhone-App müssen
   `Session aktiviert`, `Watch gekoppelt`, `Watch-App installiert` und – bei
   geöffneter Watch-App – `Watch erreichbar` grün sein.
2. Die Watch-Inbox aktualisieren. Erwartet wird eine Zahl und höchstens fünf
   Karten oder `Keine ungelesenen Mails`, aber kein Verbindungsfehler.
3. Auf der Watch diktieren:
   `Birdie Watch Smoke <UTC-Zeit>: Antworte kurz mit WATCH_SMOKE_OK.`
   Erwartet wird innerhalb von 20 Sekunden eine neu erschienene Antwort, die
   exakt `WATCH_SMOKE_OK` enthält, und keine sichtbare Fehlermeldung. Eine
   stehen gebliebene frühere Antwort gilt nicht als Erfolg.
4. Die Birdie-Komplikation dem Watchface hinzufügen und antippen. Erwartet wird,
   dass sich die Birdie-Watch-App öffnet.
5. Bei einer unkritischen Testmail `WATCH_SMOKE_DRY_RUN` als Antwort erfassen,
   den Dialog `Diese Mail wirklich senden?` öffnen und `Abbrechen` wählen.
   Erwartet: keine Mail wird versendet und `Antwort gesendet.` erscheint nicht.

Ein echter Mailversand gehört nicht zum Standard-Smoke-Test. Er darf nur nach
separater ausdrücklicher Freigabe an ein kontrolliertes eigenes Testpostfach
erfolgen.

## Bestanden

Der Test ist bestanden, wenn alle fünf Schritte erfolgreich sind, kein Secret
auf der Watch oder im Protokoll erscheint und der Dry-Run keine Mail auslöst.
Bei einem Fehler Commit, Schritt, sichtbare Fehlermeldung und Uhrzeit notieren;
keine Tokens, Mailinhalte oder anderen Zugangsdaten aufnehmen.
