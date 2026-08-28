# Pocket Relay Windows/BirdieOS adapter v1

## Aktueller Stand

PR #64 führt Birdie Desktop, Core und die lokale Named Pipe
`\\.\pipe\birdie.core.control.v1` ein. Diese Pipe transportiert interne
Runtime-Events und erlaubt als Desktop-`runtime.command` derzeit nur den
Mikrofon-Schalter. Ihre Rollen sind logische, selbst deklarierte Gates, keine
Peer-Authentisierung oder nachgewiesene Pipe-ACL-Sicherheitsgrenze. Sie darf
niemals an das Netz oder direkt an ein iPhone exponiert werden.

`src/pocket-relay/bridge.mjs` definiert deshalb eine getrennte Code-Grenze:

```js
class PocketRelayBridge {
  describe() {}
  async execute(validatedCommand, effectLease) {}
}
```

Der vorhandene `MockPocketRelayBridge` simuliert alle Effekte. Der
`DisabledPocketRelayBridge` lehnt jeden Effekt mit
`PRODUCTION_BRIDGE_NOT_CONFIGURED` ab. `WindowsPocketRelayAdapter` definiert
jetzt den engen Adapter-Contract für `link.open.v1` und `pc.lock.v1`, bleibt
aber ohne explizite Windows-Executor-Hooks und ohne `enableProductionEffects`
deaktiviert. Datei- und Workflow-Aktionen sind im Adapter exhaustiv disabled.

Das generische `execute()` ist im Mock ein versiegelter Allowlist-Dispatcher;
es beweist noch keine produktionsreife Executor-Typisierung. Ein späterer
Adapter muss exhaustiv alle Action-Enums auf getrennte, typisierte Methoden
abbilden und beim Start unbekannte oder fehlende Handler ablehnen. Er muss das
`AbortSignal` beachten und `effectLease.assertActive()` unmittelbar vor dem
nicht rückholbaren Commit aufrufen; eine Prüfung nur bei Request-Annahme ist
kein ausreichender Revoke-/Kill-Switch-Schutz.

## Anforderungen an den späteren Windows-Adapter

Der Adapter darf nur bereits vollständig verifizierte Pocket-Relay-v1-
Commands erhalten und muss pro Action eine eigene Methode besitzen:

- `openHttpsLink(url)` – nochmals Scheme/URL prüfen; Windows ShellExecute nur
  für `https`, kein generischer Process-Start.
- `acceptSelectedFile(...)` bleibt deaktiviert, bis ein neuer versionierter
  Upload-Grant-/Data-plane-Vertrag existiert; dann nur in einen festen,
  konfigurierten Inbox-Scope materialisieren, nie Caller-Pfade, UNC-Pfade,
  Symlink-/Reparse-Ausbrüche oder stilles Überschreiben.
- `readApprovedExport(exportId)` – nur Host-seitig registrierte Export-ID;
  niemals einen iPhone-Pfad auswerten.
- `start|pause|cancelWorkflow(workflowId, runId, expectedRevision)` – nur gegen
  den exakt attestierten Lauf und ausschließlich Einträge aus einem
  versionierten Workflow-Katalog. Kein freier BirdieOS-Tasktext.
- `getWorkflow(workflowId, runId, knownRevision?)` – ein reiner Read, der die
  autoritative Revision zurückliefert und abgeschlossene Läufe auch nach einem
  Folgelauf über die exakte `runId` auffindbar hält; `knownRevision` ist kein
  Mutations-Precondition.
- Interne `complete|failWorkflow(workflowId, runId, expectedRevision, ...)`-
  Callbacks müssen alle drei Cursorfelder atomar prüfen. Gebrauchte `runId`s
  bleiben dauerhaft gesperrt; ein später Callback darf keinen Folgelauf
  treffen.
- `lockInteractiveSession()` – enger Win32-Lock-Executor; keine Logoff-,
  Shutdown- oder PowerShell-Alternative.

Jeder Executor muss vor dem Effekt `(deviceId, idempotencyKey, effectDigest)`
atomar reservieren und danach ein streng JSON-validiertes Envelope liefern:
`version`, `effectId`, `state`, `committedAt`, `resultDigest`, `productionEffect`
und lokaler Receipt-Digest. ACK vor dem realen Effekt genügt nicht. Schlägt
Formatierung/Signing nach einem möglichen Effekt fehl, bleibt die Reservation
`effect_status_unknown`; automatische Neuausführung ist verboten.
Revoke, Kill-Switch oder Command-Ablauf müssen eine noch wartende Effect-Lease
abbrechen. Der OS-/BirdieOS-Commit und der letzte Lease-Check gehören in
dieselbe möglichst enge, adapterseitig kontrollierte Transaktionsgrenze.

## BirdieOS-Grenze

BirdieOS besitzt auf `main` noch keinen sicheren Start/Pause/Cancel-Vertrag.
Ein Adapter darf vorhandene Query-Keys, freie `/tasks/{id}`-Mutationen oder
den Watch-Free-Text-Pfad nicht wiederverwenden. Zuerst ist ein registrierter
Workflow-Katalog mit festen Parametern, Revision, Lease, Idempotenz und
Readback einzuführen. Bis dahin bleiben Workflow-Effekte deaktiviert.

## Exakter nächster Integrationsschritt

Nach Merge und Stabilisierung von PR #64 werden die beiden expliziten
Windows-Executor-Hooks an den realen, ACL-geschützten Host gebunden und nur
über den bestehenden Service mit atomarer Effect-Reservation/Lease aktiviert.
`WindowsPocketRelayAdapter` bleibt bis dahin deaktiviert; Datei- und
Workflow-Handler bleiben explizit disabled. Anschließend Contract-Tests gegen
PR #64s tatsächlichen Stand ergänzen und erst die fehlenden versionierten
Transfer-Grants beziehungsweise den BirdieOS-Workflow-Katalog bauen. Die
bestehende Core-Pipe bleibt lokal und wird weder als Netzwerktransport noch als
Authentisierungsgrenze verwendet.
