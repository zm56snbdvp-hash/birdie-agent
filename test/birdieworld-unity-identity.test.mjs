import test from "node:test";
import assert from "node:assert/strict";
import { resolveUnityPlayerFromCanonicalProfiles } from "../src/app/birdieworld-unity-identity.mjs";

test("exact ACTIVE canonical profile link resolves", () => {
  const result = resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId: "player-1", profiles: [{ birdieId: "B-1", status: "ACTIVE", unityPlayerId: "player-1" }] });
  assert.equal(result.status, "BOUND");
  assert.equal(result.birdieId, "B-1");
});

test("username and email cannot resolve Unity identity", () => {
  const result = resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId: "player-1", profiles: [{ birdieId: "B-1", status: "ACTIVE", email: "player-1", instagramHandle: "player-1" }] });
  assert.equal(result.status, "UNBOUND");
});

test("inactive canonical profile never resolves", () => {
  const result = resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId: "player-1", profiles: [{ birdieId: "B-1", status: "INACTIVE", unityPlayerId: "player-1" }] });
  assert.equal(result.status, "UNBOUND");
});

test("duplicate Unity Player ID fails closed", () => {
  assert.throws(() => resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId: "player-1", profiles: [{ birdieId: "B-1", status: "ACTIVE", unityPlayerId: "player-1" }, { birdieId: "B-2", status: "ACTIVE", unityPlayerId: "player-1" }] }), /UNITY_CANONICAL_PROFILE_LINK_CONFLICT/);
});
