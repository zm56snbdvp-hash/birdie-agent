export const TurnStatus = Object.freeze({
  CREATED: 'CREATED',
  CAPTURING: 'CAPTURING',
  PROCESSING: 'PROCESSING',
  OUTPUTTING: 'OUTPUTTING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
});

const TERMINAL = new Set([
  TurnStatus.COMPLETED,
  TurnStatus.CANCELLED,
  TurnStatus.FAILED,
  TurnStatus.INTERRUPTED,
]);

export class TurnManager {
  constructor() {
    this.turns = new Map();
    this.activeTurnId = null;
  }

  create(turnId, meta = {}) {
    if (!turnId) throw new Error('TURN.ID_REQUIRED');
    if (this.turns.has(turnId)) return this.turns.get(turnId);
    const turn = { id: turnId, status: TurnStatus.CREATED, createdAt: meta.timestampUtc ?? new Date().toISOString() };
    this.turns.set(turnId, turn);
    this.activeTurnId = turnId;
    return turn;
  }

  transition(turnId, status) {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error(`TURN.UNKNOWN:${turnId}`);
    if (TERMINAL.has(turn.status)) throw new Error(`TURN.STALE_EVENT:${turnId}`);
    turn.status = status;
    if (TERMINAL.has(status) && this.activeTurnId === turnId) this.activeTurnId = null;
    return turn;
  }

  isCurrent(turnId) {
    return Boolean(turnId) && this.activeTurnId === turnId && !TERMINAL.has(this.turns.get(turnId)?.status);
  }

  assertCurrent(turnId) {
    if (!this.isCurrent(turnId)) throw new Error(`TURN.STALE_EVENT:${turnId ?? 'null'}`);
  }

  get(turnId) {
    return this.turns.get(turnId) ?? null;
  }
}
