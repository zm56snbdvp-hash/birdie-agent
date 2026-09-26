import { chromium } from "playwright";

const urls = {
  preview: "https://incredible-orchid-383950-b4b003036.framer.app/new-birdie",
  home: "https://incredible-orchid-383950-b4b003036.framer.app/"
};

const browser = await chromium.launch({ headless: true });
const report = {};
try {
  for (const [name, url] of Object.entries(urls)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("console", msg => {
      if (msg.type() === "error") errors.push("console: " + msg.text());
    });
    page.on("pageerror", err => errors.push("pageerror: " + err.message));

    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator("body").innerText();
    const title = await page.title();
    const h1 = await page.locator("h1").allTextContents().catch(() => []);
    const html = await page.locator("body").innerHTML();

    await page.screenshot({
      path: process.env.RUNNER_TEMP + "/" + name + ".png",
      fullPage: true
    });

    report[name] = {
      requestedUrl: url,
      finalUrl: page.url(),
      status: response?.status() || null,
      title,
      h1,
      textStart: bodyText.slice(0, 3000),
      hasWearTheArt: bodyText.includes("Wear the art"),
      hasBirdieWorldEditions: bodyText.includes("BirdieWorld Editions"),
      hasOldNocturnalMarker: bodyText.includes("Nocturnal") || html.includes("BirdieNocturnalSite"),
      errors: errors.slice(0, 20)
    };
    await page.close();
  }
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
