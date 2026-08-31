const STATIC_FRAME_INTERVAL_MS = 1_000 / 60;

export class StaticPresenceRenderer {
  constructor(canvas, { onReady, onContextState, onFrame } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('StaticPresenceRenderer requires a canvas element');
    }
    this.canvas = canvas;
    this.onReady = onReady;
    this.onContextState = onContextState;
    this.onFrame = onFrame;
    // CSS paints the static presence. JavaScript can only prove that its RAF
    // heartbeat is alive, not that a visual frame reached the compositor.
    this.renderedFrameCount = 0;
    this.heartbeatFrameCount = 0;
    this.lastHeartbeatAt = 0;
    this.frameRequest = 0;
    this.running = false;
    this.firstFrameReported = false;
    this.handleResize = () => this.resize();
    this.handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = 0;
      } else if (this.running && !this.frameRequest) {
        this.lastHeartbeatAt = performance.now();
        this.frameRequest = requestAnimationFrame((now) => this.frame(now));
      }
    };
  }

  setPresence() { return true; }
  setInputAudio() {}
  setOutputAudio() {}
  setReducedMotion() {}

  resize() {
    const bounds = this.canvas.parentElement?.getBoundingClientRect()
      ?? this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth || 1));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight || 1));
    const viewport = { width, height, pixelRatio: 1 };
    this.onReady?.(viewport);
    return viewport;
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.resize();
    this.lastHeartbeatAt = performance.now();
    this.frameRequest = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    this.frameRequest = 0;
    if (!this.running || document.hidden) return;
    if (now - this.lastHeartbeatAt >= STATIC_FRAME_INTERVAL_MS) {
      const intervalMs = this.heartbeatFrameCount > 0 ? now - this.lastHeartbeatAt : 0;
      this.lastHeartbeatAt = now;
      this.heartbeatFrameCount += 1;
      this.onFrame?.({
        at: now,
        metricKind: 'RAF_HEARTBEAT',
        heartbeatCount: this.heartbeatFrameCount,
        intervalMs,
      });
      if (!this.firstFrameReported) {
        this.firstFrameReported = true;
        this.onContextState?.(
          'RAF_HEARTBEAT',
          'renderer=static;visual-performance=unproven',
        );
      }
    }
    this.frameRequest = requestAnimationFrame((next) => this.frame(next));
  }

  dispose() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }
}
