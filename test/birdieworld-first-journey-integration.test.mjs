import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const bootstrapPath = "clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldBetaBootstrap.cs";
const journeyPath = "clients/unity/BirdieWorld/Assets/BirdieWorld/Scripts/BirdieWorldFirstJourney.cs";

function assertOrdered(source, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert.ok(index > cursor, `Expected ${JSON.stringify(token)} after the previous journey step`);
    cursor = index;
  }
}

function parseCell(source, name) {
  const match = source.match(new RegExp(`private static readonly Vector2Int ${name} = new\\((\\d+), (\\d+)\\);`));
  assert.ok(match, `Missing ${name}`);
  return [Number(match[1]), Number(match[2])];
}

function canReach(start, target, obstacles) {
  const key = ([x, y]) => `${x},${y}`;
  const queue = [start];
  const visited = new Set([key(start)]);
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    if (x === target[0] && y === target[1]) return true;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = [x + dx, y + dy];
      const nextKey = key(next);
      if (next[0] < 0 || next[0] >= 7 || next[1] < 0 || next[1] >= 5) continue;
      if (obstacles.has(nextKey) || visited.has(nextKey)) continue;
      visited.add(nextKey);
      queue.push(next);
    }
  }
  return false;
}

test("Beta 02 wires the first journey behind a valid ready profile", () => {
  const bootstrap = read(bootstrapPath);
  assert.match(bootstrap, /private BirdieWorldFirstJourney firstJourney;/);
  assert.match(bootstrap, /BuildReadyScreen\(\);[\s\S]*BuildFirstJourney\(\);/);
  assert.match(bootstrap, /private void BuildFirstJourney\(\)/);
  assert.match(bootstrap, /firstJourney = gameObject\.AddComponent<BirdieWorldFirstJourney>\(\);/);
  assert.match(bootstrap, /firstJourney\.Build\(canvas\.transform, font,[\s\S]*Show\(startScreen\)/);
  assert.match(bootstrap, /ERSTE REISE (?:STARTEN|BEGINNEN)[\s\S]*BeginFirstJourney/);
  assert.match(bootstrap, /private void BeginFirstJourney\(\)/);
  assert.match(bootstrap, /private bool profileReadyForJourney;/);
  assert.match(bootstrap, /private bool HasReadyProfile\(\)[\s\S]*profileReadyForJourney\s*&&\s*HasValidProfileName\(\)/);
  assert.match(bootstrap, /private void ResumeJourneyOrCreate\(\)[\s\S]*if \(!HasReadyProfile\(\)\)/);
  assert.match(bootstrap, /private void BeginFirstJourney\(\)[\s\S]*if \(!HasReadyProfile\(\)\)/);
  assert.match(bootstrap, /nameField\.onValueChanged[\s\S]*profileReadyForJourney = false;/);
  assert.match(bootstrap, /if \(!profileIsAccountScoped\)[\s\S]*store\.Save\(profile\);[\s\S]*profileReadyForJourney = true;[\s\S]*ShowReady/);
  assert.match(bootstrap, /SaveServerProfile\([\s\S]*profileReadyForJourney = true;[\s\S]*ShowReady/);
  assert.match(bootstrap, /CharacterProfile\.FromJson\(profile\.ToJson\(\)\)/);
  assert.match(bootstrap, /firstJourney\.Enter\([A-Za-z][A-Za-z0-9_]*\);/);
  assert.match(bootstrap, /ShowReady\([\s\S]*Show\(readyScreen\);/);
  assert.match(bootstrap, /firstJourney\?\.ResetJourney\(\)/);
});

test("the first journey exposes one bounded five-stage route", () => {
  const journey = read(journeyPath);
  assert.match(journey, /public sealed class BirdieWorldFirstJourney/);
  assert.match(journey, /public GameObject Screen\s*\{\s*get;\s*private set;\s*\}/);
  assert.match(journey, /public void Build\(Transform parent, Font font, Action [A-Za-z][A-Za-z0-9_]*\)/);
  assert.match(journey, /public void Enter\(CharacterProfile profile\)/);
  assert.match(journey, /public void ResetJourney\(\)/);
  assertOrdered(journey, ["MeetLeni", "ReadMap", "BoardTrain", "Traveling", "Arrived"]);
  assertOrdered(journey, [
    "LENI TREFFEN",
    "STRECKENKARTE LESEN",
    "BIRDIE EXPRESS BESTEIGEN",
    "THE NEST · VORPLATZ"
  ]);
  assert.match(journey, /BAHNSTEIG/);
  assert.match(journey, /MENSCHLICH/);
});

test("every guided platform objective is reachable in route order", () => {
  const journey = read(journeyPath);
  const obstacleBlock = journey.match(/private readonly HashSet<Vector2Int> obstacles = new\(\)\s*\{([\s\S]*?)\};/);
  assert.ok(obstacleBlock, "Missing bounded platform obstacles");
  const obstacles = new Set(
    [...obstacleBlock[1].matchAll(/new Vector2Int\((\d+), (\d+)\)/g)]
      .map((match) => `${match[1]},${match[2]}`)
  );
  const route = ["StartCell", "LeniCell", "MapCell", "TrainCell"].map((name) => parseCell(journey, name));
  for (const cell of route) assert.ok(!obstacles.has(cell.join(",")), `Objective ${cell} is blocked`);
  for (let index = 1; index < route.length; index += 1)
    assert.ok(canReach(route[index - 1], route[index], obstacles), `No platform route to objective ${index}`);
});

test("the first journey supports keyboard, touch and portrait layout", () => {
  const journey = read(journeyPath);
  for (const key of ["W", "A", "S", "D", "UpArrow", "LeftArrow", "DownArrow", "RightArrow"])
    assert.match(journey, new RegExp(`KeyCode\\.${key}`));
  for (const key of ["Return", "KeypadEnter", "Space"])
    assert.match(journey, new RegExp(`KeyCode\\.${key}`));
  assert.match(journey, /KeyCode\.(?:Return|KeypadEnter|Space)[\s\S]*InteractAtCurrentCell\(\)/);
  assert.match(journey, /Button\([\s\S]*[↑←↓→]/);
  assert.match(journey, /ApplyResponsiveLayout\(true\)/);
  assert.match(journey, /ApplyResponsiveLayout\(\)/);
  assert.match(journey, /layoutHeight\s*>\s*layoutWidth/);
  assert.match(journey, /Screen\.width/);
  assert.match(journey, /Screen\.height/);
});

test("the journey receives a read-only cosmetic snapshot and has no side effects", () => {
  const journey = read(journeyPath);
  assert.match(journey, /profile\?\.displayName/);
  assert.match(journey, /profile\?\.story/);
  assert.match(journey, /profile\?\.color/);
  assert.doesNotMatch(journey, /(?:private|protected|internal|public)\s+(?:readonly\s+)?CharacterProfile\s+[A-Za-z][A-Za-z0-9_]*\s*;/);
  assert.doesNotMatch(journey, /profile\??\.[A-Za-z][A-Za-z0-9_]*\s*=(?!=)/);
  assert.doesNotMatch(
    journey,
    /PlayerPrefs|CharacterStore|BirdieWorldCharacterApi|BirdieWorldCharacterPersistence|UnityWebRequest|HttpClient|\b(?:coin|coins|balance|points|transaction|redemption)\b|mascot|bird mascot|Harry Potter|Hogwarts|wizard|spell|magic school/i
  );
});

test("Beta 02 documentation keeps review and release gates explicit", () => {
  const docs = [
    read("clients/unity/BirdieWorld/README.md"),
    read("clients/unity/BirdieWorld/README-BETA.md"),
    read("docs/birdieworld-beta-release.md")
  ];
  for (const source of docs) {
    assert.match(source, /Beta 02/i);
    assert.match(source, /opener[\s\S]*creator[\s\S]*ready[\s\S]*platform[\s\S]*human Leni[\s\S]*route map[\s\S]*Birdie Express ride[\s\S]*The Nest forecourt/i);
    assert.match(source, /not (?:live, public|public, Production), or Founder-accepted/i);
    assert.match(source, /account sync/i);
  }
});
