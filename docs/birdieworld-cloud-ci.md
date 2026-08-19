# BirdieWorld Cloud CI

Goal: remove the Cloud Mac from the normal BirdieWorld WebGL release loop.

## Pipeline

`main` change under `clients/unity/BirdieWorld/**` → GitHub Actions → Unity 6000.0.76f1 WebGL build → Vercel production deploy.

The workflow is `.github/workflows/birdieworld-webgl-deploy.yml`.

## One-time GitHub Actions secrets

Unity Personal builds require:

- `UNITY_LICENSE` — contents of the active `.ulf` Unity license file
- `UNITY_EMAIL` — Unity account email
- `UNITY_PASSWORD` — Unity account password

Vercel production deploy requires:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The Vercel IDs are not secrets in themselves, but keeping all release configuration in Actions secrets avoids hard-coding account/project bindings into the repository.

## Cloud Mac extraction helpers

After Unity has an active Personal license, locate it with:

```bash
find /Library "$HOME/Library" -name 'Unity_lic.ulf' -print 2>/dev/null
```

After a successful Vercel CLI deployment, locate the linked project metadata with:

```bash
find "$HOME/Desktop/birdie-agent/clients/unity/BirdieWorld/Builds/WebGL" -path '*/.vercel/project.json' -print -exec cat {} \;
```

Create a Vercel token in the Vercel account used for `birdieworld-beta`, then add the five values above under GitHub repository Settings → Secrets and variables → Actions.

## Release behavior

- Every matching push to `main` builds and deploys.
- `workflow_dispatch` supports a manual release.
- Builds are uploaded as a GitHub artifact even when Vercel credentials are absent.
- Concurrency cancels stale production builds if a newer BirdieWorld change arrives.

Once a full CI run builds and updates `birdieworld-beta.vercel.app`, the Cloud Mac is no longer required for routine BirdieWorld WebGL releases.
