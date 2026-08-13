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
  return errors;
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}

async function openGuide(page: Page) {
  const dialog = page.getByRole("dialog", { name: /Schön, dass du da bist/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zeig mir die Welt" })).toBeFocused();
  await dialog.getByRole("button", { name: "Zeig mir die Welt" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-host-stage", "oriented");
  return page.getByRole("dialog");
}

test("desktop completes the bounded host journey through all three destinations", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");

  await expect(page).toHaveTitle("BirdieWorld – Living Arrival V0.2");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { level: 1, name: "Du bist da. Birdie auch." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Deine Ankunft in der BirdieWorld" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-living-arrival", "birdie-as-host-v0.2");
  await expect(page.locator("main")).toHaveAttribute("data-host-stage", "welcomed");
  await expect(page.locator("[data-birdie-destination]")).toHaveCount(0);

  let dialog = await openGuide(page);
  await expect(dialog.locator("[data-birdie-destination]")).toHaveCount(3);

  for (const destination of DESTINATIONS) {
    await dialog.getByRole("button", { name: new RegExp(destination.name) }).click();
    const target = page.locator(`#${destination.id}`);
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute("aria-current", "location");
    await expect(page.locator("main")).toHaveAttribute("data-host-stage", "invited");

    const returnButton = target.getByRole("button", { name: "Zurück zu Birdie" });
    await expect(returnButton).toBeVisible();
    await returnButton.click();
    dialog = page.getByRole("dialog", { name: /Da bist du wieder/ });
    await expect(dialog).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("data-host-stage", "return-to-birdie");
    await expect(page.locator("[aria-current='location']")).toHaveCount(0);
    await expect(page.locator(".world-heartbeat")).not.toContainText("ist offen");
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
  await attachScreenshot(page, testInfo, "desktop-host-journey");
});

test("WebGL preflight produces a clean spatial fallback", async ({ page }, testInfo) => {
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

  const fallback = page.locator("[data-webgl-fallback='spatial-v0.2']");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("Das Hotel ist da. Birdie auch.");
  for (const landmark of [
    ".fallback-hotel",
    ".fallback-path",
    ".fallback-green",
    ".fallback-terrace",
    ".fallback-birdie"
  ]) await expect(fallback.locator(landmark)).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".touch-controls")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "desktop-spatial-fallback");
});

test("desktop records the real WebGL outcome without inventing availability", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await page.waitForTimeout(1_000);

  const canvas = page.locator(".three-mount canvas");
  if (await canvas.count()) {
    await expect(canvas).toBeVisible();
    await expect(page.locator("[data-webgl-fallback='spatial-v0.2']")).toHaveCount(0);
    console.log("BIRDIE_WEBGL_EVIDENCE=3D_CANVAS_RENDERED");
  } else {
    await expect(page.locator("[data-webgl-fallback='spatial-v0.2']")).toBeVisible();
    testInfo.annotations.push({
      type: "technical-limit",
      description: "GitHub runner exposed no WebGL2 context; spatial fallback verified, real 3D remains open."
    });
    console.log("BIRDIE_WEBGL_EVIDENCE=UNAVAILABLE_FALLBACK_VERIFIED");
  }
  expect(runtimeErrors).toEqual([]);
});

test("390 x 844 touch layout remains bounded and does not hijack typing", async ({ browser }, testInfo) => {
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

  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 390,
    height: 844
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

  const dialog = page.getByRole("dialog", { name: /Schön, dass du da bist/ });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844);

  await expect(page.locator(".birdie-companion__bird")).toBeVisible();
  for (const control of [
    dialog.getByRole("button", { name: "Birdie minimieren" }),
    dialog.getByRole("button", { name: "Zeig mir die Welt" })
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await dialog.getByRole("button", { name: "Zeig mir die Welt" }).click();
  const guide = page.getByRole("dialog");
  await guide.getByRole("button", { name: /Personal Birdie/ }).click();

  const textarea = page.getByLabel("Frag Birdie");
  await textarea.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("wasd WASD");
  await expect(textarea).toHaveValue("wasd WASD");

  const markers = page.locator(".world-hotspot");
  await expect(markers).toHaveCount(3);
  for (const marker of await markers.all()) {
    const box = await marker.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }

  const touchControls = page.locator(".touch-controls");
  if (await touchControls.isVisible()) {
    const forward = touchControls.getByRole("button", { name: "Vorwärts gehen" });
    const box = await forward.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await forward.tap();
    console.log("BIRDIE_TOUCH_EVIDENCE=WEBGL_CONTROL_TAPPED");
  } else {
    await expect(page.locator("[data-webgl-fallback='spatial-v0.2']")).toBeVisible();
    testInfo.annotations.push({
      type: "technical-limit",
      description: "Mobile CI exposed no WebGL2 context; exact touch layout and typing passed, 3D touch movement remains open."
    });
    console.log("BIRDIE_TOUCH_EVIDENCE=FALLBACK_LAYOUT_VERIFIED_3D_TOUCH_OPEN");
  }

  expect(runtimeErrors).toEqual([]);
  await attachScreenshot(page, testInfo, "mobile-390x844");
  await context.close();
});
