import {
  createRoundModeUxPrototype,
  createSandboxUxFixture
} from "../../src/round-mode/ux-prototype.mjs";

const prototype = createRoundModeUxPrototype(createSandboxUxFixture());
const screenRoot = document.querySelector("#screen");
const navButtons = [...document.querySelectorAll("[data-screen]")];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function actionButton(action, index) {
  const secondary = index > 0 ? " secondary" : "";
  const target = {
    OPEN_SCORECARD: "SCORECARD",
    OPEN_LOST: "LOST_IN_THE_WILD",
    BACK_TO_ROUND: "ROUND_HOME",
    MARK_FOUND_LOCAL: "YOU_FOUND_A_BIRDIE",
    IDENTIFY_BIRDIE: "COLLECTION",
    KEEP_SAFE: "COLLECTION",
    SWITCH_BIRDIE: "COLLECTION"
  }[action.id] || "ROUND_HOME";
  return `<button class="action${secondary}" type="button" data-screen="${target}">${escapeHtml(action.label)}</button>`;
}

function renderRound(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>${escapeHtml(view.title)}</h1>
    <div class="hero-card">
      <div class="metric">${escapeHtml(view.primaryMetric)}</div>
      <p class="muted">${escapeHtml(view.secondaryMetric)}</p>
      <div class="card-title"><span>Ball in play</span><span class="pill">${escapeHtml(view.activeBirdie.objectState)}</span></div>
      <p>${escapeHtml(view.activeBirdie.displayName)}</p>
    </div>
    <div class="actions">${view.actions.map(actionButton).join("")}</div>
    <div class="privacy">${escapeHtml(view.privacyNote)}</div>
  `;
}

function renderScorecard(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>Scorecard</h1>
    <p class="lede">${escapeHtml(view.title)} · ${escapeHtml(view.courseDataMode)}</p>
    <div class="score-summary">
      <div class="metric-card"><strong>${view.totals.strokes}</strong><span>Strokes</span></div>
      <div class="metric-card"><strong>${view.totals.putts}</strong><span>Putts</span></div>
      <div class="metric-card"><strong>${view.totals.penalties}</strong><span>Penalties</span></div>
    </div>
    <div class="holes">${view.holes.map((hole) => `
      <div class="hole-row">
        <div class="hole-number">${hole.holeNumber}</div>
        <div><strong>${escapeHtml(hole.status)}</strong><div class="muted">Putts ${hole.putts ?? "—"} · Penalties ${hole.penalties ?? "—"}</div></div>
        <strong>${hole.strokes ?? "—"}</strong>
      </div>`).join("")}</div>
    <div class="privacy">${escapeHtml(view.note)}</div>
    <div class="actions"><button class="action secondary" type="button" data-screen="ROUND_HOME">Back to round</button></div>
  `;
}

function renderMyGolf(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>${escapeHtml(view.title)}</h1>
    <div class="card-grid">${view.cards.map((card) => `
      <div class="card">
        <div class="card-title"><span>${escapeHtml(card.courseRef)}</span><span class="pill">${escapeHtml(card.status)}</span></div>
        <p class="muted">${escapeHtml(card.progress)}</p>
        <div class="metric">${card.strokes}</div><span class="muted">strokes</span>
      </div>`).join("")}</div>
    <div class="privacy">Platform remains ${escapeHtml(view.platformDecision.toLowerCase())}; this is a framework-neutral sandbox.</div>
  `;
}

function renderCollection(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>${escapeHtml(view.title)}</h1>
    <div class="card-grid">${view.objects.map((object) => `
      <div class="card">
        <div class="card-title"><span>${escapeHtml(object.displayName)}</span><span class="pill">${escapeHtml(object.objectState)}</span></div>
        <p class="muted">${escapeHtml(object.identityLabel)} · identification stays abstract</p>
      </div>`).join("")}</div>
    <div class="privacy">${escapeHtml(view.note)}</div>
    <div class="actions"><button class="action secondary" type="button" data-screen="YOU_FOUND_A_BIRDIE">You found a Birdie</button></div>
  `;
}

function renderLost(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>${escapeHtml(view.title)}</h1>
    <div class="hero-card">
      <span class="pill">${escapeHtml(view.status)}</span>
      <p class="lede">Last seen: ${escapeHtml(view.lastSeen.label)}</p>
      <p class="muted">${escapeHtml(view.lastSeen.visibility)} · ${escapeHtml(view.lastSeen.recordedAt)}</p>
    </div>
    <div class="privacy">${escapeHtml(view.privacyNote)}</div>
    <div class="actions">${view.actions.map(actionButton).join("")}</div>
  `;
}

function renderFound(view) {
  return `
    <p class="eyebrow">${escapeHtml(view.eyebrow)}</p>
    <h1>${escapeHtml(view.title)}</h1>
    <p class="lede">${escapeHtml(view.body)}</p>
    <div class="hero-card">
      <div class="card-title"><span>${escapeHtml(view.object.displayName)}</span><span class="pill">SANDBOX</span></div>
      <p class="muted">Ownership change disabled · Coin effect disabled</p>
    </div>
    <div class="actions">${view.actions.map(actionButton).join("")}</div>
  `;
}

function render() {
  const view = prototype.getView();
  const renderer = {
    ROUND_HOME: renderRound,
    SCORECARD: renderScorecard,
    MY_GOLF: renderMyGolf,
    COLLECTION: renderCollection,
    LOST_IN_THE_WILD: renderLost,
    YOU_FOUND_A_BIRDIE: renderFound
  }[view.screenId];
  screenRoot.innerHTML = renderer(view);

  const nav = prototype.getNavigation();
  navButtons.forEach((button) => {
    const item = nav.bottomNav.find((entry) => entry.id === button.dataset.screen);
    if (item?.active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-screen]");
  if (!target) return;
  prototype.navigate(target.dataset.screen);
  render();
});

render();
