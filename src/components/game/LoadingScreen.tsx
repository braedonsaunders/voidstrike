'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

interface LoadingScreenProps {
  progress: number;
  status: string;
  onComplete?: () => void;
}

// Phase of the loading screen
type LoadingPhase = 'loading' | 'fadeOut' | 'complete';

// Epic void nebula shader with wormhole effect
const VoidNebulaShader = {
  uniforms: {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uBrightness: { value: 0 },
    uFlicker: { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uProgress;
    uniform float uBrightness;
    uniform float uFlicker;
    uniform vec2 uMouse;
    varying vec2 vUv;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 6; i++) {
        value += amplitude * snoise(p);
        amplitude *= 0.5;
        p *= 2.0;
      }
      return value;
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5);
      vec2 toCenter = uv - center;
      float dist = length(toCenter);
      float angle = atan(toCenter.y, toCenter.x);

      // Wormhole distortion - intensifies with brightness (not loading progress)
      float wormholeStrength = 0.15 + uBrightness * 0.25;
      float spiral = angle + dist * 5.0 - uTime * (0.3 + uBrightness * 0.5);
      float wormholeEffect = sin(spiral * 3.0) * wormholeStrength * (1.0 - dist * 1.5);

      vec2 distortedUv = uv + normalize(toCenter) * wormholeEffect * 0.1;

      // Flowing nebula with time
      float time = uTime * 0.04;
      vec3 pos = vec3(distortedUv * 3.0, time);

      float n1 = fbm(pos * 1.0);
      float n2 = fbm(pos * 2.0 + vec3(100.0));
      float n3 = fbm(pos * 4.0 + vec3(200.0));

      float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
      nebula = smoothstep(-0.3, 0.8, nebula);

      // Deep void colors
      vec3 color1 = vec3(0.02, 0.0, 0.06);
      vec3 color2 = vec3(0.15, 0.0, 0.35);
      vec3 color3 = vec3(0.52, 0.24, 1.0);

      vec3 color = mix(color1, color2, nebula);
      color = mix(color, color3, pow(nebula, 2.0) * 0.4);

      // Central vortex glow - increases with brightness
      float vortexIntensity = 0.3 + uBrightness * 0.7;
      float vortex = 1.0 - smoothstep(0.0, 0.4 + uBrightness * 0.1, dist);
      vortex *= vortexIntensity;

      // Pulsing ring effect
      float ringDist = abs(dist - 0.25 - sin(uTime * 2.0) * 0.03);
      float ring = smoothstep(0.02 + uBrightness * 0.01, 0.0, ringDist) * (0.5 + uBrightness * 0.5);

      // Add energy color to vortex center
      vec3 energyColor = vec3(0.4, 0.6, 1.0);
      color += energyColor * vortex * 0.8;
      color += color3 * ring * 0.6;

      // Energy streams
      float energy = pow(max(0.0, snoise(pos * 3.0 + vec3(uTime * 0.15))), 3.0);
      color += vec3(0.6, 0.3, 1.0) * energy * 0.6;

      // Outer vignette
      float vignette = 1.0 - smoothstep(0.3, 0.9, dist);
      color *= vignette;

      // Brightness-based intensity boost (decoupled from loading)
      float brightnessBoost = 0.6 + uBrightness * 0.6;
      color *= brightnessBoost;

      // Flicker effect - subtle random brightness variation
      color *= (1.0 + uFlicker * 0.15);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Wormhole tunnel shader for central effect
const WormholeShader = {
  uniforms: {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uBrightness: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uProgress;
    uniform float uBrightness;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 uv = vUv - center;
      float dist = length(uv);
      float angle = atan(uv.y, uv.x);

      // Rotating tunnel rings - use brightness for intensity
      float tunnelSpeed = 2.0 + uBrightness * 3.0;
      float rings = sin((dist * 20.0 - uTime * tunnelSpeed) + angle * 2.0);
      rings = smoothstep(0.0, 1.0, rings);

      // Spiral arms
      float spiralCount = 4.0;
      float spiral = sin(angle * spiralCount - uTime * 1.5 - dist * 8.0);
      spiral = pow(max(0.0, spiral), 2.0);

      // Fade toward edges
      float fade = 1.0 - smoothstep(0.0, 0.5, dist);
      fade = pow(fade, 1.5);

      // Inner core glow
      float core = 1.0 - smoothstep(0.0, 0.15, dist);
      core = pow(core, 2.0);

      // Combine effects - use brightness
      float intensity = (rings * 0.3 + spiral * 0.5 + core) * fade;
      intensity *= 0.5 + uBrightness * 0.5;

      // Color gradient: cyan core -> purple edges
      vec3 coreColor = vec3(0.3, 0.8, 1.0);
      vec3 edgeColor = vec3(0.6, 0.2, 1.0);
      vec3 color = mix(coreColor, edgeColor, dist * 2.0);

      gl_FragColor = vec4(color * intensity, intensity * 0.8);
    }
  `,
};

// Chromatic aberration
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.004 },
    uTime: { value: 0 },
    uBrightness: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uBrightness;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vUv - center;
      float dist = length(dir);

      // Aberration varies with brightness
      float intensity = uIntensity * (1.5 - uBrightness * 0.3);
      intensity *= (1.0 + sin(uTime * 0.5) * 0.15);
      vec2 offset = dir * dist * intensity;

      float r = texture2D(tDiffuse, vUv + offset * 1.2).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// Scanline + CRT effect shader
const ScanlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uBrightness: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uBrightness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Subtle scanlines - reduce as brightness increases
      float scanline = sin(vUv.y * 400.0) * 0.02 * (1.0 - uBrightness * 0.5);
      color.rgb -= scanline;

      // Moving scan beam
      float beam = smoothstep(0.0, 0.1, abs(vUv.y - mod(uTime * 0.15, 1.2)));
      color.rgb += (1.0 - beam) * 0.03 * vec3(0.3, 0.5, 1.0);

      // Vignette
      vec2 center = vec2(0.5);
      float dist = distance(vUv, center);
      float vignette = smoothstep(0.8, 0.4, dist);
      color.rgb *= 0.7 + vignette * 0.3;

      gl_FragColor = color;
    }
  `,
};

interface Asteroid {
  mesh: THREE.Mesh;
  rotationSpeed: THREE.Vector3;
  orbitRadius: number;
  orbitSpeed: number;
  orbitOffset: number;
  verticalOffset: number;
}

export function LoadingScreen({ progress, status, onComplete }: LoadingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const starsRef = useRef<THREE.Points | null>(null);
  const nebulaRef = useRef<THREE.Mesh | null>(null);
  const wormholeRef = useRef<THREE.Mesh | null>(null);
  const asteroidsRef = useRef<Asteroid[]>([]);
  const energyRingsRef = useRef<THREE.Mesh[]>([]);
  const particleSystemRef = useRef<THREE.Points | null>(null);
  const progressRef = useRef(progress);

  // Independent visual animation state
  const [visualBrightness, setVisualBrightness] = useState(0);
  const [flickerValue, setFlickerValue] = useState(0);
  const [phase, setPhase] = useState<LoadingPhase>('loading');
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [dots, setDots] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  const visualBrightnessRef = useRef(0);
  const flickerRef = useRef(0);
  const phaseRef = useRef<LoadingPhase>('loading');
  const brightnessRafRef = useRef<number | null>(null);
  const fadeRafRef = useRef<number | null>(null);

  // Update refs for animation loop
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    visualBrightnessRef.current = visualBrightness;
  }, [visualBrightness]);

  useEffect(() => {
    flickerRef.current = flickerValue;
  }, [flickerValue]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Animate loading dots
  useEffect(() => {
    if (phase !== 'loading') return;
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 350);
    return () => clearInterval(interval);
  }, [phase]);

  // Independent brightness animation - smooth ramp over ~8 seconds with easing
  useEffect(() => {
    const startTime = Date.now();
    const duration = 8000; // 8 seconds to reach full brightness

    const animateBrightness = () => {
      if (phaseRef.current !== 'loading') return;

      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3);
      setVisualBrightness(eased);

      if (t < 1) {
        brightnessRafRef.current = requestAnimationFrame(animateBrightness);
      }
    };

    brightnessRafRef.current = requestAnimationFrame(animateBrightness);

    return () => {
      if (brightnessRafRef.current !== null) {
        cancelAnimationFrame(brightnessRafRef.current);
        brightnessRafRef.current = null;
      }
    };
  }, []);

  // Flicker effect - random subtle brightness variations
  useEffect(() => {
    if (phase !== 'loading') return;

    const flickerInterval = setInterval(() => {
      // Random flicker: mostly subtle, occasionally more intense
      const intensity = Math.random();
      if (intensity > 0.95) {
        // Rare bright flash
        setFlickerValue(0.3 + Math.random() * 0.2);
      } else if (intensity > 0.85) {
        // Occasional medium flicker
        setFlickerValue(0.1 + Math.random() * 0.15);
      } else {
        // Normal subtle variation
        setFlickerValue((Math.random() - 0.5) * 0.1);
      }
    }, 100);

    return () => clearInterval(flickerInterval);
  }, [phase]);

  // Transition to fadeOut when loading completes
  useEffect(() => {
    if (progress >= 100 && phase === 'loading') {
      // Brief pause at full brightness, then start fade
      const timer = setTimeout(() => {
        setPhase('fadeOut');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [progress, phase]);

  // Fade to black animation
  useEffect(() => {
    if (phase !== 'fadeOut') return;

    const startTime = Date.now();
    const duration = 1200; // 1.2 second fade to black

    const animateFade = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease-in for dramatic effect
      const eased = t * t;
      setFadeOpacity(eased);

      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(animateFade);
      } else {
        // Fade complete - signal completion, Phaser overlay will handle countdown
        setPhase('complete');
        onComplete?.();
      }
    };

    fadeRafRef.current = requestAnimationFrame(animateFade);

    return () => {
      if (fadeRafRef.current !== null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
    };
  }, [phase, onComplete]);

  // Loading stage thresholds
  const loadingStages = useMemo(() => [
    { name: 'CORE', threshold: 20 },
    { name: 'RENDER', threshold: 40 },
    { name: 'WORLD', threshold: 60 },
    { name: 'UNITS', threshold: 80 },
    { name: 'SYNC', threshold: 95 },
  ], []);

  // Create starfield
  const createStarField = useCallback((scene: THREE.Scene) => {
    const starCount = 4000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const twinklePhases = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 30 + Math.random() * 170;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      const colorChoice = Math.random();
      if (colorChoice < 0.6) {
        colors[i3] = 1; colors[i3 + 1] = 1; colors[i3 + 2] = 1;
      } else if (colorChoice < 0.8) {
        colors[i3] = 0.6; colors[i3 + 1] = 0.7; colors[i3 + 2] = 1;
      } else {
        colors[i3] = 0.9; colors[i3 + 1] = 0.6; colors[i3 + 2] = 1;
      }

      sizes[i] = Math.random() * 2.5 + 0.3;
      twinklePhases[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('twinklePhase', new THREE.BufferAttribute(twinklePhases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute float twinklePhase;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float uTime;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

          float twinkle = sin(uTime * 3.0 + twinklePhase) * 0.4 + 0.6;
          vTwinkle = twinkle;

          gl_PointSize = size * uPixelRatio * (250.0 / -mvPosition.z) * twinkle;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          float glow = exp(-dist * 5.0);

          vec3 color = vColor + vec3(0.4) * glow;
          gl_FragColor = vec4(color, alpha * vTwinkle);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
    starsRef.current = stars;
  }, []);

  // Create nebula background
  const createNebula = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(200, 200);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...VoidNebulaShader.uniforms },
      vertexShader: VoidNebulaShader.vertexShader,
      fragmentShader: VoidNebulaShader.fragmentShader,
      side: THREE.DoubleSide,
    });

    const nebula = new THREE.Mesh(geometry, material);
    nebula.position.z = -40;
    scene.add(nebula);
    nebulaRef.current = nebula;
  }, []);

  // Create central wormhole effect
  const createWormhole = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(8, 8);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...WormholeShader.uniforms },
      vertexShader: WormholeShader.vertexShader,
      fragmentShader: WormholeShader.fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const wormhole = new THREE.Mesh(geometry, material);
    wormhole.position.z = -5;
    scene.add(wormhole);
    wormholeRef.current = wormhole;
  }, []);

  // Create orbiting asteroids
  const createAsteroids = useCallback((scene: THREE.Scene) => {
    const asteroidCount = 12;
    const asteroids: Asteroid[] = [];

    for (let i = 0; i < asteroidCount; i++) {
      const size = 0.15 + Math.random() * 0.35;
      const geometry = new THREE.IcosahedronGeometry(size, 1);

      const posAttr = geometry.getAttribute('position');
      for (let j = 0; j < posAttr.count; j++) {
        const noise = 0.7 + Math.random() * 0.6;
        posAttr.setXYZ(
          j,
          posAttr.getX(j) * noise,
          posAttr.getY(j) * noise,
          posAttr.getZ(j) * noise
        );
      }
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x1a0a2a),
        roughness: 0.85,
        metalness: 0.15,
        emissive: new THREE.Color(0x2a1a4a),
        emissiveIntensity: 0.3,
      });

      const mesh = new THREE.Mesh(geometry, material);

      const orbitRadius = 6 + Math.random() * 8;
      const orbitSpeed = 0.1 + Math.random() * 0.2;
      const orbitOffset = (i / asteroidCount) * Math.PI * 2;
      const verticalOffset = (Math.random() - 0.5) * 4;

      mesh.position.set(
        Math.cos(orbitOffset) * orbitRadius,
        verticalOffset,
        Math.sin(orbitOffset) * orbitRadius - 10
      );

      scene.add(mesh);
      asteroids.push({
        mesh,
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.02
        ),
        orbitRadius,
        orbitSpeed,
        orbitOffset,
        verticalOffset,
      });
    }

    asteroidsRef.current = asteroids;
  }, []);

  // Create energy rings around wormhole
  const createEnergyRings = useCallback((scene: THREE.Scene) => {
    const rings: THREE.Mesh[] = [];
    const ringCount = 5;

    for (let i = 0; i < ringCount; i++) {
      const innerRadius = 1.5 + i * 0.8;
      const outerRadius = innerRadius + 0.08;
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.7 - i * 0.05, 0.8, 0.6),
        transparent: true,
        opacity: 0.4 - i * 0.06,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });

      const ring = new THREE.Mesh(geometry, material);
      ring.position.z = -5;
      ring.rotation.x = Math.PI * 0.1;
      scene.add(ring);
      rings.push(ring);
    }

    energyRingsRef.current = rings;
  }, []);

  // Create converging particle system
  const createParticleSystem = useCallback((scene: THREE.Scene) => {
    const particleCount = 300;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const lifetimes = new Float32Array(particleCount);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const angle = Math.random() * Math.PI * 2;
      const radius = 15 + Math.random() * 20;

      positions[i3] = Math.cos(angle) * radius;
      positions[i3 + 1] = (Math.random() - 0.5) * 15;
      positions[i3 + 2] = Math.sin(angle) * radius - 10;

      const toCenter = new THREE.Vector3(-positions[i3], -positions[i3 + 1], -5 - positions[i3 + 2]);
      toCenter.normalize().multiplyScalar(0.05 + Math.random() * 0.05);
      velocities[i3] = toCenter.x;
      velocities[i3 + 1] = toCenter.y;
      velocities[i3 + 2] = toCenter.z;

      lifetimes[i] = Math.random();
      sizes[i] = 0.5 + Math.random() * 1.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute float lifetime;
        uniform float uTime;
        uniform float uBrightness;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vLife;

        void main() {
          vLife = lifetime;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

          float fadeIn = smoothstep(0.0, 0.2, lifetime);
          float fadeOut = 1.0 - smoothstep(0.8, 1.0, lifetime);
          vAlpha = fadeIn * fadeOut * (0.5 + uBrightness * 0.5);

          float speedMultiplier = 1.0 + uBrightness * 2.0;
          gl_PointSize = size * uPixelRatio * (80.0 / -mvPosition.z) * (1.0 + uBrightness * 0.5);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vLife;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          float alpha = (1.0 - dist * 2.0) * vAlpha;
          float glow = exp(-dist * 4.0);

          vec3 color = mix(vec3(0.4, 0.6, 1.0), vec3(0.8, 0.4, 1.0), vLife);
          color += vec3(0.3, 0.2, 0.4) * glow;

          gl_FragColor = vec4(color, alpha * 0.6);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particleSystemRef.current = particles;
  }, []);

  // Create lighting
  const createLighting = useCallback((scene: THREE.Scene) => {
    const ambient = new THREE.AmbientLight(0x1a0a2a, 0.4);
    scene.add(ambient);

    const mainLight = new THREE.PointLight(0x843dff, 3, 60);
    mainLight.position.set(0, 0, 5);
    scene.add(mainLight);

    const blueLight = new THREE.PointLight(0x4a90d9, 2, 50);
    blueLight.position.set(-8, 4, -5);
    scene.add(blueLight);

    const cyanLight = new THREE.PointLight(0x40ffff, 1.5, 40);
    cyanLight.position.set(8, -4, -5);
    scene.add(cyanLight);
  }, []);

  // Setup post-processing
  const setupPostProcessing = useCallback(
    (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      const composer = new EffectComposer(renderer);

      composer.addPass(new RenderPass(scene, camera));

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.2,
        0.5,
        0.7
      );
      composer.addPass(bloomPass);

      const chromaticPass = new ShaderPass(ChromaticAberrationShader);
      composer.addPass(chromaticPass);

      const scanlinePass = new ShaderPass(ScanlineShader);
      composer.addPass(scanlinePass);

      return composer;
    },
    []
  );

  // Update particle system
  const updateParticles = useCallback(() => {
    if (!particleSystemRef.current) return;

    const geometry = particleSystemRef.current.geometry;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const velocities = geometry.getAttribute('velocity') as THREE.BufferAttribute;
    const lifetimes = geometry.getAttribute('lifetime') as THREE.BufferAttribute;

    const posArray = positions.array as Float32Array;
    const velArray = velocities.array as Float32Array;
    const lifeArray = lifetimes.array as Float32Array;

    const speedMult = 1 + visualBrightnessRef.current * 2;

    for (let i = 0; i < lifeArray.length; i++) {
      const i3 = i * 3;
      lifeArray[i] += 0.005 * speedMult;

      if (lifeArray[i] > 1) {
        lifeArray[i] = 0;
        const angle = Math.random() * Math.PI * 2;
        const radius = 15 + Math.random() * 20;
        posArray[i3] = Math.cos(angle) * radius;
        posArray[i3 + 1] = (Math.random() - 0.5) * 15;
        posArray[i3 + 2] = Math.sin(angle) * radius - 10;

        const toCenter = new THREE.Vector3(-posArray[i3], -posArray[i3 + 1], -5 - posArray[i3 + 2]);
        toCenter.normalize().multiplyScalar(0.05 + Math.random() * 0.05);
        velArray[i3] = toCenter.x;
        velArray[i3 + 1] = toCenter.y;
        velArray[i3 + 2] = toCenter.z;
      } else {
        posArray[i3] += velArray[i3] * speedMult;
        posArray[i3 + 1] += velArray[i3 + 1] * speedMult;
        posArray[i3 + 2] += velArray[i3 + 2] * speedMult;
      }
    }

    positions.needsUpdate = true;
    lifetimes.needsUpdate = true;
  }, []);

  // Main scene initialization
  useEffect(() => {
    if (!containerRef.current) return;

    // Store reference for cleanup (containerRef.current may change by cleanup time)
    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050010, 0.015);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      250
    );
    camera.position.set(0, 0, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create scene elements
    createNebula(scene);
    createStarField(scene);
    createWormhole(scene);
    createEnergyRings(scene);
    createAsteroids(scene);
    createParticleSystem(scene);
    createLighting(scene);

    const composer = setupPostProcessing(renderer, scene, camera);
    composerRef.current = composer;

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };
    window.addEventListener('mousemove', handleMouseMove);

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.016;
      const time = timeRef.current;
      const brightness = visualBrightnessRef.current;
      const flicker = flickerRef.current;

      // Update nebula with independent brightness
      if (nebulaRef.current) {
        const mat = nebulaRef.current.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = time;
        mat.uniforms.uBrightness.value = brightness;
        mat.uniforms.uFlicker.value = flicker;
        mat.uniforms.uMouse.value.set(mouseRef.current.x, mouseRef.current.y);
      }

      // Update wormhole with brightness
      if (wormholeRef.current) {
        const mat = wormholeRef.current.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = time;
        mat.uniforms.uBrightness.value = brightness;
        wormholeRef.current.scale.setScalar(1 + brightness * 0.3);
      }

      // Update stars
      if (starsRef.current) {
        const mat = starsRef.current.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = time;
        starsRef.current.rotation.y += 0.0002;
        starsRef.current.rotation.x += 0.00005;
      }

      // Update energy rings
      energyRingsRef.current.forEach((ring, i) => {
        const direction = i % 2 === 0 ? 1 : -1;
        ring.rotation.z += 0.002 * direction * (1 + brightness * 2);
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.opacity = (0.3 - i * 0.05) * (0.5 + brightness * 0.5);
      });

      // Update asteroids
      asteroidsRef.current.forEach((asteroid) => {
        asteroid.mesh.rotation.x += asteroid.rotationSpeed.x;
        asteroid.mesh.rotation.y += asteroid.rotationSpeed.y;
        asteroid.mesh.rotation.z += asteroid.rotationSpeed.z;

        const angle = asteroid.orbitOffset + time * asteroid.orbitSpeed * 0.1;
        asteroid.mesh.position.x = Math.cos(angle) * asteroid.orbitRadius;
        asteroid.mesh.position.z = Math.sin(angle) * asteroid.orbitRadius - 10;
        asteroid.mesh.position.y = asteroid.verticalOffset + Math.sin(time * 0.5 + asteroid.orbitOffset) * 0.5;
      });

      // Update particles
      updateParticles();
      if (particleSystemRef.current) {
        const mat = particleSystemRef.current.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = time;
        mat.uniforms.uBrightness.value = brightness;
      }

      // Camera breathing and mouse follow
      const targetX = (mouseRef.current.x - 0.5) * 1.5;
      const targetY = (mouseRef.current.y - 0.5) * -0.8;
      camera.position.x += (targetX - camera.position.x) * 0.02;
      camera.position.y += (targetY - camera.position.y) * 0.02;
      camera.position.x += Math.sin(time * 0.3) * 0.02;
      camera.position.y += Math.cos(time * 0.2) * 0.015;
      camera.lookAt(0, 0, -10);

      // Update post-processing with brightness
      const chromaticPass = composer.passes[2] as ShaderPass;
      if (chromaticPass?.uniforms) {
        chromaticPass.uniforms.uTime.value = time;
        chromaticPass.uniforms.uBrightness.value = brightness;
      }
      const scanlinePass = composer.passes[3] as ShaderPass;
      if (scanlinePass?.uniforms) {
        scanlinePass.uniforms.uTime.value = time;
        scanlinePass.uniforms.uBrightness.value = brightness;
      }

      composer.render();
    };

    animate();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);

      // Dispose star field
      if (starsRef.current) {
        starsRef.current.geometry.dispose();
        (starsRef.current.material as THREE.Material).dispose();
        scene.remove(starsRef.current);
        starsRef.current = null;
      }

      // Dispose nebula
      if (nebulaRef.current) {
        nebulaRef.current.geometry.dispose();
        (nebulaRef.current.material as THREE.Material).dispose();
        scene.remove(nebulaRef.current);
        nebulaRef.current = null;
      }

      // Dispose wormhole
      if (wormholeRef.current) {
        wormholeRef.current.geometry.dispose();
        (wormholeRef.current.material as THREE.Material).dispose();
        scene.remove(wormholeRef.current);
        wormholeRef.current = null;
      }

      // Dispose asteroids
      for (const asteroid of asteroidsRef.current) {
        asteroid.mesh.geometry.dispose();
        (asteroid.mesh.material as THREE.Material).dispose();
        scene.remove(asteroid.mesh);
      }
      asteroidsRef.current = [];

      // Dispose energy rings
      for (const ring of energyRingsRef.current) {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        scene.remove(ring);
      }
      energyRingsRef.current = [];

      // Dispose particle system
      if (particleSystemRef.current) {
        particleSystemRef.current.geometry.dispose();
        (particleSystemRef.current.material as THREE.Material).dispose();
        scene.remove(particleSystemRef.current);
        particleSystemRef.current = null;
      }

      // Dispose composer passes
      if (composerRef.current) {
        for (const pass of composerRef.current.passes) {
          if ('dispose' in pass && typeof pass.dispose === 'function') {
            pass.dispose();
          }
        }
        composerRef.current = null;
      }

      renderer.dispose();
      if (container?.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    createStarField,
    createNebula,
    createWormhole,
    createEnergyRings,
    createAsteroids,
    createParticleSystem,
    createLighting,
    setupPostProcessing,
    updateParticles,
  ]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Three.js canvas container */}
      <div ref={containerRef} className="absolute inset-0" style={{ background: '#030008' }} />

      {/* UI Overlay - only show during loading phase */}
      {phase === 'loading' && (
        <div
          className={`absolute inset-0 flex flex-col transition-opacity duration-1000 ${
            isVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Title - centered in upper area */}
          <div className="flex-1 flex items-center justify-center">
            <div className="relative z-10 flex flex-col items-center p-8">
              <div className="text-center">
                <h1
                  className="text-7xl font-black tracking-[0.2em] mb-3 relative"
                  style={{
                    background: 'linear-gradient(135deg, #60a0ff 0%, #a855f7 50%, #40ffff 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 30px rgba(168, 85, 247, 0.6)) drop-shadow(0 0 60px rgba(96, 160, 255, 0.4))',
                  }}
                >
                  VOIDSTRIKE
                </h1>
                <div
                  className="text-sm tracking-[0.4em] uppercase font-medium"
                  style={{
                    color: 'rgba(160, 180, 255, 0.8)',
                    textShadow: '0 0 20px rgba(160, 180, 255, 0.4)',
                  }}
                >
                  Initializing Combat Systems
                </div>
              </div>

              {/* Quote */}
              <div className="mt-8 text-center">
                <p
                  className="text-xs italic tracking-wide"
                  style={{
                    color: 'rgba(140, 150, 180, 0.6)',
                    textShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  &quot;In the void, only the prepared survive.&quot;
                </p>
              </div>
            </div>
          </div>

          {/* Loading stages and progress bar - bottom third */}
          <div className="relative z-10 flex flex-col items-center gap-4 p-8 pb-16">
            {/* Loading stages */}
            <div className="flex gap-3">
              {loadingStages.map((stage, i) => {
                const isComplete = progress >= stage.threshold;
                const isActive = progress >= (loadingStages[i - 1]?.threshold || 0) && progress < stage.threshold;
                return (
                  <div
                    key={stage.name}
                    className={`relative px-4 py-2 rounded-sm text-xs font-mono font-bold tracking-wider transition-all duration-500 border ${
                      isComplete
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                        : isActive
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                        : 'bg-void-900/30 text-void-600 border-void-700/30'
                    }`}
                    style={{
                      boxShadow: isComplete
                        ? '0 0 20px rgba(6, 182, 212, 0.3), inset 0 0 10px rgba(6, 182, 212, 0.1)'
                        : isActive
                        ? '0 0 20px rgba(168, 85, 247, 0.3), inset 0 0 10px rgba(168, 85, 247, 0.1)'
                        : 'none',
                    }}
                  >
                    {stage.name}
                    {isActive && (
                      <div className="absolute inset-0 rounded-sm animate-pulse bg-purple-500/10" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-md">
              <div
                className="relative h-2 rounded-full overflow-hidden"
                style={{
                  background: 'rgba(10, 10, 30, 0.8)',
                  border: '1px solid rgba(100, 130, 200, 0.2)',
                  boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.5)',
                }}
              >
                {/* Animated background */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(100, 150, 255, 0.1), transparent)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite linear',
                  }}
                />
                {/* Progress fill */}
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out relative"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)',
                    boxShadow: '0 0 20px rgba(139, 92, 246, 0.6), 0 0 40px rgba(96, 160, 255, 0.4)',
                  }}
                >
                  {/* Glow tip */}
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 -mr-2 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(6,182,212,0.5) 50%, transparent 70%)',
                      filter: 'blur(2px)',
                    }}
                  />
                </div>
              </div>

              {/* Status and percentage */}
              <div className="flex items-center justify-between mt-3 px-1">
                <span
                  className="text-sm font-medium tracking-wide"
                  style={{
                    color: 'rgba(180, 190, 220, 0.9)',
                    textShadow: '0 0 10px rgba(100, 150, 255, 0.3)',
                  }}
                >
                  {status}{dots}
                </span>
                <span
                  className="text-lg font-mono font-bold tracking-wider"
                  style={{
                    background: 'linear-gradient(135deg, #40ffff, #60a0ff)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 8px rgba(64, 255, 255, 0.5))',
                  }}
                >
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fade to black overlay */}
      <div
        className="absolute inset-0 bg-black pointer-events-none z-20 transition-opacity"
        style={{ opacity: fadeOpacity }}
      />

      {/* Animations */}
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
