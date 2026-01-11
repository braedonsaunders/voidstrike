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
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';

/**
 * Creates a simple overlay material using TSL
 */
function createOverlayMaterial(overlayTexture: THREE.DataTexture, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;

  const uOpacity = uniform(opacity);

  // colorNode expects RGB (vec3), opacityNode expects alpha (float)
  const colorNode = Fn(() => {
    const texColor = texture(overlayTexture, uv());
    return texColor.rgb;
  })();

  const opacityNode = Fn(() => {
    const texColor = texture(overlayTexture, uv());
    return texColor.a.mul(uOpacity);
  })();

  material.colorNode = colorNode;
  material.opacityNode = opacityNode;

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
  material.side = THREE.DoubleSide;

  const uOpacity = uniform(opacity);
  const uTime = uniform(0);

  // colorNode expects RGB (vec3), opacityNode expects alpha (float)
  const colorNode = Fn(() => {
    const uvCoord = uv();
    const texColor = texture(threatTexture, uvCoord);

    // Pulsing effect for threat zones
    const pulse = float(0.85).add(float(0.15).mul(sin(uTime.mul(2.0).add(uvCoord.x.mul(10.0)).add(uvCoord.y.mul(10.0)))));

    // Red tint with intensity based on threat level
    return vec3(0.9, 0.2, 0.1).mul(texColor.r).mul(pulse);
  })();

  const opacityNode = Fn(() => {
    const texColor = texture(threatTexture, uv());
    return texColor.a.mul(uOpacity);
  })();

  material.colorNode = colorNode;
  material.opacityNode = opacityNode;

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

  // Overlay textures
  private terrainTexture: THREE.DataTexture | null = null;
  private elevationTexture: THREE.DataTexture | null = null;
  private threatTexture: THREE.DataTexture | null = null;
  private threatTextureData: Uint8Array | null = null;

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
    this.terrainOverlayMesh.position.set(width / 2, 0.3, height / 2);
    this.terrainOverlayMesh.renderOrder = 90;
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
    this.elevationOverlayMesh.position.set(width / 2, 0.35, height / 2);
    this.elevationOverlayMesh.renderOrder = 90;
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
    this.threatOverlayMesh.position.set(width / 2, 0.4, height / 2);
    this.threatOverlayMesh.renderOrder = 91;
    this.threatOverlayMesh.visible = false;
    this.scene.add(this.threatOverlayMesh);
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
  }
}
