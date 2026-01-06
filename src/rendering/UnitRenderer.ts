import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';

interface UnitMeshData {
  mesh: THREE.Mesh;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
}

export class UnitRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private playerId: string = 'player1';
  private unitMeshes: Map<number, UnitMeshData> = new Map();

  // Shared geometries and materials
  private unitGeometry: THREE.CylinderGeometry;
  private workerMaterial: THREE.MeshStandardMaterial;
  private marineMaterial: THREE.MeshStandardMaterial;
  private defaultMaterial: THREE.MeshStandardMaterial;
  private enemyMaterial: THREE.MeshStandardMaterial;
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;

    // Create shared resources
    this.unitGeometry = new THREE.CylinderGeometry(0.4, 0.5, 1, 8);

    this.workerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      roughness: 0.7,
      metalness: 0.3,
    });

    this.marineMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90d9,
      roughness: 0.6,
      metalness: 0.4,
    });

    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.7,
      metalness: 0.3,
    });

    this.enemyMaterial = new THREE.MeshStandardMaterial({
      color: 0xd94a4a,
      roughness: 0.6,
      metalness: 0.4,
    });

    this.selectionGeometry = new THREE.RingGeometry(0.6, 0.8, 32);
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Unit');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      const isOwned = selectable?.playerId === this.playerId;
      const isEnemy = selectable && selectable.playerId !== this.playerId;

      // Check visibility for enemy units
      let shouldShow = true;
      if (isEnemy && this.visionSystem) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      let meshData = this.unitMeshes.get(entity.id);

      if (!meshData) {
        // Create new mesh for this unit
        meshData = this.createUnitMesh(unit, isEnemy);
        this.unitMeshes.set(entity.id, meshData);
        this.scene.add(meshData.mesh);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
      }

      // Update visibility
      meshData.mesh.visible = shouldShow;
      meshData.healthBar.visible = shouldShow && !!health && health.getHealthPercent() < 1;

      if (!shouldShow) {
        meshData.selectionRing.visible = false;
        continue;
      }

      // Update position
      meshData.mesh.position.set(transform.x, 0.5, transform.y);
      meshData.mesh.rotation.y = -transform.rotation + Math.PI / 2;

      // Update selection ring
      meshData.selectionRing.position.set(transform.x, 0.05, transform.y);
      meshData.selectionRing.visible = selectable?.isSelected ?? false;

      // Update health bar
      if (health) {
        meshData.healthBar.position.set(transform.x, 1.5, transform.y);
        this.updateHealthBar(meshData.healthBar, health);
      }
    }

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.unitMeshes) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(meshData.mesh);
        this.scene.remove(meshData.selectionRing);
        this.scene.remove(meshData.healthBar);
        this.unitMeshes.delete(entityId);
      }
    }
  }

  private createUnitMesh(unit: Unit, isEnemy: boolean = false): UnitMeshData {
    // Select material based on unit type and ownership
    let material: THREE.MeshStandardMaterial;
    let scale = 1;

    if (isEnemy) {
      material = this.enemyMaterial;
    } else if (unit.isWorker) {
      material = this.workerMaterial;
      scale = 0.8;
    } else if (unit.unitId === 'marine') {
      material = this.marineMaterial;
    } else {
      material = this.defaultMaterial;
    }

    const mesh = new THREE.Mesh(this.unitGeometry, material);
    mesh.scale.set(scale, scale, scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Selection ring
    const selectionRing = new THREE.Mesh(this.selectionGeometry, this.selectionMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;

    // Health bar
    const healthBar = this.createHealthBar();

    return { mesh, selectionRing, healthBar };
  }

  private createHealthBar(): THREE.Group {
    const group = new THREE.Group();

    // Background
    const bgGeometry = new THREE.PlaneGeometry(1, 0.1);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
    });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    group.add(bg);

    // Health fill
    const fillGeometry = new THREE.PlaneGeometry(1, 0.1);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
    });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'healthFill';
    group.add(fill);

    // Shield bar (if applicable)
    const shieldGeometry = new THREE.PlaneGeometry(1, 0.05);
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.y = 0.08;
    shield.position.z = 0.01;
    shield.name = 'shieldFill';
    shield.visible = false;
    group.add(shield);

    // Make health bar always face camera
    group.lookAt(0, 100, 0);

    return group;
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;
    const shield = healthBar.getObjectByName('shieldFill') as THREE.Mesh;

    if (fill) {
      const percent = health.getHealthPercent();
      fill.scale.x = percent;
      fill.position.x = (percent - 1) / 2;

      // Color based on health
      const material = fill.material as THREE.MeshBasicMaterial;
      if (percent > 0.6) {
        material.color.setHex(0x00ff00);
      } else if (percent > 0.3) {
        material.color.setHex(0xffff00);
      } else {
        material.color.setHex(0xff0000);
      }
    }

    if (shield && health.maxShield > 0) {
      shield.visible = true;
      const shieldPercent = health.getShieldPercent();
      shield.scale.x = shieldPercent;
      shield.position.x = (shieldPercent - 1) / 2;
    }
  }

  public dispose(): void {
    this.unitGeometry.dispose();
    this.workerMaterial.dispose();
    this.marineMaterial.dispose();
    this.defaultMaterial.dispose();
    this.enemyMaterial.dispose();
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();

    for (const meshData of this.unitMeshes.values()) {
      meshData.mesh.geometry.dispose();
      this.scene.remove(meshData.mesh);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
    }

    this.unitMeshes.clear();
  }
}
