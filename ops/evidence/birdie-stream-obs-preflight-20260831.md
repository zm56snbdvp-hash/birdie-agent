# Birdie Stream — echter lokaler OBS-Preflight 2026-08-31

Verdict: **NO-GO.** Es wurde weder gestreamt noch aufgenommen; Stream, Aufnahme und Virtual Camera waren sichtbar inaktiv.

OBS 32.2.2 lief im vorhandenen Profil `Unbenannt` und der Collection `Birdie Live Lab — FreeBridge v4`, nicht im deklarierten Birdie-Stream-Profil. Beobachtet wurden 60 statt 30 FPS und ein aktiver Desktop-Audio-Meter. Damit scheitern Profil-, Collection- und Audio-Gate unabhängig von der funktionierenden lokalen Browseransicht.

Der fokussierte OBS-UI-Wechsel von `10_END` auf `99_SAFE` war visuell erfolgreich. Der gemessene 4349-ms-Round-trip enthält allerdings Window-Capture-Overhead und ist kein belastbarer Eingabe-Latenznachweis. Der dokumentierte globale F11-Pfad aus einer anderen App änderte den sichtbaren Mute-Zustand nicht; F12/F10 wurden in diesem Lauf nicht als stabile globale Pfade belegt.

Beim Mikrofon war echter Pegel am OBS-Eingang sichtbar, während der Kanal gemutet blieb. Das spricht für vorhandenen Geräte-Ingress, aber zwei UI-Schaltversuche und der globale F11-Versuch ergaben keinen sichtbaren Zustandswechsel. Stabile Aufnahme, Birdie-STT und Voice-Command-Routing bleiben deshalb `UNPROVEN/NOT_TESTED`; das Mikrofon wird ausdrücklich nicht als bestanden gemeldet.

Maschinenlesbare Evidence: `ops/evidence/birdie-stream-obs-preflight-20260831.json`.
