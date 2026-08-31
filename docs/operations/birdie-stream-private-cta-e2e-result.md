# Birdie Stream — privater CTA-E2E-Run 1/1

Das damalige Founder-GO wurde für genau einen beaufsichtigten, privaten, kostenfreien und reversiblen Lauf verwendet. Aktuelles Review-Ergebnis dieses historischen Runs: **`STOP`**. Ein manueller Klickpfad und die synthetische Funnel-Folge wurden beobachtet, aber ohne Input-Trace/HAR nur attestiert; der ausgeführte, durch HMR veränderte Build erzwang Navigationsherkunft und Einmaligkeit nachweislich nicht. Öffentliches Stream-/Publish-Gate bleibt `STOP/LOCKED`.

## Tatsächlich beobachteter Pfad

1. Lokale Streamansicht `PRODUCT` bei 1280×720 geöffnet.
2. Sichtbaren `LOCAL PRIVATE CTA TEST` im DOM geklickt.
3. Same-origin Testseite erreicht; keine Anmeldung, externe Form oder Zahlung verwendet.
4. Consent-Control aktiviert.
5. Synthetischen Lead ohne PII erzeugt.
6. Test-Sale mit `4900 TEST-CENTS` abgeschlossen; kein Geld und kein Payment-Provider.

Die aufgezeichnete Folge war `VIEW(1 ms) → CTA(3 ms) → LEAD(123056 ms) → SALE(131056 ms)`. Die Legacy-JSON und die unveränderliche Completion-Screenshot-UI meldeten dafür `PASS`; nach dem Read-only-Audit wird diese Anzeige nur als damaliger ungeprüfter Runner-Output aufbewahrt und nicht mehr als vollständiges Anwendungs-Gate akzeptiert. Die separate Review-Akte setzt das bindende Ergebnis auf `STOP`.

## Im selben Lauf gefundene Fehler

- Die private Route erbte zunächst `visibility:hidden`; Fix via HMR im selben Lauf.
- Danach erbte `#app` noch `pointer-events:none`; Fix via HMR im selben Lauf.
- Vor beiden Fixes entstand kein Lead- oder Sale-Event.

## Nachträglicher Audit und lokaler Fix

- Root Cause: `source=stream-cta` war frei in der URL setzbar; VIEW/CTA entstanden automatisch auf der Zielseite, und der Completion-Marker wurde nicht gelesen.
- Fix: zufälliger kurzlebiger Handoff aus dem echten Click-Handler, Consume-and-delete auf der Zielseite, persistenter Completion-Lock, harte `CONSUMED_WITH_HOLD`-Autorisierung und gate-gebundene Provenienz-Digests.
- Direkter Einstieg, abgelaufener/gefälschter Token, zweiter Consume, abgeschlossener Run und unsicherer Storage führen jetzt zu `STOP`.
- Private Mode rendert nie einen konfigurierten QR. Öffentliche QR-Freigabe verlangt Hash plus lokal decodierten Payload-Match.
- Für diese Härtung wurden historisch `100/100` gezielte Contract-Tests als bestanden gemeldet. Weil am Testzeitpunkt weder Source-/Test-Digests noch eine Erzeugungszeit festgehalten wurden und der Worktree dirty war, ist das nur eine attestierte Testzusammenfassung mit unvollständiger Build-Bindung; sie erfüllt kein aktuelles Browser-, OBS- oder Live-Gate. Ein separater CTA-only Authorization-Receipt erlaubt einen neuen privaten lokalen Browser-E2E erst mit neuer Run-ID, eindeutiger Build-Bindung und aktuellen Digests; Außenaktionen bleiben gesperrt, eine private/unlisted Übertragung wurde nicht autorisiert oder ausgeführt.

## Evidence, Rollback und Budget

- Browserfehler/Warnungen im ausgeführten Lauf: `0`; Layout-Overflow: `false`; Root 1280×720.
- Page-observable externe Ressourcen: `0`; vollständiger HAR bleibt `UNKNOWN`.
- Browser-Tab geschlossen, Vite beendet und Port 1421 am Laufende frei; finale Prozessprobe wird separat im Ledger vermerkt.
- Spend: `0,00 EUR`, Anbieter `LOCAL_WORKSPACE`, kein Vertrag/Abo/Autopay; 75-EUR-Cap unberührt.

Maschinenlesbare historische Review-Akte: `ops/evidence/birdie-stream-private-cta-e2e-20260831-ledger.json`. Die davon getrennte, noch nicht verbrauchte Autorisierung steht in `ops/evidence/birdie-stream-cta-only-authorization-20260831.json`. Ein neuer privater lokaler Browserlauf erhält eine neue Run-ID und eine eigene, nicht mit der historischen Akte vermischte Evidence; das ist keine Freigabe für OBS, Audio oder eine externe Übertragung.
