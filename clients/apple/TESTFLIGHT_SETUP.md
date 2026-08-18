# Birdie TestFlight — one-time setup

You do not need a Mac. GitHub Actions supplies the macOS/Xcode build machine.

## 1. Apple Developer / App Store Connect

Use an active Apple Developer Program team. In App Store Connect → Users and Access → Integrations, enable App Store Connect API access and create a **Team API Key** with sufficient provisioning/App Manager or Admin access.

Create these identifiers once in Certificates, Identifiers & Profiles if they do not exist:

- `de.birdieandbreakfast.birdie`
- `de.birdieandbreakfast.birdie.watchkitapp`
- `de.birdieandbreakfast.birdie.watchkitapp.widget`

Create the Birdie app record in App Store Connect using the iPhone bundle ID `de.birdieandbreakfast.birdie`.

## 2. GitHub repository secrets

Repository → Settings → Secrets and variables → Actions → New repository secret.

Add exactly these four secrets:

- `APP_STORE_CONNECT_KEY_ID` — Key ID shown for the Team API Key.
- `APP_STORE_CONNECT_ISSUER_ID` — Issuer ID shown in App Store Connect Integrations.
- `APP_STORE_CONNECT_KEY_B64` — Base64 of the downloaded `.p8` private key file.
- `APPLE_TEAM_ID` — Apple Developer Team ID.

On Windows PowerShell, convert the `.p8` file to one-line Base64 with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\AuthKey_XXXXXXXXXX.p8"))
```

Paste only that output into `APP_STORE_CONNECT_KEY_B64`. Never commit the `.p8` file.

## 3. Ship a build

GitHub → Actions → **Birdie TestFlight** → Run workflow.

The workflow uses a hosted macOS runner, generates the Xcode project, prepares signing with fastlane, archives BirdiePhone + BirdieWatch + the complication, and uploads the IPA to TestFlight.

After Apple finishes processing the build, install TestFlight on the iPhone, accept the Birdie beta, then install the associated Watch app from the Watch app/TestFlight flow.

## Backend note

The Apple app can be installed before the Watch API is live, but Birdie voice/mail requests remain fail-closed until Cloud Run has the Watch-enabled server revision and `BIRDIE_WATCH_API_KEY` configured. Never place `BIRDIE_AGENT_API_KEY` in the app or repository.
