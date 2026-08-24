# BirdieWorld Beta 01 release

Unity 6000.0.76f1 is the build machine for the private-review WebGL candidate. Building and production release are deliberately separate gates.

## One-time setup

1. Install Unity `6000.0.76f1` in Unity Hub with Web Build Support.
2. Production is released only by the protected GitHub Actions environment described in `docs/birdieworld-cloud-ci.md`; local scripts have no production path.

## Release

```bash
cd ~/Desktop/birdie-agent
git pull origin main
cd clients/unity/BirdieWorld
chmod +x release-webgl.sh
./release-webgl.sh --build-only
```

The script defaults to build-only and writes `Builds/WebGL`, including `birdieworld-build.json` and `birdieworld-files.sha256`. The printed manifest digest identifies the exact review files. The script cannot deploy.

`--production` fails closed locally. After device acceptance, dispatch the GitHub workflow in `production` mode from `main` with:

- exact Founder confirmation;
- accepted build-only run ID;
- accepted 40-character source SHA;
- accepted SHA-256 of `birdieworld-files.sha256`;
- fresh invite-only check timestamp and matching project/artifact-bound receipt described in `docs/birdieworld-cloud-ci.md`.

The production job downloads that immutable prior artifact instead of rebuilding it, verifies every file and provenance field, and waits behind the protected `birdieworld-production` environment.

## Acer / Windows build-only checkpoint

Close the Unity Editor and run:

```powershell
cd clients\unity\BirdieWorld
.\build-webgl.ps1
```

The build, provenance record, file-hash manifest and log remain local under `Builds\WebGL` and `Logs`. This command cannot deploy.

## Beta release gate

Before sharing the URL externally or approving production:

- Startscreen opens without console errors.
- `REISE BEGINNEN` opens Character Creation.
- Name, story and color can be selected.
- Character can be saved.
- Authenticated users reload the same account-bound character.
- The server returns the same durable `characterId` and never accepts one from the client.
- The authenticated shell passes the bearer token only in memory; the WebGL template derives its account-isolation key from JWT issuer, `sub` and authoritative Birdie-ID claim, and logout clears both.
- No coin balance or economic fields are writable by the Unity client.
- The exact run ID, source SHA and manifest digest are reviewed on Acer and iPhone Safari/touch.
- The exact beta project is demonstrably invite-only immediately before its fresh, 30-minute release receipt is created.
- Visual direction remains Birdie & Breakfast: Birdie Express, Leni, steep valley/peak travel, dark forest/black/brass. No bird mascot semantics and no borrowed franchise lore.
