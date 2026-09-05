import test from "node:test";
import assert from "node:assert/strict";
import { discoverGelatoA3PosterProducts } from "../src/moments/staging/gelato-catalog-discovery.mjs";

const value = (uid) => ({ productAttributeValueUid: uid });
const attribute = (uid, values) => ({ productAttributeUid: uid, values });
const catalog = (paper = [value("A3")], orientation = [value("ver")]) => ({
  productAttributes: [attribute("PaperFormat", paper), attribute("Orientation", orientation)]
});
function fixture(body) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, calls.length === 1
      ? "https://product.gelatoapis.com/v3/catalogs/posters"
      : "https://product.gelatoapis.com/v3/catalogs/posters/products:search");
    assert.equal(options.method ?? "GET", calls.length === 1 ? "GET" : "POST");
    assert.equal(options.headers["X-API-KEY"], "synthetic-key");
    assert.ok(calls.length <= 2);
    return { ok: true, status: 200, json: async () => calls.length === 1 ? body : { products: [] } };
  };
  return { calls, run: (options = {}) => discoverGelatoA3PosterProducts({ apiKey: "synthetic-key", fetchImpl, ...options }) };
}

test("Gelato accepts documented array values and explicit matching dictionary UIDs", async () => {
  for (const body of [catalog(), catalog({ A3: value("A3") }, { ver: value("ver") }), catalog([value("A3")], { ver: value("ver") })]) {
    const { run, calls } = fixture(body);
    assert.equal((await run()).candidateCount, 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      attributeFilters: { PaperFormat: ["A3"], Orientation: ["ver"] }, limit: 100, offset: 0
    });
  }
});

test("Gelato ignores unrelated complex values when validating the required catalog attributes", async () => {
  const body = catalog();
  body.productAttributes.push(attribute("Unrelated", { nested: { custom: [null, {}] } }));
  const { run, calls } = fixture(body);
  await run();
  assert.equal(calls.length, 2);
});

test("Gelato rejects ambiguous or malformed required value mappings before searching", async () => {
  const invalidValues = [null, "A3", 3, [null], ["A3"], [{}], [value(["A3"])],
    [value("")], [value(" ")], [value("A3"), value("A3")],
    { A3: null }, { A3: {} }, { A3: value("A4") }, { A3: "A3" }];
  for (const values of invalidValues) {
    const { run, calls } = fixture(catalog(values));
    await assert.rejects(run(), { message: "Gelato catalog schema error" });
    assert.equal(calls.length, 1);
  }
});

test("Gelato rejects invalid catalog containers and duplicate required attributes", async () => {
  const duplicate = catalog();
  duplicate.productAttributes.push(attribute("PaperFormat", [value("A3")]));
  for (const body of [null, {}, { productAttributes: {} }, duplicate]) {
    const { run, calls } = fixture(body);
    await assert.rejects(run(), { message: "Gelato catalog schema error" });
    assert.equal(calls.length, 1);
  }
});

test("Gelato does not infer a target value from dictionary keys or wrong-case identifiers", async () => {
  for (const body of [catalog([]), catalog([value("a3")]), { productAttributes: [attribute("paperformat", [value("A3")])] }]) {
    const { run, calls } = fixture(body);
    await assert.rejects(run(), { message: "Gelato catalog posters does not expose PaperFormat=A3" });
    assert.equal(calls.length, 1);
  }
});

test("Gelato enforces the documented 1..100 search limit before any request", async () => {
  for (const limit of [0, -1, 101, 200, 1.5, "100", null, NaN, Infinity]) {
    const { run, calls } = fixture(catalog());
    await assert.rejects(run({ limit }), { message: "Gelato discovery limit must be an integer from 1 to 100" });
    assert.equal(calls.length, 0);
  }
  for (const limit of [1, 100]) {
    const { run, calls } = fixture(catalog());
    await run({ limit });
    assert.equal(JSON.parse(calls[1].options.body).limit, limit);
  }
});
