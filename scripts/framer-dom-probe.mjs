import { chromium } from "playwright";

const url = "https://incredible-orchid-383950.framer.app/new-birdie?domprobe=1";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const attrs = {};
      for (const a of el.attributes || []) attrs[a.name] = a.value;
      const chain = [];
      let p = el;
      for (let i = 0; p && i < 8; i++, p = p.parentElement) {
        chain.push({
          tag: p.tagName,
          id: p.id || null,
          className: typeof p.className === "string" ? p.className : null,
          dataFramerName: p.getAttribute?.("data-framer-name") || null,
          dataFramerComponentType: p.getAttribute?.("data-framer-component-type") || null,
          dataFramerComponentId: p.getAttribute?.("data-framer-component-id") || null,
          dataFramerGenerated: p.getAttribute?.("data-framer-generated") || null
        });
      }
      return {
        tag: el.tagName,
        id: el.id || null,
        className: typeof el.className === "string" ? el.className : null,
        attrs,
        text: (el.innerText || "").slice(0, 1000),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: {
          display: style.display,
          position: style.position,
          zIndex: style.zIndex,
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor
        },
        chain,
        outerHTML: el.outerHTML.slice(0, 12000)
      };
    };

    const all = [...document.querySelectorAll("*")];
    const smallestMatches = (needle) => all
      .filter(el => (el.innerText || "").includes(needle))
      .filter(el => ![...el.children].some(c => (c.innerText || "").includes(needle)))
      .slice(0, 10)
      .map(describe);

    const imageSources = [...document.images].map(img => {
      const r = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src,
        alt: img.alt || "",
        rect: { x:r.x,y:r.y,width:r.width,height:r.height },
        chain: describe(img).chain
      };
    });

    return {
      href: location.href,
      title: document.title,
      bodyTextStart: (document.body.innerText || "").slice(0, 5000),
      legacyTextMatches: smallestMatches("Hier beginnt"),
      newTextMatches: smallestMatches("Art to live with"),
      images: imageSources.slice(0, 80),
      bodyHTMLStart: document.body.innerHTML.slice(0, 50000)
    };
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  await browser.close();
}
