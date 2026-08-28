import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_FIXTURE_URL = new URL(
  "../test/fixtures/birdie-recall-smoke.v1.json",
  import.meta.url
);

const EXPLICIT_CHANNELS = new Set(["manualSelection", "birdieDrop"]);
const SUPPORTED_KINDS = new Set(["link", "screenshot", "photo", "pdf", "note"]);
const STOP_WORDS = new Set([
  "aber", "am", "an", "auf", "aus", "bei", "bin", "bis", "das", "dem", "den", "der",
  "des", "die", "ein", "eine", "einer", "eines", "für", "hat", "ich", "im", "in", "ist",
  "mit", "nach", "oder", "sein", "und", "von", "vom", "war", "was", "welche", "welcher",
  "welches", "wie", "wo", "zu", "zum", "zur", "gestern", "heute", "vorgestern",
  "a", "an", "and", "at", "from", "in", "is", "of", "on", "or", "the", "to", "was",
  "what", "when", "where", "which", "yesterday", "today"
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE");
}

function terms(value, { removeStopWords = true } = {}) {
  return normalize(value)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((term) => term.length >= 2 && (!removeStopWords || !STOP_WORDS.has(term)));
}

function weightedTerms(item) {
  const weights = new Map();
  const add = (value, weight) => {
    for (const term of terms(value, { removeStopWords: false })) {
      weights.set(term, (weights.get(term) ?? 0) + weight);
    }
  };

  add(item.title, 6);
  for (const tag of item.tags ?? []) add(tag, 5);
  add(item.attachment?.originalFilename, 3);
  if (item.linkURL) {
    const url = new URL(item.linkURL);
    add(url.host, 3);
    add(url.href, 2);
  }
  add(item.summary, 2);
  add(item.note, 1.5);
  add(item.extractedText, 1);
  add(item.provenance?.sourceApplication, 1);
  return weights;
}

function utcDayWindow(now, offset) {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + offset
  ));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function naturalDateWindow(query, now) {
  const queryTerms = new Set(terms(query, { removeStopWords: false }));
  if (queryTerms.has("vorgestern")) return utcDayWindow(now, -2);
  if (queryTerms.has("gestern") || queryTerms.has("yesterday")) return utcDayWindow(now, -1);
  if (queryTerms.has("heute") || queryTerms.has("today")) return utcDayWindow(now, 0);

  const isoDate = normalize(query).match(/\b(\d{4})-(\d{2})-(\d{2})\b/u);
  if (!isoDate) return undefined;
  const [, year, month, day] = isoDate;
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function search({ items, index, query, now }) {
  assert.equal(query.contractVersion, 1, "search contract version must be V1");
  assert.ok(Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 200);

  const queryTerms = [...new Set(terms(query.text))].sort();
  const dateWindow = naturalDateWindow(query.text, now);
  const results = [];

  for (const item of items) {
    const capturedAt = new Date(item.capturedAt);
    if (dateWindow && (capturedAt < dateWindow.start || capturedAt >= dateWindow.end)) continue;
    const document = index.get(item.id);
    if (!document) continue;

    let score = dateWindow ? 4 : 0;
    const matchedTerms = [];
    for (const queryTerm of queryTerms) {
      if (document.has(queryTerm)) {
        score += document.get(queryTerm);
        matchedTerms.push(queryTerm);
        continue;
      }
      if (queryTerm.length < 4) continue;
      const prefixWeights = [...document.entries()]
        .filter(([documentTerm]) => documentTerm.length >= 4 && (
          documentTerm.startsWith(queryTerm) || queryTerm.startsWith(documentTerm)
        ))
        .map(([, weight]) => weight);
      if (prefixWeights.length > 0) {
        score += Math.max(...prefixWeights) * 0.65;
        matchedTerms.push(queryTerm);
      }
    }
    if (queryTerms.length > 0 && matchedTerms.length === 0) continue;
    results.push({ item, score, matchedTerms: matchedTerms.sort() });
  }

  return results
    .sort((left, right) => (
      right.score - left.score ||
      new Date(right.item.capturedAt) - new Date(left.item.capturedAt) ||
      left.item.id.localeCompare(right.item.id)
    ))
    .slice(0, query.limit);
}

function validateFixture(fixture) {
  assert.equal(fixture.schemaVersion, 1, "fixture schema must be V1");
  assert.equal(fixture.calendarTimeZone, "UTC", "smoke calendar must be deterministic");
  assert.ok(!Number.isNaN(new Date(fixture.now).valueOf()), "fixture now must be an ISO date");
  assert.ok(Array.isArray(fixture.items) && fixture.items.length > 0);
  assert.equal(new Set(fixture.items.map(({ id }) => id)).size, fixture.items.length);
  for (const item of fixture.items) {
    assert.equal(item.schemaVersion, 1, `${item.id}: item schema must be V1`);
    assert.ok(EXPLICIT_CHANNELS.has(item.provenance?.channel), `${item.id}: explicit intake channel required`);
    assert.ok(SUPPORTED_KINDS.has(item.kind), `${item.id}: unsupported item kind`);
    assert.ok(!Number.isNaN(new Date(item.capturedAt).valueOf()), `${item.id}: capturedAt must be ISO`);
  }
}

export async function runRecallSmoke({ fixtureURL = DEFAULT_FIXTURE_URL } = {}) {
  const fixture = JSON.parse(await readFile(fixtureURL, "utf8"));
  validateFixture(fixture);

  const state = {
    items: structuredClone(fixture.items),
    localIndex: new Map(fixture.items.map((item) => [item.id, weightedTerms(item)])),
    deletionReceipts: []
  };
  const now = new Date(fixture.now);

  const firstSearch = search({ items: state.items, index: state.localIndex, query: fixture.query, now });
  const repeatedSearch = search({ items: state.items, index: state.localIndex, query: fixture.query, now });
  const hitIdentifiers = firstSearch.map(({ item }) => item.id);
  assert.deepEqual(hitIdentifiers, fixture.expected.hitIdentifiers);
  assert.deepEqual(repeatedSearch, firstSearch, "fixed input must produce byte-for-byte stable ranking");
  assert.deepEqual(firstSearch[0]?.matchedTerms, fixture.expected.matchedTerms);

  const portableExport = {
    schemaVersion: 1,
    exportedAt: fixture.now,
    itemIdentifiers: state.items.map(({ id }) => id).sort()
  };
  assert.deepEqual(portableExport.itemIdentifiers, [...fixture.expected.exportIdentifiers].sort());

  const deletedIdentifier = fixture.expected.hitIdentifiers[0];
  state.localIndex.delete(deletedIdentifier);
  state.items = state.items.filter(({ id }) => id !== deletedIdentifier);
  state.deletionReceipts.push({
    operationIdentifier: fixture.deletionOperationIdentifier,
    scope: "singleItem",
    itemIdentifiers: [deletedIdentifier],
    completedAt: fixture.now
  });

  const remainingIdentifiers = state.items.map(({ id }) => id).sort();
  assert.deepEqual(remainingIdentifiers, [...fixture.expected.remainingIdentifiers].sort());
  assert.equal(state.localIndex.has(deletedIdentifier), false, "forgotten ID must leave the local index");
  assert.deepEqual(state.deletionReceipts[0].itemIdentifiers, [deletedIdentifier]);
  const afterDeletion = search({
    items: state.items,
    index: state.localIndex,
    query: { contractVersion: 1, text: "Hotel", limit: 50 },
    now
  });
  assert.deepEqual(afterDeletion, [], "forgotten hotel must not remain searchable");

  return {
    fixtureSchemaVersion: fixture.schemaVersion,
    now: fixture.now,
    query: fixture.query.text,
    hitIdentifiers,
    matchedTerms: firstSearch[0]?.matchedTerms ?? [],
    exportIdentifiers: portableExport.itemIdentifiers,
    deletedIdentifier,
    deletionOperationIdentifier: state.deletionReceipts[0].operationIdentifier,
    localIndexContainsDeletedIdentifier: state.localIndex.has(deletedIdentifier),
    remainingIdentifiers
  };
}

const isMain = process.argv[1] && (
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
);

if (isMain) {
  try {
    const result = await runRecallSmoke();
    process.stdout.write(`Birdie Recall smoke passed\n${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Birdie Recall smoke failed: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
