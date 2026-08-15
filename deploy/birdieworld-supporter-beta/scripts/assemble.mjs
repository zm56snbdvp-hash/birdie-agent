import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("source");
const outputRoot = path.resolve("dist");
const expectedHashes = new Map([
  ["Build/Web.data.unityweb", "7281ff81177b70319348da52f096349c91f68be3f119fb5a70b55354b2de2080"],
  ["Build/Web.wasm.unityweb", "c1be3c2ce77a74e6464d358b168a0774c52f8fbf8a3a24bcb99dbf0ef7cc5279"]
]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(sourceRoot, outputRoot, { recursive: true });

const groups = new Map();

async function collectParts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectParts(absolute);
      continue;
    }
    const match = absolute.match(/^(.*)\.part(\d{3})$/);
    if (!match) continue;
    const parts = groups.get(match[1]) ?? [];
    parts.push({ absolute, index: Number(match[2]) });
    groups.set(match[1], parts);
  }
}

await collectParts(outputRoot);

for (const [target, parts] of groups) {
  parts.sort((left, right) => left.index - right.index);
  const buffers = [];
  for (let expected = 0; expected < parts.length; expected += 1) {
    if (parts[expected].index !== expected) {
      throw new Error(`Missing transport part for ${target}: expected ${expected}`);
    }
    buffers.push(await readFile(parts[expected].absolute));
  }
  await writeFile(target, Buffer.concat(buffers));
  await Promise.all(parts.map((part) => unlink(part.absolute)));

  const relative = path.relative(outputRoot, target).split(path.sep).join("/");
  const expectedHash = expectedHashes.get(relative);
  if (!expectedHash) throw new Error(`Unexpected reconstructed file: ${relative}`);
  const actualHash = createHash("sha256").update(await readFile(target)).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Hash mismatch for ${relative}: ${actualHash} != ${expectedHash}`);
  }
  console.log(`Verified ${relative}: ${actualHash}`);
}

if (groups.size !== expectedHashes.size) {
  throw new Error(`Expected ${expectedHashes.size} reconstructed files, got ${groups.size}`);
}

console.log("BirdieWorld runtime preview assembled successfully.");
