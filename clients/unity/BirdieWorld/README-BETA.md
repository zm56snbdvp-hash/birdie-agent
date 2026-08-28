# BirdieWorld Beta 02 candidate — private review

Open this folder as a Unity 6 LTS project.

The WebGL review target follows one bounded path:

`Opener -> creator -> ready -> first journey platform -> meet human Leni -> route map -> Birdie Express ride -> The Nest forecourt -> 3-D forecourt`

On the first run, both opener choices lead through Character Creation and the ready confirmation. A returning player with a valid ready profile may resume through `REISE BEGINNEN`; `BIRDIE ERSTELLEN` still opens the creator. The journey begins on the platform, introduces human Leni, reveals the route map, boards the Birdie Express and stops outside The Nest. The `WELT BETRETEN` action opens a genuinely rendered, generated 3-D Nest forecourt with a walkable Birdie avatar, river bridge, station, side buildings, trees, lamps and gold arrival marker. The Nest interior and the wider world remain out of scope. The generated scene and WebGL build are available from the Unity menu under `BirdieWorld`.

For account sync, the surrounding authenticated shell supplies an in-memory Birdie bearer token after `birdieworld:ready`:

```js
window.dispatchEvent(new CustomEvent("birdieworld:session", {
  detail: {
    apiBaseUrl: "https://birdie-agent-893591677320.europe-west3.run.app",
    bearerToken
  }
}));
```

The protected Beta uses that exact, verified Cloud Run origin. The future
`https://agent.birdieandbreakfast.de` origin remains separately allowlisted,
but must not be selected until its DNS mapping is explicitly configured and
verified. No other `run.app` host, suffix match, custom port or URL path is
accepted.

The template derives an in-memory SHA-256 isolation key from the JWT issuer, `sub` and authoritative `https://birdieandbreakfast.de/birdie_id` claim. A missing or malformed identity clears the session; token refreshes for the same account retain the state, while any identity change is quarantined before its profile loads. The key is never server identity; the API still verifies the token and derives the real Birdie identity. An iframe host can send the equivalent same-origin `postMessage` payload with type `birdieworld:session`. Logout uses `birdieworld:session-clear`. Never place the token or derived key in a URL, browser storage, logs or Unity `PlayerPrefs`.

Character reads and saves use `/birdie-app/v1/character`; local `PlayerPrefs` is only for a signed-out draft. Account-bound state remains in memory until the server confirms it and is never reused across account switches. The client never sends `birdieId`, `characterId`, timestamps or economic state. An authenticated account without a server profile starts from a new blank character and is never seeded automatically from a previous local/account profile.

The creator renders a human live-preview from Unity UI primitives. Name, story and signature-color changes update it immediately, while selected controls receive a visible focus state. This preview has no mascot or economic behavior and can later be replaced by a production 3D human prefab without changing the character API. The current forecourt uses deterministic Unity primitives for the same reason: it is a real 3-D runtime surface, but remains replaceable art direction rather than a claim of the final wider world.

The first journey receives only a read-only snapshot of the selected display name, story and signature color. Its stage, movement and responsive UI state stay in memory: it does not use `PlayerPrefs`, call the network, write the character profile or create any Coin effect. Keyboard and touch controls must both complete the same route on desktop and iPhone-sized portrait layouts. The 3-D forecourt uses discrete touch direction buttons: hold one arrow to move, then lift or leave that button to stop; swiping between arrows is intentionally outside this beta scope.

## Review boundary

Beta 02 account sync must still pass create → save → reload with the same server-owned `characterId`. A new clean WebGL artifact must then pass the entire candidate flow on Acer and iPhone. Production confirmation and Founder acceptance remain separate release gates. This candidate may be deployed only as an access-protected preview; it is not public, Production, or Founder-accepted.
