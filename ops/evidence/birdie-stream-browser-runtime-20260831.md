# Birdie Stream — lokales Browser-Runtime-Ledger 2026-08-31

Historisches Verdict des gebundenen Laufs: **Low-End-Demo lokal PASS; High-WebGL und Public STOP.** Die gespeicherten Source-/Test-Digests stimmen nicht mehr mit dem aktuellen Worktree überein; dieser Beleg ist deshalb `CAPTURED_AT_RUN_NOT_CURRENT` und kein aktuelles Build-GO.

Der vollständige High-WebGL-Loop war funktional sauber: ein Loop, alle Zustände, korrekte Reihenfolge, null Fehler, 888,5 ms First Frame und 369,9 ms Max-Gap. Das strikte aktive 28-FPS-Gate fiel jedoch mit P10-Werten bis 23,8 FPS durch. Dieser Rechner-/Build-Lauf ist deshalb kein High-Mode-GO; ein strikter Regressionsvergleich bleibt wegen inkompatiblem Baseline-Fingerprint `UNKNOWN`.

Der Low-End-Pfad hielt im 60-Sekunden-Lauf mindestens 28,4 FPS am 24-FPS-Gate. Dabei wurden zwei reproduzierbare Auditorfehler gefunden und behoben: ein am `IDLE→IDLE`-Loop-Rand absichtlich nicht protokollierter Doppelzustand und das globale Fordern von `WORKING` in der 30-Sekunden-Timeline, die diesen Zustand bewusst nicht enthält.

Im damals gebundenen Stand bestand nach dem Fix der echte 30-Sekunden-Low-End-Loop: `demoVerdict=PASS`, null Fehler, ein vollständiger Loop, vollständige Timeline-Abdeckung, null Reihenfolgeverstöße, P10 mindestens 29,7 FPS, 371,7 ms First Frame, 89,9 ms Max-Gap und 40,1 ms P95.

Nicht belegt sind ein zehnminütiger aktueller Soak, OBS-CEF, aktuelle OBS-Drops, finale MKV, Mikrofon/STT sowie Conversion. Diese Grenzen bleiben `UNPROVEN`; ein öffentlicher Stream bleibt `STOP`.

Maschinenlesbare Evidence: `ops/evidence/birdie-stream-browser-runtime-20260831.json`.
