# Birdie Stream — lokale QR-Verifikation 2026-08-31

Verdict: **Lokale QR-Verifikation PASS; öffentlicher CTA und Stream STOP.**

Der echte lokale Browserlauf `birdie-stream-qr-local-verification-20260831T000645Z` war an Build `9fff8c26e8ae-stream-dirty` und die beim Lauf berechneten SHA-256-Digests gebunden. Diese Digestliste ist kein erhaltener Byte-Snapshot der damaligen Quellen. Mindestens der `showPlan`-Stand wich später vom Worktree ab; deshalb gilt maschinenlesbar `sourceDigestScope=CAPTURED_AT_RUN_NOT_CURRENT` und `currentSourceMatch=false`. Das 8459-Byte-PNG stimmte im Lauf bytegenau mit dem deklarierten SHA-256 `c482e0…c228` überein. Der lokale `jsQR`-Fallback decodierte den Payload bytegleich zum konfigurierten Ziel, ohne den Rohwert in die Evidence zu kopieren.

Bei 1280×720 wurden 1229 ms bis zum ersten Frame, 826 ms bis zur Konfiguration, 29,7 Renderer-FPS, maximal 730 ms Frame-Gap und null Seitenfehler beobachtet. Das Raster erschien ausschließlich unter `qrVerify=local` als Blob und mit sichtbarem `VERIFY ONLY`.

Die Freigabe blieb absichtlich geschlossen: `ctaStatus=DRAFT`, `conversionReady=false`, kein `href`, `aria-disabled=true`, `qrScanVerified=false`. Normale Streamquelle, Private-CTA plus Preview-Query und die falsche Großschreibung `qrVerify=LOCAL` erzeugten keinen QR-Blob und zeigten keinen QR.

Dieser Browserlauf belegt weder OBS-CEF noch einen finalen MKV-Scan, ein zweites Gerät, reale Mikrofonfunktion oder Sale-/Lead-Attribution. Diese Felder bleiben `UNPROVEN` beziehungsweise `NOT_ESTABLISHED`; Public bleibt `STOP`.

Maschinenlesbare Evidence: `ops/evidence/birdie-stream-qr-local-verification-20260831.json`.
