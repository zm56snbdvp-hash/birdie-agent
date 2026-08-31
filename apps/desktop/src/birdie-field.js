import * as THREE from 'three';
import {
  approach,
  clamp01,
  computeViewport,
  deriveAudioReaction,
  getVisualProfile,
  hasVisualProfile,
  scheduleRenderFrame,
} from './birdie-visual-state.js';

const TAU = Math.PI * 2;
const CORE_RADIUS = 1.62;
const PROFILE_KEYS = [
  'coreScale',
  'presence',
  'aperture',
  'flow',
  'gold',
  'edge',
  'turbulence',
  'particle',
  'distress',
];

const palette = Object.freeze({
  forest: new THREE.Color(0x063c2c),
  green: new THREE.Color(0x11915f),
  gold: new THREE.Color(0xd5ad55),
  cream: new THREE.Color(0xeef4da),
  distress: new THREE.Color(0x9b4e35),
});

const deformShader = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uAperture;
  uniform float uTurbulence;
  uniform float uEnergy;
  uniform float uAttention;
  uniform float uDirection;
  uniform float uReducedMotion;

  vec3 birdieDeform(vec3 source) {
    vec3 direction = normalize(source);
    float motion = mix(1.0, 0.16, uReducedMotion);
    float slowTime = uTime * motion;
    float organic =
      sin(source.x * 4.6 + slowTime * (0.18 + uFlow * 0.28)) *
      sin(source.y * 4.1 - slowTime * 0.16);
    organic += 0.56 * sin(
      (source.x + source.y + source.z) * 7.3 - slowTime * (0.2 + uFlow * 0.52)
    );
    float audioWave = sin(
      source.y * 17.0 - slowTime * (2.0 + uFlow * 2.4) * uDirection
    );
    float displacement = organic * (0.008 + uTurbulence * 0.022);
    displacement += audioWave * uEnergy * 0.026;
    vec3 point = source + direction * displacement;
    point.x *= 1.055 + uAperture * 0.018 + uAttention * 0.016;
    point.z *= 0.79 + uAperture * 0.014 + uAttention * 0.01;
    return point;
  }
`;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function pushSegment(buffers, first, second, metadata) {
  for (const point of [first, second]) {
    buffers.positions.push(point.x, point.y, point.z);
    buffers.phases.push(point.phase);
    buffers.bands.push(metadata.band);
    buffers.kinds.push(metadata.kind);
    buffers.accents.push(metadata.accent);
  }
}

function pushPath(buffers, points, closed, metadata) {
  const segmentCount = points.length - (closed ? 0 : 1);
  for (let index = 0; index < segmentCount; index += 1) {
    pushSegment(
      buffers,
      points[index],
      points[(index + 1) % points.length],
      metadata,
    );
  }
}

function buildTopologyGeometry() {
  const buffers = {
    positions: [],
    phases: [],
    bands: [],
    kinds: [],
    accents: [],
  };

  for (let band = 0; band < 29; band += 1) {
    const bandRatio = band / 28;
    const latitude = -1.2 + bandRatio * 2.4;
    const vertical = Math.sin(latitude) * CORE_RADIUS;
    const ringRadius = Math.cos(latitude) * CORE_RADIUS;
    const points = [];
    for (let index = 0; index < 128; index += 1) {
      const phase = index / 128;
      const angle = phase * TAU;
      const irregularity =
        1 +
        Math.sin(angle * 3 + band * 0.71) * 0.014 +
        Math.sin(angle * 7 - band * 0.33) * 0.008;
      points.push({
        x: Math.cos(angle) * ringRadius * irregularity,
        y: vertical + Math.sin(angle * 4 + band) * 0.012,
        z: Math.sin(angle) * ringRadius * irregularity,
        phase,
      });
    }
    pushPath(buffers, points, true, {
      band: bandRatio,
      kind: 0,
      accent: band % 7 === 0 ? 0.38 : 0,
    });
  }

  for (let meridian = 0; meridian < 10; meridian += 1) {
    const points = [];
    const baseAngle = (meridian / 10) * TAU;
    for (let index = 0; index <= 96; index += 1) {
      const phase = index / 96;
      const latitude = -Math.PI / 2 + phase * Math.PI;
      const horizontal = Math.cos(latitude) * CORE_RADIUS;
      const angle = baseAngle + Math.sin(latitude * 3 + meridian) * 0.025;
      points.push({
        x: Math.cos(angle) * horizontal,
        y: Math.sin(latitude) * CORE_RADIUS,
        z: Math.sin(angle) * horizontal,
        phase,
      });
    }
    pushPath(buffers, points, false, {
      band: meridian / 9,
      kind: 0.5,
      accent: meridian % 4 === 0 ? 0.48 : 0.08,
    });
  }

  for (let fault = 0; fault < 3; fault += 1) {
    const points = [];
    for (let index = 0; index <= 112; index += 1) {
      const phase = index / 112;
      const latitude = -1.18 + phase * 2.36;
      const horizontal = Math.cos(latitude) * CORE_RADIUS;
      const angle =
        fault * (TAU / 3) +
        0.5 +
        phase * 1.42 +
        Math.sin(phase * TAU * 2 + fault) * 0.16;
      points.push({
        x: Math.cos(angle) * horizontal,
        y: Math.sin(latitude) * CORE_RADIUS,
        z: Math.sin(angle) * horizontal,
        phase,
      });
    }
    pushPath(buffers, points, false, {
      band: fault / 2,
      kind: 1,
      accent: 1,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(buffers.positions, 3),
  );
  geometry.setAttribute(
    'aPhase',
    new THREE.Float32BufferAttribute(buffers.phases, 1),
  );
  geometry.setAttribute(
    'aBand',
    new THREE.Float32BufferAttribute(buffers.bands, 1),
  );
  geometry.setAttribute(
    'aKind',
    new THREE.Float32BufferAttribute(buffers.kinds, 1),
  );
  geometry.setAttribute(
    'aAccent',
    new THREE.Float32BufferAttribute(buffers.accents, 1),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

function buildEchoGeometry() {
  const positions = [];
  const phases = [];
  const bands = [];
  for (let band = 0; band < 5; band += 1) {
    const radius = 1.94 + band * 0.36;
    for (let index = 0; index < 180; index += 1) {
      const phaseA = index / 180;
      const phaseB = (index + 1) / 180;
      const point = (phase) => {
        const angle = phase * TAU;
        const irregularity = 1 + Math.sin(angle * (3 + band) + band) * 0.018;
        return [
          Math.cos(angle) * radius * irregularity,
          Math.sin(angle) * radius * irregularity * (0.7 + band * 0.016),
          -0.9 - band * 0.04,
        ];
      };
      positions.push(...point(phaseA), ...point(phaseB));
      phases.push(phaseA, phaseB);
      bands.push(band / 4, band / 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aBand', new THREE.Float32BufferAttribute(bands, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildParticleGeometry() {
  const random = seededRandom(0xb17d1e);
  const positions = [];
  const phases = [];
  const sizes = [];
  const gold = [];
  for (let index = 0; index < 720; index += 1) {
    const angle = random() * TAU;
    const radius = Math.sqrt(random());
    positions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      random() * 2 - 1,
    );
    phases.push(random());
    sizes.push(0.45 + random() * 1.55);
    gold.push(random() > 0.86 ? 1 : 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aGold', new THREE.Float32BufferAttribute(gold, 1));
  return geometry;
}

function makeUniforms() {
  return {
    uTime: { value: 0 },
    uPresence: { value: 0.14 },
    uAperture: { value: 0.04 },
    uFlow: { value: 0.03 },
    uGold: { value: 0.02 },
    uEdge: { value: 0.08 },
    uTurbulence: { value: 0.02 },
    uParticle: { value: 0.06 },
    uDistress: { value: 0 },
    uEnergy: { value: 0 },
    uInput: { value: 0 },
    uOutput: { value: 0 },
    uAttention: { value: 0 },
    uDirection: { value: 0 },
    uAspect: { value: 1 },
    uPixelRatio: { value: 1 },
    uReducedMotion: { value: 0 },
    uForest: { value: palette.forest },
    uGreen: { value: palette.green },
    uGoldColor: { value: palette.gold },
    uCream: { value: palette.cream },
    uDistressColor: { value: palette.distress },
  };
}

function shaderMaterial(parameters) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    ...parameters,
  });
  material.premultipliedAlpha = true;
  return material;
}

function makeBackground(uniforms) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = shaderMaterial({
    uniforms,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPresence;
      uniform float uFlow;
      uniform float uGold;
      uniform float uEdge;
      uniform float uEnergy;
      uniform float uDistress;
      uniform float uAspect;
      uniform vec3 uForest;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uDistressColor;

      void main() {
        vec2 centered = vUv - 0.5;
        centered.x *= uAspect;
        float radius = length(centered);
        float aura = 1.0 - smoothstep(0.05, 0.78, radius);
        float contour = pow(
          max(0.0, 0.5 + 0.5 * sin(radius * 56.0 - uTime * (0.12 + uFlow * 0.5))),
          15.0
        );
        float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float edge = 1.0 - smoothstep(0.0, 0.11, edgeDistance);
        float warmth = clamp(uGold + uEnergy * 0.45, 0.0, 1.0);
        vec3 color = mix(uForest, uGreen, 0.3 + uPresence * 0.34);
        color = mix(color, uGoldColor, warmth * (0.22 + contour * 0.46));
        color = mix(color, uDistressColor, uDistress * 0.72);
        float alpha = aura * (0.012 + uPresence * 0.023 + uEnergy * 0.016);
        alpha += contour * aura * (0.002 + uPresence * 0.008);
        alpha += edge * (0.002 + uEdge * 0.018 + uEnergy * 0.012);
        alpha = clamp(alpha, 0.0, 0.07);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return { mesh: new THREE.Mesh(geometry, material), geometry, material };
}

function makeOuterShell(uniforms) {
  const geometry = new THREE.SphereGeometry(CORE_RADIUS, 72, 56);
  const material = shaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPosition;
      varying vec3 vObjectPosition;
      ${deformShader}
      void main() {
        vec3 transformed = birdieDeform(position);
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vObjectPosition = transformed;
        vWorldPosition = worldPosition.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPosition;
      varying vec3 vObjectPosition;
      uniform float uPresence;
      uniform float uAperture;
      uniform float uGold;
      uniform float uEnergy;
      uniform float uDistress;
      uniform vec3 uForest;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uCream;
      uniform vec3 uDistressColor;

      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalWorld), viewDirection)), 2.15);
        float vertical = 0.5 + 0.5 * vObjectPosition.y / ${CORE_RADIUS.toFixed(2)};
        float vein = pow(max(0.0, 0.5 + 0.5 * sin(vertical * 118.0)), 18.0);
        vec3 color = mix(uForest, uGreen, 0.22 + uPresence * 0.42);
        color = mix(color, uCream, fresnel * (0.12 + uAperture * 0.18));
        color = mix(color, uGoldColor, (uGold * 0.22 + vein * uGold * 0.18));
        color = mix(color, uDistressColor, uDistress * 0.66);
        float alpha = 0.025 + fresnel * (0.17 + uPresence * 0.2);
        alpha += vein * (0.008 + uPresence * 0.018);
        alpha += uEnergy * fresnel * 0.1;
        alpha = clamp(alpha, 0.0, 0.52);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return { mesh: new THREE.Mesh(geometry, material), geometry, material };
}

function makeInnerShell(uniforms) {
  const geometry = new THREE.SphereGeometry(1.18, 52, 40);
  const material = shaderMaterial({
    uniforms,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPosition;
      ${deformShader}
      void main() {
        vec3 transformed = birdieDeform(position);
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalWorld;
      varying vec3 vWorldPosition;
      uniform float uPresence;
      uniform float uAperture;
      uniform float uGold;
      uniform float uEnergy;
      uniform float uDistress;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uCream;
      uniform vec3 uDistressColor;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float facing = abs(dot(normalize(vNormalWorld), viewDirection));
        float center = pow(facing, 2.3);
        vec3 color = mix(uGreen, uCream, 0.14 + uAperture * 0.28);
        color = mix(color, uGoldColor, uGold * 0.34);
        color = mix(color, uDistressColor, uDistress * 0.7);
        float alpha = center * (0.018 + uPresence * 0.038 + uEnergy * 0.045);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return { mesh: new THREE.Mesh(geometry, material), geometry, material };
}

function makeTopology(uniforms) {
  const geometry = buildTopologyGeometry();
  const material = shaderMaterial({
    uniforms,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aBand;
      attribute float aKind;
      attribute float aAccent;
      varying float vPhase;
      varying float vBand;
      varying float vKind;
      varying float vAccent;
      ${deformShader}
      void main() {
        vec3 transformed = birdieDeform(position);
        vPhase = aPhase;
        vBand = aBand;
        vKind = aKind;
        vAccent = aAccent;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vPhase;
      varying float vBand;
      varying float vKind;
      varying float vAccent;
      uniform float uTime;
      uniform float uPresence;
      uniform float uAperture;
      uniform float uFlow;
      uniform float uGold;
      uniform float uEnergy;
      uniform float uDistress;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uCream;
      uniform vec3 uDistressColor;
      void main() {
        float dash = step(0.16, fract(vPhase * (8.0 + vKind * 4.0) - uTime * uFlow * 0.09));
        float accent = clamp(vAccent * (0.38 + uGold * 0.75), 0.0, 1.0);
        vec3 color = mix(uGreen, uCream, 0.2 + vBand * 0.18);
        color = mix(color, uGoldColor, accent);
        color = mix(color, uDistressColor, uDistress * 0.76);
        float alpha = (0.055 + uPresence * 0.22 + uEnergy * 0.14 + uAperture * 0.025);
        alpha *= mix(0.34 + dash * 0.66, 1.0, vKind);
        alpha *= 0.58 + accent * 0.42;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return {
    mesh: new THREE.LineSegments(geometry, material),
    geometry,
    material,
  };
}

function makeEchoes(uniforms) {
  const geometry = buildEchoGeometry();
  const material = shaderMaterial({
    uniforms,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aBand;
      varying float vPhase;
      varying float vBand;
      uniform float uTime;
      uniform float uFlow;
      uniform float uEnergy;
      uniform float uDirection;
      uniform float uReducedMotion;
      void main() {
        float motion = mix(1.0, 0.12, uReducedMotion);
        vec3 transformed = position;
        float wave = sin(aPhase * 30.0 - uTime * (0.22 + uFlow) * motion + aBand * 8.0);
        transformed *= 1.0 + wave * (0.003 + uEnergy * 0.022);
        transformed *= 1.0 + uEnergy * uDirection * (0.025 + aBand * 0.028);
        vPhase = aPhase;
        vBand = aBand;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vPhase;
      varying float vBand;
      uniform float uTime;
      uniform float uPresence;
      uniform float uGold;
      uniform float uEnergy;
      uniform float uDistress;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uDistressColor;
      void main() {
        float dash = step(0.58, fract(vPhase * (14.0 + vBand * 9.0) - uTime * 0.025));
        vec3 color = mix(uGreen, uGoldColor, uGold * (0.18 + vBand * 0.5));
        color = mix(color, uDistressColor, uDistress * 0.72);
        float alpha = dash * (0.018 + uPresence * 0.052 + uEnergy * 0.11) * (1.0 - vBand * 0.54);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return {
    mesh: new THREE.LineSegments(geometry, material),
    geometry,
    material,
  };
}

function makeParticles(uniforms) {
  const geometry = buildParticleGeometry();
  const material = shaderMaterial({
    uniforms,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSize;
      attribute float aGold;
      varying float vGold;
      varying float vAlpha;
      uniform float uTime;
      uniform float uPresence;
      uniform float uFlow;
      uniform float uParticle;
      uniform float uEnergy;
      uniform float uDirection;
      uniform float uAspect;
      uniform float uPixelRatio;
      uniform float uReducedMotion;
      void main() {
        float motion = mix(1.0, 0.12, uReducedMotion);
        vec3 transformed = position;
        transformed.x *= uAspect * 2.46;
        transformed.y *= 2.46;
        float drift = uTime * motion * (0.014 + uFlow * 0.055);
        transformed.x += sin(aPhase * 31.0 + drift * 4.0) * (0.015 + uFlow * 0.025);
        transformed.y += cos(aPhase * 23.0 - drift * 3.0) * (0.012 + uFlow * 0.02);
        vec2 normalized = vec2(transformed.x / max(uAspect, 0.01), transformed.y);
        float radial = length(normalized);
        transformed.xy *= 1.0 + uDirection * uEnergy * 0.035;
        vGold = aGold;
        vAlpha = (0.08 + uPresence * 0.46) * (0.35 + uParticle * 0.65) * (1.0 - smoothstep(1.4, 2.7, radial));
        gl_PointSize = aSize * uPixelRatio * (0.7 + uPresence * 0.9 + uEnergy * 0.7);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGold;
      varying float vAlpha;
      uniform float uGold;
      uniform float uDistress;
      uniform vec3 uGreen;
      uniform vec3 uGoldColor;
      uniform vec3 uCream;
      uniform vec3 uDistressColor;
      void main() {
        vec2 center = gl_PointCoord - 0.5;
        float falloff = 1.0 - smoothstep(0.08, 0.5, length(center));
        vec3 color = mix(uGreen, uCream, 0.24);
        color = mix(color, uGoldColor, vGold * (0.32 + uGold * 0.68));
        color = mix(color, uDistressColor, uDistress * 0.65);
        float alpha = falloff * vAlpha;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
  return { mesh: new THREE.Points(geometry, material), geometry, material };
}

export class BirdieField {
  constructor(
    canvas,
    {
      onReady,
      onContextState,
      onFrame,
      pixelRatioCap = Number.POSITIVE_INFINITY,
      renderScale = 1,
      antialias = true,
      powerPreference = 'high-performance',
    } = {},
  ) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('BirdieField requires a canvas element');
    }

    this.canvas = canvas;
    this.onReady = onReady;
    this.onContextState = onContextState;
    this.onFrame = onFrame;
    this.pixelRatioCap = Math.max(1, Number(pixelRatioCap) || 1);
    this.renderScale = Math.max(0.5, Math.min(1, Number(renderScale) || 1));
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      ?.matches ?? false;
    this.presenceState = 'OFFLINE';
    this.current = { ...getVisualProfile('OFFLINE') };
    this.target = { ...this.current };
    this.inputTarget = 0;
    this.inputEnvelope = 0;
    this.inputVadProbability = 0;
    this.inputUpdatedAt = 0;
    this.outputTarget = 0;
    this.outputEnvelope = 0;
    this.outputUpdatedAt = 0;
    this.lastFrameAt = 0;
    this.frameRequest = 0;
    this.running = false;
    this.contextLost = false;
    this.shaderFailed = false;
    this.firstFrameReported = false;
    this.readyReported = false;
    this.cssFrame = 0;
    this.renderedFrameCount = 0;
    this.lastRenderedAt = 0;
    this.coreHorizontalFit = 1;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias,
      premultipliedAlpha: true,
      powerPreference,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.debug.onShaderError = (
      gl,
      program,
      vertexShader,
      fragmentShader,
    ) => {
      this.shaderFailed = true;
      const programLog = gl.getProgramInfoLog(program)?.trim() || 'NO_PROGRAM_LOG';
      const vertexLog =
        gl.getShaderInfoLog(vertexShader)?.trim() || 'NO_VERTEX_LOG';
      const fragmentLog =
        gl.getShaderInfoLog(fragmentShader)?.trim() || 'NO_FRAGMENT_LOG';
      this.onContextState?.(
        'SHADER_ERROR',
        `program=${programLog} vertex=${vertexLog} fragment=${fragmentLog}`.slice(
          0,
          1_800,
        ),
      );
    };

    this.uniforms = makeUniforms();
    this.uniforms.uReducedMotion.value = this.reducedMotion ? 1 : 0;

    this.backgroundScene = new THREE.Scene();
    this.backgroundCamera = new THREE.Camera();
    const background = makeBackground(this.uniforms);
    this.backgroundScene.add(background.mesh);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 20);
    this.camera.position.set(0, 0, 6);
    this.camera.lookAt(0, 0, 0);

    this.coreGroup = new THREE.Group();
    this.scene.add(this.coreGroup);

    const inner = makeInnerShell(this.uniforms);
    const outer = makeOuterShell(this.uniforms);
    const topology = makeTopology(this.uniforms);
    this.coreGroup.add(inner.mesh, outer.mesh, topology.mesh);

    const nucleusGeometry = new THREE.SphereGeometry(0.24, 36, 28);
    const nucleusMaterial = new THREE.MeshBasicMaterial({
      color: palette.cream,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
    this.coreGroup.add(this.nucleus);

    const echoes = makeEchoes(this.uniforms);
    this.echoes = echoes.mesh;
    this.scene.add(this.echoes);

    const particles = makeParticles(this.uniforms);
    this.particles = particles.mesh;
    this.scene.add(this.particles);

    this.disposables = [
      background.geometry,
      background.material,
      inner.geometry,
      inner.material,
      outer.geometry,
      outer.material,
      topology.geometry,
      topology.material,
      nucleusGeometry,
      nucleusMaterial,
      echoes.geometry,
      echoes.material,
      particles.geometry,
      particles.material,
    ];

    this.handleResize = () => this.resize();
    this.handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(this.frameRequest);
        this.frameRequest = 0;
      } else if (this.running && !this.frameRequest) {
        this.lastFrameAt = performance.now();
        this.frameRequest = requestAnimationFrame((now) => this.frame(now));
      }
    };
    this.handleContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.onContextState?.('LOST');
    };
    this.handleContextRestored = () => {
      this.contextLost = false;
      this.shaderFailed = false;
      this.firstFrameReported = false;
      this.onContextState?.('RESTORED');
    };
  }

  setPresence(state) {
    if (!hasVisualProfile(state)) return false;
    this.presenceState = state;
    this.target = { ...getVisualProfile(state) };
    return true;
  }

  setInputAudio(signal = {}) {
    this.inputTarget = clamp01(signal.level);
    this.inputVadProbability = clamp01(signal.vadProbability);
    this.inputUpdatedAt = performance.now();
  }

  setOutputAudio(signal = {}) {
    this.outputTarget = clamp01(signal.level);
    this.outputUpdatedAt = performance.now();
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
    this.uniforms.uReducedMotion.value = this.reducedMotion ? 1 : 0;
    if (this.running) this.resize();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const viewport = computeViewport(
      bounds.width || window.innerWidth,
      bounds.height || window.innerHeight,
      Math.min(window.devicePixelRatio, this.pixelRatioCap),
      this.reducedMotion,
    );
    const renderPixelRatio = viewport.pixelRatio * this.renderScale;
    this.renderer.setPixelRatio(renderPixelRatio);
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.camera.left = -viewport.cameraHalfWidth;
    this.camera.right = viewport.cameraHalfWidth;
    this.camera.top = viewport.cameraHalfHeight;
    this.camera.bottom = -viewport.cameraHalfHeight;
    this.camera.updateProjectionMatrix();
    this.uniforms.uAspect.value = viewport.aspect;
    this.uniforms.uPixelRatio.value = viewport.pixelRatio;
    this.coreHorizontalFit = viewport.coreHorizontalFit;

    if (!this.readyReported) {
      this.readyReported = true;
      this.onReady?.({ ...viewport, pixelRatio: renderPixelRatio });
    }
    return viewport;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibility);
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    }
    this.resize();
    this.lastFrameAt = performance.now();
    this.frameRequest = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    this.frameRequest = 0;
    if (!this.running || document.hidden) return;
    // Match the declared OBS output. Rendering above 30 fps adds GPU pressure
    // without creating extra frames in the recorded program.
    const frameRate = 30;
    const schedule = scheduleRenderFrame(this.lastFrameAt, now, frameRate);
    if (!schedule.shouldRender) {
      this.frameRequest = requestAnimationFrame((next) => this.frame(next));
      return;
    }
    const deltaSeconds = schedule.deltaSeconds;
    this.lastFrameAt = schedule.lastFrameAt;

    if (now - this.inputUpdatedAt > 160) {
      this.inputTarget = 0;
      this.inputVadProbability = 0;
    }
    if (now - this.outputUpdatedAt > 160) this.outputTarget = 0;

    const inputAttack = 1 - Math.exp(-deltaSeconds * 18);
    const inputRelease = 1 - Math.exp(-deltaSeconds * 7);
    const outputAttack = 1 - Math.exp(-deltaSeconds * 22);
    const outputRelease = 1 - Math.exp(-deltaSeconds * 9);
    this.inputEnvelope = approach(
      this.inputEnvelope,
      this.inputTarget,
      inputAttack,
      inputRelease,
    );
    this.outputEnvelope = approach(
      this.outputEnvelope,
      this.outputTarget,
      outputAttack,
      outputRelease,
    );

    const reaction = deriveAudioReaction(this.presenceState, {
      inputEnvelope: this.inputEnvelope,
      outputEnvelope: this.outputEnvelope,
      vadProbability: this.inputVadProbability,
    });
    const {
      input: activeInput,
      output: activeOutput,
      energy,
      attention,
      direction,
    } = reaction;

    const profileBlend = 1 - Math.exp(-deltaSeconds * 4.8);
    for (const key of PROFILE_KEYS) {
      this.current[key] += (this.target[key] - this.current[key]) * profileBlend;
    }

    const elapsed = now / 1000;
    const motionScale = this.reducedMotion ? 0.14 : 1;
    const breath = Math.sin(elapsed * 0.72) * 0.006 * motionScale;
    const coreScale = this.current.coreScale + breath + energy * 0.015;
    this.coreGroup.scale.set(
      coreScale * this.coreHorizontalFit,
      coreScale,
      coreScale,
    );
    this.coreGroup.rotation.y +=
      deltaSeconds * (0.022 + this.current.flow * 0.092) * motionScale;
    this.coreGroup.rotation.x =
      Math.sin(elapsed * 0.19) * 0.035 * motionScale;
    this.coreGroup.rotation.z =
      Math.sin(elapsed * 0.13) * 0.018 * motionScale;
    this.echoes.rotation.z -=
      deltaSeconds * (0.006 + this.current.flow * 0.018) * motionScale;

    const nucleusPulse =
      1 +
      Math.sin(elapsed * (1.2 + this.current.flow * 1.8)) * 0.08 * motionScale +
      energy * 0.3;
    this.nucleus.scale.setScalar(nucleusPulse);
    this.nucleus.material.opacity = Math.min(
      0.82,
      0.12 + this.current.presence * 0.32 + energy * 0.32,
    );
    this.nucleus.material.color
      .copy(palette.cream)
      .lerp(palette.gold, this.current.gold * 0.42)
      .lerp(palette.distress, this.current.distress * 0.7);

    const values = {
      uTime: elapsed,
      uPresence: this.current.presence,
      uAperture: this.current.aperture,
      uFlow: this.current.flow,
      uGold: this.current.gold,
      uEdge: this.current.edge,
      uTurbulence: this.current.turbulence,
      uParticle: this.current.particle,
      uDistress: this.current.distress,
      uEnergy: energy,
      uInput: activeInput,
      uOutput: activeOutput,
      uAttention: attention,
      uDirection: direction,
    };
    for (const [key, value] of Object.entries(values)) {
      this.uniforms[key].value = value;
    }

    if (!this.contextLost && !this.shaderFailed) {
      this.renderer.clear(true, true, true);
      this.renderer.render(this.backgroundScene, this.backgroundCamera);
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
      const intervalMs = this.lastRenderedAt > 0 ? now - this.lastRenderedAt : 0;
      this.lastRenderedAt = now;
      this.renderedFrameCount += 1;
      this.onFrame?.({
        at: now,
        frameCount: this.renderedFrameCount,
        intervalMs,
      });
      if (!this.firstFrameReported && !this.shaderFailed) {
        this.firstFrameReported = true;
        this.onContextState?.(
          'RENDERED',
          `programs=${this.renderer.info.programs?.length ?? 0} drawCalls=${this.renderer.info.render.calls}`,
        );
      }
    }

    this.cssFrame += 1;
    if (this.cssFrame % 4 === 0) {
      const root = document.documentElement;
      root.style.setProperty('--birdie-energy', energy.toFixed(3));
      root.style.setProperty('--birdie-edge', this.current.edge.toFixed(3));
      root.style.setProperty('--birdie-gold', this.current.gold.toFixed(3));
      root.style.setProperty('--birdie-distress', this.current.distress.toFixed(3));
    }

    this.frameRequest = requestAnimationFrame((next) => this.frame(next));
  }

  dispose() {
    if (!this.running && !this.renderer) return;
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    for (const disposable of this.disposables) disposable.dispose();
    this.renderer.dispose();
    this.renderer = null;
  }
}
