import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createMockPocketRelayBridge } from "../src/pocket-relay/bridge.mjs";
import { PocketRelayAction } from "../src/pocket-relay/contract.mjs";

function workflowCommand(action, payload) {
  return {
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    action,
    payload
  };
}

function executeWorkflow(bridge, action, payload) {
  return bridge.execute(workflowCommand(action, payload), {
    signal: new AbortController().signal,
    assertActive() {}
  });
}

test("workflow run cursor blocks stale revisions and input changes", async () => {
  const bridge = createMockPocketRelayBridge();
  const runId = randomUUID();
  const started = await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId,
    expectedRevision: 0,
    inputRef: "approved-input-a"
  });
  assert.equal(started.revision, 1);
  const paused = await executeWorkflow(bridge, PocketRelayAction.PAUSE_WORKFLOW, {
    workflowId: "daily-briefing",
    runId,
    expectedRevision: started.revision
  });
  assert.equal(paused.revision, 2);

  await assert.rejects(
    () => executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
      workflowId: "daily-briefing",
      runId,
      expectedRevision: paused.revision,
      inputRef: "approved-input-b"
    }),
    (error) => error.code === "WORKFLOW_INPUT_CONFLICT"
  );
  await assert.rejects(
    () => executeWorkflow(bridge, PocketRelayAction.CANCEL_WORKFLOW, {
      workflowId: "daily-briefing",
      runId,
      expectedRevision: started.revision
    }),
    (error) => error.code === "WORKFLOW_REVISION_CONFLICT"
  );
});

test("terminal workflow callback is immutable and exact duplicate is a no-op", async () => {
  const bridge = createMockPocketRelayBridge();
  const runId = randomUUID();
  const started = await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId,
    expectedRevision: 0
  });
  assert.equal(started.state, "running");

  const first = bridge.completeWorkflow("daily-briefing", runId, started.revision, { summary: "first" });
  const duplicate = bridge.completeWorkflow("daily-briefing", runId, started.revision, { summary: "first" });
  assert.equal(duplicate.revision, first.revision);
  assert.deepEqual(duplicate.result, first.result);
  duplicate.result.summary = "caller mutation";
  assert.equal(bridge.workflowSnapshot("daily-briefing").result.summary, "first");

  assert.throws(
    () => bridge.completeWorkflow("daily-briefing", runId, started.revision, { summary: "overwritten" }),
    (error) => error.code === "WORKFLOW_TERMINAL_RESULT_CONFLICT"
  );
  assert.equal(bridge.workflowSnapshot("daily-briefing").revision, first.revision);
  assert.equal(bridge.workflowSnapshot("daily-briefing").result.summary, "first");

  const failedBridge = createMockPocketRelayBridge();
  const failedRunId = randomUUID();
  const failedStart = await executeWorkflow(failedBridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: failedRunId,
    expectedRevision: 0
  });
  const failed = failedBridge.failWorkflow(
    "daily-briefing",
    failedRunId,
    failedStart.revision,
    "MOCK_FAILURE"
  );
  const failedReplay = failedBridge.failWorkflow(
    "daily-briefing",
    failedRunId,
    failedStart.revision,
    "MOCK_FAILURE"
  );
  assert.equal(failedReplay.revision, failed.revision);
  assert.throws(
    () => failedBridge.failWorkflow(
      "daily-briefing",
      failedRunId,
      failedStart.revision,
      "DIFFERENT_FAILURE"
    ),
    (error) => error.code === "WORKFLOW_TERMINAL_RESULT_CONFLICT"
  );
});

test("result read returns the authoritative revision and retains a completed prior run", async () => {
  const bridge = createMockPocketRelayBridge();
  const completedRunId = randomUUID();
  const started = await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: completedRunId,
    expectedRevision: 0
  });
  bridge.completeWorkflow("daily-briefing", completedRunId, started.revision, { summary: "offline completion" });

  const staleRead = await executeWorkflow(bridge, PocketRelayAction.GET_WORKFLOW_RESULT, {
    workflowId: "daily-briefing",
    runId: completedRunId,
    knownRevision: started.revision
  });
  assert.equal(staleRead.state, "completed");
  assert.equal(staleRead.revision, started.revision + 1);

  const replacementRunId = randomUUID();
  await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: replacementRunId,
    expectedRevision: 0
  });
  const archivedRead = await executeWorkflow(bridge, PocketRelayAction.GET_WORKFLOW_RESULT, {
    workflowId: "daily-briefing",
    runId: completedRunId
  });
  assert.equal(archivedRead.result.summary, "offline completion");
});

test("late callbacks cannot complete a replacement run and runIds are never reusable", async () => {
  const bridge = createMockPocketRelayBridge();
  const firstRunId = randomUUID();
  const first = await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: firstRunId,
    expectedRevision: 0
  });
  const cancelledFirst = await executeWorkflow(bridge, PocketRelayAction.CANCEL_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: firstRunId,
    expectedRevision: first.revision
  });

  const secondRunId = randomUUID();
  const second = await executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
    workflowId: "daily-briefing",
    runId: secondRunId,
    expectedRevision: 0
  });
  assert.throws(
    () => bridge.completeWorkflow("daily-briefing", firstRunId, cancelledFirst.revision, { summary: "late A" }),
    (error) => error.code === "WORKFLOW_RUN_CONFLICT"
  );
  assert.equal(bridge.workflowSnapshot("daily-briefing").runId, secondRunId);
  assert.equal(bridge.workflowSnapshot("daily-briefing").state, "running");

  const completedSecond = bridge.completeWorkflow(
    "daily-briefing",
    secondRunId,
    second.revision,
    { summary: "B" }
  );
  await assert.rejects(
    () => executeWorkflow(bridge, PocketRelayAction.START_WORKFLOW, {
      workflowId: "daily-briefing",
      runId: firstRunId,
      expectedRevision: 0
    }),
    (error) => error.code === "WORKFLOW_RUN_TERMINAL"
  );
  assert.equal(bridge.workflowSnapshot("daily-briefing").revision, completedSecond.revision);
});
