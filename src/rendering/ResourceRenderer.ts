import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource, OPTIMAL_WORKERS_PER_MINERAL, OPTIMAL_WORKERS_PER_VESPENE } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Terrain } from './Terrain';
import AssetManager, { LODLevel } from '@/assets/AssetManager';
import { useUIStore } from '@/store/uiStore';
import { debugMesh } from '@/utils/debugLogger';
// NOTE: Resources don't move, so we don't use velocity tracking (AAA optimization)
// Velocity node returns zero for meshes without velocity attributes

interface InstancedResourceGroup {
  mesh: THREE.InstancedMesh;
  resourceType: string;
  lodLevel: LODLevel; // Which LOD level this group represents
  maxInstances: number;
  entityIds: number[];
  rotations: number[]; // Store random rotations per instance
  yOffset: number; // Y offset from model normalization (to ground the model)
  baseScale: number; // Base scale from model normalization
  modelXRotation: number; // X rotation from model (to stand upright)
  modelZRotation: number; // Z rotation from model (to stand upright)
  modelYRotation: number; // Base Y rotation (MODEL_FORWARD_OFFSET + asset config)
}

// Track per-resource rotation (selection rings are now instanced)
interface ResourceData {
  rotation: number;
  lastScale: number;
}

// Track mineral line worker labels (one label per mineral line)
interface MineralLineLabel {
  sprite: THREE.Sprite;
  centerX: number;
  centerY: number;
  patchIds: Set<number>; // Entity IDs of patches in this line
  lastWorkerCount: number;
  lastOptimalCount: number;
}

// Track vespene geyser labels (one label per geyser with extractor)
interface VespeneLabel {
  sprite: THREE.Sprite;
  entityId: number;
  lastWorkerCount: number;
  lastOptimalCount: number;
}

// Max instances per resource type - must exceed max minerals/vespene on largest maps
// 4-player maps: ~17 expansions × 8 minerals = 136 minerals
// 8-player maps could have even more, so we use 200 for headroom
const MAX_RESOURCES_PER_TYPE = 200;

// Distance threshold to group minerals into a line
const MINERAL_LINE_GROUPING_DISTANCE = 15;

export class ResourceRenderer {
  private scene: THREE.Scene;
  private world: World;
  private terrain: Terrain | null;

  // Instanced mesh groups: one per resource type
  private instancedGroups: Map<string, InstancedResourceGroup> = new Map();

  // Per-resource data (rotation, selection ring)
  private resourceData: Map<number, ResourceData> = new Map();

  // Mineral line labels (one per mineral line, not per patch)
  private mineralLineLabels: MineralLineLabel[] = [];

  // Vespene labels (one per geyser with extractor)
  private vespeneLabels: Map<number, VespeneLabel> = new Map();

  // PERF: Instanced selection ring for all resources (saves ~180 draw calls)
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private selectionRingMesh: THREE.InstancedMesh | null = null;
  private selectedResources: Map<number, THREE.Vector3> = new Map();
  private readonly MAX_SELECTION_INSTANCES = 200;

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3();
  private tempEuler: THREE.Euler = new THREE.Euler();
  private readonly Y_AXIS: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // PERF: Frustum culling for instances
  private frustum: THREE.Frustum = new THREE.Frustum();
  private frustumMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private camera: THREE.Camera | null = null;

  // Debug tracking
  private _lastMineralCount: number = 0;
  private _debugLoggedThisSession: boolean = false;
  private _warnedInstanceLimit: Set<string> = new Set();
  private _mineralLinesBuilt: boolean = false;

  // PERF: Pre-allocated Set for tracking current entity IDs to avoid per-frame allocation
  private readonly _currentIds: Set<number> = new Set();

  // PERF: Cached worker counts per resource ID - rebuilt once per frame instead of O(workers) per label
  private readonly _workerCountCache: Map<number, number> = new Map();

  // PERF: Cached and sorted entity list - only rebuild when entity set changes
  private _cachedSortedEntities: { id: number; entity: import('@/engine/ecs/Entity').Entity }[] = [];
  private _lastEntityCount: number = -1;

  constructor(scene: THREE.Scene, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain ?? null;

    // Selection ring for resources (yellow for neutral)
    this.selectionGeometry = new THREE.RingGeometry(1.2, 1.5, 16);
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Set camera reference for frustum culling
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Update frustum from camera - call before update loop
   * PERF: camera.updateMatrixWorld() is called once in main render loop
   */
  private updateFrustum(): void {
    if (!this.camera) return;
    // PERF: updateMatrixWorld() is now called once in WebGPUGameCanvas before renderer updates
    this.frustumMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
  }

  /**
   * Check if a position is within the camera frustum
   */
  private isInFrustum(x: number, y: number, z: number): boolean {
    if (!this.camera) return true;
    this.tempPosition.set(x, y, z);
    return this.frustum.containsPoint(this.tempPosition);
  }

  /**
   * Get or create an instanced mesh group for a resource type
   */
  private getOrCreateInstancedGroup(resourceType: string, lodLevel: LODLevel = 0): InstancedResourceGroup {
    const key = `${resourceType}_LOD${lodLevel}`;
    let group = this.instancedGroups.get(key);

    if (!group) {
      // Get the base mesh from AssetManager at the requested LOD level
      const baseMesh = AssetManager.getModelAtLOD(resourceType, lodLevel)
        ?? AssetManager.getResourceMesh(resourceType as 'minerals' | 'vespene');

      // Update world matrices to get accurate transforms
      baseMesh.updateMatrixWorld(true);

      // Find the actual mesh geometry, material, and extract transforms from the model
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      let yOffset = 0;
      let baseScale = 1;
      // Extract X/Z rotations from model to keep it upright
      // Y rotation comes from MODEL_FORWARD_OFFSET + asset config + per-instance random
      let modelXRotation = 0;
      let modelZRotation = 0;
      const modelYRotation = AssetManager.getModelRotationY(resourceType);
      const tempQuat = new THREE.Quaternion();
      const tempEuler = new THREE.Euler();

      // Count meshes in the model
      let meshCount = 0;
      baseMesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) meshCount++;
      });

      // Extract geometry, material, and transform info from first mesh
      baseMesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
          // Get world quaternion to extract X/Z rotations that stand the model upright
          child.getWorldQuaternion(tempQuat);
          tempEuler.setFromQuaternion(tempQuat, 'YXZ'); // YXZ order for proper decomposition
          modelXRotation = tempEuler.x;
          modelZRotation = tempEuler.z;
          // Walk up the parent chain to accumulate position/scale transforms
          let obj: THREE.Object3D | null = child;
          while (obj && obj !== baseMesh) {
            yOffset += obj.position.y * (obj.parent?.scale.y ?? 1);
            baseScale *= obj.scale.y;
            obj = obj.parent;
          }
          // IMPORTANT: Also include baseMesh's own transforms (from normalization)
          // The model root has scale and position.y set by normalizeModel()
          // Note: position.y is already in final space (set after scale), so don't multiply by scale again
          yOffset += baseMesh.position.y;
          baseScale *= baseMesh.scale.y;
        }
      });

      // Single consolidated log for model loading
      const vertCount = (geometry as THREE.BufferGeometry | null)?.attributes?.position?.count ?? 0;
      debugMesh.log(`[ResourceRenderer] ${resourceType}: meshes=${meshCount}, verts=${vertCount}, yOffset=${yOffset.toFixed(2)}, baseScale=${baseScale.toFixed(4)}`);

      // Fallback to procedural geometry if model has no geometry or invalid geometry
      const geomToCheck = geometry as THREE.BufferGeometry | null;
      const vertexCount = geomToCheck?.attributes?.position?.count ?? 0;
      if (!geomToCheck || vertexCount < 3) {
        debugMesh.log(`[ResourceRenderer] ${resourceType}: Using procedural fallback (geometry ${geomToCheck ? 'has ' + vertexCount + ' vertices' : 'missing'})`);
        // Fallback: create a simple shape
        if (resourceType === 'minerals') {
          geometry = new THREE.ConeGeometry(0.4, 1.2, 6);
          material = new THREE.MeshStandardMaterial({
            color: 0x60a0ff,
            emissive: 0x4080ff,
            emissiveIntensity: 0.8,
          });
          yOffset = 0.6; // Half height of cone
          baseScale = 1;
        } else {
          geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.6, 8);
          material = new THREE.MeshStandardMaterial({
            color: 0x40ff80,
            emissive: 0x20ff60,
            emissiveIntensity: 0.6,
          });
          yOffset = 0.3; // Half height of cylinder
          baseScale = 1;
        }
      }

      // Create instanced mesh (geometry is guaranteed non-null after fallback)
      const instancedMesh = new THREE.InstancedMesh(
        geometry!,
        material!,
        MAX_RESOURCES_PER_TYPE
      );
      instancedMesh.count = 0;
      // PERF: Resources receive shadows but don't cast - saves shadow render passes
      instancedMesh.castShadow = false;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false;

      this.scene.add(instancedMesh);

      // Clamp values to reasonable ranges to prevent underground rendering or invisible scales
      if (yOffset < 0) {
        debugMesh.warn(`[ResourceRenderer] ${resourceType}: Negative yOffset ${yOffset.toFixed(2)} clamped to 0`);
        yOffset = 0;
      }
      // baseScale must be in a reasonable range - too small makes resources invisible
      // If model normalization resulted in tiny scale, use 1.0 instead
      if (baseScale <= 0.1 || baseScale > 10) {
        debugMesh.warn(`[ResourceRenderer] ${resourceType}: baseScale ${baseScale.toFixed(4)} clamped to 1.0`);
        baseScale = 1;
      }

      group = {
        mesh: instancedMesh,
        resourceType,
        lodLevel,
        maxInstances: MAX_RESOURCES_PER_TYPE,
        entityIds: [],
        rotations: [],
        yOffset,
        baseScale,
        modelXRotation,
        modelZRotation,
        modelYRotation,
      };

      this.instancedGroups.set(key, group);
    }

    return group;
  }

  /**
   * Get or create per-resource data (rotation only - selection rings are instanced)
   */
  private getOrCreateResourceData(entityId: number): ResourceData {
    let data = this.resourceData.get(entityId);
    if (!data) {
      data = {
        rotation: Math.random() * Math.PI * 2,
        lastScale: 1,
      };
      this.resourceData.set(entityId, data);
    }
    return data;
  }

  /**
   * PERF: Get or create instanced selection ring mesh for all resources
   */
  private getOrCreateSelectionRingMesh(): THREE.InstancedMesh {
    if (!this.selectionRingMesh) {
      this.selectionRingMesh = new THREE.InstancedMesh(
        this.selectionGeometry,
        this.selectionMaterial,
        this.MAX_SELECTION_INSTANCES
      );
      this.selectionRingMesh.count = 0;
      this.selectionRingMesh.frustumCulled = false;
      this.selectionRingMesh.rotation.x = -Math.PI / 2;
      this.selectionRingMesh.renderOrder = 5;
      this.scene.add(this.selectionRingMesh);
    }
    return this.selectionRingMesh;
  }

  /**
   * Create a sprite for displaying worker count (e.g., "16/16")
   */
  private createWorkerLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 40;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.0, 0.8, 1);
    sprite.visible = false;

    return sprite;
  }

  /**
   * Update the worker label texture with current/optimal worker counts
   */
  private updateWorkerLabel(
    sprite: THREE.Sprite,
    currentWorkers: number,
    optimalWorkers: number
  ): void {
    const material = sprite.material as THREE.SpriteMaterial;
    const texture = material.map as THREE.CanvasTexture;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background with rounded corners
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 6);
    ctx.fill();

    // Determine color based on saturation level
    let color: string;
    if (currentWorkers >= optimalWorkers) {
      // Fully saturated - green
      color = '#00ff00';
    } else if (currentWorkers > 0) {
      // Partially saturated - yellow
      color = '#ffff00';
    } else {
      // No workers - white/gray
      color = '#aaaaaa';
    }

    // Draw text (e.g., "16/16")
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(`${currentWorkers}/${optimalWorkers}`, canvas.width / 2, canvas.height / 2);

    // Mark texture for update
    texture.needsUpdate = true;
  }

  /**
   * Build mineral line groupings from current mineral patches.
   * Groups nearby minerals into "mineral lines" for combined worker display.
   */
  private buildMineralLines(): void {
    // Clean up old labels
    for (const label of this.mineralLineLabels) {
      this.scene.remove(label.sprite);
      this.disposeWorkerLabel(label.sprite);
    }
    this.mineralLineLabels = [];

    // Get all mineral patches
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    const mineralPatches: { entityId: number; x: number; y: number }[] = [];

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');
      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      mineralPatches.push({
        entityId: entity.id,
        x: transform.x,
        y: transform.y,
      });
    }

    // Group minerals using simple clustering
    const assigned = new Set<number>();

    for (const patch of mineralPatches) {
      if (assigned.has(patch.entityId)) continue;

      // Start a new mineral line with this patch
      const linePatches: typeof mineralPatches = [patch];
      assigned.add(patch.entityId);

      // Find all nearby patches that belong to this line
      let addedNew = true;
      while (addedNew) {
        addedNew = false;
        for (const otherPatch of mineralPatches) {
          if (assigned.has(otherPatch.entityId)) continue;

          // Check if close to any patch in the current line
          for (const linePatch of linePatches) {
            const dx = otherPatch.x - linePatch.x;
            const dy = otherPatch.y - linePatch.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= MINERAL_LINE_GROUPING_DISTANCE) {
              linePatches.push(otherPatch);
              assigned.add(otherPatch.entityId);
              addedNew = true;
              break;
            }
          }
        }
      }

      // Calculate center of the mineral line
      let centerX = 0;
      let centerY = 0;
      for (const p of linePatches) {
        centerX += p.x;
        centerY += p.y;
      }
      centerX /= linePatches.length;
      centerY /= linePatches.length;

      // Create label for this mineral line
      const sprite = this.createWorkerLabel();
      this.scene.add(sprite);

      const patchIds = new Set<number>();
      for (const p of linePatches) {
        patchIds.add(p.entityId);
      }

      this.mineralLineLabels.push({
        sprite,
        centerX,
        centerY,
        patchIds,
        lastWorkerCount: -1,
        lastOptimalCount: -1,
      });
    }

    this._mineralLinesBuilt = true;
    debugMesh.log(`[ResourceRenderer] Built ${this.mineralLineLabels.length} mineral line labels from ${mineralPatches.length} patches`);
  }

  /**
   * PERF: Build worker count cache once per frame.
   * Maps resourceId -> number of workers assigned to it.
   * Called once at start of update() instead of scanning workers per label.
   */
  private buildWorkerCountCache(): void {
    this._workerCountCache.clear();
    const units = this.world.getEntitiesWith('Unit');

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.isWorker) continue;
      if (unit.state !== 'gathering') continue;
      if (unit.gatherTargetId !== null) {
        const current = this._workerCountCache.get(unit.gatherTargetId) || 0;
        this._workerCountCache.set(unit.gatherTargetId, current + 1);
      }
    }
  }

  /**
   * Get worker count for a single resource ID from cache.
   */
  private getWorkerCountForResource(resourceId: number): number {
    return this._workerCountCache.get(resourceId) || 0;
  }

  /**
   * Count workers assigned to a set of resource entity IDs using cached counts.
   */
  private countWorkersForResources(resourceIds: Set<number>): number {
    let count = 0;
    for (const resourceId of resourceIds) {
      count += this._workerCountCache.get(resourceId) || 0;
    }
    return count;
  }

  public update(): void {
    // PERF: Build worker count cache once per frame (O(workers) instead of O(workers × labels))
    this.buildWorkerCountCache();

    // PERF: Reuse pre-allocated Set instead of creating new one every frame
    this._currentIds.clear();

    // PERF: Update frustum for culling
    this.updateFrustum();

    // Get entities and check if we need to rebuild sorted cache
    const rawEntities = this.world.getEntitiesWith('Transform', 'Resource');
    const entityCount = rawEntities.length;

    // PERF: Only rebuild sorted entity list when entity count changes
    // TAA requires stable ID-based ordering for velocity tracking
    if (entityCount !== this._lastEntityCount) {
      this._cachedSortedEntities = [...rawEntities].map(e => ({ id: e.id, entity: e })).sort((a, b) => a.id - b.id);
      this._lastEntityCount = entityCount;
    }
    const entities = this._cachedSortedEntities.map(e => e.entity);

    // Reset instance counts
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // PERF: Clear selected resources for instanced selection ring rendering
    this.selectedResources.clear();

    // PERF: Count minerals in single pass instead of separate filter
    let mineralCount = 0;
    for (const entity of entities) {
      const r = entity.get<Resource>('Resource');
      if (r && r.resourceType === 'minerals' && !r.isDepleted()) {
        mineralCount++;
      }
    }

    if (!this._mineralLinesBuilt || Math.abs(mineralCount - this._lastMineralCount) > 2) {
      this.buildMineralLines();
      this._lastMineralCount = mineralCount;
    }

    // Build instance data
    let debugMineralEntities = 0;
    let debugMineralSkippedDepleted = 0;
    let debugMineralAdded = 0;
    const debugMineralPositions: string[] = [];

    for (const entity of entities) {
      this._currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform');
      const resource = entity.get<Resource>('Resource');

      // Skip entities with missing required components (defensive check)
      if (!transform || !resource) continue;

      if (resource.resourceType === 'minerals') {
        debugMineralEntities++;
      }

      // Skip depleted resources
      if (resource.isDepleted()) {
        if (resource.resourceType === 'minerals') {
          debugMineralSkippedDepleted++;
        }
        continue;
      }

      // Skip vespene geysers that have a refinery built on them
      if (resource.resourceType === 'vespene' && resource.hasRefinery()) {
        continue;
      }

      // Get terrain height early for frustum check
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // PERF: Skip resources outside camera frustum (selection rings are instanced)
      if (!this.isInFrustum(transform.x, terrainHeight + 0.5, transform.y)) {
        continue;
      }

      // Calculate LOD level based on distance from camera
      let lodLevel: LODLevel = 0;
      const settings = useUIStore.getState().graphicsSettings;
      if (settings.lodEnabled && this.camera) {
        const dx = transform.x - this.camera.position.x;
        const dz = transform.y - this.camera.position.z;
        const distanceToCamera = Math.sqrt(dx * dx + dz * dz);
        lodLevel = AssetManager.getBestLODForDistance(resource.resourceType, distanceToCamera, {
          LOD0_MAX: settings.lodDistance0,
          LOD1_MAX: settings.lodDistance1,
        });
      }

      const group = this.getOrCreateInstancedGroup(resource.resourceType, lodLevel);
      const data = this.getOrCreateResourceData(entity.id);

      if (resource.resourceType === 'minerals') {
        debugMineralAdded++;
      }

      // terrainHeight already computed above for frustum check

      // PERF: Track selected resources for instanced selection ring rendering
      const selectable = entity.get<Selectable>('Selectable');
      if (selectable?.isSelected) {
        this.selectedResources.set(entity.id, new THREE.Vector3(transform.x, terrainHeight + 0.05, transform.y));
      }

      if (group.mesh.count < group.maxInstances) {
        const instanceIndex = group.mesh.count;
        group.entityIds[instanceIndex] = entity.id;

        // Scale based on remaining amount, including base scale from model
        const amountScale = 0.5 + resource.getPercentRemaining() * 0.5;
        const finalScale = amountScale * group.baseScale;

        // Set instance transform - apply yOffset scaled appropriately
        const yPos = terrainHeight + group.yOffset * amountScale;
        this.tempPosition.set(transform.x, yPos, transform.y);
        // X/Z rotations from model keep it upright
        // Y rotation = model forward offset + per-resource random variety
        const totalYRotation = group.modelYRotation + data.rotation;
        this.tempEuler.set(group.modelXRotation, totalYRotation, group.modelZRotation, 'YXZ');
        this.tempQuaternion.setFromEuler(this.tempEuler);
        this.tempScale.set(finalScale, finalScale, finalScale);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        group.mesh.setMatrixAt(instanceIndex, this.tempMatrix);

        // Collect debug info for first few mineral instances (logged once below)
        if (resource.resourceType === 'minerals' && !this._debugLoggedThisSession && debugMineralPositions.length < 8) {
          debugMineralPositions.push(`(${transform.x.toFixed(0)},${transform.y.toFixed(0)}) h=${terrainHeight.toFixed(1)} s=${finalScale.toFixed(2)}`);
        }

        group.mesh.count++;
      } else if (!this._warnedInstanceLimit.has(resource.resourceType)) {
        // Warn once per resource type if we hit the instance limit
        debugMesh.warn(`[ResourceRenderer] ${resource.resourceType} instance limit (${group.maxInstances}) reached! Some resources will not render.`);
        this._warnedInstanceLimit.add(resource.resourceType);
      }
    }

    // Update mineral line labels
    for (const label of this.mineralLineLabels) {
      // Check if any patches in this line still exist
      let hasPatches = false;
      for (const patchId of label.patchIds) {
        if (this._currentIds.has(patchId)) {
          hasPatches = true;
          break;
        }
      }

      if (!hasPatches) {
        label.sprite.visible = false;
        continue;
      }

      // Count workers assigned to this mineral line
      const currentWorkers = this.countWorkersForResources(label.patchIds);
      const optimalWorkers = label.patchIds.size * OPTIMAL_WORKERS_PER_MINERAL;

      // Position label at center of mineral line
      const terrainHeight = this.terrain?.getHeightAt(label.centerX, label.centerY) ?? 0;
      label.sprite.position.set(label.centerX, terrainHeight + 2.5, label.centerY);

      // Show label if any workers assigned or if mineral line has workers nearby
      const showLabel = currentWorkers > 0;
      label.sprite.visible = showLabel;

      // Update texture only if count changed
      if (showLabel && (currentWorkers !== label.lastWorkerCount || optimalWorkers !== label.lastOptimalCount)) {
        this.updateWorkerLabel(label.sprite, currentWorkers, optimalWorkers);
        label.lastWorkerCount = currentWorkers;
        label.lastOptimalCount = optimalWorkers;
      }
    }

    // Update vespene geyser labels
    for (const entity of entities) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');
      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (!resource.hasExtractor()) continue;

      // Get or create vespene label
      let vespeneLabel = this.vespeneLabels.get(entity.id);
      if (!vespeneLabel) {
        const sprite = this.createWorkerLabel();
        this.scene.add(sprite);
        vespeneLabel = {
          sprite,
          entityId: entity.id,
          lastWorkerCount: -1,
          lastOptimalCount: -1,
        };
        this.vespeneLabels.set(entity.id, vespeneLabel);
      }

      // PERF: Count workers using cached lookup (no Set allocation)
      const currentWorkers = this.getWorkerCountForResource(entity.id);
      const optimalWorkers = OPTIMAL_WORKERS_PER_VESPENE;

      // Position label above the extractor
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;
      vespeneLabel.sprite.position.set(transform.x, terrainHeight + 3.5, transform.y);

      // Always show for extractors (even with 0 workers)
      vespeneLabel.sprite.visible = true;

      // Update texture only if count changed
      if (currentWorkers !== vespeneLabel.lastWorkerCount || optimalWorkers !== vespeneLabel.lastOptimalCount) {
        this.updateWorkerLabel(vespeneLabel.sprite, currentWorkers, optimalWorkers);
        vespeneLabel.lastWorkerCount = currentWorkers;
        vespeneLabel.lastOptimalCount = optimalWorkers;
      }
    }

    // Clean up vespene labels for destroyed extractors
    for (const [entityId, label] of this.vespeneLabels) {
      const entity = this.world.getEntity(entityId);
      const resource = entity?.get<Resource>('Resource');
      if (!entity || !resource || !resource.hasExtractor()) {
        this.scene.remove(label.sprite);
        this.disposeWorkerLabel(label.sprite);
        this.vespeneLabels.delete(entityId);
      }
    }

    // Debug log once per session
    if (!this._debugLoggedThisSession && debugMineralEntities > 0) {
      const mineralGroup = this.instancedGroups.get('minerals');
      const vespeneGroup = this.instancedGroups.get('vespene');
      debugMesh.log(`[ResourceRenderer] === MINERAL DEBUG (one-time) ===`);
      debugMesh.log(`  Entities: ${debugMineralEntities} total, ${debugMineralSkippedDepleted} depleted, ${debugMineralAdded} added to instance`);
      if (mineralGroup) {
        debugMesh.log(`  Minerals instanced: count=${mineralGroup.mesh.count}, baseScale=${mineralGroup.baseScale.toFixed(3)}, yOffset=${mineralGroup.yOffset.toFixed(2)}`);
      }
      if (vespeneGroup) {
        debugMesh.log(`  Vespene instanced: count=${vespeneGroup.mesh.count}, baseScale=${vespeneGroup.baseScale.toFixed(3)}, yOffset=${vespeneGroup.yOffset.toFixed(2)}`);
      }
      debugMesh.log(`  First ${debugMineralPositions.length} mineral positions: ${debugMineralPositions.join(', ')}`);
      debugMesh.log(`[ResourceRenderer] === END DEBUG ===`);
      this._debugLoggedThisSession = true;
    }

    // Mark instance matrices as needing update
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // PERF: Build instanced selection ring matrices
    if (this.selectedResources.size > 0) {
      const selectionMesh = this.getOrCreateSelectionRingMesh();
      let instanceIdx = 0;
      for (const [_entityId, position] of this.selectedResources) {
        if (instanceIdx >= this.MAX_SELECTION_INSTANCES) break;
        this.tempPosition.copy(position);
        this.tempScale.set(1, 1, 1);
        this.tempQuaternion.identity();
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        selectionMesh.setMatrixAt(instanceIdx, this.tempMatrix);
        instanceIdx++;
      }
      selectionMesh.count = instanceIdx;
      selectionMesh.instanceMatrix.needsUpdate = true;
    } else if (this.selectionRingMesh) {
      this.selectionRingMesh.count = 0;
    }

    // Clean up resource data for destroyed entities (selection rings are instanced)
    for (const [entityId] of this.resourceData) {
      if (!this._currentIds.has(entityId)) {
        this.resourceData.delete(entityId);
      }
    }
  }

  /**
   * Dispose a worker label sprite and its resources
   */
  private disposeWorkerLabel(sprite: THREE.Sprite): void {
    const material = sprite.material as THREE.SpriteMaterial;
    if (material.map) {
      material.map.dispose();
    }
    material.dispose();
  }

  public dispose(): void {
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.instancedGroups.clear();

    // Clean up instanced selection ring mesh
    if (this.selectionRingMesh) {
      this.scene.remove(this.selectionRingMesh);
      // Note: geometry and material are shared (selectionGeometry, selectionMaterial)
      this.selectionRingMesh = null;
    }
    this.selectedResources.clear();
    this.resourceData.clear();

    // Clean up mineral line labels
    for (const label of this.mineralLineLabels) {
      this.scene.remove(label.sprite);
      this.disposeWorkerLabel(label.sprite);
    }
    this.mineralLineLabels = [];

    // Clean up vespene labels
    for (const label of this.vespeneLabels.values()) {
      this.scene.remove(label.sprite);
      this.disposeWorkerLabel(label.sprite);
    }
    this.vespeneLabels.clear();

    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
  }
}
