import * as THREE from 'three';
import { BiomeConfig, BiomeType, BIOMES } from './Biomes';
import { MapData, TerrainType } from '@/data/maps';

/**
 * Instanced grass blades for ground detail
 * Uses GPU instancing for thousands of grass blades with minimal draw calls
 */
export class InstancedGrass {
  public mesh: THREE.InstancedMesh;
  private count: number;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    // Calculate grass blade count based on density
    const area = mapData.width * mapData.height;
    this.count = Math.floor(area * biome.grassDensity * 0.5); // 0.5 blades per unit at full density
    this.count = Math.min(this.count, 50000); // Cap for performance

    // Create grass blade geometry (simple triangle)
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -0.05, 0, 0,      // Bottom left
       0.05, 0, 0,      // Bottom right
       0.0, 0.4, 0,     // Top (will be offset for sway)
    ]);
    const normals = new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    // Create material with vertex colors
    const material = new THREE.MeshStandardMaterial({
      color: biome.colors.ground[0],
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // Position grass blades
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let instanceIndex = 0;

    for (let i = 0; i < this.count * 2 && instanceIndex < this.count; i++) {
      // Random position
      const x = 5 + Math.random() * (mapData.width - 10);
      const y = 5 + Math.random() * (mapData.height - 10);

      // Check terrain type
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, y);

          dummy.position.set(x, height, y);
          dummy.rotation.y = Math.random() * Math.PI * 2;
          dummy.scale.setScalar(0.8 + Math.random() * 0.4);
          dummy.updateMatrix();

          this.mesh.setMatrixAt(instanceIndex, dummy.matrix);

          // Vary grass color
          const colorIndex = Math.floor(Math.random() * biome.colors.ground.length);
          color.copy(biome.colors.ground[colorIndex]);
          color.multiplyScalar(0.8 + Math.random() * 0.4);
          this.mesh.setColorAt(instanceIndex, color);

          instanceIndex++;
        }
      }
    }

    // Update actual count
    this.mesh.count = instanceIndex;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Ground debris (small stones, twigs, etc.)
 */
export class GroundDebris {
  public group: THREE.Group;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const debrisCount = Math.floor(mapData.width * mapData.height * 0.02);
    const maxDebris = Math.min(debrisCount, 2000);

    // Shared geometries
    const pebbleGeometry = new THREE.SphereGeometry(0.1, 4, 3);
    const stickGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4);

    // Shared materials
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: biome.colors.cliff[0],
      roughness: 0.95,
      metalness: 0.0,
    });
    const stickMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3520,
      roughness: 0.9,
      metalness: 0.0,
    });

    for (let i = 0; i < maxDebris; i++) {
      const x = 3 + Math.random() * (mapData.width - 6);
      const y = 3 + Math.random() * (mapData.height - 6);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, y);

          // 70% pebbles, 30% sticks
          if (Math.random() < 0.7) {
            const pebble = new THREE.Mesh(pebbleGeometry, stoneMaterial);
            pebble.position.set(x, height + 0.05, y);
            pebble.scale.set(
              0.5 + Math.random() * 1,
              0.3 + Math.random() * 0.5,
              0.5 + Math.random() * 1
            );
            pebble.rotation.set(
              Math.random() * Math.PI,
              Math.random() * Math.PI,
              Math.random() * Math.PI
            );
            pebble.castShadow = true;
            pebble.receiveShadow = true;
            this.group.add(pebble);
          } else if (biome.treeDensity > 0.1) {
            // Only add sticks in areas with trees
            const stick = new THREE.Mesh(stickGeometry, stickMaterial);
            stick.position.set(x, height + 0.02, y);
            stick.rotation.set(
              Math.PI / 2,
              Math.random() * Math.PI * 2,
              Math.random() * 0.3
            );
            stick.scale.setScalar(0.5 + Math.random() * 1.5);
            stick.castShadow = true;
            this.group.add(stick);
          }
        }
      }
    }
  }

  public dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}

/**
 * Crystals for void/frozen biomes
 */
export class CrystalField {
  public group: THREE.Group;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    if (biome.crystalDensity <= 0) return;

    const crystalCount = Math.floor(mapData.width * mapData.height * biome.crystalDensity * 0.01);
    const maxCrystals = Math.min(crystalCount, 500);

    // Crystal colors based on biome
    let crystalColor = new THREE.Color(0x80c0ff); // Default ice blue
    let emissiveColor = new THREE.Color(0x204060);

    if (biome.name === 'Void') {
      crystalColor = new THREE.Color(0xa060ff);
      emissiveColor = new THREE.Color(0x4020a0);
    } else if (biome.name === 'Volcanic') {
      crystalColor = new THREE.Color(0xff8040);
      emissiveColor = new THREE.Color(0x802010);
    }

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: crystalColor,
      roughness: 0.1,
      metalness: 0.3,
      emissive: emissiveColor,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.85,
    });

    for (let i = 0; i < maxCrystals; i++) {
      const x = 10 + Math.random() * (mapData.width - 20);
      const y = 10 + Math.random() * (mapData.height - 20);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        // Crystals appear on unwalkable terrain or random ground
        if (cell.terrain === 'unwalkable' || (cell.terrain === 'ground' && Math.random() < 0.2)) {
          const height = getHeightAt(x, y);

          // Create crystal cluster
          const clusterGroup = new THREE.Group();
          const crystalCount = 1 + Math.floor(Math.random() * 3);

          for (let c = 0; c < crystalCount; c++) {
            const crystalHeight = 0.5 + Math.random() * 1.5;
            const crystalWidth = 0.1 + Math.random() * 0.2;

            const geometry = new THREE.ConeGeometry(crystalWidth, crystalHeight, 6);
            const crystal = new THREE.Mesh(geometry, crystalMaterial);

            crystal.position.set(
              (Math.random() - 0.5) * 0.5,
              crystalHeight / 2,
              (Math.random() - 0.5) * 0.5
            );
            crystal.rotation.set(
              (Math.random() - 0.5) * 0.3,
              Math.random() * Math.PI * 2,
              (Math.random() - 0.5) * 0.3
            );
            crystal.castShadow = true;
            clusterGroup.add(crystal);
          }

          clusterGroup.position.set(x, height, y);
          this.group.add(clusterGroup);
        }
      }
    }
  }

  public dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}

/**
 * Water/lava plane with animated shader
 */
export class WaterPlane {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(
    mapData: MapData,
    biome: BiomeConfig
  ) {
    if (!biome.hasWater) {
      // Create invisible placeholder
      const geometry = new THREE.PlaneGeometry(1, 1);
      this.material = new THREE.ShaderMaterial();
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.visible = false;
      return;
    }

    const geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, 32, 32);

    // Determine if this is lava or water
    const isLava = biome.name === 'Volcanic';

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: biome.colors.water },
        color2: { value: isLava ? new THREE.Color(0xff8040) : new THREE.Color(0x206090) },
        isLava: { value: isLava ? 1.0 : 0.0 },
      },
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying float vHeight;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Wave animation
          float wave1 = sin(pos.x * 0.5 + time) * 0.1;
          float wave2 = sin(pos.y * 0.3 + time * 0.7) * 0.08;
          pos.z += wave1 + wave2;
          vHeight = pos.z;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float time;
        uniform float isLava;
        varying vec2 vUv;
        varying float vHeight;

        void main() {
          // Animated color blend
          float blend = sin(vUv.x * 10.0 + time) * 0.5 + 0.5;
          blend *= sin(vUv.y * 8.0 + time * 0.8) * 0.5 + 0.5;

          vec3 color = mix(color1, color2, blend * 0.3);

          // Height-based brightness
          color += vHeight * 0.5;

          // Lava glow
          if (isLava > 0.5) {
            color += vec3(0.3, 0.1, 0.0) * (sin(time * 2.0) * 0.3 + 0.7);
          }

          // Transparency based on height
          float alpha = isLava > 0.5 ? 0.95 : 0.7 + vHeight * 0.2;

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
  }

  public update(time: number): void {
    if (this.mesh.visible) {
      this.material.uniforms.time.value = time;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Ground fog/mist layer for atmospheric effect
 * Creates a low-lying fog effect using an animated shader
 */
export class GroundFog {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(
    mapData: MapData,
    biome: BiomeConfig
  ) {
    // Determine fog properties based on biome
    let fogColor: THREE.Color;
    let fogDensity: number;
    let fogHeight: number;
    let enabled = true;

    switch (biome.name) {
      case 'Jungle':
        fogColor = new THREE.Color(0x90b090); // Green-tinted mist
        fogDensity = 0.15; // Very subtle
        fogHeight = 0.3;
        break;
      case 'Frozen Wastes':
        fogColor = new THREE.Color(0xd0e8ff); // Cold blue-white
        fogDensity = 0.12;
        fogHeight = 0.2;
        break;
      case 'Volcanic':
        fogColor = new THREE.Color(0x302020); // Dark smoke
        fogDensity = 0.1;
        fogHeight = 0.4;
        break;
      case 'Void':
        fogColor = new THREE.Color(0x301050); // Purple ethereal
        fogDensity = 0.15;
        fogHeight = 0.5;
        break;
      case 'Grassland':
        fogColor = new THREE.Color(0xc8d8e8); // Light morning mist
        fogDensity = 0.08;
        fogHeight = 0.15;
        break;
      case 'Desert':
        // No ground fog in desert
        enabled = false;
        fogColor = new THREE.Color(0xffffff);
        fogDensity = 0;
        fogHeight = 0;
        break;
      default:
        fogColor = new THREE.Color(0xc0c8d0);
        fogDensity = 0.1;
        fogHeight = 0.2;
    }

    const geometry = new THREE.PlaneGeometry(mapData.width, mapData.height, 1, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        fogColor: { value: fogColor },
        fogDensity: { value: fogDensity },
        mapSize: { value: new THREE.Vector2(mapData.width, mapData.height) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform vec2 mapSize;
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        // Simplex noise functions
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                             -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy));
          vec2 x0 = v -   i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                          + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                                  dot(x12.zw,x12.zw)), 0.0);
          m = m*m;
          m = m*m;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          // Multi-octave noise for organic fog movement
          vec2 uv = vUv * 4.0;
          float n1 = snoise(uv + time * 0.05);
          float n2 = snoise(uv * 2.0 - time * 0.03) * 0.5;
          float n3 = snoise(uv * 4.0 + time * 0.08) * 0.25;

          float noise = (n1 + n2 + n3) * 0.5 + 0.5;

          // Fade at edges
          float edgeFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          edgeFade *= smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

          // Final alpha with noise and density
          float alpha = noise * fogDensity * edgeFade;
          alpha = clamp(alpha, 0.0, 0.2); // Cap max opacity - keep very subtle

          gl_FragColor = vec4(fogColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false, // Important for proper blending
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapData.width / 2, fogHeight, mapData.height / 2);
    this.mesh.visible = enabled;
  }

  public update(time: number): void {
    if (this.mesh.visible) {
      this.material.uniforms.time.value = time;
    }
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Map border fog - creates a dark, smoky fog effect around the map edges
 * Similar to Starcraft 2's map boundary effect
 * Uses a single ring mesh with an animated shader for performance
 */
export class MapBorderFog {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(mapData: MapData) {
    const mapWidth = mapData.width;
    const mapHeight = mapData.height;

    // Border extends this far beyond the map
    const borderSize = 80;
    // How far the fog encroaches INWARD onto the map (hides hard edges)
    const inwardEncroachment = 25;
    // Total fade distance from inner edge to outer edge
    const fadeDistance = borderSize + inwardEncroachment;

    // Create a ring-shaped geometry that surrounds the map
    // Inner edge is INSIDE the map bounds to hide hard terrain edges
    // Outer edge extends beyond the map
    const innerWidth = mapWidth - inwardEncroachment * 2;
    const innerHeight = mapHeight - inwardEncroachment * 2;
    const outerWidth = mapWidth + borderSize * 2;
    const outerHeight = mapHeight + borderSize * 2;

    // Create custom geometry - a frame/ring shape
    const geometry = this.createBorderGeometry(
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      fadeDistance
    );

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        fogColor: { value: new THREE.Color(0x000000) },
        mapCenter: { value: new THREE.Vector2(mapWidth / 2, mapHeight / 2) },
        mapSize: { value: new THREE.Vector2(mapWidth, mapHeight) },
        fadeDistance: { value: fadeDistance },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vFade;

        attribute float fade;

        void main() {
          vUv = uv;
          vFade = fade;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 fogColor;
        uniform vec2 mapCenter;
        uniform vec2 mapSize;
        uniform float fadeDistance;

        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vFade;

        // Simplex noise for organic smoke movement
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                             -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy));
          vec2 x0 = v -   i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                          + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                                  dot(x12.zw,x12.zw)), 0.0);
          m = m*m;
          m = m*m;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          // Multi-octave noise for smoky, organic movement
          // Slow animation speeds for atmospheric effect
          vec2 noiseCoord = vWorldPosition.xz * 0.02;
          float n1 = snoise(noiseCoord + time * 0.005);
          float n2 = snoise(noiseCoord * 2.0 - time * 0.003) * 0.5;
          float n3 = snoise(noiseCoord * 4.0 + time * 0.006) * 0.25;

          float noise = (n1 + n2 + n3) * 0.5 + 0.5;

          // Wispy smoke tendrils effect
          float wisps = smoothstep(0.35, 0.65, noise);

          // Base fade from vertex attribute (0 at inner edge, 1 at outer edge)
          // The map boundary is at ~0.24 fade (25 units into 105 total)
          float baseFade = vFade;

          // Apply noise variation to the fade edge for organic boundary
          float noisyFade = baseFade + (noise - 0.5) * 0.12;
          noisyFade = clamp(noisyFade, 0.0, 1.0);

          // Steep fade curve - fog becomes opaque quickly
          // At fade=0.24 (map edge): reaches ~70% opacity
          // At fade=0.4: reaches ~95% opacity
          float alpha = smoothstep(0.0, 0.3, noisyFade);
          alpha = alpha * alpha; // Quadratic for steeper rise
          alpha = min(alpha * 1.3, 1.0); // Boost and clamp
          alpha *= (0.92 + wisps * 0.08);

          // Subtle color variation for depth
          vec3 color = fogColor;
          color += vec3(0.01, 0.008, 0.015) * noise;

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(mapWidth / 2, 0.1, mapHeight / 2); // Slightly above ground
    this.mesh.renderOrder = 100; // Render after most objects
  }

  /**
   * Creates a ring/frame geometry that surrounds the map
   * Uses vertex attributes for fade values
   */
  private createBorderGeometry(
    mapWidth: number,
    mapHeight: number,
    outerWidth: number,
    outerHeight: number,
    _fadeDistance: number
  ): THREE.BufferGeometry {
    // Create 4 border strips (top, bottom, left, right) plus corners
    // This is more efficient than a complex ring shape

    const positions: number[] = [];
    const uvs: number[] = [];
    const fades: number[] = [];
    const indices: number[] = [];

    const halfMapW = mapWidth / 2;
    const halfMapH = mapHeight / 2;
    const halfOuterW = outerWidth / 2;
    const halfOuterH = outerHeight / 2;

    let vertexIndex = 0;

    // Helper to add a rectangular section
    const addSection = (
      innerX1: number, innerZ1: number,
      innerX2: number, innerZ2: number,
      outerX1: number, outerZ1: number,
      outerX2: number, outerZ2: number,
      segsX: number, segsZ: number
    ) => {
      for (let iz = 0; iz <= segsZ; iz++) {
        const tz = iz / segsZ;
        const fade = tz; // 0 at inner edge, 1 at outer edge

        for (let ix = 0; ix <= segsX; ix++) {
          const tx = ix / segsX;

          const x = innerX1 + (innerX2 - innerX1) * tx +
                    (outerX1 + (outerX2 - outerX1) * tx - (innerX1 + (innerX2 - innerX1) * tx)) * tz;
          const z = innerZ1 + (innerZ2 - innerZ1) * tx +
                    (outerZ1 + (outerZ2 - outerZ1) * tx - (innerZ1 + (innerZ2 - innerZ1) * tx)) * tz;

          positions.push(x, 0, z);
          uvs.push(tx, tz);
          fades.push(fade);
        }
      }

      // Create triangles
      for (let iz = 0; iz < segsZ; iz++) {
        for (let ix = 0; ix < segsX; ix++) {
          const base = vertexIndex + iz * (segsX + 1) + ix;
          const nextRow = base + segsX + 1;

          indices.push(base, nextRow, base + 1);
          indices.push(base + 1, nextRow, nextRow + 1);
        }
      }

      vertexIndex += (segsX + 1) * (segsZ + 1);
    };

    const segs = 16; // Segments for gradient smoothness
    const segsSide = 32; // More segments along the long sides

    // Top border (north)
    addSection(
      -halfMapW, -halfMapH,           // Inner left
      halfMapW, -halfMapH,            // Inner right
      -halfOuterW, -halfOuterH,       // Outer left
      halfOuterW, -halfOuterH,        // Outer right
      segsSide, segs
    );

    // Bottom border (south)
    addSection(
      -halfMapW, halfMapH,            // Inner left
      halfMapW, halfMapH,             // Inner right
      -halfOuterW, halfOuterH,        // Outer left
      halfOuterW, halfOuterH,         // Outer right
      segsSide, segs
    );

    // Left border (west)
    addSection(
      -halfMapW, -halfMapH,           // Inner top
      -halfMapW, halfMapH,            // Inner bottom
      -halfOuterW, -halfOuterH,       // Outer top
      -halfOuterW, halfOuterH,        // Outer bottom
      segs, segsSide
    );

    // Right border (east)
    addSection(
      halfMapW, -halfMapH,            // Inner top
      halfMapW, halfMapH,             // Inner bottom
      halfOuterW, -halfOuterH,        // Outer top
      halfOuterW, halfOuterH,         // Outer bottom
      segs, segsSide
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('fade', new THREE.Float32BufferAttribute(fades, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  public update(time: number): void {
    this.material.uniforms.time.value = time;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
