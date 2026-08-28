# Birdie Watch: sichere Backend-Aktivierung

Stand 28. August 2026 meldet der öffentliche Birdie-Agent-Status
`watch: AUTH_GATE_NOT_CONFIGURED`. Im Repository existiert kein Watch-Schlüssel,
und es wird für den Release-Candidate keiner erzeugt, ausgelesen oder rotiert.

Eine autorisierte Metadatenprüfung hat außerdem bestätigt:

- Secret Manager enthält kein Secret `birdie-watch-api-key`.
- Die aktuelle Cloud-Run-Revision enthält weder `BIRDIE_WATCH_API_KEY` noch
  eine Referenz auf dieses Secret.
- Die GitHub-Umgebung `birdie-watch-live` und der dedizierte OIDC-Provider
  `github-birdie-watch` existieren noch nicht.

Der bestehende Provider `github-birdie-agent` bleibt unverändert. Er ist laut
Repository-Vertrag an einen anderen Workflow gebunden und darf für die
Watch-Lane nicht aufgeweicht werden.

## 1. Dedizierte OIDC-Lane vorbereiten

Ein autorisierter GCP-Operator exportiert zuerst ausschließlich die Metadaten
des bestehenden Providers und die IAM-Policy des Deployers:

```bash
PROJECT_ID='gen-lang-client-0251788487'
PROJECT_NUMBER='893591677320'
POOL_ID='github-birdie-agent'
SOURCE_PROVIDER='github-birdie-agent'
WATCH_PROVIDER='github-birdie-watch'
DEPLOYER_SA='birdie-github-deployer@gen-lang-client-0251788487.iam.gserviceaccount.com'

gcloud iam workload-identity-pools providers describe "$SOURCE_PROVIDER" \
  --project "$PROJECT_ID" --location global \
  --workload-identity-pool "$POOL_ID" \
  --format='yaml(name,state,attributeMapping,attributeCondition)'

gcloud iam service-accounts get-iam-policy "$DEPLOYER_SA" \
  --project "$PROJECT_ID" --format=json
```

Die aktuelle Live-`attributeMapping` und die aktuelle
`roles/iam.workloadIdentityUser`-Bindung sind nicht im Repository bewiesen.
Deshalb darf hier kein Mapping geraten und keine IAM-Bindung ungeprüft
vorausgesetzt werden.

Anschließend wird ein eigener Provider mit der unveränderten, live exportierten
`attributeMapping` und exakt dieser zusätzlichen Condition erstellt:

```text
assertion.sub == 'repo:zm56snbdvp-hash/birdie-agent:environment:birdie-watch-live'
  && assertion.repository_id == '1329217661'
  && assertion.repository_owner_id == '315131667'
  && assertion.ref == 'refs/heads/main'
  && assertion.environment == 'birdie-watch-live'
  && assertion.event_name == 'workflow_dispatch'
  && assertion.workflow_ref == 'zm56snbdvp-hash/birdie-agent/.github/workflows/deploy-watch-live.yml@refs/heads/main'
```

Die erwartete Provider-Koordinate ist:

```text
projects/893591677320/locations/global/workloadIdentityPools/github-birdie-agent/providers/github-birdie-watch
```

Nur falls der IAM-Export keine passende, eng auf Repository-ID `1329217661`
begrenzte `roles/iam.workloadIdentityUser`-Bindung für den Pool zeigt, darf ein
autorisierter Betreiber genau diese Principal-Set-Bindung ergänzen. Keine
Owner-, Editor-, Service-Account-Admin- oder Schlüsselberechtigungen vergeben.

## 2. Geschützte GitHub-Umgebung vorbereiten

Vor dem ersten Dispatch `birdie-watch-live` mit folgenden Eigenschaften
anlegen:

- Deployment-Branch ausschließlich `main`
- Founder als erforderlicher Reviewer; kein unkontrollierter Bypass
- `GCP_WIF_PROVIDER`: die oben genannte dedizierte Provider-Koordinate
- `GCP_DEPLOYER_SERVICE_ACCOUNT`:
  `birdie-github-deployer@gen-lang-client-0251788487.iam.gserviceaccount.com`
- `GCP_RUNTIME_SERVICE_ACCOUNT`:
  `893591677320-compute@developer.gserviceaccount.com`
- `BIRDIE_WATCH_ENVIRONMENT_GUARD`: `BIRDIE_WATCH_PROTECTED_V1`

Der Watch-Key ist kein GitHub-Secret und keine GitHub-Variable.

## 3. Secret durch einen autorisierten Betreiber anlegen

Der Founder stellt außerhalb von Repository, GitHub und Chat einen unabhängigen
Schlüssel mit mindestens 32 Zeichen bereit. Ein autorisierter GCP-Operator legt
ihn über eine geschützte lokale Datei an; der Wert darf nicht als CLI-Argument
oder Terminalausgabe erscheinen:

```bash
gcloud secrets create birdie-watch-api-key \
  --project gen-lang-client-0251788487 \
  --replication-policy=automatic

gcloud secrets versions add birdie-watch-api-key \
  --project gen-lang-client-0251788487 \
  --data-file="$SECURE_WATCH_KEY_FILE"
```

Die Runtime-Service-Identity erhält `roles/secretmanager.secretAccessor` nur
auf diesem Secret. Der Deployer erhält für die vorhandenen Metadatenchecks
höchstens `roles/secretmanager.viewer` auf diesem Secret. Kein Audit darf
`gcloud secrets versions access` ausführen.

## 4. Secret-Preflight ohne Secret-Ausgabe

Nach Merge eines grünen PRs den Workflow ausschließlich mit dem exakten
geschützten `main`-SHA und der Bestätigung
`DEPLOY_BIRDIE_WATCH_PRODUCTION` starten. Vor jedem Image-Push prüft er nur die
Metadaten:

```bash
gcloud secrets describe birdie-watch-api-key \
  --project gen-lang-client-0251788487 \
  --format='value(name)'

gcloud secrets versions describe latest \
  --secret birdie-watch-api-key \
  --project gen-lang-client-0251788487 \
  --format='value(name,state)'
```

Erwartet werden der exakte Ressourcenname sowie eine numerische Version mit
Status `ENABLED`. Kein Befehl greift auf den Secret-Wert zu. Fehlt das Secret
oder ist die neueste Version nicht aktiviert, stoppt der Workflow vor
Image-Push und Deployment.

## 5. Sichere Bindung und Nachweis

Ist die vorhandene Secret-Version aktiviert, merkt sich der Workflow ihre
numerische Versions-ID und erstellt eine neue, digest-gepinnte Cloud-Run-
Revision bei null Prozent Traffic. Gebunden und im Kandidaten verifiziert wird
nur die ermittelte unveränderliche Version, zum Beispiel:

```text
BIRDIE_WATCH_API_KEY=birdie-watch-api-key:7
```

Die Zahl ist ausschließlich Secret-Metadatum; der Secret-Wert wird weder
gelesen noch ausgegeben. Der Workflow verifiziert auf der Kandidaten-URL
`watch: SCOPED_AUTH_READY` sowie den
exakten unauthentifizierten `401 WATCH_UNAUTHORIZED`-Vertrag aller drei
`/watch/*`-Routen. Erst danach wird genau diese Revision auf 100 Prozent
geschaltet. IAM muss unverändert bleiben; bei fehlgeschlagener Live-Prüfung wird
der vorherige 100-Prozent-Stand wiederhergestellt.
