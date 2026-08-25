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
- ersetzt keine Bestätigung für sensible Side Effects.

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

## Lokaler Fusionskern

`RuleBasedAddressabilityGate` ist derzeit ein konservativer, deterministischer Scaffold. Er kann folgende Evidenzfamilien kombinieren:

- explizite Aktivierung;
- strukturierter Follow-up-Kontext;
- Assistant-Intent;
- akustische Nähe;
- ASR-Sicherheit;
- optionaler Speaker Match;
- kürzliche Birdie-Aktivität;
- Medienwahrscheinlichkeit;
- Mehrsprecher-/Overlap-Wahrscheinlichkeit;
- starke negative Evidenz.

Regeln:

- explizite Aktivierung ist ein Fast Path;
- passender Follow-up-Kontext kann kurze Antworten wie „Ja“ akzeptieren;
- triggerloses ACCEPT verlangt mindestens zwei unabhängige positive Evidenzfamilien;
- Eigentümerstimme allein genügt niemals;
- hohe Medien- oder Overlap-Wahrscheinlichkeit ist ein Veto;
- unklare Mitte führt zu ABSTAIN statt zu einer geratenen Aktivierung.

## Noch nicht Produktions-DDSD

Der Gate ist implementiert und unit-getestet, aber der reale Voice-Prozess versorgt ihn noch nicht mit sämtlichen hochwertigen Merkmalen. Noch ausstehend sind insbesondere:

- lokale Gate-STT und kalibrierte ASR-Hinweise;
- eigenes kommerziell freigegebenes „Hey Birdie“-Wake-Word-Modell;
- Medien-/Loopback-Korrelation;
- Overlap-/Mehrsprecher-Erkennung;
- optionaler Speaker-Verifier;
- strukturierte Follow-up-Fenster aus Birdie Core;
- deutsches Testkorpus und kalibrierte Schwellenwerte.

`--dev-auto-accept` bleibt ausschließlich ein markierter Integrationsmodus. Er darf weder für Privacy-Tests noch als fertiges Wake-on-Speak-Verhalten bewertet oder ausgeliefert werden.

## Tests

Die aktuelle Testbasis prüft:

- explizites ACCEPT;
- Follow-up-ACCEPT;
- Multi-Signal-ACCEPT;
- kein ACCEPT allein durch Eigentümerstimme;
- Medien- und Overlap-Vetos;
- deterministisches ABSTAIN;
- keine Turn-Erzeugung bei ABSTAIN;
- Barge-in-Fortsetzung bei ABSTAIN;
- Löschung des abstained Pre-Rolls ohne Audio-Leak in den nächsten akzeptierten Turn.
