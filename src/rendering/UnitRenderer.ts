import * as THREE from 'three';
import type { IWorldProvider, IEntity } from '@/engine/ecs/IWorldProvider';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Velocity } from '@/engine/components/Velocity';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager, LODLevel, DEFAULT_LOD_DISTANCES, DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import { debugAnimation, debugAssets, debugMesh, debugPerformance } from '@/utils/debugLogger';
import { setupInstancedVelocity, swapInstanceMatrices, commitInstanceMatrices, disposeInstancedVelocity } from './tsl/InstancedVelocity';
import { createSelectionRingMaterial, updateSelectionRingTime, TEAM_COLORS } from './tsl/SelectionMaterial';
import {
  UNIT_RENDERER,
  UNIT_SELECTION_RING,
  UNIT_TEAM_MARKER,
  UNIT_HEALTH_BAR,
  RENDER_ORDER,
} from '@/data/rendering.config';
import {
  AnimationController,
  loadAnimationConfig,
  updateAnimationParameters,
} from '@/engine/animation';

// Shared rendering utilities
import {
  HealthBarRenderer,
  SelectionRingRenderer,
  TransformUtils,
  SmoothRotation,
  EntityIdTracker,
} from './shared';

// GPU-driven rendering infrastructure
import { CullingService, EntityCategory } from './services/CullingService';
import { LODConfig } from './compute/UnifiedCullingCompute';
import { GPUIndirectRenderer } from './compute/GPUIndirectRenderer';

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

// Instance data for a single unit type + player combo at a specific LOD level
interface InstancedUnitGroup {
  mesh: THREE.InstancedMesh;
  unitType: string;
  playerId: string;
  lodLevel: LODLevel; // Which LOD level this group represents
  maxInstances: number;
  entityIds: number[]; // Maps instance index to entity ID
  dummy: THREE.Object3D; // Reusable for matrix calculations
  yOffset: number; // Y offset to apply when positioning (accounts for model origin)
  baseRotation: THREE.Quaternion; // Full base rotation (X, Y, Z from model + config)
  modelScale: number; // Scale factor from model normalization (applied to instances)
  lastActiveFrame: number; // Frame number when this group was last used (for cleanup)
}

// Per-unit animated mesh data (for animated units)
interface AnimatedUnitMesh {
  mesh: THREE.Object3D;
  controller: AnimationController;
  unitType: string;
}

// Per-unit overlay data - now tracks instance indices instead of individual meshes
// Selection rings and team markers use instanced rendering for ~150 fewer draw calls
interface UnitOverlay {
  healthBar: THREE.Group;  // Health bars kept individual due to dynamic width
  lastHealth: number;
  playerId: string;        // Track player for team marker color grouping
  // PERF: Cached terrain height to avoid recalculation every frame
  cachedTerrainHeight: number;
  lastX: number;
  lastY: number;
}

// Instanced overlay group for team markers
interface InstancedOverlayGroup {
  mesh: THREE.InstancedMesh;
  entityIds: number[];     // Maps instance index to entity ID
  positions: THREE.Vector3[]; // Cached positions for matrix updates
  maxInstances: number;
}

// Constants from centralized config
const MAX_INSTANCES_PER_TYPE = UNIT_RENDERER.MAX_INSTANCES_PER_TYPE;
const MAX_OVERLAY_INSTANCES = UNIT_RENDERER.MAX_OVERLAY_INSTANCES;
// Note: Airborne height is configured per-unit-type in assets.json via "airborneHeight" property
const INACTIVE_MESH_CLEANUP_FRAMES = UNIT_RENDERER.INACTIVE_MESH_CLEANUP_FRAMES;

export class UnitRenderer {
  private scene: THREE.Scene;
  private world: IWorldProvider;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string | null = null;

  // Instanced mesh groups: key = "unitType_playerId_LODx" (for non-animated units)
  // Each unit type + player combination has up to 3 groups (LOD0, LOD1, LOD2)
  private instancedGroups: Map<string, InstancedUnitGroup> = new Map();

  // Animated unit meshes: key = entityId (for animated units)
  private animatedUnits: Map<number, AnimatedUnitMesh> = new Map();

  // Track which unit types are animated
  private animatedUnitTypes: Set<string> = new Set();

  // Per-unit overlays (health bars only - selection rings and team markers are now instanced)
  private unitOverlays: Map<number, UnitOverlay> = new Map();

  // PERF: Shared health bar renderer (reduces GC pressure with shared geometry)
  private healthBarRenderer: HealthBarRenderer;

  // PERF: Shared selection ring renderer (instanced, reduces draw calls)
  private selectionRingRenderer: SelectionRingRenderer;

  // Team markers: keyed by playerId (still per-player instanced groups)
  private teamMarkerGroups: Map<string, InstancedOverlayGroup> = new Map();
  private teamMarkerGeometry: THREE.CircleGeometry;

  // Track which units are visible for instanced team marker rendering
  private visibleUnits: Map<number, { position: THREE.Vector3; playerId: string }> = new Map();

  // PERF: Pre-allocated entity ID tracker to avoid per-frame allocation
  private readonly entityIdTracker: EntityIdTracker = new EntityIdTracker();

  // Frame counter for tracking inactive meshes
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

  // PERF: Shared transform utilities (reusable temp objects)
  private readonly transformUtils: TransformUtils = new TransformUtils();

  // Camera reference for culling
  private camera: THREE.Camera | null = null;

  // PERF: Shared smooth rotation interpolation
  private readonly smoothRotation: SmoothRotation = new SmoothRotation(UNIT_RENDERER.ROTATION_SMOOTH_FACTOR);

  // PERF: Cached sorted entity list to avoid spread+sort every frame
  private cachedSortedEntities: IEntity[] = [];
  private cachedEntityCount: number = -1; // Track count to detect changes

  // Unified Culling Service (handles both GPU and CPU culling paths)
  private cullingService: CullingService | null = null;

  // GPU Indirect Renderer for draw call optimization
  private gpuIndirectRenderer: GPUIndirectRenderer | null = null;
  private useGPUDrivenRendering = false;
  private gpuIndirectInitialized = false;

  // Track unit type geometries registered with GPU indirect renderer
  private gpuRegisteredUnitTypes: Set<string> = new Set();

  constructor(scene: THREE.Scene, world: IWorldProvider, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    // Initialize shared health bar renderer
    this.healthBarRenderer = new HealthBarRenderer();

    // Initialize shared selection ring renderer
    this.selectionRingRenderer = new SelectionRingRenderer(scene, {
      innerRadius: UNIT_SELECTION_RING.INNER_RADIUS,
      outerRadius: UNIT_SELECTION_RING.OUTER_RADIUS,
      segments: UNIT_SELECTION_RING.SEGMENTS,
      opacity: UNIT_SELECTION_RING.OPACITY,
      maxInstances: UNIT_RENDERER.MAX_OVERLAY_INSTANCES,
    });

    // Team marker geometry - small circle beneath each unit showing team color
    this.teamMarkerGeometry = new THREE.CircleGeometry(
      UNIT_TEAM_MARKER.RADIUS,
      UNIT_TEAM_MARKER.SEGMENTS
    );

    // Preload common procedural assets
    AssetManager.preloadCommonAssets();

    // Register callback to refresh meshes when custom models finish loading
    AssetManager.onModelsLoaded(() => {
      this.refreshAllMeshes();
    });

    // Load custom GLB models (async, runs in background)
    AssetManager.loadCustomModels().catch(err => {
      debugAssets.warn('[UnitRenderer] Error loading custom models:', err);
    });
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
  }

  /**
   * Set camera reference for frustum culling
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  // WebGPU renderer reference for GPU compute
  private webgpuRenderer: import('three/webgpu').WebGPURenderer | null = null;
  private gpuCullingInitialized = false;

  /**
   * Set the WebGPU renderer (required for GPU-driven rendering)
   */
  public setRenderer(renderer: import('three/webgpu').WebGPURenderer): void {
    this.webgpuRenderer = renderer;

    // Initialize culling service with GPU support if available
    if (this.useGPUDrivenRendering && this.cullingService && !this.gpuCullingInitialized) {
      this.initializeGPUCulling();
    }

    // Initialize GPU indirect renderer if available
    if (this.useGPUDrivenRendering && this.gpuIndirectRenderer && !this.gpuIndirectInitialized) {
      this.initializeGPUIndirectRenderer();
    }
  }

  /**
   * Enable GPU-driven rendering mode
   *
   * When enabled:
   * - Unit transforms stored in unified GPU buffer
   * - Frustum culling done via CullingService (GPU or CPU fallback)
   * - Proper sphere-frustum intersection for accurate culling
   * - Indirect draw calls eliminate CPU-GPU roundtrips
   */
  public enableGPUDrivenRendering(): void {
    if (this.useGPUDrivenRendering) return;

    const settings = useUIStore.getState().graphicsSettings;
    this.cullingService = new CullingService({
      maxEntities: 8192, // Units + buildings combined
      lodConfig: {
        LOD0_MAX: settings.lodDistance0,
        LOD1_MAX: settings.lodDistance1,
      },
    });

    // Create GPU indirect renderer for drawIndexedIndirect
    this.gpuIndirectRenderer = new GPUIndirectRenderer(this.scene);

    this.useGPUDrivenRendering = true;
    this.gpuRegisteredUnitTypes.clear();

    // Initialize GPU compute if renderer is available
    if (this.webgpuRenderer) {
      this.initializeGPUCulling();
      this.initializeGPUIndirectRenderer();
    }

    debugMesh.log('[UnitRenderer] GPU-driven rendering enabled');
    debugMesh.log('[UnitRenderer] GPU-driven rendering mode: ENABLED');
  }

  /**
   * Initialize GPU culling via CullingService
   */
  private initializeGPUCulling(): void {
    if (!this.webgpuRenderer || !this.cullingService) return;
    if (this.gpuCullingInitialized) return;

    try {
      this.cullingService.initialize(this.webgpuRenderer, true);
      this.gpuCullingInitialized = true;
      debugMesh.log('[UnitRenderer] GPU culling initialized via CullingService');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugMesh.warn('[UnitRenderer] Failed to initialize GPU culling:', errorMsg);
    }
  }

  /**
   * Initialize GPU indirect renderer
   */
  private initializeGPUIndirectRenderer(): void {
    if (!this.webgpuRenderer || !this.cullingService || !this.gpuIndirectRenderer) return;
    if (this.gpuIndirectInitialized) return;

    try {
      this.gpuIndirectRenderer.initialize(
        this.webgpuRenderer,
        this.cullingService.getEntityBuffer(),
        this.cullingService.getCullingCompute()
      );
      this.gpuIndirectInitialized = true;
      debugPerformance.log('[UnitRenderer] GPU indirect renderer initialized successfully');
      debugPerformance.log('[UnitRenderer] GPU-driven rendering pipeline READY:');
      debugPerformance.log('  - GPU Entity Buffer: INITIALIZED');
      debugPerformance.log('  - GPU Culling Compute: ' + (this.gpuCullingInitialized ? 'READY' : 'PENDING'));
      debugPerformance.log('  - GPU Indirect Draw: ENABLED');
      debugPerformance.log('[GPU Indirect Renderer] INITIALIZED - indirect draw calls enabled');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      debugMesh.warn('[UnitRenderer] Failed to initialize GPU indirect renderer:', errorMsg);
    }
  }

  /**
   * Register a unit type geometry with the GPU indirect renderer
   */
  private registerUnitTypeForGPU(unitType: string, lodLevel: number, geometry: THREE.BufferGeometry, material?: THREE.Material): void {
    if (!this.gpuIndirectRenderer || !this.cullingService) return;

    const key = `${unitType}_${lodLevel}`;
    if (this.gpuRegisteredUnitTypes.has(key)) return;

    const typeIndex = this.cullingService.getEntityBuffer().getTypeIndex(unitType);
    this.gpuIndirectRenderer.registerUnitType(typeIndex, lodLevel, geometry, material);
    this.gpuRegisteredUnitTypes.add(key);

    debugPerformance.log(`[UnitRenderer] Registered unit type ${unitType} LOD${lodLevel} for GPU indirect rendering`);
  }

  /**
   * Force CPU fallback mode for debugging
   * Call from browser console: unitRenderer.forceCPUCulling(true)
   */
  public forceCPUCulling(enable: boolean): void {
    if (!this.cullingService) {
      debugMesh.warn('[UnitRenderer] Culling service not initialized, cannot toggle');
      return;
    }

    this.cullingService.forceCPUFallback(enable);
    if (enable) {
      debugMesh.log('[UnitRenderer] GPU culling DISABLED - using CPU fallback for debugging');
    } else {
      debugMesh.log('[UnitRenderer] GPU culling ENABLED');
    }
  }

  /**
   * Check if GPU culling is currently active
   */
  public isGPUCullingActive(): boolean {
    return this.cullingService?.isUsingGPU() ?? false;
  }

  /**
   * Disable GPU-driven rendering and fall back to CPU path
   */
  public disableGPUDrivenRendering(): void {
    if (!this.useGPUDrivenRendering) return;

    this.cullingService?.dispose();
    this.cullingService = null;

    this.gpuIndirectRenderer?.dispose();
    this.gpuIndirectRenderer = null;

    this.useGPUDrivenRendering = false;
    this.gpuRegisteredUnitTypes.clear();
    this.gpuCullingInitialized = false;
    this.gpuIndirectInitialized = false;

    debugPerformance.log('[UnitRenderer] GPU-driven rendering disabled');
  }

  /**
   * Check if GPU-driven rendering is enabled
   */
  public isGPUDrivenEnabled(): boolean {
    return this.useGPUDrivenRendering;
  }

  /**
   * Check if GPU indirect rendering is fully initialized
   */
  public isGPUIndirectReady(): boolean {
    return this.gpuIndirectInitialized && this.gpuCullingInitialized;
  }

  /**
   * Get GPU rendering statistics
   */
  public getGPURenderingStats(): {
    enabled: boolean;
    cullingReady: boolean;
    indirectReady: boolean;
    managedEntities: number;
    registeredUnitTypes: number;
    visibleCount: number;
    totalIndirectDrawCalls: number;
    isUsingGPUCulling: boolean;
    gpuCullTimeMs: number;
    quarantinedSlots: number;
  } {
    const cullingStats = this.cullingService?.getStats();
    return {
      enabled: this.useGPUDrivenRendering,
      cullingReady: this.gpuCullingInitialized,
      indirectReady: this.gpuIndirectInitialized,
      managedEntities: cullingStats?.totalEntities ?? 0,
      registeredUnitTypes: this.gpuRegisteredUnitTypes.size,
      visibleCount: cullingStats?.visibleEntities ?? 0,
      totalIndirectDrawCalls: this.gpuIndirectRenderer?.getTotalVisibleCount() ?? 0,
      isUsingGPUCulling: cullingStats?.isUsingGPU ?? false,
      gpuCullTimeMs: this.cullingService?.getCullingCompute().getGPUCullingStats().lastCullTimeMs ?? 0,
      quarantinedSlots: cullingStats?.quarantinedSlots ?? 0,
    };
  }

  /**
   * Update culling service with entity transform
   */
  private updateEntityCulling(
    entityId: number,
    unitType: string,
    playerId: string,
    x: number,
    y: number,
    z: number,
    rotation: number,
    scale: number
  ): void {
    if (!this.cullingService) return;

    // Register entity if not already registered
    if (!this.cullingService.isRegistered(entityId)) {
      this.cullingService.registerEntity(entityId, unitType, playerId, EntityCategory.Unit);
    }

    // Update transform (CullingService automatically gets proper bounding radius from AssetManager)
    this.cullingService.updateTransform(entityId, x, y, z, rotation, scale);
  }

  /**
   * Remove entity from culling service
   */
  private removeEntityFromCulling(entityId: number): void {
    this.cullingService?.unregisterEntity(entityId);
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

      if (framesInQuarantine >= UnitRenderer.GEOMETRY_QUARANTINE_FRAMES) {
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
   * Update LOD config from graphics settings
   */
  public updateLODConfig(lodConfig: LODConfig): void {
    this.cullingService?.getCullingCompute().setLODConfig(lodConfig);
  }


  /**
   * Smoothly interpolate rotation with proper angle wrapping.
   * Uses exponential smoothing for frame-rate independent smooth rotation.
   */
  private getSmoothRotation(entityId: number, targetRotation: number): number {
    return this.smoothRotation.getSmoothRotation(entityId, targetRotation);
  }

  /**
   * Check if a unit type should use animated rendering
   */
  private isAnimatedUnitType(unitType: string): boolean {
    // Check cached result first
    if (this.animatedUnitTypes.has(unitType)) {
      return true;
    }
    // Check if asset has animations
    if (AssetManager.hasAnimations(unitType)) {
      this.animatedUnitTypes.add(unitType);
      return true;
    }
    return false;
  }

  /**
   * Get or create an animated mesh for a specific unit entity.
   * Uses the data-driven AnimationController for state machine-based animation.
   */
  private getOrCreateAnimatedUnit(entityId: number, unitType: string, playerId: string): AnimatedUnitMesh {
    let animUnit = this.animatedUnits.get(entityId);

    if (!animUnit) {
      const playerColor = getPlayerColor(playerId);
      const mesh = AssetManager.getUnitMesh(unitType, playerColor);
      // Units render AFTER ground effects but BEFORE damage numbers
      mesh.renderOrder = RENDER_ORDER.UNIT;
      mesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.renderOrder = RENDER_ORDER.UNIT;
        }
      });
      this.scene.add(mesh);

      // Find the actual model inside the wrapper for proper animation binding
      // AssetManager wraps models in a Group, so get the first child (the actual model)
      const animationRoot = mesh.children.length > 0 ? mesh.children[0] : mesh;

      // Create animation mixer with the actual model (not the wrapper)
      const mixer = new THREE.AnimationMixer(animationRoot);

      // Get animation clips from asset manager
      const clips = AssetManager.getAnimations(unitType);

      // Load animation config (handles both legacy and new format)
      const assetConfig = AssetManager.getAssetConfig(unitType);
      const animConfig = loadAnimationConfig(assetConfig ?? {});

      if (!animConfig) {
        debugAnimation.warn(`[UnitRenderer] ${unitType}: No animation config found`);
        // Create minimal controller with no animations
        const controller = new AnimationController(
          {
            parameters: {},
            layers: [],
            stateMachines: {},
            clipMappings: {},
          },
          mixer,
          clips
        );
        animUnit = { mesh, controller, unitType };
        this.animatedUnits.set(entityId, animUnit);
        return animUnit;
      }

      // Create the AnimationController
      const controller = new AnimationController(animConfig, mixer, clips);

      // Log animation state for debugging
      debugAnimation.log(
        `[UnitRenderer] ${unitType}: Created AnimationController with ${clips.length} clips, ` +
        `${animConfig.layers.length} layers, initial state: ${controller.getCurrentState()}`
      );

      animUnit = {
        mesh,
        controller,
        unitType,
      };

      this.animatedUnits.set(entityId, animUnit);
    }

    return animUnit;
  }

  /**
   * Remove root motion (position/translation tracks) from an animation clip.
   * This prevents animations from moving the model, which would conflict with
   * programmatic position updates and cause jolting/warping effects.
   *
   * ONLY removes position/translation tracks from the actual root bone, not child bones.
   */
  private removeRootMotion(clip: THREE.AnimationClip): void {
    // Filter out position/translation tracks that affect the root bone ONLY
    // Keep rotation and scale tracks, and keep position tracks for non-root bones
    const tracksToRemove: number[] = [];

    // Common root bone names in character rigs (case-insensitive matching)
    const rootBoneNames = ['root', 'rootbone', 'root_bone', 'armature', 'hips', 'mixamorig:hips', 'pelvis'];

    for (let i = 0; i < clip.tracks.length; i++) {
      const track = clip.tracks[i];
      const trackName = track.name.toLowerCase();

      // Check if this is a position/translation track (GLTF uses "translation", Three.js uses "position")
      const isPositionTrack = trackName.includes('.position') || trackName.includes('.translation');
      if (!isPositionTrack) continue;

      // Extract the bone name from the track (format: "BoneName.position" or "BoneName.translation")
      const boneName = trackName.split('.')[0].toLowerCase();

      // Only remove if it's explicitly a root bone
      const isRootBone = rootBoneNames.some(root => boneName === root || boneName === `mixamorig:${root}`);

      if (isRootBone) {
        tracksToRemove.push(i);
      }
    }

    // Remove tracks in reverse order to maintain correct indices
    for (let i = tracksToRemove.length - 1; i >= 0; i--) {
      const removedTrack = clip.tracks.splice(tracksToRemove[i], 1)[0];
      debugAnimation.log(`[UnitRenderer] Removed root motion track: ${removedTrack.name} from ${clip.name}`);
    }
  }

  /**
   * Get or create an instanced mesh group for a unit type + player combo at a specific LOD level
   */
  private getOrCreateInstancedGroup(unitType: string, playerId: string, lodLevel: LODLevel = 0): InstancedUnitGroup {
    const key = `${unitType}_${playerId}_LOD${lodLevel}`;
    let group = this.instancedGroups.get(key);

    if (!group) {
      const playerColor = getPlayerColor(playerId);

      // Get the base mesh from AssetManager at the requested LOD level
      // Falls back to next best LOD if requested level isn't available
      const baseMesh = AssetManager.getModelAtLOD(unitType, lodLevel)
        ?? AssetManager.getUnitMesh(unitType, playerColor);

      // Update world matrices to get accurate world positions
      baseMesh.updateMatrixWorld(true);

      // Find the actual mesh geometry and material from the group
      // Also track the mesh's world position/rotation/scale to use as offsets
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      let meshWorldY = 0;
      const meshWorldRotation = new THREE.Quaternion(); // Full rotation (X, Y, Z)
      let meshWorldScale = 1;

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          // Clone geometry with proper GPU buffer initialization.
          // This avoids sharing disposal lifecycle with asset cache and
          // ensures required attributes (UVs) exist for WebGPU shaders.
          geometry = cloneGeometryForGPU(child.geometry);
          material = child.material;
          // Get the mesh's world position Y - this is lost when extracting geometry
          const worldPos = new THREE.Vector3();
          child.getWorldPosition(worldPos);
          meshWorldY = worldPos.y;
          // Get the mesh's full world rotation (X, Y, Z) - also lost when extracting geometry
          child.getWorldQuaternion(meshWorldRotation);
          // Get the mesh's world scale - also lost when extracting geometry
          const worldScale = new THREE.Vector3();
          child.getWorldScale(worldScale);
          meshWorldScale = worldScale.x; // Assume uniform scale
        }
      });

      if (!geometry) {
        // Fallback: create a simple box
        geometry = new THREE.BoxGeometry(0.5, 1, 0.5);
        material = new THREE.MeshStandardMaterial({ color: playerColor });
      }

      // Create instanced mesh
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material!,
        MAX_INSTANCES_PER_TYPE
      );
      instancedMesh.count = 0; // Start with no visible instances
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false; // We'll handle culling ourselves
      // Units render AFTER ground effects but BEFORE damage numbers
      instancedMesh.renderOrder = RENDER_ORDER.UNIT;

      // Set up previous instance matrix attributes for TAA velocity
      setupInstancedVelocity(instancedMesh);

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        unitType,
        playerId,
        lodLevel,
        maxInstances: MAX_INSTANCES_PER_TYPE,
        entityIds: [],
        dummy: new THREE.Object3D(),
        yOffset: meshWorldY,
        baseRotation: meshWorldRotation.clone(), // Full base rotation (X, Y, Z from model + config)
        modelScale: meshWorldScale,
        lastActiveFrame: this.frameCount,
      };

      // Log rotation as Euler for easier debugging
      const rotEuler = new THREE.Euler().setFromQuaternion(meshWorldRotation);
      debugAssets.log(`[UnitRenderer] Created instanced group for ${unitType} LOD${lodLevel}: yOffset=${meshWorldY.toFixed(3)}, rotation=(${(rotEuler.x * 180/Math.PI).toFixed(1)}°, ${(rotEuler.y * 180/Math.PI).toFixed(1)}°, ${(rotEuler.z * 180/Math.PI).toFixed(1)}°), scale=${meshWorldScale.toFixed(3)}`);

      this.instancedGroups.set(key, group);

      // Register geometry with GPU indirect renderer for GPU-driven rendering
      if (this.gpuIndirectRenderer && this.gpuIndirectInitialized && geometry) {
        const baseMat = Array.isArray(material) ? material[0] : material;
        this.registerUnitTypeForGPU(unitType, lodLevel, geometry, baseMat ?? undefined);
      }
    }

    return group;
  }

  /**
   * Get or create overlay for a unit (health bar only - selection rings and team markers are instanced)
   */
  private getOrCreateOverlay(entityId: number, playerId: string): UnitOverlay {
    let overlay = this.unitOverlays.get(entityId);

    if (!overlay) {
      // Health bar (kept individual due to dynamic width based on health %)
      const healthBar = this.healthBarRenderer.createHealthBar();
      healthBar.visible = false;
      this.scene.add(healthBar);

      overlay = {
        healthBar,
        lastHealth: 1,
        playerId,
        // PERF: Initialize cached terrain height
        cachedTerrainHeight: 0,
        lastX: -99999,
        lastY: -99999,
      };

      this.unitOverlays.set(entityId, overlay);
    }

    return overlay;
  }

  /**
   * Get or create an instanced team marker group for a player
   */
  private getOrCreateTeamMarkerGroup(playerId: string): InstancedOverlayGroup {
    let group = this.teamMarkerGroups.get(playerId);

    if (!group) {
      const teamColor = getPlayerColor(playerId);
      const material = new THREE.MeshBasicMaterial({
        color: teamColor,
        transparent: true,
        opacity: UNIT_TEAM_MARKER.OPACITY,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(this.teamMarkerGeometry, material, MAX_OVERLAY_INSTANCES);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // NOTE: Don't set mesh.rotation here - rotation is applied per-instance to avoid
      // coordinate transform issues with instanced meshes
      mesh.renderOrder = RENDER_ORDER.TEAM_MARKER;
      this.scene.add(mesh);

      group = {
        mesh,
        entityIds: [],
        positions: [],
        maxInstances: MAX_OVERLAY_INSTANCES,
      };
      this.teamMarkerGroups.set(playerId, group);
    }

    return group;
  }

  /**
   * PERF: Get cached terrain height, only recalculating when position changes significantly
   */
  private getCachedTerrainHeight(overlay: UnitOverlay, x: number, y: number): number {
    // Only recalculate if position changed by more than threshold
    const dx = Math.abs(x - overlay.lastX);
    const dy = Math.abs(y - overlay.lastY);
    const threshold = UNIT_RENDERER.TERRAIN_HEIGHT_CACHE_THRESHOLD;
    if (dx > threshold || dy > threshold) {
      overlay.cachedTerrainHeight = this.terrain?.getHeightAt(x, y) ?? 0;
      overlay.lastX = x;
      overlay.lastY = y;
    }
    return overlay.cachedTerrainHeight;
  }

  public update(deltaTime: number = 1/60): void {
    const updateStart = performance.now();
    this.frameCount++;

    // Process quarantined geometries at the START of each frame
    // This ensures GPU has finished with disposed buffers before we free them
    this.processGeometryQuarantine();

    // Update selection ring animation time (shared across all instances)
    this.selectionRingRenderer.updateAnimation(deltaTime);

    // TAA: Sort entities by ID for stable instance ordering
    // This ensures previous/current matrix pairs are aligned correctly for velocity
    // PERF: Only re-sort when entity count changes (add/remove) to avoid O(n log n) every frame
    const rawEntities = this.world.getEntitiesWith('Transform', 'Unit');


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

    // TAA: Copy current instance matrices to previous BEFORE resetting counts
    // This preserves last frame's transforms for velocity calculation
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        swapInstanceMatrices(group.mesh);
      }
    }

    // GPU-driven rendering: swap transform buffers for velocity calculation
    if (this.useGPUDrivenRendering && this.cullingService) {
      this.cullingService.swapTransformBuffers();
    }

    // Perform frustum culling (uses previous frame's transforms - acceptable latency)
    if (this.cullingService && this.camera) {
      // Reset indirect args before culling
      if (this.gpuIndirectRenderer && this.gpuIndirectInitialized) {
        this.gpuIndirectRenderer.resetIndirectArgs();
      }
      this.cullingService.performCulling(this.camera);

      // Update mesh visibility (and validate) after culling, before rendering
      // This catches any disposed geometry before it causes WebGPU crashes
      if (this.gpuIndirectRenderer && this.gpuIndirectInitialized) {
        this.gpuIndirectRenderer.updateMeshVisibility();
      }

      // Log culling status periodically (every 300 frames ~5 seconds)
      if (this.frameCount % 300 === 1) {
        const stats = this.getGPURenderingStats();
        const cullingMode = stats.isUsingGPUCulling ? 'GPU' : 'CPU';
        debugPerformance.log(
          `[Unified Culling] ${stats.isUsingGPUCulling ? 'GPU ACTIVE' : 'CPU FALLBACK'} - ` +
          `Entities: ${stats.managedEntities}/${stats.visibleCount} total/visible, ` +
          `UnitTypes: ${stats.registeredUnitTypes}, ` +
          `Culling: ${cullingMode} (${stats.gpuCullTimeMs.toFixed(2)}ms), ` +
          `Indirect: ${stats.indirectReady ? 'ON' : 'OFF'}, ` +
          `Quarantined: ${stats.quarantinedSlots}`
        );

        // Validate mesh geometries periodically to detect any disposed buffers
        if (this.gpuIndirectRenderer) {
          const invalidCount = this.gpuIndirectRenderer.validateAllMeshes();
          if (invalidCount > 0) {
            debugPerformance.warn(`[GPU Rendering] Found ${invalidCount} invalid meshes - hiding to prevent crashes`);
          }
        }
      }
    }

    // Reset instance counts for all groups
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // PERF: Reset instanced overlay groups
    this.selectionRingRenderer.resetInstances();
    for (const group of this.teamMarkerGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }
    this.visibleUnits.clear();

    // Hide animated units that may be hidden
    for (const animUnit of this.animatedUnits.values()) {
      animUnit.mesh.visible = false;
    }

    // Build instance data
    for (const entity of entities) {
      this.entityIdTracker.add(entity.id);

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');

      // Skip entities with missing required components (defensive check)
      if (!transform || !unit) continue;

      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const velocity = entity.get<Velocity>('Velocity');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isSpectating = isSpectatorMode() || !this.playerId;
      const isOwned = !isSpectating && ownerId === this.playerId;
      const isEnemy = !isSpectating && selectable && ownerId !== this.playerId;

      // Check visibility for enemy units (skip in spectator mode - show all)
      let shouldShow = true;
      if (isEnemy && this.visionSystem && this.playerId) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      // Skip dead units
      // Note: In worker mode, components are plain objects, not class instances
      if (health && health.current <= 0) {
        shouldShow = false;
      }

      if (!shouldShow) {
        // Hide health bar if exists (selection rings and team markers are instanced)
        const overlay = this.unitOverlays.get(entity.id);
        if (overlay) {
          overlay.healthBar.visible = false;
        }
        continue;
      }

      // PERF: Get cached terrain height (only recalculates when position changes)
      const overlay = this.getOrCreateOverlay(entity.id, ownerId);
      const terrainHeight = this.getCachedTerrainHeight(overlay, transform.x, transform.y);

      // Calculate flying offset for air units (per-unit-type airborne height from assets.json)
      const flyingOffset = unit.isFlying ? AssetManager.getAirborneHeight(unit.unitId) : 0;
      const modelHeight = AssetManager.getModelHeight(unit.unitId);
      const unitHeight = terrainHeight + flyingOffset;

      // Calculate smooth rotation for both animated and instanced units
      const smoothRotation = this.getSmoothRotation(entity.id, transform.rotation);

      // Update culling service with entity transform (registers if needed)
      if (this.cullingService) {
        this.updateEntityCulling(
          entity.id,
          unit.unitId,
          ownerId,
          transform.x,
          unitHeight,
          transform.y,
          smoothRotation,
          1.0 // Scale
        );
      }

      // PERF: Skip units outside camera frustum (using proper sphere-frustum intersection)
      if (this.cullingService && this.camera && !this.cullingService.isVisible(entity.id)) {
        // Hide health bar if exists (selection rings and team markers are instanced)
        const existingOverlay = this.unitOverlays.get(entity.id);
        if (existingOverlay) {
          existingOverlay.healthBar.visible = false;
        }
        continue;
      }

      if (this.isAnimatedUnitType(unit.unitId)) {
        // Use individual animated mesh with AnimationController
        const animUnit = this.getOrCreateAnimatedUnit(entity.id, unit.unitId, ownerId);
        animUnit.mesh.visible = true;

        // Update position and rotation with smooth interpolation
        // Model rotation offset (if any) is baked in from AssetManager during loading.
        // Game forward is +X (matching atan2 convention where angle 0 = +X).
        animUnit.mesh.position.set(transform.x, unitHeight, transform.y);
        animUnit.mesh.rotation.y = smoothRotation;

        // Update animation parameters from game state
        // The AnimationController's state machine handles transitions automatically
        updateAnimationParameters(animUnit.controller, unit, velocity ?? null);

        // Update animation controller (handles state machine and mixer)
        const animSpeedMultiplier = AssetManager.getAnimationSpeed(animUnit.unitType);
        animUnit.controller.update(deltaTime * animSpeedMultiplier);
      } else {
        // Use instanced rendering for non-animated units
        // Calculate distance from camera for LOD selection
        let lodLevel: LODLevel = 0;
        const settings = useUIStore.getState().graphicsSettings;
        if (settings.lodEnabled && this.camera) {
          const dx = transform.x - this.camera.position.x;
          const dz = transform.y - this.camera.position.z; // transform.y is world Z
          const distanceToCamera = Math.sqrt(dx * dx + dz * dz);

          // Select LOD level based on distance thresholds
          if (distanceToCamera <= settings.lodDistance0) {
            lodLevel = 0;
          } else if (distanceToCamera <= settings.lodDistance1) {
            lodLevel = 1;
          } else {
            lodLevel = 2;
          }

          // Fall back to best available LOD if requested level isn't loaded
          lodLevel = AssetManager.getBestLODForDistance(unit.unitId, distanceToCamera, {
            LOD0_MAX: settings.lodDistance0,
            LOD1_MAX: settings.lodDistance1,
          });
        }

        const group = this.getOrCreateInstancedGroup(unit.unitId, ownerId, lodLevel);

        // Add instance if we have room
        if (group.mesh.count < group.maxInstances) {
          const instanceIndex = group.mesh.count;
          group.entityIds[instanceIndex] = entity.id;

          // Set instance transform - apply offsets to account for model origin position/rotation/scale
          // baseRotation is the model's full base rotation (X, Y, Z from assets.json config).
          // We multiply: unit facing (Y rotation) × base rotation to get final orientation.
          // modelScale is the normalization scale from AssetManager (to achieve target height).
          this.transformUtils.tempPosition.set(transform.x, unitHeight + group.yOffset, transform.y);
          // Create quaternion from unit's facing direction (Y rotation only) with smooth interpolation
          // smoothRotation already calculated above for GPU buffer
          this.transformUtils.tempEuler.set(0, smoothRotation, 0);
          this.transformUtils.tempFacingQuat.setFromEuler(this.transformUtils.tempEuler);
          // Combine: facing rotation × base rotation (order matters for proper orientation)
          this.transformUtils.tempQuaternion.copy(this.transformUtils.tempFacingQuat).multiply(group.baseRotation);
          this.transformUtils.tempScale.setScalar(group.modelScale);
          this.transformUtils.tempMatrix.compose(this.transformUtils.tempPosition, this.transformUtils.tempQuaternion, this.transformUtils.tempScale);
          group.mesh.setMatrixAt(instanceIndex, this.transformUtils.tempMatrix);

          group.mesh.count++;
        }
      }

      // Update overlays - now uses instanced rendering for selection rings and team markers
      // PERF: Overlay already created above when getting cached terrain height

      // PERF: Track visible unit for instanced team marker rendering
      this.visibleUnits.set(entity.id, {
        position: new THREE.Vector3(transform.x, unitHeight + 0.02, transform.y),
        playerId: ownerId,
      });

      // PERF: Add selected unit to instanced selection ring renderer
      if (selectable?.isSelected) {
        this.selectionRingRenderer.addInstance({
          entityId: entity.id,
          position: new THREE.Vector3(transform.x, unitHeight + 0.05, transform.y),
          scale: 1,
          isOwned,
        });
      }

      // Health bar - only show if damaged, positioned above the unit model (kept individual)
      if (health) {
        // Note: In worker mode, components are plain objects, not class instances
        const healthPercent = health.current / health.max;
        overlay.healthBar.visible = healthPercent < 1;
        if (overlay.healthBar.visible) {
          // Position health bar above the unit model
          overlay.healthBar.position.set(transform.x, unitHeight + modelHeight + UNIT_HEALTH_BAR.Y_OFFSET, transform.y);
          // Only update health bar visuals if health changed
          if (Math.abs(overlay.lastHealth - healthPercent) > 0.01) {
            this.healthBarRenderer.updateHealthBar(overlay.healthBar, health);
            overlay.lastHealth = healthPercent;
          }
        }
      }
    }

    // PERF: Build instanced team marker matrices
    for (const [entityId, data] of this.visibleUnits) {
      const group = this.getOrCreateTeamMarkerGroup(data.playerId);
      if (group.mesh.count < group.maxInstances) {
        const idx = group.mesh.count;
        group.entityIds[idx] = entityId;
        // Team markers are flat on ground - use shared transform utils
        this.transformUtils.composeGroundOverlay(data.position.x, data.position.y, data.position.z, 1);
        group.mesh.setMatrixAt(idx, this.transformUtils.tempMatrix);
        group.mesh.count++;
      }
    }

    // PERF: Commit instanced selection ring matrices (built via addInstance calls above)
    this.selectionRingRenderer.commitInstances();

    // Mark team marker matrices as needing update
    for (const group of this.teamMarkerGroups.values()) {
      group.mesh.instanceMatrix.needsUpdate = true;
    }

    // Mark instance matrices as needing update and commit for TAA velocity
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
        // TAA: Commit current matrices to velocity attributes AFTER all updates
        commitInstanceMatrices(group.mesh);
        // Track when this group was last used
        group.lastActiveFrame = this.frameCount;
      }
    }

    // PERF: Clean up instanced groups that have been inactive for too long
    // This prevents draw call accumulation when units die or change LOD levels
    for (const [key, group] of this.instancedGroups) {
      const framesInactive = this.frameCount - group.lastActiveFrame;
      if (framesInactive > INACTIVE_MESH_CLEANUP_FRAMES) {
        this.scene.remove(group.mesh);
        // Dispose velocity buffer attributes immediately (CPU-side only)
        disposeInstancedVelocity(group.mesh);
        // Queue geometry and materials for delayed disposal to prevent WebGPU crashes.
        // The GPU may still have pending draw commands using these buffers.
        const materials = group.mesh.material;
        this.queueGeometryForDisposal(group.mesh.geometry, materials);
        this.instancedGroups.delete(key);
        debugPerformance.log(`[UnitRenderer] Cleaned up inactive mesh: ${key} (inactive for ${framesInactive} frames)`);
      }
    }

    // Clean up resources for destroyed entities (health bars only - overlays are instanced)
    for (const [entityId, overlay] of this.unitOverlays) {
      if (!this.entityIdTracker.has(entityId)) {
        this.scene.remove(overlay.healthBar);
        this.healthBarRenderer.disposeHealthBar(overlay.healthBar);
        this.unitOverlays.delete(entityId);
      }
    }

    // FIX: Clean up smooth rotations for ALL destroyed entities, not just those with overlays
    // This prevents a memory leak where units without health bars (full HP) would never have
    // their rotation tracking cleaned up
    for (const entityId of this.smoothRotation.keys()) {
      if (!this.entityIdTracker.has(entityId)) {
        this.smoothRotation.remove(entityId);
        // Clean up culling service registration
        this.removeEntityFromCulling(entityId);
      }
    }

    // Clean up animated units for destroyed entities
    for (const [entityId, animUnit] of this.animatedUnits) {
      if (!this.entityIdTracker.has(entityId)) {
        this.scene.remove(animUnit.mesh);
        // Dispose animation controller (handles mixer cleanup)
        animUnit.controller.dispose();
        // Dispose materials but NOT geometry (geometry is shared with asset cache)
        animUnit.mesh.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            } else if (Array.isArray(child.material)) {
              child.material.forEach((m: THREE.Material) => m.dispose());
            }
          }
        });
        this.animatedUnits.delete(entityId);
      }
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(`[UnitRenderer] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Clear all cached meshes so they get recreated with updated assets on next update.
   */
  public refreshAllMeshes(): void {
    debugAssets.log('[UnitRenderer] Refreshing all unit meshes...');

    // Clear instanced groups - use quarantine to prevent WebGPU crashes
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      // Dispose velocity buffer attributes immediately (CPU-side only)
      disposeInstancedVelocity(group.mesh);
      // Queue geometry and materials for delayed disposal
      const materials = group.mesh.material;
      this.queueGeometryForDisposal(group.mesh.geometry, materials);
    }
    this.instancedGroups.clear();

    // Clear animated units
    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      // Dispose animation controller (handles mixer cleanup)
      animUnit.controller.dispose();
      // Dispose materials but NOT geometry (shared with asset cache)
      animUnit.mesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          } else if (Array.isArray(child.material)) {
            child.material.forEach((m: THREE.Material) => m.dispose());
          }
        }
      });
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    // Clear overlays (health bars only - selection rings and team markers are instanced)
    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.healthBar);
      this.healthBarRenderer.disposeHealthBar(overlay.healthBar);
    }
    this.unitOverlays.clear();

    // Clear team marker groups
    for (const group of this.teamMarkerGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.teamMarkerGroups.clear();

    // Clear rotation tracking
    this.smoothRotation.clear();
    this.visibleUnits.clear();
  }

  /**
   * Get Three.js meshes for a list of entity IDs (for outline pass)
   */
  public getMeshesForEntities(entityIds: number[]): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];

    for (const entityId of entityIds) {
      // Check animated units first (they have individual meshes)
      const animUnit = this.animatedUnits.get(entityId);
      if (animUnit) {
        meshes.push(animUnit.mesh);
      }
      // For instanced units, we can't return individual instance meshes
      // The outline pass would need special handling for instanced meshes
    }

    return meshes;
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

    // Dispose shared utilities
    this.healthBarRenderer.dispose();
    this.selectionRingRenderer.dispose();
    this.teamMarkerGeometry.dispose();

    // Dispose instanced groups - immediate disposal is safe during full teardown
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      // Dispose velocity buffer attributes to prevent memory leak
      disposeInstancedVelocity(group.mesh);
      // Dispose geometry (safe since we clone it during creation)
      group.mesh.geometry.dispose();
      // Dispose materials
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      } else if (Array.isArray(group.mesh.material)) {
        group.mesh.material.forEach(m => m.dispose());
      }
    }
    this.instancedGroups.clear();

    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      // Dispose animation controller (handles mixer cleanup)
      animUnit.controller.dispose();
      // Dispose materials but NOT geometry (shared with asset cache)
      animUnit.mesh.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          } else if (Array.isArray(child.material)) {
            child.material.forEach((m: THREE.Material) => m.dispose());
          }
        }
      });
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    // Dispose health bars
    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.healthBar);
      this.healthBarRenderer.disposeHealthBar(overlay.healthBar);
    }
    this.unitOverlays.clear();

    // Dispose team marker groups
    for (const group of this.teamMarkerGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.teamMarkerGroups.clear();

    // Clear rotation tracking
    this.smoothRotation.clear();
    this.visibleUnits.clear();

    // Dispose GPU-driven rendering resources
    this.cullingService?.dispose();
    this.cullingService = null;
    this.gpuIndirectRenderer?.dispose();
    this.gpuIndirectRenderer = null;
    this.gpuRegisteredUnitTypes.clear();
    this.webgpuRenderer = null;
    this.gpuCullingInitialized = false;
    this.gpuIndirectInitialized = false;
  }
}
