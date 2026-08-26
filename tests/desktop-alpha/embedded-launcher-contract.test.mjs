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
  assert.doesNotMatch(
    launcher,
    /\[IO\.Path\]::GetRelativePath/,
    'Windows PowerShell 5.1 does not provide Path.GetRelativePath',
  );
});

test('desktop diagnostics cover every native, Tauri, JS and DOM boundary', async () => {
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
    'MAIN_STATE',
    'DOM_STATE',
    'RUNTIME_DISCONNECTED',
    'ERROR',
  ];

  for (const event of requiredEvents) {
    assert.ok(combined.includes(event), `missing diagnostic event ${event}`);
  }
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
});
