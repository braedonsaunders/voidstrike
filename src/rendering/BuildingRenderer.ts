import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';

interface BuildingMeshData {
  mesh: THREE.Mesh;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  progressBar: THREE.Group;
}

export class BuildingRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private playerId: string = 'player1';
  private buildingMeshes: Map<number, BuildingMeshData> = new Map();

  // Materials
  private completeMaterial: THREE.MeshStandardMaterial;
  private constructingMaterial: THREE.MeshStandardMaterial;
  private enemyMaterial: THREE.MeshStandardMaterial;
  private selectionMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;

    this.completeMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.5,
      metalness: 0.5,
    });

    this.constructingMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.5,
      metalness: 0.5,
      transparent: true,
      opacity: 0.5,
    });

    this.enemyMaterial = new THREE.MeshStandardMaterial({
      color: 0xd94a4a,
      roughness: 0.5,
      metalness: 0.5,
    });

    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
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

      const isOwned = selectable?.playerId === this.playerId;
      const isEnemy = selectable && selectable.playerId !== this.playerId;

      // Check visibility for enemy buildings
      // Buildings in explored areas are shown, but only with current state if visible
      let shouldShow = true;
      if (isEnemy && this.visionSystem) {
        shouldShow = this.visionSystem.isExplored(this.playerId, transform.x, transform.y);
      }

      let meshData = this.buildingMeshes.get(entity.id);

      if (!meshData) {
        meshData = this.createBuildingMesh(building, isEnemy);
        this.buildingMeshes.set(entity.id, meshData);
        this.scene.add(meshData.mesh);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
        this.scene.add(meshData.progressBar);
      }

      // Update visibility
      meshData.mesh.visible = shouldShow;

      if (!shouldShow) {
        meshData.selectionRing.visible = false;
        meshData.healthBar.visible = false;
        meshData.progressBar.visible = false;
        continue;
      }

      // Update position
      const height = building.isComplete() ? building.height : building.height * building.buildProgress;
      meshData.mesh.position.set(transform.x, height / 2, transform.y);
      meshData.mesh.scale.y = building.isComplete() ? 1 : building.buildProgress;

      // Update material based on ownership and state
      if (isEnemy) {
        meshData.mesh.material = this.enemyMaterial;
      } else {
        meshData.mesh.material = building.isComplete()
          ? this.completeMaterial
          : this.constructingMaterial;
      }

      // Update selection ring
      const ringSize = Math.max(building.width, building.height) * 0.8;
      meshData.selectionRing.position.set(transform.x, 0.05, transform.y);
      meshData.selectionRing.scale.set(ringSize, ringSize, 1);
      meshData.selectionRing.visible = selectable?.isSelected ?? false;

      // Update health bar
      if (health && building.isComplete()) {
        meshData.healthBar.position.set(transform.x, building.height + 0.5, transform.y);
        meshData.healthBar.visible = health.getHealthPercent() < 1;
        this.updateHealthBar(meshData.healthBar, health);
      } else {
        meshData.healthBar.visible = false;
      }

      // Update progress bar (only for own buildings)
      if (isOwned) {
        if (!building.isComplete()) {
          meshData.progressBar.position.set(transform.x, building.height + 0.5, transform.y);
          meshData.progressBar.visible = true;
          this.updateProgressBar(meshData.progressBar, building.buildProgress);
        } else if (building.productionQueue.length > 0) {
          meshData.progressBar.position.set(transform.x, building.height + 0.5, transform.y);
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
        this.scene.remove(meshData.mesh);
        this.scene.remove(meshData.selectionRing);
        this.scene.remove(meshData.healthBar);
        this.scene.remove(meshData.progressBar);
        this.buildingMeshes.delete(entityId);
      }
    }
  }

  private createBuildingMesh(building: Building, isEnemy: boolean = false): BuildingMeshData {
    // Create building geometry based on size
    const geometry = new THREE.BoxGeometry(
      building.width * 0.9,
      building.height,
      building.height * 0.9
    );

    const material = isEnemy ? this.enemyMaterial : this.constructingMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Selection ring
    const ringGeometry = new THREE.RingGeometry(0.8, 1, 32);
    const selectionRing = new THREE.Mesh(ringGeometry, this.selectionMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;

    // Health bar
    const healthBar = this.createBar(0x00ff00);

    // Progress bar
    const progressBar = this.createBar(0xffff00);

    return { mesh, selectionRing, healthBar, progressBar };
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

  public dispose(): void {
    this.completeMaterial.dispose();
    this.constructingMaterial.dispose();
    this.enemyMaterial.dispose();
    this.selectionMaterial.dispose();

    for (const meshData of this.buildingMeshes.values()) {
      meshData.mesh.geometry.dispose();
      this.scene.remove(meshData.mesh);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
    }

    this.buildingMeshes.clear();
  }
}
