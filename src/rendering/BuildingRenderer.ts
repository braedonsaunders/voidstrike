import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager } from '@/assets/AssetManager';
import { Terrain } from './Terrain';

interface BuildingMeshData {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  progressBar: THREE.Group;
  buildingId: string;
  // PERFORMANCE: Track completion state to avoid traverse() every frame
  wasComplete: boolean;
}

// Player colors
const PLAYER_COLORS: Record<string, number> = {
  player1: 0x40a0ff, // Blue
  ai: 0xff4040, // Red
  player2: 0x40ff40, // Green
  player3: 0xffff40, // Yellow
  player4: 0xff40ff, // Purple
};

export class BuildingRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string = 'player1';
  private buildingMeshes: Map<number, BuildingMeshData> = new Map();

  // Shared materials
  private constructingMaterial: THREE.MeshStandardMaterial;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private enemySelectionMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    this.constructingMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.5,
      metalness: 0.5,
      transparent: true,
      opacity: 0.5,
    });

    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });

    this.enemySelectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });

    // Register callback to refresh meshes when custom models finish loading
    AssetManager.onModelsLoaded(() => {
      this.refreshAllMeshes();
    });
  }

  /**
   * Clear all cached meshes so they get recreated with updated assets on next update.
   * Called when custom models finish loading.
   */
  public refreshAllMeshes(): void {
    console.log('[BuildingRenderer] Refreshing all building meshes...');
    for (const [entityId, meshData] of this.buildingMeshes) {
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
      this.disposeGroup(meshData.group);
    }
    this.buildingMeshes.clear();
    // Meshes will be recreated on next update() call
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Building');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isOwned = ownerId === this.playerId;
      const isEnemy = selectable && ownerId !== this.playerId;

      // Check visibility for enemy buildings
      let shouldShow = true;
      if (isEnemy && this.visionSystem) {
        shouldShow = this.visionSystem.isExplored(this.playerId, transform.x, transform.y);
      }

      let meshData = this.buildingMeshes.get(entity.id);

      if (!meshData) {
        meshData = this.createBuildingMesh(building, ownerId);
        this.buildingMeshes.set(entity.id, meshData);
        this.scene.add(meshData.group);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
        this.scene.add(meshData.progressBar);
      }

      // Update visibility
      meshData.group.visible = shouldShow;

      if (!shouldShow) {
        meshData.selectionRing.visible = false;
        meshData.healthBar.visible = false;
        meshData.progressBar.visible = false;
        continue;
      }

      // Get terrain height at this position
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update position - place building on top of terrain
      meshData.group.position.set(transform.x, terrainHeight, transform.y);

      // Construction animation - scale up as building completes
      // PERFORMANCE: Only call traverse() when completion state changes
      const isComplete = building.isComplete();
      if (!isComplete) {
        const progress = building.buildProgress;
        meshData.group.scale.setScalar(0.5 + progress * 0.5);
        // Only update materials occasionally during construction (every ~10% progress)
        // to avoid expensive traverse() calls every frame
        if (!meshData.wasComplete) {
          meshData.group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial;
              if (mat.transparent !== undefined) {
                mat.transparent = true;
                mat.opacity = 0.5 + progress * 0.5;
              }
            }
          });
        }
      } else if (!meshData.wasComplete) {
        // Building just completed - do final traverse to reset materials
        meshData.wasComplete = true;
        meshData.group.scale.setScalar(1);
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.transparent !== undefined) {
              mat.transparent = false;
              mat.opacity = 1;
            }
          }
        });
      }
      // PERFORMANCE: If building was already complete, skip traverse() entirely

      // Update selection ring - larger multiplier for better visibility
      const ringSize = Math.max(building.width, building.height) * 0.9;
      meshData.selectionRing.position.set(transform.x, terrainHeight + 0.05, transform.y);
      meshData.selectionRing.scale.set(ringSize, ringSize, 1);
      meshData.selectionRing.visible = selectable?.isSelected ?? false;

      // Update selection ring color
      if (meshData.selectionRing.visible) {
        (meshData.selectionRing.material as THREE.MeshBasicMaterial) =
          isOwned ? this.selectionMaterial : this.enemySelectionMaterial;
      }

      // Update health bar
      if (health && building.isComplete()) {
        meshData.healthBar.position.set(transform.x, terrainHeight + building.height + 0.5, transform.y);
        meshData.healthBar.visible = health.getHealthPercent() < 1;
        this.updateHealthBar(meshData.healthBar, health);
      } else {
        meshData.healthBar.visible = false;
      }

      // Update progress bar (only for own buildings)
      if (isOwned) {
        if (!building.isComplete()) {
          meshData.progressBar.position.set(transform.x, terrainHeight + building.height + 0.5, transform.y);
          meshData.progressBar.visible = true;
          this.updateProgressBar(meshData.progressBar, building.buildProgress);
        } else if (building.productionQueue.length > 0) {
          meshData.progressBar.position.set(transform.x, terrainHeight + building.height + 0.5, transform.y);
          meshData.progressBar.visible = true;
          this.updateProgressBar(meshData.progressBar, building.getProductionProgress());
        } else {
          meshData.progressBar.visible = false;
        }
      } else {
        meshData.progressBar.visible = false;
      }
    }

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.buildingMeshes) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(meshData.group);
        this.scene.remove(meshData.selectionRing);
        this.scene.remove(meshData.healthBar);
        this.scene.remove(meshData.progressBar);
        this.disposeGroup(meshData.group);
        this.buildingMeshes.delete(entityId);
      }
    }
  }

  private createBuildingMesh(building: Building, playerId: string): BuildingMeshData {
    // Get player color
    const playerColor = PLAYER_COLORS[playerId] ?? 0x808080;

    // Get building mesh from AssetManager
    const group = AssetManager.getBuildingMesh(building.buildingId, playerColor) as THREE.Group;

    // PERFORMANCE: Shadows are disabled globally, no need to set per-mesh

    // Selection ring - reduced segments for performance
    const ringGeometry = new THREE.RingGeometry(0.8, 1, 16);
    const selectionRing = new THREE.Mesh(ringGeometry, this.selectionMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;

    // Health bar
    const healthBar = this.createBar(0x00ff00);

    // Progress bar
    const progressBar = this.createBar(0xffff00);

    return { group, selectionRing, healthBar, progressBar, buildingId: building.buildingId, wasComplete: false };
  }

  private createBar(color: number): THREE.Group {
    const group = new THREE.Group();

    const bgGeometry = new THREE.PlaneGeometry(2, 0.15);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
    });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    group.add(bg);

    const fillGeometry = new THREE.PlaneGeometry(2, 0.15);
    const fillMaterial = new THREE.MeshBasicMaterial({ color });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'fill';
    group.add(fill);

    group.lookAt(0, 100, 0);
    group.visible = false;

    return group;
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('fill') as THREE.Mesh;
    if (fill) {
      const percent = health.getHealthPercent();
      fill.scale.x = percent;
      fill.position.x = (percent - 1);

      const material = fill.material as THREE.MeshBasicMaterial;
      if (percent > 0.6) {
        material.color.setHex(0x00ff00);
      } else if (percent > 0.3) {
        material.color.setHex(0xffff00);
      } else {
        material.color.setHex(0xff0000);
      }
    }
  }

  private updateProgressBar(progressBar: THREE.Group, progress: number): void {
    const fill = progressBar.getObjectByName('fill') as THREE.Mesh;
    if (fill) {
      fill.scale.x = progress;
      fill.position.x = (progress - 1);
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        } else if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        }
      }
    });
  }

  public dispose(): void {
    this.constructingMaterial.dispose();
    this.selectionMaterial.dispose();
    this.enemySelectionMaterial.dispose();

    for (const meshData of this.buildingMeshes.values()) {
      this.disposeGroup(meshData.group);
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
    }

    this.buildingMeshes.clear();
  }
}
