import { resolveUnityPlayerFromCanonicalProfiles } from "./birdieworld-unity-identity.mjs";

const WALLET_SCHEMA_VERSION = "birdieworld-wallet-projection/v1";

function asTrimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asSafeInteger(value, field) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`WALLET_INVALID_${field.toUpperCase()}`);
  }
  return n;
}

function normalizeBinding(binding) {
  return {
    unityPlayerId: asTrimmed(binding?.unityPlayerId),
    birdieId: asTrimmed(binding?.birdieId),
    status: asTrimmed(binding?.status).toUpperCase(),
  };
}

export function resolveExactUnityBirdieBinding({ unityPlayerId, bindings = [] } = {}) {
  const playerId = asTrimmed(unityPlayerId);
  if (!playerId) {
    return { status: "UNBOUND", birdieId: null, reason: "UNITY_PLAYER_ID_MISSING" };
  }

  const matches = bindings
    .map(normalizeBinding)
    .filter((binding) => binding.unityPlayerId === playerId && binding.status === "ACTIVE" && binding.birdieId);

  const uniqueBirdieIds = [...new Set(matches.map((binding) => binding.birdieId))];
  if (matches.length === 0) return { status: "UNBOUND", birdieId: null, reason: "NO_ACTIVE_EXACT_BINDING" };
  if (matches.length !== 1 || uniqueBirdieIds.length !== 1) {
    const error = new Error("UNITY_BIRDIE_BINDING_CONFLICT");
    error.code = "UNITY_BIRDIE_BINDING_CONFLICT";
    error.unityPlayerId = playerId;
    error.birdieIds = uniqueBirdieIds;
    throw error;
  }
  return { status: "BOUND", birdieId: uniqueBirdieIds[0], reason: "EXACT_ACTIVE_UNITY_PLAYER_BINDING" };
}

function canonicalTransaction(transaction) {
  return {
    transactionId: asTrimmed(transaction?.transactionId), birdieId: asTrimmed(transaction?.birdieId),
    amount: asSafeInteger(transaction?.amount, "amount"), transactionType: asTrimmed(transaction?.transactionType).toUpperCase(),
    actionCode: asTrimmed(transaction?.actionCode).toUpperCase(), sourceType: asTrimmed(transaction?.sourceType).toUpperCase(),
    sourceReference: asTrimmed(transaction?.sourceReference), status: asTrimmed(transaction?.status).toUpperCase(),
  };
}
function transactionFingerprint(t) { return JSON.stringify([t.transactionId,t.birdieId,t.amount,t.transactionType,t.actionCode,t.sourceType,t.sourceReference,t.status]); }

export function projectApprovedLedgerBalance({ birdieId, transactions = [] } = {}) {
  const targetBirdieId = asTrimmed(birdieId);
  if (!targetBirdieId) throw new Error("WALLET_BIRDIE_ID_REQUIRED");
  const byId = new Map();
  for (const raw of transactions) {
    const transaction = canonicalTransaction(raw);
    if (!transaction.transactionId) throw new Error("WALLET_TRANSACTION_ID_REQUIRED");
    const prior = byId.get(transaction.transactionId);
    if (prior) {
      if (transactionFingerprint(prior) !== transactionFingerprint(transaction)) {
        const error = new Error("WALLET_TRANSACTION_CONFLICT"); error.code = "WALLET_TRANSACTION_CONFLICT"; error.transactionId = transaction.transactionId; throw error;
      }
      continue;
    }
    byId.set(transaction.transactionId, transaction);
  }
  const applied = [...byId.values()].filter((t) => t.birdieId === targetBirdieId && t.status === "APPROVED").sort((a,b)=>a.transactionId.localeCompare(b.transactionId));
  let balance = 0;
  for (const transaction of applied) { balance += transaction.amount; if (!Number.isSafeInteger(balance)) throw new Error("WALLET_BALANCE_OVERFLOW"); }
  return { schemaVersion: WALLET_SCHEMA_VERSION, birdieId: targetBirdieId, balance, currency: "BIRDIE_COIN", authority: "COIN_TRANSACTIONS", projectionMode: "SUM_APPROVED_TRANSACTION_AMOUNTS", appliedTransactionIds: applied.map((t)=>t.transactionId), transactionCount: applied.length, readOnly: true };
}

function unavailableProjection(unityPlayerId, binding) {
  return { schemaVersion: WALLET_SCHEMA_VERSION, subject:{unityPlayerId:asTrimmed(unityPlayerId)||null}, identityStatus:binding.status, identityReason:binding.reason, birdieId:null, balanceAvailable:false, balance:null, currency:"BIRDIE_COIN", authority:"COIN_TRANSACTIONS", readOnly:true };
}

function walletProjection(unityPlayerId, binding, transactions) {
  if (binding.status !== "BOUND") return unavailableProjection(unityPlayerId, binding);
  const wallet = projectApprovedLedgerBalance({ birdieId: binding.birdieId, transactions });
  return { ...wallet, subject:{unityPlayerId:asTrimmed(unityPlayerId)}, identityStatus:"BOUND", identityReason:binding.reason, balanceAvailable:true };
}

export function buildUnityWalletProjection({ unityPlayerId, bindings = [], transactions = [] } = {}) {
  return walletProjection(unityPlayerId, resolveExactUnityBirdieBinding({ unityPlayerId, bindings }), transactions);
}

export function buildUnityWalletProjectionFromCanonicalProfiles({ unityPlayerId, profiles = [], transactions = [] } = {}) {
  return walletProjection(unityPlayerId, resolveUnityPlayerFromCanonicalProfiles({ unityPlayerId, profiles }), transactions);
}
export { WALLET_SCHEMA_VERSION };
