import * as THREE from 'three';
import { BiomeConfig } from './Biomes';
import { MapData } from '@/data/maps';

/**
 * Crystals for void/frozen biomes using GPU instancing
 *
 * PERF: Uses InstancedMesh to batch all crystals into a single draw call.
 * Previously created 500-1500 individual meshes = 500-1500 draw calls.
 * Now uses 1 InstancedMesh = 1 draw call regardless of crystal count.
 *
 * Emissive control is delegated to EmissiveDecorationManager for centralized
 * animation and intensity control. Use getInstancedMesh() to register with manager.
 */
export class CrystalField {
  public group: THREE.Group;
  private instancedMesh: THREE.InstancedMesh | null = null;

  // Reusable objects to avoid allocations
  private static readonly tempMatrix = new THREE.Matrix4();
  private static readonly tempPosition = new THREE.Vector3();
  private static readonly tempRotation = new THREE.Euler();
  private static readonly tempQuaternion = new THREE.Quaternion();
  private static readonly tempScale = new THREE.Vector3();

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    if (biome.crystalDensity <= 0) return;

    const crystalCount = Math.floor(mapData.width * mapData.height * biome.crystalDensity * 0.01);
    const maxClusters = Math.min(crystalCount, 500);
    // Each cluster has 1-3 crystals, average ~2, so max instances = maxClusters * 3
    const maxInstances = maxClusters * 3;

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
      emissiveIntensity: 0.5, // Base intensity, controlled by EmissiveDecorationManager
      transparent: true,
      opacity: 0.85,
    });

    // Create base geometry - unit cone that will be scaled per instance
    // Base radius 0.15, height 1.0, 6 segments
    const baseGeometry = new THREE.ConeGeometry(0.15, 1.0, 6);
    // Translate geometry so origin is at the base (not center)
    baseGeometry.translate(0, 0.5, 0);

    // Create instanced mesh with maximum capacity
    this.instancedMesh = new THREE.InstancedMesh(baseGeometry, crystalMaterial, maxInstances);
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = false;
    // Enable frustum culling for the entire batch
    this.instancedMesh.frustumCulled = true;

    // Collect all crystal transforms
    let instanceIndex = 0;
    const { tempMatrix, tempPosition, tempRotation, tempQuaternion, tempScale } = CrystalField;

    for (let i = 0; i < maxClusters && instanceIndex < maxInstances; i++) {
      const x = 10 + Math.random() * (mapData.width - 20);
      const y = 10 + Math.random() * (mapData.height - 20);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        // Crystals appear on unwalkable terrain or random ground
        if (cell.terrain === 'unwalkable' || (cell.terrain === 'ground' && Math.random() < 0.2)) {
          const height = getHeightAt(x, y);
          const clusterCrystalCount = 1 + Math.floor(Math.random() * 3);

          for (let c = 0; c < clusterCrystalCount && instanceIndex < maxInstances; c++) {
            // Random size variation
            const crystalHeight = 0.5 + Math.random() * 1.5;
            const crystalWidth = (0.1 + Math.random() * 0.2) / 0.15; // Scale relative to base geometry

            // Position within cluster + world position
            tempPosition.set(
              x + (Math.random() - 0.5) * 0.5,
              height,
              y + (Math.random() - 0.5) * 0.5
            );

            // Random rotation
            tempRotation.set(
              (Math.random() - 0.5) * 0.3,
              Math.random() * Math.PI * 2,
              (Math.random() - 0.5) * 0.3
            );
            tempQuaternion.setFromEuler(tempRotation);

            // Scale based on random size
            tempScale.set(crystalWidth, crystalHeight, crystalWidth);

            // Compose transformation matrix
            tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
            this.instancedMesh.setMatrixAt(instanceIndex, tempMatrix);

            instanceIndex++;
          }
        }
      }
    }

    // Update instance count to actual number used
    this.instancedMesh.count = instanceIndex;
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Compute bounding sphere for frustum culling
    this.instancedMesh.computeBoundingSphere();

    this.group.add(this.instancedMesh);
  }

  /**
   * Get the instanced mesh for registration with EmissiveDecorationManager.
   * Returns null if no crystals were created (crystalDensity <= 0).
   */
  public getInstancedMesh(): THREE.InstancedMesh | null {
    return this.instancedMesh;
  }

  public dispose(): void {
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      if (this.instancedMesh.material instanceof THREE.Material) {
        this.instancedMesh.material.dispose();
      }
      this.instancedMesh = null;
    }
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
