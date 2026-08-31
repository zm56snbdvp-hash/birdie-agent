# Birdie Stream — One-Click-GO-Handoff

**Status: `NOT ARMED / STOP BEFORE PUBLISH`.** Ein manueller lokaler CTA-Pfad wurde historisch beobachtet; der anwendungserzwungene, replay-sichere Pfad ist nach den Fixes noch nicht in einem eindeutig gebundenen Browser-Build belegt. Auch die Voraussetzungen für eine öffentliche Übertragung sind nicht vollständig. Deshalb existiert absichtlich kein autonomer Publish- oder Start-Streaming-Aufruf.

## Finaler lokaler Preflight

```powershell
node scripts/check-birdie-stream-readiness.mjs --plan-only
```

Ein späterer One-Click-GO darf erst manuell in der beaufsichtigten OBS-Oberfläche freigegeben werden, wenn derselbe take-bezogene Evidence-Satz alle folgenden Felder `PASS` meldet:

- 15-Minuten-Echtzeit-/OBS-Video, Render-/Encoding-Drops und Quiet-Host-Fingerprint;
- finale Audio-Decode-/Listening-Prüfung;
- globale SAFE-/Stop-Pfade aus einer anderen App;
- Privacy-Sichtung des finalen Bildes;
- Production-CTA/QR-Ziel, Hash und Scan;
- Founder-Sign-off für den ausdrücklich benannten öffentlichen Kanal.

Aktuelle Blocker: Audio `UNKNOWN`, jüngster vollständiger OBS-Take `UNKNOWN`, jüngster realer OBS-Preflight `STOP` (falsches Profil/Collection, 60 FPS und aktives Desktop-Audio), öffentlicher Privacy-Take `UNKNOWN`, Production-CTA `STOP`. Die einzige vorbereitete Abschlussaktion ist daher: Gates anzeigen, `99_SAFE` bereithalten und **vor** `Start Streaming` stoppen.
