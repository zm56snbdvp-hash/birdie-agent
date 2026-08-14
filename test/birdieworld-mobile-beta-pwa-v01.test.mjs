import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "client", "birdie-app-v1");
const readClient = (path) => readFile(join(clientRoot, path), "utf8");

const index = await readClient("index.html");
const main = await readClient("src/main.tsx");
const registration = await readClient("src/mobileBeta.ts");
const serviceWorker = await readClient("public/sw.js");
const manifest = JSON.parse(await readClient("public/manifest.webmanifest"));

test("Mobile Beta PWA V0.1 has one bounded install contract", () => {
  assert.equal(manifest.name, "BirdieWorld Mobile Beta");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.lang, "de");
  assert.deepEqual(
    manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]),
    [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]
  );
});

test("iPhone metadata and safe-area viewport are explicit", () => {
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon"/);
  assert.match(index, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(index, /name="apple-mobile-web-app-title" content="BirdieWorld"/);
});

test("service worker is versioned, same-origin and stores no API or user state", () => {
  assert.match(main, /registerMobileBetaServiceWorker\(\)/);
  assert.match(registration, /MOBILE_BETA_VERSION = "pwa-v0\.1"/);
  assert.match(serviceWorker, /birdieworld-mobile-beta-/);
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  for (const token of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "userId"]) {
    assert.doesNotMatch([registration, serviceWorker].join("\n"), new RegExp(token));
  }
});
