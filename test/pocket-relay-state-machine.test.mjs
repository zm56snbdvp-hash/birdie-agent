import assert from "node:assert/strict";
import test from "node:test";
import {
  PocketRelayCommandState,
  PocketRelayProtocolError
} from "../src/pocket-relay/contract.mjs";
import {
  POCKET_RELAY_STATE_TRANSITIONS,
  PocketRelayStateMachine,
  canTransitionPocketRelayState
} from "../src/pocket-relay/state-machine.mjs";

test("Pocket Relay exposes the six required reconnectable states", () => {
  assert.deepEqual(Object.values(PocketRelayCommandState).sort(), [
    "cancelled",
    "completed",
    "failed",
    "paused",
    "queued",
    "running"
  ]);
});

test("queued/running/paused flow is explicit and recoverable", () => {
  let tick = 0;
  const machine = new PocketRelayStateMachine({
    clock: () => new Date(Date.UTC(2026, 7, 28, 12, 0, tick++))
  });
  machine.transition(PocketRelayCommandState.RUNNING, "connected");
  machine.transition(PocketRelayCommandState.PAUSED, "host_checkpoint");
  machine.transition(PocketRelayCommandState.RUNNING, "reconnected");
  machine.transition(PocketRelayCommandState.COMPLETED, "receipt_verified");

  const snapshot = machine.snapshot();
  assert.equal(snapshot.state, PocketRelayCommandState.COMPLETED);
  assert.deepEqual(snapshot.history.map((entry) => entry.state), [
    "queued",
    "running",
    "paused",
    "running",
    "completed"
  ]);
  assert.equal(canTransitionPocketRelayState("paused", "running"), true);
});

test("terminal and invalid transitions fail closed", () => {
  const machine = new PocketRelayStateMachine();
  machine.transition(PocketRelayCommandState.CANCELLED, "user_cancelled");
  assert.throws(
    () => machine.transition(PocketRelayCommandState.RUNNING, "stale_retry"),
    (error) => error instanceof PocketRelayProtocolError && error.code === "STATE_TRANSITION_DENIED"
  );
  assert.equal(canTransitionPocketRelayState("completed", "running"), false);
});

test("transition matrix has no implicit or terminal escape", () => {
  const expected = {
    queued: ["running", "failed", "cancelled"],
    running: ["paused", "completed", "failed", "cancelled"],
    paused: ["running", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
  };
  for (const [state, transitions] of Object.entries(expected)) {
    assert.deepEqual([...POCKET_RELAY_STATE_TRANSITIONS[state]], transitions);
  }
});
