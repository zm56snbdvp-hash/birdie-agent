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
