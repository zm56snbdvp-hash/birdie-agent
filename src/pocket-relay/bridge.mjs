import {
  PocketRelayAction,
  PocketRelayCommandState,
  PocketRelayProtocolError,
  sha256Hex,
  stableStringify
} from "./contract.mjs";
import { PocketRelayStateMachine } from "./state-machine.mjs";

const MAX_ARCHIVED_RUNS_PER_WORKFLOW = 20;

function fail(code, message, status = 409, details) {
  throw new PocketRelayProtocolError(code, message, status, details);
}

function cloneWorkflowResult(value) {
  function inspect(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      item.forEach(inspect);
      return;
    }
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) {
      fail("WORKFLOW_RESULT_INVALID", "workflow result must contain only plain JSON values", 400);
    }
    Object.values(item).forEach(inspect);
  }
  inspect(value);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 8 * 1024 * 1024) {
    fail("WORKFLOW_RESULT_INVALID", "workflow result exceeds the mock result contract", 400);
  }
  return JSON.parse(serialized);
}

export class PocketRelayBridge {
  describe() {
    throw new Error("PocketRelayBridge.describe() must be implemented");
  }

  async execute(_command, _effectLease) {
    throw new Error("PocketRelayBridge.execute() must be implemented");
  }
}

export class DisabledPocketRelayBridge extends PocketRelayBridge {
  constructor({ targetDevice }) {
    super();
    this.targetDevice = Object.freeze({ ...targetDevice });
  }

  describe() {
    return {
      kind: "disabled",
      productionEffectsEnabled: false,
      targetDevice: this.targetDevice,
      registeredWorkflows: [],
      approvedExports: []
    };
  }

  async execute(command, effectLease) {
    effectLease?.assertActive?.();
    fail(
      "PRODUCTION_BRIDGE_NOT_CONFIGURED",
      `no production executor is configured for ${String(command?.action)}`,
      503
    );
  }
}

export class MockPocketRelayBridge extends PocketRelayBridge {
  constructor({
    clock = () => new Date(),
    targetDevice = {
      deviceId: "birdie-windows-mock",
      deviceName: "Birdie Windows Mock",
      platform: "windows"
    },
    workflows = ["daily-briefing", "inbox-triage"],
    exports: exportFixtures
  } = {}) {
    super();
    this.clock = clock;
    this.targetDevice = Object.freeze({ ...targetDevice });
    this.registeredWorkflows = new Set(workflows);
    this.workflowRuns = new Map();
    this.workflowRunArchive = new Map();
    this.workflowRunArchiveOrder = new Map();
    this.usedWorkflowRunIds = new Set();
    this.inboundFiles = new Map();
    this.effects = [];
    const defaultContent = Buffer.from("Pocket Relay mock export\n", "utf8");
    this.exports = new Map(exportFixtures ?? [[
      "approved-demo-export",
      {
        fileName: "birdie-demo.txt",
        contentType: "text/plain",
        sizeBytes: defaultContent.length,
        sha256: sha256Hex(defaultContent),
        contentBase64: defaultContent.toString("base64")
      }
    ]]);
  }

  describe() {
    return {
      kind: "mock",
      productionEffectsEnabled: false,
      targetDevice: this.targetDevice,
      registeredWorkflows: [...this.registeredWorkflows],
      approvedExports: [...this.exports.keys()]
    };
  }

  async execute(command, effectLease) {
    if (!effectLease || typeof effectLease.assertActive !== "function" || !effectLease.signal) {
      fail("COMMAND_EFFECT_LEASE_REQUIRED", "mock bridge requires an active effect lease", 500);
    }
    effectLease.assertActive();
    switch (command.action) {
      case PocketRelayAction.OPEN_LINK:
        return this.#effect(command, {
          simulated: true,
          openedUrl: command.payload.url
        });

      case PocketRelayAction.SEND_FILE_TO_PC: {
        const fileId = `inbound:${command.commandId}`;
        this.inboundFiles.set(fileId, {
          fileName: command.payload.fileName,
          contentType: command.payload.contentType,
          sizeBytes: command.payload.sizeBytes,
          sha256: command.payload.sha256,
          content: Buffer.from(command.payload.contentBase64, "base64")
        });
        return this.#effect(command, {
          simulated: true,
          transferId: fileId,
          fileName: command.payload.fileName,
          sizeBytes: command.payload.sizeBytes,
          sha256: command.payload.sha256
        });
      }

      case PocketRelayAction.FETCH_FILE_TO_IPHONE: {
        const file = this.exports.get(command.payload.exportId);
        if (!file) fail("HOST_EXPORT_NOT_APPROVED", "exportId is not in the host-approved export registry", 404);
        return this.#effect(command, {
          simulated: true,
          exportId: command.payload.exportId,
          file: { ...file }
        });
      }

      case PocketRelayAction.START_WORKFLOW:
        return this.#startWorkflow(command);
      case PocketRelayAction.PAUSE_WORKFLOW:
        return this.#pauseWorkflow(command);
      case PocketRelayAction.CANCEL_WORKFLOW:
        return this.#cancelWorkflow(command);
      case PocketRelayAction.GET_WORKFLOW_RESULT:
        return this.#workflowResult(command);

      case PocketRelayAction.LOCK_PC:
        return this.#effect(command, {
          simulated: true,
          locked: true,
          note: "Mock only; no operating-system lock call was made."
        });

      default:
        fail("BRIDGE_ACTION_NOT_SUPPORTED", `mock bridge does not support ${String(command.action)}`, 501);
    }
  }

  completeWorkflow(workflowId, runId, expectedRevision, result = { summary: "Mock workflow completed." }) {
    const run = this.#requireWorkflowRun(workflowId);
    this.#requireRunIdentity(run, runId);
    const clonedResult = cloneWorkflowResult(result);
    if (run.machine.state === PocketRelayCommandState.COMPLETED) {
      if (expectedRevision !== run.revision && expectedRevision !== run.revision - 1) {
        this.#requireExactRun(run, { runId, expectedRevision });
      }
      if (stableStringify(run.result) !== stableStringify(clonedResult)) {
        fail("WORKFLOW_TERMINAL_RESULT_CONFLICT", "completed workflow result is immutable", 409);
      }
      return this.workflowSnapshot(workflowId);
    }
    this.#requireExactRun(run, { runId, expectedRevision });
    if ([PocketRelayCommandState.CANCELLED, PocketRelayCommandState.FAILED].includes(run.machine.state)) {
      fail("WORKFLOW_STATE_CONFLICT", `workflow cannot complete from ${run.machine.state}`, 409);
    }
    this.#transitionRun(run, PocketRelayCommandState.COMPLETED, "mock_completed");
    run.result = clonedResult;
    run.outputRef = `workflow-result:${workflowId}:${run.runId}`;
    return this.workflowSnapshot(workflowId);
  }

  failWorkflow(workflowId, runId, expectedRevision, errorCode = "MOCK_WORKFLOW_FAILED") {
    const run = this.#requireWorkflowRun(workflowId);
    this.#requireRunIdentity(run, runId);
    const normalizedError = String(errorCode).slice(0, 80);
    if (run.machine.state === PocketRelayCommandState.FAILED) {
      if (expectedRevision !== run.revision && expectedRevision !== run.revision - 1) {
        this.#requireExactRun(run, { runId, expectedRevision });
      }
      if (run.errorCode !== normalizedError) {
        fail("WORKFLOW_TERMINAL_RESULT_CONFLICT", "failed workflow error is immutable", 409);
      }
      return this.workflowSnapshot(workflowId);
    }
    this.#requireExactRun(run, { runId, expectedRevision });
    if ([PocketRelayCommandState.CANCELLED, PocketRelayCommandState.COMPLETED].includes(run.machine.state)) {
      fail("WORKFLOW_STATE_CONFLICT", `workflow cannot fail from ${run.machine.state}`, 409);
    }
    this.#transitionRun(run, PocketRelayCommandState.FAILED, errorCode);
    run.errorCode = normalizedError;
    return this.workflowSnapshot(workflowId);
  }

  workflowSnapshot(workflowId, runId = undefined) {
    const current = this.workflowRuns.get(workflowId);
    const run = runId === undefined || current?.runId === runId
      ? current
      : this.workflowRunArchive.get(this.#archiveKey(workflowId, runId));
    if (!run) {
      return {
        workflowId,
        state: PocketRelayCommandState.QUEUED,
        history: [],
        runId: null,
        revision: 0,
        inputRef: null,
        outputRef: null,
        result: null,
        errorCode: null
      };
    }
    const state = run.machine.snapshot();
    return {
      workflowId,
      runId: run.runId,
      revision: run.revision,
      inputRef: run.inputRef,
      state: state.state,
      history: state.history,
      outputRef: run.outputRef ?? null,
      result: run.result === null ? null : structuredClone(run.result),
      errorCode: run.errorCode ?? null
    };
  }

  #startWorkflow(command) {
    const workflowId = this.#requireRegisteredWorkflow(command.payload.workflowId);
    const requestedRunId = command.payload.runId;
    const expectedRevision = command.payload.expectedRevision;
    let run = this.workflowRuns.get(workflowId);
    const isTerminal = run && [
      PocketRelayCommandState.CANCELLED,
      PocketRelayCommandState.COMPLETED,
      PocketRelayCommandState.FAILED
    ].includes(run.machine.state);
    if (!run || isTerminal) {
      if (expectedRevision !== 0) {
        fail("WORKFLOW_REVISION_CONFLICT", `new workflow run requires expectedRevision 0`, 409);
      }
      const requestedRunKey = this.#archiveKey(workflowId, requestedRunId);
      if (this.usedWorkflowRunIds.has(requestedRunKey)) {
        fail("WORKFLOW_RUN_TERMINAL", "a workflow runId may never be reused", 409);
      }
      if (isTerminal) this.#archiveRun(workflowId, run);
      run = {
        runId: requestedRunId,
        revision: 0,
        inputRef: command.payload.inputRef ?? null,
        machine: new PocketRelayStateMachine({ clock: this.clock }),
        result: null,
        outputRef: null,
        errorCode: null
      };
      this.workflowRuns.set(workflowId, run);
      this.usedWorkflowRunIds.add(requestedRunKey);
    } else {
      this.#requireExactRun(run, command.payload);
      if (run.inputRef !== (command.payload.inputRef ?? null)) {
        fail("WORKFLOW_INPUT_CONFLICT", "workflow inputRef cannot change while resuming a run", 409);
      }
    }
    if (run.machine.state === PocketRelayCommandState.QUEUED || run.machine.state === PocketRelayCommandState.PAUSED) {
      this.#transitionRun(run, PocketRelayCommandState.RUNNING, "iphone_start");
    } else {
      fail("WORKFLOW_STATE_CONFLICT", `workflow ${workflowId} cannot start from ${run.machine.state}`, 409);
    }
    return this.#effect(command, this.workflowSnapshot(workflowId));
  }

  #pauseWorkflow(command) {
    const workflowId = this.#requireRegisteredWorkflow(command.payload.workflowId);
    const run = this.#requireWorkflowRun(workflowId);
    this.#requireExactRun(run, command.payload);
    if (run.machine.state !== PocketRelayCommandState.RUNNING) {
      fail("WORKFLOW_STATE_CONFLICT", `workflow ${workflowId} is not running`);
    }
    this.#transitionRun(run, PocketRelayCommandState.PAUSED, "iphone_pause");
    return this.#effect(command, this.workflowSnapshot(workflowId));
  }

  #cancelWorkflow(command) {
    const workflowId = this.#requireRegisteredWorkflow(command.payload.workflowId);
    const run = this.#requireWorkflowRun(workflowId);
    this.#requireExactRun(run, command.payload);
    if (![PocketRelayCommandState.QUEUED, PocketRelayCommandState.RUNNING, PocketRelayCommandState.PAUSED].includes(run.machine.state)) {
      fail("WORKFLOW_STATE_CONFLICT", `workflow ${workflowId} cannot be cancelled from ${run.machine.state}`);
    }
    this.#transitionRun(run, PocketRelayCommandState.CANCELLED, "iphone_cancel");
    return this.#effect(command, this.workflowSnapshot(workflowId));
  }

  #workflowResult(command) {
    const workflowId = this.#requireRegisteredWorkflow(command.payload.workflowId);
    const current = this.workflowRuns.get(workflowId);
    const run = current?.runId === command.payload.runId
      ? current
      : this.workflowRunArchive.get(this.#archiveKey(workflowId, command.payload.runId));
    if (!run) fail("WORKFLOW_RUN_CONFLICT", "workflow result targets an unknown or expired runId", 404);
    return this.#effect(command, this.workflowSnapshot(workflowId, command.payload.runId));
  }

  #archiveKey(workflowId, runId) {
    return `${workflowId}\u0000${runId}`;
  }

  #archiveRun(workflowId, run) {
    const key = this.#archiveKey(workflowId, run.runId);
    this.workflowRunArchive.set(key, run);
    const order = this.workflowRunArchiveOrder.get(workflowId) ?? [];
    order.push(key);
    while (order.length > MAX_ARCHIVED_RUNS_PER_WORKFLOW) {
      this.workflowRunArchive.delete(order.shift());
    }
    this.workflowRunArchiveOrder.set(workflowId, order);
  }

  #requireRegisteredWorkflow(workflowId) {
    if (!this.registeredWorkflows.has(workflowId)) {
      fail("WORKFLOW_NOT_REGISTERED", `workflow ${workflowId} is not registered on this host`, 404);
    }
    return workflowId;
  }

  #requireWorkflowRun(workflowId) {
    const run = this.workflowRuns.get(workflowId);
    if (!run) fail("WORKFLOW_NOT_RUNNING", `workflow ${workflowId} has no active run`, 404);
    return run;
  }

  #requireExactRun(run, payload) {
    this.#requireRunIdentity(run, payload.runId);
    if (run.revision !== payload.expectedRevision) {
      fail(
        "WORKFLOW_REVISION_CONFLICT",
        `workflow revision is ${run.revision}, not ${payload.expectedRevision}`,
        409,
        { currentRevision: run.revision }
      );
    }
  }

  #requireRunIdentity(run, runId) {
    if (run.runId !== runId) {
      fail("WORKFLOW_RUN_CONFLICT", "workflow command targets a stale or different runId", 409);
    }
  }

  #transitionRun(run, state, reason) {
    if (run.machine.state === state) return false;
    run.machine.transition(state, reason);
    run.revision += 1;
    return true;
  }

  #effect(command, result) {
    this.effects.push({
      commandId: command.commandId,
      action: command.action,
      at: (this.clock() instanceof Date ? this.clock() : new Date(this.clock())).toISOString()
    });
    return result;
  }
}

export function createMockPocketRelayBridge(options) {
  return new MockPocketRelayBridge(options);
}
