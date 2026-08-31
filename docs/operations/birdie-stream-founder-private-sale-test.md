# Birdie Stream-to-Sale — Founder-Karte für genau einen privaten Testlauf

**Status des historischen Runs: `GO_CONSUMED · RUN 1/1 · STOP`.** Der damalige Founder-Auftrag autorisierte genau einen beaufsichtigten, privaten, kostenfreien CTA-Lauf. Der Lauf wurde ausgeführt, erfüllt wegen bekannter Provenienz-, Replay- und Build-Bindungsfehler aber nicht das App-enforced E2E-Gate. Eine davon getrennte Founder-Autorisierung erlaubt nach grünen lokalen Contracts ausschließlich genau einen neuen privaten lokalen Browser-E2E mit weiterhin gesperrten Außenaktionen; dieser neue Lauf ist noch nicht ausgeführt. Eine private/unlisted Übertragung bleibt separat gate-pflichtig und wurde nicht gestartet.

Die Scopes sind absichtlich getrennt: `CTA_ONLY_LOCAL_BROWSER_E2E=AUTHORIZED_PENDING`, `15_MIN_OBS_RECORDING=STOP`. Der CTA-only-Lauf kann weder OBS-/Audio-/Mikrofon-/MKV-/Privacy-Evidence noch eine Live-Freigabe liefern. Seine Autorisierung steht ausschließlich im separaten [CTA-only Authorization-Receipt](../../ops/evidence/birdie-stream-cta-only-authorization-20260831.json), nicht in der historischen Run-Akte.

## Tatsächlich autorisierter und ausgeführter Scope

- Variante `PRODUCT`;
- lokale Streamansicht bei 1280×720;
- ein sichtbarer DOM-Klick auf `LOCAL PRIVATE CTA TEST`;
- same-origin Zielseite, Consent, synthetischer Lead und synthetischer Test-Sale;
- Eventfolge `VIEW → CTA → LEAD → SALE` innerhalb von 131056 ms;
- keine PII, Nachricht, Anmeldung, Zahlung, Netzwerk-Conversion oder öffentliche Übertragung.

Eine reale 15-Minuten-Show war **nicht** Teil dieses einzelnen CTA-Laufs. Die separate 15-Minuten-Pipeline ist ein synthetischer Contract-Replay; ihre echte Realtime-/OBS-/Audio-Evidenz bleibt `UNKNOWN/HOLD`.

## Post-Run-Audit

| Gate | Befund |
| --- | --- |
| Browser-beobachteter CTA-Klick | `ATTESTED` — kein Input-Trace im Artefakt |
| Same-origin-Navigation | `ATTESTED` — kein HAR/Origin-Witness im Artefakt |
| Consent und synthetische Eventreihenfolge | `PASS` |
| Außenaktionen / echtes Geld | `0` / `NOT_APPLICABLE` |
| Anwendungserzwungene CTA-Herkunft im ausgeführten Build | `STOP` — der damalige Query-Parameter war forgebar |
| Replay-Sperre im ausgeführten Build | `STOP` — der Completion-Marker wurde damals nicht gelesen |
| Bindung an einen reproduzierbaren ausgeführten Build | `STOP` — HMR-Fixes während des Laufs, Build `UNBOUND` |
| Nachträglicher Einmal-Handoff-/Replay-Fix | historisch gemeldete Contract-Re-Verifikation `100/100 PASS`, jedoch ohne am Testzeitpunkt erfasste Source-/Test-Digests und mit dirty Worktree; daher nur attestierte, unvollständig build-gebundene Testzusammenfassung. Der separat autorisierte CTA-only-Neulauf ist noch nicht ausgeführt; Außenaktionen bleiben gesperrt |
| Gesamturteil des privaten Laufs | `STOP` |
| Öffentlicher Stream / Publication | `STOP` / `LOCKED` |

Der Browserlauf ist damit ein belastbarer Nachweis für den tatsächlich beobachteten Klick und die lokale synthetische Folge, aber **kein** vollständiger Beweis dafür, dass der ausgeführte App-Build direkte Navigation oder Wiederholung selbst verhindert hat.

## Aktuelle Fail-closed-Grenzen nach dem Audit

- Der Stream erzeugt einen zufälligen, kurzlebigen, same-origin Handoff ausschließlich im CTA-Click-Handler.
- Die Zielseite konsumiert und löscht den Handoff; Query-Strings allein können keinen PASS erzeugen.
- Ein Completion-Lock blockiert Reload/Folgeläufe, und Run `founder-private-20260831-001` ist im Produktstand `CONSUMED_WITH_HOLD`.
- Private CTA-Ansichten unterdrücken konfigurierte QR-Assets vollständig.
- Ein öffentlicher QR kann erst READY werden, wenn Hash **und tatsächlich decodierter QR-Payload** exakt zum CTA-Ziel passen; fehlende Decoder-Unterstützung bleibt fail-closed.

## Autorisierung und Sign-off

Autorisierungsquelle des historischen Runs war die damalige Founder-Anweisung im laufenden Codex-Auftrag. Es wird keine nachträgliche Unterschrift erfunden. Ausgeführter historischer Run: `founder-private-20260831-001`, Evidence-ID `private-sale-founder-private-20260831-001`, Variante `PRODUCT`, Zähler `1/1`, aktuelles Review `STOP`. Die spätere, noch nicht verbrauchte CTA-only-Autorisierung ist separat im Receipt dokumentiert. Vor ihrer Ausführung werden eine neue Run-ID, ein eindeutig gebauter Stand und aktuelle Source-/Test-Digests gebunden; private/unlisted Übertragung und sonstige Außenaktionen bleiben ohne separate grüne Real-Gates gesperrt.
