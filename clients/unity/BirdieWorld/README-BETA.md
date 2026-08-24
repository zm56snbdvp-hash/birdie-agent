# BirdieWorld Beta 01 — private review

Open this folder as a Unity 6 LTS project.

The review target is WebGL and intentionally contains only the Birdie Express opener, character creation and the ready confirmation. The generated scene and WebGL build are available from the Unity menu under `BirdieWorld`.

For account sync, the surrounding authenticated shell supplies an in-memory Birdie bearer token after `birdieworld:ready`:

```js
window.dispatchEvent(new CustomEvent("birdieworld:session", {
  detail: {
    apiBaseUrl: "https://agent.birdieandbreakfast.de",
    bearerToken
  }
}));
```

The template derives an in-memory SHA-256 isolation key from the JWT issuer, `sub` and authoritative `https://birdieandbreakfast.de/birdie_id` claim. A missing or malformed identity clears the session; token refreshes for the same account retain the state, while any identity change is quarantined before its profile loads. The key is never server identity; the API still verifies the token and derives the real Birdie identity. An iframe host can send the equivalent same-origin `postMessage` payload with type `birdieworld:session`. Logout uses `birdieworld:session-clear`. Never place the token or derived key in a URL, browser storage, logs or Unity `PlayerPrefs`.

Character reads and saves use `/birdie-app/v1/character`; local `PlayerPrefs` is only for a signed-out draft. Account-bound state remains in memory until the server confirms it and is never reused across account switches. The client never sends `birdieId`, `characterId`, timestamps or economic state. An authenticated account without a server profile starts from a new blank character and is never seeded automatically from a previous local/account profile.
