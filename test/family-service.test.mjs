import test from "node:test";
import assert from "node:assert/strict";
import { createFamilyReadService } from "../src/family/family-service.mjs";

test("family service calls only allowlisted read actions", async () => {
  const calls = [];
  const service = createFamilyReadService({
    birdieOSGet: async (action) => {
      calls.push(action);
      return {
        data: {
          brand: "Birdie & Breakfast",
          finance: { cash: 123 },
          email: "private@example.com"
        }
      };
    }
  });

  const briefing = await service.briefing();
  assert.deepEqual(calls, ["briefing"]);
  assert.equal(briefing.readOnly, true);
  assert.equal(briefing.data.brand, "Birdie & Breakfast");
  assert.equal("finance" in briefing.data, false);
  assert.equal("email" in briefing.data, false);
});

test("family service rejects arbitrary BirdieOS actions", async () => {
  const service = createFamilyReadService({
    birdieOSGet: async () => ({ data: {} })
  });

  await assert.rejects(
    () => service.read("updateTask"),
    (error) => error?.code === "FAMILY_RESOURCE_DENIED"
  );
});
