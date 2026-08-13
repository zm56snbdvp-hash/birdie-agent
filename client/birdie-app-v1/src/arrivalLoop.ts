import {
  getBirdieDestination,
  type BirdieWorldDestination
} from "./birdieDestinations";

export const BIRDIE_ARRIVAL_LOOP_VERSION = "birdie-arrival-loop-v0.1" as const;

export interface BirdieArrivalLoopState {
  contractVersion: typeof BIRDIE_ARRIVAL_LOOP_VERSION;
  phase: "ready" | "arrived" | "returned";
  activeDestination: BirdieWorldDestination | null;
  lastDestination: BirdieWorldDestination | null;
  arrivalCount: number;
}

export const INITIAL_BIRDIE_ARRIVAL_LOOP: BirdieArrivalLoopState = Object.freeze({
  contractVersion: BIRDIE_ARRIVAL_LOOP_VERSION,
  phase: "ready",
  activeDestination: null,
  lastDestination: null,
  arrivalCount: 0
});

export function arriveAtBirdieDestination(
  state: BirdieArrivalLoopState,
  destination: BirdieWorldDestination
): BirdieArrivalLoopState {
  return {
    ...state,
    phase: "arrived",
    activeDestination: destination,
    lastDestination: destination,
    arrivalCount: state.arrivalCount + 1
  };
}

export function returnFromBirdieDestination(
  state: BirdieArrivalLoopState
): BirdieArrivalLoopState {
  return {
    ...state,
    phase: "returned",
    activeDestination: null
  };
}

export function getBirdieArrivalCopy(destination: BirdieWorldDestination) {
  const definition = getBirdieDestination(destination);
  return {
    eyebrow: "Du bist angekommen",
    title: definition.title,
    copy: `${definition.description} Birdie wartet am Ausgangspunkt, wenn du weiterziehen möchtest.`
  } as const;
}
