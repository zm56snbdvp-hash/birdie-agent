# Birdie Addressability v0

Birdie trennt zwei Entscheidungen strikt:

1. **Ist menschliche Sprache vorhanden?** – lokaler VAD-/Speech-Candidate-Pfad.
2. **War diese Sprache an Birdie gerichtet?** – lokale Addressability-Entscheidung.

Der zweite Schritt liefert exakt eines von drei Ergebnissen:

```text
ACCEPT  – mit ausreichender Evidenz an Birdie gerichtet
REJECT  – starke negative Evidenz oder sehr niedriger Score
ABSTAIN – unklar; nicht antworten, nicht hochladen, lokal verwerfen
```

## Verbindliche Semantik

### ACCEPT

- darf einen Birdie-Turn öffnen;
- führt von `SPEECH_DETECTED` nach `LISTENING`;
- ersetzt keine Bestätigung für sensible Side Effects;
- verlangt bei triggerloser Sprache mehrere Evidenzfamilien;
- darf Gate-STT nur bei einer explizit verifizierten Aktivierung umgehen.

### REJECT

- erzeugt keinen Turn;
- erzeugt keine Antwort;
- verwirft Kandidat und flüchtiges Audio;
- kehrt aus normalem Wake-on-Speak zu `IDLE` zurück;
- setzt bei einem falschen Barge-in die bestehende Ausgabe fort.

### ABSTAIN

- ist ein reguläres Privacy-Ergebnis, kein Fehler;
- erzeugt keinen Turn und keine Nachfrage;
- emittiert `voice.activation.abstained`;
- löscht Kandidat, Turn-Puffer und RAM-Pre-Roll über `reset_interaction(true)`;
- kehrt aus normalem Wake-on-Speak lautlos zu `IDLE` zurück;
- lässt bei einem unklaren Barge-in den bestehenden `SPEAKING`-Turn weiterlaufen.

## Gate-STT-Grenze

`IGateStt` ist die austauschbare lokale Decoder-Grenze. Sie erhält ausschließlich einen begrenzten `GateSttRequest`:

- Activity-ID;
- mono PCM;
- Sample-Rate;
- Kandidatenzeitraum;
- Barge-in-Marker.

Ein Decoder liefert einen der folgenden Statuswerte:

```text
BYPASSED    – nur explizite, bereits verifizierte Aktivierung
TRANSCRIPT  – lokales Gate-Transkript vorhanden
NO_SPEECH   – kein belastbares Sprachsignal
UNAVAILABLE – kein lokaler Decoder konfiguriert
FAILED      – lokaler Decoderfehler
```

Verbindliche Auswertung:

- `UNAVAILABLE` und `FAILED` führen zu ABSTAIN;
- `NO_SPEECH` führt zu REJECT;
- ein leeres oder unbrauchbares Transkript führt zu ABSTAIN;
- `BYPASSED` ist ausschließlich bei `explicit_activation=true` zulässig;
- unbekannte Statuswerte führen zu ABSTAIN.

Der Standardprovider ist derzeit `UnavailableGateStt`. Normaler triggerloser Betrieb ist damit absichtlich fail-closed. Ein fehlendes Modell wird nicht durch Auto-Accept kaschiert.

## Evidence Pipeline

`AddressabilityEvidencePipeline` verarbeitet Gate-Audio und Gate-Transkript nur lokal. Die zurückgegebene `AddressabilityEvaluation` enthält **kein Transkript**.

Die Pipeline kann folgende Evidenzfamilien kombinieren:

- explizite Aktivierung;
- direkte Ansprache mit „Birdie“;
- strukturierter Follow-up-Kontext;
- Assistant-Intent aus lokalem Gate-Text;
- akustische Nähe aus lokalem PCM;
- ASR-Sicherheit;
- optionaler Speaker Match;
- kürzliche Birdie-Aktivität;
- Medienwahrscheinlichkeit;
- Mehrsprecher-/Overlap-Wahrscheinlichkeit;
- starke negative Evidenz.

Regeln:

- explizite Aktivierung ist ein Fast Path und ruft Gate-STT nicht auf;
- passender Follow-up-Kontext kann kurze Antworten wie „Ja“ akzeptieren;
- triggerloses ACCEPT verlangt mindestens zwei positive Evidenzfamilien und einen ausreichenden Gesamtscore;
- Eigentümerstimme allein genügt niemals;
- hohe Medien- oder Overlap-Wahrscheinlichkeit ist ein Veto;
- unklare Mitte führt zu ABSTAIN statt zu einer geratenen Aktivierung.

## Realtime- und Speichergrenzen

Gate-STT läuft nicht im WASAPI-Callback. `AddressabilityWorker` besitzt eine bewusst begrenzte Queue:

- höchstens ein Job darf warten;
- ein neuer Kandidat ersetzt einen älteren wartenden Kandidaten;
- ersetztes PCM wird vor der Freigabe überschrieben;
- ein bereits laufender Decoder darf fertig werden, sein Ergebnis wird aber über die Activity-ID validiert;
- ein verspätetes Ergebnis kann keinen neueren Kandidaten akzeptieren oder ablehnen;
- Mute, Capture-Fehler und Shutdown löschen wartende Jobs und sperren ihre Ergebnisse.

Weitere Privacy-Invarianten:

- Roh-PCM verlässt `birdie-voice-host` nicht;
- Gate-Transkripte werden weder geloggt noch als Core-/Tauri-Event veröffentlicht;
- Request-PCM und Ergebnis-Transkript werden über `secure_clear` überschrieben;
- die Evaluation transportiert nur Status, Sprache, nicht-sensitive Scores, Fehlercode und Entscheidung;
- ABSTAIN löscht anschließend auch den VoiceHost-Pre-Roll.

## Noch nicht Produktions-DDSD

Der Live-Pfad, die Schnittstelle, Workerqueue und deterministische Evidence Pipeline sind implementiert. Noch ausstehend sind insbesondere:

- ein tatsächlich transkribierender lokaler Gate-STT-Adapter samt Modellpaketierung und Lizenzprüfung;
- eigenes kommerziell freigegebenes „Hey Birdie“-Wake-Word-Modell;
- Medien-/Loopback-Korrelation;
- Overlap-/Mehrsprecher-Erkennung;
- optionaler Speaker-Verifier;
- strukturierte Follow-up-Fenster aus Birdie Core;
- deutsches Realwelt-Testkorpus und kalibrierte Schwellenwerte.

`--dev-auto-accept` bleibt ausschließlich ein markierter Integrationsmodus. Er darf weder für Privacy-Tests noch als fertiges Wake-on-Speak-Verhalten bewertet oder ausgeliefert werden.

## Tests

Die aktuelle Testbasis prüft unter anderem:

- explizites ACCEPT ohne Aufruf des Gate-STT-Decoders;
- direkte deutsche Ansprache und Multi-Signal-ACCEPT;
- triggerlosen Imperativ mit ABSTAIN statt geratenem ACCEPT;
- Follow-up-ACCEPT für kurze Antworten;
- kein ACCEPT allein durch Eigentümerstimme;
- Medien- und Overlap-Vetos;
- `UNAVAILABLE`/`FAILED` als fail-closed ABSTAIN;
- `NO_SPEECH` als REJECT;
- Ablehnung überlanger Gate-Audiojobs vor dem Decoder;
- bounded Workerqueue mit „latest pending wins“;
- Zurückweisung verspäteter Activity-Ergebnisse;
- keine Turn-Erzeugung bei ABSTAIN;
- Barge-in-Fortsetzung bei ABSTAIN;
- Löschung des abstained Pre-Rolls ohne Audio-Leak in den nächsten akzeptierten Turn.
