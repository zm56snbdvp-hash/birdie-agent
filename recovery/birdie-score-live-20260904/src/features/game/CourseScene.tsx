import React, { useEffect, useRef, useState } from "react";
import type { CourseHole } from "./shot-engine";
import type { CourseShot } from "./course-flight";
import { createCourseScene, type CourseSceneController } from "./course-scene";

export interface CourseSceneProps {
  hole: CourseHole;
  /** Already resolved by the host. Keep its ID stable across renders. */
  shot?: CourseShot;
  quality?: "auto" | "low" | "high";
  reducedMotion?: boolean;
}

/** Optional read-only presentation inside the recovered card UI. No rules,
 * network calls, player progression or write-on-animation-complete callback. */
export function CourseScene({ hole, shot, quality = "auto", reducedMotion = false }: CourseSceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<CourseSceneController | null>(null);
  const initialHole = useRef(hole);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      scene.current = createCourseScene(canvas.current, { hole: initialHole.current, quality, reducedMotion });
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
    return () => { scene.current?.destroy(); scene.current = null; };
  }, [quality, reducedMotion]);

  useEffect(() => {
    scene.current?.setHole(hole);
    if (shot) scene.current?.play(shot);
    else scene.current?.reset();
  }, [hole, shot, quality, reducedMotion]);

  const visibleShot = shot?.holeId === hole.id ? shot : undefined;

  return <figure className="bw-course-frame" data-course-presentation="emerald-flight-v1">
    <canvas
      ref={canvas}
      role="img"
      aria-label={`Smaragd-Golfkurs: ${hole.name}. ${visibleShot ? visibleShot.result.detail : "Am Abschlag."}`}
      style={{ display: unavailable ? "none" : "block", width: "100%", height: "clamp(330px, 56vw, 610px)" }}
    />
    <figcaption className="bw-course-caption">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{hole.name}</strong>
        <span className="bw-card-meta">EMERALD COURSE · {String(hole.id).padStart(2, "0")}</span>
      </div>
      <p style={{ margin: "5px 0" }} role="status" aria-live="polite">
        {unavailable
          ? "Kursdarstellung ist in diesem Browser nicht verfügbar. Die Spielberechnung bleibt unabhängig."
          : visibleShot
            ? `${visibleShot.result.label} · ${visibleShot.result.detail}`
            : "2.5D-Entwicklungsansicht · wartet auf ein berechnetes Schlagergebnis."}
      </p>
      <small>Darstellung des vorhandenen Schlagergebnisses. Keine zweite Physik, keine Coin- oder Spielstand-Writes.</small>
    </figcaption>
  </figure>;
}
