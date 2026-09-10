import React from "react";

export interface EmeraldCourseHudProps {
  hole: number;
  totalHoles: number;
  courseName: string;
  message: string;
  resultLabel?: string | null;
}

export function EmeraldCourseHud({ hole, totalHoles, courseName, message, resultLabel }: EmeraldCourseHudProps) {
  return <div className="bw-course-hud" data-authority="presentation-only">
    <div className="bw-course-hud-hole"><span>HOLE</span><strong>{String(hole).padStart(2,"0")}</strong><small>/ {String(totalHoles).padStart(2,"0")}</small></div>
    <div className="bw-course-hud-line"><span className="bw-course-hud-node"/><span className="bw-course-hud-vein"/></div>
    <div className="bw-course-hud-copy"><span>{courseName}</span><strong>{resultLabel ?? "READY"}</strong><small>{message}</small></div>
  </div>;
}
