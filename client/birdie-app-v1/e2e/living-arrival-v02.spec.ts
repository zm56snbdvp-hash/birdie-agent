import { expect, test, type Page, type TestInfo } from "@playwright/test";

const DESTINATIONS = [
  { id: "golf-history", name: "Golf History" },
  { id: "ball-vault", name: "Ball Vault" },
  { id: "personal-birdie", name: "Personal Birdie" }
] as const;

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === new URL(page.url()).origin) {
      errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  return errors;
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png"
  });
}

async function enterWorld(page: Page) {
  const dialog = page.getByRole("dialog", { name: /Schön, dass du da bist/ });
  await expect(dialog).toBeVisible();
  const enter = dialog.getByRole("button", { name: "Welt betreten" });
  await expect(enter).toBeFocused();
  await enter.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-host-stage", "oriented");
}

async function holdKey(page: Page, key: string, durationMs: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(360);
}

async function waitForSceneOutcome(page: Page) {
  const scene = page.locator("section.immersive-estate-scene");
  await expect.poll(
    () => scene.getAttribute("data-estate-webgl"),
    { timeout: 15_000, message: "Estate scene never left its initializing state" }
  ).toMatch(/^(ready|unavailable|context-lost)$/);
  return scene;
}

test("desktop is a fullscreen estate and all three function tabs return to Birdie", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");

  await expect(page).toHaveTitle("BirdieWorld – Immersive Estate V0.3.1");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { level: 1, name: "BirdieWorld Immersive Estate V0.3.1" })).toBeAttached();
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-immersive-estate", "birdieworld-immersive-estate-v0.3.1");
  await expect(main).toHaveAttribute("data-living-arrival", "birdie-as-host-v0.2");
  await expect(main).toHaveAttribute("data-host-stage", "welcomed");

  const bounds = await main.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBe(0);
  expect(bounds!.y).toBe(0);
  expect(Math.abs(bounds!.width - 1365)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.height - 900)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth <= innerWidth,
    vertical: document.documentElement.scrollHeight <= innerHeight,
    bodyOverflow: getComputedStyle(document.body).overflow
  }))).toEqual({ horizontal: true, vertical: true, bodyOverflow: "hidden" });

  await enterWorld(page);
  const scene = await waitForSceneOutcome(page);
  await page.getByRole("button", { name: "Karte" }).click();
  const estateMap = page.getByRole("dialog", { name: "Alles gehört zu einer Welt." });
  await expect(estateMap).toBeVisible();
  await expect(scene).toHaveAttribute("data-estate-paused", "true");
  await page.keyboard.press("Escape");
  await expect(estateMap).toHaveCount(0);
  await expect(scene).toHaveAttribute("data-estate-paused", "false");
  await expect(page.locator("[data-estate-world-surface='true']")).toBeFocused();
  const functions = page.getByRole("navigation", { name: "BirdieWorld Funktionen" }).getByRole("button");
  await expect(functions).toHaveCount(3);
  await functions.first().focus();
  await page.keyboard.press("End");
  await expect(functions.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(functions.first()).toBeFocused();

  for (const [index, destination] of DESTINATIONS.entries()) {
    await page.getByRole("button", { name: new RegExp(destination.name) }).click();
    const panel = page.getByRole("dialog", { name: destination.name });
    await expect(panel).toBeVisible();
    await expect(page.locator(`#${destination.id}`)).toHaveAttribute("aria-current", "location");
    await expect(main).toHaveAttribute("data-host-stage", "invited");
    await expect(scene).toHaveAttribute("data-estate-paused", "true");
    await expect(page.locator(".estate-hud")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".estate-hud")).toHaveAttribute("inert", "");
    await expect(panel.getByRole("button", { name: "Zurück zu Birdie" }).first()).toBeFocused();
    if (index === 0) {
      const launcher = page.getByRole("button", { name: "Birdie öffnen" });
      await expect(launcher).toBeVisible();
      await launcher.click();
      await expect(page.locator("[data-birdie-host='birdie-as-host-v0.2']")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-birdie-host='birdie-as-host-v0.2']")).toHaveCount(0);
      await expect(panel).toBeVisible();
    }
    await panel.getByRole("button", { name: "Zurück zu Birdie" }).first().click();

    const returned = page.getByRole("dialog", { name: /Da bist du wieder/ });
    await expect(returned).toBeVisible();
    await expect(main).toHaveAttribute("data-host-stage", "return-to-birdie");
    await expect(scene).toHaveAttribute("data-estate-paused", "false");
    await expect(page.locator("[aria-current='location']")).toHaveCount(0);
    await returned.getByRole("button", { name: "Birdie minimieren" }).click();
    await expect(page.getByRole("button", { name: "Birdie öffnen" })).toBeVisible();
  }

  const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
    const ids = elements.map((element) => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
  const unnamedButtons = await page.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => !((button.getAttribute("aria-label") ?? button.textContent ?? "").trim()))
      .map((button) => button.outerHTML)
  );
  expect(unnamedButtons).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "desktop-immersive-estate");
});

test("forced WebGL fallback keeps the whole estate, NPCs and function menu operable", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(originalGetContext, this, [contextId, ...args]) as RenderingContext | null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  const welcome = page.getByRole("dialog", { name: /Schön, dass du da bist/ });
  await welcome.getByRole("button", { name: "Ich schaue mich erst um" }).click();
  await expect(welcome).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-host-stage", "oriented");

  const fallback = page.locator("[data-estate-fallback='birdieworld-immersive-estate-v0.3.1']");
  await waitForSceneOutcome(page);
  await expect(fallback).toBeVisible();
  await expect(page.locator("[data-estate-world-surface='true']")).toBeFocused();
  await expect(fallback).toContainText("Birdie Hotel");
  await expect(fallback).toContainText("Golfplatz");
  await expect(fallback).toContainText("Reiterhof");
  await expect(fallback.locator("[data-estate-fallback-district]")).toHaveCount(6);
  await expect(fallback.locator("[data-estate-fallback-interaction]")).toHaveCount(3);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator("[data-estate-touch-controls]")).toHaveCount(0);

  await fallback.getByRole("button", { name: /Reiterhof/ }).click();
  await expect(page.locator("main")).toHaveAttribute("data-estate-district", "stables");
  await fallback.getByRole("button", { name: /Mit Lina am Stall sprechen/ }).click();
  const dialogue = page.getByRole("dialog", { name: "Am Reiterhof" });
  await expect(dialogue).toBeVisible();
  await expect(dialogue).toContainText("Geskriptete Begegnung");
  await dialogue.getByRole("button", { name: "Weiter erkunden" }).click();
  await expect(dialogue).toHaveCount(0);

  await page.getByRole("button", { name: /Ball Vault/ }).click();
  await expect(page.getByRole("dialog", { name: "Ball Vault" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "desktop-estate-fallback");
});

test("real WebGL outcome is recorded without inventing availability", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await enterWorld(page);
  const scene = await waitForSceneOutcome(page);
  await page.waitForTimeout(1_000);

  const canvas = scene.locator("canvas");
  if (await canvas.count()) {
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeVisible();
    await expect(scene).toHaveAttribute("data-scene-ready", "true");
    await expect(scene).toHaveAttribute("data-render-mode", "webgl");
    const canvasSize = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return { width: target.width, clientWidth: target.clientWidth };
    });
    expect(canvasSize.width / canvasSize.clientWidth).toBeLessThanOrEqual(1.76);
    console.log("BIRDIE_WEBGL_EVIDENCE=IMMERSIVE_ESTATE_CANVAS_RENDERED");
  } else {
    await expect(scene).toHaveAttribute("data-render-mode", "fallback");
    await expect(page.locator("[data-estate-fallback]")).toBeVisible();
    testInfo.annotations.push({
      type: "technical-limit",
      description: "GitHub runner exposed no WebGL2 context; full Estate fallback verified, real 3D travel remains open."
    });
    console.log("BIRDIE_WEBGL_EVIDENCE=UNAVAILABLE_FULL_ESTATE_FALLBACK_VERIFIED");
  }
  expect(runtimeErrors).toEqual([]);
});

test("WebGL travel reaches Hotel, Golfplatz and Reiterhof with session-only NPC encounters", async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await enterWorld(page);
  const scene = await waitForSceneOutcome(page);
  if (!(await scene.locator("canvas").count())) {
    testInfo.annotations.push({
      type: "technical-limit",
      description: "WebGL2 unavailable; fallback NPC alternatives are covered by the dedicated fallback gate."
    });
    expect(runtimeErrors).toEqual([]);
    return;
  }

  const renderer = page.locator("[data-estate-scene-focus='true']");
  await renderer.focus();
  await holdKey(page, "w", 6_700);
  await expect(scene).toHaveAttribute("data-estate-zone", "hotel");
  await expect.poll(() => page.locator("button.estate-interaction-prompt").getAttribute("data-nearby-interaction")).toBe("hotel-reception");
  await page.locator("button.estate-interaction-prompt").click();
  await expect(page.getByRole("dialog", { name: "Willkommen im Birdie Hotel" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter erkunden" }).click();

  await holdKey(page, "s", 1_650);
  await holdKey(page, "a", 5_150);
  await expect(scene).toHaveAttribute("data-estate-zone", "golf-course");
  await expect.poll(() => page.locator("button.estate-interaction-prompt").getAttribute("data-nearby-interaction")).toBe("greenkeeper");
  await page.locator("button.estate-interaction-prompt").click();
  await expect(page.getByRole("dialog", { name: "Am Putting Green" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter erkunden" }).click();

  await holdKey(page, "d", 10_250);
  await holdKey(page, "w", 1_150);
  await expect(scene).toHaveAttribute("data-estate-zone", "stables");
  await expect.poll(() => page.locator("button.estate-interaction-prompt").getAttribute("data-nearby-interaction")).toBe("stable-guide");
  await page.locator("button.estate-interaction-prompt").click();
  await expect(page.getByRole("dialog", { name: "Am Reiterhof" })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "desktop-three-district-travel");
});

test("390 x 844 touch shell stays fullscreen and movement never hijacks typing", async ({ browser }, testInfo) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    locale: "de-DE"
  });
  const page = await context.newPage();
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");

  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  const welcome = page.getByRole("dialog", { name: /Schön, dass du da bist/ });
  const welcomeBox = await welcome.boundingBox();
  expect(welcomeBox).not.toBeNull();
  expect(welcomeBox!.x).toBeGreaterThanOrEqual(0);
  expect(welcomeBox!.x + welcomeBox!.width).toBeLessThanOrEqual(390);
  expect(welcomeBox!.y).toBeGreaterThanOrEqual(0);
  expect(welcomeBox!.y + welcomeBox!.height).toBeLessThanOrEqual(844);
  for (const control of [
    welcome.getByRole("button", { name: "Birdie minimieren" }),
    welcome.getByRole("button", { name: "Welt betreten" })
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await enterWorld(page);

  const mapButton = page.getByRole("button", { name: "Karte" });
  expect((await mapButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const functions = page.getByRole("navigation", { name: "BirdieWorld Funktionen" }).getByRole("button");
  await expect(functions).toHaveCount(3);
  for (const control of await functions.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await mapButton.click();
  const mobileMap = page.getByRole("dialog", { name: "Alles gehört zu einer Welt." });
  const overlayLauncher = page.getByRole("button", { name: "Birdie öffnen" });
  await expect(mobileMap).toBeVisible();
  await expect(overlayLauncher).toBeVisible();
  const mobileMapBox = await mobileMap.boundingBox();
  const overlayLauncherBox = await overlayLauncher.boundingBox();
  expect(mobileMapBox).not.toBeNull();
  expect(overlayLauncherBox).not.toBeNull();
  expect(overlayLauncherBox!.y + overlayLauncherBox!.height).toBeLessThanOrEqual(mobileMapBox!.y);
  expect(await overlayLauncher.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  await mobileMap.getByRole("button", { name: "Karte schließen" }).click();

  const scene = await waitForSceneOutcome(page);
  const touch = scene.locator("[data-estate-touch-controls='drag']");
  if (await touch.isVisible()) {
    await expect(scene).toHaveAttribute("data-estate-camera-mode", "third-person-follow");
    await expect(scene).toHaveAttribute("data-estate-touch-input", "drag-to-move");
    const surface = scene.locator("[data-estate-scene-focus='true']");
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    const startX = surfaceBox!.x + surfaceBox!.width * 0.5;
    const startY = surfaceBox!.y + surfaceBox!.height * 0.58;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 7, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await expect(scene).toHaveAttribute("data-estate-drag-active", "true");
    await expect(touch).toHaveAttribute("data-estate-drag-joystick", "active");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y: startY - 82, id: 7, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await expect(scene.locator("[data-estate-drag-hint]"))
      .toHaveAttribute("data-estate-drag-hint", "dismissed");
    await page.waitForTimeout(350);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX + 24, y: startY - 82, id: 7, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await expect(scene).toHaveAttribute("data-estate-drag-active", "true");
    await page.waitForTimeout(300);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y: startY - 82, id: 7, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await page.waitForTimeout(6_050);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });
    await expect(scene).toHaveAttribute("data-estate-drag-active", "false");
    await expect.poll(() => page.locator("main").getAttribute("data-estate-district")).not.toBe("arrival-court");
    await attachScreenshot(page, testInfo, "mobile-third-person-after-thumb-drag");
    const alternativeToggle = scene.locator(
      ".immersive-estate-scene__touch-alternative > summary"
    );
    await expect(alternativeToggle)
      .toHaveAttribute("aria-label", "Alternative Richtungstasten umschalten");
    const toggleBox = await alternativeToggle.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.width).toBeGreaterThanOrEqual(44);
    expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
    await alternativeToggle.click();
    const alternativePad = scene.locator("[data-estate-touch-controls='directional-alternative']");
    const interactionPrompt = page.locator("button.estate-interaction-prompt");
    await expect(alternativePad).toBeVisible();
    await expect(interactionPrompt).toBeVisible();
    const alternativePadBox = await alternativePad.boundingBox();
    const interactionPromptBox = await interactionPrompt.boundingBox();
    expect(alternativePadBox).not.toBeNull();
    expect(interactionPromptBox).not.toBeNull();
    expect(interactionPromptBox!.x + interactionPromptBox!.width)
      .toBeLessThanOrEqual(alternativePadBox!.x);
    for (const control of await alternativePad.getByRole("button").all()) {
      const controlBox = await control.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(controlBox!.width).toBeGreaterThanOrEqual(44);
      expect(controlBox!.height).toBeGreaterThanOrEqual(44);
      expect(await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
    }
    await alternativeToggle.click();
    await expect(alternativePad).not.toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 8, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y: startY - 28, id: 8, force: 1, radiusX: 4, radiusY: 4 }]
    });
    await expect(scene).toHaveAttribute("data-estate-drag-active", "true");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(scene).toHaveAttribute("data-estate-drag-active", "false");
    expect(await interactionPrompt.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    })).toBe(true);
    await interactionPrompt.click();
    await expect(page.getByRole("dialog", { name: "Willkommen im Birdie Hotel" })).toBeVisible();
    await page.getByRole("button", { name: "Weiter erkunden" }).click();
    console.log("BIRDIE_TOUCH_EVIDENCE=DRAG_TO_MOVE_CHANGED_DISTRICT_THIRD_PERSON_ACTIVE");
  } else {
    await expect(page.locator("[data-estate-fallback]")).toBeVisible();
    testInfo.annotations.push({
      type: "technical-limit",
      description: "Mobile runner exposed no WebGL2; exact 390x844 shell and fallback passed, held 3D touch remains open."
    });
    console.log("BIRDIE_TOUCH_EVIDENCE=FALLBACK_LAYOUT_VERIFIED_3D_TOUCH_OPEN");
  }

  const districtBeforeTyping = await page.locator("main").getAttribute("data-estate-district");
  await page.getByRole("button", { name: /Personal Birdie/ }).click();
  const personalBirdiePanel = page.getByRole("dialog", { name: "Personal Birdie" });
  const personalBirdiePanelBox = await personalBirdiePanel.locator(".estate-feature-panel").boundingBox();
  const featureLauncherBox = await overlayLauncher.boundingBox();
  expect(personalBirdiePanelBox).not.toBeNull();
  expect(featureLauncherBox).not.toBeNull();
  expect(featureLauncherBox!.y + featureLauncherBox!.height).toBeLessThanOrEqual(personalBirdiePanelBox!.y);
  expect(await overlayLauncher.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  const textarea = page.getByLabel("Frag Birdie");
  await textarea.fill("wasd WASD");
  await expect(textarea).toHaveValue("wasd WASD");
  await expect(page.locator("main")).toHaveAttribute("data-estate-district", districtBeforeTyping!);
  await page.getByRole("dialog", { name: "Personal Birdie" }).getByRole("button", { name: "Zurück zu Birdie" }).first().click();
  await expect(page.getByRole("dialog", { name: /Da bist du wieder/ })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "mobile-390x844-immersive-estate");
  await context.close();
});

test("installable PWA gains control and reloads offline with bundled runtime", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("link[rel='manifest']")).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator("link[rel='apple-touch-icon']")).toHaveAttribute("href", "/icons/birdieworld-apple-touch-icon.png");
  await expect(page.locator("meta[name='apple-mobile-web-app-capable']")).toHaveAttribute("content", "yes");
  await expect(page.locator("meta[name='viewport']")).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator("html")).toHaveAttribute("data-mobile-beta", "pwa-v0.1");

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    if (!response.ok) throw new Error(`Manifest failed: ${response.status}`);
    return response.json() as Promise<{ name: string; display: string; start_url: string; icons: Array<{ sizes: string; purpose: string }> }>;
  });
  expect(manifest).toMatchObject({ name: "BirdieWorld Mobile Beta", display: "standalone", start_url: "/" });
  expect(manifest.icons.some((icon) => icon.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);

  await page.waitForFunction(() => document.documentElement.dataset.serviceWorker === "ready");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const runtimeRequests = await page.locator("script[src]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src));
  const appOrigin = new URL(page.url()).origin;
  expect(runtimeRequests.every((url) => new URL(url).origin === appOrigin)).toBe(true);
  const precacheEvidence = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("birdieworld-mobile-beta-"));
    const cache = names.length === 1 ? await caches.open(names[0]) : null;
    const entries = cache ? await cache.keys() : [];
    return {
      names,
      assets: await Promise.all(entries
        .filter((request) => new URL(request.url).pathname.startsWith("/assets/"))
        .map(async (request) => {
          const response = await cache!.match(request);
          return {
            url: request.url,
            bytes: response ? (await response.clone().arrayBuffer()).byteLength : 0
          };
        }))
    };
  });
  expect(precacheEvidence.names).toHaveLength(1);
  expect(precacheEvidence.assets).toHaveLength(3);
  expect(precacheEvidence.assets.every(({ bytes }) => bytes > 0)).toBe(true);
  expect(runtimeRequests.every((url) => precacheEvidence.assets.some((asset) => asset.url === url))).toBe(true);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "BirdieWorld Immersive Estate V0.3.1" })).toBeAttached();
  await expect(page.getByRole("navigation", { name: "BirdieWorld Funktionen" })).toBeVisible();
  await page.context().setOffline(false);
  expect(runtimeErrors).toEqual([]);
});
