import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const worldPath = "clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldThreeDWorld.cs";
const journeyPath = "clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFirstJourney.cs";
const bootstrapPath = "clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs";

test("Beta 02 exposes a real generated 3-D world after the first journey", () => {
  const world = read(worldPath);
  const journey = read(journeyPath);
  const bootstrap = read(bootstrapPath);

  assert.match(world, /public sealed class BirdieWorldThreeDWorld/);
  assert.match(world, /GameObject\.CreatePrimitive/);
  assert.match(world, /AddComponent<Camera>\(\)/);
  assert.match(world, /AddComponent<Light>\(\)/);
  assert.match(world, /BuildEnvironment\(\)/);
  assert.match(world, /BuildNest\(/);
  assert.match(world, /BuildTrees\(/);
  assert.match(world, /Input\.GetKey\(KeyCode\.(?:W|UpArrow)\)/);
  assert.match(world, /Input\.GetKeyDown\(KeyCode\.E\)/);
  assert.match(world, /public void Enter\(CharacterProfile snapshot\)/);
  assert.match(world, /never writes the character profile/i);

  assert.match(journey, /WELT BETRETEN/);
  assert.match(journey, /Action enterWorld/);
  assert.match(journey, /onEnterWorld\?\.Invoke\(\)/);
  assert.match(bootstrap, /private BirdieWorldThreeDWorld threeDWorld;/);
  assert.match(bootstrap, /BuildThreeDWorld\(\);/);
  assert.match(bootstrap, /firstJourney\.Build\(canvas\.transform, font,[\s\S]*BeginThreeDWorld/);
  assert.match(bootstrap, /private void BeginThreeDWorld\(\)/);
  assert.match(bootstrap, /threeDWorld\.Enter\(readOnlyProfile\);/);
});

test("the 3-D forecourt keeps the account and economic boundaries intact", () => {
  const world = read(worldPath);
  assert.doesNotMatch(
    world,
    /PlayerPrefs|CharacterStore|BirdieWorldCharacterApi|BirdieWorldCharacterPersistence|UnityWebRequest|HttpClient|\b(?:balance|points|transaction|redemption)\b|bird mascot|Harry Potter|Hogwarts|wizard|spell|magic school/i
  );
  assert.match(world, /read-only|presentation-only/i);
  assert.match(world, /onReturnToJourney\?\.Invoke\(\)/);
});
