import {
  PocketRelayCommandState,
  PocketRelayProtocolError
} from "./contract.mjs";

export const POCKET_RELAY_STATE_TRANSITIONS = Object.freeze({
  [PocketRelayCommandState.QUEUED]: new Set([
    PocketRelayCommandState.RUNNING,
    PocketRelayCommandState.FAILED,
    PocketRelayCommandState.CANCELLED
  ]),
  [PocketRelayCommandState.RUNNING]: new Set([
    PocketRelayCommandState.PAUSED,
    PocketRelayCommandState.COMPLETED,
    PocketRelayCommandState.FAILED,
    PocketRelayCommandState.CANCELLED
  ]),
  [PocketRelayCommandState.PAUSED]: new Set([
    PocketRelayCommandState.RUNNING,
    PocketRelayCommandState.FAILED,
    PocketRelayCommandState.CANCELLED
  ]),
  [PocketRelayCommandState.COMPLETED]: new Set(),
  [PocketRelayCommandState.FAILED]: new Set(),
  [PocketRelayCommandState.CANCELLED]: new Set()
});

export function canTransitionPocketRelayState(from, to) {
  return POCKET_RELAY_STATE_TRANSITIONS[from]?.has(to) === true;
}

export class PocketRelayStateMachine {
  constructor({ initialState = PocketRelayCommandState.QUEUED, clock = () => new Date() } = {}) {
    if (!Object.hasOwn(POCKET_RELAY_STATE_TRANSITIONS, initialState)) {
      throw new PocketRelayProtocolError("STATE_INVALID", `unknown initial state ${initialState}`);
    }
    this.clock = clock;
    this.state = initialState;
    this.history = [{ state: initialState, at: this.#timestamp(), reason: "created" }];
  }

  transition(to, reason) {
    if (to === this.state) return this.snapshot();
    if (!canTransitionPocketRelayState(this.state, to)) {
      throw new PocketRelayProtocolError(
        "STATE_TRANSITION_DENIED",
        `cannot transition Pocket Relay state from ${this.state} to ${to}`,
        409,
        { from: this.state, to }
      );
    }
    this.state = to;
    this.history.push({
      state: to,
      at: this.#timestamp(),
      reason: String(reason || "state_changed").slice(0, 160)
    });
    return this.snapshot();
  }

  snapshot() {
    return {
      state: this.state,
      history: this.history.map((entry) => ({ ...entry }))
    };
  }

  #timestamp() {
    const value = this.clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}
