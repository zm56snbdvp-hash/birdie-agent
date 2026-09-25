const PREVIEW_PATH = "/new-birdie";
const VERSION = "BIRDIE_BRAND_PREVIEW_V1";

const HERO_IMAGE = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/birdie-and-breakfast-brand-hero-2026.png?v=1790375029";
const SHOP_URL = "https://shop.birdieandbreakfast.de";

const IMAGE_GRAVITY = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/11894da7-9f6d-4b2b-bc44-a566145c7a15.webp?v=1789382142";
const IMAGE_ART_REMIX = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/49941bce-2c10-4ba3-80c4-b914e2b28cd5.webp?v=1788919248";
const IMAGE_WAY_HOME = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/fbb2fbe9-6013-4a2f-a3c0-c384de976f63.webp?v=1788300483";
const IMAGE_GOLDEN = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/c601d370-05c9-4062-b322-f8237e389773.webp?v=1788648324";
const IMAGE_NEST = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/80c85411-faba-4526-92be-9c08c2a7ade0.webp?v=1788303407";
const IMAGE_CANOPY = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/67ce0a98-4a30-4c16-ae46-2bf7d7d8503d.webp?v=1788650101";

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireConfig() {
  const projectUrl = process.env.FRAMER_PROJECT_URL;
  const apiKey = process.env.FRAMER_API_KEY;
  if (!projectUrl || !apiKey) {
    throw fail("FRAMER_NOT_CONFIGURED", "FRAMER_PROJECT_URL and FRAMER_API_KEY are required", 503);
  }
  return { projectUrl, apiKey };
}

function branchIdentity(branch) {
  return {
    id: branch?.id || null,
    title: branch?.title || branch?.name || null,
    url: branch?.url || null,
    baseId: branch?.base?.id || null
  };
}

function buildComponentSource() {
  return `import * as React from "react"

const SHOP = "${SHOP_URL}"
const HERO = "${HERO_IMAGE}"

const art = [
  { title: "The Way Home", image: "${IMAGE_WAY_HOME}", tone: "Cinematic Wall Art" },
  { title: "Golden Sanctuary", image: "${IMAGE_GOLDEN}", tone: "Emerald · Gold · Night" },
  { title: "Morning at The Nest", image: "${IMAGE_NEST}", tone: "Light Collection" },
  { title: "The Living Canopy", image: "${IMAGE_CANOPY}", tone: "Forest Edition" },
]

const fashion = [
  { title: "GRAVITY", image: "${IMAGE_GRAVITY}", tone: "Dark Artwear" },
  { title: "Art Remix", image: "${IMAGE_ART_REMIX}", tone: "Sand · Emerald · Gold" },
]

export default function BirdieBrandHome() {
  return (
    <main className="bb-root">
      <style>{\`
        :root {
          --ink:#071018;
          --ink-soft:#0d1a23;
          --ivory:#f1ece2;
          --paper:#fbf7ef;
          --gold:#c99c58;
          --gold-soft:#e4c998;
          --emerald:#173a32;
          --line:rgba(235,221,195,.24);
        }
        *{box-sizing:border-box}
        html{scroll-behavior:smooth}
        body{margin:0;background:var(--ink);color:var(--ivory)}
        .bb-root{width:100%;min-height:100%;background:var(--ink);color:var(--ivory);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
        .serif{font-family:"Times New Roman",Times,serif;font-weight:400;letter-spacing:-.035em}
        .nav{position:absolute;inset:0 0 auto;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:28px 4.5vw;border-bottom:1px solid rgba(255,255,255,.13)}
        .wordmark{font-size:13px;letter-spacing:.19em;text-transform:uppercase;font-weight:600;color:#fff;text-decoration:none}
        .navlinks{display:flex;align-items:center;gap:28px}
        .navlinks a{font-size:12px;color:rgba(255,255,255,.8);text-decoration:none;letter-spacing:.08em}
        .pill{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:999px;background:var(--ivory);color:var(--ink)!important;font-weight:700;letter-spacing:.04em!important}
        .hero{min-height:100svh;position:relative;display:flex;align-items:flex-end;background:#071018}
        .hero-media{position:absolute;inset:0;background-image:linear-gradient(90deg,rgba(2,8,13,.94) 0%,rgba(2,8,13,.72) 34%,rgba(2,8,13,.2) 70%,rgba(2,8,13,.08) 100%),linear-gradient(0deg,rgba(7,16,24,.65),transparent 42%),url("${HERO}");background-size:cover;background-position:center}
        .hero-copy{position:relative;z-index:2;width:min(760px,86vw);padding:0 4.5vw 8.5vh}
        .eyebrow{display:flex;align-items:center;gap:12px;color:var(--gold-soft);font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:20px}
        .eyebrow:before{content:"";width:36px;height:1px;background:var(--gold)}
        h1{font-size:clamp(58px,8.2vw,132px);line-height:.84;margin:0 0 28px;max-width:920px}
        .hero p{max-width:610px;font-size:clamp(17px,1.45vw,22px);line-height:1.5;color:rgba(241,236,226,.77);margin:0 0 32px}
        .actions{display:flex;gap:12px;flex-wrap:wrap}
        .button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;border:1px solid rgba(255,255,255,.22);border-radius:999px;color:var(--ivory);text-decoration:none;font-size:12px;letter-spacing:.08em;text-transform:uppercase;transition:.25s ease}
        .button.primary{background:var(--ivory);color:var(--ink);border-color:var(--ivory)}
        .button:hover{transform:translateY(-2px)}
        .manifesto{display:grid;grid-template-columns:1fr 1.4fr;gap:8vw;padding:130px 5vw;background:var(--paper);color:var(--ink);align-items:start}
        .kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#775d36;margin-bottom:18px}
        .manifesto h2,.section-head h2,.wellbeing h2,.community h2{font-size:clamp(44px,6.2vw,92px);line-height:.95;margin:0}
        .manifesto-copy{padding-top:8px}
        .manifesto-copy p{font-size:clamp(18px,1.65vw,26px);line-height:1.55;margin:0 0 36px;max-width:760px;color:#2d302f}
        .four-words{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#cfc5b2;border:1px solid #cfc5b2}
        .four-words div{padding:20px;background:var(--paper);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
        .fashion{padding:130px 5vw 150px;background:var(--ink);color:var(--ivory)}
        .section-head{display:flex;justify-content:space-between;gap:40px;align-items:end;margin-bottom:58px}
        .section-head p{max-width:430px;margin:0;color:rgba(241,236,226,.62);line-height:1.6;font-size:15px}
        .fashion-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px}
        .fashion-card{min-height:660px;position:relative;overflow:hidden;background:#101a20}
        .fashion-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .7s cubic-bezier(.2,.6,.2,1)}
        .fashion-card:hover img{transform:scale(1.025)}
        .fashion-card:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(2,8,12,.84))}
        .card-copy{position:absolute;z-index:2;left:32px;right:32px;bottom:30px;display:flex;align-items:end;justify-content:space-between;gap:20px}
        .card-copy h3{font-size:clamp(34px,3.4vw,58px);margin:4px 0 0}
        .card-copy span{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-soft)}
        .art-section{padding:130px 5vw;background:#0b151b;color:var(--ivory)}
        .art-grid{margin-top:60px;display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:110px;gap:18px}
        .art-card{position:relative;overflow:hidden;background:#162027}
        .art-card:nth-child(1){grid-column:span 7;grid-row:span 5}
        .art-card:nth-child(2){grid-column:span 5;grid-row:span 3}
        .art-card:nth-child(3){grid-column:8/span 5;grid-row:span 3}
        .art-card:nth-child(4){grid-column:span 7;grid-row:span 4}
        .art-card img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;filter:saturate(.92)}
        .art-card:after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(4,10,14,.78),transparent 52%)}
        .art-meta{position:absolute;z-index:2;left:24px;right:24px;bottom:22px;display:flex;justify-content:space-between;align-items:end;gap:18px}
        .art-meta strong{font-family:"Times New Roman",Times,serif;font-size:28px;font-weight:400}
        .art-meta small{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.66);text-align:right}
        .wellbeing{display:grid;grid-template-columns:1fr 1fr;background:var(--paper);color:var(--ink)}
        .wellbeing-copy{padding:12vw 6vw}
        .wellbeing-copy p{font-size:20px;line-height:1.6;color:#3f4441;max-width:580px;margin:30px 0}
        .wellbeing-visual{min-height:760px;background:linear-gradient(140deg,rgba(7,16,24,.15),rgba(7,16,24,.02)),url("${IMAGE_NEST}");background-size:cover;background-position:center}
        .origin{padding:140px 5vw;background:var(--emerald);display:grid;grid-template-columns:1fr 1fr;gap:10vw;align-items:start}
        .origin .big{font-size:clamp(46px,6vw,86px);line-height:.96;margin:0}
        .origin p{font-size:18px;line-height:1.7;color:rgba(241,236,226,.74);margin:0;max-width:680px}
        .origin-note{margin-top:28px!important;font-size:12px!important;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-soft)!important}
        .community{padding:150px 5vw 130px;background:var(--ivory);color:var(--ink);text-align:center}
        .community h2{max-width:1050px;margin:0 auto 26px}
        .community p{max-width:660px;margin:0 auto 36px;color:#4a4b46;line-height:1.65;font-size:18px}
        .footer{background:#050b10;color:rgba(241,236,226,.7);padding:70px 5vw 36px}
        .footer-top{display:grid;grid-template-columns:1.3fr .7fr .7fr;gap:50px;padding-bottom:70px}
        .footer-logo{font-family:"Times New Roman",Times,serif;font-size:48px;color:var(--ivory);line-height:.95}
        .footer-col{display:flex;flex-direction:column;gap:12px}
        .footer-col strong{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-soft);margin-bottom:8px}
        .footer a{color:inherit;text-decoration:none;font-size:13px}
        .footer-bottom{display:flex;justify-content:space-between;gap:20px;border-top:1px solid rgba(255,255,255,.1);padding-top:24px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.42)}
        @media(max-width:900px){
          .nav{padding:22px 22px}.navlinks a:not(.pill){display:none}
          .hero-media{background-image:linear-gradient(0deg,rgba(2,8,13,.93) 0%,rgba(2,8,13,.28) 68%),url("${HERO}");background-position:67% center}
          .hero-copy{padding:0 22px 56px;width:100%}
          h1{font-size:clamp(56px,18vw,92px)}
          .manifesto,.origin{grid-template-columns:1fr;padding:90px 22px;gap:42px}
          .fashion,.art-section{padding:90px 22px}
          .section-head{display:block}.section-head p{margin-top:24px}
          .fashion-grid{grid-template-columns:1fr}.fashion-card{min-height:560px}
          .art-grid{display:grid;grid-template-columns:1fr;grid-auto-rows:auto}
          .art-card,.art-card:nth-child(n){grid-column:auto;grid-row:auto;min-height:480px}
          .wellbeing{grid-template-columns:1fr}.wellbeing-copy{padding:90px 22px}.wellbeing-visual{min-height:520px;order:-1}
          .community{padding:100px 22px}
          .footer{padding:60px 22px 30px}.footer-top{grid-template-columns:1fr;gap:36px}
          .footer-bottom{display:block;line-height:1.8}
        }
      \`}</style>

      <nav className="nav">
        <a className="wordmark" href="#">Birdie & Breakfast</a>
        <div className="navlinks">
          <a href="#fashion">Fashion</a>
          <a href="#art">Art</a>
          <a href="#community">Community</a>
          <a className="pill" href={SHOP}>Enter the Shop</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-media" />
        <div className="hero-copy">
          <div className="eyebrow">Birdie & Breakfast · New Era</div>
          <h1 className="serif">Wear the art.<br/>Live the feeling.</h1>
          <p>Birdie & Breakfast wird eine Welt aus Kunst, Fashion und gutem Gefühl. Dieselbe Formsprache an der Wand, auf Stoff und in den Momenten dazwischen.</p>
          <div className="actions">
            <a className="button primary" href={SHOP}>Shop the new world</a>
            <a className="button" href="#art">Discover the art</a>
          </div>
        </div>
      </section>

      <section className="manifesto">
        <div>
          <div className="kicker">The new Birdie & Breakfast</div>
          <h2 className="serif">Not a category.<br/>A feeling.</h2>
        </div>
        <div className="manifesto-copy">
          <p>Wir bauen keine Website um Produkte herum. Wir bauen eine Markenwelt, in der Produkt, Kunst und Atmosphäre dieselbe Sprache sprechen.</p>
          <div className="four-words">
            <div>Art</div><div>Fashion</div><div>Wellbeing</div><div>Community</div>
          </div>
        </div>
      </section>

      <section className="fashion" id="fashion">
        <div className="section-head">
          <div><div className="kicker">01 · Artwear</div><h2 className="serif">Canvas,<br/>in motion.</h2></div>
          <p>Unsere Hoodies sind keine Merchandise-Fläche. Sie sind tragbare Editionen der BirdieWorld-Ästhetik: tief, ruhig, grafisch und unverkennbar.</p>
        </div>
        <div className="fashion-grid">
          {fashion.map((item) => (
            <article className="fashion-card" key={item.title}>
              <img src={item.image} alt={item.title} loading="lazy"/>
              <div className="card-copy"><div><span>{item.tone}</span><h3 className="serif">{item.title}</h3></div></div>
            </article>
          ))}
        </div>
      </section>

      <section className="art-section" id="art">
        <div className="section-head">
          <div><div className="kicker">02 · BirdieWorld Editions</div><h2 className="serif">Rooms with<br/>a pulse.</h2></div>
          <p>Wall Art, das Räume nicht dekoriert, sondern ihre Stimmung verändert. Emerald, Ivory, tiefes Navy und Gold bilden die visuelle DNA.</p>
        </div>
        <div className="art-grid">
          {art.map((item) => (
            <article className="art-card" key={item.title}>
              <img src={item.image} alt={item.title} loading="lazy"/>
              <div className="art-meta"><strong>{item.title}</strong><small>{item.tone}</small></div>
            </article>
          ))}
        </div>
      </section>

      <section className="wellbeing">
        <div className="wellbeing-copy">
          <div className="kicker">03 · Wellbeing</div>
          <h2 className="serif">Make room<br/>for good.</h2>
          <p>Wohlgefühl ist kein zusätzlicher Produktbereich. Es ist der Filter für alles, was wir machen: Dinge, die man gern ansieht, gern trägt und gern um sich hat.</p>
          <a className="button primary" href={SHOP}>Explore Birdie & Breakfast</a>
        </div>
        <div className="wellbeing-visual" />
      </section>

      <section className="origin">
        <h2 className="serif big">Born from play.<br/>Growing into culture.</h2>
        <div>
          <p>Golf war der Ausgangspunkt — nicht die Grenze. Das Gefühl von Ruhe, Fokus, Freunden, Natur und einem richtig guten Tag bleibt in unserer DNA. Heute übersetzen wir es in Kunst, Kleidung und Community.</p>
          <p className="origin-note">The origin stays. The category gets bigger.</p>
        </div>
      </section>

      <section className="community" id="community">
        <div className="kicker">04 · Community</div>
        <h2 className="serif">Come for the piece.<br/>Stay for the world.</h2>
        <p>Birdie & Breakfast soll nicht nur gekauft werden. Es soll geteilt, getragen, aufgehängt und weitererzählt werden. Genau darum wird die Website größer als der Shop.</p>
        <div className="actions" style={{justifyContent:"center"}}>
          <a className="button primary" href={SHOP}>Enter the Shop</a>
          <a className="button" style={{borderColor:"rgba(7,16,24,.2)",color:"#071018"}} href="https://instagram.com/birdieandbreakfast">Join on Instagram</a>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-top">
          <div className="footer-logo">Birdie<br/>& Breakfast</div>
          <div className="footer-col"><strong>Explore</strong><a href="#fashion">Fashion</a><a href="#art">Wall Art</a><a href="#community">Community</a></div>
          <div className="footer-col"><strong>Shop</strong><a href={SHOP}>Online Shop</a><a href="https://instagram.com/birdieandbreakfast">Instagram</a></div>
        </div>
        <div className="footer-bottom"><span>Birdie & Breakfast · Germany</span><span>Art · Fashion · Wellbeing · Community</span></div>
      </footer>
    </main>
  )
}
`;
}

function isBranchingUnavailable(error) {
  return /branching is not available/i.test(String(error?.message || error || ""));
}

function assertBaseRuntime(framer) {
  for (const method of ["createWebPage", "createCodeFile", "addComponentInstance", "getNodesWithType"]) {
    if (typeof framer?.[method] !== "function") {
      throw fail("FRAMER_BRAND_RUNTIME_UNAVAILABLE", `Framer runtime method ${method} is required`, 503);
    }
  }
}

async function establishPreviewExecution(framer) {
  assertBaseRuntime(framer);

  const branchMethodsAvailable = ["getActiveBranch", "getBranch", "createBranch", "publish"]
    .every((method) => typeof framer?.[method] === "function");

  if (!branchMethodsAvailable) {
    return { mode: "MAIN_DRAFT_ONLY", main: null, branch: null };
  }

  let main = null;
  try {
    main = await framer.getBranch("main");
  } catch (error) {
    if (isBranchingUnavailable(error)) {
      return { mode: "MAIN_DRAFT_ONLY", main: null, branch: null };
    }
    throw error;
  }

  // Framer documents getBranch("main") returning null when branching is unavailable.
  if (!main || typeof main.switch !== "function") {
    return { mode: "MAIN_DRAFT_ONLY", main: null, branch: null };
  }

  const active = await framer.getActiveBranch();
  if (!active || active.id !== main.id) await main.switch();

  let branch = null;
  try {
    branch = await framer.createBranch({
      title: `Birdie Brand Overhaul ${new Date().toISOString().slice(0, 16).replace("T", " ")}`
    });
  } catch (error) {
    if (isBranchingUnavailable(error)) {
      return { mode: "MAIN_DRAFT_ONLY", main: null, branch: null };
    }
    throw error;
  }

  const activeAfterCreate = await framer.getActiveBranch();
  if (
    !branch?.id ||
    !activeAfterCreate ||
    activeAfterCreate.id !== branch.id ||
    !activeAfterCreate.baseId
  ) {
    throw fail(
      "FRAMER_BRAND_BRANCH_ISOLATION_FAILED",
      "Could not establish a verifiably isolated Framer branch",
      503
    );
  }

  return {
    mode: "ISOLATED_BRANCH_PREVIEW_ONLY",
    main,
    branch: activeAfterCreate
  };
}

async function upsertCodeFile(framer, content) {
  const files = typeof framer.getCodeFiles === "function" ? await framer.getCodeFiles() : [];
  let file = (files || []).find((candidate) =>
    candidate?.name === "BirdieBrandHome.tsx" || candidate?.path?.endsWith("/BirdieBrandHome.tsx")
  );

  if (file) {
    if (typeof file.setFileContent !== "function") {
      throw fail("FRAMER_CODE_FILE_WRITE_UNAVAILABLE", "Existing BirdieBrandHome code file is not editable", 503);
    }
    file = await file.setFileContent(content);
  } else {
    file = await framer.createCodeFile("BirdieBrandHome.tsx", content);
  }

  if (typeof file?.typecheck === "function") {
    const diagnostics = await file.typecheck();
    const blocking = Array.isArray(diagnostics)
      ? diagnostics.filter((item) => String(item?.severity || item?.category || "").toLowerCase().includes("error"))
      : [];
    if (blocking.length) {
      throw fail("FRAMER_CODE_TYPECHECK_FAILED", `BirdieBrandHome typecheck returned ${blocking.length} blocking diagnostics`, 422);
    }
  }

  const componentExport = (file?.exports || []).find((item) => item?.type === "component" && item?.insertURL)
    || (file?.exports || []).find((item) => item?.insertURL);
  if (!componentExport?.insertURL) {
    throw fail("FRAMER_COMPONENT_EXPORT_UNAVAILABLE", "BirdieBrandHome did not expose an insertable component URL", 503);
  }

  return { file, componentExport };
}

async function replacePreviewPage(framer, insertURL, { draft }) {
  const pages = await framer.getNodesWithType("WebPageNode");
  const existing = (pages || []).find((page) => page?.path === PREVIEW_PATH);

  if (existing) {
    if (draft) {
      if (typeof existing.setAttributes !== "function") {
        throw fail(
          "FRAMER_DRAFT_PAGE_UNAVAILABLE",
          "Framer cannot mark the existing preview page as draft; refusing a main-project preview write",
          503
        );
      }
      await existing.setAttributes({ draft: true });
    }
    if (typeof existing.remove === "function") await existing.remove();
  }

  let page = await framer.createWebPage(PREVIEW_PATH);
  if (typeof page?.setAttributes !== "function") {
    throw fail(
      "FRAMER_DRAFT_ATTRIBUTE_UNAVAILABLE",
      "Framer WebPageNode draft attributes are required for the safe preview workflow",
      503
    );
  }

  const updatedPage = await page.setAttributes({ draft });
  if (updatedPage) page = updatedPage;

  if (draft) {
    const readbackPages = await framer.getNodesWithType("WebPageNode");
    const readback = (readbackPages || []).find((candidate) => candidate?.path === PREVIEW_PATH);
    if (!readback || readback.draft !== true) {
      throw fail(
        "FRAMER_DRAFT_READBACK_FAILED",
        "Preview page was not confirmed as draft; refusing to continue",
        502
      );
    }
    page = readback;
  }

  const instance = await framer.addComponentInstance({
    url: insertURL,
    parentId: page.id,
    attributes: {
      name: "Birdie Brand Home",
      width: "100%",
      height: "6200px"
    }
  });

  if (!instance?.id) {
    throw fail("FRAMER_BRAND_INSTANCE_FAILED", "Could not insert BirdieBrandHome onto the preview page", 503);
  }

  return { page, instance };
}

export function getBirdieBrandPreviewPolicy() {
  return {
    version: VERSION,
    path: PREVIEW_PATH,
    mode: "SAFE_PREVIEW_WITH_DRAFT_FALLBACK",
    supportedModes: ["ISOLATED_BRANCH_PREVIEW_ONLY", "MAIN_DRAFT_ONLY"],
    productionDeployed: false,
    productionDeployAllowed: false,
    publishOnMainAllowed: false,
    replacesLiveHome: false,
    heroAsset: HERO_IMAGE,
    commerceTarget: SHOP_URL,
    coinShopIncluded: false,
    primaryPillars: ["Art", "Fashion", "Wellbeing", "Community"]
  };
}

export async function buildBirdieBrandPreview() {
  const { projectUrl, apiKey } = requireConfig();
  const { connect } = await import("framer-api");
  const framer = await connect(projectUrl, apiKey);
  let execution = null;
  let result = null;
  let operationError = null;

  try {
    execution = await establishPreviewExecution(framer);
    const draftOnly = execution.mode === "MAIN_DRAFT_ONLY";

    const content = buildComponentSource();
    const { file, componentExport } = await upsertCodeFile(framer, content);
    const { page, instance } = await replacePreviewPage(
      framer,
      componentExport.insertURL,
      { draft: draftOnly }
    );

    let preview = {
      deployment: null,
      hostnames: null,
      published: false,
      editorOnly: draftOnly
    };

    if (execution.mode === "ISOLATED_BRANCH_PREVIEW_ONLY") {
      const active = await framer.getActiveBranch();
      if (
        !active ||
        active.id !== execution.branch?.id ||
        !active.baseId
      ) {
        throw fail(
          "FRAMER_BRAND_PREVIEW_BRANCH_GUARD",
          "Refusing publish because the active branch is not the isolated brand-preview branch",
          409
        );
      }

      const publishResult = await framer.publish();
      preview = {
        deployment: publishResult?.deployment || null,
        hostnames: publishResult?.hostnames || null,
        published: true,
        editorOnly: false
      };
    }

    result = {
      ...getBirdieBrandPreviewPolicy(),
      mode: execution.mode,
      writePerformed: true,
      branch: branchIdentity(execution.branch),
      page: {
        id: page.id,
        path: page.path || PREVIEW_PATH,
        draft: draftOnly
      },
      component: { fileId: file.id || null, instanceId: instance.id },
      preview
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (
      execution?.mode === "ISOLATED_BRANCH_PREVIEW_ONLY" &&
      execution?.main &&
      typeof execution.main.switch === "function"
    ) {
      try {
        await execution.main.switch();
      } catch (restoreError) {
        if (!operationError) {
          operationError = fail(
            "FRAMER_MAIN_RESTORE_FAILED",
            `Preview was built but switching back to main failed: ${String(restoreError?.message || restoreError)}`,
            502
          );
        }
      }
    }
    try { await framer.disconnect(); } catch { /* best effort */ }
  }

  if (operationError) throw operationError;
  return result;
}
