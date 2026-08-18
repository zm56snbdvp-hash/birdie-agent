# BirdieWorld Beta 01

Open this folder as a Unity 6 LTS project.

The beta target is WebGL and intentionally contains only the Birdie Express opener plus character creation. The generated scene and WebGL build are available from the Unity menu under `BirdieWorld`.

For public beta, configure the runtime with the authenticated Birdie bearer token supplied by the surrounding web shell/session. Character saves go to `/birdie-app/v1/character`; local storage is fallback only.
