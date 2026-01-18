/**
 * TSL Game Overlay Manager
 *
 * WebGPU-compatible strategic overlays using Three.js Shading Language.
 * Provides terrain, elevation, and threat visualization.
 * Works with both WebGPU and WebGL renderers.
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
  (material as any)._uOpacity = uOpacity;
  (material as any)._uTime = uTime;

  return material;
}

export class TSLGameOverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
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

  // Threat overlay update throttling
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 200;

  constructor(
    scene: THREE.Scene,
    mapData: MapData,
    getTerrainHeight: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight;

    this.createTerrainOverlay();
    this.createElevationOverlay();
    this.createThreatOverlay();
    this.createNavmeshOverlay();

    // Hide all overlays initially
    this.setActiveOverlay('none');
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
   * Update navmesh overlay by testing ACTUAL CONNECTIVITY via path computation.
   * This is the critical diagnostic that shows if ramps connect low and high ground.
   *
   * Color coding:
   * - Green: Connected to reference point (can path)
   * - Yellow/Orange: On navmesh but DISCONNECTED (path fails) - THIS SHOWS THE BUG
   * - Magenta: Ramp that's disconnected (critical!)
   * - Red: Should be walkable but not on navmesh
   * - Dark gray: Unwalkable (correct)
   */
  private updateNavmeshOverlay(): void {
    if (!this.navmeshTextureData || !this.navmeshTexture) return;

    const recast = getRecastNavigation();
    const { width, height, terrain } = this.mapData;

    // Find a reference point for connectivity testing
    // Use center of map at low elevation as the reference
    let refX = width / 2;
    let refY = height / 2;

    // Try to find a walkable cell near the center at low elevation
    let foundRef = false;
    for (let r = 0; r < Math.max(width, height) / 2 && !foundRef; r++) {
      for (let dy = -r; dy <= r && !foundRef; dy++) {
        for (let dx = -r; dx <= r && !foundRef; dx++) {
          const x = Math.floor(width / 2) + dx;
          const y = Math.floor(height / 2) + dy;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const cell = terrain[y]?.[x];
            if (cell && cell.terrain !== 'unwalkable' && cell.terrain !== 'ramp' && cell.elevation < 50) {
              refX = x + 0.5;
              refY = y + 0.5;
              foundRef = true;
            }
          }
        }
      }
    }

    debugPathfinding.log(`[NavmeshOverlay] Reference point for connectivity: (${refX.toFixed(1)}, ${refY.toFixed(1)})`);

    let connectedCount = 0;
    let disconnectedCount = 0;
    let unwalkableCount = 0;
    let notOnNavmeshCount = 0;

    // Query navmesh for each cell - test actual path connectivity
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const cell = terrain[y]?.[x];
        const cellX = x + 0.5;
        const cellZ = y + 0.5;

        // Check if cell is on navmesh
        const isNavmeshWalkable = recast.isReady() ? recast.isWalkable(cellX, cellZ) : false;

        if (cell?.terrain === 'unwalkable') {
          // Correctly unwalkable
          this.navmeshTextureData[i + 0] = 60;
          this.navmeshTextureData[i + 1] = 60;
          this.navmeshTextureData[i + 2] = 60;
          this.navmeshTextureData[i + 3] = 150;
          unwalkableCount++;
        } else if (!isNavmeshWalkable) {
          // Should be walkable but navmesh says no - red
          this.navmeshTextureData[i + 0] = 255;
          this.navmeshTextureData[i + 1] = 50;
          this.navmeshTextureData[i + 2] = 50;
          this.navmeshTextureData[i + 3] = 220;
          notOnNavmeshCount++;
        } else {
          // On navmesh - test if we can path to reference point
          const pathResult = recast.isReady() ? recast.findPath(cellX, cellZ, refX, refY) : { found: false, path: [] };

          if (pathResult.found && pathResult.path.length > 0) {
            // CONNECTED - can reach reference point
            if (cell?.terrain === 'ramp') {
              // Ramp that's connected - bright cyan/green
              this.navmeshTextureData[i + 0] = 50;
              this.navmeshTextureData[i + 1] = 255;
              this.navmeshTextureData[i + 2] = 200;
              this.navmeshTextureData[i + 3] = 220;
            } else {
              // Normal connected cell - green
              this.navmeshTextureData[i + 0] = 50;
              this.navmeshTextureData[i + 1] = 200;
              this.navmeshTextureData[i + 2] = 50;
              this.navmeshTextureData[i + 3] = 180;
            }
            connectedCount++;
          } else {
            // DISCONNECTED - on navmesh but can't reach reference point
            // THIS IS THE BUG INDICATOR
            if (cell?.terrain === 'ramp') {
              // Ramp that's disconnected - magenta (critical!)
              this.navmeshTextureData[i + 0] = 255;
              this.navmeshTextureData[i + 1] = 50;
              this.navmeshTextureData[i + 2] = 255;
              this.navmeshTextureData[i + 3] = 255;
            } else {
              // Normal cell that's disconnected - yellow/orange
              this.navmeshTextureData[i + 0] = 255;
              this.navmeshTextureData[i + 1] = 200;
              this.navmeshTextureData[i + 2] = 50;
              this.navmeshTextureData[i + 3] = 220;
            }
            disconnectedCount++;
          }
        }
      }
    }

    debugPathfinding.log(`[NavmeshOverlay] Connectivity results:`);
    debugPathfinding.log(`[NavmeshOverlay]   Connected (green): ${connectedCount} cells`);
    debugPathfinding.log(`[NavmeshOverlay]   Disconnected (yellow/magenta): ${disconnectedCount} cells`);
    debugPathfinding.log(`[NavmeshOverlay]   Not on navmesh (red): ${notOnNavmeshCount} cells`);
    debugPathfinding.log(`[NavmeshOverlay]   Unwalkable (gray): ${unwalkableCount} cells`);

    if (disconnectedCount > 0) {
      debugPathfinding.warn(`[NavmeshOverlay] WARNING: ${disconnectedCount} cells are on navmesh but cannot reach the reference point!`);
      debugPathfinding.warn(`[NavmeshOverlay] This indicates DISCONNECTED NAVMESH REGIONS - ramps are not connecting elevation levels!`);
    }

    this.navmeshTexture.needsUpdate = true;
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
      // Update navmesh overlay data when shown (one-time query since navmesh is static)
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
      if (mesh && (mesh.material as any)._uOpacity) {
        (mesh.material as any)._uOpacity.value = this.opacity;
      }
    };

    updateMaterialOpacity(this.terrainOverlayMesh);
    updateMaterialOpacity(this.elevationOverlayMesh);
    updateMaterialOpacity(this.threatOverlayMesh);
    updateMaterialOpacity(this.navmeshOverlayMesh);
  }

  public update(time: number): void {
    // Update threat overlay time for pulsing effect
    if (this.threatOverlayMesh && (this.threatOverlayMesh.material as any)._uTime) {
      (this.threatOverlayMesh.material as any)._uTime.value = time;
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
