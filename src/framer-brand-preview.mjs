const PREVIEW_PATH = "/new-birdie";
const VERSION = "BIRDIE_BRAND_PREVIEW_V2_SHOPIFY_SYNC";

const HERO_IMAGE = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/birdie-and-breakfast-brand-hero-2026.png?v=1790375029";
const SHOP_URL = "https://shop.birdieandbreakfast.de";
const SHOPIFY_DRAFT_HERO = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/birdieworld-hero-lounge-artwear.png?v=1790376372";
const SHOPIFY_ART_TILE = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/birdieworld-art-tile-light-gold.png?v=1790384298";
const SHOPIFY_WEAR_TILE = "https://cdn.shopify.com/s/files/1/1056/9262/7286/files/birdieworld-wear-tile-blue-green.png?v=1790382543";

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

/**
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight auto
 * @framerIntrinsicWidth 1200
 */
export default function BirdieBrandHome() {
  return (
    <main className="bb-root">
      <style>{\`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500&display=swap");
        :root {
          --ink:#0d1b2a;
          --ink-soft:#213547;
          --ivory:#f5f2eb;
          --paper:#fbfaf6;
          --gold:#b99a5d;
          --gold-soft:#d9c69f;
          --emerald:#102e24;
          --emerald-soft:#173d30;
          --line:#d9d4c7;
        }
        *{box-sizing:border-box}
        #birdieworld-framer-bridge{display:none!important;visibility:hidden!important;pointer-events:none!important}
        html{scroll-behavior:smooth}
        body{margin:0;background:var(--paper);color:var(--emerald)}
        .bb-root{width:100%;min-height:100%;background:var(--ivory);color:var(--emerald);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
        .serif{font-family:"Playfair Display",Georgia,"Times New Roman",serif;font-weight:400;letter-spacing:-.035em}
        .announcement{height:34px;display:flex;align-items:center;justify-content:center;background:var(--ink);color:var(--ivory);border-bottom:1px solid var(--gold);font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase}
        .nav{position:relative;z-index:20;display:flex;align-items:center;justify-content:space-between;min-height:72px;padding:0 clamp(28px,4vw,72px);background:var(--ivory);border-bottom:1px solid var(--gold)}
        .wordmark{font-family:"Playfair Display",Georgia,serif;font-size:clamp(28px,2.2vw,36px);letter-spacing:-.035em;font-weight:400;color:var(--emerald);text-decoration:none}
        .navlinks{display:flex;align-items:center;gap:30px}
        .navlinks a{position:relative;font-size:11px;color:var(--emerald);text-decoration:none;letter-spacing:.14em;text-transform:uppercase;font-weight:500}
        .navlinks a:not(.pill):after{content:"";position:absolute;left:50%;bottom:-9px;width:18px;height:1px;background:var(--gold);transform:translateX(-50%) scaleX(0);transition:transform .2s ease}
        .navlinks a:not(.pill):hover:after{transform:translateX(-50%) scaleX(1)}
        .pill{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border:1px solid var(--emerald);border-radius:0;background:transparent;color:var(--emerald)!important;font-weight:600;letter-spacing:.12em!important}
        .hero{min-height:calc(100svh - 106px);position:relative;display:grid;align-items:center;background:var(--ink);overflow:hidden}
        .hero-copy{position:relative;z-index:3;width:min(760px,62vw);display:flex;flex-direction:column;justify-content:center;padding:9vh clamp(28px,6vw,96px)}
        .hero-visual{position:absolute;inset:0;overflow:hidden;background:var(--ink)}
        .hero-art-main{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center}
        .hero-visual:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(13,27,42,.92) 0%,rgba(13,27,42,.7) 36%,rgba(13,27,42,.18) 70%,rgba(13,27,42,.06) 100%),linear-gradient(0deg,rgba(13,27,42,.45),transparent 46%)}
        .hero-hoodie-card,.hero-mark{display:none}
        .hero p{max-width:560px;font-size:clamp(17px,1.35vw,21px);line-height:1.6;color:rgba(245,242,235,.82);margin:0 0 32px}
        .eyebrow{display:flex;align-items:center;gap:12px;color:var(--gold-soft);font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:20px}
        .eyebrow:before{content:"";width:36px;height:1px;background:var(--gold)}
        h1{font-size:clamp(58px,7.4vw,116px);line-height:.88;margin:0 0 28px;max-width:820px}
        .actions{display:flex;gap:12px;flex-wrap:wrap}
        .button{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border:1px solid currentColor;border-radius:0;color:var(--ivory);text-decoration:none;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;transition:.25s ease}
        .button.primary{background:var(--ivory);color:var(--emerald);border-color:var(--ivory)}
        .button:hover{transform:translateY(-2px)}
        .canvas-split{display:grid;grid-template-columns:1fr 1fr;background:var(--ink);gap:2px;padding:2px 0}
        .canvas-card{position:relative;min-height:720px;overflow:hidden;color:var(--ivory);text-decoration:none}
        .canvas-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .8s cubic-bezier(.2,.6,.2,1)}
        .canvas-card:hover img{transform:scale(1.025)}
        .canvas-card:after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(13,27,42,.88),rgba(13,27,42,.08) 58%)}
        .canvas-copy{position:absolute;z-index:2;left:clamp(28px,4vw,58px);right:clamp(28px,4vw,58px);bottom:clamp(34px,5vw,64px)}
        .canvas-copy small{display:block;color:var(--gold-soft);font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px}
        .canvas-copy h2{font-family:"Playfair Display",Georgia,serif;font-size:clamp(58px,7vw,104px);font-weight:400;letter-spacing:-.04em;line-height:.9;margin:0 0 16px}
        .canvas-copy p{font-size:16px;line-height:1.55;margin:0 0 22px;max-width:430px;color:rgba(245,242,235,.86)}
        .text-link{font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--ivory);border-bottom:1px solid var(--gold);padding-bottom:5px}
        .manifesto{display:grid;grid-template-columns:1fr 1.4fr;gap:8vw;padding:130px 5vw;background:var(--ivory);color:var(--emerald);align-items:start}
        .kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:18px}
        .manifesto h2,.section-head h2,.wellbeing h2,.community h2{font-size:clamp(44px,6.2vw,92px);line-height:.95;margin:0}
        .manifesto-copy{padding-top:8px}
        .manifesto-copy p{font-size:clamp(18px,1.65vw,26px);line-height:1.55;margin:0 0 36px;max-width:760px;color:#365448}
        .four-words{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#cfc5b2;border:1px solid #cfc5b2}
        .four-words div{padding:20px;background:var(--paper);font-size:12px;letter-spacing:.14em;text-transform:uppercase}
        .fashion{padding:130px 5vw 150px;background:var(--ink);color:var(--ivory)}
        .section-head{display:flex;justify-content:space-between;gap:40px;align-items:end;margin-bottom:58px}
        .section-head p{max-width:430px;margin:0;color:#52675e;line-height:1.6;font-size:15px}
        .fashion-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:22px}
        .fashion-card{min-height:660px;position:relative;overflow:hidden;background:#e8e1d3}
        .fashion-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .7s cubic-bezier(.2,.6,.2,1)}
        .fashion-card:hover img{transform:scale(1.025)}
        .fashion-card:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(2,8,12,.84))}
        .card-copy{position:absolute;z-index:2;left:32px;right:32px;bottom:30px;display:flex;align-items:end;justify-content:space-between;gap:20px}
        .card-copy h3{font-size:clamp(34px,3.4vw,58px);margin:4px 0 0}
        .card-copy span{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-soft)}
        .art-section{padding:130px 5vw;background:var(--ivory);color:var(--emerald)}
        .art-grid{margin-top:60px;display:grid;grid-template-columns:repeat(12,1fr);grid-auto-rows:110px;gap:18px}
        .art-card{position:relative;overflow:hidden;background:#e8e1d3}
        .art-card:nth-child(1){grid-column:span 7;grid-row:span 5}
        .art-card:nth-child(2){grid-column:span 5;grid-row:span 3}
        .art-card:nth-child(3){grid-column:8/span 5;grid-row:span 3}
        .art-card:nth-child(4){grid-column:span 7;grid-row:span 4}
        .art-card img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0;filter:saturate(.92)}
        .art-card:after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(4,10,14,.78),transparent 52%)}
        .art-meta{position:absolute;z-index:2;left:24px;right:24px;bottom:22px;display:flex;justify-content:space-between;align-items:end;gap:18px}
        .art-meta strong{font-family:"Playfair Display",Georgia,serif;font-size:28px;font-weight:400}
        .art-meta small{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.66);text-align:right}
        .wellbeing{display:grid;grid-template-columns:1fr 1fr;background:var(--paper);color:var(--ink)}
        .wellbeing-copy{padding:12vw 6vw}
        .wellbeing-copy p{font-size:20px;line-height:1.6;color:#3f4441;max-width:580px;margin:30px 0}
        .wellbeing-visual{min-height:760px;background:linear-gradient(140deg,rgba(13,27,42,.15),rgba(13,27,42,.02)),url("${SHOPIFY_DRAFT_HERO}");background-size:cover;background-position:center}
        .origin{padding:140px 5vw;background:var(--ink);display:grid;grid-template-columns:1fr 1fr;gap:10vw;align-items:start}
        .origin .big{font-size:clamp(46px,6vw,86px);line-height:.96;margin:0}
        .origin p{font-size:18px;line-height:1.7;color:rgba(241,236,226,.74);margin:0;max-width:680px}
        .origin-note{margin-top:28px!important;font-size:12px!important;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-soft)!important}
        .community{padding:150px 5vw 130px;background:var(--ivory);color:var(--emerald);text-align:center}
        .community h2{max-width:1050px;margin:0 auto 26px}
        .community p{max-width:660px;margin:0 auto 36px;color:#52675e;line-height:1.65;font-size:18px}
        .footer{background:var(--emerald);color:rgba(241,236,226,.7);padding:70px 5vw 36px}
        .footer-top{display:grid;grid-template-columns:1.3fr .7fr .7fr;gap:50px;padding-bottom:70px}
        .footer-logo{font-family:"Times New Roman",Times,serif;font-size:48px;color:var(--ivory);line-height:.95}
        .footer-col{display:flex;flex-direction:column;gap:12px}
        .footer-col strong{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold-soft);margin-bottom:8px}
        .footer a{color:inherit;text-decoration:none;font-size:13px}
        .footer-bottom{display:flex;justify-content:space-between;gap:20px;border-top:1px solid rgba(255,255,255,.1);padding-top:24px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.42)}
        @media(max-width:900px){
          .announcement{height:32px;font-size:9px}
          .nav{padding:0 18px;min-height:62px}.navlinks a:not(.pill){display:none}.wordmark{font-size:25px}
          .hero{display:grid;min-height:78svh}
          .hero-copy{padding:72px 22px 64px;width:100%}
          .hero-visual{position:absolute;inset:0}
          .canvas-split{grid-template-columns:1fr}.canvas-card{min-height:620px}
          h1{font-size:clamp(52px,16vw,84px)}
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

      <div className="announcement">BirdieWorld — Art for a Brighter World</div>
      <nav className="nav">
        <a className="wordmark" href="#">BirdieWorld</a>
        <div className="navlinks">
          <a href="#art">Art</a>
          <a href="#fashion">Wear</a>
          <a href="#world">World</a>
          <a href="#community">Journal</a>
          <a className="pill" href={SHOP}>Shop</a>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Art for a Brighter World</div>
          <h1 className="serif">One art.<br/>Two canvases.</h1>
          <p>Created for your walls. Designed to be worn. BirdieWorld connects original wall art and wearable editions through one artistic language.</p>
          <div className="actions">
            <a className="button primary" href={SHOP + "/collections/birdieworld-editions-golf-wall-art"}>Explore Art</a>
            <a className="button" href={SHOP + "/collections/bekleidung"}>Explore Wear</a>
          </div>
        </div>
        <div className="hero-visual">
          <img className="hero-art-main" src="${SHOPIFY_DRAFT_HERO}" alt="BirdieWorld lounge with wall art and wearable art" />
        </div>
      </section>

      <section className="canvas-split" aria-label="Art and Wear">
        <a className="canvas-card" id="art" href={SHOP + "/collections/birdieworld-editions-golf-wall-art"}>
          <img src="${SHOPIFY_ART_TILE}" alt="BirdieWorld wall art in a bright luxury interior" />
          <div className="canvas-copy">
            <small>The original canvas</small>
            <h2>Art</h2>
            <p>Exceptional works for modern spaces.</p>
            <span className="text-link">Explore Art →</span>
          </div>
        </a>
        <a className="canvas-card" id="fashion" href={SHOP + "/collections/bekleidung"}>
          <img src="${SHOPIFY_WEAR_TILE}" alt="BirdieWorld wearable art hoodie in a blue green luxury interior" />
          <div className="canvas-copy">
            <small>The second canvas</small>
            <h2>Wear</h2>
            <p>Art you can live in.</p>
            <span className="text-link">Explore Wear →</span>
          </div>
        </a>
      </section>

      <section className="manifesto" id="world">
        <div>
          <div className="kicker">The world behind the work</div>
          <h2 className="serif">One language.<br/>More than a shop.</h2>
        </div>
        <div className="manifesto-copy">
          <p>The shop is where the pieces are bought. This is where the BirdieWorld becomes visible: the artistic idea, the spaces, the editions, the people and the stories connecting both canvases.</p>
          <div className="four-words">
            <div>Art</div><div>Wear</div><div>World</div><div>Community</div>
          </div>
        </div>
      </section>

      <section className="fashion" id="wear-story">
        <div className="section-head">
          <div><div className="kicker">Wearable Art</div><h2 className="serif">The same language.<br/>A moving canvas.</h2></div>
          <p>The artwork does not stop at the frame. Selected motifs become wearable editions — designed as fashion first, connected to the same visual world.</p>
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

      <section className="art-section" id="art-story">
        <div className="section-head">
          <div><div className="kicker">Wall Art</div><h2 className="serif">Created to change<br/>the atmosphere.</h2></div>
          <p>Exceptional works for modern spaces — created to change the atmosphere of a room, not simply fill a wall.</p>
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
          <div className="kicker">The BirdieWorld standard</div>
          <h2 className="serif">Intentional.<br/>Quality first.</h2>
          <p>We create with intention, obsess over the details and build the world around the work with the same care as the work itself.</p>
          <a className="button primary" href={SHOP}>Enter BirdieWorld</a>
        </div>
        <div className="wellbeing-visual" />
      </section>

      <section className="origin">
        <h2 className="serif big">A brighter world<br/>through art.</h2>
        <div>
          <p>BirdieWorld exists to bring more beauty, curiosity and imagination into everyday life. Different canvases. Same belief.</p>
          <p className="origin-note">One art. Two canvases. One world.</p>
        </div>
      </section>

      <section className="community" id="community">
        <div className="kicker">Join our world</div>
        <h2 className="serif">New works.<br/>New perspectives.</h2>
        <p>Discover new editions, stories from the studio and the spaces and people shaping BirdieWorld.</p>
        <div className="actions" style={{justifyContent:"center"}}>
          <a className="button primary" href={SHOP}>Visit the Shop</a>
          <a className="button" style={{borderColor:"rgba(16,46,36,.25)",color:"#102e24"}} href="https://instagram.com/birdieandbreakfast">Follow the World</a>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-top">
          <div className="footer-logo">BirdieWorld</div>
          <div className="footer-col"><strong>Explore</strong><a href="#art">Art</a><a href="#fashion">Wear</a><a href="#world">World</a></div>
          <div className="footer-col"><strong>Shop</strong><a href={SHOP}>Online Shop</a><a href="https://instagram.com/birdieandbreakfast">Instagram</a></div>
        </div>
        <div className="footer-bottom"><span>Birdie & Breakfast · Germany</span><span>BirdieWorld · Art for a Brighter World</span></div>
      </footer>
    </main>
  )
}
`;
}

async function ensureMain(framer) {
  for (const method of ["getActiveBranch", "getBranch", "createBranch", "publish", "createWebPage", "createCodeFile", "addComponentInstance"]) {
    if (typeof framer?.[method] !== "function") {
      throw fail("FRAMER_BRAND_RUNTIME_UNAVAILABLE", `Framer runtime method ${method} is required`, 503);
    }
  }

  const main = await framer.getBranch("main");
  if (!main || typeof main.switch !== "function") {
    throw fail("FRAMER_MAIN_UNAVAILABLE", "Main branch could not be resolved", 503);
  }

  const active = await framer.getActiveBranch();
  if (!active || active.id !== "main") await main.switch();
  return main;
}

async function createPreviewBranch(framer) {
  const branch = await framer.createBranch({
    title: `Birdie Brand Overhaul ${new Date().toISOString().slice(0, 16).replace("T", " ")}`
  });
  const active = await framer.getActiveBranch();
  if (!branch?.id || !active || active.id !== branch.id || active.base === null) {
    throw fail("FRAMER_BRAND_BRANCH_ISOLATION_FAILED", "Could not establish an isolated Framer branch", 503);
  }
  return active;
}

async function resolvePreviewTarget(framer, main) {
  try {
    const branch = await createPreviewBranch(framer);
    return {
      target: branch,
      executionMode: "ISOLATED_BRANCH_PREVIEW",
      branchingAvailable: true
    };
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!/Branching is not available/i.test(message)) throw error;

    const active = await framer.getActiveBranch();
    if (!active || active.id !== "main") await main.switch();

    return {
      target: main,
      executionMode: "DEDICATED_MAIN_PAGE_PREVIEW",
      branchingAvailable: false
    };
  }
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

async function replacePreviewPage(framer, insertURL) {
  const pages = await framer.getNodesWithType("WebPageNode");
  const existing = (pages || []).find((page) => page?.path === PREVIEW_PATH);
  if (existing && typeof existing.remove === "function") await existing.remove();

  let page = await framer.createWebPage(PREVIEW_PATH);
  if (!page?.id) {
    throw fail(
      "FRAMER_BRAND_PAGE_CREATE_FAILED",
      "Could not create a clean /new-birdie preview page",
      503
    );
  }

  if (typeof page.setAttributes === "function") {
    const updatedPage = await page.setAttributes({ draft: false });
    if (updatedPage) page = updatedPage;
  }

  const frames = await page.getNodesWithType("FrameNode");
  const breakpoints = (frames || []).filter((frame) => frame?.isBreakpoint);
  const primary = breakpoints.find((frame) => frame?.isPrimaryBreakpoint)
    || breakpoints[0]
    || frames?.[0]
    || null;

  if (!primary?.id) {
    throw fail(
      "FRAMER_BRAND_BREAKPOINT_MISSING",
      "The clean preview page has no publishable breakpoint frame",
      503
    );
  }

  // A clean page must stay clean. Remove only default placeholder children, then
  // mount the complete brand experience into the page's actual breakpoint.
  const defaultChildren = await primary.getChildren();
  for (const node of defaultChildren || []) {
    if (typeof node.remove === "function") await node.remove();
  }

  if (typeof primary.setAttributes === "function") {
    const updatedPrimary = await primary.setAttributes({
      name: "Desktop",
      height: "fit-content"
    });
    if (updatedPrimary) {
      // Preserve the canonical breakpoint id for parent/readback checks below.
    }
  }

  const childrenAfterReset = await primary.getChildren();
  if ((childrenAfterReset || []).length !== 0) {
    throw fail(
      "FRAMER_CLEAN_PAGE_NOT_EMPTY",
      "The clean preview breakpoint still contains unexpected nodes",
      502
    );
  }

  const instance = await framer.addComponentInstance({
    url: insertURL,
    parentId: primary.id,
    attributes: {
      name: "Birdie Brand Home",
      width: "1fr",
      height: "fit-content"
    }
  });

  if (!instance?.id) {
    throw fail(
      "FRAMER_BRAND_INSTANCE_FAILED",
      "Could not insert BirdieBrandHome into the clean preview breakpoint",
      503
    );
  }

  const parent = typeof instance.getParent === "function"
    ? await instance.getParent()
    : null;
  if (!parent || parent.id !== primary.id) {
    throw fail(
      "FRAMER_BRAND_PARENT_READBACK_FAILED",
      "BirdieBrandHome is not parented to the clean preview breakpoint",
      502
    );
  }

  const allInstances = await page.getNodesWithType("ComponentInstanceNode");
  const brandInstances = (allInstances || []).filter((node) =>
    node?.componentName === "BirdieBrandHome"
  );
  const foreignInstances = (allInstances || []).filter((node) =>
    node?.componentName !== "BirdieBrandHome"
  );

  if (foreignInstances.length !== 0) {
    throw fail(
      "FRAMER_FOREIGN_INSTANCE_STILL_PRESENT",
      "The clean preview page contains an unexpected component instance",
      502
    );
  }

  if (!brandInstances.length) {
    throw fail(
      "FRAMER_BRAND_INSTANCE_READBACK_FAILED",
      "BirdieBrandHome was not found on the clean preview page",
      502
    );
  }

  for (const node of brandInstances) {
    if (typeof node.getRuntimeError === "function") {
      const runtimeError = await node.getRuntimeError();
      if (runtimeError) {
        throw fail(
          "FRAMER_BRAND_RUNTIME_ERROR",
          `BirdieBrandHome runtime error: ${String(runtimeError?.message || runtimeError)}`,
          422
        );
      }
    }
  }

  return {
    page,
    instances: brandInstances.map((node) => ({ id: node.id })),
    breakpointIds: [primary.id]
  };
}

export function getBirdieBrandPreviewPolicy() {
  return {
    version: VERSION,
    path: PREVIEW_PATH,
    mode: "PREVIEW_ONLY_NO_PRODUCTION_DEPLOY",
    preferredIsolation: "FRAMER_BRANCH",
    fallbackIsolation: "DEDICATED_MAIN_PAGE",
    productionDeployed: false,
    productionDeployAllowed: false,
    replacesLiveHome: false,
    heroAsset: SHOPIFY_DRAFT_HERO,
    commerceTarget: SHOP_URL,
    coinShopIncluded: false,
    primaryPillars: ["Art", "Wear", "World", "Community"]
  };
}

export async function buildBirdieBrandPreview() {
  const { projectUrl, apiKey } = requireConfig();
  const { connect } = await import("framer-api");
  const framer = await connect(projectUrl, apiKey);
  let main = null;
  let previewTarget = null;
  let executionMode = null;
  let branchingAvailable = null;
  let result = null;
  let operationError = null;

  try {
    main = await ensureMain(framer);
    const target = await resolvePreviewTarget(framer, main);
    previewTarget = target.target;
    executionMode = target.executionMode;
    branchingAvailable = target.branchingAvailable;

    const content = buildComponentSource();
    const { file, componentExport } = await upsertCodeFile(framer, content);
    const { page, instances, breakpointIds } = await replacePreviewPage(framer, componentExport.insertURL);

    const publishResult = await framer.publish();
    result = {
      ...getBirdieBrandPreviewPolicy(),
      writePerformed: true,
      executionMode,
      branchingAvailable,
      branch: branchIdentity(previewTarget),
      page: {
        id: page.id,
        path: page.path || PREVIEW_PATH,
        breakpointIds
      },
      component: {
        fileId: file.id || null,
        instances
      },
      preview: {
        deployment: publishResult?.deployment || null,
        hostnames: publishResult?.hostnames || null
      }
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (main && typeof main.switch === "function") {
      try {
        await main.switch();
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
