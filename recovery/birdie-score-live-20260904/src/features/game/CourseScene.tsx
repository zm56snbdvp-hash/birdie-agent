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
    } catch { setUnavailable(true); }
    return () => { scene.current?.destroy(); scene.current = null; };
  }, [quality, reducedMotion]);
  useEffect(() => {
    scene.current?.setHole(hole);
    if (shot) scene.current?.play(shot);
    else scene.current?.reset();
  }, [hole, shot, quality, reducedMotion]);
  const visibleShot = shot?.holeId === hole.id ? shot : undefined;
  return <figure style={{ margin: "20px 0", overflow: "hidden", borderRadius: 18, border: "1px solid #b29b5744", background: "#071e15" }} data-course-presentation="emerald-flight-v1">
    <canvas ref={canvas} role="img" aria-label={`Smaragd-Golfkurs: ${hole.name}. ${visibleShot ? visibleShot.result.detail : "Am Abschlag."}`} style={{ display: unavailable ? "none" : "block", width: "100%", height: "clamp(300px, 50vw, 540px)" }}/>
    <figcaption style={{ padding: "12px 18px", color: "#ddd7b5", fontSize: 12, lineHeight: 1.6 }}>
      <strong>{hole.name} · Course / Flight v1</strong>
      <p style={{ margin: "4px 0" }} role="status" aria-live="polite">{unavailable ? "Kursdarstellung ist in diesem Browser nicht verfügbar. Die Spielberechnung bleibt unabhängig." : visibleShot ? `${visibleShot.result.label} · ${visibleShot.result.detail}` : "2.5D-Entwicklungsansicht · wartet auf ein berechnetes Schlagergebnis."}</p>
      <small>Gestaltungsvorschau, keine verbindliche Hinderniskarte. Keine Änderung an Spielstand oder Coins.</small>
    </figcaption>
  </figure>;
}
