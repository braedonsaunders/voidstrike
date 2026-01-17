'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Custom void nebula shader
const VoidNebulaShader = {
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uColor1: { value: new THREE.Color(0x1a0033) },
    uColor2: { value: new THREE.Color(0x4a0080) },
    uColor3: { value: new THREE.Color(0x843dff) },
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
    uniform vec2 uResolution;
    uniform vec2 uMouse;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    varying vec2 vUv;

    // Simplex noise functions
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
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 6; i++) {
        value += amplitude * snoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    void main() {
      vec2 uv = vUv;
      vec2 mouseInfluence = (uMouse - 0.5) * 0.1;

      // Create flowing void nebula
      float time = uTime * 0.05;
      vec3 pos = vec3(uv * 3.0 + mouseInfluence, time);

      // Multiple layers of noise for depth
      float n1 = fbm(pos * 1.0);
      float n2 = fbm(pos * 2.0 + vec3(100.0));
      float n3 = fbm(pos * 4.0 + vec3(200.0));

      // Combine noise layers
      float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
      nebula = smoothstep(-0.3, 0.8, nebula);

      // Color gradient based on noise
      vec3 color = mix(uColor1, uColor2, nebula);
      color = mix(color, uColor3, pow(nebula, 2.0) * 0.5);

      // Add bright energy streams
      float energy = pow(max(0.0, snoise(pos * 3.0 + vec3(uTime * 0.1))), 3.0);
      color += vec3(0.6, 0.3, 1.0) * energy * 0.8;

      // Vignette
      float vignette = 1.0 - length((uv - 0.5) * 1.2);
      vignette = smoothstep(0.0, 0.7, vignette);
      color *= vignette;

      // Add subtle pulsing
      float pulse = sin(uTime * 0.5) * 0.1 + 0.9;
      color *= pulse;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Chromatic aberration post-processing shader
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.003 },
    uTime: { value: 0 },
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
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vUv - center;
      float dist = length(dir);

      float intensity = uIntensity * (1.0 + sin(uTime * 0.3) * 0.2);
      vec2 offset = dir * dist * intensity;

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDarkness: { value: 0.6 },
    uOffset: { value: 0.9 },
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
    uniform float uDarkness;
    uniform float uOffset;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 center = vec2(0.5);
      float dist = distance(vUv, center);
      float vignette = smoothstep(uOffset, uOffset - 0.5, dist);
      color.rgb = mix(color.rgb * (1.0 - uDarkness), color.rgb, vignette);
      gl_FragColor = color;
    }
  `,
};

interface Asteroid {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  rotationSpeed: THREE.Vector3;
  originalPosition: THREE.Vector3;
}

interface EnergyStream {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  lifetimes: Float32Array;
}

export default function HomeBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const targetCameraRef = useRef({ x: 0, y: 0, z: 5 });
  const asteroidsRef = useRef<Asteroid[]>([]);
  const starsRef = useRef<THREE.Points | null>(null);
  const energyStreamsRef = useRef<EnergyStream[]>([]);
  const nebulaRef = useRef<THREE.Mesh | null>(null);
  const timeRef = useRef(0);

  const createStarField = useCallback((scene: THREE.Scene) => {
    const starCount = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      // Distribute stars in a sphere
      const radius = 50 + Math.random() * 150;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      // Star colors - mostly white with some blue/purple tints
      const colorChoice = Math.random();
      if (colorChoice < 0.7) {
        colors[i3] = 1;
        colors[i3 + 1] = 1;
        colors[i3 + 2] = 1;
      } else if (colorChoice < 0.85) {
        colors[i3] = 0.7;
        colors[i3 + 1] = 0.8;
        colors[i3 + 2] = 1;
      } else {
        colors[i3] = 0.9;
        colors[i3 + 1] = 0.7;
        colors[i3 + 2] = 1;
      }

      sizes[i] = Math.random() * 2 + 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

          // Twinkle effect
          float twinkle = sin(uTime * 2.0 + position.x * 0.1 + position.y * 0.1) * 0.3 + 0.7;

          gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z) * twinkle;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;

          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          float glow = exp(-dist * 4.0);

          vec3 color = vColor + vec3(0.3) * glow;
          gl_FragColor = vec4(color, alpha);
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

  const createAsteroids = useCallback((scene: THREE.Scene) => {
    const asteroidCount = 15;
    const asteroids: Asteroid[] = [];

    for (let i = 0; i < asteroidCount; i++) {
      // Create irregular asteroid geometry
      const geometry = new THREE.IcosahedronGeometry(
        0.3 + Math.random() * 0.7,
        1
      );

      // Deform vertices for more natural look
      const positionAttribute = geometry.getAttribute('position');
      for (let j = 0; j < positionAttribute.count; j++) {
        const x = positionAttribute.getX(j);
        const y = positionAttribute.getY(j);
        const z = positionAttribute.getZ(j);
        const noise = 0.8 + Math.random() * 0.4;
        positionAttribute.setXYZ(j, x * noise, y * noise, z * noise);
      }
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2a1a3a),
        roughness: 0.9,
        metalness: 0.1,
        emissive: new THREE.Color(0x1a0a2a),
        emissiveIntensity: 0.2,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Position asteroids in a ring around the camera
      const angle = (i / asteroidCount) * Math.PI * 2;
      const radius = 8 + Math.random() * 12;
      const height = (Math.random() - 0.5) * 10;

      mesh.position.set(
        Math.cos(angle) * radius,
        height,
        Math.sin(angle) * radius - 5
      );

      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      scene.add(mesh);

      asteroids.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.002,
          (Math.random() - 0.5) * 0.001,
          (Math.random() - 0.5) * 0.002
        ),
        rotationSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 0.005,
          (Math.random() - 0.5) * 0.005,
          (Math.random() - 0.5) * 0.005
        ),
        originalPosition: mesh.position.clone(),
      });
    }

    asteroidsRef.current = asteroids;
  }, []);

  const createEnergyStreams = useCallback((scene: THREE.Scene) => {
    const streamCount = 4;
    const streams: EnergyStream[] = [];

    for (let s = 0; s < streamCount; s++) {
      const particleCount = 100;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const velocities = new Float32Array(particleCount * 3);
      const lifetimes = new Float32Array(particleCount);
      const sizes = new Float32Array(particleCount);

      // Stream origin - push further back and to the sides
      const originAngle = (s / streamCount) * Math.PI * 2;
      const originRadius = 25 + Math.random() * 15;
      const originX = Math.cos(originAngle) * originRadius;
      const originY = (Math.random() - 0.5) * 6;
      const originZ = Math.sin(originAngle) * originRadius - 25;

      for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        positions[i3] = originX + (Math.random() - 0.5) * 3;
        positions[i3 + 1] = originY + (Math.random() - 0.5) * 3;
        positions[i3 + 2] = originZ + (Math.random() - 0.5) * 3;

        // Velocity toward center - much slower
        const toCenter = new THREE.Vector3(-originX, -originY, -originZ + 5);
        toCenter.normalize();
        toCenter.multiplyScalar(0.008 + Math.random() * 0.012);

        velocities[i3] = toCenter.x + (Math.random() - 0.5) * 0.005;
        velocities[i3 + 1] = toCenter.y + (Math.random() - 0.5) * 0.005;
        velocities[i3 + 2] = toCenter.z + (Math.random() - 0.5) * 0.005;

        lifetimes[i] = Math.random();
        sizes[i] = Math.random() * 1.5 + 0.5;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(0x843dff) },
          uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        },
        vertexShader: `
          attribute float size;
          uniform float uTime;
          uniform float uPixelRatio;
          varying float vAlpha;

          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vAlpha = 1.0 - smoothstep(0.0, 30.0, -mvPosition.z);
            gl_PointSize = size * uPixelRatio * (120.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vAlpha;

          void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;

            float alpha = (1.0 - dist * 2.0) * vAlpha;
            float glow = exp(-dist * 4.0);

            vec3 color = uColor + vec3(0.3, 0.2, 0.5) * glow;
            gl_FragColor = vec4(color, alpha * 0.2);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);

      streams.push({
        points,
        positions,
        velocities,
        lifetimes,
      });
    }

    energyStreamsRef.current = streams;
  }, []);

  const createNebulaBackground = useCallback((scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(200, 200);
    const material = new THREE.ShaderMaterial({
      uniforms: VoidNebulaShader.uniforms,
      vertexShader: VoidNebulaShader.vertexShader,
      fragmentShader: VoidNebulaShader.fragmentShader,
      side: THREE.DoubleSide,
    });

    const nebula = new THREE.Mesh(geometry, material);
    nebula.position.z = -30;
    scene.add(nebula);
    nebulaRef.current = nebula;
  }, []);

  const createLighting = useCallback((scene: THREE.Scene) => {
    // Ambient light for base visibility
    const ambient = new THREE.AmbientLight(0x1a0a2a, 0.5);
    scene.add(ambient);

    // Main purple light
    const mainLight = new THREE.PointLight(0x843dff, 2, 50);
    mainLight.position.set(0, 5, 5);
    scene.add(mainLight);

    // Secondary blue light
    const blueLight = new THREE.PointLight(0x4a90d9, 1.5, 40);
    blueLight.position.set(-10, -3, 0);
    scene.add(blueLight);

    // Accent light
    const accentLight = new THREE.PointLight(0x9f75ff, 1, 30);
    accentLight.position.set(10, 2, -5);
    scene.add(accentLight);
  }, []);

  const setupPostProcessing = useCallback(
    (
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.PerspectiveCamera
    ) => {
      const composer = new EffectComposer(renderer);

      // Render pass
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      // Bloom pass for glowing effects
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.8, // strength
        0.4, // radius
        0.85 // threshold
      );
      composer.addPass(bloomPass);

      // Chromatic aberration
      const chromaticPass = new ShaderPass(ChromaticAberrationShader);
      composer.addPass(chromaticPass);

      // Vignette
      const vignettePass = new ShaderPass(VignetteShader);
      composer.addPass(vignettePass);

      return composer;
    },
    []
  );

  const updateEnergyStreams = useCallback(() => {
    energyStreamsRef.current.forEach((stream) => {
      const positions = stream.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;

      for (let i = 0; i < stream.lifetimes.length; i++) {
        const i3 = i * 3;
        stream.lifetimes[i] += 0.002; // Much slower lifetime

        if (stream.lifetimes[i] > 1) {
          // Reset particle - spawn far away
          stream.lifetimes[i] = 0;
          const originAngle = Math.random() * Math.PI * 2;
          const originRadius = 25 + Math.random() * 15;
          posArray[i3] = Math.cos(originAngle) * originRadius;
          posArray[i3 + 1] = (Math.random() - 0.5) * 6;
          posArray[i3 + 2] = Math.sin(originAngle) * originRadius - 25;

          const toCenter = new THREE.Vector3(
            -posArray[i3],
            -posArray[i3 + 1],
            -posArray[i3 + 2] + 5
          );
          toCenter.normalize();
          toCenter.multiplyScalar(0.008 + Math.random() * 0.012);

          stream.velocities[i3] = toCenter.x;
          stream.velocities[i3 + 1] = toCenter.y;
          stream.velocities[i3 + 2] = toCenter.z;
        } else {
          posArray[i3] += stream.velocities[i3];
          posArray[i3 + 1] += stream.velocities[i3 + 1];
          posArray[i3 + 2] += stream.velocities[i3 + 2];
        }
      }

      positions.needsUpdate = true;
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0015, 0.02);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    camera.position.set(0, 0, 5);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create scene elements
    createNebulaBackground(scene);
    createStarField(scene);
    createAsteroids(scene);
    createEnergyStreams(scene);
    createLighting(scene);

    // Setup post-processing
    const composer = setupPostProcessing(renderer, scene, camera);
    composerRef.current = composer;

    // Mouse tracking
    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current = {
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight,
      };
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Resize handler
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
      composer.setSize(width, height);

      // Update nebula resolution
      if (nebulaRef.current) {
        const material = nebulaRef.current.material as THREE.ShaderMaterial;
        material.uniforms.uResolution.value.set(width, height);
      }
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.016;

      // Update nebula shader
      if (nebulaRef.current) {
        const material = nebulaRef.current.material as THREE.ShaderMaterial;
        material.uniforms.uTime.value = timeRef.current;
        material.uniforms.uMouse.value.set(mouseRef.current.x, mouseRef.current.y);
      }

      // Update stars
      if (starsRef.current) {
        const material = starsRef.current.material as THREE.ShaderMaterial;
        material.uniforms.uTime.value = timeRef.current;
        starsRef.current.rotation.y += 0.0001;
      }

      // Update asteroids
      asteroidsRef.current.forEach((asteroid) => {
        asteroid.mesh.rotation.x += asteroid.rotationSpeed.x;
        asteroid.mesh.rotation.y += asteroid.rotationSpeed.y;
        asteroid.mesh.rotation.z += asteroid.rotationSpeed.z;

        // Gentle floating motion
        asteroid.mesh.position.x =
          asteroid.originalPosition.x +
          Math.sin(timeRef.current * 0.5 + asteroid.originalPosition.x) * 0.3;
        asteroid.mesh.position.y =
          asteroid.originalPosition.y +
          Math.sin(timeRef.current * 0.3 + asteroid.originalPosition.y) * 0.2;
      });

      // Update energy streams
      updateEnergyStreams();
      energyStreamsRef.current.forEach((stream) => {
        const material = stream.points.material as THREE.ShaderMaterial;
        material.uniforms.uTime.value = timeRef.current;
      });

      // Cinematic camera movement
      const targetX = (mouseRef.current.x - 0.5) * 2;
      const targetY = (mouseRef.current.y - 0.5) * -1;

      // Smooth camera follow with slight delay
      targetCameraRef.current.x += (targetX - targetCameraRef.current.x) * 0.02;
      targetCameraRef.current.y += (targetY - targetCameraRef.current.y) * 0.02;

      // Add subtle breathing motion
      const breathX = Math.sin(timeRef.current * 0.2) * 0.1;
      const breathY = Math.cos(timeRef.current * 0.15) * 0.05;

      camera.position.x = targetCameraRef.current.x + breathX;
      camera.position.y = targetCameraRef.current.y + breathY;
      camera.lookAt(0, 0, -5);

      // Update chromatic aberration
      const chromaticPass = composer.passes[2] as ShaderPass;
      if (chromaticPass && chromaticPass.uniforms) {
        chromaticPass.uniforms.uTime.value = timeRef.current;
      }

      composer.render();
    };

    animate();

    // Cleanup
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

      // Dispose asteroids
      for (const asteroid of asteroidsRef.current) {
        asteroid.mesh.geometry.dispose();
        (asteroid.mesh.material as THREE.Material).dispose();
        scene.remove(asteroid.mesh);
      }
      asteroidsRef.current = [];

      // Dispose energy streams
      for (const stream of energyStreamsRef.current) {
        stream.points.geometry.dispose();
        (stream.points.material as THREE.Material).dispose();
        scene.remove(stream.points);
      }
      energyStreamsRef.current = [];

      // Dispose nebula
      if (nebulaRef.current) {
        nebulaRef.current.geometry.dispose();
        (nebulaRef.current.material as THREE.Material).dispose();
        scene.remove(nebulaRef.current);
        nebulaRef.current = null;
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
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [
    createStarField,
    createAsteroids,
    createEnergyStreams,
    createNebulaBackground,
    createLighting,
    setupPostProcessing,
    updateEnergyStreams,
  ]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-0"
      style={{ background: '#050010' }}
    />
  );
}
