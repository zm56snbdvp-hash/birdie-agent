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
const betaReadmePath = "clients/unity/BirdieWorld/README-BETA.md";

const methodBody = (source, signature) => {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing method: ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`unterminated method: ${signature}`);
};

test("Beta 02 exposes a real generated 3-D world after the first journey", () => {
  const world = read(worldPath);
  const journey = read(journeyPath);
  const bootstrap = read(bootstrapPath);

  assert.match(world, /public sealed class BirdieWorldThreeDWorld/);
  assert.match(world, /BuiltInMesh\(type\)/);
  assert.match(world, /AddComponent<MeshFilter>\(\)/);
  assert.doesNotMatch(world, /GameObject\.CreatePrimitive/);
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

test("the 3-D forecourt supports held touch movement and a bounded Nest action", () => {
  const world = read(worldPath);
  const bootstrap = read(bootstrapPath);
  const betaReadme = read(betaReadmePath);
  const movement = methodBody(world, "private void HandleMovement()");
  const touchButton = methodBody(world, "private void TouchMovementButton(");
  const beginTouch = methodBody(world, "private void BeginTouchMovement(");
  const endTouch = methodBody(world, "private void EndTouchMovement(");
  const actionButton = methodBody(world, "private void TouchActionButton(");
  const responsiveLayout = methodBody(world, "private void ApplyResponsiveLayout(");
  const safeArea = methodBody(world, "private void ApplySafeArea(");

  assert.match(world, /using UnityEngine\.EventSystems;/);
  assert.match(world, /typeof\(GraphicRaycaster\)/);
  assert.match(bootstrap, /BuildEventSystem\(\);/);
  assert.match(bootstrap, /new GameObject\("EventSystem", typeof\(EventSystem\), typeof\(StandaloneInputModule\)\)/);
  assert.match(world, /private Vector2 touchMovement;/);
  assert.match(world, /private int activeTouchPointerId = int\.MinValue;/);
  assert.match(world, /WorldTouchControls/);
  for (const [label, vector] of [["↑", "0f, 1f"], ["←", "-1f, 0f"], ["↓", "0f, -1f"], ["→", "1f, 0f"]])
    assert.match(world, new RegExp(`TouchMovementButton\\(touchControls\\.transform, "${label}"[^;]+new Vector2\\(${vector}\\)\\);`));
  assert.match(touchButton, /EventTriggerType\.PointerDown[^;]+BeginTouchMovement/);
  assert.match(touchButton, /EventTriggerType\.PointerUp, EndTouchMovement/);
  assert.match(touchButton, /EventTriggerType\.PointerExit, EndTouchMovement/);
  assert.match(touchButton, /EventTriggerType\.Cancel, EndTouchMovement/);
  assert.doesNotMatch(touchButton, /onClick[\s\S]*MovePlayer/);
  assert.match(betaReadme, /hold one arrow to move[\s\S]*swiping between arrows is intentionally outside this beta scope/i);
  assert.match(beginTouch, /activeTouchPointerId != int\.MinValue && pointer\.pointerId != activeTouchPointerId/);
  assert.match(beginTouch, /activeTouchPointerId = pointer\.pointerId/);
  assert.match(endTouch, /pointer\.pointerId != activeTouchPointerId[\s\S]*return;[\s\S]*ResetTouchInput\(\)/);
  assert.match(world, /OnDisable\(\)[\s\S]*ResetTouchInput\(\)/);
  assert.match(world, /OnApplicationFocus\(bool hasFocus\)[\s\S]*!hasFocus[\s\S]*ResetTouchInput\(\)/);
  assert.match(movement, /horizontal = touchMovement\.x[\s\S]*vertical = touchMovement\.y/);
  assert.match(movement, /Input\.GetKey\(KeyCode\.A\)[\s\S]*Input\.GetKey\(KeyCode\.W\)/);
  assert.match(world, /movement\.Normalize\(\)[\s\S]*playerPosition \+= movement \* distance/);
  assert.match(actionButton, /WorldTouchAction[\s\S]*onClick\.AddListener\(InteractAtWorldMarker\)/);
  assert.doesNotMatch(actionButton, /MovePlayer|CharacterProfile|UnityWebRequest/);
  assert.match(world, /touchActionButton\.interactable = !hasArrivedAtNest && distance <= 4\.2f/);
  assert.match(world, /MinimumTouchTargetPixels = 44f/);
  assert.match(world, /EnsureMinimumTouchTargets\(\)/);
  assert.match(world, /target\.sizeDelta = Vector2\.zero/);
  assert.match(responsiveLayout, /Screen\.safeArea/);
  assert.match(responsiveLayout, /Stretch\(touchControlsPanel, new Vector2\(0\.05f, 0\.18f\), new Vector2\(0\.95f, 0\.53f\)\)/);
  assert.match(responsiveLayout, /Stretch\(touchControlsPanel, new Vector2\(0\.50f, 0\.05f\), new Vector2\(0\.70f, 0\.25f\)\)/);
  assert.match(safeArea, /hudRoot\.anchorMin = safeMin[\s\S]*hudRoot\.anchorMax = safeMax/);
  assert.match(world, /backButton\.onClick\.AddListener\(ReturnToJourney\)/);
  assert.doesNotMatch(world, /TOUCH FOLGT/);
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
