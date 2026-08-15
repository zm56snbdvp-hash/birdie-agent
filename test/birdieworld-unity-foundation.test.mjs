import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Unity foundation pins the production editor, rendering, input and account baseline", async () => {
  const [version, packages] = await Promise.all([
    read("unity/BirdieWorld/ProjectSettings/ProjectVersion.txt"),
    read("unity/BirdieWorld/Packages/manifest.json")
  ]);
  assert.match(version, /6000\.5\.8f1/);
  assert.deepEqual(JSON.parse(packages).dependencies, {
    "com.unity.inputsystem": "1.17.0",
    "com.unity.render-pipelines.universal": "17.3.0",
    "com.unity.services.authentication": "3.7.3",
    "com.unity.modules.ai": "1.0.0",
    "com.unity.modules.jsonserialize": "1.0.0",
    "com.unity.modules.physics": "1.0.0",
    "com.unity.modules.ui": "1.0.0",
    "com.unity.modules.uielements": "1.0.0"
  });
});

test("Unity imports the canonical manifest and mirrors Z only at the adapter boundary", async () => {
  const [manifest, builder] = await Promise.all([
    read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldEstateManifest.cs"),
    read("unity/BirdieWorld/Assets/BirdieWorld/Editor/BirdieWorldFoundationBuilder.cs")
  ]);
  assert.match(manifest, /ExpectedContract = "birdieworld-estate-handoff-v1"/);
  assert.match(manifest, /ExpectedPresentation = "birdieworld-immersive-estate-v0\.3\.5"/);
  assert.match(manifest, /new Vector3\(source\.x, source\.y, -source\.z\)/);
  assert.match(builder, /client", "birdie-app-v1", "src", "contracts"/);
  assert.match(builder, /BirdieWorldEstateManifest\.ParseAndValidate/);
});

test("foundation adds only the explicitly approved account gate", async () => {
  const [manifest, runtime, account, builder, readme] = await Promise.all([
    read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldEstateManifest.cs"),
    read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFoundationRuntime.cs"),
    read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldAccountGate.cs"),
    read("unity/BirdieWorld/Assets/BirdieWorld/Editor/BirdieWorldFoundationBuilder.cs"),
    read("unity/BirdieWorld/README.md")
  ]);
  assert.match(manifest, /quests \|\| progression \|\| multiplayer \|\| persistentWorldState \|\| teleport \|\| locationTracking/);
  assert.match(runtime, /BuildGround\(manifest/);
  assert.match(runtime, /BuildCollisionVolumes\(manifest/);
  assert.match(runtime, /BuildPlayerAndCamera\(manifest/);
  assert.match(runtime, /BirdieWorldAccountGate/);
  assert.match(account, /SignUpWithUsernamePasswordAsync/);
  assert.match(account, /SignInWithUsernamePasswordAsync/);
  assert.match(account, /SignInAnonymouslyAsync/);
  assert.match(account, /ClearSessionToken/);
  assert.match(builder, /Build Supporter Web/);
  assert.match(readme, /public supporter beta/i);
  assert.doesNotMatch(account, /PlayerPrefs|File\.Write|UnityWebRequest|HttpClient|CoinService|PaymentService|PurchaseService/i);
  assert.doesNotMatch(runtime, /UnityWebRequest|HttpClient|PlayerPrefs|File\.Write|Coin|quest/i);
});
