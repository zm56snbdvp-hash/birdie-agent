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
    "com.unity.inputsystem": "1.20.0",
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

test("runtime materials follow the active Unity render pipeline", async () => {
  const runtime = await read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFoundationRuntime.cs");
  assert.match(runtime, /GraphicsSettings\.currentRenderPipeline/);
  assert.match(runtime, /activePipeline == null\s*\? Shader\.Find\("Standard"\)\s*:\s*activePipeline\.defaultShader/);
  assert.doesNotMatch(runtime, /Shader\.Find\("Universal Render Pipeline\/Lit"\)\s*\?\?/);
});

test("runtime self-bootstraps from Resources and never fails to a silent black screen", async () => {
  const runtime = await read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFoundationRuntime.cs");
  assert.match(runtime, /ManifestResourcePath = "BirdieWorld\/birdieworld-estate-handoff-v1"/);
  assert.match(runtime, /RuntimeInitializeOnLoadMethod\(RuntimeInitializeLoadType\.AfterSceneLoad\)/);
  assert.match(runtime, /FindFirstObjectByType<BirdieWorldFoundationRuntime>/);
  assert.match(runtime, /Resources\.Load<TextAsset>\(ManifestResourcePath\)/);
  assert.match(runtime, /try\s*\{[\s\S]*BuildFoundation\(\);[\s\S]*\}\s*catch \(Exception exception\)/);
  assert.match(runtime, /BirdieWorldRuntimeFailure\.Show\(exception\)/);
  assert.match(runtime, /BirdieWorld_FallbackCamera/);
  assert.match(runtime, /Bitte neu laden oder den Test-Link melden/);
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

test("account gate rejects passwords that do not meet UGS complexity before authentication", async () => {
  const account = await read("unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldAccountGate.cs");
  const validationCall = account.indexOf("if (!ValidateCredentials()) return;");
  const signUpCall = account.indexOf("SignUpWithUsernamePasswordAsync");

  assert.ok(validationCall >= 0 && validationCall < signUpCall);
  assert.match(account, /password\.Length < MinimumPasswordLength \|\| password\.Length > MaximumPasswordLength/);
  assert.match(account, /char\.IsUpper\(character\)/);
  assert.match(account, /char\.IsLower\(character\)/);
  assert.match(account, /char\.IsDigit\(character\)/);
  assert.match(account, /!char\.IsLetterOrDigit\(character\) && !char\.IsWhiteSpace\(character\)/);
  assert.match(
    account,
    /Passwort: 8–30 Zeichen mit mindestens einem Großbuchstaben, einem Kleinbuchstaben, einer Zahl und einem Symbol\./
  );
});

test("Windows automation fails closed and invokes only bounded Unity methods", async () => {
  const script = await read("scripts/birdieworld-unity.ps1");
  assert.match(script, /6000\.5\.8f1/);
  assert.match(script, /ValidateSet\("check", "prepare", "build"\)/);
  assert.match(script, /BirdieWorld\.Editor\.BirdieWorldFoundationBuilder\.PrepareFoundation/);
  assert.match(script, /BirdieWorld\.Editor\.BirdieWorldFoundationBuilder\.BuildSupporterWeb/);
  assert.match(script, /-batchmode/);
  assert.match(script, /-projectPath/);
  assert.match(script, /Close the Unity Editor/);
  assert.doesNotMatch(script, /Remove-Item|Invoke-WebRequest|Start-Process|git push|deploy/i);
});
