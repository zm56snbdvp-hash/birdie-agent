function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("crypto.randomUUID() is required");
}

function rows(result) {
  return result?.results ?? [];
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function momentFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    roundId: row.round_id,
    momentType: row.moment_type,
    status: row.status,
    generatedAt: row.generated_at,
    templateVersion: row.template_version,
    renderData: parseJson(row.render_data, {}),
    previewAsset: row.preview_asset,
    digitalAsset: row.digital_asset,
    printAsset: row.print_asset,
    isPersonalBest: Boolean(row.is_personal_best),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeFailureSummary(failure) {
  const raw = String(failure?.summary ?? failure?.message ?? "Unknown error").slice(0, 200);
  return raw
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk|pk|whsec|Bearer)[-_A-Za-z0-9]{8,}\b/g, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]");
}

/**
 * Minimal Cloudflare D1 repository for the Founder-Delta Birdie Moments Digital v1 flow.
 *
 * This repository intentionally owns only Birdie Moments persistence. The existing
 * BirdieWorld round store remains injected through roundSource and is never guessed
 * from recovered browser code.
 *
 * No purchase, payment, StoreKit or entitlement method is implemented here because
 * the active Digital v1 flow is free/private rather than commerce-gated.
 *
 * Failure persistence is intentionally aligned with the canonical TASK-142
 * db/004_moment_telemetry.sql schema (summary + occurred_at). TASK-143 must not
 * create a second moment_failures table shape.
 */
export function createD1FreeDigitalMomentsRepository({
  db,
  roundSource,
  idFactory = defaultIdFactory,
  now = () => new Date().toISOString()
}) {
  if (!db?.prepare) throw new TypeError("A Cloudflare D1 binding is required");
  if (!roundSource?.getRound || !roundSource?.listPreviousComparableRounds) {
    throw new TypeError("roundSource.getRound/listPreviousComparableRounds are required");
  }

  const repo = {
    async getRound(roundId) {
      return roundSource.getRound(roundId);
    },

    async listPreviousComparableRounds(query) {
      return roundSource.listPreviousComparableRounds(query);
    },

    async ensureMoment(input) {
      const id = idFactory();
      const timestamp = now();
      await db.prepare(`
        INSERT OR IGNORE INTO birdie_moments (
          id,user_id,round_id,moment_type,status,generated_at,template_version,render_data,
          preview_asset,digital_asset,print_asset,is_personal_best,created_at,updated_at
        ) VALUES (?1,?2,?3,?4,?5,NULL,?6,?7,NULL,NULL,NULL,?8,?9,?9)
      `).bind(
        id,
        input.userId,
        input.roundId,
        input.momentType,
        input.status,
        input.templateVersion,
        JSON.stringify(input.renderData ?? {}),
        input.isPersonalBest ? 1 : 0,
        timestamp
      ).run();

      const row = await db.prepare(`
        SELECT * FROM birdie_moments
        WHERE round_id=?1 AND moment_type=?2 AND template_version=?3
        LIMIT 1
      `).bind(input.roundId, input.momentType, input.templateVersion).first();
      return momentFromRow(row);
    },

    async getMoment(momentId) {
      return momentFromRow(
        await db.prepare("SELECT * FROM birdie_moments WHERE id=?1 LIMIT 1")
          .bind(momentId)
          .first()
      );
    },

    async listMomentsForRound(roundId) {
      const result = await db.prepare(`
        SELECT * FROM birdie_moments
        WHERE round_id=?1
        ORDER BY created_at ASC
      `).bind(roundId).all();
      return rows(result).map(momentFromRow);
    },

    async listMomentsForUser(userId) {
      const result = await db.prepare(`
        SELECT * FROM birdie_moments
        WHERE user_id=?1
        ORDER BY created_at DESC
      `).bind(userId).all();
      return rows(result).map(momentFromRow);
    },

    async setMomentStatus(momentId, status) {
      await db.prepare(`
        UPDATE birdie_moments
        SET status=?1, updated_at=?2
        WHERE id=?3
      `).bind(status, now(), momentId).run();
      return repo.getMoment(momentId);
    },

    async markMomentPreviewReady({ momentId, generatedAt, previewAsset, digitalAsset, printAsset = null }) {
      await db.prepare(`
        UPDATE birdie_moments
        SET status='PREVIEW_READY', generated_at=?1, preview_asset=?2,
            digital_asset=?3, print_asset=?4, updated_at=?1
        WHERE id=?5
      `).bind(generatedAt, previewAsset, digitalAsset, printAsset, momentId).run();
      return repo.getMoment(momentId);
    },

    async markMomentFailed({ momentId, error }) {
      const timestamp = now();
      await db.prepare(`
        UPDATE birdie_moments
        SET status='FAILED', updated_at=?1
        WHERE id=?2
      `).bind(timestamp, momentId).run();

      await repo.recordMomentFailure({
        stage: "RENDERING",
        code: error?.code ?? error?.name ?? "RENDER_FAILED",
        message: String(error?.message ?? error),
        momentId,
        at: timestamp
      });
      return repo.getMoment(momentId);
    },

    async recordMomentEvaluationFailure({ roundId, stage = "EVALUATION", error }) {
      return repo.recordMomentFailure({
        stage,
        code: error?.code ?? error?.name ?? "EVALUATION_FAILED",
        message: String(error?.message ?? error),
        roundId
      });
    },

    async recordMomentFailure(failure) {
      const id = idFactory();
      const occurredAt = failure.at ?? failure.occurredAt ?? now();
      await db.prepare(`
        INSERT INTO moment_failures (
          id,stage,code,summary,round_id,moment_id,purchase_id,product_type,fulfillment_type,occurred_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      `).bind(
        id,
        failure.stage ?? "UNKNOWN",
        failure.code ?? "UNKNOWN_ERROR",
        safeFailureSummary(failure),
        failure.roundId ?? null,
        failure.momentId ?? null,
        failure.purchaseId ?? null,
        failure.productType ?? null,
        failure.fulfillmentType ?? null,
        occurredAt
      ).run();
      return id;
    }
  };

  return repo;
}
