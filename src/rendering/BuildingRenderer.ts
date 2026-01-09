import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor } from '@/store/gameSetupStore';

interface BuildingMeshData {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  progressBar: THREE.Group;
  buildingId: string;
  // PERFORMANCE: Track completion state to avoid traverse() every frame
  wasComplete: boolean;
  // Fire effect for damaged buildings
  fireEffect: THREE.Group | null;
  lastHealthPercent: number;
  // Construction effect (dust particles at build height)
  constructionEffect: THREE.Group | null;
  buildingHeight: number; // Stored for clipping calculation
}

// Instanced building group for same-type completed buildings
interface InstancedBuildingGroup {
  mesh: THREE.InstancedMesh;
  buildingType: string;
  playerId: string;
  maxInstances: number;
  entityIds: number[];
  dummy: THREE.Object3D;
}

const MAX_BUILDING_INSTANCES_PER_TYPE = 50;

export class BuildingRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string = 'player1';
  private buildingMeshes: Map<number, BuildingMeshData> = new Map();

  // PERFORMANCE: Instanced mesh groups for completed static buildings
  private instancedGroups: Map<string, InstancedBuildingGroup> = new Map();

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);

  // Shared materials
  private constructingMaterial: THREE.MeshStandardMaterial;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private enemySelectionMaterial: THREE.MeshBasicMaterial;
  private fireMaterial: THREE.MeshBasicMaterial;
  private smokeMaterial: THREE.MeshBasicMaterial;
  private fireGeometry: THREE.ConeGeometry;
  private constructionDustMaterial: THREE.PointsMaterial;
  private constructionSparkMaterial: THREE.PointsMaterial;

  // Animation time for effects
  private fireAnimTime: number = 0;
  private constructionAnimTime: number = 0;

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

    // Fire effect materials
    this.fireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.8,
    });

    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.5,
    });

    this.fireGeometry = new THREE.ConeGeometry(0.3, 0.8, 8);

    // Construction dust particles
    this.constructionDustMaterial = new THREE.PointsMaterial({
      color: 0xaa9977,
      size: 0.15,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });

    // Construction sparks (welding/building effect)
    this.constructionSparkMaterial = new THREE.PointsMaterial({
      color: 0xffcc44,
      size: 0.08,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
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

    // Also clear instanced groups
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.instancedGroups.clear();
    // Meshes will be recreated on next update() call
  }

  /**
   * Get or create an instanced mesh group for a building type + player combo.
   * Used for completed, non-selected, non-damaged buildings.
   */
  private getOrCreateInstancedGroup(buildingType: string, playerId: string): InstancedBuildingGroup {
    const key = `${buildingType}_${playerId}`;
    let group = this.instancedGroups.get(key);

    if (!group) {
      const playerColor = getPlayerColor(playerId);
      const baseMesh = AssetManager.getBuildingMesh(buildingType, playerColor);

      // Find geometry and material from the base mesh
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
        }
      });

      if (!geometry) {
        // Fallback
        geometry = new THREE.BoxGeometry(1, 1, 1);
        material = new THREE.MeshStandardMaterial({ color: playerColor });
      }

      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material!,
        MAX_BUILDING_INSTANCES_PER_TYPE
      );
      instancedMesh.count = 0;
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false;

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        buildingType,
        playerId,
        maxInstances: MAX_BUILDING_INSTANCES_PER_TYPE,
        entityIds: [],
        dummy: new THREE.Object3D(),
      };

      this.instancedGroups.set(key, group);
    }

    return group;
  }

  /**
   * Check if a building can use instanced rendering.
   * Requirements: completed, not selected, not damaged (<100% health), visible
   */
  private canUseInstancing(building: Building, health: Health | undefined, selectable: Selectable | undefined): boolean {
    if (!building.isComplete()) return false;
    if (selectable?.isSelected) return false;
    if (health && health.getHealthPercent() < 1) return false;
    // Buildings with production queue shouldn't use instancing (need progress bar)
    if (building.productionQueue.length > 0) return false;
    return true;
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(deltaTime: number = 16): void {
    const dt = deltaTime / 1000;
    this.fireAnimTime += dt;
    this.constructionAnimTime += dt;

    const entities = this.world.getEntitiesWith('Transform', 'Building');
    const currentIds = new Set<number>();

    // Reset instanced group counts
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds = [];
    }

    // Track which buildings use instancing (to skip individual mesh handling)
    const instancedBuildingIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform');
      const building = entity.get<Building>('Building');
      if (!transform || !building) continue;

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

      // PERFORMANCE: Try to use instanced rendering for completed static buildings
      if (shouldShow && this.canUseInstancing(building, health, selectable)) {
        const group = this.getOrCreateInstancedGroup(building.buildingId, ownerId);

        if (group.mesh.count < group.maxInstances) {
          const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

          // Set instance matrix
          this.tempPosition.set(transform.x, terrainHeight, transform.y);
          this.tempScale.set(1, 1, 1);
          this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
          group.mesh.setMatrixAt(group.mesh.count, this.tempMatrix);
          group.entityIds.push(entity.id);
          group.mesh.count++;
          group.mesh.instanceMatrix.needsUpdate = true;

          instancedBuildingIds.add(entity.id);

          // Hide individual mesh if it exists
          const existingMesh = this.buildingMeshes.get(entity.id);
          if (existingMesh) {
            existingMesh.group.visible = false;
            existingMesh.selectionRing.visible = false;
            existingMesh.healthBar.visible = false;
            existingMesh.progressBar.visible = false;
          }
          continue; // Skip individual mesh handling
        }
      }

      let meshData = this.buildingMeshes.get(entity.id);

      // Check if building was upgraded (buildingId changed) - recreate mesh if so
      if (meshData && meshData.buildingId !== building.buildingId) {
        // Building was upgraded, remove old mesh and create new one
        this.scene.remove(meshData.group);
        this.scene.remove(meshData.selectionRing);
        this.scene.remove(meshData.healthBar);
        this.scene.remove(meshData.progressBar);
        this.disposeGroup(meshData.group);
        this.buildingMeshes.delete(entity.id);
        meshData = undefined;
      }

      if (!meshData) {
        meshData = this.createBuildingMesh(building, ownerId);
        // Initialize wasComplete based on actual building state
        meshData.wasComplete = building.isComplete();
        this.buildingMeshes.set(entity.id, meshData);
        this.scene.add(meshData.group);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
        this.scene.add(meshData.progressBar);

        // If building is already complete, ensure materials are correct immediately
        if (building.isComplete()) {
          meshData.group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial;
              if (mat) {
                mat.clippingPlanes = [];
                mat.transparent = false;
                mat.opacity = 1;
              }
            }
          });
        }
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

      // Construction animation based on building state
      // States: 'waiting_for_worker', 'constructing', 'complete', 'lifting', 'flying', 'landing', 'destroyed'
      const isConstructing = building.state === 'constructing';
      const isWaitingForWorker = building.state === 'waiting_for_worker';
      // All other states (complete, lifting, flying, landing) should show full opacity building
      const shouldShowComplete = !isConstructing && !isWaitingForWorker;

      if (shouldShowComplete) {
        // Complete/operational building - full opacity, no construction effects
        meshData.group.scale.setScalar(1);
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.clippingPlanes = [];
              mat.transparent = false;
              mat.opacity = 1;
            }
          }
        });
        // Remove construction effect if present
        if (meshData.constructionEffect) {
          this.scene.remove(meshData.constructionEffect);
          this.disposeGroup(meshData.constructionEffect);
          meshData.constructionEffect = null;
        }
        meshData.wasComplete = true;
      } else if (isWaitingForWorker) {
        // Waiting for worker - faint ghost preview
        meshData.group.scale.setScalar(1);
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.clippingPlanes = [];
              mat.transparent = true;
              mat.opacity = 0.25;
            }
          }
        });
        // Hide construction effect while waiting
        if (meshData.constructionEffect) {
          meshData.constructionEffect.visible = false;
        }
      } else {
        // Construction in progress (state === 'constructing')
        // Use opacity-only animation to avoid position issues from scaling
        const progress = building.buildProgress;
        const opacity = 0.3 + progress * 0.7; // Opacity from 30% to 100%

        meshData.group.scale.setScalar(1); // Keep scale at 1 to avoid position offset issues
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat) {
              mat.clippingPlanes = [];
              mat.transparent = true;
              mat.opacity = opacity;
            }
          }
        });

        // Create/update construction effect (dust and sparks)
        if (!meshData.constructionEffect) {
          meshData.constructionEffect = this.createConstructionEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.constructionEffect);
        }

        // Position construction effect at base of building
        meshData.constructionEffect.visible = true;
        meshData.constructionEffect.position.set(transform.x, terrainHeight + 0.1, transform.y);
        this.updateConstructionEffect(meshData.constructionEffect, dt, building.width, building.height);
      }

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

      // Update health bar and fire effects (for all non-constructing states)
      if (health && shouldShowComplete) {
        const healthPercent = health.getHealthPercent();
        meshData.healthBar.position.set(transform.x, terrainHeight + building.height + 0.5, transform.y);
        meshData.healthBar.visible = healthPercent < 1;
        this.updateHealthBar(meshData.healthBar, health);

        // Fire effects for damaged buildings (below 50% health)
        if (healthPercent < 0.5 && !meshData.fireEffect) {
          // Create fire effect
          meshData.fireEffect = this.createFireEffect(building.width, building.height);
          meshData.fireEffect.position.set(transform.x, terrainHeight, transform.y);
          this.scene.add(meshData.fireEffect);
        } else if (healthPercent >= 0.5 && meshData.fireEffect) {
          // Remove fire effect if health recovered
          this.scene.remove(meshData.fireEffect);
          this.disposeGroup(meshData.fireEffect);
          meshData.fireEffect = null;
        }

        // Animate fire effect
        if (meshData.fireEffect) {
          meshData.fireEffect.position.set(transform.x, terrainHeight, transform.y);
          this.updateFireEffect(meshData.fireEffect, dt);

          // More intense fire at lower health
          const intensity = 1 + (0.5 - healthPercent) * 2;
          meshData.fireEffect.scale.setScalar(intensity);
        }

        meshData.lastHealthPercent = healthPercent;
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
        if (meshData.fireEffect) {
          this.scene.remove(meshData.fireEffect);
          this.disposeGroup(meshData.fireEffect);
        }
        if (meshData.constructionEffect) {
          this.scene.remove(meshData.constructionEffect);
          this.disposeGroup(meshData.constructionEffect);
        }
        this.disposeGroup(meshData.group);
        this.buildingMeshes.delete(entityId);
      }
    }
  }

  private createBuildingMesh(building: Building, playerId: string): BuildingMeshData {
    // Get player color
    const playerColor = getPlayerColor(playerId);

    // Get building mesh from AssetManager
    const group = AssetManager.getBuildingMesh(building.buildingId, playerColor) as THREE.Group;

    // Calculate building height from the mesh bounding box
    const bbox = new THREE.Box3().setFromObject(group);
    const buildingHeight = bbox.max.y - bbox.min.y || building.height;

    // CRITICAL: Clone materials so each building has its own material instance
    // This prevents transparency changes on one building from affecting others
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map(mat => mat.clone());
          } else {
            child.material = child.material.clone();
          }
        }
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.side = THREE.DoubleSide; // Required for clipping to look correct
        }
      }
    });

    // Selection ring - reduced segments for performance
    const ringGeometry = new THREE.RingGeometry(0.8, 1, 16);
    const selectionRing = new THREE.Mesh(ringGeometry, this.selectionMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;

    // Health bar
    const healthBar = this.createBar(0x00ff00);

    // Progress bar
    const progressBar = this.createBar(0xffff00);

    return {
      group,
      selectionRing,
      healthBar,
      progressBar,
      buildingId: building.buildingId,
      wasComplete: false,
      fireEffect: null,
      lastHealthPercent: 1,
      constructionEffect: null,
      buildingHeight,
    };
  }

  /**
   * Create fire effect for damaged buildings
   * Uses particle system for more realistic fire
   */
  private createFireEffect(buildingWidth: number, buildingHeight: number): THREE.Group {
    const fireGroup = new THREE.Group();

    // Fire particles (many small particles that rise and fade)
    const fireParticleCount = 80;
    const firePositions = new Float32Array(fireParticleCount * 3);
    const fireColors = new Float32Array(fireParticleCount * 3);

    for (let i = 0; i < fireParticleCount; i++) {
      firePositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.7;
      firePositions[i * 3 + 1] = Math.random() * buildingHeight * 0.6;
      firePositions[i * 3 + 2] = (Math.random() - 0.5) * buildingHeight * 0.7;

      // Orange to yellow colors
      fireColors[i * 3] = 1;
      fireColors[i * 3 + 1] = 0.3 + Math.random() * 0.5;
      fireColors[i * 3 + 2] = 0;
    }

    const fireGeometry = new THREE.BufferGeometry();
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(firePositions, 3));
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(fireColors, 3));

    const fireParticleMaterial = new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const fireParticles = new THREE.Points(fireGeometry, fireParticleMaterial);
    fireParticles.userData.isFireParticles = true;
    fireParticles.userData.buildingWidth = buildingWidth;
    fireParticles.userData.buildingHeight = buildingHeight;
    fireParticles.userData.lifetimes = new Float32Array(fireParticleCount).fill(0).map(() => Math.random());
    fireGroup.add(fireParticles);

    // Smoke particles (larger, darker, rise slower)
    const smokeParticleCount = 30;
    const smokePositions = new Float32Array(smokeParticleCount * 3);

    for (let i = 0; i < smokeParticleCount; i++) {
      smokePositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.6;
      smokePositions[i * 3 + 1] = buildingHeight * 0.5 + Math.random() * buildingHeight * 0.5;
      smokePositions[i * 3 + 2] = (Math.random() - 0.5) * buildingHeight * 0.6;
    }

    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));

    const smokeParticleMaterial = new THREE.PointsMaterial({
      color: 0x333333,
      size: 0.8,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    const smokeParticles = new THREE.Points(smokeGeometry, smokeParticleMaterial);
    smokeParticles.userData.isSmokeParticles = true;
    smokeParticles.userData.buildingHeight = buildingHeight;
    smokeParticles.userData.lifetimes = new Float32Array(smokeParticleCount).fill(0).map(() => Math.random());
    fireGroup.add(smokeParticles);

    // Ember particles (small bright sparks that shoot up)
    const emberCount = 20;
    const emberPositions = new Float32Array(emberCount * 3);

    for (let i = 0; i < emberCount; i++) {
      emberPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.5;
      emberPositions[i * 3 + 1] = Math.random() * buildingHeight * 0.4;
      emberPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingHeight * 0.5;
    }

    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));

    const emberMaterial = new THREE.PointsMaterial({
      color: 0xffaa00,
      size: 0.15,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const emberParticles = new THREE.Points(emberGeometry, emberMaterial);
    emberParticles.userData.isEmbers = true;
    emberParticles.userData.buildingWidth = buildingWidth;
    emberParticles.userData.buildingHeight = buildingHeight;
    emberParticles.userData.lifetimes = new Float32Array(emberCount).fill(0).map(() => Math.random());
    emberParticles.userData.velocities = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      emberParticles.userData.velocities[i * 3] = (Math.random() - 0.5) * 2;
      emberParticles.userData.velocities[i * 3 + 1] = 2 + Math.random() * 3;
      emberParticles.userData.velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    fireGroup.add(emberParticles);

    return fireGroup;
  }

  /**
   * Animate fire effect with realistic particle behavior
   */
  private updateFireEffect(fireGroup: THREE.Group, dt: number): void {
    for (const child of fireGroup.children) {
      if (!(child instanceof THREE.Points)) continue;

      const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const lifetimes = child.userData.lifetimes as Float32Array;

      if (child.userData.isFireParticles) {
        // Fire particles rise and flicker
        const bw = child.userData.buildingWidth;
        const bh = child.userData.buildingHeight;
        const colors = (child.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * (1.5 + Math.random() * 0.5);

          // Rise upward with slight horizontal drift
          positions[i * 3] += (Math.random() - 0.5) * dt * 0.5;
          positions[i * 3 + 1] += dt * (1 + Math.random() * 0.5);
          positions[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.5;

          // Reset when lifetime exceeded or too high
          if (lifetimes[i] > 1 || positions[i * 3 + 1] > bh * 1.2) {
            lifetimes[i] = 0;
            positions[i * 3] = (Math.random() - 0.5) * bw * 0.7;
            positions[i * 3 + 1] = Math.random() * 0.3;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bh * 0.7;
          }

          // Color fades from yellow/white to orange/red as it rises
          const progress = lifetimes[i];
          colors[i * 3] = 1;
          colors[i * 3 + 1] = Math.max(0.2, 0.8 - progress * 0.6);
          colors[i * 3 + 2] = Math.max(0, 0.3 - progress * 0.3);
        }
        child.geometry.attributes.color.needsUpdate = true;

        // Pulse overall opacity
        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = 0.7 + Math.sin(this.fireAnimTime * 15) * 0.2;

      } else if (child.userData.isSmokeParticles) {
        // Smoke rises slowly and drifts
        const bh = child.userData.buildingHeight;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 0.3;

          // Slow rise with drift
          positions[i * 3] += (Math.random() - 0.5) * dt * 0.3;
          positions[i * 3 + 1] += dt * 0.8;
          positions[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.3;

          // Reset when too high
          if (positions[i * 3 + 1] > bh * 2) {
            lifetimes[i] = 0;
            positions[i * 3] = (Math.random() - 0.5) * bh * 0.6;
            positions[i * 3 + 1] = bh * 0.5;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bh * 0.6;
          }
        }

      } else if (child.userData.isEmbers) {
        // Embers shoot up and arc down
        const bw = child.userData.buildingWidth;
        const bh = child.userData.buildingHeight;
        const velocities = child.userData.velocities as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt;

          // Apply velocity
          positions[i * 3] += velocities[i * 3] * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

          // Gravity
          velocities[i * 3 + 1] -= dt * 4;

          // Reset when fallen below start or too old
          if (lifetimes[i] > 2 || positions[i * 3 + 1] < 0) {
            lifetimes[i] = 0;
            positions[i * 3] = (Math.random() - 0.5) * bw * 0.5;
            positions[i * 3 + 1] = Math.random() * 0.3;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bh * 0.5;
            velocities[i * 3] = (Math.random() - 0.5) * 2;
            velocities[i * 3 + 1] = 2 + Math.random() * 3;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
          }
        }
      }

      child.geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Create construction effect (dust and sparks at build layer)
   */
  private createConstructionEffect(buildingWidth: number, buildingDepth: number, _buildingHeight: number): THREE.Group {
    const effectGroup = new THREE.Group();

    // Create dust particles (scattered around construction area)
    const dustCount = 50;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 1.2;
      dustPositions[i * 3 + 1] = Math.random() * 0.5; // Slight vertical spread
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 1.2;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

    const dustPoints = new THREE.Points(dustGeometry, this.constructionDustMaterial.clone());
    dustPoints.userData.basePositions = dustPositions.slice();
    dustPoints.userData.velocities = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount * 3; i++) {
      dustPoints.userData.velocities[i] = (Math.random() - 0.5) * 2;
    }
    effectGroup.add(dustPoints);

    // Create spark particles (welding/building sparks)
    const sparkCount = 30;
    const sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.8;
      sparkPositions[i * 3 + 1] = Math.random() * 0.3;
      sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.8;
    }
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));

    const sparkPoints = new THREE.Points(sparkGeometry, this.constructionSparkMaterial.clone());
    sparkPoints.userData.basePositions = sparkPositions.slice();
    sparkPoints.userData.lifetimes = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
      sparkPoints.userData.lifetimes[i] = Math.random();
    }
    sparkPoints.userData.isSparks = true;
    effectGroup.add(sparkPoints);

    return effectGroup;
  }

  /**
   * Update construction effect animation
   */
  private updateConstructionEffect(effectGroup: THREE.Group, dt: number, buildingWidth: number, buildingDepth: number): void {
    for (const child of effectGroup.children) {
      if (child instanceof THREE.Points) {
        const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        const basePositions = child.userData.basePositions as Float32Array;

        if (child.userData.isSparks) {
          // Spark animation - quick bursts that fade and respawn
          const lifetimes = child.userData.lifetimes as Float32Array;
          for (let i = 0; i < positions.length / 3; i++) {
            lifetimes[i] += dt * 3;
            if (lifetimes[i] > 1) {
              // Respawn spark
              lifetimes[i] = 0;
              positions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.8;
              positions[i * 3 + 1] = 0;
              positions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.8;
            } else {
              // Move spark upward and outward
              positions[i * 3 + 1] += dt * 2 * (1 - lifetimes[i]);
              positions[i * 3] += (Math.random() - 0.5) * dt * 0.5;
              positions[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.5;
            }
          }
          // Pulse opacity based on construction
          const mat = child.material as THREE.PointsMaterial;
          mat.opacity = 0.5 + Math.sin(this.constructionAnimTime * 15) * 0.4;
        } else {
          // Dust animation - drift upward slowly
          const velocities = child.userData.velocities as Float32Array;
          for (let i = 0; i < positions.length / 3; i++) {
            positions[i * 3] += velocities[i * 3] * dt * 0.2;
            positions[i * 3 + 1] += dt * 0.5; // Drift upward
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt * 0.2;

            // Reset if too far
            if (positions[i * 3 + 1] > 1 || Math.abs(positions[i * 3]) > buildingWidth) {
              positions[i * 3] = basePositions[i * 3];
              positions[i * 3 + 1] = 0;
              positions[i * 3 + 2] = basePositions[i * 3 + 2];
            }
          }
        }

        child.geometry.attributes.position.needsUpdate = true;
      }
    }
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
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
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
    this.fireMaterial.dispose();
    this.smokeMaterial.dispose();
    this.fireGeometry.dispose();
    this.constructionDustMaterial.dispose();
    this.constructionSparkMaterial.dispose();

    for (const meshData of this.buildingMeshes.values()) {
      this.disposeGroup(meshData.group);
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
      if (meshData.fireEffect) {
        this.scene.remove(meshData.fireEffect);
        this.disposeGroup(meshData.fireEffect);
      }
      if (meshData.constructionEffect) {
        this.scene.remove(meshData.constructionEffect);
        this.disposeGroup(meshData.constructionEffect);
      }
    }
    this.buildingMeshes.clear();

    // Dispose instanced groups
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      } else if (Array.isArray(group.mesh.material)) {
        group.mesh.material.forEach(m => m.dispose());
      }
    }
    this.instancedGroups.clear();
  }
}
