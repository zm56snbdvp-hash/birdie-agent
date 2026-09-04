export type ShotModeId = "CONTROL" | "STANDARD" | "ATTACK";
export type TimingGrade = "PERFECT" | "GOOD" | "EARLY" | "LATE" | "ERROR";
export type Lie = "TEE" | "FAIRWAY" | "ROUGH" | "BUNKER" | "GREEN" | "HOLED";
export type ClubKind = "DRIVER" | "HYBRID" | "WEDGE" | "PUTTER";
export type ShotCurve = "DRAW" | "FADE";
export type HoleHazard = "CROSSWIND" | "TREE_GATE" | "WATER_CARRY" | "BUNKER_JAWS" | "BREAKING_GREEN" | "FALSE_FRONT";

export interface EnginePlayer { power: number; precision: number; control: number; recovery: number; focus: number; }
export interface EngineClub { id?: string; name?: string; kind: ClubKind; w: number; p: number; k: number; allowedLies?: readonly Lie[]; }
export interface EngineBall { id?: string; name?: string; power?: number; precision?: number; control?: number; roll?: number; windReduction?: number; }
export interface EngineAction { family?: "SPIN" | "TACTIC"; name?: string; power?: number; precision?: number; control?: number; roll?: number; windReduction?: number; perfectWindow?: number; curve?: ShotCurve; teeOnly?: boolean; afterFirstShot?: boolean; blockSpin?: boolean; }
export interface CourseHole { id: number; name: string; subtitle: string; par: number; distance: number; windAlong: number; windCross: number; breakLevel: number; hazard: HoleHazard; twist: string; rule: string; palette: string; }
export interface ShotInput { remaining: number; lie: Lie; strokeNumber: number; player: EnginePlayer; club: EngineClub; ball?: EngineBall; hole: CourseHole; timingMeter: number; spin?: EngineAction | null; tactic?: EngineAction | null; mode?: ShotModeId; aimLateral?: number; targetDistance?: number; signature?: boolean; }
export interface ShotResult { grade: TimingGrade; carry: number; maxCarry: number; requestedCarry: number; underReach: boolean; flightForward: number; flightLateral: number; positionForward: number; positionLateral: number; roll: number; lateral: number; remaining: number; lie: Lie; holed: boolean; label: string; detail: string; curve: string; penalty: number; hazardLabel?: string; hazardDetail?: string; breakLateral?: number; }

export const COURSE_HOLES: readonly CourseHole[] = [
  { id: 1, name: "Emerald Opening", subtitle: "Founding Course", par: 4, distance: 338, windAlong: 0, windCross: 1, breakLevel: 1, hazard: "CROSSWIND", twist: "Crosswind", rule: "Der Seitenwind verschiebt jede lange Fluglinie sichtbar.", palette: "emerald" },
  { id: 2, name: "Pine Needle Bend", subtitle: "North Loop", par: 4, distance: 365, windAlong: 0, windCross: 2, breakLevel: -1, hazard: "TREE_GATE", twist: "Tree Gate", rule: "Schlechtes Timing am Tee bleibt in der Baumlinie hängen.", palette: "pine" },
  { id: 3, name: "Glasswater", subtitle: "Mirror Nine", par: 3, distance: 148, windAlong: -1, windCross: 0, breakLevel: 2, hazard: "WATER_CARRY", twist: "Water Carry", rule: "Ein Timing-Fehler am Abschlag kostet einen Strafschlag.", palette: "glass" },
  { id: 4, name: "Founder's Hollow", subtitle: "Founding Course", par: 5, distance: 480, windAlong: 1, windCross: -1, breakLevel: -2, hazard: "BUNKER_JAWS", twist: "Bunker Jaws", rule: "Nur ein perfekter Green-Angriff entgeht den Bunkerzähnen.", palette: "amber" },
  { id: 5, name: "Golden Dunes", subtitle: "Crown Reserve", par: 4, distance: 354, windAlong: 0, windCross: -2, breakLevel: 1, hazard: "BREAKING_GREEN", twist: "Breaking Green", rule: "Nicht perfekte Approaches laufen 3,5 m mit dem Hang.", palette: "dune" },
  { id: 6, name: "Crown Green", subtitle: "Finale", par: 3, distance: 176, windAlong: -1, windCross: 1, breakLevel: 3, hazard: "FALSE_FRONT", twist: "False Front", rule: "Early, Late oder Error werden vom vorderen Grün abgewiesen.", palette: "crown" },
];

export const TARGET_STROKES = [4, 5, 3, 6, 4, 3] as const;
export const ACTION_FAMILY_LABELS = { SPIN: "SPIN", TACTIC: "TAKTIK" } as const;
export const BASE_CARRY: Readonly<Record<ClubKind, number>> = { DRIVER: 214, HYBRID: 148, WEDGE: 82, PUTTER: 14 };
export const BASE_ROLL: Readonly<Record<ClubKind, number>> = { DRIVER: 21, HYBRID: 10, WEDGE: 3, PUTTER: 0 };
export const SHOT_MODES = { CONTROL: { carryFactor: 0.88, precision: 2, control: 1, perfectWindow: 3 }, STANDARD: { carryFactor: 1, precision: 0, control: 0, perfectWindow: 0 }, ATTACK: { carryFactor: 1.12, precision: -2, control: -2, perfectWindow: -2 } } as const;

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function round1(value: number): number { return Math.round(value * 10) / 10; }

export function timingGrade(timingMeter: number, perfectWindowModifier = 0): TimingGrade {
  const offset = timingMeter - 50;
  const absoluteOffset = Math.abs(offset);
  const perfectWindow = clamp(4 + perfectWindowModifier, 1, 18);
  const goodWindow = clamp(14 + perfectWindowModifier * 0.45, perfectWindow + 4, 36);
  return absoluteOffset <= perfectWindow ? "PERFECT" : absoluteOffset <= goodWindow ? "GOOD" : absoluteOffset <= 36 ? offset < 0 ? "EARLY" : "LATE" : "ERROR";
}

export function legalClubs(remaining: number, lie: Lie, clubs: readonly EngineClub[]): EngineClub[] {
  const fallbackKinds: readonly ClubKind[] = lie === "TEE" ? ["DRIVER", "HYBRID", "WEDGE"] : lie === "GREEN" ? ["PUTTER"] : lie === "BUNKER" ? ["WEDGE"] : lie === "ROUGH" ? ["HYBRID", "WEDGE"] : remaining <= 18 ? ["WEDGE", "PUTTER"] : ["HYBRID", "WEDGE"];
  return clubs.filter((club) => club.allowedLies ? club.allowedLies.includes(lie) : fallbackKinds.includes(club.kind));
}

export function recommendedClub(remaining: number, lie: Lie, clubs: readonly EngineClub[]): EngineClub | undefined {
  const kind: ClubKind = lie === "GREEN" ? "PUTTER" : lie === "BUNKER" ? "WEDGE" : lie === "ROUGH" ? remaining <= 92 ? "WEDGE" : "HYBRID" : lie === "FAIRWAY" ? remaining <= 15 ? "PUTTER" : remaining <= 92 ? "WEDGE" : "HYBRID" : remaining <= 92 ? "WEDGE" : remaining <= 205 ? "HYBRID" : "DRIVER";
  return clubs.find((club) => club.kind === kind) ?? clubs[0];
}

export function simulateShot(input: ShotInput): ShotResult {
  const actions = [input.spin, input.tactic].filter(Boolean).filter((action) => !action!.teeOnly || input.lie === "TEE").filter((action) => !action!.afterFirstShot || input.strokeNumber > 1) as EngineAction[];
  const mode = SHOT_MODES[input.mode ?? "STANDARD"];
  const perfectWindowModifier = actions.reduce((sum, action) => sum + (action.perfectWindow ?? 0), 0) + mode.perfectWindow;
  const oneRead = Boolean(input.signature && input.club.kind === "PUTTER" && input.lie === "GREEN" && input.remaining <= 15 + input.player.focus * 0.2);
  const grade: TimingGrade = oneRead ? "PERFECT" : timingGrade(input.timingMeter, perfectWindowModifier);

  if (oneRead) return { grade, carry: 0, maxCarry: round1(15 + input.player.focus * 0.2), requestedCarry: round1(input.remaining), underReach: false, flightForward: 0, flightLateral: 0, positionForward: round1(input.remaining), positionLateral: 0, roll: round1(input.remaining), lateral: 0, remaining: 0, lie: "HOLED", holed: true, label: "ONE READ — EINGELOCHT", detail: `${round1(input.remaining)} m · Lee-Ann liest die Linie perfekt`, curve: "M120 312 C260 250 402 150 548 72", penalty: 0, breakLateral: 0 };

  const actionPower = actions.reduce((sum, action) => sum + (action.power ?? 0), 0);
  const actionPrecision = actions.reduce((sum, action) => sum + (action.precision ?? 0), 0);
  const actionControl = actions.reduce((sum, action) => sum + (action.control ?? 0), 0);
  const actionRoll = actions.reduce((sum, action) => sum + (action.roll ?? 0), 0);
  const windReduction = actions.reduce((sum, action) => sum + (action.windReduction ?? 0), 0) + (input.ball?.windReduction ?? 0);
  const power = clamp(input.player.power + input.club.w + actionPower + (input.ball?.power ?? 0), 1, 16);
  const precision = clamp(input.player.precision + input.club.p + 1 + actionPrecision + (input.ball?.precision ?? 0) + mode.precision, 1, 18);
  const control = clamp(input.player.control + input.club.k + actionControl + (input.ball?.control ?? 0) + mode.control, 1, 18);
  const lieMultiplier = input.lie === "ROUGH" ? 0.78 + input.player.recovery * 0.018 : input.lie === "BUNKER" ? 0.61 + input.player.recovery * 0.02 : 1;
  const gradeCarryMultiplier: Record<TimingGrade, number> = { PERFECT: 1, GOOD: 0.965, EARLY: 0.91, LATE: 0.91, ERROR: 0.78 };
  const windAlongFactor = 1 + Math.sign(input.hole.windAlong) * Math.max(0, Math.abs(input.hole.windAlong) - windReduction) * 0.025;

  if (input.club.kind === "PUTTER") {
    const holeReachByGrade: Record<TimingGrade, number> = { PERFECT: 15 + input.player.focus * 0.2, GOOD: 9 + input.player.focus * 0.16, EARLY: 3.2, LATE: 3.2, ERROR: 1.2 };
    const maxReach = 15 + input.player.focus * 0.2;
    const residualBreak = Math.max(0, Math.abs(input.hole.breakLevel) - Math.floor(control / 7));
    const aimLateral = input.aimLateral ?? 0;
    const breakLateral = Math.sign(input.hole.breakLevel) * residualBreak * 0.55;
    const timingOffset = input.timingMeter - 50;
    const requestedForward = clamp(input.targetDistance ?? input.remaining, 0.1, Math.min(17, input.remaining + 3));
    const requestedDistance = Math.hypot(requestedForward, aimLateral);
    const reachScale = Math.min(1, maxReach / Math.max(0.6, requestedDistance));
    const scaledForward = requestedForward * reachScale;
    const scaledAim = aimLateral * reachScale;
    const lateral = timingOffset * 0.025 + breakLateral + scaledAim;
    const positionForward = scaledForward * ({ PERFECT: 1, GOOD: 0.985, EARLY: 0.86, LATE: 1.12, ERROR: 0.62 } as const)[grade];
    const forwardError = Math.abs(input.remaining - positionForward);
    const holed = input.remaining <= holeReachByGrade[grade] && forwardError <= 0.45 && Math.abs(lateral) <= 0.42;
    const remaining = holed ? 0 : Math.max(0.4, Math.hypot(forwardError, lateral));
    return { grade, carry: 0, maxCarry: round1(maxReach), requestedCarry: round1(requestedDistance), underReach: requestedDistance > maxReach, flightForward: 0, flightLateral: 0, positionForward: round1(positionForward), positionLateral: round1(lateral), roll: round1(positionForward), lateral: holed ? 0 : round1(lateral), remaining: round1(remaining), lie: holed ? "HOLED" : "GREEN", holed, label: holed ? "PUTT FÄLLT" : "KNAPP VORBEI", detail: `${grade} · ${holed ? "mittig ins Loch" : `${round1(remaining)} m verbleiben`}`, curve: "M120 312 C260 266 404 146 548 72", penalty: 0, breakLateral: round1(breakLateral) };
  }

  const maxCarryRaw = BASE_CARRY[input.club.kind] * (0.77 + power * 0.027) * mode.carryFactor * lieMultiplier * windAlongFactor;
  const targetForward = clamp(input.targetDistance ?? maxCarryRaw, 1, input.remaining + 25);
  const aimLateral = input.aimLateral ?? 0;
  const requestedDistance = Math.hypot(targetForward, aimLateral);
  const carryScale = Math.min(1, maxCarryRaw / Math.max(1, requestedDistance));
  const crosswind = Math.sign(input.hole.windCross) * Math.max(0, Math.abs(input.hole.windCross) - windReduction);
  const timingNormalized = (input.timingMeter - 50) / 50;
  const curve = actions.find((action) => action.curve)?.curve;
  const curveBias = curve === "DRAW" ? -2.8 : curve === "FADE" ? 2.8 : 0;
  const lateralError = timingNormalized * (13 - precision * 0.5) + crosswind * 2.1 + curveBias;
  let flightForward = targetForward * carryScale * gradeCarryMultiplier[grade];
  let flightLateral = aimLateral * carryScale * gradeCarryMultiplier[grade] + lateralError;
  let carry = Math.hypot(flightForward, flightLateral);
  let roll = Math.max(0, BASE_ROLL[input.club.kind] + actionRoll + (input.ball?.roll ?? 0) - control * 0.28);
  let positionForward = 0, positionLateral = 0, overshoot = 0, remaining = 0;
  const projectRoll = () => { const distance = Math.max(0.001, Math.hypot(flightForward, flightLateral)); positionForward = flightForward + roll * flightForward / distance; positionLateral = flightLateral + roll * flightLateral / distance; overshoot = Math.max(0, positionForward - input.remaining); remaining = Math.hypot(input.remaining - positionForward, positionLateral); };
  const forceRemaining = (forcedRemaining: number) => { let forwardDelta = positionForward - input.remaining, lateralDelta = positionLateral, distance = Math.hypot(forwardDelta, lateralDelta); if (distance < 0.001) { forwardDelta = -1; lateralDelta = 0; distance = 1; } positionForward = input.remaining + forwardDelta / distance * forcedRemaining; positionLateral = lateralDelta / distance * forcedRemaining; roll = Math.hypot(positionForward - flightForward, positionLateral - flightLateral); overshoot = Math.max(0, positionForward - input.remaining); remaining = forcedRemaining; };
  projectRoll();
  const absoluteLateral = Math.abs(positionLateral);
  let lie: Lie = remaining <= 13 && overshoot <= 9 && absoluteLateral <= 11 ? "GREEN" : grade === "ERROR" && absoluteLateral > 13 ? "BUNKER" : absoluteLateral > 17 ? "ROUGH" : "FAIRWAY";
  let penalty = 0;
  let hazardLabel: string | undefined, hazardDetail: string | undefined;

  if (input.hole.hazard === "CROSSWIND" && Math.abs(crosswind) > 0 && grade !== "ERROR") { hazardLabel = "WIND READ!"; hazardDetail = `${round1(Math.abs(flightLateral))} m ${flightLateral < 0 ? "links" : "rechts"} einkalkuliert`; }
  if (input.hole.hazard === "TREE_GATE" && input.strokeNumber === 1 && (["EARLY", "LATE", "ERROR"] as TimingGrade[]).includes(grade)) { const scale = Math.min(1, 118 / Math.max(1, carry)); flightForward *= scale; flightLateral *= scale; carry = Math.hypot(flightForward, flightLateral); roll = 0; projectRoll(); lie = "ROUGH"; hazardLabel = "KLONK!"; hazardDetail = "Die Baumlinie blockt den aggressiven Winkel"; }
  if (input.hole.hazard === "WATER_CARRY" && input.strokeNumber === 1 && grade === "ERROR") { const waterCarry = input.remaining * 0.58, scale = waterCarry / Math.max(1, carry); flightForward *= scale; flightLateral *= scale; carry = waterCarry; roll = 0; positionForward = 0; positionLateral = 0; remaining = input.remaining; lie = input.lie; penalty = 1; hazardLabel = "SPLASH!"; hazardDetail = "+1 Strafschlag · zurück zum letzten Spot"; }
  if (input.hole.hazard === "BUNKER_JAWS" && lie === "GREEN" && grade !== "PERFECT") { forceRemaining(Math.max(8, remaining)); lie = "BUNKER"; hazardLabel = "BEACH MODE!"; hazardDetail = "Die Bunkerzähne schnappen vor dem Grün zu"; }
  if (input.hole.hazard === "BREAKING_GREEN" && lie === "GREEN" && grade !== "PERFECT") { forceRemaining(round1(Math.min(13, remaining + 3.5))); hazardLabel = "BREAK!"; hazardDetail = "Der Hang zieht den Ball 3,5 m unter die Fahne"; }
  if (input.hole.hazard === "FALSE_FRONT" && lie === "GREEN" && !(["PERFECT", "GOOD"] as TimingGrade[]).includes(grade)) { forceRemaining(18); lie = "FAIRWAY"; hazardLabel = "REJECTED!"; hazardDetail = "Das False Front schickt den Ball zurück"; }

  const curveX = Math.round(548 + clamp(flightLateral * 2.5, -70, 70));
  const curvePath = curve === "DRAW" ? `M120 312 C186 165 438 162 ${curveX} 72` : curve === "FADE" ? `M120 312 C360 244 342 122 ${curveX} 72` : `M120 312 C258 174 408 140 ${curveX} 72`;
  const label = lie === "GREEN" ? "GREEN GETROFFEN" : lie === "BUNKER" ? "IM BUNKER" : lie === "ROUGH" ? "IM ROUGH" : "FAIRWAY GETROFFEN";
  return { grade, carry: round1(carry), maxCarry: round1(maxCarryRaw), requestedCarry: round1(requestedDistance), underReach: requestedDistance > maxCarryRaw, flightForward: round1(flightForward), flightLateral: round1(flightLateral), positionForward: round1(positionForward), positionLateral: round1(positionLateral), roll: round1(roll), lateral: round1(positionLateral), remaining: round1(Math.max(0.6, remaining)), lie, holed: false, label, detail: `${grade} · ${round1(carry)} m Carry · ${round1(roll)} m Roll`, curve: curvePath, penalty, hazardLabel, hazardDetail };
}
