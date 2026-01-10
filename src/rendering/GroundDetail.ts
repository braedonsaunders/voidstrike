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
        fogDensity = 0.6;
        fogHeight = 0.8;
        break;
      case 'Frozen Wastes':
        fogColor = new THREE.Color(0xd0e8ff); // Cold blue-white
        fogDensity = 0.5;
        fogHeight = 0.5;
        break;
      case 'Volcanic':
        fogColor = new THREE.Color(0x302020); // Dark smoke
        fogDensity = 0.4;
        fogHeight = 1.0;
        break;
      case 'Void':
        fogColor = new THREE.Color(0x301050); // Purple ethereal
        fogDensity = 0.7;
        fogHeight = 1.2;
        break;
      case 'Grassland':
        fogColor = new THREE.Color(0xc8d8e8); // Light morning mist
        fogDensity = 0.25;
        fogHeight = 0.3;
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
        fogDensity = 0.3;
        fogHeight = 0.4;
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
          alpha = clamp(alpha, 0.0, 0.6); // Cap max opacity

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
