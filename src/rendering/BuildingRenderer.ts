import * as THREE from 'three';
import type { IWorldProvider, IEntity } from '@/engine/ecs/IWorldProvider';
import { Transform } from '@/engine/components/Transform';
import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager, REFERENCE_FRAME, LODLevel } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import { debugMesh } from '@/utils/debugLogger';
import { CullingService, EntityCategory } from './services/CullingService';
import {
  BUILDING_RENDERER,
  BUILDING_SELECTION_RING,
  RENDER_ORDER,
} from '@/data/rendering.config';
import {
  createConstructingMaterial,
  createFireMaterial,
  createSmokeMaterial,
  createConstructionDustMaterial,
  createConstructionSparkMaterial,
  createThrusterCoreMaterial,
  createThrusterGlowMaterial,
  createBlueprintLineMaterial,
  createBlueprintPulseMaterial,
  createBlueprintScanMaterial,
  createGroundDustMaterial,
  createMetalDebrisMaterial,
  createWeldingFlashMaterial,
  createScaffoldWireframeMaterial,
  createScaffoldPoleMaterial,
  createScaffoldBeamMaterial,
  createFireGeometry,
  createScaffoldPoleGeometry,
  createScaffoldBeamGeometry,
  createScaffoldDiagonalGeometry,
} from './tsl/BuildingMaterials';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// Shared rendering utilities
import {
  SelectionRingRenderer,
  TransformUtils,
  EntityIdTracker,
} from './shared';
// NOTE: Buildings don't move, so we don't use velocity tracking (AAA optimization)
// Velocity node returns zero for meshes without velocity attributes

interface BuildingMeshData {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  progressBar: THREE.Group;
  buildingId: string;
  // PERFORMANCE: Track completion state to avoid traverse() every frame
  wasComplete: boolean;
  // PERF: Cached mesh children to avoid traverse() calls during construction animations
  cachedMeshChildren: THREE.Mesh[];
  // Fire effect for damaged buildings
  fireEffect: THREE.Group | null;
  lastHealthPercent: number;
  // Construction effect (dust particles at build height)
  constructionEffect: THREE.Group | null;
  buildingHeight: number; // Stored for clipping calculation
  // Thruster effect for flying buildings
  thrusterEffect: THREE.Group | null;
  // Blueprint effect for waiting_for_worker state (holographic preview)
  blueprintEffect: THREE.Group | null;
  // Ground dust effect for construction
  groundDustEffect: THREE.Group | null;
  // Scaffold effect (thick poles and beams)
  scaffoldEffect: THREE.Group | null;
  // Clipping plane for construction reveal
  clippingPlane: THREE.Plane | null;
  // PERF: Cached terrain height to avoid recalculation every frame
  cachedTerrainHeight: number;
  lastX: number;
  lastY: number;
}

// Instanced building group for same-type completed buildings at a specific LOD level
interface InstancedBuildingGroup {
  mesh: THREE.InstancedMesh;
  buildingType: string;
  playerId: string;
  lodLevel: LODLevel; // Which LOD level this group represents
  maxInstances: number;
  entityIds: number[];
  dummy: THREE.Object3D;
  // CRITICAL: Track model scale to apply to instances (custom models are normalized with scale)
  modelScale: THREE.Vector3;
  // CRITICAL: Track model Y offset for proper grounding (models have position.y set to anchor bottom at y=0)
  modelYOffset: number;
  // CRITICAL: Track model rotation to apply to instances (captures all parent rotations from model hierarchy)
  modelQuaternion: THREE.Quaternion;
}

// Constants from centralized config
const MAX_BUILDING_INSTANCES_PER_TYPE = BUILDING_RENDERER.MAX_INSTANCES_PER_TYPE;
const MAX_SELECTION_RING_INSTANCES = BUILDING_RENDERER.MAX_SELECTION_RING_INSTANCES;

/**
 * Clone geometry with completely fresh GPU buffers for WebGPU.
 * Creates new TypedArrays for all attributes and index to ensure zero shared state
 * with the source geometry. This prevents "setIndexBuffer" crashes when source
 * geometry is disposed while clones are still being rendered.
 * Also ensures required attributes (like UVs) exist to prevent "Vertex buffer slot" errors.
 */
function cloneGeometryForGPU(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const cloned = new THREE.BufferGeometry();

  // Copy all attributes with fresh TypedArrays (no shared references)
  for (const name of Object.keys(source.attributes)) {
    const srcAttr = source.attributes[name];
    // Create a completely new TypedArray by slicing (creates a copy)
    const newArray = srcAttr.array.slice(0);
    const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
    newAttr.needsUpdate = true;
    cloned.setAttribute(name, newAttr);
  }

  // Copy index with fresh TypedArray if present
  if (source.index) {
    const srcIndex = source.index;
    const newIndexArray = srcIndex.array.slice(0);
    const newIndex = new THREE.BufferAttribute(newIndexArray, srcIndex.itemSize, srcIndex.normalized);
    newIndex.needsUpdate = true;
    cloned.setIndex(newIndex);
  }

  // Copy morph attributes if present
  if (source.morphAttributes) {
    for (const name of Object.keys(source.morphAttributes)) {
      const srcMorphArray = source.morphAttributes[name];
      cloned.morphAttributes[name] = srcMorphArray.map(srcAttr => {
        const newArray = srcAttr.array.slice(0);
        const newAttr = new THREE.BufferAttribute(newArray, srcAttr.itemSize, srcAttr.normalized);
        newAttr.needsUpdate = true;
        return newAttr;
      });
    }
  }

  // Copy bounding volumes if computed
  if (source.boundingBox) {
    cloned.boundingBox = source.boundingBox.clone();
  }
  if (source.boundingSphere) {
    cloned.boundingSphere = source.boundingSphere.clone();
  }

  // Copy groups
  for (const group of source.groups) {
    cloned.addGroup(group.start, group.count, group.materialIndex);
  }

  // Ensure UV coordinates exist - required by many shaders (slot 1)
  // Some models from Tripo/Meshy AI lack UVs, causing "Vertex buffer slot 1" errors
  if (!cloned.attributes.uv && cloned.attributes.position) {
    const posCount = cloned.attributes.position.count;
    const uvArray = new Float32Array(posCount * 2);
    // Generate basic UV coords based on position (simple projection)
    const pos = cloned.attributes.position;
    for (let i = 0; i < posCount; i++) {
      uvArray[i * 2] = pos.getX(i) * 0.5 + 0.5;
      uvArray[i * 2 + 1] = pos.getZ(i) * 0.5 + 0.5;
    }
    cloned.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }

  return cloned;
}

export class BuildingRenderer {
  private scene: THREE.Scene;
  private world: IWorldProvider;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string | null = null;
  private buildingMeshes: Map<number, BuildingMeshData> = new Map();

  // PERFORMANCE: Instanced mesh groups for completed static buildings
  private instancedGroups: Map<string, InstancedBuildingGroup> = new Map();

  // PERF: Shared selection ring renderer (instanced, reduces draw calls)
  private selectionRingRenderer: SelectionRingRenderer;

  // PERF: Shared transform utilities (reusable temp objects)
  private readonly transformUtils: TransformUtils = new TransformUtils();

  // PERF: Pre-allocated entity ID tracker to avoid per-frame allocation
  private readonly entityIdTracker: EntityIdTracker = new EntityIdTracker();

  // Camera reference and shared culling service
  private camera: THREE.Camera | null = null;
  private cullingService: CullingService | null = null;

  // PERF: Cached sorted entity list to avoid spread+sort every frame
  private cachedSortedEntities: IEntity[] = [];
  private cachedEntityCount: number = -1;

  // Shared materials
  private constructingMaterial: THREE.MeshStandardMaterial;
  private fireMaterial: THREE.MeshBasicMaterial;
  private smokeMaterial: THREE.MeshBasicMaterial;
  private fireGeometry: THREE.ConeGeometry;
  private constructionDustMaterial: THREE.PointsMaterial;
  private constructionSparkMaterial: THREE.PointsMaterial;
  private thrusterCoreMaterial: THREE.PointsMaterial;
  private thrusterGlowMaterial: THREE.PointsMaterial;

  // Blueprint holographic effect materials
  private blueprintLineMaterial: THREE.LineBasicMaterial;
  private blueprintPulseMaterial: THREE.PointsMaterial;
  private blueprintScanMaterial: THREE.MeshBasicMaterial;
  // Ground dust effect material
  private groundDustMaterial: THREE.PointsMaterial;
  // Metal debris material
  private metalDebrisMaterial: THREE.PointsMaterial;
  // Welding flash material
  private weldingFlashMaterial: THREE.PointsMaterial;
  // Scaffold material
  private scaffoldMaterial: THREE.LineBasicMaterial;
  // PERF: Pre-created scaffold mesh materials (shared across all scaffolds)
  private scaffoldPoleMaterial: THREE.MeshBasicMaterial;
  private scaffoldBeamMaterial: THREE.MeshBasicMaterial;
  // PERF: Pre-created cylinder geometries for scaffolds (reused)
  private scaffoldPoleGeometry: THREE.CylinderGeometry;
  private scaffoldBeamGeometry: THREE.CylinderGeometry;
  private scaffoldDiagonalGeometry: THREE.CylinderGeometry;

  // Animation time for effects
  private fireAnimTime: number = 0;
  private constructionAnimTime: number = 0;
  private blueprintPulseTime: number = 0;

  // Frame counter for quarantine timing
  private frameCount: number = 0;

  // Geometry disposal quarantine - prevents WebGPU "setIndexBuffer" crashes
  // by delaying geometry disposal until GPU has finished pending draw commands.
  // WebGPU typically has 2-3 frames in flight; 4 frames provides safety margin.
  private static readonly GEOMETRY_QUARANTINE_FRAMES = 4;
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  // Fallback elevation heights when terrain isn't available
  private static readonly ELEVATION_HEIGHTS = BUILDING_RENDERER.ELEVATION_HEIGHTS;

  constructor(scene: THREE.Scene, world: IWorldProvider, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    // Materials created via factory functions
    this.constructingMaterial = createConstructingMaterial();

    // Initialize shared selection ring renderer
    this.selectionRingRenderer = new SelectionRingRenderer(scene, {
      innerRadius: BUILDING_SELECTION_RING.INNER_RADIUS,
      outerRadius: BUILDING_SELECTION_RING.OUTER_RADIUS,
      segments: BUILDING_SELECTION_RING.SEGMENTS,
      opacity: BUILDING_SELECTION_RING.OPACITY,
      maxInstances: MAX_SELECTION_RING_INSTANCES,
    });

    // Fire effect materials
    this.fireMaterial = createFireMaterial();
    this.smokeMaterial = createSmokeMaterial();
    this.fireGeometry = createFireGeometry();

    // Particle materials
    this.constructionDustMaterial = createConstructionDustMaterial();
    this.constructionSparkMaterial = createConstructionSparkMaterial();
    this.thrusterCoreMaterial = createThrusterCoreMaterial();
    this.thrusterGlowMaterial = createThrusterGlowMaterial();

    // Blueprint holographic effect materials
    this.blueprintLineMaterial = createBlueprintLineMaterial();
    this.blueprintPulseMaterial = createBlueprintPulseMaterial();
    this.blueprintScanMaterial = createBlueprintScanMaterial();

    // Additional particle materials
    this.groundDustMaterial = createGroundDustMaterial();
    this.metalDebrisMaterial = createMetalDebrisMaterial();
    this.weldingFlashMaterial = createWeldingFlashMaterial();

    // Scaffold materials and geometries
    this.scaffoldMaterial = createScaffoldWireframeMaterial();
    this.scaffoldPoleMaterial = createScaffoldPoleMaterial();
    this.scaffoldBeamMaterial = createScaffoldBeamMaterial();
    this.scaffoldPoleGeometry = createScaffoldPoleGeometry();
    this.scaffoldBeamGeometry = createScaffoldBeamGeometry();
    this.scaffoldDiagonalGeometry = createScaffoldDiagonalGeometry();

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
    debugMesh.log('[BuildingRenderer] Refreshing all building meshes...');
    for (const [entityId, meshData] of this.buildingMeshes) {
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
      // Only dispose materials, NOT geometry (geometry is shared with asset cache)
      this.disposeMaterialsOnly(meshData.group);
    }
    this.buildingMeshes.clear();

    // Clear instanced groups - use quarantine to prevent WebGPU crashes
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      // Queue geometry and materials for delayed disposal
      const materials = group.mesh.material;
      this.queueGeometryForDisposal(group.mesh.geometry, materials);
    }
    this.instancedGroups.clear();
    // Meshes will be recreated on next update() call
  }

  /**
   * Get or create an instanced mesh group for a building type + player combo.
   * Used for completed, non-selected, non-damaged buildings.
   */
  private getOrCreateInstancedGroup(buildingType: string, playerId: string, lodLevel: LODLevel = 0): InstancedBuildingGroup {
    const key = `${buildingType}_${playerId}_LOD${lodLevel}`;
    let group = this.instancedGroups.get(key);

    if (!group) {
      const playerColor = getPlayerColor(playerId);
      // Get the base mesh at the requested LOD level, falling back to next best
      const baseMesh = AssetManager.getModelAtLOD(buildingType, lodLevel)
        ?? AssetManager.getBuildingMesh(buildingType, playerColor);

      // Find geometry, material, and world transforms from the base mesh
      // CRITICAL: Custom models have scale/rotation applied to Object3D, not geometry vertices
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      const modelScale = new THREE.Vector3(1, 1, 1);
      const modelPosition = new THREE.Vector3();
      const modelQuaternion = new THREE.Quaternion();

      // Update world matrices to get accurate world transforms
      baseMesh.updateMatrixWorld(true);

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          // Clone geometry with proper GPU buffer initialization to prevent WebGPU crashes.
          // Without cloning and setting needsUpdate, disposing this mesh would invalidate
          // GPU buffers still used by other meshes, causing "setIndexBuffer" errors.
          geometry = cloneGeometryForGPU(child.geometry);
          material = child.material;
          // Get the world scale of this mesh (includes parent scales from normalization)
          child.getWorldScale(modelScale);
          // Get the world position of this mesh (includes Y offset for grounding)
          child.getWorldPosition(modelPosition);
          // Get the world rotation of this mesh (includes MODEL_FORWARD_OFFSET and any parent rotations)
          child.getWorldQuaternion(modelQuaternion);
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
      // Buildings render AFTER ground effects but BEFORE damage numbers
      instancedMesh.renderOrder = RENDER_ORDER.UNIT;

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        buildingType,
        playerId,
        lodLevel,
        maxInstances: MAX_BUILDING_INSTANCES_PER_TYPE,
        entityIds: [],
        dummy: new THREE.Object3D(),
        modelScale, // Store the model's world scale for proper instance sizing
        modelYOffset: modelPosition.y, // Store Y offset for proper grounding
        modelQuaternion, // Store the model's world rotation for proper orientation
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
    // Note: In worker mode, components are plain objects, not class instances
    if (building.state !== 'complete') return false;
    if (selectable?.isSelected) return false;
    if (health && (health.current / health.max) < 1) return false;
    // Buildings with production queue shouldn't use instancing (need progress bar)
    if (building.productionQueue.length > 0) return false;
    // Flying buildings need individual rendering for height offset
    if (building.isFlying) return false;
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
   * PERF: Reset materials using cached mesh children (avoids traverse overhead)
   */
  private resetBuildingMaterialsCached(meshChildren: THREE.Mesh[]): void {
    for (const mesh of meshChildren) {
      this.setMaterialOpacity(mesh, 1, false);
    }
  }

  /**
   * PERF: Set opacity on cached mesh children (avoids traverse overhead)
   */
  private setOpacityOnCachedMeshes(meshChildren: THREE.Mesh[], opacity: number, transparent: boolean): void {
    for (const mesh of meshChildren) {
      this.setMaterialOpacity(mesh, opacity, transparent);
    }
  }

  /**
   * PERF: Clear clipping planes on cached mesh children (avoids traverse overhead)
   */
  private clearClippingPlanesOnCachedMeshes(meshChildren: THREE.Mesh[]): void {
    for (const mesh of meshChildren) {
      const mat = mesh.material as THREE.Material;
      if (mat) {
        mat.clippingPlanes = null;
        mat.needsUpdate = true;
      }
    }
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
   * Set camera reference for LOD calculations
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Set shared culling service (created by UnitRenderer, shared with BuildingRenderer)
   */
  public setCullingService(cullingService: CullingService): void {
    this.cullingService = cullingService;
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

  // TEMP: Frame counter for debugging
  private debugFrameCount = 0;

  public update(deltaTime: number = 16): void {
    const dt = deltaTime / 1000;
    this.fireAnimTime += dt;
    this.constructionAnimTime += dt;
    this.blueprintPulseTime += dt;
    this.debugFrameCount++;
    this.frameCount++;

    // Process quarantined geometries at the START of each frame
    // This ensures GPU has finished with disposed buffers before we free them
    this.processGeometryQuarantine();

    // Selection ring animation is handled by shared global time uniform
    // (updated by UnitRenderer.update via updateSelectionRingTime)

    // TAA: Sort entities by ID for stable instance ordering
    // This ensures previous/current matrix pairs are aligned correctly for velocity
    // PERF: Only re-sort when entity count changes (add/remove) to avoid O(n log n) every frame
    const rawEntities = this.world.getEntitiesWith('Transform', 'Building');


    if (rawEntities.length !== this.cachedEntityCount) {
      // Rebuild cache - entity count changed (add/remove occurred)
      this.cachedSortedEntities.length = 0;
      for (let i = 0; i < rawEntities.length; i++) {
        this.cachedSortedEntities.push(rawEntities[i]);
      }
      this.cachedSortedEntities.sort((a, b) => a.id - b.id);
      this.cachedEntityCount = rawEntities.length;
    }
    const entities = this.cachedSortedEntities;
    // PERF: Reuse pre-allocated entity ID tracker
    this.entityIdTracker.reset();

    // Reset instanced group counts
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // PERF: Reset instanced selection ring groups
    this.selectionRingRenderer.resetInstances();

    // Track which buildings use instancing (to skip individual mesh handling)
    const instancedBuildingIds = new Set<number>();

    for (const entity of entities) {
      this.entityIdTracker.add(entity.id);

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

      // PERF: Get cached terrain height (buildings rarely move)
      let meshData = this.buildingMeshes.get(entity.id);
      let terrainHeight: number;
      if (meshData) {
        // Use cached height if position hasn't changed
        const dx = Math.abs(transform.x - meshData.lastX);
        const dy = Math.abs(transform.y - meshData.lastY);
        if (dx < 0.01 && dy < 0.01) {
          terrainHeight = meshData.cachedTerrainHeight;
        } else {
          terrainHeight = this.getTerrainHeightAt(transform.x, transform.y);
          meshData.cachedTerrainHeight = terrainHeight;
          meshData.lastX = transform.x;
          meshData.lastY = transform.y;
        }
      } else {
        terrainHeight = this.getTerrainHeightAt(transform.x, transform.y);
      }
      const buildingHeight = Math.max(building.width, building.height) + 2; // Approximate height

      // Register building with culling service and update transform
      if (this.cullingService) {
        if (!this.cullingService.isRegistered(entity.id)) {
          this.cullingService.registerEntity(entity.id, building.buildingId, ownerId, EntityCategory.Building);
          this.cullingService.markStatic(entity.id); // Buildings don't move
        }
        this.cullingService.updateTransform(entity.id, transform.x, terrainHeight + buildingHeight / 2, transform.y, 0, 1);
      }

      // PERF: Skip buildings outside camera frustum (using proper sphere-frustum intersection)
      if (this.cullingService && !this.cullingService.isVisible(entity.id)) {
        // Hide existing mesh but keep building tracked
        const existingMesh = this.buildingMeshes.get(entity.id);
        if (existingMesh) {
          existingMesh.group.visible = false;
          existingMesh.selectionRing.visible = false;
          existingMesh.healthBar.visible = false;
          existingMesh.progressBar.visible = false;
        }
        continue;
      }

      // PERFORMANCE: Try to use instanced rendering for completed static buildings
      if (shouldShow && this.canUseInstancing(building, health, selectable)) {
        // Calculate LOD level based on distance from camera
        let lodLevel: LODLevel = 0;
        const settings = useUIStore.getState().graphicsSettings;
        if (settings.lodEnabled && this.camera) {
          const dx = transform.x - this.camera.position.x;
          const dz = transform.y - this.camera.position.z;
          const distanceToCamera = Math.sqrt(dx * dx + dz * dz);
          lodLevel = AssetManager.getBestLODForDistance(building.buildingId, distanceToCamera, {
            LOD0_MAX: settings.lodDistance0,
            LOD1_MAX: settings.lodDistance1,
          });
        }

        const group = this.getOrCreateInstancedGroup(building.buildingId, ownerId, lodLevel);

        if (group.mesh.count < group.maxInstances) {
          // terrainHeight already computed above for frustum check

          // Set instance matrix - CRITICAL: Use model's world transforms from normalization
          // The Y offset ensures buildings are properly grounded (bottom at terrain level)
          // The quaternion captures the full rotation including MODEL_FORWARD_OFFSET and any parent rotations
          this.transformUtils.tempPosition.set(transform.x, terrainHeight + group.modelYOffset, transform.y);
          this.transformUtils.tempScale.copy(group.modelScale);
          this.transformUtils.tempQuaternion.copy(group.modelQuaternion);
          this.transformUtils.tempMatrix.compose(this.transformUtils.tempPosition, this.transformUtils.tempQuaternion, this.transformUtils.tempScale);
          group.mesh.setMatrixAt(group.mesh.count, this.transformUtils.tempMatrix);
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

            // CRITICAL: Clean up all construction effects when switching to instancing
            if (existingMesh.constructionEffect) {
              this.scene.remove(existingMesh.constructionEffect);
              this.disposeGroup(existingMesh.constructionEffect);
              existingMesh.constructionEffect = null;
            }
            if (existingMesh.scaffoldEffect) {
              this.scene.remove(existingMesh.scaffoldEffect);
              this.disposeGroup(existingMesh.scaffoldEffect);
              existingMesh.scaffoldEffect = null;
            }
            if (existingMesh.groundDustEffect) {
              this.scene.remove(existingMesh.groundDustEffect);
              this.disposeGroup(existingMesh.groundDustEffect);
              existingMesh.groundDustEffect = null;
            }
            if (existingMesh.blueprintEffect) {
              this.scene.remove(existingMesh.blueprintEffect);
              this.disposeGroup(existingMesh.blueprintEffect);
              existingMesh.blueprintEffect = null;
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

      // PERF: meshData already retrieved above for terrain height caching

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
        meshData.wasComplete = building.state === 'complete';
        // PERF: Initialize cached terrain height
        meshData.cachedTerrainHeight = terrainHeight;
        meshData.lastX = transform.x;
        meshData.lastY = transform.y;
        this.buildingMeshes.set(entity.id, meshData);
        this.scene.add(meshData.group);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
        this.scene.add(meshData.progressBar);

        // If building is already complete, ensure materials are correct immediately
        if (building.state === 'complete') {
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

      // terrainHeight already computed above for frustum check

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
        // PERF: Use cached mesh children to avoid traverse()
        this.resetBuildingMaterialsCached(meshData.cachedMeshChildren);

        // Remove clipping planes from materials - PERF: Use cached mesh children
        if (meshData.clippingPlane) {
          this.clearClippingPlanesOnCachedMeshes(meshData.cachedMeshChildren);
          meshData.clippingPlane = null;
        }

        // Remove construction effect if present
        if (meshData.constructionEffect) {
          this.scene.remove(meshData.constructionEffect);
          this.disposeGroup(meshData.constructionEffect);
          meshData.constructionEffect = null;
        }
        // Remove blueprint effect if present
        if (meshData.blueprintEffect) {
          this.scene.remove(meshData.blueprintEffect);
          this.disposeGroup(meshData.blueprintEffect);
          meshData.blueprintEffect = null;
        }
        // Remove ground dust effect if present
        if (meshData.groundDustEffect) {
          this.scene.remove(meshData.groundDustEffect);
          this.disposeGroup(meshData.groundDustEffect);
          meshData.groundDustEffect = null;
        }
        // Remove scaffold effect if present
        if (meshData.scaffoldEffect) {
          this.scene.remove(meshData.scaffoldEffect);
          this.disposeGroup(meshData.scaffoldEffect);
          meshData.scaffoldEffect = null;
        }
        meshData.wasComplete = true;
      } else if (isWaitingForWorker) {
        // Waiting for worker - show holographic blueprint effect
        meshData.group.scale.setScalar(1);

        // Pulse opacity for holographic effect - PERF: Use cached mesh children
        const pulseOpacity = 0.25 + Math.sin(this.blueprintPulseTime * 3) * 0.1;
        this.setOpacityOnCachedMeshes(meshData.cachedMeshChildren, pulseOpacity, true);

        // Hide construction effect while waiting
        if (meshData.constructionEffect) {
          meshData.constructionEffect.visible = false;
        }

        // Hide ground dust while waiting
        if (meshData.groundDustEffect) {
          meshData.groundDustEffect.visible = false;
        }

        // Hide scaffold while waiting
        if (meshData.scaffoldEffect) {
          meshData.scaffoldEffect.visible = false;
        }

        // Create/show blueprint effect
        if (!meshData.blueprintEffect) {
          meshData.blueprintEffect = this.createBlueprintEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.blueprintEffect);
        }
        meshData.blueprintEffect.visible = true;
        meshData.blueprintEffect.position.set(transform.x, terrainHeight, transform.y);
        this.updateBlueprintEffect(meshData.blueprintEffect, dt, meshData.buildingHeight);
      } else if (isPaused) {
        // Construction paused - show partially built state with blueprint effect
        const progress = building.buildProgress;

        // Same Y-scale approach as constructing state
        const yScale = Math.max(0.05, progress);
        const yOffset = meshData.buildingHeight * (1 - yScale) * 0.5;

        meshData.group.scale.set(1, yScale, 1);
        meshData.group.position.set(transform.x, terrainHeight - yOffset, transform.y);

        // Slightly more transparent when paused to indicate inactive state
        // PERF: Use cached mesh children
        const opacity = 0.4 + progress * 0.4;
        this.setOpacityOnCachedMeshes(meshData.cachedMeshChildren, opacity, true);

        // Hide construction particles when paused (no active construction)
        if (meshData.constructionEffect) {
          meshData.constructionEffect.visible = false;
        }

        // Hide ground dust when paused
        if (meshData.groundDustEffect) {
          meshData.groundDustEffect.visible = false;
        }

        // Show blueprint effect when paused - indicates building needs worker to resume
        if (!meshData.blueprintEffect) {
          meshData.blueprintEffect = this.createBlueprintEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.blueprintEffect);
        }
        meshData.blueprintEffect.visible = true;
        meshData.blueprintEffect.position.set(transform.x, terrainHeight, transform.y);
        this.updateBlueprintEffect(meshData.blueprintEffect, dt, meshData.buildingHeight);

        // Hide scaffold when paused - only visible during ACTIVE construction
        if (meshData.scaffoldEffect) {
          meshData.scaffoldEffect.visible = false;
        }
      } else {
        // Construction in progress (state === 'constructing')
        // Building grows from bottom to top using Y-scale with proper positioning
        const progress = building.buildProgress;

        // Scale building from bottom up
        const yScale = Math.max(0.05, progress);

        // Position building so bottom stays at ground level as it grows
        // Building mesh origin is at center, so we offset to keep bottom grounded
        const yOffset = meshData.buildingHeight * (1 - yScale) * 0.5;

        meshData.group.scale.set(1, yScale, 1);
        meshData.group.position.set(transform.x, terrainHeight - yOffset, transform.y);

        // Building becomes more opaque as construction progresses
        // PERF: Use cached mesh children
        const opacity = 0.5 + progress * 0.5;
        this.setOpacityOnCachedMeshes(meshData.cachedMeshChildren, opacity, true);

        // Clear any clipping planes - PERF: Use cached mesh children
        if (meshData.clippingPlane) {
          this.clearClippingPlanesOnCachedMeshes(meshData.cachedMeshChildren);
          meshData.clippingPlane = null;
        }

        // Hide blueprint effect during active construction
        if (meshData.blueprintEffect) {
          meshData.blueprintEffect.visible = false;
        }

        // Create/update construction effect (enhanced with welding, sparks, debris)
        if (!meshData.constructionEffect) {
          meshData.constructionEffect = this.createConstructionEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.constructionEffect);
        }

        // Position construction particles at the current build height (top of visible building)
        const buildHeight = meshData.buildingHeight * progress;
        meshData.constructionEffect.visible = true;
        meshData.constructionEffect.position.set(transform.x, terrainHeight + buildHeight, transform.y);
        this.updateConstructionEffect(meshData.constructionEffect, dt, building.width, building.height);

        // Create/update ground dust effect (billowing dust at base)
        if (!meshData.groundDustEffect) {
          meshData.groundDustEffect = this.createGroundDustEffect(building.width, building.height);
          this.scene.add(meshData.groundDustEffect);
        }
        meshData.groundDustEffect.visible = true;
        meshData.groundDustEffect.position.set(transform.x, terrainHeight, transform.y);
        this.updateGroundDustEffect(meshData.groundDustEffect, dt, building.width, building.height, progress);

        // Create/update scaffold effect (visible during early construction)
        if (!meshData.scaffoldEffect) {
          meshData.scaffoldEffect = this.createScaffoldEffect(building.width, building.height, meshData.buildingHeight);
          this.scene.add(meshData.scaffoldEffect);
        }
        // Scaffold fades out as building gets more complete
        meshData.scaffoldEffect.visible = progress < 0.8;
        if (meshData.scaffoldEffect.visible) {
          meshData.scaffoldEffect.position.set(transform.x, terrainHeight, transform.y);
          // Fade scaffold opacity as construction progresses
          this.updateScaffoldOpacity(meshData.scaffoldEffect, Math.max(0.3, 1.0 - progress));
        }
      }

      // PERF: Add selected buildings to instanced selection ring renderer
      // Hide individual selection ring - we use instanced rendering instead
      const ringSize = Math.max(building.width, building.height) * 0.9;
      meshData.selectionRing.visible = false; // Always hide individual ring
      if (selectable?.isSelected) {
        this.selectionRingRenderer.addInstance({
          entityId: entity.id,
          position: new THREE.Vector3(transform.x, terrainHeight + flyingOffset + 0.05, transform.y),
          scale: ringSize,
          isOwned,
        });
      }

      // Update health bar and fire effects (for all non-constructing states)
      if (health && shouldShowComplete) {
        // Note: In worker mode, components are plain objects, not class instances
        const healthPercent = health.current / health.max;
        // Use the actual 3D model height (meshData.buildingHeight) instead of grid cells (building.height)
        meshData.healthBar.position.set(transform.x, terrainHeight + meshData.buildingHeight + flyingOffset + 0.5, transform.y);
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
      // Position above health bar to avoid overlap (health bar is at +0.5, progress at +0.75)
      // Use the actual 3D model height (meshData.buildingHeight) instead of grid cells (building.height)
      if (isOwned) {
        if (building.state !== 'complete') {
          meshData.progressBar.position.set(transform.x, terrainHeight + meshData.buildingHeight + flyingOffset + 0.75, transform.y);
          meshData.progressBar.visible = true;
          this.updateProgressBar(meshData.progressBar, building.buildProgress, true);
          // Billboard: make progress bar face the camera
          if (this.camera) {
            meshData.progressBar.lookAt(this.camera.position);
          }
        } else if (building.productionQueue.length > 0) {
          meshData.progressBar.position.set(transform.x, terrainHeight + meshData.buildingHeight + flyingOffset + 0.75, transform.y);
          meshData.progressBar.visible = true;
          // Note: In worker mode, components are plain objects
          const productionProgress = building.productionQueue[0]?.progress ?? 0;
          this.updateProgressBar(meshData.progressBar, productionProgress, false);
          // Billboard: make progress bar face the camera
          if (this.camera) {
            meshData.progressBar.lookAt(this.camera.position);
          }
        } else {
          meshData.progressBar.visible = false;
        }
      } else {
        meshData.progressBar.visible = false;
      }
    }

    // PERF: Commit instanced selection ring matrices (built via addInstance calls above)
    this.selectionRingRenderer.commitInstances();

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.buildingMeshes) {
      if (!this.entityIdTracker.has(entityId)) {
        // Unregister from culling service
        this.cullingService?.unregisterEntity(entityId);

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
        if (meshData.blueprintEffect) {
          this.scene.remove(meshData.blueprintEffect);
          this.disposeGroup(meshData.blueprintEffect);
        }
        if (meshData.groundDustEffect) {
          this.scene.remove(meshData.groundDustEffect);
          this.disposeGroup(meshData.groundDustEffect);
        }
        if (meshData.scaffoldEffect) {
          this.scene.remove(meshData.scaffoldEffect);
          this.disposeGroup(meshData.scaffoldEffect);
        }
        // Clean up clipping plane reference
        meshData.clippingPlane = null;
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
    // PERF: Also cache mesh children to avoid traverse() calls during construction
    group.renderOrder = RENDER_ORDER.UNIT;
    const cachedMeshChildren: THREE.Mesh[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.renderOrder = RENDER_ORDER.UNIT;
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
        // PERF: Cache mesh children for later use
        cachedMeshChildren.push(child);
      }
    });

    // Selection ring - kept for data structure but not displayed (using instanced rendering)
    const ringGeometry = new THREE.RingGeometry(0.8, 1, 16);
    const selectionRingMaterial = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.9 });
    const selectionRing = new THREE.Mesh(ringGeometry, selectionRingMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false; // Always hidden, using instanced rendering instead

    // Health bar
    const healthBar = this.createBar(0x00ff00);

    // Progress bar - larger and more visible
    const progressBar = this.createProgressBar();

    return {
      group,
      selectionRing,
      healthBar,
      progressBar,
      buildingId: building.buildingId,
      wasComplete: false,
      cachedMeshChildren, // PERF: Pre-cached mesh children
      fireEffect: null,
      lastHealthPercent: 1,
      constructionEffect: null,
      buildingHeight,
      thrusterEffect: null,
      blueprintEffect: null,
      groundDustEffect: null,
      scaffoldEffect: null,
      clippingPlane: null,
      // PERF: Cached terrain height
      cachedTerrainHeight: 0,
      lastX: -99999,
      lastY: -99999,
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
   * Create construction effect (dust, sparks, welding flashes, metal debris)
   */
  private createConstructionEffect(buildingWidth: number, buildingDepth: number, _buildingHeight: number): THREE.Group {
    const effectGroup = new THREE.Group();

    // Create dust particles (scattered around construction area)
    const dustCount = 60;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 1.2;
      dustPositions[i * 3 + 1] = Math.random() * 0.5;
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

    // Create spark particles (welding/building sparks) - more sparks for better effect
    const sparkCount = 50;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkColors = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.8;
      sparkPositions[i * 3 + 1] = Math.random() * 0.3;
      sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.8;
      // Yellow to orange spark colors
      sparkColors[i * 3] = 1.0;
      sparkColors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
      sparkColors[i * 3 + 2] = Math.random() * 0.3;
    }
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

    const sparkMaterial = new THREE.PointsMaterial({
      size: 4.0,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkPoints.userData.basePositions = sparkPositions.slice();
    sparkPoints.userData.lifetimes = new Float32Array(sparkCount);
    sparkPoints.userData.velocities = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPoints.userData.lifetimes[i] = Math.random();
      // Spark velocities - shoot outward with arc
      sparkPoints.userData.velocities[i * 3] = (Math.random() - 0.5) * 4;
      sparkPoints.userData.velocities[i * 3 + 1] = 1 + Math.random() * 3;
      sparkPoints.userData.velocities[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    sparkPoints.userData.isSparks = true;
    effectGroup.add(sparkPoints);

    // Create welding flash particles (bright white/yellow bursts at weld points)
    const flashCount = 8;
    const flashPositions = new Float32Array(flashCount * 3);
    for (let i = 0; i < flashCount; i++) {
      flashPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.6;
      flashPositions[i * 3 + 1] = 0;
      flashPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.6;
    }
    const flashGeometry = new THREE.BufferGeometry();
    flashGeometry.setAttribute('position', new THREE.BufferAttribute(flashPositions, 3));

    const flashPoints = new THREE.Points(flashGeometry, this.weldingFlashMaterial.clone());
    flashPoints.userData.isFlash = true;
    flashPoints.userData.lifetimes = new Float32Array(flashCount);
    flashPoints.userData.activeFlash = new Uint8Array(flashCount);
    for (let i = 0; i < flashCount; i++) {
      flashPoints.userData.lifetimes[i] = Math.random() * 2;
      flashPoints.userData.activeFlash[i] = Math.random() > 0.7 ? 1 : 0;
    }
    effectGroup.add(flashPoints);

    // Create metal debris particles (small metallic fragments)
    const debrisCount = 25;
    const debrisPositions = new Float32Array(debrisCount * 3);
    for (let i = 0; i < debrisCount; i++) {
      debrisPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.7;
      debrisPositions[i * 3 + 1] = Math.random() * 0.2;
      debrisPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.7;
    }
    const debrisGeometry = new THREE.BufferGeometry();
    debrisGeometry.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));

    const debrisPoints = new THREE.Points(debrisGeometry, this.metalDebrisMaterial.clone());
    debrisPoints.userData.isDebris = true;
    debrisPoints.userData.lifetimes = new Float32Array(debrisCount);
    debrisPoints.userData.velocities = new Float32Array(debrisCount * 3);
    for (let i = 0; i < debrisCount; i++) {
      debrisPoints.userData.lifetimes[i] = Math.random();
      debrisPoints.userData.velocities[i * 3] = (Math.random() - 0.5) * 3;
      debrisPoints.userData.velocities[i * 3 + 1] = 1 + Math.random() * 2;
      debrisPoints.userData.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    effectGroup.add(debrisPoints);

    return effectGroup;
  }

  /**
   * Update construction effect animation - enhanced with welding flashes and debris
   */
  private updateConstructionEffect(effectGroup: THREE.Group, dt: number, buildingWidth: number, buildingDepth: number): void {
    for (const child of effectGroup.children) {
      if (!(child instanceof THREE.Points)) continue;

      const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

      if (child.userData.isSparks) {
        // Enhanced spark animation with physics-based arc trajectories
        const lifetimes = child.userData.lifetimes as Float32Array;
        const velocities = child.userData.velocities as Float32Array;
        const colors = child.geometry.attributes.color?.array as Float32Array | undefined;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 2.5;

          if (lifetimes[i] > 1) {
            // Respawn spark at random position
            lifetimes[i] = 0;
            positions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.6;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.6;
            // New random velocity
            velocities[i * 3] = (Math.random() - 0.5) * 4;
            velocities[i * 3 + 1] = 1.5 + Math.random() * 3;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 4;
          } else {
            // Apply velocity with gravity
            positions[i * 3] += velocities[i * 3] * dt;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
            // Gravity pulls sparks down
            velocities[i * 3 + 1] -= dt * 6;
            // Drag slows horizontal movement
            velocities[i * 3] *= 0.98;
            velocities[i * 3 + 2] *= 0.98;
          }

          // Color fades from bright yellow/white to orange/red
          if (colors) {
            const fade = 1 - lifetimes[i];
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.5 + fade * 0.5;
            colors[i * 3 + 2] = fade * 0.3;
          }
        }

        if (colors) {
          child.geometry.attributes.color.needsUpdate = true;
        }

        // Pulse opacity based on construction activity
        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = 0.7 + Math.sin(this.constructionAnimTime * 12) * 0.3;

      } else if (child.userData.isFlash) {
        // Welding flash animation - random bright bursts
        const lifetimes = child.userData.lifetimes as Float32Array;
        const activeFlash = child.userData.activeFlash as Uint8Array;
        const mat = child.material as THREE.PointsMaterial;

        let anyActive = false;
        for (let i = 0; i < lifetimes.length; i++) {
          lifetimes[i] += dt;

          if (lifetimes[i] > 0.3 + Math.random() * 0.5) {
            // Flash cycle complete, maybe start new flash
            lifetimes[i] = 0;
            activeFlash[i] = Math.random() > 0.6 ? 1 : 0;
            if (activeFlash[i]) {
              // Move flash to new random position
              positions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.6;
              positions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.6;
            }
          }

          if (activeFlash[i]) {
            anyActive = true;
          }
        }

        // Pulse flash intensity with rapid flickering
        const flicker = Math.sin(this.constructionAnimTime * 50) * 0.5 + 0.5;
        mat.opacity = anyActive ? 0.6 + flicker * 0.4 : 0;
        mat.size = 0.5 + flicker * 0.3;
        child.geometry.attributes.position.needsUpdate = true;

      } else if (child.userData.isDebris) {
        // Metal debris animation - small fragments with physics
        const lifetimes = child.userData.lifetimes as Float32Array;
        const velocities = child.userData.velocities as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 1.5;

          if (lifetimes[i] > 1 || positions[i * 3 + 1] < -0.5) {
            // Respawn debris
            lifetimes[i] = 0;
            positions[i * 3] = (Math.random() - 0.5) * buildingWidth * 0.5;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 0.5;
            velocities[i * 3] = (Math.random() - 0.5) * 3;
            velocities[i * 3 + 1] = 1 + Math.random() * 2;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
          } else {
            // Apply velocity with gravity
            positions[i * 3] += velocities[i * 3] * dt;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
            velocities[i * 3 + 1] -= dt * 8;
          }
        }

        // Slight opacity variation
        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = 0.7 + Math.sin(this.constructionAnimTime * 8) * 0.2;

      } else {
        // Dust animation - drift upward slowly
        const basePositions = child.userData.basePositions as Float32Array;
        const velocities = child.userData.velocities as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          positions[i * 3] += velocities[i * 3] * dt * 0.2;
          positions[i * 3 + 1] += dt * 0.5;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt * 0.2;

          // Reset if too far
          if (positions[i * 3 + 1] > 1.2 || Math.abs(positions[i * 3]) > buildingWidth) {
            positions[i * 3] = basePositions[i * 3];
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = basePositions[i * 3 + 2];
          }
        }
      }

      child.geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Create blueprint holographic effect for waiting_for_worker state
   * Shows a pulsing wireframe outline with scanning effect
   */
  private createBlueprintEffect(buildingWidth: number, buildingDepth: number, buildingHeight: number): THREE.Group {
    const effectGroup = new THREE.Group();

    // Create wireframe box outline (holographic blueprint edge lines)
    const boxGeometry = new THREE.BoxGeometry(buildingWidth * 0.95, buildingHeight, buildingDepth * 0.95);
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    const wireframe = new THREE.LineSegments(edgesGeometry, this.blueprintLineMaterial.clone());
    wireframe.position.y = buildingHeight / 2;
    effectGroup.add(wireframe);

    // Create corner accent points (holographic corner markers)
    const cornerCount = 8;
    const cornerPositions = new Float32Array(cornerCount * 3);
    const hw = buildingWidth * 0.48;
    const hh = buildingHeight;
    const hd = buildingDepth * 0.48;
    const corners = [
      [-hw, 0, -hd], [hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd],
      [-hw, hh, -hd], [hw, hh, -hd], [-hw, hh, hd], [hw, hh, hd],
    ];
    for (let i = 0; i < cornerCount; i++) {
      cornerPositions[i * 3] = corners[i][0];
      cornerPositions[i * 3 + 1] = corners[i][1];
      cornerPositions[i * 3 + 2] = corners[i][2];
    }
    const cornerGeometry = new THREE.BufferGeometry();
    cornerGeometry.setAttribute('position', new THREE.BufferAttribute(cornerPositions, 3));
    const cornerPoints = new THREE.Points(cornerGeometry, this.blueprintPulseMaterial.clone());
    effectGroup.add(cornerPoints);

    // Create scanning plane effect (horizontal plane that moves up)
    const scanGeometry = new THREE.PlaneGeometry(buildingWidth * 1.1, buildingDepth * 1.1);
    const scanMesh = new THREE.Mesh(scanGeometry, this.blueprintScanMaterial.clone());
    scanMesh.rotation.x = -Math.PI / 2;
    scanMesh.position.y = 0;
    scanMesh.userData.scanY = 0;
    scanMesh.userData.buildingHeight = buildingHeight;
    effectGroup.add(scanMesh);

    // Create floating holographic particles around the blueprint
    const particleCount = 40;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = Math.max(buildingWidth, buildingDepth) * 0.6;
      particlePositions[i * 3] = Math.cos(angle) * radius;
      particlePositions[i * 3 + 1] = Math.random() * buildingHeight;
      particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const hologramParticleMaterial = new THREE.PointsMaterial({
      color: 0x00ccff,
      size: 2.0,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const hologramParticles = new THREE.Points(particleGeometry, hologramParticleMaterial);
    hologramParticles.userData.isHologramParticles = true;
    hologramParticles.userData.buildingHeight = buildingHeight;
    hologramParticles.userData.basePositions = particlePositions.slice();
    effectGroup.add(hologramParticles);

    return effectGroup;
  }

  /**
   * Update blueprint effect animation
   */
  private updateBlueprintEffect(effectGroup: THREE.Group, dt: number, buildingHeight: number): void {
    for (const child of effectGroup.children) {
      if (child instanceof THREE.LineSegments) {
        // Pulse wireframe opacity
        const mat = child.material as THREE.LineBasicMaterial;
        mat.opacity = 0.5 + Math.sin(this.blueprintPulseTime * 4) * 0.3;
      } else if (child instanceof THREE.Mesh) {
        // Animate scanning plane
        const scanY = child.userData.scanY ?? 0;
        const newY = (scanY + dt * 1.5) % buildingHeight;
        child.userData.scanY = newY;
        child.position.y = newY;

        // Pulse scan plane opacity
        const mat = child.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.2 + Math.sin(this.blueprintPulseTime * 6) * 0.15;
      } else if (child instanceof THREE.Points) {
        if (child.userData.isHologramParticles) {
          // Animate hologram particles - float and rotate around building
          const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          const basePositions = child.userData.basePositions as Float32Array;
          const bh = child.userData.buildingHeight as number;

          for (let i = 0; i < positions.length / 3; i++) {
            // Rotate around Y axis
            const angle = this.blueprintPulseTime * 0.5 + (i / (positions.length / 3)) * Math.PI * 2;
            const baseX = basePositions[i * 3];
            const baseZ = basePositions[i * 3 + 2];
            const radius = Math.sqrt(baseX * baseX + baseZ * baseZ);
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Float up and down
            const yOffset = Math.sin(this.blueprintPulseTime * 2 + i * 0.5) * 0.3;
            positions[i * 3 + 1] = (basePositions[i * 3 + 1] + yOffset + bh) % bh;
          }
          child.geometry.attributes.position.needsUpdate = true;

          // Pulse particle opacity
          const mat = child.material as THREE.PointsMaterial;
          mat.opacity = 0.4 + Math.sin(this.blueprintPulseTime * 5) * 0.2;
        } else {
          // Corner points - pulse size
          const mat = child.material as THREE.PointsMaterial;
          mat.size = 0.25 + Math.sin(this.blueprintPulseTime * 4) * 0.1;
          mat.opacity = 0.7 + Math.sin(this.blueprintPulseTime * 3) * 0.3;
        }
      }
    }
  }

  /**
   * Create ground dust effect for construction base
   * Billowing dust clouds that spread outward from construction site
   */
  private createGroundDustEffect(buildingWidth: number, buildingDepth: number): THREE.Group {
    const effectGroup = new THREE.Group();

    // Large billowing dust particles
    const dustCount = 80;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);

    for (let i = 0; i < dustCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.max(buildingWidth, buildingDepth) * 0.8;
      dustPositions[i * 3] = Math.cos(angle) * radius;
      dustPositions[i * 3 + 1] = Math.random() * 0.5;
      dustPositions[i * 3 + 2] = Math.sin(angle) * radius;

      // Varied dust colors (tan to gray)
      const colorVariation = 0.8 + Math.random() * 0.2;
      dustColors[i * 3] = 0.6 * colorVariation;
      dustColors[i * 3 + 1] = 0.55 * colorVariation;
      dustColors[i * 3 + 2] = 0.45 * colorVariation;
    }

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));

    const dustMaterial = new THREE.PointsMaterial({
      size: 10.0,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const dustPoints = new THREE.Points(dustGeometry, dustMaterial);
    dustPoints.userData.velocities = new Float32Array(dustCount * 3);
    dustPoints.userData.lifetimes = new Float32Array(dustCount);
    dustPoints.userData.sizes = new Float32Array(dustCount);

    for (let i = 0; i < dustCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.3 + Math.random() * 0.5;
      dustPoints.userData.velocities[i * 3] = Math.cos(angle) * speed;
      dustPoints.userData.velocities[i * 3 + 1] = 0.2 + Math.random() * 0.3;
      dustPoints.userData.velocities[i * 3 + 2] = Math.sin(angle) * speed;
      dustPoints.userData.lifetimes[i] = Math.random();
      dustPoints.userData.sizes[i] = 0.8 + Math.random() * 0.6;
    }

    effectGroup.add(dustPoints);

    // Add low-lying dust cloud particles (very close to ground)
    const lowDustCount = 40;
    const lowDustPositions = new Float32Array(lowDustCount * 3);

    for (let i = 0; i < lowDustCount; i++) {
      lowDustPositions[i * 3] = (Math.random() - 0.5) * buildingWidth * 1.5;
      lowDustPositions[i * 3 + 1] = Math.random() * 0.15;
      lowDustPositions[i * 3 + 2] = (Math.random() - 0.5) * buildingDepth * 1.5;
    }

    const lowDustGeometry = new THREE.BufferGeometry();
    lowDustGeometry.setAttribute('position', new THREE.BufferAttribute(lowDustPositions, 3));

    const lowDustMaterial = new THREE.PointsMaterial({
      color: 0xbbaa88,
      size: 15.0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const lowDustPoints = new THREE.Points(lowDustGeometry, lowDustMaterial);
    lowDustPoints.userData.isLowDust = true;
    lowDustPoints.userData.basePositions = lowDustPositions.slice();
    effectGroup.add(lowDustPoints);

    return effectGroup;
  }

  /**
   * Update ground dust effect animation
   */
  private updateGroundDustEffect(effectGroup: THREE.Group, dt: number, buildingWidth: number, buildingDepth: number, progress: number): void {
    // Dust intensity decreases as construction progresses (less ground work later)
    const intensity = Math.max(0.2, 1 - progress * 0.8);

    for (const child of effectGroup.children) {
      if (!(child instanceof THREE.Points)) continue;

      const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

      if (child.userData.isLowDust) {
        // Low dust - slow drift and swirl
        const basePositions = child.userData.basePositions as Float32Array;

        for (let i = 0; i < positions.length / 3; i++) {
          const swirl = Math.sin(this.constructionAnimTime * 0.5 + i * 0.3) * 0.3;
          positions[i * 3] = basePositions[i * 3] + swirl;
          positions[i * 3 + 2] = basePositions[i * 3 + 2] + Math.cos(this.constructionAnimTime * 0.5 + i * 0.3) * 0.3;
        }

        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = 0.2 * intensity;
      } else {
        // Billowing dust particles
        const velocities = child.userData.velocities as Float32Array;
        const lifetimes = child.userData.lifetimes as Float32Array;
        const maxRadius = Math.max(buildingWidth, buildingDepth) * 1.2;

        for (let i = 0; i < positions.length / 3; i++) {
          lifetimes[i] += dt * 0.8;

          if (lifetimes[i] > 1) {
            // Respawn particle near center
            lifetimes[i] = 0;
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.5;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // New outward velocity
            velocities[i * 3] = Math.cos(angle) * (0.3 + Math.random() * 0.5);
            velocities[i * 3 + 1] = 0.2 + Math.random() * 0.4;
            velocities[i * 3 + 2] = Math.sin(angle) * (0.3 + Math.random() * 0.5);
          } else {
            // Apply velocity
            positions[i * 3] += velocities[i * 3] * dt;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

            // Slow down and settle
            velocities[i * 3] *= 0.98;
            velocities[i * 3 + 1] -= dt * 0.3;
            velocities[i * 3 + 2] *= 0.98;

            // Keep above ground
            if (positions[i * 3 + 1] < 0) {
              positions[i * 3 + 1] = 0;
              velocities[i * 3 + 1] *= -0.3;
            }

            // Force respawn if too far
            const dist = Math.sqrt(positions[i * 3] ** 2 + positions[i * 3 + 2] ** 2);
            if (dist > maxRadius) {
              lifetimes[i] = 1;
            }
          }
        }

        const mat = child.material as THREE.PointsMaterial;
        mat.opacity = 0.35 * intensity;
      }

      child.geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Create scaffold effect with thick poles and beams using cylinders
   * Shows construction framework that fades as building materializes
   * PERF: Uses shared materials and geometries to avoid allocation
   */
  private createScaffoldEffect(buildingWidth: number, buildingDepth: number, buildingHeight: number): THREE.Group {
    const scaffoldGroup = new THREE.Group();

    // Scaffold dimensions - extend beyond building for visibility
    const hw = buildingWidth * 0.65;
    const hd = buildingDepth * 0.65;
    const levelHeight = 1.5;
    const levels = Math.max(2, Math.ceil(buildingHeight / levelHeight));

    // PERF: Reusable vectors for calculations (avoid allocation in loop)
    const direction = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);

    // PERF: Helper to create a cylinder between two points using shared geometry
    const createPole = (
      startX: number, startY: number, startZ: number,
      endX: number, endY: number, endZ: number,
      geometry: THREE.CylinderGeometry,
      material: THREE.Material
    ) => {
      direction.set(endX - startX, endY - startY, endZ - startZ);
      const length = direction.length();
      if (length < 0.01) return null;

      // PERF: Reuse shared geometry, just scale the mesh
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.y = length;

      // Position at midpoint
      mesh.position.set(
        (startX + endX) * 0.5,
        (startY + endY) * 0.5,
        (startZ + endZ) * 0.5
      );

      // Orient cylinder to point from start to end
      direction.normalize();
      mesh.quaternion.setFromUnitVectors(axis, direction);

      return mesh;
    };

    // Corner positions (as arrays to avoid Vector3 allocation)
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];

    // Create vertical poles at corners
    for (const [cx, cz] of corners) {
      const pole = createPole(
        cx, 0, cz,
        cx, buildingHeight, cz,
        this.scaffoldPoleGeometry,
        this.scaffoldPoleMaterial
      );
      if (pole) scaffoldGroup.add(pole);
    }

    // Create horizontal beams at each level
    for (let level = 0; level <= levels; level++) {
      const y = Math.min(level * levelHeight, buildingHeight);

      // Horizontal beams connecting corners
      for (let i = 0; i < 4; i++) {
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 4];
        const beam = createPole(
          x1, y, z1,
          x2, y, z2,
          this.scaffoldBeamGeometry,
          this.scaffoldBeamMaterial
        );
        if (beam) scaffoldGroup.add(beam);
      }

      // Diagonal braces on each face (X pattern)
      if (level < levels) {
        const y2 = Math.min((level + 1) * levelHeight, buildingHeight);

        for (let i = 0; i < 4; i++) {
          const [c1x, c1z] = corners[i];
          const [c2x, c2z] = corners[(i + 1) % 4];

          // Diagonal 1
          const diag1 = createPole(
            c1x, y, c1z,
            c2x, y2, c2z,
            this.scaffoldDiagonalGeometry,
            this.scaffoldBeamMaterial
          );
          if (diag1) scaffoldGroup.add(diag1);

          // Diagonal 2
          const diag2 = createPole(
            c2x, y, c2z,
            c1x, y2, c1z,
            this.scaffoldDiagonalGeometry,
            this.scaffoldBeamMaterial
          );
          if (diag2) scaffoldGroup.add(diag2);
        }
      }
    }

    return scaffoldGroup;
  }

  /**
   * Update scaffold opacity for fade effect (only when fading out)
   * PERF: Only clones materials once when transitioning to transparent mode
   */
  private updateScaffoldOpacity(scaffold: THREE.Group, opacity: number): void {
    // Only apply transparency when fading (opacity < 1)
    const shouldBeTransparent = opacity < 0.99;

    // PERF: If we need transparency but haven't cloned materials yet, do it once
    if (shouldBeTransparent && !scaffold.userData.hasOwnMaterials) {
      scaffold.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Clone the shared material for this scaffold's private use
          child.material = (child.material as THREE.MeshBasicMaterial).clone();
        }
      });
      scaffold.userData.hasOwnMaterials = true;
    }

    // Only update if we have our own materials (transparent mode)
    if (scaffold.userData.hasOwnMaterials) {
      scaffold.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshBasicMaterial;
          if (mat) {
            mat.transparent = shouldBeTransparent;
            mat.opacity = opacity;
            mat.needsUpdate = true;
          }
        }
      });
    }
  }

  private createBar(color: number): THREE.Group {
    const group = new THREE.Group();

    const bgGeometry = new THREE.PlaneGeometry(2, 0.15);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    bg.renderOrder = 1000;
    group.add(bg);

    const fillGeometry = new THREE.PlaneGeometry(2, 0.15);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
    });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'fill';
    fill.renderOrder = 1001;
    group.add(fill);

    group.lookAt(0, 100, 0);
    group.visible = false;

    return group;
  }

  /**
   * Create a production progress bar
   * Larger and more visible than the health bar with border outline
   */
  private createProgressBar(): THREE.Group {
    const group = new THREE.Group();

    // Bar dimensions - larger for better visibility
    const barWidth = BuildingRenderer.PROGRESS_BAR_WIDTH;
    const barHeight = 0.35;
    const borderPadding = 0.08;

    // Outer border (bright cyan outline for high visibility)
    const borderGeometry = new THREE.PlaneGeometry(barWidth + borderPadding * 2, barHeight + borderPadding * 2);
    const borderMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const border = new THREE.Mesh(borderGeometry, borderMaterial);
    border.renderOrder = 999;
    group.add(border);

    // Inner border (dark for contrast)
    const innerBorderGeometry = new THREE.PlaneGeometry(barWidth + 0.04, barHeight + 0.04);
    const innerBorderMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      depthTest: false,
    });
    const innerBorder = new THREE.Mesh(innerBorderGeometry, innerBorderMaterial);
    innerBorder.position.z = 0.005;
    innerBorder.renderOrder = 999;
    group.add(innerBorder);

    // Background (visible dark red/maroon to show unfilled portion clearly)
    const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x330000,
      depthTest: false,
    });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    bg.position.z = 0.01;
    bg.renderOrder = 1000;
    group.add(bg);

    // Fill bar (will be colored dynamically - bright green/blue)
    const fillGeometry = new THREE.PlaneGeometry(barWidth, barHeight);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      depthTest: false,
    });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.z = 0.02;
    fill.name = 'fill';
    fill.renderOrder = 1001;
    group.add(fill);

    // Leading edge indicator (bright white line at progress edge)
    const edgeGeometry = new THREE.PlaneGeometry(0.06, barHeight * 1.1);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
    });
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edge.position.z = 0.03;
    edge.name = 'edge';
    edge.renderOrder = 1002;
    group.add(edge);

    // Don't set lookAt here - we'll billboard toward camera each frame
    group.visible = false;

    return group;
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('fill') as THREE.Mesh;
    if (fill) {
      // Note: In worker mode, components are plain objects, not class instances
      const percent = health.current / health.max;
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

  // Progress bar width constant (must match createProgressBar)
  private static readonly PROGRESS_BAR_WIDTH = 2.5;

  private updateProgressBar(progressBar: THREE.Group, progress: number, isConstruction: boolean = false): void {
    const fill = progressBar.getObjectByName('fill') as THREE.Mesh;
    const edge = progressBar.getObjectByName('edge') as THREE.Mesh;
    const halfWidth = BuildingRenderer.PROGRESS_BAR_WIDTH / 2;

    if (fill) {
      const clampedProgress = Math.max(0.01, progress); // Ensure minimum visibility
      fill.scale.x = clampedProgress;
      // Position the fill so it anchors to the left edge
      // When scaled, we need to offset by (progress - 1) * halfWidth to keep left edge fixed
      fill.position.x = (clampedProgress - 1) * halfWidth;

      // Different colors for construction vs production
      const material = fill.material as THREE.MeshBasicMaterial;
      if (isConstruction) {
        // Blue for building construction
        material.color.setHex(0x00ccff);
      } else {
        // Bright green for unit production
        material.color.setHex(0x00ff66);
      }
    }

    // Update leading edge indicator position (at the right edge of the fill)
    if (edge) {
      const clampedProgress = Math.max(0.01, progress);
      // Position at the right edge of the filled portion
      // Fill left edge is at -halfWidth, right edge is at -halfWidth + (clampedProgress * barWidth)
      // Which simplifies to: -halfWidth + clampedProgress * 2 * halfWidth = halfWidth * (2 * clampedProgress - 1)
      edge.position.x = halfWidth * (2 * clampedProgress - 1);
    }
  }

  /**
   * Queue geometry and materials for delayed disposal.
   * This prevents WebGPU "setIndexBuffer" crashes by ensuring the GPU
   * has finished all pending draw commands before buffers are freed.
   */
  private queueGeometryForDisposal(
    geometry: THREE.BufferGeometry,
    materials: THREE.Material | THREE.Material[]
  ): void {
    const materialArray = Array.isArray(materials) ? materials : [materials];
    this.geometryQuarantine.push({
      geometry,
      materials: materialArray,
      frameQueued: this.frameCount,
    });
  }

  /**
   * Process quarantined geometries and dispose those that are safe.
   * Call this once per frame at the START of update.
   */
  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = this.frameCount - entry.frameQueued;

      if (framesInQuarantine >= BuildingRenderer.GEOMETRY_QUARANTINE_FRAMES) {
        // Safe to dispose - GPU has finished with these buffers
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        // Keep in quarantine
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  /**
   * Dispose only materials in a group, NOT geometry.
   * Use this for meshes with shared geometry (from asset cache).
   */
  private disposeMaterialsOnly(group: THREE.Group | THREE.Object3D): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        } else if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        }
      }
    });
  }

  /**
   * Dispose both geometry and materials in a group via quarantine.
   * Only use this for groups with owned geometry (effects, particles, etc.).
   * Uses quarantine to prevent WebGPU crashes from disposing while GPU still rendering.
   */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        // Queue geometry and materials for delayed disposal
        const materials = child.material;
        this.queueGeometryForDisposal(child.geometry, materials);
      }
    });
  }

  public dispose(): void {
    // Flush any pending quarantined geometries first
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;

    this.constructingMaterial.dispose();
    this.selectionRingRenderer.dispose();
    this.fireMaterial.dispose();
    this.smokeMaterial.dispose();
    this.fireGeometry.dispose();
    this.constructionDustMaterial.dispose();
    this.constructionSparkMaterial.dispose();
    this.thrusterCoreMaterial.dispose();
    this.thrusterGlowMaterial.dispose();
    this.blueprintLineMaterial.dispose();
    this.blueprintPulseMaterial.dispose();
    this.blueprintScanMaterial.dispose();
    this.groundDustMaterial.dispose();
    this.metalDebrisMaterial.dispose();
    this.weldingFlashMaterial.dispose();
    this.scaffoldMaterial.dispose();

    for (const meshData of this.buildingMeshes.values()) {
      // Only dispose materials for building meshes (geometry is shared with asset cache)
      this.disposeMaterialsOnly(meshData.group);
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.scene.remove(meshData.progressBar);
      // Effects have their own geometry, can dispose fully
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
      if (meshData.blueprintEffect) {
        this.scene.remove(meshData.blueprintEffect);
        this.disposeGroup(meshData.blueprintEffect);
      }
      if (meshData.groundDustEffect) {
        this.scene.remove(meshData.groundDustEffect);
        this.disposeGroup(meshData.groundDustEffect);
      }
      if (meshData.scaffoldEffect) {
        this.scene.remove(meshData.scaffoldEffect);
        this.disposeGroup(meshData.scaffoldEffect);
      }
    }
    this.buildingMeshes.clear();

    // Dispose instanced groups - immediate disposal safe during full teardown
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

    // Flush any geometries queued during dispose
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;
  }
}
