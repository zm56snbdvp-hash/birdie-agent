import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("source");
const outputRoot = path.resolve("dist");

const expectedHashes = new Map([
  [
    "Build/Web.data.unityweb",
    "4bac2727ee26563d2a6dd335076c2c25f8cc5b2702badb05bcf4b2b0799eace8"
  ],
  [
    "Build/Web.wasm.unityweb",
    "e1d6760576910cc86b30ed2710360f6a492cc8a4ca2c2e9dbf88beccac88df5e"
  ]
]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(sourceRoot, outputRoot, { recursive: true });

const partGroups = new Map();

async function collectParts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectParts(absolute);
      continue;
    }

    const match = absolute.match(/^(.*)\.part(\d{3})$/);
    if (!match) continue;

    const target = match[1];
    const parts = partGroups.get(target) ?? [];
    parts.push({ absolute, index: Number(match[2]) });
    partGroups.set(target, parts);
  }
}

await collectParts(outputRoot);

for (const [target, parts] of partGroups) {
  parts.sort((left, right) => left.index - right.index);
  const buffers = [];

  for (let expectedIndex = 0; expectedIndex < parts.length; expectedIndex += 1) {
    const part = parts[expectedIndex];
    if (part.index !== expectedIndex) {
      throw new Error(`Missing transport part for ${target}: expected ${expectedIndex}`);
    }
    buffers.push(await readFile(part.absolute));
  }

  await writeFile(target, Buffer.concat(buffers));
  await Promise.all(parts.map((part) => unlink(part.absolute)));

  const relative = path.relative(outputRoot, target).split(path.sep).join("/");
  const expectedHash = expectedHashes.get(relative);
  if (!expectedHash) throw new Error(`Unexpected reconstructed file: ${relative}`);

  const actualHash = createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `Hash mismatch for ${relative}: ${actualHash} != ${expectedHash}`
    );
  }

  console.log(`Verified ${relative}: ${actualHash}`);
}

if (partGroups.size !== expectedHashes.size) {
  throw new Error(
    `Expected ${expectedHashes.size} reconstructed files, got ${partGroups.size}`
  );
}

console.log("BirdieWorld supporter beta artifact assembled successfully.");
