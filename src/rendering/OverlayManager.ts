/**
 * Unified Overlay Manager
 *
 * Central manager for all game overlays, coordinating between:
 * - 3D strategic overlays (terrain, elevation, threat, navmesh, buildable)
 * - 2D tactical overlays (attack range, vision range, resource markers)
 *
 * Features:
 * - Progressive loading for expensive overlays (navmesh)
 * - Web Worker offloading for heavy computation
 * - IndexedDB caching for static overlays
 * - Keyboard shortcuts (SC2-style)
 * - Multiple simultaneous overlays support
 */

import * as THREE from 'three';
import { MapData, MapCell, TERRAIN_FEATURE_CONFIG } from '@/data/maps';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { getRecastNavigation } from '@/engine/pathfinding/RecastNavigation';
import { debugPathfinding } from '@/utils/debugLogger';
import {
  computeMapHash,
  getOverlayCache,
  setOverlayCache,
  cleanupOldCacheEntries,
} from '@/utils/overlayCache';

// Extended overlay types including new SC2-style features
export type ExtendedOverlayType =
  | GameOverlayType
  | 'buildable'
  | 'attackRange'
  | 'visionRange'
  | 'resource';

// Chunk size for progressive navmesh rendering
const NAVMESH_CHUNK_SIZE = 32;

// Navmesh computation state
interface NavmeshComputeState {
  isComputing: boolean;
  progress: number;
  totalChunks: number;
  processedChunks: number;
  startTime: number;
  abortController: AbortController | null;
}

export class OverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
  private mapHash: string;
  private world: World | null = null;
  private getTerrainHeight: (x: number, y: number) => number;

  // Overlay workers
  private pathfindingWorker: Worker | null = null;
  private overlayWorker: Worker | null = null;

  // Active overlays (can have multiple)
  private activeOverlays: Set<ExtendedOverlayType> = new Set();

  // Overlay meshes and textures
  private overlayMeshes: Map<string, THREE.Mesh> = new Map();
  private overlayTextures: Map<string, THREE.DataTexture> = new Map();
  private overlayTextureData: Map<string, Uint8Array> = new Map();

  // Opacity per overlay type
  private overlayOpacity: Map<ExtendedOverlayType, number> = new Map([
    ['terrain', 0.7],
    ['elevation', 0.7],
    ['threat', 0.5],
    ['navmesh', 0.8],
    ['buildable', 0.6],
    ['attackRange', 0.4],
    ['visionRange', 0.3],
    ['resource', 0.7],
  ]);

  // Navmesh computation state
  private navmeshState: NavmeshComputeState = {
    isComputing: false,
    progress: 0,
    totalChunks: 0,
    processedChunks: 0,
    startTime: 0,
    abortController: null,
  };

  // Callbacks for progress updates
  private onNavmeshProgress: ((progress: number) => void) | null = null;
  private onNavmeshComplete: ((stats: {
    connected: number;
    disconnected: number;
    notOnNavmesh: number;
    unwalkable: number;
    duration: number;
  }) => void) | null = null;

  // Threat overlay update tracking
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 500; // Increased from 200ms

  // Pending worker requests
  private pendingRequests: Map<number, (result: unknown) => void> = new Map();
  private nextRequestId: number = 0;

  constructor(
    scene: THREE.Scene,
    mapData: MapData,
    getTerrainHeight: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight;
    this.mapHash = computeMapHash(mapData);

    this.initializeWorkers();
    this.createOverlays();

    // Clean up old cache entries on initialization
    cleanupOldCacheEntries().catch(() => {});
  }

  /**
   * Initialize web workers for heavy computation
   */
  private initializeWorkers(): void {
    try {
      this.overlayWorker = new Worker(
        new URL('../workers/overlay.worker.ts', import.meta.url)
      );

      this.overlayWorker.onmessage = this.handleOverlayWorkerMessage.bind(this);
      this.overlayWorker.onerror = (error) => {
        console.error('[OverlayManager] Overlay worker error:', error);
      };

      // Initialize with map dimensions
      this.overlayWorker.postMessage({
        type: 'init',
        mapWidth: this.mapData.width,
        mapHeight: this.mapData.height,
      });
    } catch (error) {
      console.warn('[OverlayManager] Failed to create overlay worker:', error);
    }
  }

  /**
   * Handle messages from overlay worker
   */
  private handleOverlayWorkerMessage(event: MessageEvent): void {
    const data = event.data;

    switch (data.type) {
      case 'initialized':
        debugPathfinding.log('[OverlayManager] Overlay worker initialized');
        break;

      case 'navmeshChunk':
        this.handleNavmeshChunk(data);
        break;

      case 'navmeshComplete':
        this.handleNavmeshComplete(data);
        break;

      case 'threatResult':
        this.handleThreatResult(data);
        break;

      case 'buildableResult':
        this.handleBuildableResult(data);
        break;

      case 'error':
        console.error('[OverlayManager] Worker error:', data.message);
        break;
    }
  }

  /**
   * Handle a computed navmesh chunk from the worker
   */
  private handleNavmeshChunk(data: {
    chunkX: number;
    chunkY: number;
    chunkWidth: number;
    chunkHeight: number;
    data: Uint8Array;
    progress: number;
  }): void {
    const textureData = this.overlayTextureData.get('navmesh');
    const texture = this.overlayTextures.get('navmesh');

    if (!textureData || !texture) return;

    const { width } = this.mapData;

    // Copy chunk data into texture
    for (let cy = 0; cy < data.chunkHeight; cy++) {
      for (let cx = 0; cx < data.chunkWidth; cx++) {
        const srcIdx = (cy * data.chunkWidth + cx) * 4;
        const dstIdx = ((data.chunkY + cy) * width + (data.chunkX + cx)) * 4;

        textureData[dstIdx + 0] = data.data[srcIdx + 0];
        textureData[dstIdx + 1] = data.data[srcIdx + 1];
        textureData[dstIdx + 2] = data.data[srcIdx + 2];
        textureData[dstIdx + 3] = data.data[srcIdx + 3];
      }
    }

    texture.needsUpdate = true;

    // Update progress
    this.navmeshState.progress = data.progress;
    this.navmeshState.processedChunks++;

    if (this.onNavmeshProgress) {
      this.onNavmeshProgress(data.progress);
    }
  }

  /**
   * Handle navmesh computation completion
   */
  private handleNavmeshComplete(data: {
    stats: {
      connected: number;
      disconnected: number;
      notOnNavmesh: number;
      unwalkable: number;
    };
  }): void {
    const duration = performance.now() - this.navmeshState.startTime;

    this.navmeshState.isComputing = false;
    this.navmeshState.progress = 1;

    debugPathfinding.log(`[OverlayManager] Navmesh overlay computed in ${duration.toFixed(0)}ms`);
    debugPathfinding.log(`[OverlayManager] Connected: ${data.stats.connected}, Disconnected: ${data.stats.disconnected}`);

    if (data.stats.disconnected > 0) {
      debugPathfinding.warn(`[OverlayManager] WARNING: ${data.stats.disconnected} disconnected cells detected!`);
    }

    // Cache the computed navmesh data
    const textureData = this.overlayTextureData.get('navmesh');
    if (textureData) {
      setOverlayCache(
        this.mapHash,
        'navmesh',
        new Uint8Array(textureData),
        this.mapData.width,
        this.mapData.height
      ).catch(() => {});
    }

    if (this.onNavmeshComplete) {
      this.onNavmeshComplete({ ...data.stats, duration });
    }
  }

  /**
   * Handle threat computation result from worker
   */
  private handleThreatResult(data: { data: Uint8Array }): void {
    const textureData = this.overlayTextureData.get('threat');
    const texture = this.overlayTextures.get('threat');

    if (!textureData || !texture) return;

    // Copy data
    textureData.set(data.data);
    texture.needsUpdate = true;
  }

  /**
   * Handle buildable grid computation result
   */
  private handleBuildableResult(data: { data: Uint8Array }): void {
    const textureData = this.overlayTextureData.get('buildable');
    const texture = this.overlayTextures.get('buildable');

    if (!textureData || !texture) return;

    textureData.set(data.data);
    texture.needsUpdate = true;

    // Cache the result
    setOverlayCache(
      this.mapHash,
      'buildable',
      new Uint8Array(data.data),
      this.mapData.width,
      this.mapData.height
    ).catch(() => {});
  }

  /**
   * Set the game world reference
   */
  public setWorld(world: World): void {
    this.world = world;
  }

  /**
   * Create all overlay meshes and textures
   */
  private createOverlays(): void {
    this.createTerrainOverlay();
    this.createElevationOverlay();
    this.createThreatOverlay();
    this.createNavmeshOverlay();
    this.createBuildableOverlay();
  }

  /**
   * Create a basic overlay mesh with material
   */
  private createOverlayMesh(
    name: string,
    texture: THREE.DataTexture,
    opacity: number,
    pulsing: boolean = false
  ): THREE.Mesh {
    const { width, height } = this.mapData;

    const geometry = new THREE.PlaneGeometry(width, height);

    let material: THREE.MeshBasicMaterial;
    if (pulsing) {
      // For threat overlay, we'd normally use TSL, but for simplicity use basic material
      material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(width / 2, 15, height / 2);
    mesh.renderOrder = 900;
    mesh.visible = false;
    mesh.name = `overlay_${name}`;

    this.scene.add(mesh);
    this.overlayMeshes.set(name, mesh);

    return mesh;
  }

  /**
   * Get terrain color for a cell
   */
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

  /**
   * Create terrain overlay
   */
  private async createTerrainOverlay(): Promise<void> {
    const { width, height, terrain } = this.mapData;

    // Try to load from cache first
    const cached = await getOverlayCache(this.mapHash, 'terrain');
    let textureData: Uint8Array;

    if (cached && cached.width === width && cached.height === height) {
      textureData = cached.data;
      debugPathfinding.log('[OverlayManager] Loaded terrain overlay from cache');
    } else {
      // Compute terrain overlay
      textureData = new Uint8Array(width * height * 4);

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

      // Cache for next time
      setOverlayCache(this.mapHash, 'terrain', new Uint8Array(textureData), width, height).catch(() => {});
    }

    const texture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    this.overlayTextures.set('terrain', texture);
    this.overlayTextureData.set('terrain', textureData);
    this.createOverlayMesh('terrain', texture, this.overlayOpacity.get('terrain') || 0.7);
  }

  /**
   * Create elevation overlay
   */
  private async createElevationOverlay(): Promise<void> {
    const { width, height, terrain } = this.mapData;

    // Try to load from cache first
    const cached = await getOverlayCache(this.mapHash, 'elevation');
    let textureData: Uint8Array;

    if (cached && cached.width === width && cached.height === height) {
      textureData = cached.data;
      debugPathfinding.log('[OverlayManager] Loaded elevation overlay from cache');
    } else {
      textureData = new Uint8Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const cell = terrain[y]?.[x];
          const elevation = cell?.elevation ?? 0;

          // Color based on elevation zone
          let color: { r: number; g: number; b: number; a: number };
          if (elevation >= 100) {
            color = { r: 255, g: 220, b: 100, a: 160 }; // High - yellow
          } else if (elevation >= 50) {
            color = { r: 100, g: 180, b: 255, a: 140 }; // Mid - blue
          } else {
            color = { r: 80, g: 120, b: 80, a: 120 }; // Low - green
          }

          textureData[i + 0] = color.r;
          textureData[i + 1] = color.g;
          textureData[i + 2] = color.b;
          textureData[i + 3] = color.a;
        }
      }

      setOverlayCache(this.mapHash, 'elevation', new Uint8Array(textureData), width, height).catch(() => {});
    }

    const texture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.overlayTextures.set('elevation', texture);
    this.overlayTextureData.set('elevation', textureData);
    this.createOverlayMesh('elevation', texture, this.overlayOpacity.get('elevation') || 0.7);
  }

  /**
   * Create threat overlay (dynamic, updated periodically)
   */
  private createThreatOverlay(): void {
    const { width, height } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    const texture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.overlayTextures.set('threat', texture);
    this.overlayTextureData.set('threat', textureData);
    this.createOverlayMesh('threat', texture, this.overlayOpacity.get('threat') || 0.5, true);
  }

  /**
   * Create navmesh overlay (computed progressively)
   */
  private async createNavmeshOverlay(): Promise<void> {
    const { width, height } = this.mapData;

    // Try to load from cache first
    const cached = await getOverlayCache(this.mapHash, 'navmesh');
    let textureData: Uint8Array;

    if (cached && cached.width === width && cached.height === height) {
      textureData = cached.data;
      debugPathfinding.log('[OverlayManager] Loaded navmesh overlay from cache');
    } else {
      // Initialize with transparent black - will be computed when shown
      textureData = new Uint8Array(width * height * 4);
    }

    const texture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    this.overlayTextures.set('navmesh', texture);
    this.overlayTextureData.set('navmesh', textureData);
    this.createOverlayMesh('navmesh', texture, this.overlayOpacity.get('navmesh') || 0.8);
  }

  /**
   * Create buildable grid overlay
   */
  private async createBuildableOverlay(): Promise<void> {
    const { width, height } = this.mapData;

    // Try to load from cache first
    const cached = await getOverlayCache(this.mapHash, 'buildable');
    let textureData: Uint8Array;

    if (cached && cached.width === width && cached.height === height) {
      textureData = cached.data;
      debugPathfinding.log('[OverlayManager] Loaded buildable overlay from cache');
    } else {
      // Initialize - will be computed when needed
      textureData = new Uint8Array(width * height * 4);
    }

    const texture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;

    this.overlayTextures.set('buildable', texture);
    this.overlayTextureData.set('buildable', textureData);
    this.createOverlayMesh('buildable', texture, this.overlayOpacity.get('buildable') || 0.6);
  }

  /**
   * Compute navmesh overlay progressively using Web Worker
   */
  public async computeNavmeshOverlay(): Promise<void> {
    if (this.navmeshState.isComputing) {
      debugPathfinding.log('[OverlayManager] Navmesh computation already in progress');
      return;
    }

    // Check if we have cached data
    const cached = await getOverlayCache(this.mapHash, 'navmesh');
    if (cached && cached.width === this.mapData.width && cached.height === this.mapData.height) {
      // Use cached data
      const textureData = this.overlayTextureData.get('navmesh');
      const texture = this.overlayTextures.get('navmesh');
      if (textureData && texture) {
        textureData.set(cached.data);
        texture.needsUpdate = true;
        debugPathfinding.log('[OverlayManager] Using cached navmesh overlay');
        if (this.onNavmeshComplete) {
          this.onNavmeshComplete({
            connected: 0,
            disconnected: 0,
            notOnNavmesh: 0,
            unwalkable: 0,
            duration: 0,
          });
        }
        return;
      }
    }

    const recast = getRecastNavigation();
    if (!recast.isReady()) {
      debugPathfinding.warn('[OverlayManager] Recast navigation not ready');
      return;
    }

    this.navmeshState.isComputing = true;
    this.navmeshState.progress = 0;
    this.navmeshState.startTime = performance.now();
    this.navmeshState.processedChunks = 0;

    const { width, height, terrain } = this.mapData;

    // Calculate total chunks
    const chunksX = Math.ceil(width / NAVMESH_CHUNK_SIZE);
    const chunksY = Math.ceil(height / NAVMESH_CHUNK_SIZE);
    this.navmeshState.totalChunks = chunksX * chunksY;

    // Find reference point (center of map at low elevation)
    let refX = width / 2;
    let refY = height / 2;

    for (let r = 0; r < Math.max(width, height) / 2; r++) {
      let found = false;
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = Math.floor(width / 2) + dx;
          const y = Math.floor(height / 2) + dy;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const cell = terrain[y]?.[x];
            if (cell && cell.terrain !== 'unwalkable' && cell.terrain !== 'ramp' && cell.elevation < 50) {
              refX = x + 0.5;
              refY = y + 0.5;
              found = true;
            }
          }
        }
      }
      if (found) break;
    }

    debugPathfinding.log(`[OverlayManager] Computing navmesh overlay with ref point (${refX.toFixed(1)}, ${refY.toFixed(1)})`);

    // Pre-compute walkability and terrain data on main thread
    // (Recast queries must happen on main thread)
    const walkableData = new Uint8Array(width * height);
    const terrainData = new Uint8Array(width * height);
    const connectivityData = new Uint8Array(width * height);

    // Process in batches to avoid blocking
    const BATCH_SIZE = 4096;
    let processed = 0;

    const processBatch = async (): Promise<void> => {
      const start = processed;
      const end = Math.min(processed + BATCH_SIZE, width * height);

      for (let i = start; i < end; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        const cell = terrain[y]?.[x];
        const cellX = x + 0.5;
        const cellZ = y + 0.5;

        // Terrain type
        if (cell?.terrain === 'unwalkable') {
          terrainData[i] = 2;
        } else if (cell?.terrain === 'ramp') {
          terrainData[i] = 1;
        } else {
          terrainData[i] = 0;
        }

        // Walkability
        const isWalkable = recast.isWalkable(cellX, cellZ);
        walkableData[i] = isWalkable ? 1 : 0;

        // Connectivity (only for walkable cells)
        if (isWalkable && terrainData[i] !== 2) {
          const pathResult = recast.findPath(cellX, cellZ, refX, refY);
          connectivityData[i] = (pathResult.found && pathResult.path.length > 0) ? 1 : 0;
        } else {
          connectivityData[i] = 0;
        }
      }

      processed = end;

      // Update progress for pre-computation phase (0-50%)
      const precomputeProgress = processed / (width * height) * 0.5;
      if (this.onNavmeshProgress) {
        this.onNavmeshProgress(precomputeProgress);
      }

      if (processed < width * height) {
        // Yield to main thread
        await new Promise(resolve => setTimeout(resolve, 0));
        await processBatch();
      }
    };

    await processBatch();

    // Send to worker for final processing
    if (this.overlayWorker) {
      this.overlayWorker.postMessage({
        type: 'computeNavmesh',
        refX,
        refY,
        walkableData,
        terrainData,
        connectivityData,
      }, {
        transfer: [walkableData.buffer, terrainData.buffer, connectivityData.buffer]
      });
    } else {
      // Fallback: process directly (will be slower but works)
      this.processNavmeshDirectly(refX, refY, walkableData, terrainData, connectivityData);
    }
  }

  /**
   * Fallback navmesh processing when worker is not available
   */
  private processNavmeshDirectly(
    refX: number,
    refY: number,
    walkableData: Uint8Array,
    terrainData: Uint8Array,
    connectivityData: Uint8Array
  ): void {
    const { width, height } = this.mapData;
    const textureData = this.overlayTextureData.get('navmesh');
    const texture = this.overlayTextures.get('navmesh');

    if (!textureData || !texture) return;

    let connectedCount = 0;
    let disconnectedCount = 0;
    let notOnNavmeshCount = 0;
    let unwalkableCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const mapIndex = y * width + x;
        const texIndex = mapIndex * 4;

        const isWalkable = walkableData[mapIndex] === 1;
        const terrainType = terrainData[mapIndex];
        const isConnected = connectivityData[mapIndex] === 1;

        if (terrainType === 2) {
          textureData[texIndex + 0] = 60;
          textureData[texIndex + 1] = 60;
          textureData[texIndex + 2] = 60;
          textureData[texIndex + 3] = 150;
          unwalkableCount++;
        } else if (!isWalkable) {
          textureData[texIndex + 0] = 255;
          textureData[texIndex + 1] = 50;
          textureData[texIndex + 2] = 50;
          textureData[texIndex + 3] = 220;
          notOnNavmeshCount++;
        } else if (isConnected) {
          if (terrainType === 1) {
            textureData[texIndex + 0] = 50;
            textureData[texIndex + 1] = 255;
            textureData[texIndex + 2] = 200;
            textureData[texIndex + 3] = 220;
          } else {
            textureData[texIndex + 0] = 50;
            textureData[texIndex + 1] = 200;
            textureData[texIndex + 2] = 50;
            textureData[texIndex + 3] = 180;
          }
          connectedCount++;
        } else {
          if (terrainType === 1) {
            textureData[texIndex + 0] = 255;
            textureData[texIndex + 1] = 50;
            textureData[texIndex + 2] = 255;
            textureData[texIndex + 3] = 255;
          } else {
            textureData[texIndex + 0] = 255;
            textureData[texIndex + 1] = 200;
            textureData[texIndex + 2] = 50;
            textureData[texIndex + 3] = 220;
          }
          disconnectedCount++;
        }
      }
    }

    texture.needsUpdate = true;
    this.navmeshState.isComputing = false;
    this.navmeshState.progress = 1;

    const duration = performance.now() - this.navmeshState.startTime;

    if (this.onNavmeshComplete) {
      this.onNavmeshComplete({
        connected: connectedCount,
        disconnected: disconnectedCount,
        notOnNavmesh: notOnNavmeshCount,
        unwalkable: unwalkableCount,
        duration,
      });
    }

    // Cache result
    setOverlayCache(
      this.mapHash,
      'navmesh',
      new Uint8Array(textureData),
      width,
      height
    ).catch(() => {});
  }

  /**
   * Update threat overlay using worker
   */
  public updateThreatOverlay(): void {
    if (!this.world) return;

    const localPlayerId = getLocalPlayerId();
    const enemies: Array<{ x: number; y: number; attackRange: number; isBuilding: boolean }> = [];

    // Collect enemy units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;

      enemies.push({
        x: transform.x,
        y: transform.y,
        attackRange: unit.attackRange || 5,
        isBuilding: false,
      });
    }

    // Collect enemy buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const building = entity.get<Building>('Building')!;
      if (!building.canAttack) continue;

      const transform = entity.get<Transform>('Transform')!;

      enemies.push({
        x: transform.x,
        y: transform.y,
        attackRange: building.attackRange || 8,
        isBuilding: true,
      });
    }

    // Send to worker
    if (this.overlayWorker) {
      this.overlayWorker.postMessage({
        type: 'computeThreat',
        enemies,
      });
    } else {
      // Fallback: compute directly
      this.computeThreatDirectly(enemies);
    }
  }

  /**
   * Fallback threat computation when worker is not available
   */
  private computeThreatDirectly(
    enemies: Array<{ x: number; y: number; attackRange: number; isBuilding: boolean }>
  ): void {
    const { width, height } = this.mapData;
    const textureData = this.overlayTextureData.get('threat');
    const texture = this.overlayTextures.get('threat');

    if (!textureData || !texture) return;

    // Clear
    for (let i = 0; i < textureData.length; i += 4) {
      textureData[i + 0] = 0;
      textureData[i + 1] = 0;
      textureData[i + 2] = 0;
      textureData[i + 3] = 0;
    }

    // Accumulate threat
    for (const enemy of enemies) {
      const cx = Math.floor(enemy.x);
      const cy = Math.floor(enemy.y);
      const rangeInt = Math.ceil(enemy.attackRange);
      const baseIntensity = enemy.isBuilding ? 100 : 80;
      const baseAlpha = enemy.isBuilding ? 80 : 60;

      for (let dy = -rangeInt; dy <= rangeInt; dy++) {
        for (let dx = -rangeInt; dx <= rangeInt; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= enemy.attackRange) {
            const i = (py * width + px) * 4;
            textureData[i + 0] = Math.min(255, textureData[i + 0] + baseIntensity);
            textureData[i + 3] = Math.min(220, textureData[i + 3] + baseAlpha);
          }
        }
      }
    }

    texture.needsUpdate = true;
  }

  /**
   * Update buildable grid overlay
   */
  public updateBuildableOverlay(): void {
    const { width, height, terrain } = this.mapData;

    // Compute terrain buildability
    const terrainBuildable = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y]?.[x];
        const feature = cell?.feature || 'none';
        const config = TERRAIN_FEATURE_CONFIG[feature];

        if (cell?.terrain === 'unbuildable' || cell?.terrain === 'unwalkable' || !config.buildable) {
          terrainBuildable[y * width + x] = 1; // Unbuildable
        } else {
          terrainBuildable[y * width + x] = 0; // Buildable
        }
      }
    }

    // Get current buildings
    const buildingData: Array<{ x: number; y: number; width: number; height: number }> = [];
    if (this.world) {
      const buildings = this.world.getEntitiesWith('Building', 'Transform');
      for (const entity of buildings) {
        const transform = entity.get<Transform>('Transform')!;
        const building = entity.get<Building>('Building')!;

        buildingData.push({
          x: transform.x,
          y: transform.y,
          width: building.width || 3,
          height: building.height || 3,
        });
      }
    }

    // Send to worker
    if (this.overlayWorker) {
      this.overlayWorker.postMessage({
        type: 'computeBuildable',
        terrainData: terrainBuildable,
        buildings: buildingData,
      }, { transfer: [terrainBuildable.buffer] });
    }
  }

  /**
   * Show an overlay
   */
  public showOverlay(type: ExtendedOverlayType): void {
    const mesh = this.overlayMeshes.get(type);
    if (mesh) {
      mesh.visible = true;
      this.activeOverlays.add(type);

      // Trigger computation for dynamic overlays
      if (type === 'navmesh' && !this.navmeshState.isComputing) {
        this.computeNavmeshOverlay();
      } else if (type === 'threat') {
        this.updateThreatOverlay();
      } else if (type === 'buildable') {
        this.updateBuildableOverlay();
      }
    }
  }

  /**
   * Hide an overlay
   */
  public hideOverlay(type: ExtendedOverlayType): void {
    const mesh = this.overlayMeshes.get(type);
    if (mesh) {
      mesh.visible = false;
      this.activeOverlays.delete(type);
    }
  }

  /**
   * Toggle an overlay
   */
  public toggleOverlay(type: ExtendedOverlayType): void {
    if (this.activeOverlays.has(type)) {
      this.hideOverlay(type);
    } else {
      this.showOverlay(type);
    }
  }

  /**
   * Set the active overlay (hides all others, shows this one)
   * For backwards compatibility with single-overlay mode
   */
  public setActiveOverlay(type: GameOverlayType): void {
    // Hide all overlays
    for (const [name, mesh] of this.overlayMeshes) {
      mesh.visible = false;
    }
    this.activeOverlays.clear();

    // Show the requested overlay
    if (type !== 'none') {
      this.showOverlay(type);
    }
  }

  /**
   * Get the currently active overlay (for backwards compatibility)
   */
  public getActiveOverlay(): GameOverlayType {
    if (this.activeOverlays.has('terrain')) return 'terrain';
    if (this.activeOverlays.has('elevation')) return 'elevation';
    if (this.activeOverlays.has('threat')) return 'threat';
    if (this.activeOverlays.has('navmesh')) return 'navmesh';
    return 'none';
  }

  /**
   * Check if an overlay is active
   */
  public isOverlayActive(type: ExtendedOverlayType): boolean {
    return this.activeOverlays.has(type);
  }

  /**
   * Set opacity for an overlay
   */
  public setOverlayOpacity(type: ExtendedOverlayType, opacity: number): void {
    this.overlayOpacity.set(type, Math.max(0, Math.min(1, opacity)));

    const mesh = this.overlayMeshes.get(type);
    if (mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
      mesh.material.opacity = this.overlayOpacity.get(type) || 0.7;
    }
  }

  /**
   * Set legacy opacity (affects all overlays)
   */
  public setOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity));

    for (const [name, mesh] of this.overlayMeshes) {
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.opacity = clamped;
      }
    }
  }

  /**
   * Set progress callback for navmesh computation
   */
  public setNavmeshProgressCallback(callback: (progress: number) => void): void {
    this.onNavmeshProgress = callback;
  }

  /**
   * Set completion callback for navmesh computation
   */
  public setNavmeshCompleteCallback(callback: (stats: {
    connected: number;
    disconnected: number;
    notOnNavmesh: number;
    unwalkable: number;
    duration: number;
  }) => void): void {
    this.onNavmeshComplete = callback;
  }

  /**
   * Get navmesh computation state
   */
  public getNavmeshState(): NavmeshComputeState {
    return { ...this.navmeshState };
  }

  /**
   * Update overlays (called each frame)
   */
  public update(time: number): void {
    // Update threat overlay periodically
    if (this.activeOverlays.has('threat')) {
      const now = performance.now();
      if (now - this.lastThreatUpdate > this.threatUpdateInterval) {
        this.updateThreatOverlay();
        this.lastThreatUpdate = now;
      }
    }
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Terminate workers
    if (this.overlayWorker) {
      this.overlayWorker.terminate();
      this.overlayWorker = null;
    }

    // Dispose meshes and textures
    for (const [name, mesh] of this.overlayMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    }

    for (const [name, texture] of this.overlayTextures) {
      texture.dispose();
    }

    this.overlayMeshes.clear();
    this.overlayTextures.clear();
    this.overlayTextureData.clear();
    this.activeOverlays.clear();
    this.pendingRequests.clear();
  }
}
