import type { CourseHole } from "./shot-engine.ts";
import { isPreparedCourseShot, sampleCourseShot, type CourseShot, type FlightFrame } from "./course-flight.ts";

export interface CourseSceneOptions { hole: CourseHole; quality?: "auto" | "low" | "high"; reducedMotion?: boolean; }
export interface CourseSceneController {
  play(shot: CourseShot): boolean;
  setHole(hole: CourseHole): void;
  reset(): void;
  resize(): void;
  destroy(): void;
  status(): { shotId: string | null; phase: string; elapsedMs: number; pendingFrames: number; destroyed: boolean };
}
type P = { x: number; y: number; z: number };
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const norm = (p: P): P => { const d = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / d, y: p.y / d, z: p.z / d }; };
const cross = (a: P, b: P): P => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y + a.z * b.z;
function validHole(hole: CourseHole) {
  if (!Number.isInteger(hole.id) || hole.id < 1 || hole.id > 6 || !Number.isFinite(hole.distance) || hole.distance <= 0 || hole.distance > 10000) throw new RangeError("Invalid course hole");
}

/** Procedural 2.5D presentation, not a new physics/collision engine. Terrain
 * contours and scenery are art direction, not an authoritative hazard map. */
export function createCourseScene(canvas: HTMLCanvasElement, options: CourseSceneOptions): CourseSceneController {
  validHole(options.hole);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is unavailable");
  const ctx: CanvasRenderingContext2D = context;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error("Course canvas needs a window");
  const motionQuery = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  const coarse = win.matchMedia?.("(pointer: coarse)").matches;
  const low = options.quality === "low" || (options.quality !== "high" && coarse);
  const reduced = () => Boolean(options.reducedMotion || motionQuery?.matches);
  let hole = { ...options.hole }, active: CourseShot | null = null;
  let elapsed = 0, raf = 0, lastTime: number | null = null, dead = false, visible = true;
  let width = 1, height = 1, dpr = 1;
  const seen = new Set<string>();
  const idle: FlightFrame = { x: 0, y: 0, z: 0, opacity: 1, phase: "done", progress: 0 };
  const frame = () => active ? sampleCourseShot(active, elapsed, reduced()) : idle;

  function paint() {
    if (dead) return;
    const f = frame();
    canvas.dataset.flightPhase = active ? f.phase : "idle";
    const distance = active?.remainingBefore ?? hole.distance;
    const scale = Math.max(35, distance);
    const courseWidth = clamp(scale * .085, 4, 32);
    const follow = active && !reduced() ? Math.sin(Math.PI * Math.min(1, f.progress) * .85) : 0;
    const eye: P = { x: -scale * .12 + f.x * .45 * follow, y: scale * .22 + f.y * .12 * follow, z: -scale * .27 + f.z * .35 * follow };
    const target: P = { x: f.x * .15 * follow, y: f.y * .14 * follow, z: scale * .38 + f.z * .28 * follow };
    const forward = norm({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
    const right = norm(cross({ x: 0, y: 1, z: 0 }, forward));
    const up = cross(forward, right);
    const focal = Math.min(width * 1.12, height * 1.15);
    const project = (p: P) => {
      const delta = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
      const depth = dot(delta, forward);
      const k = focal / Math.max(1, depth);
      return { x: width * .5 + dot(delta, right) * k, y: height * .48 - dot(delta, up) * k, k, visible: depth > 1 };
    };
    const poly = (points: P[], fill: string, stroke?: string) => {
      const p = points.map(project);
      if (p.some(v => !v.visible)) return;
      ctx.beginPath(); p.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .7; ctx.stroke(); }
    };
    const disc = (x: number, z: number, rx: number, rz: number, fill: string, stroke?: string) => {
      poly(Array.from({ length: low ? 24 : 40 }, (_, i) => { const a = i * Math.PI * 2 / (low ? 24 : 40); return { x: x + Math.cos(a) * rx, y: .12, z: z + Math.sin(a) * rz }; }), fill, stroke);
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#152d26"); sky.addColorStop(.43, "#435746"); sky.addColorStop(1, "#031611");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    const sun = ctx.createRadialGradient(width * .76, height * .16, 0, width * .76, height * .16, width * .75);
    sun.addColorStop(0, "#e1c57d99"); sun.addColorStop(.2, "#c4a96742"); sun.addColorStop(1, "#7d9a6c00");
    ctx.fillStyle = sun; ctx.fillRect(0, 0, width, height);
    // Broad layered canyon folds, not a static picture or a collision map.
    for (let layer = 0; layer < 4; layer++) {
      ctx.beginPath(); ctx.moveTo(-40, height);
      for (let i = 0; i <= 10; i++) {
        const x = i / 10 * (width + 80) - 40;
        const y = height * (.18 + layer * .09 + Math.sin(i * 1.7 + layer * 1.1) * .09);
        if (i === 0) ctx.lineTo(x, y);
        else ctx.bezierCurveTo(x - width * .08, y - height * .1, x - width * .06, y + height * .08, x, y);
      }
      ctx.lineTo(width + 40, height); ctx.closePath();
      ctx.fillStyle = ["#697c5644", "#345a4188", "#174b35bb", "#0a3025"][layer]; ctx.fill();
      ctx.strokeStyle = "#c4b1712a"; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const side of [-1, 1]) {
      ctx.save(); if (side === 1) { ctx.translate(width, 0); ctx.scale(-1, 1); }
      for (let fold = 0; fold < (low ? 5 : 8); fold++) {
        const x = fold * width * .026, y = fold * height * .018;
        ctx.beginPath(); ctx.moveTo(-width * .1, -height * .2);
        ctx.bezierCurveTo(width * .45 - x, -height * .08 + y, width * .03 + x, height * .26, width * .18 - x * .5, height * .46);
        ctx.bezierCurveTo(width * .34 - x, height * .73, width * .07 + x, height * .82, width * .03, height * 1.1);
        ctx.lineTo(-width * .1, height * 1.1); ctx.closePath();
        const rock = ctx.createLinearGradient(0, 0, width * .32, height * .5);
        rock.addColorStop(0, "#031912"); rock.addColorStop(.6, fold % 2 ? "#123b28" : "#194931"); rock.addColorStop(1, "#051d18");
        ctx.fillStyle = rock; ctx.fill(); ctx.strokeStyle = fold % 3 === 0 ? "#d4ae5b66" : "#4c765950"; ctx.lineWidth = fold % 3 === 0 ? 1.3 : .8; ctx.stroke();
      }
      ctx.restore();
    }
    const center = (z: number) => { const t = clamp(z / distance, 0, 1); return Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 2 - .4) * scale * .09; };
    const spread = (z: number) => courseWidth * (1 + .25 * Math.cos(z / scale * Math.PI * 4)) + courseWidth * .35 * Math.exp(-(((z - distance) / (courseWidth * 1.8)) ** 2));
    const segments = low ? 42 : 72;
    const near = -scale * .13, far = distance + courseWidth * 1.5;
    for (let i = segments - 1; i >= 0; i--) {
      const za = near + (far - near) * i / segments, zb = near + (far - near) * (i + 1) / segments;
      const ca = center(za), cb = center(zb), wa = spread(za), wb = spread(zb);
      for (const side of [-1, 1]) {
        for (let level = 2; level >= 0; level--) {
          const ya = -scale * .1 * level, yb = -scale * .1 * (level + 1);
          const taper = 1 - level * .1, taper2 = 1 - (level + 1) * .1;
          poly([{ x: ca + side * wa * taper, y: ya, z: za }, { x: cb + side * wb * taper, y: ya, z: zb },
            { x: cb + side * wb * taper2, y: yb, z: zb }, { x: ca + side * wa * taper2, y: yb, z: za }],
          ["#163c29", "#0d2e22", "#08281c"][(level + Math.floor(i / 3)) % 3], i % 11 === 0 ? "#b0944a77" : undefined);
        }
      }
      poly([{ x: ca - wa, y: 0, z: za }, { x: cb - wb, y: 0, z: zb }, { x: cb + wb, y: 0, z: zb }, { x: ca + wa, y: 0, z: za }], Math.floor(i / 4) % 2 ? "#244f2e" : "#295b32");
      poly([{ x: ca - wa * .8, y: .02, z: za }, { x: cb - wb * .8, y: .02, z: zb }, { x: cb + wb * .8, y: .02, z: zb }, { x: ca + wa * .8, y: .02, z: za }], Math.floor(i / 4) % 2 ? "#447838" : "#487d3a");
      for (const side of [-1, 1]) {
        const a = project({ x: ca + wa * side, y: .06, z: za }), b = project({ x: cb + wb * side, y: .06, z: zb });
        if (!a.visible || !b.visible) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "#dec681"; ctx.lineWidth = clamp(a.k * .33, .8, 3.2); ctx.stroke();
      }
    }
    disc(0, distance, courseWidth * 1.12, courseWidth * 1.05, "#729b43", "#cbcd7099");
    disc(0, distance, courseWidth * .88, courseWidth * .86, "#8aab4e", "#aac26988");
    disc(0, 0, courseWidth * .45, courseWidth * .26, "#698a3a", "#cfb96e");
    // Result lies remain explicit; decorative shapes never assign penalties.
    if (active?.result.lie === "BUNKER") disc(active.result.positionLateral, active.result.positionForward, courseWidth * .27, courseWidth * .18, "#d8c89c", "#8f8755");
    if (active && active.result.penalty > 0) disc(active.result.flightLateral, active.result.flightForward, courseWidth * .48, courseWidth * .3, "#163f3c", "#a6c2a977");
    const flagBase = project({ x: 0, y: .2, z: distance });
    const flagTop = project({ x: 0, y: clamp(scale * .055, 2.5, 14), z: distance });
    if (flagBase.visible && flagTop.visible) {
      ctx.fillStyle = "#0a241c"; ctx.beginPath(); ctx.ellipse(flagBase.x, flagBase.y, 4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#eee8c9"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(flagBase.x, flagBase.y); ctx.lineTo(flagTop.x, flagTop.y); ctx.stroke();
      ctx.fillStyle = "#fff2c2"; ctx.beginPath(); ctx.moveTo(flagTop.x, flagTop.y); ctx.lineTo(flagTop.x + 18, flagTop.y + 6); ctx.lineTo(flagTop.x, flagTop.y + 12); ctx.fill();
    }
    const mist = ctx.createLinearGradient(0, height * .6, 0, height);
    mist.addColorStop(0, "#9da98500"); mist.addColorStop(1, "#051712cc"); ctx.fillStyle = mist; ctx.fillRect(0, height * .6, width, height * .4);
    if (active && !reduced() && f.phase === "flight") {
      const count = low ? 12 : 24;
      for (let i = 1; i <= count; i++) {
        const past = sampleCourseShot(active, Math.max(active.swingMs, elapsed - (count - i + 1) * 14));
        const next = sampleCourseShot(active, Math.max(active.swingMs, elapsed - (count - i) * 14));
        const a = project(past), b = project(next);
        if (!a.visible || !b.visible) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(255,218,136,${i / count * .82})`; ctx.lineWidth = 1 + 2 * i / count; ctx.stroke();
      }
    }
    const ball = project({ x: f.x, y: f.y + .2, z: f.z });
    const shadow = project({ x: f.x, y: .1, z: f.z });
    if (ball.visible && f.opacity > 0) {
      const radius = clamp(3 + ball.k * .28, 3.2, 8);
      ctx.globalAlpha = f.opacity;
      ctx.fillStyle = "#06181166"; ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y + 2, radius * 1.7, radius * .5, 0, 0, Math.PI * 2); ctx.fill();
      const sheen = ctx.createRadialGradient(ball.x - radius * .3, ball.y - radius * .4, .1, ball.x, ball.y, radius);
      sheen.addColorStop(0, "#ffffff"); sheen.addColorStop(.6, "#f4f1d9"); sheen.addColorStop(1, "#9caba1");
      ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (f.phase === "swing" && !reduced() && ball.visible) {
      const p = elapsed / 240;
      ctx.save(); ctx.translate(ball.x - 16, ball.y - 52); ctx.rotate(-.8 + p * 2.1);
      ctx.strokeStyle = "#d0d9c6"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 55); ctx.stroke();
      ctx.fillStyle = "#e4cc87"; ctx.fillRect(-4, 49, 18, 8); ctx.restore();
    }
    ctx.fillStyle = "#e2d4a6"; ctx.font = "11px system-ui";
    ctx.fillText("EMERALD / GOLD  ·  COURSE " + String(hole.id).padStart(2, "0"), 20, 28);
    ctx.fillStyle = "#d3dfd1"; ctx.font = "12px system-ui"; ctx.fillText(Math.round(distance) + " m zur Fahne", 20, 48);
  }
  function stop() { if (raf) win!.cancelAnimationFrame(raf); raf = 0; lastTime = null; }
  function schedule() { if (!dead && !raf && !doc.hidden && visible && active && frame().phase !== "done") raf = win!.requestAnimationFrame(tick); }
  function tick(now: number) {
    raf = 0;
    if (dead || doc.hidden || !visible) { lastTime = null; return; }
    if (lastTime !== null) elapsed += clamp(now - lastTime, 0, 100);
    lastTime = now; paint(); schedule();
  }
  function resize() {
    if (dead) return;
    const box = canvas.getBoundingClientRect();
    width = clamp(box.width || 640, 1, 2560); height = clamp(box.height || 480, 1, 1600);
    dpr = clamp(win!.devicePixelRatio || 1, 1, low ? 1.5 : 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); paint();
  }
  function onVisibility() { if (doc.hidden) stop(); else { lastTime = null; schedule(); } }
  function onMotion() { if (reduced() && active) elapsed = active.totalMs; stop(); paint(); schedule(); }
  const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(resize) : null;
  observer?.observe(canvas);
  if (!observer) win.addEventListener("resize", resize);
  const intersection = typeof win.IntersectionObserver === "function" ? new win.IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    if (!visible) stop(); else schedule();
  }) : null;
  intersection?.observe(canvas);
  doc.addEventListener("visibilitychange", onVisibility);
  motionQuery?.addEventListener("change", onMotion);
  resize();
  return {
    play(shot) {
      if (dead || !isPreparedCourseShot(shot) || shot.holeId !== hole.id || seen.has(shot.id)) return false;
      stop(); seen.add(shot.id); if (seen.size > 128) seen.delete(seen.values().next().value!);
      active = shot; elapsed = reduced() ? shot.totalMs : 0; paint(); schedule(); return true;
    },
    setHole(next) { if (dead) return; validHole(next); if (next.id === hole.id && next.distance === hole.distance) return; stop(); hole = { ...next }; active = null; elapsed = 0; seen.clear(); paint(); },
    reset() { if (dead) return; stop(); active = null; elapsed = 0; seen.clear(); paint(); },
    resize,
    destroy() { if (dead) return; stop(); dead = true; observer?.disconnect(); intersection?.disconnect(); win!.removeEventListener("resize", resize); doc.removeEventListener("visibilitychange", onVisibility); motionQuery?.removeEventListener("change", onMotion); active = null; seen.clear(); },
    status: () => ({ shotId: active?.id ?? null, phase: active ? frame().phase : "idle", elapsedMs: elapsed, pendingFrames: raf ? 1 : 0, destroyed: dead }),
  };
}
