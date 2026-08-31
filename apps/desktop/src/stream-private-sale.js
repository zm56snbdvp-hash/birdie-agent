import './stream-private-sale.css';
import {
  consumePrivateSaleHandoff,
  createPrivateSaleEvent,
  createPrivateSaleEvidence,
  markPrivateSaleCompleted,
  PRIVATE_SALE_RUN_ID,
  PRIVATE_SALE_VARIANTS,
  resolvePrivateSaleVariant,
} from './stream-private-sale-contract.js';

export function startPrivateSaleTest({ app, buildId }) {
  if (!app) throw new Error('private sale root missing');
  const query = new URLSearchParams(window.location.search);
  const variant = resolvePrivateSaleVariant(query.get('variant'));
  let navigationProof;
  try {
    navigationProof = consumePrivateSaleHandoff(window.localStorage, {
      nonce: query.get('handoff'),
      variant,
      runId: PRIVATE_SALE_RUN_ID,
    });
  } catch {
    navigationProof = Object.freeze({ status: 'STOP', reasonId: 'LOCAL_STORAGE_UNAVAILABLE' });
  }
  const mapping = PRIVATE_SALE_VARIANTS[variant];
  const startedAt = performance.now();
  const events = navigationProof.status === 'PASS' ? [...navigationProof.events] : [];
  const elapsedOffsetMs = events.at(-1)?.occurredAtMs ?? 0;
  let aborted = navigationProof.status !== 'PASS';

  app.innerHTML = `
    <main id="private-sale" aria-label="Birdie privater lokaler CTA-Test">
      <header class="private-sale-header">
        <div><span class="private-sale-mark" aria-hidden="true"></span><strong>BIRDIE // PRIVATE CTA E2E</strong></div>
        <p><span>EXTERNAL ACTIONS</span><b>LOCKED</b></p>
      </header>
      <section class="private-sale-stage">
        <div class="private-sale-copy">
          <span>FOUNDER RUN 1 / 1 · LOCAL ONLY</span>
          <h1>${mapping.label}</h1>
          <p>Dieser klickbare Pfad prüft CTA, Consent, Lead- und Sale-Zustand ausschließlich lokal. Keine Nachricht, kein Konto, kein Geld.</p>
        </div>
        <ol class="private-sale-steps" aria-label="View zu Sale Testpfad">
          <li data-step="VIEW"><span>01</span><div><strong>VIEW</strong><small>lokale Streamansicht</small></div></li>
          <li data-step="CTA"><span>02</span><div><strong>CTA</strong><small>echter lokaler Klick</small></div></li>
          <li data-step="LEAD"><span>03</span><div><strong>LEAD</strong><small>synthetisch, ohne PII</small></div></li>
          <li data-step="SALE"><span>04</span><div><strong>SALE</strong><small>Testwert, kein Geld</small></div></li>
        </ol>
        <section class="private-sale-action" aria-labelledby="private-sale-action-title">
          <span id="private-sale-status">QUELLNACHWEIS WIRD GEPRÜFT</span>
          <h2 id="private-sale-action-title">Lokalen Funnel abschließen</h2>
          <label><input id="private-sale-consent" type="checkbox" /> Ich bestätige: nur synthetische Testdaten, keine PII und keine Außenaktion.</label>
          <div>
            <button id="private-sale-lead" type="button">SYNTHETISCHEN LEAD ERZEUGEN</button>
            <button id="private-sale-sale" type="button" disabled>TEST-SALE ABSCHLIESSEN · 4900 TEST-CENTS</button>
            <button id="private-sale-safe" class="private-sale-safe" type="button">LOCAL SAFE / ABBRUCH</button>
          </div>
          <p id="private-sale-note" role="status" aria-live="polite">Consent ist erforderlich. Es wird nichts übertragen.</p>
        </section>
      </section>
      <footer><span>NO NETWORK · NO PII · NO MONEY</span><strong>BUILD ${String(buildId ?? 'LOCAL').slice(0, 12)}</strong></footer>
      <output id="private-sale-evidence" hidden aria-hidden="true"></output>
    </main>
  `;

  const $ = (selector) => app.querySelector(selector);
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));

  function append(type, { publishNow = true } = {}) {
    const event = createPrivateSaleEvent({
      type,
      sequenceId: events.length + 1,
      occurredAtMs: Math.max((events.at(-1)?.occurredAtMs ?? -1) + 1, elapsedOffsetMs + elapsed()),
      variant,
      runId: PRIVATE_SALE_RUN_ID,
    });
    events.push(event);
    app.querySelector(`[data-step="${type}"]`)?.setAttribute('data-state', 'PASS');
    if (publishNow) publish();
  }

  function publish() {
    const evidence = createPrivateSaleEvidence({
      events,
      variant,
      runId: PRIVATE_SALE_RUN_ID,
      navigationProof,
      aborted,
    });
    $('#private-sale-evidence').textContent = JSON.stringify(evidence);
    document.body.dataset.privateSaleReady = 'true';
    document.body.dataset.privateSaleDecision = evidence.decisions.privateCtaEndToEnd.toLowerCase();
    return evidence;
  }

  for (const event of events) {
    app.querySelector(`[data-step="${event.type}"]`)?.setAttribute('data-state', 'PASS');
  }
  if (navigationProof.status !== 'PASS') {
    $('#private-sale-status').textContent = 'PRIVATE CTA HOLD · STOP';
    $('#private-sale-consent').disabled = true;
    $('#private-sale-lead').disabled = true;
    $('#private-sale-sale').disabled = true;
    $('#private-sale-note').textContent = `Kein gültiger einmaliger Stream-CTA-Nachweis (${navigationProof.reasonId ?? 'UNKNOWN'}).`;
  } else {
    $('#private-sale-status').textContent = 'CTA-NACHWEIS PASS · EINMALIG';
    $('#private-sale-note').textContent = 'Consent ist erforderlich. Es wird nichts übertragen.';
  }
  $('#private-sale-lead').addEventListener('click', () => {
    if (aborted) return;
    if (!$('#private-sale-consent').checked) {
      $('#private-sale-note').textContent = 'HOLD · Consent fehlt; kein Event erzeugt.';
      return;
    }
    if (events.some((event) => event.type === 'LEAD')) return;
    append('LEAD');
    $('#private-sale-lead').disabled = true;
    $('#private-sale-sale').disabled = false;
    $('#private-sale-status').textContent = 'LEAD PASS · LOKAL';
    $('#private-sale-note').textContent = 'Keine PII gespeichert. Der Test-Sale kann lokal abgeschlossen werden.';
  });
  $('#private-sale-sale').addEventListener('click', () => {
    if (aborted) return;
    if (!events.some((event) => event.type === 'LEAD') || events.some((event) => event.type === 'SALE')) return;
    append('SALE', { publishNow: false });
    let completion;
    try {
      completion = markPrivateSaleCompleted(window.localStorage, PRIVATE_SALE_RUN_ID);
    } catch {
      completion = { status: 'STOP', reasonId: 'LOCAL_STORAGE_UNAVAILABLE' };
    }
    if (completion.status !== 'PASS') aborted = true;
    publish();
    $('#private-sale-sale').disabled = true;
    $('#private-sale-status').textContent = aborted ? 'PRIVATE CTA HOLD · STORAGE STOP' : 'PRIVATE CTA E2E PASS';
    $('#private-sale-note').textContent = aborted
      ? 'Completion konnte nicht dauerhaft verriegelt werden; Evidence bleibt STOP.'
      : 'Run 1/1 abgeschlossen · null Außenaktionen · kein Geld bewegt.';
  });
  $('#private-sale-safe').addEventListener('click', () => {
    aborted = true;
    $('#private-sale-status').textContent = 'LOCAL SAFE · STOP';
    $('#private-sale-lead').disabled = true;
    $('#private-sale-sale').disabled = true;
    $('#private-sale-note').textContent = 'Test lokal abgebrochen. Keine Außenaktion.';
    publish();
  });

  const api = Object.freeze({
    getEvidence: () => createPrivateSaleEvidence({
      events, variant, runId: PRIVATE_SALE_RUN_ID, navigationProof, aborted,
    }),
    getEvidenceJson: () => JSON.stringify(createPrivateSaleEvidence({
      events, variant, runId: PRIVATE_SALE_RUN_ID, navigationProof, aborted,
    }), null, 2),
  });
  window.__birdiePrivateSaleTest = api;
  publish();
  return api;
}
