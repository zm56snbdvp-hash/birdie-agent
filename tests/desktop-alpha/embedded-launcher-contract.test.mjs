import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('embedded launcher builds and fingerprints the current frontend before Tauri', async () => {
  const launcher = await source('scripts/run-birdie-desktop-embedded.ps1');
  const frontendBuild = launcher.indexOf('& npm run build');
  const tauriBuild = launcher.indexOf('& cargo build');

  assert.ok(frontendBuild >= 0, 'frontend build is required');
  assert.ok(tauriBuild > frontendBuild, 'Tauri must embed the just-built frontend');
  assert.match(launcher, /\$env:BIRDIE_DESKTOP_BUILD_ID = \$buildId/);
  assert.match(launcher, /Frontend bundle does not contain build ID \$buildId/);
  assert.match(launcher, /Get-FileHash -LiteralPath \$desktopExe/);
  assert.match(launcher, /desktop-runtime-diagnostic\.log/);
  assert.match(launcher, /DESKTOP BRIDGE PROVEN/);
  assert.match(launcher, /DESKTOP STABLE READY/);
  assert.match(launcher, /ReadyHoldSeconds/);
  assert.match(launcher, /STABILITY_GATE_COMPLETE/);
  assert.match(launcher, /Desktop bridge proof failed/);
  assert.doesNotMatch(
    launcher,
    /\[IO\.Path\]::GetRelativePath/,
    'Windows PowerShell 5.1 does not provide Path.GetRelativePath',
  );
});

test('embedded launcher requires matching native and WebView identities before sustained READY', async () => {
  const launcher = await source('scripts/run-birdie-desktop-embedded.ps1');

  assert.match(launcher, /DESKTOP_FRONTEND source=js buildId=\$buildId mode=headless/);
  assert.match(
    launcher,
    /DESKTOP_START pid=\$\(\$desktopProcess\.Id\) buildId=\$buildId/,
  );
  assert.match(launcher, /\$nativeBuildReady/);
  assert.match(launcher, /\$frontendReady -and \$nativeBuildReady/);
  assert.match(launcher, /RUNTIME_DISCONNECTED/);
  assert.match(launcher, /microphone left the ENABLED state/);
  assert.match(launcher, /Get-BirdieOwnedProcesses/);
  assert.match(launcher, /originalEnvironment/);
  assert.match(launcher, /Get-LatestReadyJsSnapshotTimestamp/);
  assert.match(launcher, /brainState=READY/);
  assert.match(launcher, /ValidateRange\(60, 600\)/);
  assert.equal(
    launcher.match(/Stop-BirdieProcesses/g)?.length,
    2,
    'global process cleanup may run only during preflight, never final cleanup',
  );
});

test('headless desktop diagnostics cover every native, Tauri, IPC and JS boundary', async () => {
  const [nativeHost, bridge, main, launcher] = await Promise.all([
    source('apps/desktop/src-tauri/src/lib.rs'),
    source('apps/desktop/src/runtime-bridge.js'),
    source('apps/desktop/src/main.js'),
    source('scripts/run-birdie-desktop-embedded.ps1'),
  ]);
  const combined = `${nativeHost}\n${bridge}\n${main}\n${launcher}`;
  const requiredEvents = [
    'DESKTOP_START',
    'PIPE_CONNECT_ATTEMPT',
    'PIPE_CONNECTED',
    'HELLO_SENT',
    'HELLO_ACK',
    'SNAPSHOT_RECEIVED',
    'RUST_STATE_UPDATED',
    'TAURI_INVOKE',
    'TAURI_INVOKE_RESULT',
    'JS_SNAPSHOT',
    'JS_STATUS',
    'DESKTOP_FRONTEND',
    'STABILITY_GATE_COMPLETE',
    'RUNTIME_DISCONNECTED',
    'ERROR',
  ];

  for (const event of requiredEvents) {
    assert.ok(combined.includes(event), `missing diagnostic event ${event}`);
  }
  assert.match(main, /mode=headless/);
});

test('Windows CI parses the hardware launcher and verifies embedded build identity', async () => {
  const workflow = await source('.github/workflows/birdie-desktop-alpha.yml');
  assert.match(workflow, /scripts\/run-birdie-desktop-embedded\.ps1/);
  assert.match(workflow, /ParseFile/);
  assert.match(workflow, /BIRDIE_DESKTOP_BUILD_ID: ci-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Built frontend does not contain BIRDIE_DESKTOP_BUILD_ID/);
  assert.match(workflow, /cargo test --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml --lib/);
  assert.match(workflow, /cargo build --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml/);
  assert.match(workflow, /DESKTOP_FRONTEND source=js buildId=/);
  assert.match(workflow, /TAURI_LISTEN_RESULT source=js event=runtime:ipc-error result=OK/);
  assert.match(workflow, /Prove live Core named pipe through Rust and embedded WebView/);
  assert.match(workflow, /ready-runtime-fixture\.mjs/);
  assert.match(workflow, /READY_RUNTIME_FIXTURE presence=IDLE microphone=ENABLED/);
  assert.match(workflow, /RUST_STATE_UPDATED/);
  assert.match(workflow, /JS_SNAPSHOT source=js/);
  assert.doesNotMatch(workflow, /DOM_STATE source=js state=IDLE/);
});

test('release bundle pins and stages every offline runtime dependency', async () => {
  const [tauriSource, packageSource, lockSource, preparer, workflow] =
    await Promise.all([
      source('apps/desktop/src-tauri/tauri.conf.json'),
      source('apps/desktop/package.json'),
      source('apps/desktop/package-lock.json'),
      source('scripts/prepare-birdie-desktop-bundle.ps1'),
      source('.github/workflows/birdie-desktop-alpha.yml'),
    ]);
  const tauri = JSON.parse(tauriSource);
  const desktopPackage = JSON.parse(packageSource);
  const lock = JSON.parse(lockSource);

  assert.equal(tauri.build.beforeBuildCommand, 'npm run build:bundle');
  assert.equal(
    desktopPackage.scripts['build:bundle'],
    'powershell -NoProfile -ExecutionPolicy Bypass -File ../../scripts/prepare-birdie-desktop-bundle.ps1 && vite build',
  );
  assert.equal(desktopPackage.dependencies.jsqr, '1.4.0');
  assert.equal(lock.packages[''].dependencies.jsqr, '1.4.0');
  assert.equal(lock.packages['node_modules/jsqr'].version, '1.4.0');

  assert.deepEqual(tauri.bundle.resources, {
    '../../../services/core': 'services/core',
    '../../../packages/protocol': 'packages/protocol',
    '../../../build/runtime/node.exe': 'build/runtime/node.exe',
    '../../../build/runtime/LICENSE.node.txt': 'build/runtime/LICENSE.node.txt',
    '../../../build/voice/Release/birdie-voice-host.exe':
      'build/voice/Release/birdie-voice-host.exe',
    '../../../models/whisper/ggml-base.bin': 'models/whisper/ggml-base.bin',
  });

  assert.match(preparer, /\$nodeVersion = '22\.23\.2'/);
  assert.match(
    preparer,
    /1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97/,
  );
  assert.match(
    preparer,
    /0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4/,
  );
  assert.match(
    preparer,
    /8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576/,
  );
  assert.match(
    preparer,
    /978113305b2ead22249b881deafa131dc8884911/,
  );
  assert.match(
    preparer,
    /465707469ff3a37a2b9b8d8f89f2f99de7299dac/,
  );
  assert.match(preparer, /https:\/\/nodejs\.org\/dist\/v\$nodeVersion/);
  assert.match(preparer, /Security\.Cryptography\.SHA256/);
  assert.doesNotMatch(
    preparer,
    /Get-FileHash/,
    'bundle preparation must not depend on host PowerShell module autoloading',
  );

  assert.match(workflow, /npm ci --prefix apps\/desktop/);
  assert.match(workflow, /prepare-birdie-desktop-bundle\.ps1 -RunVoiceTests/);
  assert.match(workflow, /npm --prefix apps\/desktop run tauri -- build/);
  assert.match(workflow, /test-birdie-desktop-bundle-runtime\.ps1/);
  const bundlePrepare = workflow.indexOf('prepare-birdie-desktop-bundle.ps1 -RunVoiceTests');
  const firstCargo = Math.min(
    workflow.indexOf('cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml'),
    workflow.indexOf('cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml'),
  );
  assert.ok(bundlePrepare >= 0 && bundlePrepare < firstCargo, 'bundle resources must exist before Cargo evaluates tauri-build');
  assert.equal(
    workflow.match(/prepare-birdie-desktop-bundle\.ps1 -RunVoiceTests/g)?.length,
    1,
    'CI must pre-stage and test resources once before Cargo; Tauri intentionally revalidates through build:bundle',
  );
});

test('installed bundle smoke is fail-closed, PATH-isolated and path-scoped', async () => {
  const smoke = await source('scripts/test-birdie-desktop-bundle-runtime.ps1');

  assert.match(smoke, /BIRDIE_MANAGE_VOICE.*'0'/);
  assert.match(smoke, /build[\\/]runtime[\\/]node\.exe/);
  assert.match(smoke, /LICENSE\.node\.txt/);
  assert.match(smoke, /birdie-voice-host\.exe/);
  assert.match(smoke, /ggml-base\.bin/);
  assert.match(smoke, /PIPE_CONNECTED/);
  assert.match(smoke, /SUPERVISOR_SPAWN_OK/);
  assert.match(smoke, /Get-Process node/);
  assert.match(smoke, /GetFullPath\(\$nodeExe\)/);
  assert.match(smoke, /System32/);
  assert.doesNotMatch(
    smoke,
    /Stop-Process\s+-Name/,
    'cleanup must never kill unrelated processes by a shared executable name',
  );
  assert.match(smoke, /StartsWith\(\$Prefix/);
  assert.match(smoke, /Stop-OwnedProcesses \$installPrefix/);
  assert.match(smoke, /BirdieBundleSmoke-/);
});
