# Birdie Stream — lokales OBS-Runbook

Dieses Runbook bereitet eine private Demo-Aufzeichnung vor. Es autorisiert weder Stream, Upload, Veröffentlichung, Virtual Camera noch externe Nachrichten.

## Ist-Zustand und Sicherheitsgrenze

OBS 32.2.2 ist lokal installiert, aber das bestehende Profil `Unbenannt` und die Collection `Birdie Live Lab — FreeBridge v4` sind für Birdie Stream nicht freigegeben. Sie verwenden 3440 × 1440 → 1719 × 720 und enthalten unter anderem Monitor-, Fenster-, Kamera-, Medien- und Mikrofonquellen. Die vorhandene `service.json` wurde bewusst nicht geöffnet.

Für den nächsten ausdrücklich freigegebenen lokalen OBS-Setup-Lauf müssen ein separates Profil `Birdie-Stream-Local-1080p30` und eine separate Collection `Birdie Stream Local` nach [dem deklarativen Szenenplan](../../ops/obs/birdie-stream-local.scene-plan.json) angelegt werden. Im hier dokumentierten Stand vom 2026-08-31 wurde keine OBS-Systemkonfiguration verändert.

## Genau ein Birdie-Startbefehl

Vom Repository-Root:

```powershell
npm --prefix apps/desktop run stream
```

Der Befehl bindet ausschließlich `127.0.0.1:1421`, nutzt einen festen Port und öffnet keinen zusätzlichen Browser-Tab. Ein belegter Port ist ein STOP; nicht still auf einen anderen Port ausweichen.

## Profil und Quellen

Profil:

- Basis und Ausgabe: exakt 1920 × 1080.
- Bildrate: 30 FPS als feste Zielausgabe. Das begrenzt gegenüber 60 FPS die angeforderte GPU-Arbeit; ob OBS Frames dupliziert oder verwirft, bleibt bis zur privaten MKV-/Stats-Prüfung `UNPROVEN`.
- Audio: 48 kHz, Stereo.
- Aufnahme: lokal als MKV.
- Streaming, Replay Buffer und Virtual Camera: aus.
- Desktop Audio: aus.

Collection:

| Szene | Erlaubte Quelle | Zweck |
| --- | --- | --- |
| `00_START` | `SAFE_SLATE` | neutraler Start, keine personenbezogenen Daten |
| `01_STREAM` | nur `BIRDIE_STREAM_BROWSER` | Hauptdemo |
| `02_STREAM_BACKUP` | nur `BIRDIE_STREAM_BACKUP` | statischer Low-End-Core |
| `03_CLIP_30` | nur `BIRDIE_STREAM_CLIP_30` | 30-Sekunden-Seitenlauf; Aufnahmegrenze unbewiesen |
| `04_CLIP_60` | nur `BIRDIE_STREAM_CLIP_60` | 60-Sekunden-Seitenlauf; Aufnahmegrenze unbewiesen |
| `05_QR_VERIFY` | nur `BIRDIE_STREAM_QR_VERIFY` | lokale QR-Prüfvorschau mit sichtbarem `VERIFY ONLY`; keine CTA-Freigabe |
| `09_BRB` | `SAFE_SLATE` | kontrollierte Pause |
| `10_END` | `SAFE_SLATE` | kontrolliertes Ende |
| `99_SAFE` | `SAFE_SLATE` | sofortiger Not-Aus fürs Bild |

Hauptquelle:

```text
http://127.0.0.1:1421/?mode=stream&demo=loop
```

Backupquelle:

```text
http://127.0.0.1:1421/?mode=stream&demo=loop&renderer=backup&quality=low
```

Clipquellen:

```text
http://127.0.0.1:1421/?mode=stream&demo=loop&clip=30
http://127.0.0.1:1421/?mode=stream&demo=loop&clip=60
```

QR-Prüfquelle, ausschließlich für den lokalen Scan-Take:

```text
http://127.0.0.1:1421/?mode=stream&demo=loop&qrVerify=local
```

Diese Quelle rendert das erst nach Hash- und Payload-Prüfung erzeugte Blob-Raster mit `VERIFY ONLY`. Sie setzt weder `conversionReady` noch einen Link und darf nicht als normale Streamquelle verwendet werden. `ctaTest=private` unterdrückt sie vollständig.

Alle Browser Sources sind 1920 × 1080 und Audio aus. Haupt- und Backupquelle haben `Shutdown source when not visible` sowie `Refresh browser when scene becomes active` aus. Für die beiden Clipquellen fordert der Plan beide Optionen an, damit OBS beim Aktivieren einen frischen Seitenlauf ab t=0 anstoßen soll. Dieses reale Reload-Verhalten ist bis zum lokalen OBS-Take ebenso `UNPROVEN` wie Aufnahmegrenze und MKV-Dauer. In allen Birdie-Szenen sind Monitor Capture, Window Capture, Game Capture, Kamera, Media Source sowie WASAPI-Ein- und Ausgang verboten.

## Audio

Der Standardvertrag ist eine stille visuelle Demo: Der synthetische Loop erzeugt kein Audio; Browser Audio, Desktop Audio und Operator-Mikrofon bleiben deaktiviert, und es gibt keine zweite Mikrofonquelle. Die sichtbare Voice-Reaktion ist synthetisch und darf weder als eingehendes Sprachsignal noch als realer Mikrofontest bezeichnet werden. Ein späterer moderierter Take mit Operator-Mikrofon ist eine separate Konfiguration mit eigener Freigabe; er gehört nicht zum aktuellen Default-Vertrag.

## Hotkeys und Not-Aus

- `Ctrl+Alt+Shift+F12`: sofort zu `99_SAFE`.
- `Ctrl+Alt+Shift+F11`: Operator-Mikrofon stumm.
- `Ctrl+Alt+Shift+F10`: lokale Aufnahme stoppen.
- `Ctrl+Alt+Shift+F9`: nur für einen späteren, separat autorisierten Stream als Stop-Streaming reserviert.

Notfallfolge: zuerst `99_SAFE`, danach Ausgabe stoppen. Nicht zuerst in OBS nach einer fehlerhaften Quelle suchen.

## Datenschutz-Preflight

- Windows-Benachrichtigungen und Vorschauen deaktivieren.
- Keine persönlichen Namen, Kalender, Chats, Dateien, Tabs, Pfade oder Diagnoselogs im Bild.
- Nur die Birdie Browser Source erfassen; niemals den Desktop.
- Oben rechts muss jederzeit `DEMO LOOP` stehen.
- `DRAFT CTA` muss sichtbar bleiben, solange CTA/QR nicht Founder-freigegeben sind.
- OBS-Service-Konfiguration und Stream-Key nicht öffnen oder aufnehmen.
- Einen zehnsekündigen Testclip ansehen: Start- und Endframe, keine Browserleiste, kein schwarzer Frame, kein abgeschnittener CTA.

## Prüfbarer lokaler Preflight

```powershell
node scripts/check-birdie-stream-readiness.mjs --plan-only
```

Das Skript ist read-only. Es prüft Szenenplan und öffentliche Stream-Konfiguration, öffnet OBS nicht und liest keine Service-Konfiguration. Mit `--plan-only` bestätigt `repositoryPlanStatus=PASS` nur den Repository-Plan und darf deshalb Exitcode 0 liefern. Ohne `--plan-only` ist Exitcode 0 ausschließlich bei echtem `founderGo=GO` erlaubt; der aktuelle Stand endet absichtlich ungleich null. `founderGo=STOP` bleibt korrekt, bis echter CTA, verifizierter Asset-Hash, Scan-Beleg und das separat angelegte OBS-Profil nachgewiesen sind. Der Preflight startet keine Browser Source und beweist weder OBS-Ausgabe noch Soak oder Clipdauer.

## Evidence aus einer OBS-Session

- Direkt aus dem OBS-Take unterstützt sind nur die im Bild sichtbaren Birdie-Werte (`START`, Renderer-FPS, `ERRORS`, Loop/State), eine OBS-Stats-Aufnahme und die MKV-Metadaten. Diese drei Belege werden unter demselben lokalen Take-Namen gesichert.
- In einer normalen lokalen Prüf-Browser-Instanz kann der Operator im Seitenkontext `window.__birdieStream.getEvidenceJson()` per Entwicklerkonsole oder autorisierter lokaler Browser-Automation auslesen.
- Für die konkrete OBS Browser Source gibt es in diesem Setup keinen verifizierten direkten JSON-Export. Die OBS-Interaktionsansicht und OBS Stats ersetzen diesen Export nicht.
- JSON aus einem parallel geöffneten Browser ist nur Evidence dieser Browser-Instanz; es beweist nicht die OBS-CEF-Instanz, OBS-Ausgabe-FPS, Audio, Dropped Frames oder MKV-Dauer.
- Ein OBS-Take ist deshalb erst belegt, wenn Browser-Evidence, Screenshot der OBS-Statistik und MKV-Metadaten jeweils mit demselben lokalen Take-Namen und Zeitstempel gespeichert sind. Bis dahin bleiben OBS-Soak sowie aufgezeichnete 30-/60-Sekunden-Clips `UNPROVEN`.

## Aufnahme-Gates

STOP bei mindestens einem dieser Befunde:

- Ausgabe nicht exakt 1920 × 1080 bei 30 FPS.
- OBS Stream, Replay Buffer oder Virtual Camera aktiv.
- andere Quelle als die Allowlist in der aktiven Stream-/Backup-Szene.
- Desktop Audio aktiv oder Mikrofon unbeabsichtigt offen.
- `START > 2500 MS`, `ERRORS > 0`, schwarzer Canvas oder eingefrorener Core.
- High-WebGL: unter 28 tatsächliche Renderer-FPS in einem Zustand.
- Low-WebGL: unter 24 tatsächliche Renderer-FPS. Static Backup zeigt nur `RAF … HZ`; das ist kein Renderer-FPS-Gate und bleibt bis zu einem visuellen Screenshot-/Pixelbeleg `UNPROVEN`.
- Loop-Zähler erreicht nach 72 Sekunden nicht `01` oder einer der genau sieben synthetischen Timeline-Zustände fehlt beziehungsweise erscheint in falscher Reihenfolge. Dieser kurze Gate-Test ist kein Zehn-Minuten-Soak.
- OBS meldet in einer privaten 90-Sekunden-MKV-Probe Render-, Encoding- oder Dropped Frames größer null.
- In `05_QR_VERIFY` beziehungsweise einer später ausdrücklich READY geschalteten Public-Quelle fehlt der QR, ist zu klein/unlesbar oder decodiert nicht exakt zur sichtbaren CTA-Adresse. Solange der CTA `DRAFT` ist, muss der QR in normalen Stream- und privaten CTA-Quellen dagegen fehlen; ein dort sichtbarer QR ist `STOP`.

Renderer-FPS in Birdie sind keine OBS-Ausgabe-FPS. Beide Messungen müssen separat grün sein.

Aktueller Founder-Status bleibt `STOP`; dieses Runbook erteilt weder Aufnahme-, Stream- noch Veröffentlichungsfreigabe.
