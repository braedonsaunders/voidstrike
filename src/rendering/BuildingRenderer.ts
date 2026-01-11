import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';

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
  // Thruster effect for flying buildings
  thrusterEffect: THREE.Group | null;
}

// Instanced building group for same-type completed buildings
interface InstancedBuildingGroup {
  mesh: THREE.InstancedMesh;
  buildingType: string;
  playerId: string;
  maxInstances: number;
  entityIds: number[];
  dummy: THREE.Object3D;
  // CRITICAL: Track model scale to apply to instances (custom models are normalized with scale)
  modelScale: THREE.Vector3;
  // CRITICAL: Track model Y offset for proper grounding (models have position.y set to anchor bottom at y=0)
  modelYOffset: number;
}

const MAX_BUILDING_INSTANCES_PER_TYPE = 50;

export class BuildingRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string | null = null;
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
  private thrusterCoreMaterial: THREE.PointsMaterial;
  private thrusterGlowMaterial: THREE.PointsMaterial;

  // Animation time for effects
  private fireAnimTime: number = 0;
  private constructionAnimTime: number = 0;

  // Fallback elevation heights when terrain isn't available
  private static readonly ELEVATION_HEIGHTS = [0, 1.8, 3.5];

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

    // Construction dust particles - large size for visibility
    this.constructionDustMaterial = new THREE.PointsMaterial({
      color: 0xccbb99,
      size: 0.8,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    // Construction sparks (welding/building effect) - larger size for visibility
    this.constructionSparkMaterial = new THREE.PointsMaterial({
      color: 0xffdd55,
      size: 0.5,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    // Thruster effect materials (for flying buildings)
    this.thrusterCoreMaterial = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.4,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.thrusterGlowMaterial = new THREE.PointsMaterial({
      color: 0x4488ff,
      size: 0.6,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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

      // Find geometry, material, and world scale from the base mesh
      // CRITICAL: Custom models have scale applied to Object3D, not geometry vertices
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      const modelScale = new THREE.Vector3(1, 1, 1);
      const modelPosition = new THREE.Vector3();

      // Update world matrices to get accurate world scale and position
      baseMesh.updateMatrixWorld(true);

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
          // Get the world scale of this mesh (includes parent scales from normalization)
          child.getWorldScale(modelScale);
          // Get the world position of this mesh (includes Y offset for grounding)
          child.getWorldPosition(modelPosition);
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
      // Buildings render AFTER ground effects (5) but BEFORE damage numbers (100)
      instancedMesh.renderOrder = 50;

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        buildingType,
        playerId,
        maxInstances: MAX_BUILDING_INSTANCES_PER_TYPE,
        entityIds: [],
        dummy: new THREE.Object3D(),
        modelScale, // Store the model's world scale for proper instance sizing
        modelYOffset: modelPosition.y, // Store Y offset for proper grounding
      };

      this.instancedGroups.set(key, group);
    }

    return group;
  }

  /**
   * Check if a building can use instanced rendering.
   * Requirements: completed, not selected, not damaged (<100% health), visible, not flying
   */
  private canUseInstancing(building: Building, health: Health | undefined, selectable: Selectable | undefined): boolean {
    if (!building.isComplete()) return false;
    if (selectable?.isSelected) return false;
    if (health && health.getHealthPercent() < 1) return false;
    // Buildings with production queue shouldn't use instancing (need progress bar)
    if (building.productionQueue.length > 0) return false;
    // Flying buildings need individual rendering for height offset
    if (building.isFlying || building.state === 'lifting' || building.state === 'landing') return false;
    return true;
  }

  /**
   * Reset building materials to full opacity (complete state).
   * Properly handles both single materials and material arrays.
   */
  private resetBuildingMaterials(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        this.setMaterialOpacity(child, 1, false);
      }
    });
  }

  /**
   * Set opacity on a mesh's material(s), handling both single materials and arrays.
   * Optionally applies a clipping plane for construction reveal effect.
   */
  private setMaterialOpacity(mesh: THREE.Mesh, opacity: number, transparent: boolean, clippingPlane?: THREE.Plane): void {
    const applyToMaterial = (mat: THREE.Material) => {
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.clippingPlanes = clippingPlane ? [clippingPlane] : [];
        mat.clipShadows = true;
        mat.transparent = transparent;
        mat.opacity = opacity;
        mat.side = THREE.DoubleSide;
      }
    };

    if (Array.isArray(mesh.material)) {
      for (const mat of mesh.material) {
        applyToMaterial(mat);
      }
    } else {
      applyToMaterial(mesh.material);
    }
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
  }

  /**
   * Get terrain height at position with fallback to map data elevation
   * Ensures buildings are never rendered underground
   */
  private getTerrainHeightAt(x: number, y: number): number {
    // First try terrain system
    if (this.terrain) {
      const height = this.terrain.getHeightAt(x, y);
      // Validate height is reasonable (not NaN or extreme values)
      if (isFinite(height) && height >= -10 && height <= 100) {
        return height;
      }
    }

    // Fallback: get elevation from map data if available
    // This ensures buildings are placed correctly even if terrain isn't ready
    const mapData = (this.terrain as unknown as { mapData?: { width: number; height: number; terrain: Array<Array<{ elevation: number }>> } })?.mapData;
    if (mapData?.terrain) {
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY]?.[cellX];
        if (cell && typeof cell.elevation === 'number') {
          return BuildingRenderer.ELEVATION_HEIGHTS[cell.elevation] ?? 0;
        }
      }
    }

    // Ultimate fallback: ground level
    return 0;
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
      const isSpectating = isSpectatorMode() || !this.playerId;
      const isOwned = !isSpectating && ownerId === this.playerId;
      const isEnemy = !isSpectating && selectable && ownerId !== this.playerId;

      // Check visibility for enemy buildings (skip in spectator mode - show all)
      let shouldShow = true;
      if (isEnemy && this.visionSystem && this.playerId) {
        shouldShow = this.visionSystem.isExplored(this.playerId, transform.x, transform.y);
      }

      // PERFORMANCE: Try to use instanced rendering for completed static buildings
      if (shouldShow && this.canUseInstancing(building, health, selectable)) {
        const group = this.getOrCreateInstancedGroup(building.buildingId, ownerId);

        if (group.mesh.count < group.maxInstances) {
          const terrainHeight = this.getTerrainHeightAt(transform.x, transform.y);

          // Set instance matrix - CRITICAL: Use model's scale and Y offset from normalization
          // The Y offset ensures buildings are properly grounded (bottom at terrain level)
          this.tempPosition.set(transform.x, terrainHeight + group.modelYOffset, transform.y);
          this.tempScale.copy(group.modelScale); // Apply the normalized model scale
          this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
          group.mesh.setMatrixAt(group.mesh.count, this.tempMatrix);
          group.entityIds.push(entity.id);
          group.mesh.count++;
          group.mesh.instanceMatrix.needsUpdate = true;

          instancedBuildingIds.add(entity.id);

          // Hide individual mesh if it exists and clean up construction state
          const existingMesh = this.buildingMeshes.get(entity.id);
          if (existingMesh) {
            existingMesh.group.visible = false;
            existingMesh.selectionRing.visible = false;
            existingMesh.healthBar.visible = false;
            existingMesh.progressBar.visible = false;

            // CRITICAL: Hide/remove construction effect when switching to instancing
            if (existingMesh.constructionEffect) {
              this.scene.remove(existingMesh.constructionEffect);
              this.disposeGroup(existingMesh.constructionEffect);
              existingMesh.constructionEffect = null;
            }

            // Ensure materials are properly reset for when building returns to individual rendering
            if (!existingMesh.wasComplete) {
              this.resetBuildingMaterials(existingMesh.group);
              existingMesh.wasComplete = true;
            }
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
          this.resetBuildingMaterials(meshData.group);
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

      // Get terrain height at this position - use safe method with fallback
      const terrainHeight = this.getTerrainHeightAt(transform.x, transform.y);

      // Calculate flying height offset based on building state
      let flyingOffset = 0;
      const FLYING_HEIGHT = 8; // Height when fully flying
      if (building.state === 'lifting') {
        flyingOffset = FLYING_HEIGHT * building.liftProgress;
      } else if (building.state === 'flying') {
        flyingOffset = FLYING_HEIGHT;
      } else if (building.state === 'landing') {
        flyingOffset = FLYING_HEIGHT * building.liftProgress;
      }

      // Update position - place building on top of terrain (with flying offset)
      meshData.group.position.set(transform.x, terrainHeight + flyingOffset, transform.y);

      // Construction animation based on building state
      // States: 'waiting_for_worker', 'constructing', 'paused', 'complete', 'lifting', 'flying', 'landing', 'destroyed'
      const isConstructing = building.state === 'constructing';
      const isWaitingForWorker = building.state === 'waiting_for_worker';
      const isPaused = building.state === 'paused';
      const isLifting = building.state === 'lifting';
      const isFlying = building.state === 'flying';
      const isLanding = building.state === 'landing';
      // Complete, lifting, flying, and landing states should show full opacity building
      const shouldShowComplete = !isConstructing && !isWaitingForWorker && !isPaused;

      if (shouldShowComplete) {
        // Complete/operational building - full opacity, no construction effects
        meshData.group.scale.setScalar(1);
        this.resetBuildingMaterials(meshData.group);
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
            this.setMaterialOpacity(child, 0.25, true);
          }
        });
        // Hide construction effect while waiting
        if (meshData.constructionEffect) {
          meshData.constructionEffect.visible = false;
        }
      } else if (isPaused) {
        // Construction paused (SC2-style) - show partially built state without active effects
        const progress = building.buildProgress;

        // Use Y-scale to show partial construction (same as constructing state)
        const yScale = Math.max(0.01, progress);
        const yOffset = meshData.buildingHeight * (1 - yScale) * 0.5;

        meshData.group.scale.set(1, yScale, 1);
        meshData.group.position.set(transform.x, terrainHeight - yOffset, transform.y);

        // Slightly more transparent when paused to indicate inactive state
        const opacity = 0.5 + progress * 0.3;
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            this.setMaterialOpacity(child, opacity, true);
          }
        });

        // Hide construction particles when paused (no active construction)
        if (meshData.constructionEffect) {
          meshData.constructionEffect.visible = false;
        }
      } else {
        // Construction in progress (state === 'constructing')
        // Bottom-up reveal using Y-scale animation (more reliable than clipping planes)
        const progress = building.buildProgress;

        // Scale building from bottom up: at progress=0, scale.y=0.01; at progress=1, scale.y=1
        // We use a minimum of 0.01 to avoid zero scale issues
        const yScale = Math.max(0.01, progress);

        // Position adjustment: anchor building at bottom so it grows upward
        // When scale.y < 1, we need to offset Y position downward to keep bottom at ground level
        // The building mesh is positioned at terrainHeight, so we offset based on buildingHeight
        const yOffset = meshData.buildingHeight * (1 - yScale) * 0.5;

        meshData.group.scale.set(1, yScale, 1);
        meshData.group.position.set(transform.x, terrainHeight - yOffset, transform.y);

        // Building is semi-transparent during construction
        const opacity = 0.6 + progress * 0.4; // 60% to 100% as it builds
        meshData.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            this.setMaterialOpacity(child, opacity, true);
          }
        });

        // Create/update construction effect (dust and sparks)
        if (!meshData.constructionEffect) {
          meshData.constructionEffect = this.createConstructionEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.constructionEffect);
        }

        // Position construction particles at the current build height (top of visible building)
        const buildHeight = meshData.buildingHeight * progress;
        meshData.constructionEffect.visible = true;
        meshData.constructionEffect.position.set(transform.x, terrainHeight + buildHeight, transform.y);
        this.updateConstructionEffect(meshData.constructionEffect, dt, building.width, building.height);
      }

      // Update selection ring - larger multiplier for better visibility
      // Include flyingOffset so selection ring follows building when lifted off
      const ringSize = Math.max(building.width, building.height) * 0.9;
      meshData.selectionRing.position.set(transform.x, terrainHeight + flyingOffset + 0.05, transform.y);
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

      // Thruster effects for flying buildings (lifting, flying, or landing)
      const isFlyingState = building.state === 'lifting' || building.state === 'flying' || building.state === 'landing';
      if (isFlyingState && !meshData.thrusterEffect) {
        // Create thruster effect
        meshData.thrusterEffect = this.createThrusterEffect(building.width, building.height);
        this.scene.add(meshData.thrusterEffect);
      } else if (!isFlyingState && meshData.thrusterEffect) {
        // Remove thruster effect when landed
        this.scene.remove(meshData.thrusterEffect);
        this.disposeGroup(meshData.thrusterEffect);
        meshData.thrusterEffect = null;
      }

      // Animate thruster effect
      if (meshData.thrusterEffect) {
        // Position thrusters at the bottom of the building
        meshData.thrusterEffect.position.set(transform.x, terrainHeight + flyingOffset, transform.y);
        this.updateThrusterEffect(meshData.thrusterEffect, dt, building.liftProgress);
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
        if (meshData.thrusterEffect) {
          this.scene.remove(meshData.thrusterEffect);
          this.disposeGroup(meshData.thrusterEffect);
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
    // Buildings render AFTER ground effects (5) but BEFORE damage numbers (100)
    group.renderOrder = 50;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = 50;
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
      thrusterEffect: null,
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
   * Create thruster effect for flying buildings
   * Creates downward-pointing engine flames at multiple points under the building
   */
  private createThrusterEffect(buildingWidth: number, buildingHeight: number): THREE.Group {
    const thrusterGroup = new THREE.Group();

    // Create 4 thruster points at corners of the building
    const thrusterOffsets = [
      { x: -buildingWidth * 0.35, z: -buildingHeight * 0.35 },
      { x: buildingWidth * 0.35, z: -buildingHeight * 0.35 },
      { x: -buildingWidth * 0.35, z: buildingHeight * 0.35 },
      { x: buildingWidth * 0.35, z: buildingHeight * 0.35 },
    ];

    // Core flame particles (bright blue-white center)
    const coreParticleCount = 60;
    const corePositions = new Float32Array(coreParticleCount * 3);
    const coreColors = new Float32Array(coreParticleCount * 3);

    for (let i = 0; i < coreParticleCount; i++) {
      const thruster = thrusterOffsets[i % thrusterOffsets.length];
      corePositions[i * 3] = thruster.x + (Math.random() - 0.5) * 0.3;
      corePositions[i * 3 + 1] = -Math.random() * 1.5; // Below building
      corePositions[i * 3 + 2] = thruster.z + (Math.random() - 0.5) * 0.3;

      // Blue-white core color
      coreColors[i * 3] = 0.7 + Math.random() * 0.3;
      coreColors[i * 3 + 1] = 0.85 + Math.random() * 0.15;
      coreColors[i * 3 + 2] = 1.0;
    }

    const coreGeometry = new THREE.BufferGeometry();
    coreGeometry.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
    coreGeometry.setAttribute('color', new THREE.BufferAttribute(coreColors, 3));

    const coreMaterial = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const coreParticles = new THREE.Points(coreGeometry, coreMaterial);
    coreParticles.userData.isThrusterCore = true;
    coreParticles.userData.thrusterOffsets = thrusterOffsets;
    coreParticles.userData.lifetimes = new Float32Array(coreParticleCount).fill(0).map(() => Math.random());
    thrusterGroup.add(coreParticles);

    // Glow/exhaust particles (larger, more diffuse)
    const glowParticleCount = 40;
    const glowPositions = new Float32Array(glowParticleCount * 3);

    for (let i = 0; i < glowParticleCount; i++) {
      const thruster = thrusterOffsets[i % thrusterOffsets.length];
      glowPositions[i * 3] = thruster.x + (Math.random() - 0.5) * 0.5;
      glowPositions[i * 3 + 1] = -Math.random() * 2.5; // Further below
      glowPositions[i * 3 + 2] = thruster.z + (Math.random() - 0.5) * 0.5;
    }

    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));

    const glowMaterial = new THREE.PointsMaterial({
      color: 0x4488ff,
      size: 0.6,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowParticles = new THREE.Points(glowGeometry, glowMaterial);
    glowParticles.userData.isThrusterGlow = true;
    glowParticles.userData.thrusterOffsets = thrusterOffsets;
    glowParticles.userData.lifetimes = new Float32Array(glowParticleCount).fill(0).map(() => Math.random());
    thrusterGroup.add(glowParticles);

    return thrusterGroup;
  }

  /**
   * Animate thruster effect with pulsing flames
   */
  private updateThrusterEffect(thrusterGroup: THREE.Group, dt: number, liftProgress: number): void {
    // Intensity based on lift state (stronger during lift-off/landing, steady when flying)
    const baseIntensity = 0.7 + liftProgress * 0.3;

    for (const child of thrusterGroup.children) {
      if (!(child instanceof THREE.Points)) continue;

      const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const lifetimes = child.userData.lifetimes as Float32Array;
      const thrusterOffsets = child.userData.thrusterOffsets as Array<{ x: number; z: number }>;

      if (child.userData.isThrusterCore) {
        const colors = (child.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 4;

          // Move downward rapidly
          positions[i * 3 + 1] -= dt * 8;

          // Slight horizontal drift
          positions[i * 3] += (Math.random() - 0.5) * dt * 0.5;
          positions[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.5;

          // Reset when too far down or lifetime exceeded
          if (lifetimes[i] > 1 || positions[i * 3 + 1] < -3) {
            lifetimes[i] = 0;
            const thruster = thrusterOffsets[i % thrusterOffsets.length];
            positions[i * 3] = thruster.x + (Math.random() - 0.5) * 0.3;
            positions[i * 3 + 1] = -0.1 - Math.random() * 0.3;
            positions[i * 3 + 2] = thruster.z + (Math.random() - 0.5) * 0.3;
          }

          // Color fades from white-blue to blue as it descends
          const progress = lifetimes[i];
          colors[i * 3] = Math.max(0.3, 0.9 - progress * 0.6);
          colors[i * 3 + 1] = Math.max(0.5, 1.0 - progress * 0.4);
          colors[i * 3 + 2] = 1.0;
        }
        child.geometry.attributes.color.needsUpdate = true;

        // Pulse opacity
        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = baseIntensity * (0.85 + Math.sin(this.fireAnimTime * 20) * 0.15);

      } else if (child.userData.isThrusterGlow) {
        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 2;

          // Move downward slower than core
          positions[i * 3 + 1] -= dt * 5;

          // More horizontal drift for glow
          positions[i * 3] += (Math.random() - 0.5) * dt * 1.0;
          positions[i * 3 + 2] += (Math.random() - 0.5) * dt * 1.0;

          // Reset when too far down
          if (lifetimes[i] > 1 || positions[i * 3 + 1] < -4) {
            lifetimes[i] = 0;
            const thruster = thrusterOffsets[i % thrusterOffsets.length];
            positions[i * 3] = thruster.x + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 1] = -0.2 - Math.random() * 0.5;
            positions[i * 3 + 2] = thruster.z + (Math.random() - 0.5) * 0.5;
          }
        }

        // Pulse glow opacity
        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = baseIntensity * (0.4 + Math.sin(this.fireAnimTime * 15 + 0.5) * 0.15);
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
    this.thrusterCoreMaterial.dispose();
    this.thrusterGlowMaterial.dispose();

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
      if (meshData.thrusterEffect) {
        this.scene.remove(meshData.thrusterEffect);
        this.disposeGroup(meshData.thrusterEffect);
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
