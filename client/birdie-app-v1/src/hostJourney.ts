import type { BirdieWorldDestination } from "./birdieDestinations";

export const BIRDIE_HOST_JOURNEY_VERSION = "birdie-as-host-v0.2" as const;

export const BIRDIE_HOST_JOURNEY_STAGES = [
  "noticed",
  "welcomed",
  "oriented",
  "invited",
  "return-to-birdie"
] as const;

export type BirdieHostJourneyStage =
  (typeof BIRDIE_HOST_JOURNEY_STAGES)[number];

export interface BirdieHostJourneyState {
  contractVersion: typeof BIRDIE_HOST_JOURNEY_VERSION;
  stage: BirdieHostJourneyStage;
  lastDestination: BirdieWorldDestination | null;
}

export const INITIAL_BIRDIE_HOST_JOURNEY: BirdieHostJourneyState =
  Object.freeze({
    contractVersion: BIRDIE_HOST_JOURNEY_VERSION,
    stage: "noticed",
    lastDestination: null
  });

export function advanceBirdieHostJourney(
  state: BirdieHostJourneyState,
  stage: BirdieHostJourneyStage,
  destination: BirdieWorldDestination | null = state.lastDestination
): BirdieHostJourneyState {
  if (state.stage === stage && state.lastDestination === destination) {
    return state;
  }
  return {
    ...state,
    stage,
    lastDestination: destination
  };
}

export function inviteFromBirdie(
  state: BirdieHostJourneyState,
  destination: BirdieWorldDestination
): BirdieHostJourneyState {
  return advanceBirdieHostJourney(state, "invited", destination);
}

export function returnToBirdieHost(
  state: BirdieHostJourneyState
): BirdieHostJourneyState {
  return advanceBirdieHostJourney(state, "return-to-birdie");
}
