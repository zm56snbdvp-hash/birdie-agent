import type { ShotInput, ShotResult } from "./shot-engine.ts";

/** Presentation only. Coordinates are in metres in the engine's current-shot
 * frame: x = lateral, z = forward, y = cosmetic height. Never resolves a shot. */
export interface CourseShot {
  readonly id: string;
  readonly holeId: number;
  readonly remainingBefore: number;
  readonly putt: boolean;
  readonly result: Readonly<ShotResult>;
  readonly swingMs: number;
  readonly flightMs: number;
  readonly settleMs: number;
  readonly totalMs: number;
  readonly apex: number;
}
export interface FlightFrame {
  x: number; y: number; z: number; opacity: number;
  phase: "swing" | "flight" | "roll" | "penalty" | "done";
  progress: number;
}
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 2;
const prepared = new WeakSet<object>();

function finite(n: number, label: string, nonnegative = false) {
  if (!Number.isFinite(n) || Math.abs(n) > 10000 || (nonnegative && n < 0)) {
    throw new RangeError(`Invalid course presentation value: ${label}`);
  }
}

/** Call ONCE with the result the existing engine already returned, using the
 * host's stable shot ID. The renderer never calls simulateShot or writes state. */
export function prepareCourseShot(id: string, input: ShotInput, result: ShotResult): CourseShot {
  if (typeof id !== "string" || !id.trim() || id.length > 200) throw new TypeError("A stable shot ID is required");
  finite(input.remaining, "remaining before", true);
  if (input.remaining === 0) throw new RangeError("Cannot present a shot from a completed hole");
  if (!Number.isInteger(input.hole.id) || input.hole.id < 1 || input.hole.id > 6) throw new RangeError("Unknown hole");
  if (!["DRIVER", "HYBRID", "WEDGE", "PUTTER"].includes(input.club.kind)) throw new TypeError("Unknown club kind");
  for (const key of ["carry", "roll", "remaining", "penalty"] as const) finite(result[key], key, true);
  for (const key of ["flightForward", "flightLateral", "positionForward", "positionLateral"] as const) finite(result[key], key);
  if (result.breakLateral !== undefined) finite(result.breakLateral, "breakLateral");
  if (!Number.isInteger(result.penalty) || typeof result.holed !== "boolean") throw new TypeError("Invalid result state");
  if (!["TEE", "FAIRWAY", "ROUGH", "BUNKER", "GREEN", "HOLED"].includes(result.lie)) throw new TypeError("Unknown lie");
  const putt = input.club.kind === "PUTTER";
  const groundDistance = Math.hypot(result.positionForward - result.flightForward, result.positionLateral - result.flightLateral);
  const swingMs = 240;
  const flightMs = putt ? 0 : clamp(850 + result.carry * 5, 850, 2350);
  const settleMs = result.penalty > 0 ? 600 : putt ? clamp(850 + result.roll * 42, 850, 2000) : groundDistance < .001 ? 0 : clamp(350 + groundDistance * 25, 350, 1400);
  const shot: CourseShot = Object.freeze({
    id, holeId: input.hole.id, remainingBefore: input.remaining, putt,
    result: Object.freeze({ ...result }), swingMs, flightMs, settleMs,
    totalMs: swingMs + flightMs + settleMs,
    apex: putt ? 0 : clamp(result.carry * (input.club.kind === "WEDGE" ? .22 : .13), 3, 34),
  });
  prepared.add(shot);
  return shot;
}

export function isPreparedCourseShot(value: unknown): value is CourseShot {
  return typeof value === "object" && value !== null && prepared.has(value);
}

export function sampleCourseShot(shot: CourseShot, elapsedMs: number, reducedMotion = false): FlightFrame {
  if (!isPreparedCourseShot(shot)) throw new TypeError("Use prepareCourseShot before playback");
  if (!Number.isFinite(elapsedMs)) throw new RangeError("Non-finite animation time");
  const r = shot.result;
  const time = Math.max(0, elapsedMs);
  const progress = clamp(time / shot.totalMs, 0, 1);
  // Exact engine endpoint, including water drops and hole-outs. No recomputation.
  if (reducedMotion || time >= shot.totalMs) return { x: r.positionLateral, y: 0, z: r.positionForward, opacity: r.holed ? 0 : 1, phase: "done", progress: 1 };
  if (time < shot.swingMs) return { x: 0, y: 0, z: 0, opacity: 1, phase: "swing", progress };
  const airborneTime = time - shot.swingMs;
  if (!shot.putt && airborneTime < shot.flightMs) {
    const t = airborneTime / shot.flightMs;
    return { x: r.flightLateral * t * t, y: 4 * shot.apex * t * (1 - t), z: r.flightForward * t, opacity: 1, phase: "flight", progress };
  }
  const t = clamp((airborneTime - shot.flightMs) / Math.max(1, shot.settleMs), 0, 1);
  // A penalty is a fade at the impact, then an official drop, NOT a backwards roll.
  if (r.penalty > 0) return { x: r.flightLateral, y: 0, z: r.flightForward, opacity: 1 - t, phase: "penalty", progress };
  const p = easeOut(t);
  const breakArc = shot.putt ? (r.breakLateral ?? 0) * Math.sin(Math.PI * t) * .35 : 0;
  const bounce = !shot.putt && t < .3 ? Math.sin(Math.PI * t / .3) * Math.min(1.4, shot.apex * .045) : 0;
  return { x: mix(shot.putt ? 0 : r.flightLateral, r.positionLateral, p) + breakArc, y: bounce,
    z: mix(shot.putt ? 0 : r.flightForward, r.positionForward, p), opacity: r.holed ? 1 - t ** 8 : 1, phase: "roll", progress };
}
