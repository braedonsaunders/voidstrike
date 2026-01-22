/**
 * TSL Game Overlay Manager
 *
 * WebGPU-compatible strategic overlays using Three.js Shading Language.
 * Provides elevation, threat, navmesh, resource, and buildable visualization.
 * Also provides SC2-style unit range indicators (attack/vision).
 * Works with both WebGPU and WebGL renderers.
 *
 * Key features:
 * - Progressive navmesh computation with BFS flood-fill
 * - IndexedDB caching for static overlays
 * - Terrain-conforming rendering (overlays follow terrain height)
 * - Unit-centric range rings for selected units
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
import { MapData, elevationToZone } from '@/data/maps';
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
import { distance, clamp } from '@/utils/math';

// Overlay height above terrain
const OVERLAY_Y_OFFSET = 0.3;

/**
 * Creates a simple overlay material using TSL
 */
function createOverlayMaterial(overlayTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  // Polygon offset to render above terrain
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;

  const uOpacity = uniform(opacity);

  const outputNode = Fn(() => {
    const texColor = texture(overlayTexture, uv());
    const alpha = texColor.a.mul(uOpacity);
    return vec4(texColor.rgb, alpha);
  })();

  material.colorNode = outputNode;
  (material as any)._uOpacity = uOpacity;

  return material;
}

/**
 * Creates a threat overlay material with pulsing effect
 */
function createThreatMaterial(threatTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);

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

  return material;
}

/**
 * Creates a resource overlay material with gentle pulse
 */
function createResourceMaterial(resourceTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;

  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);

  const outputNode = Fn(() => {
    const texColor = texture(resourceTexture, uv());
    const pulse = float(0.9).add(float(0.1).mul(sin(uTime.mul(1.5))));
    const resourceColor = texColor.rgb.mul(pulse);
    const alpha = texColor.a.mul(uOpacity);
    return vec4(resourceColor, alpha);
  })();

  material.colorNode = outputNode;
  (material as any)._uOpacity = uOpacity;
  (material as any)._uTime = uTime;

  return material;
}

// Range ring configuration
const RING_SEGMENTS = 64;
const RING_LINE_WIDTH = 0.15;
const ATTACK_RANGE_COLOR = 0xff4444;
const VISION_RANGE_COLOR = 0x4488ff;

export class TSLGameOverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
  private mapHash: string;
  private world: World | null = null;
  private getTerrainHeight: (x: number, y: number) => number;

  // Overlay meshes
  private elevationOverlayMesh: THREE.Mesh | null = null;
  private threatOverlayMesh: THREE.Mesh | null = null;
  private navmeshOverlayMesh: THREE.Mesh | null = null;
  private resourceOverlayMesh: THREE.Mesh | null = null;
  private buildableOverlayMesh: THREE.Mesh | null = null;

  // Overlay textures
  private elevationTexture: THREE.DataTexture | null = null;
  private threatTexture: THREE.DataTexture | null = null;
  private threatTextureData: Uint8Array | null = null;
  private navmeshTexture: THREE.DataTexture | null = null;
  private navmeshTextureData: Uint8Array | null = null;
  private resourceTexture: THREE.DataTexture | null = null;
  private resourceTextureData: Uint8Array | null = null;
  private buildableTexture: THREE.DataTexture | null = null;

  // Range ring groups (SC2-style unit range indicators)
  private attackRangeGroup: THREE.Group;
  private visionRangeGroup: THREE.Group;
  private attackRangeMaterial: THREE.MeshBasicMaterial;
  private visionRangeMaterial: THREE.MeshBasicMaterial;

  // Current state
  private currentOverlay: GameOverlayType = 'none';
  private opacity: number = 0.7;
  private showAttackRange: boolean = false;
  private showVisionRange: boolean = false;
  private selectedEntityIds: number[] = [];

  // Threat overlay update throttling
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 500;

  // Resource overlay update throttling
  private lastResourceUpdate: number = 0;
  private resourceUpdateInterval: number = 1000;

  // Range overlay update throttling
  private lastRangeUpdate: number = 0;
  private rangeUpdateInterval: number = 100;

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

    // Create range ring groups
    this.attackRangeGroup = new THREE.Group();
    this.attackRangeGroup.visible = false;
    this.scene.add(this.attackRangeGroup);

    this.visionRangeGroup = new THREE.Group();
    this.visionRangeGroup.visible = false;
    this.scene.add(this.visionRangeGroup);

    // Create range ring materials
    this.attackRangeMaterial = new THREE.MeshBasicMaterial({
      color: ATTACK_RANGE_COLOR,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.visionRangeMaterial = new THREE.MeshBasicMaterial({
      color: VISION_RANGE_COLOR,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Create all overlays
    this.createElevationOverlay();
    this.createThreatOverlay();
    this.createNavmeshOverlay();
    this.createResourceOverlay();
    this.createBuildableOverlay();

    // Hide all overlays initially
    this.setActiveOverlay('none');

    // Try to load cached navmesh data
    this.loadCachedNavmesh();

    debugPathfinding.log('[GameOverlay] Overlay manager initialized');
  }

  /**
   * Create terrain-conforming geometry by displacing vertices based on heightmap
   */
  private createTerrainConformingGeometry(): THREE.PlaneGeometry {
    const { width, height } = this.mapData;

    // Create plane with subdivisions matching map resolution
    const geometry = new THREE.PlaneGeometry(width, height, width, height);
    const positions = geometry.attributes.position.array as Float32Array;

    // Displace each vertex based on terrain height
    // PlaneGeometry is created in XY plane, we rotate it to XZ plane
    // So positions are: x = local X, y = local Y (will become Z after rotation)
    for (let i = 0; i < positions.length; i += 3) {
      const localX = positions[i];
      const localY = positions[i + 1];
      // Convert local coordinates to world coordinates
      // Plane is centered at origin, so offset by half width/height
      const worldX = localX + width / 2;
      const worldZ = localY + height / 2;
      // Get terrain height and set as Z (will become Y after rotation)
      const terrainHeight = this.getTerrainHeight(worldX, worldZ);
      positions[i + 2] = terrainHeight + OVERLAY_Y_OFFSET;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

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
      case 'high': return { r: 255, g: 220, b: 100, a: 180 };
      case 'mid': return { r: 100, g: 180, b: 255, a: 160 };
      case 'low':
      default: return { r: 80, g: 160, b: 80, a: 140 };
    }
  }

  private createElevationOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Flip Y coordinate for texture UV mapping
        const textureY = height - 1 - y;
        const i = (textureY * width + x) * 4;
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
    const geometry = this.createTerrainConformingGeometry();

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

    const material = createThreatMaterial(this.threatTexture, this.opacity);
    const geometry = this.createTerrainConformingGeometry();

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

    const material = createOverlayMaterial(this.navmeshTexture, 0.8);
    const geometry = this.createTerrainConformingGeometry();

    this.navmeshOverlayMesh = new THREE.Mesh(geometry, material);
    this.navmeshOverlayMesh.rotation.x = -Math.PI / 2;
    this.navmeshOverlayMesh.position.set(width / 2, 0, height / 2);
    this.navmeshOverlayMesh.renderOrder = 100;
    this.navmeshOverlayMesh.visible = false;
    this.scene.add(this.navmeshOverlayMesh);
  }

  private createResourceOverlay(): void {
    const { width, height } = this.mapData;
    this.resourceTextureData = new Uint8Array(width * height * 4);

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

    const material = createResourceMaterial(this.resourceTexture, 0.7);
    const geometry = this.createTerrainConformingGeometry();

    this.resourceOverlayMesh = new THREE.Mesh(geometry, material);
    this.resourceOverlayMesh.rotation.x = -Math.PI / 2;
    this.resourceOverlayMesh.position.set(width / 2, 0, height / 2);
    this.resourceOverlayMesh.renderOrder = 100;
    this.resourceOverlayMesh.visible = false;
    this.scene.add(this.resourceOverlayMesh);
  }

  /**
   * Create buildable overlay showing where buildings can be placed.
   * Green = buildable, Red = not buildable
   */
  private createBuildableOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Flip Y coordinate for texture UV mapping
        const textureY = height - 1 - y;
        const i = (textureY * width + x) * 4;
        const cell = terrain[y]?.[x];

        // Check if cell is buildable
        // Buildings can only be placed on 'ground' terrain
        const isBuildable = cell?.terrain === 'ground';

        if (isBuildable) {
          // Green for buildable
          textureData[i + 0] = 50;
          textureData[i + 1] = 200;
          textureData[i + 2] = 50;
          textureData[i + 3] = 140;
        } else {
          // Red tint for non-buildable (but not too prominent)
          textureData[i + 0] = 180;
          textureData[i + 1] = 50;
          textureData[i + 2] = 50;
          textureData[i + 3] = 100;
        }
      }
    }

    this.buildableTexture = new THREE.DataTexture(textureData, width, height, THREE.RGBAFormat);
    this.buildableTexture.needsUpdate = true;
    this.buildableTexture.minFilter = THREE.NearestFilter;
    this.buildableTexture.magFilter = THREE.NearestFilter;

    const material = createOverlayMaterial(this.buildableTexture, 0.6);
    const geometry = this.createTerrainConformingGeometry();

    this.buildableOverlayMesh = new THREE.Mesh(geometry, material);
    this.buildableOverlayMesh.rotation.x = -Math.PI / 2;
    this.buildableOverlayMesh.position.set(width / 2, 0, height / 2);
    this.buildableOverlayMesh.renderOrder = 100;
    this.buildableOverlayMesh.visible = false;
    this.scene.add(this.buildableOverlayMesh);
  }

  /**
   * Create a ring geometry for range indicators
   */
  private createRingGeometry(innerRadius: number, outerRadius: number): THREE.RingGeometry {
    return new THREE.RingGeometry(innerRadius, outerRadius, RING_SEGMENTS);
  }

  /**
   * Update attack range rings for selected units
   */
  private updateAttackRangeRings(): void {
    if (!this.world || !this.showAttackRange) return;

    // Clear existing rings
    while (this.attackRangeGroup.children.length > 0) {
      const child = this.attackRangeGroup.children[0];
      this.attackRangeGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }

    // Create rings for selected units
    for (const entityId of this.selectedEntityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      if (!transform) continue;

      let attackRange = 0;
      if (unit && unit.attackRange > 0) {
        attackRange = unit.attackRange;
      } else if (building && building.attackRange && building.attackRange > 0) {
        attackRange = building.attackRange;
      }

      if (attackRange <= 0) continue;

      const innerRadius = attackRange - RING_LINE_WIDTH;
      const outerRadius = attackRange + RING_LINE_WIDTH;
      const geometry = this.createRingGeometry(Math.max(0.1, innerRadius), outerRadius);
      const ring = new THREE.Mesh(geometry, this.attackRangeMaterial);

      const terrainHeight = this.getTerrainHeight(transform.x, transform.y);
      ring.position.set(transform.x, terrainHeight + OVERLAY_Y_OFFSET + 0.1, transform.y);
      ring.rotation.x = -Math.PI / 2;

      this.attackRangeGroup.add(ring);
    }
  }

  /**
   * Update vision range rings for selected units
   */
  private updateVisionRangeRings(): void {
    if (!this.world || !this.showVisionRange) return;

    // Clear existing rings
    while (this.visionRangeGroup.children.length > 0) {
      const child = this.visionRangeGroup.children[0];
      this.visionRangeGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }

    // Create rings for selected units
    for (const entityId of this.selectedEntityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');
      const building = entity.get<Building>('Building');

      if (!transform) continue;

      let visionRange = 0;
      if (unit) {
        visionRange = unit.sightRange || 10;
      } else if (building) {
        visionRange = building.sightRange || 8;
      }

      if (visionRange <= 0) continue;

      const innerRadius = visionRange - RING_LINE_WIDTH;
      const outerRadius = visionRange + RING_LINE_WIDTH;
      const geometry = this.createRingGeometry(Math.max(0.1, innerRadius), outerRadius);
      const ring = new THREE.Mesh(geometry, this.visionRangeMaterial);

      const terrainHeight = this.getTerrainHeight(transform.x, transform.y);
      ring.position.set(transform.x, terrainHeight + OVERLAY_Y_OFFSET + 0.05, transform.y);
      ring.rotation.x = -Math.PI / 2;

      this.visionRangeGroup.add(ring);
    }
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

    // Track walkability by terrain type for diagnostics
    const walkableByType: Record<string, number> = {};
    const notWalkableByType: Record<string, number> = {};

    const BATCH_SIZE = 4096;
    let processed = 0;

    const processWalkabilityBatch = async (): Promise<void> => {
      const batchEnd = Math.min(processed + BATCH_SIZE, totalCells);

      for (let idx = processed; idx < batchEnd; idx++) {
        const x = idx % width;
        const y = Math.floor(idx / width);
        const cell = terrain[y]?.[x];
        const terrainTypeName = cell?.terrain || 'unknown';

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
          walkableByType[terrainTypeName] = (walkableByType[terrainTypeName] || 0) + 1;
        } else {
          notWalkableByType[terrainTypeName] = (notWalkableByType[terrainTypeName] || 0) + 1;
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

    // Log detailed walkability breakdown by terrain type
    debugPathfinding.log('[NavmeshOverlay] Walkable by terrain type:', walkableByType);
    debugPathfinding.log('[NavmeshOverlay] NOT walkable by terrain type:', notWalkableByType);

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
      // Flip Y coordinate for texture UV mapping
      // PlaneGeometry UV (0,0) is at bottom-left, but we iterate top-to-bottom
      const x = idx % width;
      const y = Math.floor(idx / width);
      const textureY = height - 1 - y;
      const textureIdx = textureY * width + x;
      const i = textureIdx * 4;

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

    // Summary log for production - detailed breakdown available via debug logger
    console.log(`[NavmeshOverlay] Completed: ${connectedCount} connected, ${disconnectedCount} disconnected, ${notOnNavmeshCount} not on navmesh (${duration.toFixed(0)}ms)`);

    debugPathfinding.log(`[NavmeshOverlay] Completed in ${duration.toFixed(0)}ms`);
    debugPathfinding.log(`[NavmeshOverlay]   Connected: ${connectedCount}, Disconnected: ${disconnectedCount}`);
    debugPathfinding.log(`[NavmeshOverlay]   Not on navmesh: ${notOnNavmeshCount}, Unwalkable: ${unwalkableTerrainCount}`);
    debugPathfinding.log(`[NavmeshOverlay]   Walkable by type:`, walkableByType);
    debugPathfinding.log(`[NavmeshOverlay]   NOT walkable by type:`, notWalkableByType);

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

          const dist = distance(cx, cy, px, py);
          if (dist <= attackRange) {
            // Flip Y coordinate for texture UV mapping
            const textureY = height - 1 - py;
            const i = (textureY * width + px) * 4;
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

          const dist = distance(cx, cy, px, py);
          if (dist <= attackRange) {
            // Flip Y coordinate for texture UV mapping
            const textureY = height - 1 - py;
            const i = (textureY * width + px) * 4;
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
      const radius = 3;

      if (resource.resourceType === 'minerals') {
        // Blue for minerals
        r = 80;
        g = 180;
        b = 255;
      } else if (resource.resourceType === 'vespene') {
        // Green for vespene gas
        r = 80;
        g = 255;
        b = 120;
      } else {
        // Yellow for other
        r = 255;
        g = 200;
        b = 80;
      }

      // Draw resource area with intensity based on remaining amount
      const intensity = 0.5 + percentRemaining * 0.5;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const dist = distance(cx, cy, px, py);
          if (dist <= radius) {
            // Flip Y coordinate for texture UV mapping
            const textureY = height - 1 - py;
            const i = (textureY * width + px) * 4;
            const falloff = 1 - (dist / radius) * 0.5;
            this.resourceTextureData[i + 0] = Math.floor(r * intensity * falloff);
            this.resourceTextureData[i + 1] = Math.floor(g * intensity * falloff);
            this.resourceTextureData[i + 2] = Math.floor(b * intensity * falloff);
            this.resourceTextureData[i + 3] = Math.floor(200 * intensity * falloff);
          }
        }
      }
    }

    this.resourceTexture.needsUpdate = true;
  }

  public setActiveOverlay(type: GameOverlayType): void {
    this.currentOverlay = type;

    // Hide all overlays first
    if (this.elevationOverlayMesh) this.elevationOverlayMesh.visible = false;
    if (this.threatOverlayMesh) this.threatOverlayMesh.visible = false;
    if (this.navmeshOverlayMesh) this.navmeshOverlayMesh.visible = false;
    if (this.resourceOverlayMesh) this.resourceOverlayMesh.visible = false;
    if (this.buildableOverlayMesh) this.buildableOverlayMesh.visible = false;

    // Show the selected overlay
    switch (type) {
      case 'elevation':
        if (this.elevationOverlayMesh) this.elevationOverlayMesh.visible = true;
        break;
      case 'threat':
        if (this.threatOverlayMesh) {
          this.threatOverlayMesh.visible = true;
          this.updateThreatOverlay();
        }
        break;
      case 'navmesh':
        if (this.navmeshOverlayMesh) {
          this.navmeshOverlayMesh.visible = true;
          this.updateNavmeshOverlay();
        }
        break;
      case 'resource':
        if (this.resourceOverlayMesh) {
          this.resourceOverlayMesh.visible = true;
          this.updateResourceOverlay();
        }
        break;
      case 'buildable':
        if (this.buildableOverlayMesh) this.buildableOverlayMesh.visible = true;
        break;
    }

    debugPathfinding.log(`[GameOverlay] Set active overlay: ${type}`);
  }

  public getActiveOverlay(): GameOverlayType {
    return this.currentOverlay;
  }

  public setOpacity(opacity: number): void {
    this.opacity = clamp(opacity, 0, 1);

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
    updateMaterialOpacity(this.buildableOverlayMesh);
  }

  /**
   * Set selected entity IDs for range overlay display
   */
  public setSelectedEntities(entityIds: number[]): void {
    this.selectedEntityIds = entityIds;
    // Update range rings if visible
    if (this.showAttackRange) {
      this.updateAttackRangeRings();
    }
    if (this.showVisionRange) {
      this.updateVisionRangeRings();
    }
  }

  /**
   * Show/hide attack range rings for selected units
   */
  public setShowAttackRange(show: boolean): void {
    this.showAttackRange = show;
    this.attackRangeGroup.visible = show;
    if (show) {
      this.updateAttackRangeRings();
    }
  }

  /**
   * Show/hide vision range rings for selected units
   */
  public setShowVisionRange(show: boolean): void {
    this.showVisionRange = show;
    this.visionRangeGroup.visible = show;
    if (show) {
      this.updateVisionRangeRings();
    }
  }

  /**
   * Get current range overlay states
   */
  public getRangeOverlayState(): { attackRange: boolean; visionRange: boolean } {
    return {
      attackRange: this.showAttackRange,
      visionRange: this.showVisionRange,
    };
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

    // Update resource overlay periodically
    if (this.currentOverlay === 'resource') {
      const now = performance.now();
      if (now - this.lastResourceUpdate > this.resourceUpdateInterval) {
        this.updateResourceOverlay();
        this.lastResourceUpdate = now;
      }
    }

    // Update range rings periodically (units may move)
    const now = performance.now();
    if (now - this.lastRangeUpdate > this.rangeUpdateInterval) {
      if (this.showAttackRange) {
        this.updateAttackRangeRings();
      }
      if (this.showVisionRange) {
        this.updateVisionRangeRings();
      }
      this.lastRangeUpdate = now;
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
    disposeOverlay(this.resourceOverlayMesh, this.resourceTexture);
    disposeOverlay(this.buildableOverlayMesh, this.buildableTexture);

    // Dispose range ring groups
    const disposeGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      }
      this.scene.remove(group);
    };

    disposeGroup(this.attackRangeGroup);
    disposeGroup(this.visionRangeGroup);

    this.attackRangeMaterial.dispose();
    this.visionRangeMaterial.dispose();
  }
}
