/** Read-only adapter for the existing canvas renderer. There is no second clock. */
export type EmeraldShotPhase = "idle" | "pending" | "swing" | "flight" | "settle" | "result" | "unavailable";
export interface EmeraldPresentation {
  source: Readonly<{ id: string; holeId: number }> | null;
  shotId: string | null;
  holeId: number;
  phase: EmeraldShotPhase;
  paused: boolean;
  reducedMotion: boolean;
}
export interface RendererStatus { shotId: string | null; phase: string; destroyed: boolean; }
export function mapRendererPhase(phase: string): EmeraldShotPhase {
  switch (phase) {
    case "swing": return "swing";
    case "flight": return "flight";
    case "roll": case "penalty": return "settle";
    case "done": return "result";
    case "idle": return "idle";
    default: return "pending";
  }
}
export function presentationSnapshot(
  expected: { id: string; holeId: number } | undefined,
  holeId: number,
  status: RendererStatus | null,
  options: { hidden?: boolean; visible?: boolean; reducedMotion?: boolean; unavailable?: boolean } = {},
): EmeraldPresentation {
  const valid = expected?.holeId === holeId && Boolean(expected.id.trim());
  let phase: EmeraldShotPhase = "idle";
  if (options.unavailable) phase = "unavailable";
  else if (valid) {
    phase = status && !status.destroyed && status.shotId === expected!.id
      ? mapRendererPhase(status.phase) : "pending";
  }
  const moving = phase === "swing" || phase === "flight" || phase === "settle";
  return { source: valid ? expected! : null, shotId: valid ? expected!.id : null, holeId, phase,
    paused: moving && Boolean(options.hidden || options.visible === false),
    reducedMotion: Boolean(options.reducedMotion) };
}
export function phaseForShot(
  shot: { id: string; holeId: number } | undefined,
  snapshot: EmeraldPresentation | null,
): EmeraldShotPhase {
  if (!shot) return snapshot?.phase === "unavailable" ? "unavailable" : "idle";
  if (snapshot?.holeId === shot.holeId && snapshot.phase === "unavailable") return "unavailable";
  if (snapshot?.source !== shot) return "pending";
  if (snapshot?.shotId !== shot.id || snapshot.holeId !== shot.holeId) return "pending";
  return snapshot.phase;
}

/** Observe renderer paints and visibility, never advance the timeline ourselves.
 * Call refresh after host setHole/play/reset, which may paint synchronously. */
export function observeCoursePresentation(
  canvas: HTMLCanvasElement,
  read: () => EmeraldPresentation,
  notify: (snapshot: EmeraldPresentation) => void,
) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  let dead = false;
  let last = "";
  let lastSource: EmeraldPresentation["source"] | undefined;
  let visible = true;
  const refresh = () => {
    if (dead) return;
    const value = read();
    const moving = ["swing", "flight", "settle"].includes(value.phase);
    const next = { ...value, paused: moving && Boolean(doc.hidden || !visible || value.paused) };
    const key = [next.shotId, next.holeId, next.phase, next.paused, next.reducedMotion].join("|");
    if (key !== last || next.source !== lastSource) { last = key; lastSource = next.source; notify(next); }
  };
  const mutation = win && typeof win.MutationObserver === "function"
    ? new win.MutationObserver(refresh) : null;
  mutation?.observe(canvas, { attributes: true, attributeFilter: ["data-flight-phase"] });
  const intersection = win && typeof win.IntersectionObserver === "function"
    ? new win.IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; refresh(); }) : null;
  intersection?.observe(canvas);
  doc.addEventListener("visibilitychange", refresh);
  refresh();
  return { refresh, dispose() {
    if (dead) return;
    dead = true;
    mutation?.disconnect();
    intersection?.disconnect();
    doc.removeEventListener("visibilitychange", refresh);
  } };
}
