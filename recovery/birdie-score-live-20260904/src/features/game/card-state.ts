import { CARD_BY_ID, type CanonicalCard } from "../../domain/card-catalog";

export interface GameCardState {
  drawPileIds: string[];
  handIds: string[];
  installedClubIds: string[];
  installedBallIds: string[];
  discardIds: string[];
}

export interface GameLoadoutCards {
  clubs: readonly Pick<CanonicalCard, "id">[];
  balls: readonly Pick<CanonicalCard, "id">[];
  actions: readonly Pick<CanonicalCard, "id">[];
}

export interface DrawResolution { actionIds: string[]; installedClubIds: string[]; installedBallIds: string[]; }

function emptyResolution(): DrawResolution { return { actionIds: [], installedClubIds: [], installedBallIds: [] }; }
function mergeResolution(target: DrawResolution, source: DrawResolution): DrawResolution {
  target.actionIds.push(...source.actionIds);
  target.installedClubIds.push(...source.installedClubIds);
  target.installedBallIds.push(...source.installedBallIds);
  return target;
}

/**
 * Exact recovered draw semantics from GameApp:
 * CLUB/BALL auto-install and immediately draw a replacement; SPIN/TACTIC enter the hand.
 * Unknown/non-playable IDs fail closed and never become another family.
 */
export function drawOneResolved(state: GameCardState): DrawResolution {
  const resolution = emptyResolution();
  const id = state.drawPileIds.shift();
  if (!id) return resolution;
  const card = CARD_BY_ID.get(id);
  if (!card) return resolution;

  if (card.family === "CLUB") {
    if (!state.installedClubIds.includes(id)) { state.installedClubIds.push(id); resolution.installedClubIds.push(id); }
    return mergeResolution(resolution, drawOneResolved(state));
  }
  if (card.family === "BALL") {
    if (!state.installedBallIds.includes(id)) { state.installedBallIds.push(id); resolution.installedBallIds.push(id); }
    return mergeResolution(resolution, drawOneResolved(state));
  }
  if (card.family === "SPIN" || card.family === "TACTIC") {
    state.handIds.push(id);
    resolution.actionIds.push(id);
  }
  return resolution;
}

export function fillActionHand(state: GameCardState, targetSize = 5): DrawResolution {
  const total = emptyResolution();
  while (state.handIds.length < targetSize && state.drawPileIds.length > 0) mergeResolution(total, drawOneResolved(state));
  return total;
}

export function drawAtHoleStart(state: GameCardState): DrawResolution { return drawOneResolved(state); }

export function createInitialGameCardState(loadout: GameLoadoutCards): GameCardState {
  const state: GameCardState = {
    drawPileIds: [...loadout.clubs.map((card) => card.id), ...loadout.balls.map((card) => card.id), ...loadout.actions.map((card) => card.id)],
    handIds: [], installedClubIds: [], installedBallIds: [], discardIds: [],
  };
  fillActionHand(state, 5);
  return state;
}

export function consumeActionCards(state: GameCardState, ids: readonly string[]): void {
  const consumed = new Set(ids);
  const discarded = state.handIds.filter((id) => consumed.has(id));
  state.handIds = state.handIds.filter((id) => !consumed.has(id));
  state.discardIds.push(...discarded);
}
