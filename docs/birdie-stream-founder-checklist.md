# Birdie Stream — Founder-GO-Checkliste

Eine private lokale Demo ist von einer Veröffentlichung getrennt. Veröffentlichung, echter Stream und externe Nachricht bleiben ohne neuen Auftrag verboten.

## Build-GO

- [ ] Stream-Tests und kompletter Desktop-Testlauf grün.
- [ ] Vite-Produktionsbuild grün; Build-ID dokumentiert.
- [ ] 1920×1080 High-WebGL-Loop mindestens 72 Sekunden: Startup ≤2500 ms, `ERRORS 0`, genau die sieben Zustände der Demo-Timeline jeweils ≥28 tatsächliche Renderer-FPS; keine Behauptung über weitere Presence-Zustände.
- [ ] 1280×720 und 1920×1080 exakt 16:9, kein Overflow.
- [ ] Low-End und `STATIC BACKUP` lokal sichtbar und ohne eigenen Fehler.
- [ ] Separater Zehn-Minuten-Soak: ≥600.000 ms, ≥8 abgeschlossene Loops, sieben Timeline-Zustände in korrekter Reihenfolge, kein Frame-Gap >1000 ms. Der 72-Sekunden-Gate-Nachweis zählt dafür nicht.

## OBS-GO

- [ ] separates Profil `Birdie-Stream-Local-1080p30`; nicht `Unbenannt`.
- [ ] separate Collection `Birdie Stream Local` nach Szenenplan.
- [ ] lokale MKV-Aufnahme; Streaming, Replay Buffer und Virtual Camera aus.
- [ ] keine Monitor-, Fenster-, Game-, Kamera- oder Medienquelle in Stream/Backup.
- [ ] Stiller visueller Standardvertrag: Browser Audio, Desktop Audio und Operator-Mikrofon aus; kein Voice- oder Mikrofon-Audio behauptet.
- [ ] `99_SAFE`, Mic-Mute und Stop-Recording-Hotkeys real betätigt.
- [ ] 90-Sekunden-MKV: null dropped/render-lagged/encoding-lagged frames.
- [ ] Browser-Evidence, OBS-Statistik und MKV-Metadaten separat gespeichert und eindeutig demselben Take zugeordnet; parallele Browser-Evidence nicht als Beleg der OBS-CEF-Instanz ausgegeben.

## Conversion-GO

- [ ] genau ein Founder-freigegebenes Paid-Pilot-Angebot.
- [x] Kanonische öffentliche HTTPS-Adresse ohne Query/Fragment gesetzt.
- [ ] `ctaStatus=READY`.
- [x] lokales QR-Asset vorhanden; SHA-256 stimmt.
- [x] lokaler Browser-Payload-Decode stimmt bytegleich mit `qrTarget` überein; der Prüfmodus zeigt `VERIFY ONLY` und setzt keinen Link frei.
- [x] `qrTarget` ist bytegleich zu `ctaUrl`.
- [ ] QR aus finaler OBS-MKV auf zweitem Gerät erfolgreich gescannt; `qrScanVerified=true`.
- [ ] `DRAFT CTA` ist verschwunden und Preflight meldet keine Founder-Blocker.

## Privacy-/Claim-GO

- [ ] keine Benachrichtigung, kein Desktop, kein Name, Chat, Kalender, Pfad, Secret oder Diagnose im Bild.
- [ ] `DEMO LOOP` bleibt sichtbar.
- [ ] niemand bezeichnet synthetische States als echten Mikrofon- oder PC-Aktionsnachweis.
- [ ] Separate 30-/60-Sekunden-OBS-MKV-Dateien liegen vor; Metadaten belegen `30,0 ± 0,1 s` beziehungsweise `60,0 ± 0,1 s`, Start-/Endframes wurden privat geprüft. Der exakte Codevertrag allein reicht nicht.
- [ ] Veröffentlichung und Zielkanal separat freigegeben.

## Founder-Entscheidung

Aktueller Status: `STOP`. `GO` erst nach neuer Founder-Entscheidung, wenn jede Checkbox oben mit Take-bezogener Evidenz belegt ist. Ein einziges Nein oder `UNPROVEN` bedeutet weiterhin `STOP`. `99_SAFE` ist die einzige voraussetzungslose sichere Bildaktion; `02_STREAM_BACKUP` darf erst nach sauberer Operator-Vorschau als privater Demo-Notpfad verwendet werden und ist kein Performance- oder Soak-Beleg.
