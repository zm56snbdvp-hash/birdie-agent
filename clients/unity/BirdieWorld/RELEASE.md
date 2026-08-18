# BirdieWorld Beta 01 release

The Cloud Mac is the release machine for the first public WebGL beta.

## One-time setup

1. Install Unity `6000.0.76f1` in Unity Hub with Web Build Support.
2. Install Node.js if `npx` is unavailable.
3. From Terminal, run `npx vercel login` and authenticate the Birdie & Breakfast Vercel account.

## Release

```bash
cd ~/Desktop/birdie-agent
git pull origin main
cd clients/unity/BirdieWorld
chmod +x release-webgl.sh
./release-webgl.sh
```

The script builds `Builds/WebGL` and deploys it as the production `birdieworld-beta` Vercel project.

Build without deployment:

```bash
./release-webgl.sh --build-only
```

## Beta release gate

Before sharing the URL externally:

- Startscreen opens without console errors.
- `REISE BEGINNEN` opens Character Creation.
- Name, story and color can be selected.
- Character can be saved.
- Authenticated users reload the same account-bound character.
- No coin balance or economic fields are writable by the Unity client.
- Visual direction remains Birdie & Breakfast: Birdie Express, Leni, steep valley/peak travel, dark forest/black/brass. No bird mascot semantics and no borrowed franchise lore.
