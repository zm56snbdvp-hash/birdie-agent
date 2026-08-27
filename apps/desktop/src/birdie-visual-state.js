const profile = (values) => Object.freeze(values);

export const PRESENCE_STATES = Object.freeze([
  'IDLE',
  'SPEECH_DETECTED',
  'LISTENING',
  'THINKING',
  'SPEAKING',
  'WORKING',
  'SUCCESS',
  'ERROR',
  'OFFLINE',
]);

export const VISUAL_PROFILES = Object.freeze({
  IDLE: profile({
    coreScale: 1.04,
    presence: 0.42,
    aperture: 0.18,
    flow: 0.16,
    gold: 0.18,
    edge: 0.24,
    turbulence: 0.12,
    particle: 0.22,
    distress: 0,
  }),
  SPEECH_DETECTED: profile({
    coreScale: 1.1,
    presence: 0.82,
    aperture: 0.72,
    flow: 0.48,
    gold: 0.52,
    edge: 0.62,
    turbulence: 0.3,
    particle: 0.62,
    distress: 0,
  }),
  LISTENING: profile({
    coreScale: 1.11,
    presence: 0.88,
    aperture: 0.94,
    flow: 0.38,
    gold: 0.3,
    edge: 0.72,
    turbulence: 0.24,
    particle: 0.7,
    distress: 0,
  }),
  THINKING: profile({
    coreScale: 1.08,
    presence: 0.8,
    aperture: 0.34,
    flow: 0.86,
    gold: 0.58,
    edge: 0.56,
    turbulence: 0.56,
    particle: 0.5,
    distress: 0,
  }),
  SPEAKING: profile({
    coreScale: 1.12,
    presence: 0.94,
    aperture: 0.7,
    flow: 0.72,
    gold: 0.8,
    edge: 0.76,
    turbulence: 0.42,
    particle: 0.82,
    distress: 0,
  }),
  WORKING: profile({
    coreScale: 1.1,
    presence: 0.9,
    aperture: 0.44,
    flow: 0.96,
    gold: 0.66,
    edge: 0.68,
    turbulence: 0.62,
    particle: 0.66,
    distress: 0,
  }),
  SUCCESS: profile({
    coreScale: 1.14,
    presence: 1,
    aperture: 0.82,
    flow: 0.5,
    gold: 1,
    edge: 0.92,
    turbulence: 0.18,
    particle: 1,
    distress: 0,
  }),
  ERROR: profile({
    coreScale: 1.05,
    presence: 0.62,
    aperture: 0.18,
    flow: 0.18,
    gold: 0.12,
    edge: 0.46,
    turbulence: 0.78,
    particle: 0.28,
    distress: 1,
  }),
  OFFLINE: profile({
    coreScale: 1.01,
    presence: 0.14,
    aperture: 0.04,
    flow: 0.03,
    gold: 0.02,
    edge: 0.08,
    turbulence: 0.02,
    particle: 0.06,
    distress: 0,
  }),
});

export const CAMERA_HALF_HEIGHT = 2.5;
export const CORE_DIAMETER = 3.24;
export const MAX_DRAWING_BUFFER_PIXELS = 10_750_000;

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function hasVisualProfile(state) {
  return Object.hasOwn(VISUAL_PROFILES, state);
}

export function getVisualProfile(state) {
  return VISUAL_PROFILES[state] ?? VISUAL_PROFILES.OFFLINE;
}

export function computeViewport(
  width,
  height,
  devicePixelRatio = 1,
  reducedMotion = false,
) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  const cssPixels = safeWidth * safeHeight;
  const motionCap = reducedMotion ? 1.25 : 1.75;
  const pixelBudgetCap = Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / cssPixels);
  const pixelRatio = Math.min(
    motionCap,
    Math.max(1, Number(devicePixelRatio) || 1),
    pixelBudgetCap,
  );
  const aspect = safeWidth / safeHeight;
  const cameraHalfWidth = CAMERA_HALF_HEIGHT * aspect;
  const coreHorizontalFit = Math.min(
    1,
    cameraHalfWidth / ((CORE_DIAMETER / 2) * 1.26),
  );

  return Object.freeze({
    width: safeWidth,
    height: safeHeight,
    cssPixels,
    drawingBufferPixels: Math.round(cssPixels * pixelRatio * pixelRatio),
    aspect,
    pixelRatio,
    cameraHalfHeight: CAMERA_HALF_HEIGHT,
    cameraHalfWidth,
    coreHorizontalFit,
  });
}

export function computeCoreHeightRatio(state, audioEnergy = 0) {
  const visual = getVisualProfile(state);
  const audioScale = clamp01(audioEnergy) * 0.015;
  return (
    (CORE_DIAMETER * (visual.coreScale + audioScale)) /
    (CAMERA_HALF_HEIGHT * 2)
  );
}

export function deriveAudioReaction(
  state,
  { inputEnvelope = 0, outputEnvelope = 0, vadProbability = 0 } = {},
) {
  const inputForeground =
    state === 'SPEECH_DETECTED' || state === 'LISTENING';
  const outputForeground = state === 'SPEAKING';
  const input = clamp01(inputEnvelope) * (inputForeground ? 1 : 0.08);
  const output = clamp01(outputEnvelope) * (outputForeground ? 1 : 0);
  return Object.freeze({
    input,
    output,
    energy: Math.max(input, output),
    attention: inputForeground ? clamp01(vadProbability) : 0,
    direction: inputForeground ? -1 : outputForeground ? 1 : 0,
  });
}

export function approach(current, target, attack, release) {
  const amount = target > current ? attack : release;
  return current + (target - current) * amount;
}
