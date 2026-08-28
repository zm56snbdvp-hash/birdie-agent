import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflowPaths = [
  ".github/workflows/apple-build.yml",
  ".github/workflows/apple-personal-project.yml",
  ".github/workflows/apple-testflight.yml"
];

async function readNormalized(path) {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
}

test("all Apple workflows use the current Xcode 26 runner and guard", async () => {
  for (const path of workflowPaths) {
    const workflow = await readNormalized(path);
    assert.match(workflow, /runs-on: macos-26/);
    assert.doesNotMatch(workflow, /runs-on: macos-15/);
    assert.match(workflow, /bash scripts\/verify-toolchain\.sh/);
  }
});

test("unsigned Apple builds compile the release configuration", async () => {
  for (const path of workflowPaths.slice(0, 2)) {
    const workflow = await readNormalized(path);
    assert.match(workflow, /-configuration Release/);
    assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
    assert.match(workflow, /CODE_SIGNING_REQUIRED=NO/);
  }
});

test("toolchain guard requires device and simulator SDK major 26 or newer", async () => {
  const guard = await readNormalized("clients/apple/scripts/verify-toolchain.sh");
  assert.match(guard, /MINIMUM_XCODE_MAJOR:-26/);
  for (const sdk of ["iphoneos", "iphonesimulator", "watchos", "watchsimulator"]) {
    assert.match(guard, new RegExp(`\\b${sdk}\\b`));
  }
  assert.doesNotMatch(guard, /\$\{\{\s*secrets\./);
});
