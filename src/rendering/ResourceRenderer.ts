import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Resource, OPTIMAL_WORKERS_PER_MINERAL, OPTIMAL_WORKERS_PER_VESPENE } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Terrain } from './Terrain';
import AssetManager from '@/assets/AssetManager';
import { debugMesh } from '@/utils/debugLogger';

interface InstancedResourceGroup {
  mesh: THREE.InstancedMesh;
  resourceType: string;
  maxInstances: number;
  entityIds: number[];
  rotations: number[]; // Store random rotations per instance
  yOffset: number; // Y offset from model normalization (to ground the model)
  baseScale: number; // Base scale from model normalization
}

// Track per-resource rotation and selection ring (no individual labels)
interface ResourceData {
  rotation: number;
  lastScale: number;
  selectionRing: THREE.Mesh | null;
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

  // Selection ring resources
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3();
  private tempEuler: THREE.Euler = new THREE.Euler();

  // Debug tracking
  private _lastMineralCount: number = 0;
  private _debugLoggedThisSession: boolean = false;
  private _warnedInstanceLimit: Set<string> = new Set();
  private _mineralLinesBuilt: boolean = false;

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
   * Get or create an instanced mesh group for a resource type
   */
  private getOrCreateInstancedGroup(resourceType: string): InstancedResourceGroup {
    let group = this.instancedGroups.get(resourceType);

    if (!group) {
      // Get the base mesh from AssetManager
      const baseMesh = AssetManager.getResourceMesh(resourceType as 'minerals' | 'vespene');

      // Find the actual mesh geometry, material, and extract transforms from the model
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      let yOffset = 0;
      let baseScale = 1;

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
          // Walk up the parent chain to accumulate transforms
          let obj: THREE.Object3D | null = child;
          while (obj && obj !== baseMesh) {
            yOffset += obj.position.y * (obj.parent?.scale.y ?? 1);
            baseScale *= obj.scale.y;
            obj = obj.parent;
          }
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
      instancedMesh.castShadow = true;
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
        maxInstances: MAX_RESOURCES_PER_TYPE,
        entityIds: [],
        rotations: [],
        yOffset,
        baseScale,
      };

      this.instancedGroups.set(resourceType, group);
    }

    return group;
  }

  /**
   * Get or create per-resource data (rotation, selection ring)
   */
  private getOrCreateResourceData(entityId: number): ResourceData {
    let data = this.resourceData.get(entityId);
    if (!data) {
      // Create selection ring
      const selectionRing = new THREE.Mesh(this.selectionGeometry, this.selectionMaterial);
      selectionRing.rotation.x = -Math.PI / 2;
      selectionRing.visible = false;
      this.scene.add(selectionRing);

      data = {
        rotation: Math.random() * Math.PI * 2,
        lastScale: 1,
        selectionRing,
      };
      this.resourceData.set(entityId, data);
    }
    return data;
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
   * Count workers assigned to a set of resource entity IDs.
   * Counts by worker's gatherTargetId, so workers returning to CC still count.
   */
  private countWorkersForResources(resourceIds: Set<number>): number {
    let count = 0;
    const units = this.world.getEntitiesWith('Unit');

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      if (!unit || !unit.isWorker) continue;
      if (unit.state !== 'gathering') continue;
      if (unit.gatherTargetId !== null && resourceIds.has(unit.gatherTargetId)) {
        count++;
      }
    }

    return count;
  }

  public update(): void {
    const entities = this.world.getEntitiesWith('Transform', 'Resource');
    const currentIds = new Set<number>();

    // Reset instance counts
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // Build mineral lines on first frame or when minerals change significantly
    const mineralCount = [...entities].filter(e => {
      const r = e.get<Resource>('Resource');
      return r && r.resourceType === 'minerals' && !r.isDepleted();
    }).length;

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
      currentIds.add(entity.id);

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

      const group = this.getOrCreateInstancedGroup(resource.resourceType);
      const data = this.getOrCreateResourceData(entity.id);

      if (resource.resourceType === 'minerals') {
        debugMineralAdded++;
      }

      // Get terrain height
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update selection ring
      const selectable = entity.get<Selectable>('Selectable');
      if (data.selectionRing) {
        data.selectionRing.position.set(transform.x, terrainHeight + 0.05, transform.y);
        data.selectionRing.visible = selectable?.isSelected ?? false;
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
        this.tempEuler.set(0, data.rotation, 0);
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
        if (currentIds.has(patchId)) {
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

      // Count workers assigned to this geyser
      const resourceIds = new Set([entity.id]);
      const currentWorkers = this.countWorkersForResources(resourceIds);
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

    // Clean up resource data for destroyed entities
    for (const [entityId, data] of this.resourceData) {
      if (!currentIds.has(entityId)) {
        if (data.selectionRing) {
          this.scene.remove(data.selectionRing);
        }
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

    // Clean up selection rings
    for (const data of this.resourceData.values()) {
      if (data.selectionRing) {
        this.scene.remove(data.selectionRing);
      }
    }
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
