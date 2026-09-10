import React, { useEffect, useRef, useState } from "react";
import type { CourseHole } from "./shot-engine";
import { isPreparedCourseShot, type CourseShot } from "./course-flight";
import { createCourseScene, type CourseSceneController } from "./course-scene";
import { observeCoursePresentation, presentationSnapshot, type EmeraldPresentation } from "./emerald-presentation";

export interface CourseSceneProps {
  hole: CourseHole;
  /** Immutable, already resolved by the host; ID stays stable across renders. */
  shot?: CourseShot;
  quality?: "auto" | "low" | "high";
  reducedMotion?: boolean;
  /** UI feedback only. Never attach gameplay, wallet or persistence writes. */
  onPresentationChange?: (snapshot: EmeraldPresentation) => void;
}
export function CourseScene({ hole, shot, quality = "auto", reducedMotion = false, onPresentationChange }: CourseSceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CourseSceneController | null>(null);
  const accepted = useRef<CourseShot | null>(null);
  const callback = useRef(onPresentationChange);
  const [snapshot, setSnapshot] = useState<EmeraldPresentation | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { callback.current = onPresentationChange; }, [onPresentationChange]);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      scene.current = createCourseScene(canvas.current, { hole, quality, reducedMotion });
      accepted.current = null;
      setUnavailable(false);
    } catch { scene.current = null; setUnavailable(true); }
    return () => { scene.current?.destroy(); scene.current = null; accepted.current = null; };
    // Recreate on renderer configuration / course change, not every shot or parent render.
  }, [hole.id, hole.distance, quality, reducedMotion]);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const controller = scene.current;
    const motion = node.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)");
    const current = shot?.holeId === hole.id && isPreparedCourseShot(shot) ? shot : undefined;
    let rejected = Boolean(shot && shot.holeId === hole.id && !current);
    if (controller) {
      controller.setHole(hole);
      if (current) {
        if (controller.play(current)) accepted.current = current;
        else if (accepted.current !== current) { rejected = true; controller.reset(); accepted.current = null; }
      } else { controller.reset(); accepted.current = null; }
    }
    const observer = observeCoursePresentation(node, () => presentationSnapshot(
      current, hole.id, controller?.status() ?? null,
      { hidden: node.ownerDocument.hidden, reducedMotion: reducedMotion || motion?.matches,
        unavailable: !controller || rejected },
    ), value => { setSnapshot(value); callback.current?.(value); });
    const changedMotion = () => observer.refresh();
    motion?.addEventListener("change", changedMotion);
    return () => { observer.dispose(); motion?.removeEventListener("change", changedMotion); };
  }, [hole.id, hole.distance, shot, quality, reducedMotion]);

  const matched = snapshot?.holeId === hole.id && snapshot?.source === shot;
  const result = matched && snapshot?.phase === "result" && accepted.current === shot ? shot : undefined;
  const failed = unavailable || (snapshot?.holeId === hole.id && snapshot?.phase === "unavailable");
  const statusText = failed
    ? "Die Kursanimation ist nicht verfügbar. Das berechnete Ergebnis bleibt unverändert."
    : result ? `${result.result.label} · ${result.result.detail}`
    : snapshot?.paused ? "Animation pausiert."
    : shot && matched ? "Dein Schlag läuft …" : "Bereit am Abschlag.";
  return <figure className="bw-course-frame" data-course-presentation="emerald-flight-v1">
    <canvas ref={canvas} role="img" aria-label={`Golfkurs ${hole.name}. ${statusText}`}
      style={{ display: unavailable ? "none" : "block", width: "100%", height: "clamp(330px, 56vw, 610px)" }}/>
    <figcaption className="bw-course-caption">
      <strong>{hole.name}</strong>
      <p style={{ margin: "5px 0" }} role="status" aria-live="polite">{statusText}</p>
      {failed && shot?.holeId === hole.id && isPreparedCourseShot(shot) &&
        <p>Berechnetes Ergebnis: {shot.result.label} · {shot.result.detail}</p>}
      <small>2.5D-Darstellung · keine verbindliche Hinderniskarte.</small>
    </figcaption>
  </figure>;
}
