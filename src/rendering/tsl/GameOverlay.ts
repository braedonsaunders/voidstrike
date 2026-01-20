/**
 * TSL Game Overlay Manager
 *
 * WebGPU-compatible strategic overlays using Three.js Shading Language.
 * Provides elevation, threat, navmesh, build grid, and resource visualization.
 * Works with both WebGPU and WebGL renderers.
 *
 * Key features:
 * - GPU-based terrain-conforming overlays (vertex displacement in shader)
 * - Progressive navmesh computation with BFS flood-fill
 * - IndexedDB caching for static overlays
 * - SC2-style attack/vision range overlays
 */

import * as THREE from 'three';
import {
  Fn,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  uv,
  sin,
  positionLocal,
  add,
  mul,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { MapData, MapCell, TERRAIN_FEATURE_CONFIG, elevationToZone } from '@/data/maps';
import { debugPathfinding } from '@/utils/debugLogger';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { Resource } from '@/engine/components/Resource';
import { GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { getRecastNavigation } from '@/engine/pathfinding/RecastNavigation';
import {
  computeMapHash,
  getOverlayCache,
  setOverlayCache,
} from '@/utils/overlayCache';

// Overlay height offset above terrain to prevent z-fighting
const OVERLAY_HEIGHT_OFFSET = 0.15;

/**
 * Creates a terrain-conforming overlay material using TSL.
 * Displaces vertices on GPU using heightmap texture.
 */
function createTerrainConformingMaterial(
  overlayTexture: THREE.DataTexture,
  heightmapTexture: THREE.DataTexture,
  opacity: number,
  heightOffset: number = OVERLAY_HEIGHT_OFFSET
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true; // Enable depth test for proper occlusion
  material.side = THREE.DoubleSide;

  // Polygon offset to prevent z-fighting with terrain
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  const uOpacity = uniform(opacity);
  const uHeightOffset = uniform(heightOffset);

  // Vertex position node - displace Y based on heightmap
  const positionNode = Fn(() => {
    const pos = positionLocal;
    // Sample heightmap using UV (position is in local space, UV maps to 0-1)
    const heightSample = texture(heightmapTexture, uv());
    // R channel contains normalized height (0-1), scale to world units
    const terrainHeight = heightSample.r.mul(float(20.0)); // Max height ~20 units
    // Displace Y position
    return vec3(pos.x, pos.y.add(terrainHeight).add(uHeightOffset), pos.z);
  })();

  material.positionNode = positionNode;

  // Color output
  const outputNode = Fn(() => {
    const texColor = texture(overlayTexture, uv());
    const alpha = texColor.a.mul(uOpacity);
    return vec4(texColor.rgb, alpha);
  })();

  material.colorNode = outputNode;

  // Store uniforms for updates
  (material as any)._uOpacity = uOpacity;
  (material as any)._uHeightOffset = uHeightOffset;

  return material;
}

/**
 * Creates a terrain-conforming threat material with pulsing effect
 */
function createTerrainConformingThreatMaterial(
  threatTexture: THREE.DataTexture,
  heightmapTexture: THREE.DataTexture,
  opacity: number
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);
  const uHeightOffset = uniform(OVERLAY_HEIGHT_OFFSET + 0.05); // Slightly above other overlays

  // Vertex position with terrain conforming
  const positionNode = Fn(() => {
    const pos = positionLocal;
    const heightSample = texture(heightmapTexture, uv());
    const terrainHeight = heightSample.r.mul(float(20.0));
    return vec3(pos.x, pos.y.add(terrainHeight).add(uHeightOffset), pos.z);
  })();

  material.positionNode = positionNode;

  // Color with pulsing effect
  const outputNode = Fn(() => {
    const uvCoord = uv();
    const texColor = texture(threatTexture, uvCoord);

    // Pulsing effect for threat zones
    const pulse = float(0.85).add(float(0.15).mul(sin(uTime.mul(2.0).add(uvCoord.x.mul(10.0)).add(uvCoord.y.mul(10.0)))));

    // Red tint with intensity based on threat level
    const threatColor = vec3(0.9, 0.2, 0.1).mul(texColor.r).mul(pulse);
    const alpha = texColor.a.mul(uOpacity);

    return vec4(threatColor, alpha);
  })();

  material.colorNode = outputNode;

  (material as any)._uOpacity = uOpacity;
  (material as any)._uTime = uTime;
  (material as any)._uHeightOffset = uHeightOffset;

  return material;
}

/**
 * Creates a build grid material with green/red validity colors
 */
function createBuildGridMaterial(
  gridTexture: THREE.DataTexture,
  heightmapTexture: THREE.DataTexture,
  opacity: number
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  material.polygonOffset = true;
  material.polygonOffsetFactor = -3;
  material.polygonOffsetUnits = -3;

  const uOpacity = uniform(opacity);
  const uHeightOffset = uniform(OVERLAY_HEIGHT_OFFSET + 0.1);

  // Vertex position with terrain conforming
  const positionNode = Fn(() => {
    const pos = positionLocal;
    const heightSample = texture(heightmapTexture, uv());
    const terrainHeight = heightSample.r.mul(float(20.0));
    return vec3(pos.x, pos.y.add(terrainHeight).add(uHeightOffset), pos.z);
  })();

  material.positionNode = positionNode;

  // Color output - R channel = validity (1=valid green, 0=invalid red)
  const outputNode = Fn(() => {
    const texColor = texture(gridTexture, uv());
    const validity = texColor.r;

    // Green for valid, red for invalid
    const validColor = vec3(0.2, 0.8, 0.3);
    const invalidColor = vec3(0.9, 0.2, 0.2);
    const gridColor = validColor.mul(validity).add(invalidColor.mul(float(1.0).sub(validity)));

    // Grid pattern - only show where there's data (alpha > 0)
    const alpha = texColor.a.mul(uOpacity);

    return vec4(gridColor, alpha);
  })();

  material.colorNode = outputNode;

  (material as any)._uOpacity = uOpacity;
  (material as any)._uHeightOffset = uHeightOffset;

  return material;
}

/**
 * Creates a resource overlay material
 */
function createResourceMaterial(
  resourceTexture: THREE.DataTexture,
  heightmapTexture: THREE.DataTexture,
  opacity: number
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);
  const uHeightOffset = uniform(OVERLAY_HEIGHT_OFFSET);

  // Vertex position with terrain conforming
  const positionNode = Fn(() => {
    const pos = positionLocal;
    const heightSample = texture(heightmapTexture, uv());
    const terrainHeight = heightSample.r.mul(float(20.0));
    return vec3(pos.x, pos.y.add(terrainHeight).add(uHeightOffset), pos.z);
  })();

  material.positionNode = positionNode;

  // Color with gentle pulse for resources
  const outputNode = Fn(() => {
    const uvCoord = uv();
    const texColor = texture(resourceTexture, uvCoord);

    // Gentle pulse
    const pulse = float(0.9).add(float(0.1).mul(sin(uTime.mul(1.5))));

    // Color based on resource type (stored in RGB)
    const resourceColor = texColor.rgb.mul(pulse);
    const alpha = texColor.a.mul(uOpacity);

    return vec4(resourceColor, alpha);
  })();

  material.colorNode = outputNode;

  (material as any)._uOpacity = uOpacity;
  (material as any)._uTime = uTime;
  (material as any)._uHeightOffset = uHeightOffset;

  return material;
}

export class TSLGameOverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
  private mapHash: string;
  private world: World | null = null;
  private getTerrainHeight: (x: number, y: number) => number;

  // Heightmap texture for GPU terrain conforming
  private heightmapTexture: THREE.DataTexture | null = null;

  // Overlay meshes
  private elevationOverlayMesh: THREE.Mesh | null = null;
  private threatOverlayMesh: THREE.Mesh | null = null;
  private navmeshOverlayMesh: THREE.Mesh | null = null;
  private buildGridOverlayMesh: THREE.Mesh | null = null;
  private resourceOverlayMesh: THREE.Mesh | null = null;

  // Overlay textures
  private elevationTexture: THREE.DataTexture | null = null;
  private threatTexture: THREE.DataTexture | null = null;
  private threatTextureData: Uint8Array | null = null;
  private navmeshTexture: THREE.DataTexture | null = null;
  private navmeshTextureData: Uint8Array | null = null;
  private buildGridTexture: THREE.DataTexture | null = null;
  private buildGridTextureData: Uint8Array | null = null;
  private resourceTexture: THREE.DataTexture | null = null;
  private resourceTextureData: Uint8Array | null = null;

  // Current state
  private currentOverlay: GameOverlayType = 'none';
  private opacity: number = 0.7;

  // Threat overlay update throttling
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 500;

  // Resource overlay update throttling
  private lastResourceUpdate: number = 0;
  private resourceUpdateInterval: number = 1000;

  // Navmesh progressive computation state
  private navmeshIsComputing: boolean = false;
  private navmeshProgress: number = 0;
  private navmeshCached: boolean = false;

  // Callbacks for progress updates
  private onNavmeshProgress: ((progress: number) => void) | null = null;
  private onNavmeshComplete: ((stats: { connected: number; disconnected: number; duration: number }) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    mapData: MapData,
    getTerrainHeight: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.mapData = mapData;
    this.mapHash = computeMapHash(mapData);
    this.getTerrainHeight = getTerrainHeight;

    // Create heightmap texture first (needed by all overlays)
    this.createHeightmapTexture();

    // Create all overlays
    this.createElevationOverlay();
    this.createThreatOverlay();
    this.createNavmeshOverlay();
    this.createBuildGridOverlay();
    this.createResourceOverlay();

    // Hide all overlays initially
    this.setActiveOverlay('none');

    // Try to load cached navmesh data
    this.loadCachedNavmesh();
  }

  /**
   * Create heightmap texture from terrain heights for GPU displacement
   */
  private createHeightmapTexture(): void {
    const { width, height } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    // Find min/max heights for normalization
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const h = this.getTerrainHeight(x + 0.5, y + 0.5);
        if (h < minHeight) minHeight = h;
        if (h > maxHeight) maxHeight = h;
      }
    }

    const heightRange = Math.max(maxHeight - minHeight, 1);

    // Create texture data with normalized heights
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const h = this.getTerrainHeight(x + 0.5, y + 0.5);
        // Normalize to 0-255, store in R channel
        const normalized = Math.floor(((h - minHeight) / heightRange) * 255);
        textureData[i + 0] = normalized;
        textureData[i + 1] = normalized;
        textureData[i + 2] = normalized;
        textureData[i + 3] = 255;
      }
    }

    this.heightmapTexture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    this.heightmapTexture.needsUpdate = true;
    this.heightmapTexture.minFilter = THREE.LinearFilter;
    this.heightmapTexture.magFilter = THREE.LinearFilter;
    this.heightmapTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightmapTexture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /**
   * Create overlay geometry with subdivisions for terrain conforming
   */
  private createOverlayGeometry(): THREE.PlaneGeometry {
    const { width, height } = this.mapData;
    // Use same resolution as map for accurate terrain conforming
    const geometry = new THREE.PlaneGeometry(width, height, width, height);
    return geometry;
  }

  /**
   * Try to load navmesh overlay from cache
   */
  private async loadCachedNavmesh(): Promise<void> {
    try {
      const cached = await getOverlayCache(this.mapHash, 'navmesh');
      if (cached && cached.width === this.mapData.width && cached.height === this.mapData.height) {
        if (this.navmeshTextureData && this.navmeshTexture) {
          this.navmeshTextureData.set(cached.data);
          this.navmeshTexture.needsUpdate = true;
          this.navmeshCached = true;
          debugPathfinding.log('[NavmeshOverlay] Loaded from cache');
        }
      }
    } catch {
      // Cache miss or error - will compute when needed
    }
  }

  public setNavmeshProgressCallback(callback: (progress: number) => void): void {
    this.onNavmeshProgress = callback;
  }

  public setNavmeshCompleteCallback(callback: (stats: { connected: number; disconnected: number; duration: number }) => void): void {
    this.onNavmeshComplete = callback;
  }

  public getNavmeshState(): { isComputing: boolean; progress: number; cached: boolean } {
    return {
      isComputing: this.navmeshIsComputing,
      progress: this.navmeshProgress,
      cached: this.navmeshCached,
    };
  }

  public setWorld(world: World): void {
    this.world = world;
  }

  private getElevationColor(elevation: number): { r: number; g: number; b: number; a: number } {
    const zone = elevationToZone(elevation);
    switch (zone) {
      case 'high': return { r: 255, g: 220, b: 100, a: 160 };
      case 'mid': return { r: 100, g: 180, b: 255, a: 140 };
      case 'low':
      default: return { r: 80, g: 120, b: 80, a: 120 };
    }
  }

  private createElevationOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const cell = terrain[y]?.[x];
        const elevation = cell?.elevation ?? 0;
        const color = this.getElevationColor(elevation);
        textureData[i + 0] = color.r;
        textureData[i + 1] = color.g;
        textureData[i + 2] = color.b;
        textureData[i + 3] = color.a;
      }
    }

    this.elevationTexture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    this.elevationTexture.needsUpdate = true;
    this.elevationTexture.minFilter = THREE.LinearFilter;
    this.elevationTexture.magFilter = THREE.LinearFilter;

    const material = createTerrainConformingMaterial(this.elevationTexture, this.heightmapTexture!, this.opacity);
    const geometry = this.createOverlayGeometry();

    this.elevationOverlayMesh = new THREE.Mesh(geometry, material);
    this.elevationOverlayMesh.rotation.x = -Math.PI / 2;
    this.elevationOverlayMesh.position.set(width / 2, 0, height / 2);
    this.elevationOverlayMesh.renderOrder = 100;
    this.elevationOverlayMesh.visible = false;
    this.scene.add(this.elevationOverlayMesh);
  }

  private createThreatOverlay(): void {
    const { width, height } = this.mapData;
    this.threatTextureData = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height * 4; i += 4) {
      this.threatTextureData[i + 0] = 0;
      this.threatTextureData[i + 1] = 0;
      this.threatTextureData[i + 2] = 0;
      this.threatTextureData[i + 3] = 0;
    }

    this.threatTexture = new THREE.DataTexture(this.threatTextureData, width, height, THREE.RGBAFormat);
    this.threatTexture.needsUpdate = true;
    this.threatTexture.minFilter = THREE.LinearFilter;
    this.threatTexture.magFilter = THREE.LinearFilter;

    const material = createTerrainConformingThreatMaterial(this.threatTexture, this.heightmapTexture!, this.opacity);
    const geometry = this.createOverlayGeometry();

    this.threatOverlayMesh = new THREE.Mesh(geometry, material);
    this.threatOverlayMesh.rotation.x = -Math.PI / 2;
    this.threatOverlayMesh.position.set(width / 2, 0, height / 2);
    this.threatOverlayMesh.renderOrder = 101;
    this.threatOverlayMesh.visible = false;
    this.scene.add(this.threatOverlayMesh);
  }

  private createNavmeshOverlay(): void {
    const { width, height } = this.mapData;
    this.navmeshTextureData = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height * 4; i += 4) {
      this.navmeshTextureData[i + 0] = 0;
      this.navmeshTextureData[i + 1] = 0;
      this.navmeshTextureData[i + 2] = 0;
      this.navmeshTextureData[i + 3] = 0;
    }

    this.navmeshTexture = new THREE.DataTexture(this.navmeshTextureData, width, height, THREE.RGBAFormat);
    this.navmeshTexture.needsUpdate = true;
    this.navmeshTexture.minFilter = THREE.NearestFilter;
    this.navmeshTexture.magFilter = THREE.NearestFilter;

    const material = createTerrainConformingMaterial(this.navmeshTexture, this.heightmapTexture!, 0.8);
    const geometry = this.createOverlayGeometry();

    this.navmeshOverlayMesh = new THREE.Mesh(geometry, material);
    this.navmeshOverlayMesh.rotation.x = -Math.PI / 2;
    this.navmeshOverlayMesh.position.set(width / 2, 0, height / 2);
    this.navmeshOverlayMesh.renderOrder = 100;
    this.navmeshOverlayMesh.visible = false;
    this.scene.add(this.navmeshOverlayMesh);
  }

  private createBuildGridOverlay(): void {
    const { width, height } = this.mapData;
    this.buildGridTextureData = new Uint8Array(width * height * 4);

    // Initialize to transparent
    for (let i = 0; i < width * height * 4; i += 4) {
      this.buildGridTextureData[i + 0] = 0;
      this.buildGridTextureData[i + 1] = 0;
      this.buildGridTextureData[i + 2] = 0;
      this.buildGridTextureData[i + 3] = 0;
    }

    this.buildGridTexture = new THREE.DataTexture(this.buildGridTextureData, width, height, THREE.RGBAFormat);
    this.buildGridTexture.needsUpdate = true;
    this.buildGridTexture.minFilter = THREE.NearestFilter;
    this.buildGridTexture.magFilter = THREE.NearestFilter;

    const material = createBuildGridMaterial(this.buildGridTexture, this.heightmapTexture!, 0.6);
    const geometry = this.createOverlayGeometry();

    this.buildGridOverlayMesh = new THREE.Mesh(geometry, material);
    this.buildGridOverlayMesh.rotation.x = -Math.PI / 2;
    this.buildGridOverlayMesh.position.set(width / 2, 0, height / 2);
    this.buildGridOverlayMesh.renderOrder = 102;
    this.buildGridOverlayMesh.visible = false;
    this.scene.add(this.buildGridOverlayMesh);
  }

  private createResourceOverlay(): void {
    const { width, height } = this.mapData;
    this.resourceTextureData = new Uint8Array(width * height * 4);

    // Initialize to transparent
    for (let i = 0; i < width * height * 4; i += 4) {
      this.resourceTextureData[i + 0] = 0;
      this.resourceTextureData[i + 1] = 0;
      this.resourceTextureData[i + 2] = 0;
      this.resourceTextureData[i + 3] = 0;
    }

    this.resourceTexture = new THREE.DataTexture(this.resourceTextureData, width, height, THREE.RGBAFormat);
    this.resourceTexture.needsUpdate = true;
    this.resourceTexture.minFilter = THREE.LinearFilter;
    this.resourceTexture.magFilter = THREE.LinearFilter;

    const material = createResourceMaterial(this.resourceTexture, this.heightmapTexture!, 0.7);
    const geometry = this.createOverlayGeometry();

    this.resourceOverlayMesh = new THREE.Mesh(geometry, material);
    this.resourceOverlayMesh.rotation.x = -Math.PI / 2;
    this.resourceOverlayMesh.position.set(width / 2, 0, height / 2);
    this.resourceOverlayMesh.renderOrder = 100;
    this.resourceOverlayMesh.visible = false;
    this.scene.add(this.resourceOverlayMesh);
  }

  /**
   * Update navmesh overlay using efficient BFS flood-fill algorithm.
   * O(n) instead of O(n²) - dramatically faster than pathfinding per cell.
   */
  private async updateNavmeshOverlay(): Promise<void> {
    if (!this.navmeshTextureData || !this.navmeshTexture) return;

    if (this.navmeshCached) {
      debugPathfinding.log('[NavmeshOverlay] Using cached data');
      return;
    }

    if (this.navmeshIsComputing) {
      debugPathfinding.log('[NavmeshOverlay] Computation already in progress');
      return;
    }

    this.navmeshIsComputing = true;
    this.navmeshProgress = 0;
    const startTime = performance.now();

    const recast = getRecastNavigation();
    if (!recast.isReady()) {
      debugPathfinding.warn('[NavmeshOverlay] Recast not ready');
      this.navmeshIsComputing = false;
      return;
    }

    const { width, height, terrain } = this.mapData;
    const totalCells = width * height;

    const walkableGrid = new Uint8Array(totalCells);
    const connectedGrid = new Uint8Array(totalCells);
    const terrainType = new Uint8Array(totalCells);

    // Phase 1: Walkability check
    debugPathfinding.log('[NavmeshOverlay] Phase 1: Checking walkability...');

    let walkableCount = 0;
    let unwalkableTerrainCount = 0;

    const BATCH_SIZE = 4096;
    let processed = 0;

    const processWalkabilityBatch = async (): Promise<void> => {
      const batchEnd = Math.min(processed + BATCH_SIZE, totalCells);

      for (let idx = processed; idx < batchEnd; idx++) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const cell = terrain[y]?.[x];

        if (cell?.terrain === 'unwalkable') {
          terrainType[idx] = 2;
          unwalkableTerrainCount++;
          continue;
        }

        if (cell?.terrain === 'ramp') {
          terrainType[idx] = 1;
        }

        const cellX = x + 0.5;
        const cellZ = y + 0.5;
        if (recast.isWalkable(cellX, cellZ)) {
          walkableGrid[idx] = 1;
          walkableCount++;
        }
      }

      processed = batchEnd;
      this.navmeshProgress = (processed / totalCells) * 0.5;

      if (this.onNavmeshProgress) {
        this.onNavmeshProgress(this.navmeshProgress);
      }

      if (processed < totalCells) {
        await new Promise(resolve => setTimeout(resolve, 0));
        await processWalkabilityBatch();
      }
    };

    await processWalkabilityBatch();

    const phase1Time = performance.now() - startTime;
    debugPathfinding.log(`[NavmeshOverlay] Phase 1 complete: ${walkableCount} walkable cells in ${phase1Time.toFixed(0)}ms`);

    // Phase 2: Find reference point
    let refIdx = -1;

    for (let r = 0; r < Math.max(width, height) / 2; r++) {
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = Math.floor(width / 2) + dx;
          const y = Math.floor(height / 2) + dy;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = y * width + x;
            if (walkableGrid[idx] === 1 && terrainType[idx] !== 1) {
              refIdx = idx;
              found = true;
            }
          }
        }
      }
      if (found) break;
    }

    // Phase 3: BFS flood-fill for connectivity
    debugPathfinding.log('[NavmeshOverlay] Phase 2: BFS flood-fill for connectivity...');

    let connectedCount = 0;

    if (refIdx >= 0) {
      const queue: number[] = [refIdx];
      connectedGrid[refIdx] = 1;
      connectedCount = 1;

      const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
      const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

      let bfsProcessed = 0;
      const BFS_BATCH = 8192;

      while (queue.length > 0) {
        const current = queue.shift()!;
        const cx = current % width;
        const cy = Math.floor(current / width);

        for (let d = 0; d < 8; d++) {
          const nx = cx + dx[d];
          const ny = cy + dy[d];

          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

          const nidx = ny * width + nx;

          if (connectedGrid[nidx] === 1 || walkableGrid[nidx] === 0) continue;

          connectedGrid[nidx] = 1;
          connectedCount++;
          queue.push(nidx);
        }

        bfsProcessed++;

        if (bfsProcessed % BFS_BATCH === 0) {
          this.navmeshProgress = 0.5 + (connectedCount / walkableCount) * 0.4;
          if (this.onNavmeshProgress) {
            this.onNavmeshProgress(this.navmeshProgress);
          }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    const phase2Time = performance.now() - startTime - phase1Time;
    debugPathfinding.log(`[NavmeshOverlay] Phase 2 complete: ${connectedCount} connected cells in ${phase2Time.toFixed(0)}ms`);

    // Phase 4: Generate texture
    debugPathfinding.log('[NavmeshOverlay] Phase 3: Generating texture...');

    let disconnectedCount = 0;
    let notOnNavmeshCount = 0;

    for (let idx = 0; idx < totalCells; idx++) {
      const i = idx * 4;
      const tType = terrainType[idx];
      const isWalkable = walkableGrid[idx] === 1;
      const isConnected = connectedGrid[idx] === 1;

      if (tType === 2) {
        this.navmeshTextureData![i + 0] = 60;
        this.navmeshTextureData![i + 1] = 60;
        this.navmeshTextureData![i + 2] = 60;
        this.navmeshTextureData![i + 3] = 150;
      } else if (!isWalkable) {
        this.navmeshTextureData![i + 0] = 255;
        this.navmeshTextureData![i + 1] = 50;
        this.navmeshTextureData![i + 2] = 50;
        this.navmeshTextureData![i + 3] = 220;
        notOnNavmeshCount++;
      } else if (isConnected) {
        if (tType === 1) {
          this.navmeshTextureData![i + 0] = 50;
          this.navmeshTextureData![i + 1] = 255;
          this.navmeshTextureData![i + 2] = 200;
          this.navmeshTextureData![i + 3] = 220;
        } else {
          this.navmeshTextureData![i + 0] = 50;
          this.navmeshTextureData![i + 1] = 200;
          this.navmeshTextureData![i + 2] = 50;
          this.navmeshTextureData![i + 3] = 180;
        }
      } else {
        if (tType === 1) {
          this.navmeshTextureData![i + 0] = 255;
          this.navmeshTextureData![i + 1] = 50;
          this.navmeshTextureData![i + 2] = 255;
          this.navmeshTextureData![i + 3] = 255;
        } else {
          this.navmeshTextureData![i + 0] = 255;
          this.navmeshTextureData![i + 1] = 200;
          this.navmeshTextureData![i + 2] = 50;
          this.navmeshTextureData![i + 3] = 220;
        }
        disconnectedCount++;
      }
    }

    this.navmeshTexture.needsUpdate = true;
    this.navmeshProgress = 1;

    const duration = performance.now() - startTime;

    debugPathfinding.log(`[NavmeshOverlay] Completed in ${duration.toFixed(0)}ms`);
    debugPathfinding.log(`[NavmeshOverlay]   Connected: ${connectedCount}, Disconnected: ${disconnectedCount}`);
    debugPathfinding.log(`[NavmeshOverlay]   Not on navmesh: ${notOnNavmeshCount}, Unwalkable: ${unwalkableTerrainCount}`);

    if (disconnectedCount > 0) {
      debugPathfinding.warn(`[NavmeshOverlay] WARNING: ${disconnectedCount} disconnected cells detected!`);
    }

    setOverlayCache(
      this.mapHash,
      'navmesh',
      new Uint8Array(this.navmeshTextureData!),
      width,
      height
    ).catch(() => {});

    this.navmeshCached = true;
    this.navmeshIsComputing = false;

    if (this.onNavmeshComplete) {
      this.onNavmeshComplete({
        connected: connectedCount,
        disconnected: disconnectedCount,
        duration,
      });
    }
  }

  private updateThreatOverlay(): void {
    if (!this.world || !this.threatTextureData || !this.threatTexture) return;

    const { width, height } = this.mapData;
    const localPlayerId = getLocalPlayerId();

    // Clear threat data
    for (let i = 0; i < width * height * 4; i += 4) {
      this.threatTextureData[i + 0] = 0;
      this.threatTextureData[i + 1] = 0;
      this.threatTextureData[i + 2] = 0;
      this.threatTextureData[i + 3] = 0;
    }

    // Accumulate threat from enemy units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const attackRange = unit.attackRange || 5;

      const cx = Math.floor(transform.x);
      const cy = Math.floor(transform.y);
      const rangeInt = Math.ceil(attackRange);

      for (let dy = -rangeInt; dy <= rangeInt; dy++) {
        for (let dx = -rangeInt; dx <= rangeInt; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= attackRange) {
            const i = (py * width + px) * 4;
            const intensity = Math.min(255, this.threatTextureData[i + 0] + 80);
            this.threatTextureData[i + 0] = intensity;
            this.threatTextureData[i + 3] = Math.min(200, this.threatTextureData[i + 3] + 60);
          }
        }
      }
    }

    // Accumulate threat from enemy buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const building = entity.get<Building>('Building')!;
      if (!building.canAttack) continue;

      const transform = entity.get<Transform>('Transform')!;
      const attackRange = building.attackRange || 8;

      const cx = Math.floor(transform.x);
      const cy = Math.floor(transform.y);
      const rangeInt = Math.ceil(attackRange);

      for (let dy = -rangeInt; dy <= rangeInt; dy++) {
        for (let dx = -rangeInt; dx <= rangeInt; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= attackRange) {
            const i = (py * width + px) * 4;
            const intensity = Math.min(255, this.threatTextureData[i + 0] + 100);
            this.threatTextureData[i + 0] = intensity;
            this.threatTextureData[i + 3] = Math.min(220, this.threatTextureData[i + 3] + 80);
          }
        }
      }
    }

    this.threatTexture.needsUpdate = true;
  }

  /**
   * Update resource overlay showing mineral fields and gas geysers
   */
  private updateResourceOverlay(): void {
    if (!this.world || !this.resourceTextureData || !this.resourceTexture) return;

    const { width, height } = this.mapData;

    // Clear resource data
    for (let i = 0; i < width * height * 4; i += 4) {
      this.resourceTextureData[i + 0] = 0;
      this.resourceTextureData[i + 1] = 0;
      this.resourceTextureData[i + 2] = 0;
      this.resourceTextureData[i + 3] = 0;
    }

    // Find all resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      const cx = Math.floor(transform.x);
      const cy = Math.floor(transform.y);

      // Calculate resource percentage remaining
      const percentRemaining = resource.maxAmount > 0 ? resource.amount / resource.maxAmount : 0;

      // Color based on resource type
      let r = 0, g = 0, b = 0;
      const radius = 2;

      if (resource.type === 'minerals') {
        // Blue for minerals
        r = 50;
        g = 150;
        b = 255;
      } else if (resource.type === 'gas') {
        // Green for gas
        r = 50;
        g = 255;
        b = 100;
      } else {
        // Yellow for other
        r = 255;
        g = 200;
        b = 50;
      }

      // Draw resource area with intensity based on remaining amount
      const intensity = 0.5 + percentRemaining * 0.5;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            const i = (py * width + px) * 4;
            const falloff = 1 - (dist / radius) * 0.5;
            this.resourceTextureData[i + 0] = Math.floor(r * intensity * falloff);
            this.resourceTextureData[i + 1] = Math.floor(g * intensity * falloff);
            this.resourceTextureData[i + 2] = Math.floor(b * intensity * falloff);
            this.resourceTextureData[i + 3] = Math.floor(180 * intensity * falloff);
          }
        }
      }
    }

    this.resourceTexture.needsUpdate = true;
  }

  /**
   * Update build grid overlay for building placement
   * Shows green for valid placement, red for invalid
   */
  public updateBuildGrid(
    centerX: number,
    centerY: number,
    buildingWidth: number,
    buildingHeight: number,
    validityChecker: (x: number, y: number) => boolean
  ): void {
    if (!this.buildGridTextureData || !this.buildGridTexture) return;

    const { width, height } = this.mapData;

    // Clear previous grid
    for (let i = 0; i < width * height * 4; i += 4) {
      this.buildGridTextureData[i + 0] = 0;
      this.buildGridTextureData[i + 1] = 0;
      this.buildGridTextureData[i + 2] = 0;
      this.buildGridTextureData[i + 3] = 0;
    }

    // Calculate grid area to show (building footprint + padding)
    const padding = 5;
    const startX = Math.max(0, Math.floor(centerX - buildingWidth / 2) - padding);
    const startY = Math.max(0, Math.floor(centerY - buildingHeight / 2) - padding);
    const endX = Math.min(width, Math.ceil(centerX + buildingWidth / 2) + padding);
    const endY = Math.min(height, Math.ceil(centerY + buildingHeight / 2) + padding);

    // Fill grid cells
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * width + x) * 4;
        const isValid = validityChecker(x, y);

        // R channel = validity (255 = valid, 0 = invalid)
        this.buildGridTextureData[i + 0] = isValid ? 255 : 0;
        this.buildGridTextureData[i + 1] = 0;
        this.buildGridTextureData[i + 2] = 0;
        // Alpha - show grid pattern
        this.buildGridTextureData[i + 3] = 150;
      }
    }

    this.buildGridTexture.needsUpdate = true;
  }

  /**
   * Clear the build grid overlay
   */
  public clearBuildGrid(): void {
    if (!this.buildGridTextureData || !this.buildGridTexture) return;

    const { width, height } = this.mapData;

    for (let i = 0; i < width * height * 4; i += 4) {
      this.buildGridTextureData[i + 0] = 0;
      this.buildGridTextureData[i + 1] = 0;
      this.buildGridTextureData[i + 2] = 0;
      this.buildGridTextureData[i + 3] = 0;
    }

    this.buildGridTexture.needsUpdate = true;
  }

  /**
   * Show/hide build grid
   */
  public setBuildGridVisible(visible: boolean): void {
    if (this.buildGridOverlayMesh) {
      this.buildGridOverlayMesh.visible = visible;
    }
  }

  /**
   * Show/hide resource overlay
   */
  public setResourceOverlayVisible(visible: boolean): void {
    if (this.resourceOverlayMesh) {
      this.resourceOverlayMesh.visible = visible;
      if (visible) {
        this.updateResourceOverlay();
      }
    }
  }

  public setActiveOverlay(type: GameOverlayType): void {
    this.currentOverlay = type;

    if (this.elevationOverlayMesh) this.elevationOverlayMesh.visible = type === 'elevation';
    if (this.threatOverlayMesh) this.threatOverlayMesh.visible = type === 'threat';
    if (this.navmeshOverlayMesh) {
      this.navmeshOverlayMesh.visible = type === 'navmesh';
      if (type === 'navmesh') {
        this.updateNavmeshOverlay();
      }
    }
    if (this.resourceOverlayMesh) {
      this.resourceOverlayMesh.visible = type === 'resource';
      if (type === 'resource') {
        this.updateResourceOverlay();
      }
    }
  }

  public getActiveOverlay(): GameOverlayType {
    return this.currentOverlay;
  }

  public setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));

    const updateMaterialOpacity = (mesh: THREE.Mesh | null) => {
      const mat = mesh?.material as THREE.Material | undefined;
      if ((mat as any)?._uOpacity) {
        (mat as any)._uOpacity.value = this.opacity;
      }
    };

    updateMaterialOpacity(this.elevationOverlayMesh);
    updateMaterialOpacity(this.threatOverlayMesh);
    updateMaterialOpacity(this.navmeshOverlayMesh);
    updateMaterialOpacity(this.resourceOverlayMesh);
  }

  public update(time: number): void {
    // Update threat overlay time for pulsing effect
    const threatMat = this.threatOverlayMesh?.material as THREE.Material | undefined;
    if ((threatMat as any)?._uTime) {
      (threatMat as any)._uTime.value = time;
    }

    // Update resource overlay time for pulsing effect
    const resourceMat = this.resourceOverlayMesh?.material as THREE.Material | undefined;
    if ((resourceMat as any)?._uTime) {
      (resourceMat as any)._uTime.value = time;
    }

    // Update threat data periodically
    if (this.currentOverlay === 'threat') {
      const now = performance.now();
      if (now - this.lastThreatUpdate > this.threatUpdateInterval) {
        this.updateThreatOverlay();
        this.lastThreatUpdate = now;
      }
    }

    // Update resource overlay if visible
    if (this.resourceOverlayMesh?.visible) {
      const now = performance.now();
      if (now - this.lastResourceUpdate > this.resourceUpdateInterval) {
        this.updateResourceOverlay();
        this.lastResourceUpdate = now;
      }
    }
  }

  public dispose(): void {
    const disposeOverlay = (mesh: THREE.Mesh | null, tex: THREE.DataTexture | null) => {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      if (tex) tex.dispose();
    };

    disposeOverlay(this.elevationOverlayMesh, this.elevationTexture);
    disposeOverlay(this.threatOverlayMesh, this.threatTexture);
    disposeOverlay(this.navmeshOverlayMesh, this.navmeshTexture);
    disposeOverlay(this.buildGridOverlayMesh, this.buildGridTexture);
    disposeOverlay(this.resourceOverlayMesh, this.resourceTexture);

    if (this.heightmapTexture) {
      this.heightmapTexture.dispose();
    }
  }
}
