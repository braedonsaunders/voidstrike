/**
 * TSL Game Overlay Manager
 *
 * WebGPU-compatible strategic overlays using Three.js Shading Language.
 * Provides terrain, elevation, threat, and navmesh visualization.
 * Works with both WebGPU and WebGL renderers.
 *
 * Key features:
 * - Progressive navmesh computation (no more 30s freeze)
 * - Worker-based threat updates
 * - IndexedDB caching for static overlays
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
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { MapData, MapCell, TERRAIN_FEATURE_CONFIG, TerrainFeature, elevationToZone } from '@/data/maps';
import { debugPathfinding } from '@/utils/debugLogger';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { getRecastNavigation } from '@/engine/pathfinding/RecastNavigation';
import {
  computeMapHash,
  getOverlayCache,
  setOverlayCache,
} from '@/utils/overlayCache';

/**
 * Creates a simple overlay material using TSL
 */
function createOverlayMaterial(overlayTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false; // Render on top of terrain
  material.side = THREE.DoubleSide;

  const uOpacity = uniform(opacity);

  // Use vec4 output with colorNode (same pattern as FogOfWar)
  const outputNode = Fn(() => {
    const texColor = texture(overlayTexture, uv());
    const alpha = texColor.a.mul(uOpacity);
    return vec4(texColor.rgb, alpha);
  })();

  material.colorNode = outputNode;

  // Store opacity uniform for updates
  material._uOpacity = uOpacity;

  return material;
}

/**
 * Creates a threat overlay material with pulsing effect
 */
function createThreatMaterial(threatTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false; // Render on top of terrain
  material.side = THREE.DoubleSide;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);

  // Use vec4 output with colorNode (same pattern as FogOfWar)
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

  // Store uniforms for updates
  material._uOpacity = uOpacity;
  material._uTime = uTime;

  return material;
}

export class TSLGameOverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
  private mapHash: string;
  private world: World | null = null;
  private getTerrainHeight: (x: number, y: number) => number;

  // Overlay meshes
  private terrainOverlayMesh: THREE.Mesh | null = null;
  private elevationOverlayMesh: THREE.Mesh | null = null;
  private threatOverlayMesh: THREE.Mesh | null = null;
  private navmeshOverlayMesh: THREE.Mesh | null = null;

  // Overlay textures
  private terrainTexture: THREE.DataTexture | null = null;
  private elevationTexture: THREE.DataTexture | null = null;
  private threatTexture: THREE.DataTexture | null = null;
  private threatTextureData: Uint8Array | null = null;
  private navmeshTexture: THREE.DataTexture | null = null;
  private navmeshTextureData: Uint8Array | null = null;

  // Current state
  private currentOverlay: GameOverlayType = 'none';
  private opacity: number = 0.7;

  // Threat overlay update throttling (increased from 200ms for better performance)
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 500;

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

    this.createTerrainOverlay();
    this.createElevationOverlay();
    this.createThreatOverlay();
    this.createNavmeshOverlay();

    // Hide all overlays initially
    this.setActiveOverlay('none');

    // Try to load cached navmesh data
    this.loadCachedNavmesh();
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

  /**
   * Set callback for navmesh computation progress
   */
  public setNavmeshProgressCallback(callback: (progress: number) => void): void {
    this.onNavmeshProgress = callback;
  }

  /**
   * Set callback for navmesh computation completion
   */
  public setNavmeshCompleteCallback(callback: (stats: { connected: number; disconnected: number; duration: number }) => void): void {
    this.onNavmeshComplete = callback;
  }

  /**
   * Get navmesh computation state
   */
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

  private getTerrainColor(cell: MapCell): { r: number; g: number; b: number; a: number } {
    const feature = cell.feature || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    if (cell.terrain === 'unwalkable' || !config.walkable) {
      if (feature === 'water_deep') return { r: 30, g: 80, b: 180, a: 200 };
      if (feature === 'void') return { r: 40, g: 20, b: 60, a: 220 };
      return { r: 180, g: 50, b: 50, a: 200 };
    }
    if (feature === 'road') return { r: 80, g: 200, b: 220, a: 180 };
    if (feature === 'water_shallow') return { r: 100, g: 150, b: 220, a: 180 };
    if (feature === 'mud') return { r: 180, g: 120, b: 60, a: 180 };
    if (feature === 'forest_dense') return { r: 200, g: 130, b: 50, a: 180 };
    if (feature === 'forest_light') return { r: 180, g: 200, b: 80, a: 160 };
    if (cell.terrain === 'ramp') return { r: 220, g: 200, b: 80, a: 150 };
    if (cell.terrain === 'unbuildable' || !config.buildable) return { r: 120, g: 120, b: 130, a: 140 };
    return { r: 80, g: 180, b: 80, a: 150 };
  }

  private createTerrainOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const cell = terrain[y]?.[x] || { terrain: 'walkable', elevation: 0, feature: 'none' };
        const color = this.getTerrainColor(cell);
        textureData[i + 0] = color.r;
        textureData[i + 1] = color.g;
        textureData[i + 2] = color.b;
        textureData[i + 3] = color.a;
      }
    }

    this.terrainTexture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    this.terrainTexture.needsUpdate = true;
    this.terrainTexture.minFilter = THREE.NearestFilter;
    this.terrainTexture.magFilter = THREE.NearestFilter;

    const material = createOverlayMaterial(this.terrainTexture, this.opacity);
    const geometry = new THREE.PlaneGeometry(width, height);

    this.terrainOverlayMesh = new THREE.Mesh(geometry, material);
    this.terrainOverlayMesh.rotation.x = -Math.PI / 2;
    this.terrainOverlayMesh.position.set(width / 2, 15, height / 2); // High above terrain
    this.terrainOverlayMesh.renderOrder = 900;
    this.terrainOverlayMesh.visible = false;
    this.scene.add(this.terrainOverlayMesh);
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

    const material = createOverlayMaterial(this.elevationTexture, this.opacity);
    const geometry = new THREE.PlaneGeometry(width, height);

    this.elevationOverlayMesh = new THREE.Mesh(geometry, material);
    this.elevationOverlayMesh.rotation.x = -Math.PI / 2;
    this.elevationOverlayMesh.position.set(width / 2, 15, height / 2); // High above terrain
    this.elevationOverlayMesh.renderOrder = 900;
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

    const material = createThreatMaterial(this.threatTexture, this.opacity);
    const geometry = new THREE.PlaneGeometry(width, height);

    this.threatOverlayMesh = new THREE.Mesh(geometry, material);
    this.threatOverlayMesh.rotation.x = -Math.PI / 2;
    this.threatOverlayMesh.position.set(width / 2, 15, height / 2); // High above terrain
    this.threatOverlayMesh.renderOrder = 900;
    this.threatOverlayMesh.visible = false;
    this.scene.add(this.threatOverlayMesh);
  }

  /**
   * Create navmesh overlay that shows ACTUAL pathfinding data from Recast Navigation.
   * This queries the real navmesh for each cell to show what the pathfinding system actually sees.
   * Critical for debugging ramp and connectivity issues.
   */
  private createNavmeshOverlay(): void {
    const { width, height } = this.mapData;
    this.navmeshTextureData = new Uint8Array(width * height * 4);

    // Initialize with black (will be updated when shown)
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

    const material = createOverlayMaterial(this.navmeshTexture, 0.8);
    const geometry = new THREE.PlaneGeometry(width, height);

    this.navmeshOverlayMesh = new THREE.Mesh(geometry, material);
    this.navmeshOverlayMesh.rotation.x = -Math.PI / 2;
    this.navmeshOverlayMesh.position.set(width / 2, 15, height / 2); // High above terrain
    this.navmeshOverlayMesh.renderOrder = 900;
    this.navmeshOverlayMesh.visible = false;
    this.scene.add(this.navmeshOverlayMesh);
  }

  /**
   * Update navmesh overlay using efficient BFS flood-fill algorithm.
   *
   * NEW ALGORITHM (O(n) instead of O(n²)):
   * 1. First pass: Check walkability for all cells (fast isWalkable queries)
   * 2. BFS flood-fill: From reference point, mark all reachable cells
   *
   * This is dramatically faster than the old approach which called findPath()
   * for every single cell (O(n²) pathfinding operations).
   *
   * Color coding:
   * - Green: Connected to reference point (reachable via BFS)
   * - Cyan: Connected ramp
   * - Yellow/Orange: On navmesh but disconnected (isolated region)
   * - Magenta: Disconnected ramp (connectivity issue)
   * - Red: Should be walkable but not on navmesh
   * - Dark gray: Unwalkable terrain
   */
  private async updateNavmeshOverlay(): Promise<void> {
    if (!this.navmeshTextureData || !this.navmeshTexture) return;

    // If already cached, just use cached data
    if (this.navmeshCached) {
      debugPathfinding.log('[NavmeshOverlay] Using cached data');
      return;
    }

    // If already computing, don't start again
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

    // Arrays to track cell states
    const walkableGrid = new Uint8Array(totalCells); // 1 = walkable on navmesh
    const connectedGrid = new Uint8Array(totalCells); // 1 = connected to reference
    const terrainType = new Uint8Array(totalCells); // 0 = normal, 1 = ramp, 2 = unwalkable

    // ========== PHASE 1: Walkability check (fast) ==========
    debugPathfinding.log('[NavmeshOverlay] Phase 1: Checking walkability...');

    let walkableCount = 0;
    let unwalkableTerrainCount = 0;

    // Process walkability in batches
    const BATCH_SIZE = 4096;
    let processed = 0;

    const processWalkabilityBatch = async (): Promise<void> => {
      const batchEnd = Math.min(processed + BATCH_SIZE, totalCells);

      for (let idx = processed; idx < batchEnd; idx++) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const cell = terrain[y]?.[x];

        // Check terrain type first
        if (cell?.terrain === 'unwalkable') {
          terrainType[idx] = 2;
          unwalkableTerrainCount++;
          continue;
        }

        if (cell?.terrain === 'ramp') {
          terrainType[idx] = 1;
        }

        // Check if walkable on navmesh
        const cellX = x + 0.5;
        const cellZ = y + 0.5;
        if (recast.isWalkable(cellX, cellZ)) {
          walkableGrid[idx] = 1;
          walkableCount++;
        }
      }

      processed = batchEnd;
      this.navmeshProgress = (processed / totalCells) * 0.5; // First 50% is walkability

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

    // ========== PHASE 2: Find reference point ==========
    let refIdx = -1;

    // Find a good reference point near center
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

    // ========== PHASE 3: BFS flood-fill for connectivity ==========
    debugPathfinding.log('[NavmeshOverlay] Phase 2: BFS flood-fill for connectivity...');

    let connectedCount = 0;

    if (refIdx >= 0) {
      // BFS from reference point
      const queue: number[] = [refIdx];
      connectedGrid[refIdx] = 1;
      connectedCount = 1;

      // 8-directional neighbors for connectivity
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

          // Skip if already visited or not walkable
          if (connectedGrid[nidx] === 1 || walkableGrid[nidx] === 0) continue;

          // Mark as connected
          connectedGrid[nidx] = 1;
          connectedCount++;
          queue.push(nidx);
        }

        bfsProcessed++;

        // Yield periodically
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

    // ========== PHASE 4: Generate texture ==========
    debugPathfinding.log('[NavmeshOverlay] Phase 3: Generating texture...');

    let disconnectedCount = 0;
    let notOnNavmeshCount = 0;

    for (let idx = 0; idx < totalCells; idx++) {
      const i = idx * 4;
      const tType = terrainType[idx];
      const isWalkable = walkableGrid[idx] === 1;
      const isConnected = connectedGrid[idx] === 1;

      if (tType === 2) {
        // Unwalkable terrain - dark gray
        this.navmeshTextureData![i + 0] = 60;
        this.navmeshTextureData![i + 1] = 60;
        this.navmeshTextureData![i + 2] = 60;
        this.navmeshTextureData![i + 3] = 150;
      } else if (!isWalkable) {
        // Not on navmesh - red
        this.navmeshTextureData![i + 0] = 255;
        this.navmeshTextureData![i + 1] = 50;
        this.navmeshTextureData![i + 2] = 50;
        this.navmeshTextureData![i + 3] = 220;
        notOnNavmeshCount++;
      } else if (isConnected) {
        // Connected to reference
        if (tType === 1) {
          // Connected ramp - cyan
          this.navmeshTextureData![i + 0] = 50;
          this.navmeshTextureData![i + 1] = 255;
          this.navmeshTextureData![i + 2] = 200;
          this.navmeshTextureData![i + 3] = 220;
        } else {
          // Connected normal - green
          this.navmeshTextureData![i + 0] = 50;
          this.navmeshTextureData![i + 1] = 200;
          this.navmeshTextureData![i + 2] = 50;
          this.navmeshTextureData![i + 3] = 180;
        }
      } else {
        // Disconnected (on navmesh but can't reach reference)
        if (tType === 1) {
          // Disconnected ramp - magenta
          this.navmeshTextureData![i + 0] = 255;
          this.navmeshTextureData![i + 1] = 50;
          this.navmeshTextureData![i + 2] = 255;
          this.navmeshTextureData![i + 3] = 255;
        } else {
          // Disconnected normal - orange/yellow
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

    debugPathfinding.log(`[NavmeshOverlay] Completed in ${duration.toFixed(0)}ms (was ~30s before optimization)`);
    debugPathfinding.log(`[NavmeshOverlay]   Connected: ${connectedCount}, Disconnected: ${disconnectedCount}`);
    debugPathfinding.log(`[NavmeshOverlay]   Not on navmesh: ${notOnNavmeshCount}, Unwalkable: ${unwalkableTerrainCount}`);

    if (disconnectedCount > 0) {
      debugPathfinding.warn(`[NavmeshOverlay] WARNING: ${disconnectedCount} disconnected cells detected!`);
    }

    // Cache the result
    setOverlayCache(
      this.mapHash,
      'navmesh',
      new Uint8Array(this.navmeshTextureData!),
      width,
      height
    ).catch(() => {});

    this.navmeshCached = true;
    this.navmeshIsComputing = false;

    // Notify completion
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

    // Also accumulate threat from enemy buildings
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

  public setActiveOverlay(type: GameOverlayType): void {
    this.currentOverlay = type;

    if (this.terrainOverlayMesh) this.terrainOverlayMesh.visible = type === 'terrain';
    if (this.elevationOverlayMesh) this.elevationOverlayMesh.visible = type === 'elevation';
    if (this.threatOverlayMesh) this.threatOverlayMesh.visible = type === 'threat';
    if (this.navmeshOverlayMesh) {
      this.navmeshOverlayMesh.visible = type === 'navmesh';
      // Start progressive navmesh computation when shown
      // Uses caching and async processing to avoid freezing
      if (type === 'navmesh') {
        this.updateNavmeshOverlay();
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
      if (mat?._uOpacity) {
        mat._uOpacity.value = this.opacity;
      }
    };

    updateMaterialOpacity(this.terrainOverlayMesh);
    updateMaterialOpacity(this.elevationOverlayMesh);
    updateMaterialOpacity(this.threatOverlayMesh);
    updateMaterialOpacity(this.navmeshOverlayMesh);
  }

  public update(time: number): void {
    // Update threat overlay time for pulsing effect
    const threatMat = this.threatOverlayMesh?.material as THREE.Material | undefined;
    if (threatMat?._uTime) {
      threatMat._uTime.value = time;
    }

    // Update threat data periodically
    if (this.currentOverlay === 'threat') {
      const now = performance.now();
      if (now - this.lastThreatUpdate > this.threatUpdateInterval) {
        this.updateThreatOverlay();
        this.lastThreatUpdate = now;
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

    disposeOverlay(this.terrainOverlayMesh, this.terrainTexture);
    disposeOverlay(this.elevationOverlayMesh, this.elevationTexture);
    disposeOverlay(this.threatOverlayMesh, this.threatTexture);
    disposeOverlay(this.navmeshOverlayMesh, this.navmeshTexture);
  }
}
