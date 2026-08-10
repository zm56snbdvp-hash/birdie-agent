const elements = {
  loginView: document.querySelector("#login-view"),
  appView: document.querySelector("#app-view"),
  emailStep: document.querySelector("#email-step"),
  codeStep: document.querySelector("#code-step"),
  emailForm: document.querySelector("#email-form"),
  codeForm: document.querySelector("#code-form"),
  authStatus: document.querySelector("#auth-status"),
  claimForm: document.querySelector("#claim-form"),
  claimStatus: document.querySelector("#claim-status"),
  toast: document.querySelector("#toast")
};

const state = {
  challengeId: sessionStorage.getItem("birdieLoginChallenge") || "",
  email: sessionStorage.getItem("birdieLoginEmail") || "",
  data: null,
  csrfToken: "",
  toastTimer: null
};

const actionLabels = {
  PROFILE_REGISTERED: "Birdie ID registriert",
  INSTAGRAM_VERIFIED: "Instagram-Profil verifiziert",
  COMMUNITY_CONTRIBUTION: "Community-Beitrag",
  STORY_SHARE_TAGGED: "Story geteilt und markiert",
  UGC_APPROVED: "Community Content erstellt",
  PRODUCT_REVIEW_VERIFIED: "Produktbewertung",
  REFERRAL_VERIFIED: "Neuen Birdie empfohlen",
  STARTER_KIT_PURCHASE: "Starter Kit gekauft",
  BOOSTER_ORDER_PURCHASE: "Booster bestellt",
  COMMUNITY_HELP: "Besondere Community-Hilfe",
  B2B_PROFILE_VERIFIED: "B2B-Profil verifiziert",
  B2B_FEED_OR_REEL: "B2B Feed-Post oder Reel",
  B2B_REFERRAL_VERIFIED: "B2B-Empfehlung",
  B2B_COMMUNITY_ACTION: "B2B-Community-Aktion",
  B2B_PRODUCT_OR_EVENT_SUPPORT: "Produkt- oder Event-Support",
  MIGRATION_OPENING_BALANCE: "Founding Supporter Startstand",
  REWARD_REDEMPTION: "Reward reserviert",
  REWARD_REDEMPTION_CANCELLED: "Reward zurückgebucht"
};

function friendlyError(payload, fallback = "Das hat gerade nicht geklappt. Bitte versuche es erneut.") {
  if (payload?.error === "INVALID_SESSION") return "Deine Sitzung ist abgelaufen. Bitte melde dich neu an.";
  if (payload?.error === "INVALID_LOGIN_CODE") return "Der Code ist falsch oder abgelaufen.";
  if (payload?.error === "INSUFFICIENT_BIRDIES") return "Für diesen Reward fehlen dir noch Birdies.";
  if (payload?.error === "DUPLICATE_CLAIM_SOURCE") return "Diese Aktion wurde bereits eingereicht.";
  if (payload?.error === "LOGIN_RATE_LIMITED") return "Bitte warte kurz, bevor du einen neuen Code anforderst.";
  return payload?.message && !String(payload.message).includes("Birdie OS")
    ? payload.message
    : fallback;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const needsCsrf = method !== "GET" &&
    method !== "HEAD" &&
    !path.includes("/auth/request-code") &&
    !path.includes("/auth/verify-code");
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(needsCsrf && state.csrfToken ? { "X-Birdie-CSRF": state.csrfToken } : {}),
      ...options.headers
    }
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // The status still drives the generic error below.
  }
  if (!response.ok || payload.success === false) {
    const error = new Error(friendlyError(payload));
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload.data;
}

function setStatus(node, message = "", isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function setBusy(form, busy) {
  for (const control of form.elements) control.disabled = busy;
}

function toast(message, isError = false) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function showLogin({ preserveChallenge = true } = {}) {
  state.data = null;
  state.csrfToken = "";
  elements.appView.hidden = true;
  elements.loginView.hidden = false;
  if (!preserveChallenge) {
    state.challengeId = "";
    state.email = "";
    sessionStorage.removeItem("birdieLoginChallenge");
    sessionStorage.removeItem("birdieLoginEmail");
  }
  const hasChallenge = preserveChallenge && Boolean(state.challengeId);
  elements.emailStep.hidden = hasChallenge;
  elements.codeStep.hidden = !hasChallenge;
  if (hasChallenge) {
    document.querySelector("#code-help").textContent = state.email
      ? `Wir haben den Code für ${state.email} angefordert. Er ist 10 Minuten gültig.`
      : "Dein Code ist 10 Minuten gültig.";
    document.querySelector("#code").focus();
  }
}

function showApp() {
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  sessionStorage.removeItem("birdieLoginChallenge");
  sessionStorage.removeItem("birdieLoginEmail");
  state.challengeId = "";
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function renderLevel(profile, levels) {
  const balances = profile.balances || {};
  const lifetime = Number(balances.lifetime || 0);
  const ordered = [...(levels || [])].sort((a, b) => Number(a.minimum) - Number(b.minimum));
  const currentIndex = Math.max(0, ordered.findLastIndex((level) => lifetime >= Number(level.minimum)));
  const current = ordered[currentIndex] || balances.level || { name: "Tee Starter", minimum: 0 };
  const next = ordered[currentIndex + 1];
  const start = Number(current.minimum || 0);
  const end = Number(next?.minimum || Math.max(lifetime, 1));
  const progress = next ? Math.max(0, Math.min(100, ((lifetime - start) / (end - start)) * 100)) : 100;

  document.querySelector("#level-name").textContent = balances.level?.name || current.name;
  document.querySelector("#lifetime-label").textContent = `${lifetime} Lifetime Birdies`;
  document.querySelector("#next-level-label").textContent = next
    ? `${Math.max(0, end - lifetime)} bis ${next.name}`
    : "Höchstes Level erreicht";
  document.querySelector("#level-progress").style.width = `${progress}%`;
}

function renderBadges(badges = []) {
  const list = document.querySelector("#badge-list");
  document.querySelector("#badge-count").textContent = String(badges.length);
  list.replaceChildren();
  list.classList.toggle("empty-state", badges.length === 0);
  if (!badges.length) {
    list.textContent = "Noch kein Badge – dein erstes wartet schon.";
    return;
  }
  for (const badge of badges) {
    const item = node("div", "badge-item");
    item.append(node("span", "badge-icon", "B"));
    const copy = node("div");
    copy.append(node("strong", "", badge.badgeName || badge.badgeCode));
    copy.append(node("small", "", formatDate(badge.awardedAt)));
    item.append(copy);
    list.append(item);
  }
}

function renderLedger(ledger = {}) {
  const list = document.querySelector("#ledger-list");
  const transactions = [...(ledger.transactions || [])]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 8);
  list.replaceChildren();
  list.classList.toggle("empty-state", transactions.length === 0);
  if (!transactions.length) {
    list.textContent = "Noch keine Bewegungen vorhanden.";
    return;
  }
  for (const transaction of transactions) {
    const amount = Number(transaction.amount || 0);
    const item = node("div", "ledger-item");
    const copy = node("div");
    copy.append(node("strong", "", actionLabels[transaction.actionCode] || transaction.note || "Birdie Bewegung"));
    copy.append(node("small", "", `${formatDate(transaction.createdAt)} · ${transaction.status || ""}`));
    const value = node(
      "span",
      `ledger-amount ${amount >= 0 ? "is-positive" : "is-negative"}`,
      `${amount > 0 ? "+" : ""}${amount}`
    );
    item.append(copy, value);
    list.append(item);
  }
}

function actionValueLabel(definition) {
  if (definition.points) return `${definition.points} ${definition.points === 1 ? "Birdie" : "Birdies"}`;
  return `${definition.minPoints}–${definition.maxPoints} Birdies nach Prüfung`;
}

function renderActions(config, accountType) {
  const select = document.querySelector("#action-code");
  select.replaceChildren();
  const placeholder = node("option", "", "Aktion auswählen");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.append(placeholder);
  for (const [code, definition] of Object.entries(config.actions || {})) {
    if (code === "PROFILE_REGISTERED" || !(definition.accountTypes || []).includes(accountType)) continue;
    const option = node("option", "", `${actionLabels[code] || code} · ${actionValueLabel(definition)}`);
    option.value = code;
    select.append(option);
  }
}

function renderRewards(rewards = [], available = 0) {
  const list = document.querySelector("#reward-list");
  list.replaceChildren();
  list.classList.toggle("empty-state", rewards.length === 0);
  if (!rewards.length) {
    list.textContent = "Für deinen Account-Typ sind noch keine Rewards aktiv.";
    return;
  }
  for (const reward of rewards) {
    const card = node("article", "reward-card");
    card.append(node("span", "reward-type", reward.fulfillmentType === "DIGITAL" ? "DIGITAL" : "BIRDIE TEAM"));
    card.append(node("h3", "", reward.name));
    card.append(node("p", "reward-price", `${reward.price} Birdies`));
    const button = node("button", "button button-primary", available >= Number(reward.price) ? "Reward reservieren" : "Noch nicht genug Birdies");
    button.type = "button";
    button.disabled = available < Number(reward.price);
    button.addEventListener("click", () => redeemReward(reward, button));
    card.append(button);
    list.append(card);
  }
}

function renderDashboard(data) {
  state.data = data;
  state.csrfToken = data.csrfToken || "";
  const profile = data.profile;
  const balances = profile.balances || data.ledger?.balances || {};
  document.querySelector("#display-name").textContent = profile.displayName || "Birdie";
  document.querySelector("#birdie-id").textContent = profile.birdieId || "—";
  document.querySelector("#available-balance").textContent = String(balances.available || 0);
  document.querySelector("#reserved-balance").textContent = Number(balances.reserved || 0) > 0
    ? `${balances.reserved} Birdies sind für Rewards reserviert.`
    : "Alle verfügbaren Birdies sind frei einsetzbar.";
  renderLevel(profile, data.config?.levels);
  renderBadges(profile.badges || []);
  renderLedger(data.ledger);
  renderActions(data.config || {}, profile.accountType);
  renderRewards(data.rewards || [], Number(balances.available || 0));
  showApp();
}

async function loadDashboard({ quiet = false } = {}) {
  try {
    const data = await api("/supporter/api/bootstrap");
    renderDashboard(data);
    if (!quiet) toast("Birdie ID ist aktuell.");
  } catch (error) {
    if (error.status === 401) {
      showLogin({ preserveChallenge: true });
      return;
    }
    showLogin({ preserveChallenge: true });
    setStatus(elements.authStatus, error.message, true);
  }
}

async function redeemReward(reward, button) {
  if (!window.confirm(`${reward.name} für ${reward.price} Birdies reservieren?`)) return;
  button.disabled = true;
  try {
    await api("/supporter/api/redemptions", {
      method: "POST",
      body: JSON.stringify({
        rewardId: reward.rewardId,
        idempotencyKey: `redemption:${crypto.randomUUID()}`
      })
    });
    toast("Reward reserviert. Das Birdie-Team übernimmt jetzt.");
    await loadDashboard({ quiet: true });
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

elements.emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(elements.authStatus);
  setBusy(elements.emailForm, true);
  const email = new FormData(elements.emailForm).get("email");
  try {
    const response = await api("/supporter/api/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    state.challengeId = response.challengeId;
    state.email = String(email).trim();
    sessionStorage.setItem("birdieLoginChallenge", state.challengeId);
    sessionStorage.setItem("birdieLoginEmail", state.email);
    showLogin({ preserveChallenge: true });
    setStatus(elements.authStatus, response.message);
  } catch (error) {
    setStatus(elements.authStatus, error.message, true);
  } finally {
    setBusy(elements.emailForm, false);
  }
});

elements.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(elements.authStatus);
  setBusy(elements.codeForm, true);
  const code = new FormData(elements.codeForm).get("code");
  try {
    await api("/supporter/api/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ challengeId: state.challengeId, code })
    });
    await loadDashboard({ quiet: true });
    toast("Willkommen im Flock.");
  } catch (error) {
    setStatus(elements.authStatus, error.message, true);
  } finally {
    setBusy(elements.codeForm, false);
  }
});

document.querySelector("#back-to-email").addEventListener("click", () => {
  showLogin({ preserveChallenge: false });
  setStatus(elements.authStatus);
  document.querySelector("#email").focus();
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/supporter/api/auth/logout", { method: "POST" });
  } catch {
    // The local cookie is cleared by the response whenever the route is reachable.
  }
  showLogin({ preserveChallenge: false });
  toast("Du bist sicher abgemeldet.");
});

document.querySelector("#refresh-button").addEventListener("click", () => loadDashboard());

elements.claimForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(elements.claimStatus);
  setBusy(elements.claimForm, true);
  const form = new FormData(elements.claimForm);
  try {
    await api("/supporter/api/claims", {
      method: "POST",
      body: JSON.stringify({
        actionCode: form.get("actionCode"),
        sourceType: form.get("sourceType"),
        sourceReference: form.get("sourceReference"),
        evidenceUrl: form.get("evidenceUrl") || undefined,
        note: form.get("note") || undefined,
        idempotencyKey: `claim:${crypto.randomUUID()}`
      })
    });
    elements.claimForm.reset();
    setStatus(elements.claimStatus, "Eingereicht – wir prüfen deine Aktion.");
    toast("Deine Aktion liegt jetzt in der Birdie-Queue.");
  } catch (error) {
    setStatus(elements.claimStatus, error.message, true);
  } finally {
    setBusy(elements.claimForm, false);
  }
});

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const candidate of document.querySelectorAll(".tab")) {
      candidate.classList.toggle("is-active", candidate === tab);
    }
    for (const section of document.querySelectorAll(".dashboard-section")) {
      section.hidden = section.id !== `${tab.dataset.section}-section`;
    }
  });
}

if (state.email) document.querySelector("#email").value = state.email;
showLogin({ preserveChallenge: true });
loadDashboard({ quiet: true });
