import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Velocity } from '@/engine/components/Velocity';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager, AnimationMappingConfig, LODLevel, DEFAULT_LOD_DISTANCES, DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { useUIStore } from '@/store/uiStore';
import { debugAnimation, debugAssets, debugPerformance } from '@/utils/debugLogger';
import { setupInstancedVelocity, swapInstanceMatrices, commitInstanceMatrices, disposeInstancedVelocity } from './tsl/InstancedVelocity';

// GPU-driven rendering infrastructure
import { GPUUnitBuffer } from './compute/GPUUnitBuffer';
import { CullingCompute, LODConfig } from './compute/CullingCompute';
import { GPUIndirectRenderer } from './compute/GPUIndirectRenderer';

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
  mixer: THREE.AnimationMixer;
  animations: Map<string, THREE.AnimationAction>;
  currentAction: string;
  unitType: string; // Track unit type for animation speed multipliers
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

// Instanced overlay groups for selection rings and team markers
interface InstancedOverlayGroup {
  mesh: THREE.InstancedMesh;
  entityIds: number[];     // Maps instance index to entity ID
  positions: THREE.Vector3[]; // Cached positions for matrix updates
  maxInstances: number;
}

const MAX_INSTANCES_PER_TYPE = 100; // Max units of same type per player
const MAX_OVERLAY_INSTANCES = 200;  // Max units for instanced overlays (selection rings, team markers)
// Note: Airborne height is now configured per-unit-type in assets.json via "airborneHeight" property
// Use AssetManager.getAirborneHeight(unitId) to get the configured height (defaults to DEFAULT_AIRBORNE_HEIGHT = 8)
const INACTIVE_MESH_CLEANUP_FRAMES = 180; // Remove meshes after 3 seconds (60fps) of inactivity

// Default animation name mappings (used when JSON config not available)
// Each game action maps to a list of possible animation clip names to search for
const DEFAULT_ANIMATION_MAPPINGS: AnimationMappingConfig = {
  idle: ['idle', 'stand', 'pose'],
  walk: ['walk', 'run', 'move', 'locomotion'],
  attack: ['attack', 'shoot', 'fire', 'combat'],
  death: ['death', 'die', 'dead'],
};

export class UnitRenderer {
  private scene: THREE.Scene;
  private world: World;
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

  // PERF: Instanced overlay groups - greatly reduces draw calls
  // Selection rings: keyed by 'owned' or 'enemy'
  private selectionRingGroups: Map<string, InstancedOverlayGroup> = new Map();
  // Team markers: keyed by playerId
  private teamMarkerGroups: Map<string, InstancedOverlayGroup> = new Map();
  // Track which units are selected and visible for instanced rendering
  private selectedUnits: Map<number, { position: THREE.Vector3; isOwned: boolean }> = new Map();
  private visibleUnits: Map<number, { position: THREE.Vector3; playerId: string }> = new Map();

  // PERF: Pre-allocated Set for tracking current entity IDs to avoid per-frame allocation
  private readonly _currentIds: Set<number> = new Set();

  // Frame counter for tracking inactive meshes
  private frameCount: number = 0;

  // Shared resources
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private enemySelectionMaterial: THREE.MeshBasicMaterial;
  private teamMarkerGeometry: THREE.CircleGeometry;

  // FIX: Shared health bar geometry to avoid per-unit allocation (GC pressure)
  private healthBarBgGeometry: THREE.PlaneGeometry;
  private healthBarFillGeometry: THREE.PlaneGeometry;
  private healthBarBgMaterial: THREE.MeshBasicMaterial;

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempFacingQuat: THREE.Quaternion = new THREE.Quaternion(); // For unit facing direction
  private tempScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  private tempEuler: THREE.Euler = new THREE.Euler();
  // Pre-computed rotation for flat ground overlays (rings, markers)
  private groundOverlayRotation: THREE.Quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );

  // PERF: Frustum culling for instances
  private frustum: THREE.Frustum = new THREE.Frustum();
  private frustumMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private camera: THREE.Camera | null = null;

  // Smooth rotation interpolation - stores visual rotation per entity
  private visualRotations: Map<number, number> = new Map();
  private readonly ROTATION_SMOOTH_FACTOR = 0.15; // Exponential smoothing (0.1=slow, 0.3=fast)

  // PERF: Cached sorted entity list to avoid spread+sort every frame
  private cachedSortedEntities: import('@/engine/ecs/Entity').Entity[] = [];
  private cachedEntityCount: number = -1; // Track count to detect changes

  // GPU-Driven Rendering Infrastructure
  private gpuUnitBuffer: GPUUnitBuffer | null = null;
  private cullingCompute: CullingCompute | null = null;
  private gpuIndirectRenderer: GPUIndirectRenderer | null = null;
  private useGPUDrivenRendering = false;
  private gpuIndirectInitialized = false;

  // Track entities managed by GPU buffer
  private gpuManagedEntities: Set<number> = new Set();

  // Track unit type geometries registered with GPU indirect renderer
  private gpuRegisteredUnitTypes: Set<string> = new Set();

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    this.selectionGeometry = new THREE.RingGeometry(0.6, 0.8, 16); // Reduced segments for perf
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.enemySelectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    // Team marker geometry - small circle beneath each unit showing team color
    this.teamMarkerGeometry = new THREE.CircleGeometry(0.4, 12);

    // FIX: Pre-create shared health bar geometry to avoid per-unit allocation
    this.healthBarBgGeometry = new THREE.PlaneGeometry(1.4, 0.18);
    this.healthBarFillGeometry = new THREE.PlaneGeometry(1.4, 0.18);
    this.healthBarBgMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
    });

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

    // Initialize GPU culling if GPU-driven mode is already enabled
    if (this.useGPUDrivenRendering && this.gpuUnitBuffer && this.cullingCompute && !this.gpuCullingInitialized) {
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
   * - Unit transforms stored in GPU buffer
   * - Frustum culling done via CullingCompute on GPU
   * - Indirect draw calls eliminate CPU-GPU roundtrips
   * - Reduced CPU overhead for large unit counts
   */
  public enableGPUDrivenRendering(): void {
    if (this.useGPUDrivenRendering) return;

    this.gpuUnitBuffer = new GPUUnitBuffer({
      maxUnits: 4096,
      maxUnitTypes: 64,
      maxLODLevels: 3,
      maxPlayers: 8,
    });

    const settings = useUIStore.getState().graphicsSettings;
    this.cullingCompute = new CullingCompute({
      LOD0_MAX: settings.lodDistance0,
      LOD1_MAX: settings.lodDistance1,
    });

    // Create GPU indirect renderer for drawIndexedIndirect
    this.gpuIndirectRenderer = new GPUIndirectRenderer(this.scene);

    this.useGPUDrivenRendering = true;
    this.gpuManagedEntities.clear();
    this.gpuRegisteredUnitTypes.clear();

    // Initialize GPU compute if renderer is available
    if (this.webgpuRenderer) {
      this.initializeGPUCulling();
      this.initializeGPUIndirectRenderer();
    }

    console.log('[UnitRenderer] GPU-driven rendering enabled');
  }

  /**
   * Initialize GPU culling compute shader
   */
  private initializeGPUCulling(): void {
    if (!this.webgpuRenderer || !this.gpuUnitBuffer || !this.cullingCompute) return;
    if (this.gpuCullingInitialized) return;

    try {
      this.cullingCompute.initializeGPUCompute(
        this.webgpuRenderer,
        this.gpuUnitBuffer.getTransformData(),
        this.gpuUnitBuffer.getMetadataData()
      );
      this.gpuCullingInitialized = true;
      console.log('[UnitRenderer] GPU culling compute initialized');
    } catch (e) {
      console.warn('[UnitRenderer] Failed to initialize GPU culling:', e);
    }
  }

  /**
   * Initialize GPU indirect renderer
   */
  private initializeGPUIndirectRenderer(): void {
    if (!this.webgpuRenderer || !this.gpuUnitBuffer || !this.cullingCompute || !this.gpuIndirectRenderer) return;
    if (this.gpuIndirectInitialized) return;

    try {
      this.gpuIndirectRenderer.initialize(
        this.webgpuRenderer,
        this.gpuUnitBuffer,
        this.cullingCompute
      );
      this.gpuIndirectInitialized = true;
      console.log('[UnitRenderer] GPU indirect renderer initialized successfully');
      console.log('[UnitRenderer] GPU-driven rendering pipeline READY:');
      console.log('  - GPU Unit Buffer: INITIALIZED');
      console.log('  - GPU Culling Compute: ' + (this.gpuCullingInitialized ? 'READY' : 'PENDING'));
      console.log('  - GPU Indirect Draw: ENABLED');
    } catch (e) {
      console.warn('[UnitRenderer] Failed to initialize GPU indirect renderer:', e);
    }
  }

  /**
   * Register a unit type geometry with the GPU indirect renderer
   */
  private registerUnitTypeForGPU(unitType: string, lodLevel: number, geometry: THREE.BufferGeometry, material?: THREE.Material): void {
    if (!this.gpuIndirectRenderer || !this.gpuUnitBuffer) return;

    const key = `${unitType}_${lodLevel}`;
    if (this.gpuRegisteredUnitTypes.has(key)) return;

    const unitTypeIndex = this.gpuUnitBuffer.getUnitTypeIndex(unitType);
    this.gpuIndirectRenderer.registerUnitType(unitTypeIndex, lodLevel, geometry, material);
    this.gpuRegisteredUnitTypes.add(key);

    debugPerformance.log(`[UnitRenderer] Registered unit type ${unitType} LOD${lodLevel} for GPU indirect rendering`);
  }

  /**
   * Disable GPU-driven rendering and fall back to CPU path
   */
  public disableGPUDrivenRendering(): void {
    if (!this.useGPUDrivenRendering) return;

    this.gpuUnitBuffer?.dispose();
    this.gpuUnitBuffer = null;

    this.cullingCompute?.dispose();
    this.cullingCompute = null;

    this.gpuIndirectRenderer?.dispose();
    this.gpuIndirectRenderer = null;

    this.useGPUDrivenRendering = false;
    this.gpuManagedEntities.clear();
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
  } {
    return {
      enabled: this.useGPUDrivenRendering,
      cullingReady: this.gpuCullingInitialized,
      indirectReady: this.gpuIndirectInitialized,
      managedEntities: this.gpuManagedEntities.size,
      registeredUnitTypes: this.gpuRegisteredUnitTypes.size,
      visibleCount: this.cullingCompute?.getVisibleCount() ?? 0,
      totalIndirectDrawCalls: this.gpuIndirectRenderer?.getTotalVisibleCount() ?? 0,
    };
  }

  /**
   * Update GPU buffer with entity transform
   */
  private updateGPUEntityTransform(
    entityId: number,
    unitType: string,
    playerId: string,
    x: number,
    y: number,
    z: number,
    rotation: number,
    scale: number
  ): void {
    if (!this.gpuUnitBuffer) return;

    // Allocate slot if new entity
    if (!this.gpuManagedEntities.has(entityId)) {
      const slot = this.gpuUnitBuffer.allocateSlot(entityId, unitType, playerId);
      if (slot) {
        this.gpuManagedEntities.add(entityId);
        // Set initial bounding radius
        this.gpuUnitBuffer.updateBoundingRadius(entityId, 1.0);
      }
    }

    // Update transform
    this.gpuUnitBuffer.updateTransformComponents(entityId, x, y, z, rotation, scale);
  }

  /**
   * Remove entity from GPU buffer
   */
  private removeGPUEntity(entityId: number): void {
    if (!this.gpuUnitBuffer) return;

    if (this.gpuManagedEntities.has(entityId)) {
      this.gpuUnitBuffer.freeSlot(entityId);
      this.gpuManagedEntities.delete(entityId);
    }
  }

  /**
   * Update LOD config from graphics settings
   */
  public updateLODConfig(lodConfig: LODConfig): void {
    this.cullingCompute?.setLODConfig(lodConfig);
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
   * Check if a position is within the camera frustum (with margin for unit size)
   */
  private isInFrustum(x: number, y: number, z: number, margin: number = 2): boolean {
    if (!this.camera) return true; // If no camera, assume visible
    this.tempPosition.set(x, y, z);
    // Use containsPoint with a small margin for unit bounding sphere
    return this.frustum.containsPoint(this.tempPosition);
  }

  /**
   * Smoothly interpolate rotation with proper angle wrapping.
   * Uses exponential smoothing for frame-rate independent smooth rotation.
   */
  private getSmoothRotation(entityId: number, targetRotation: number): number {
    let visualRotation = this.visualRotations.get(entityId);

    if (visualRotation === undefined) {
      // First time seeing this entity - snap to target
      this.visualRotations.set(entityId, targetRotation);
      return targetRotation;
    }

    // Calculate shortest angular distance (handling wrap-around at ±π)
    let diff = targetRotation - visualRotation;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // If very close, snap to target to avoid jitter
    if (Math.abs(diff) < 0.01) {
      this.visualRotations.set(entityId, targetRotation);
      return targetRotation;
    }

    // Exponential smoothing toward target
    visualRotation += diff * this.ROTATION_SMOOTH_FACTOR;

    // Normalize to [-π, π]
    while (visualRotation > Math.PI) visualRotation -= Math.PI * 2;
    while (visualRotation < -Math.PI) visualRotation += Math.PI * 2;

    this.visualRotations.set(entityId, visualRotation);
    return visualRotation;
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
   *
   * Animation mapping priority:
   * 1. JSON config (public/config/assets.json) - explicit mappings per asset
   * 2. Exact name matches from default mappings
   * 3. Partial name matches (e.g., "walk_cycle" matches "walk")
   * 4. Fallback to idle animation
   */
  private getOrCreateAnimatedUnit(entityId: number, unitType: string, playerId: string): AnimatedUnitMesh {
    let animUnit = this.animatedUnits.get(entityId);

    if (!animUnit) {
      const playerColor = getPlayerColor(playerId);
      const mesh = AssetManager.getUnitMesh(unitType, playerColor);
      // Units render AFTER ground effects (5) but BEFORE damage numbers (100)
      mesh.renderOrder = 50;
      mesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.renderOrder = 50;
        }
      });
      this.scene.add(mesh);

      // Find the actual model inside the wrapper for proper animation binding
      // AssetManager wraps models in a Group, so get the first child (the actual model)
      const animationRoot = mesh.children.length > 0 ? mesh.children[0] : mesh;

      // Create animation mixer with the actual model (not the wrapper)
      const mixer = new THREE.AnimationMixer(animationRoot);
      const animations = new Map<string, THREE.AnimationAction>();

      // Get animations from asset manager and create actions
      const clips = AssetManager.getAnimations(unitType);

      // Get animation mappings - prefer JSON config, fall back to defaults
      const configMappings = AssetManager.getAnimationMappings(unitType);
      const animMappings = configMappings ?? DEFAULT_ANIMATION_MAPPINGS;

      debugAnimation.log(`[UnitRenderer] ${unitType}: Using ${configMappings ? 'JSON config' : 'default'} animation mappings`);

      // Build a map of normalized clip names to actions for lookup
      const clipNameToAction = new Map<string, THREE.AnimationAction>();
      for (const clip of clips) {
        const action = mixer.clipAction(clip);
        // Normalize name: lowercase and strip common prefixes like "Armature|"
        let name = clip.name.toLowerCase();
        // Handle Blender-style naming (e.g., "Armature|idle" -> "idle")
        if (name.includes('|')) {
          name = name.split('|').pop() || name;
        }
        clipNameToAction.set(name, action);
        // Also store original clip name for exact matches
        clipNameToAction.set(clip.name.toLowerCase(), action);
        debugAnimation.log(`[UnitRenderer] ${unitType}: Found animation clip "${clip.name}" -> normalized "${name}"`);
      }

      // Map game actions to animation clips using the configured mappings
      // The first matching name in the array wins (priority order)
      for (const [gameAction, clipNames] of Object.entries(animMappings)) {
        if (!clipNames) continue;

        // Try each configured clip name in order
        for (const clipName of clipNames) {
          const normalizedName = clipName.toLowerCase();

          // First try exact match
          if (clipNameToAction.has(normalizedName)) {
            animations.set(gameAction, clipNameToAction.get(normalizedName)!);
            debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped '${gameAction}' -> "${clipName}" (exact match)`);
            break;
          }

          // Then try partial match (clip name contains the search term)
          for (const [clipKey, action] of clipNameToAction) {
            if (clipKey.includes(normalizedName)) {
              animations.set(gameAction, action);
              debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped '${gameAction}' -> "${clipKey}" (partial match for "${clipName}")`);
              break;
            }
          }

          // If we found a match, stop searching
          if (animations.has(gameAction)) break;
        }
      }

      // Ensure we have fallbacks for missing animations
      if (!animations.has('walk') && animations.has('idle')) {
        animations.set('walk', animations.get('idle')!);
        debugAnimation.log(`[UnitRenderer] ${unitType}: Using 'idle' as fallback for 'walk'`);
      }
      if (!animations.has('attack') && animations.has('idle')) {
        animations.set('attack', animations.get('idle')!);
        debugAnimation.log(`[UnitRenderer] ${unitType}: Using 'idle' as fallback for 'attack'`);
      }

      // Log final animation mappings
      debugAnimation.log(`[UnitRenderer] ${unitType}: Final animation mappings:`);
      for (const [key, action] of animations) {
        const clipName = action.getClip().name;
        debugAnimation.log(`[UnitRenderer]   '${key}' -> clip "${clipName}"`);
      }

      // Start with idle animation if available
      const idleAction = animations.get('idle');
      if (idleAction) {
        debugAnimation.log(`[UnitRenderer] ${unitType}: Starting idle animation, clip name: "${idleAction.getClip().name}"`);
        idleAction.play();
      } else if (clips.length > 0) {
        // Fall back to first NON-DEATH animation to avoid playing death as idle
        let fallbackClip = clips[0];
        for (const clip of clips) {
          const lowerName = clip.name.toLowerCase();
          // Skip death animations as fallback
          if (!lowerName.includes('death') && !lowerName.includes('die') && !lowerName.includes('dead')) {
            fallbackClip = clip;
            break;
          }
        }
        const firstAction = mixer.clipAction(fallbackClip);
        firstAction.play();
        animations.set('idle', firstAction);
        debugAnimation.log(`[UnitRenderer] ${unitType}: No idle animation found, using fallback: ${fallbackClip.name}`);
      }

      animUnit = {
        mesh,
        mixer,
        animations,
        currentAction: 'idle',
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
   * Update animation state based on unit state
   */
  private updateAnimationState(animUnit: AnimatedUnitMesh, isMoving: boolean, isAttacking: boolean): void {
    let targetAction = 'idle';
    if (isAttacking) {
      targetAction = 'attack';
    } else if (isMoving) {
      targetAction = 'walk';
    }

    if (animUnit.currentAction !== targetAction) {
      const currentActionObj = animUnit.animations.get(animUnit.currentAction);
      const targetActionObj = animUnit.animations.get(targetAction);

      debugAnimation.log(`[UnitRenderer] Animation switch: ${animUnit.currentAction} -> ${targetAction} (isMoving=${isMoving}, isAttacking=${isAttacking})`);
      debugAnimation.log(`[UnitRenderer] Available animations:`, Array.from(animUnit.animations.keys()));

      if (targetActionObj) {
        if (currentActionObj) {
          currentActionObj.fadeOut(0.2);
        }
        targetActionObj.reset().fadeIn(0.2).play();
        animUnit.currentAction = targetAction;
      } else {
        debugAnimation.warn(`[UnitRenderer] Target animation '${targetAction}' not found!`);
      }
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
          geometry = child.geometry;
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
      // Units render AFTER ground effects (5) but BEFORE damage numbers (100)
      instancedMesh.renderOrder = 50;

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
      const healthBar = this.createHealthBar();
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
   * Get or create an instanced selection ring group (owned=green, enemy=red)
   */
  private getOrCreateSelectionRingGroup(isOwned: boolean): InstancedOverlayGroup {
    const key = isOwned ? 'owned' : 'enemy';
    let group = this.selectionRingGroups.get(key);

    if (!group) {
      const material = isOwned ? this.selectionMaterial.clone() : this.enemySelectionMaterial.clone();
      const mesh = new THREE.InstancedMesh(this.selectionGeometry, material, MAX_OVERLAY_INSTANCES);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // NOTE: Don't set mesh.rotation here - rotation is applied per-instance to avoid
      // coordinate transform issues with instanced meshes
      // Selection rings render at same level as ground effects
      mesh.renderOrder = 5;
      this.scene.add(mesh);

      group = {
        mesh,
        entityIds: [],
        positions: [],
        maxInstances: MAX_OVERLAY_INSTANCES,
      };
      this.selectionRingGroups.set(key, group);
    }

    return group;
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
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(this.teamMarkerGeometry, material, MAX_OVERLAY_INSTANCES);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // NOTE: Don't set mesh.rotation here - rotation is applied per-instance to avoid
      // coordinate transform issues with instanced meshes
      // Team markers render just above ground
      mesh.renderOrder = 4;
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
    // Only recalculate if position changed by more than 0.5 units
    const dx = Math.abs(x - overlay.lastX);
    const dy = Math.abs(y - overlay.lastY);
    if (dx > 0.5 || dy > 0.5) {
      overlay.cachedTerrainHeight = this.terrain?.getHeightAt(x, y) ?? 0;
      overlay.lastX = x;
      overlay.lastY = y;
    }
    return overlay.cachedTerrainHeight;
  }

  public update(deltaTime: number = 1/60): void {
    const updateStart = performance.now();
    this.frameCount++;

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
    // PERF: Reuse pre-allocated Set instead of creating new one every frame
    this._currentIds.clear();

    // PERF: Update frustum for culling
    this.updateFrustum();

    // GPU-driven culling: dispatch compute shader if available
    // This runs culling on GPU and populates indirect draw args
    if (this.useGPUDrivenRendering && this.cullingCompute && this.gpuUnitBuffer && this.camera && this.gpuCullingInitialized) {
      // Reset indirect args before culling (compute shader will populate instance counts)
      if (this.gpuIndirectRenderer && this.gpuIndirectInitialized) {
        this.gpuIndirectRenderer.resetIndirectArgs();
        this.gpuIndirectRenderer.updateCamera(this.camera);
      }

      // Dispatch GPU culling compute shader
      this.cullingCompute.cullGPU(this.gpuUnitBuffer, this.camera);

      // Log GPU indirect rendering status periodically (every 300 frames ~5 seconds)
      if (this.frameCount % 300 === 1) {
        const stats = this.getGPURenderingStats();
        console.log(
          `[GPU Indirect Rendering] ACTIVE - Managed: ${stats.managedEntities}, ` +
          `Visible: ${stats.visibleCount}, UnitTypes: ${stats.registeredUnitTypes}, ` +
          `Culling: ${stats.cullingReady ? 'GPU' : 'CPU'}, Indirect: ${stats.indirectReady ? 'ON' : 'OFF'}`
        );
      }
    }

    // TAA: Copy current instance matrices to previous BEFORE resetting counts
    // This preserves last frame's transforms for velocity calculation
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        swapInstanceMatrices(group.mesh);
      }
    }

    // GPU-driven rendering: swap transform buffers for velocity calculation
    if (this.useGPUDrivenRendering && this.gpuUnitBuffer) {
      this.gpuUnitBuffer.swapTransformBuffers();
    }

    // Reset instance counts for all groups
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // PERF: Reset instanced overlay groups
    for (const group of this.selectionRingGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }
    for (const group of this.teamMarkerGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }
    this.selectedUnits.clear();
    this.visibleUnits.clear();

    // Hide animated units that may be hidden
    for (const animUnit of this.animatedUnits.values()) {
      animUnit.mesh.visible = false;
    }

    // Build instance data
    for (const entity of entities) {
      this._currentIds.add(entity.id);

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
      if (health && health.isDead()) {
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

      // PERF: Skip units outside camera frustum
      if (!this.isInFrustum(transform.x, unitHeight + 1, transform.y)) {
        // Hide health bar if exists (selection rings and team markers are instanced)
        const overlay = this.unitOverlays.get(entity.id);
        if (overlay) {
          overlay.healthBar.visible = false;
        }
        continue;
      }

      // Check if this is an animated unit type
      // Calculate smooth rotation for both animated and instanced units
      const smoothRotation = this.getSmoothRotation(entity.id, transform.rotation);

      // GPU-driven rendering: update GPU buffer with transform
      if (this.useGPUDrivenRendering && this.gpuUnitBuffer) {
        this.updateGPUEntityTransform(
          entity.id,
          unit.unitId,
          ownerId,
          transform.x,
          unitHeight,
          transform.y,
          smoothRotation,
          1.0 // Scale - could be extracted from model if needed
        );
      }

      if (this.isAnimatedUnitType(unit.unitId)) {
        // Use individual animated mesh
        const animUnit = this.getOrCreateAnimatedUnit(entity.id, unit.unitId, ownerId);
        animUnit.mesh.visible = true;

        // Update position and rotation with smooth interpolation
        // Model rotation offset (if any) is baked in from AssetManager during loading.
        // Game forward is +X (matching atan2 convention where angle 0 = +X).
        animUnit.mesh.position.set(transform.x, unitHeight, transform.y);
        animUnit.mesh.rotation.y = smoothRotation;

        // Determine animation state
        // isMoving: unit has non-zero velocity
        const isMoving = velocity ? (Math.abs(velocity.x) > 0.01 || Math.abs(velocity.y) > 0.01) : false;
        // isActuallyAttacking: unit is in attacking state AND stationary (in range, performing attack)
        // When chasing a target (moving toward it), show walk animation, not attack
        const isActuallyAttacking = unit.state === 'attacking' && !isMoving;

        // Update animation
        this.updateAnimationState(animUnit, isMoving, isActuallyAttacking);

        // Update animation mixer with unit-specific speed multiplier (from JSON config or default 1.0)
        const animSpeedMultiplier = AssetManager.getAnimationSpeed(animUnit.unitType);
        animUnit.mixer.update(deltaTime * animSpeedMultiplier);
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
          this.tempPosition.set(transform.x, unitHeight + group.yOffset, transform.y);
          // Create quaternion from unit's facing direction (Y rotation only) with smooth interpolation
          // smoothRotation already calculated above for GPU buffer
          this.tempEuler.set(0, smoothRotation, 0);
          this.tempFacingQuat.setFromEuler(this.tempEuler);
          // Combine: facing rotation × base rotation (order matters for proper orientation)
          this.tempQuaternion.copy(this.tempFacingQuat).multiply(group.baseRotation);
          this.tempScale.setScalar(group.modelScale);
          this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
          group.mesh.setMatrixAt(instanceIndex, this.tempMatrix);

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

      // PERF: Track selected unit for instanced selection ring rendering
      if (selectable?.isSelected) {
        this.selectedUnits.set(entity.id, {
          position: new THREE.Vector3(transform.x, unitHeight + 0.05, transform.y),
          isOwned,
        });
      }

      // Health bar - only show if damaged, positioned above the unit model (kept individual)
      if (health) {
        const healthPercent = health.getHealthPercent();
        overlay.healthBar.visible = healthPercent < 1;
        if (overlay.healthBar.visible) {
          // Position health bar above the unit model (model height + small offset)
          overlay.healthBar.position.set(transform.x, unitHeight + modelHeight + 0.3, transform.y);
          // Only update health bar visuals if health changed
          if (Math.abs(overlay.lastHealth - healthPercent) > 0.01) {
            this.updateHealthBar(overlay.healthBar, health);
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
        // Team markers are flat on ground - apply rotation per-instance to lay flat
        this.tempPosition.copy(data.position);
        this.tempScale.set(1, 1, 1);
        this.tempMatrix.compose(this.tempPosition, this.groundOverlayRotation, this.tempScale);
        group.mesh.setMatrixAt(idx, this.tempMatrix);
        group.mesh.count++;
      }
    }

    // PERF: Build instanced selection ring matrices
    for (const [entityId, data] of this.selectedUnits) {
      const group = this.getOrCreateSelectionRingGroup(data.isOwned);
      if (group.mesh.count < group.maxInstances) {
        const idx = group.mesh.count;
        group.entityIds[idx] = entityId;
        // Selection rings are flat on ground - apply rotation per-instance to lay flat
        this.tempPosition.copy(data.position);
        this.tempScale.set(1, 1, 1);
        this.tempMatrix.compose(this.tempPosition, this.groundOverlayRotation, this.tempScale);
        group.mesh.setMatrixAt(idx, this.tempMatrix);
        group.mesh.count++;
      }
    }

    // Mark instanced overlay matrices as needing update
    for (const group of this.selectionRingGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const group of this.teamMarkerGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
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

    // GPU-driven rendering: commit buffer changes to GPU
    if (this.useGPUDrivenRendering && this.gpuUnitBuffer) {
      this.gpuUnitBuffer.commitChanges();
    }

    // PERF: Clean up instanced groups that have been inactive for too long
    // This prevents draw call accumulation when units die or change LOD levels
    for (const [key, group] of this.instancedGroups) {
      const framesInactive = this.frameCount - group.lastActiveFrame;
      if (framesInactive > INACTIVE_MESH_CLEANUP_FRAMES) {
        this.scene.remove(group.mesh);
        // Dispose velocity buffer attributes
        disposeInstancedVelocity(group.mesh);
        // Only dispose materials (geometry is shared with asset cache)
        if (group.mesh.material instanceof THREE.Material) {
          group.mesh.material.dispose();
        } else if (Array.isArray(group.mesh.material)) {
          group.mesh.material.forEach(m => m.dispose());
        }
        this.instancedGroups.delete(key);
        debugPerformance.log(`[UnitRenderer] Cleaned up inactive mesh: ${key} (inactive for ${framesInactive} frames)`);
      }
    }

    // Clean up resources for destroyed entities (health bars only - overlays are instanced)
    for (const [entityId, overlay] of this.unitOverlays) {
      if (!this._currentIds.has(entityId)) {
        this.scene.remove(overlay.healthBar);
        this.disposeGroup(overlay.healthBar);
        this.unitOverlays.delete(entityId);
      }
    }

    // FIX: Clean up visualRotations for ALL destroyed entities, not just those with overlays
    // This prevents a memory leak where units without health bars (full HP) would never have
    // their rotation tracking cleaned up
    for (const entityId of this.visualRotations.keys()) {
      if (!this._currentIds.has(entityId)) {
        this.visualRotations.delete(entityId);
        // Clean up GPU buffer slot
        if (this.useGPUDrivenRendering) {
          this.removeGPUEntity(entityId);
        }
      }
    }

    // Clean up animated units for destroyed entities
    for (const [entityId, animUnit] of this.animatedUnits) {
      if (!this._currentIds.has(entityId)) {
        this.scene.remove(animUnit.mesh);
        animUnit.mixer.stopAllAction();
        // Properly clean up mixer caches to prevent memory leaks
        animUnit.mixer.uncacheRoot(animUnit.mesh);
        // Dispose materials but NOT geometry (geometry is shared with asset cache)
        animUnit.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            } else if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
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

  private createHealthBar(): THREE.Group {
    const group = new THREE.Group();

    // FIX: Use shared geometry to avoid per-unit allocation (reduces GC pressure)
    // Background uses shared geometry and material
    const bg = new THREE.Mesh(this.healthBarBgGeometry, this.healthBarBgMaterial);
    group.add(bg);

    // Health fill uses shared geometry but needs unique material for color changes
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
    });
    const fill = new THREE.Mesh(this.healthBarFillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'healthFill';
    group.add(fill);

    // Make health bar always face camera
    group.lookAt(0, 100, 0);

    return group;
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;

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
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // FIX: Don't dispose shared geometry (health bar bg/fill geometry)
        // Only dispose geometry if it's NOT one of the shared instances
        if (child.geometry !== this.healthBarBgGeometry &&
            child.geometry !== this.healthBarFillGeometry) {
          child.geometry.dispose();
        }
        // Dispose materials (except shared healthBarBgMaterial)
        if (child.material instanceof THREE.Material) {
          if (child.material !== this.healthBarBgMaterial) {
            child.material.dispose();
          }
        } else if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            if (m !== this.healthBarBgMaterial) m.dispose();
          });
        }
      }
    });
  }

  /**
   * Clear all cached meshes so they get recreated with updated assets on next update.
   */
  public refreshAllMeshes(): void {
    debugAssets.log('[UnitRenderer] Refreshing all unit meshes...');

    // Clear instanced groups
    // NOTE: Do NOT dispose geometry here - it's shared with the asset cache.
    // Disposing shared geometry causes WebGPU "setIndexBuffer" errors when
    // other meshes try to use the now-invalid GPU buffer.
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      // Dispose velocity buffer attributes to prevent memory leak
      disposeInstancedVelocity(group.mesh);
      // Only dispose materials (they are cloned per-instance group)
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      } else if (Array.isArray(group.mesh.material)) {
        group.mesh.material.forEach(m => m.dispose());
      }
    }
    this.instancedGroups.clear();

    // Clear animated units
    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      animUnit.mixer.stopAllAction();
      animUnit.mixer.uncacheRoot(animUnit.mesh);
      // Dispose materials but NOT geometry (shared with asset cache)
      animUnit.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          } else if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          }
        }
      });
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    // Clear overlays (health bars only - selection rings and team markers are instanced)
    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.healthBar);
      this.disposeGroup(overlay.healthBar);
    }
    this.unitOverlays.clear();

    // Clear instanced overlay groups
    for (const group of this.selectionRingGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.selectionRingGroups.clear();

    for (const group of this.teamMarkerGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.teamMarkerGroups.clear();

    // Clear visual rotation tracking
    this.visualRotations.clear();
    this.selectedUnits.clear();
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
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
    this.enemySelectionMaterial.dispose();
    this.teamMarkerGeometry.dispose();

    // NOTE: Do NOT dispose geometry - it's shared with the asset cache
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      // Dispose velocity buffer attributes to prevent memory leak
      disposeInstancedVelocity(group.mesh);
      // Only dispose materials
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      } else if (Array.isArray(group.mesh.material)) {
        group.mesh.material.forEach(m => m.dispose());
      }
    }
    this.instancedGroups.clear();

    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      animUnit.mixer.stopAllAction();
      animUnit.mixer.uncacheRoot(animUnit.mesh);
      // Dispose materials but NOT geometry (shared with asset cache)
      animUnit.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          } else if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          }
        }
      });
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    // Dispose health bars (selection rings and team markers are instanced)
    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.healthBar);
      this.disposeGroup(overlay.healthBar);
    }
    this.unitOverlays.clear();

    // Dispose instanced overlay groups
    for (const group of this.selectionRingGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.selectionRingGroups.clear();

    for (const group of this.teamMarkerGroups.values()) {
      this.scene.remove(group.mesh);
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.teamMarkerGroups.clear();

    // Clear visual rotation tracking
    this.visualRotations.clear();
    this.selectedUnits.clear();
    this.visibleUnits.clear();

    // Dispose GPU-driven rendering resources
    this.gpuUnitBuffer?.dispose();
    this.gpuUnitBuffer = null;
    this.cullingCompute?.dispose();
    this.cullingCompute = null;
    this.gpuIndirectRenderer?.dispose();
    this.gpuIndirectRenderer = null;
    this.gpuManagedEntities.clear();
    this.gpuRegisteredUnitTypes.clear();
    this.webgpuRenderer = null;
    this.gpuCullingInitialized = false;
    this.gpuIndirectInitialized = false;
  }
}
