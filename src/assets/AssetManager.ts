/**
 * VOIDSTRIKE Asset Manager
 *
 * Easy system for generating and loading 3D assets for buildings, units, workers, and map objects.
 *
 * USAGE:
 * 1. Procedural Assets (built-in):
 *    const mesh = AssetManager.getUnitMesh('fabricator');
 *    const building = AssetManager.getBuildingMesh('headquarters');
 *
 * 2. Custom GLTF/GLB Models:
 *    await AssetManager.loadGLTF('/models/custom_unit.glb', 'my_unit');
 *    const mesh = AssetManager.getCustomMesh('my_unit');
 *
 * 3. Replace default assets:
 *    AssetManager.registerCustomAsset('fabricator', myCustomFabricatorMesh);
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { debugAssets } from '@/utils/debugLogger';
import { gltfWorkerManager } from './GLTFWorkerManager';

// Reference Frame Contract Constants
// Per threejs-builder skill: document these upfront to avoid reference-frame bugs
export const REFERENCE_FRAME = {
  // World axes: +X right, +Y up, +Z toward camera (Three.js default)
  // GLTF models from Blender face +Z by default (Blender's -Y forward becomes GLTF's +Z)
  // Rotate by -π/2 to convert +Z forward to +X forward (matching atan2 convention where 0 = +X)
  MODEL_FORWARD_OFFSET: -Math.PI / 2, // radians - rotate GLTF models from +Z to +X

  // Unit scale: 1 unit = ~1 meter
  UNIT_HEIGHTS: {
    fabricator: 1.0,
    trooper: 1.2,
    breacher: 1.5,
    medic: 1.2,
    devastator: 1.8, // 1.5x larger
    valkyrie: 1.8,
    specter: 1.5,
    dreadnought: 15.0, // 6x larger - massive capital ship
  } as Record<string, number>,

  BUILDING_HEIGHTS: {
    headquarters: 4.5,
    supply_cache: 0.9, // Reduced to half size
    infantry_bay: 2.8,
    extractor: 2.5, // Proper extractor height
    forge: 4.2, // Increased by 50%
    hangar: 2.2,
  } as Record<string, number>,

  // Anchor mode: units/buildings have bottom at y=0 (minY anchor)
  ANCHOR_MODE: 'minY' as const,
};

// ============================================================================
// LOD (Level of Detail) Constants
// ============================================================================

/** Available LOD levels */
export type LODLevel = 0 | 1 | 2;

/** Default distance thresholds for LOD switching (in world units) */
export const DEFAULT_LOD_DISTANCES = {
  LOD0_MAX: 50,   // Use LOD0 (highest detail) within 50 units
  LOD1_MAX: 120,  // Use LOD1 (medium detail) between 50-120 units
  // Beyond 120 units, use LOD2 (lowest detail)
} as const;

// Asset definition types
export interface AssetDefinition {
  id: string;
  type: 'unit' | 'building' | 'resource' | 'decoration' | 'projectile';
  scale: number;
  heightOffset: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

// ============================================================================
// Asset Configuration Types (loaded from public/config/assets.json)
// ============================================================================

/** Animation mapping config - maps game actions to animation clip names */
export interface AnimationMappingConfig {
  idle?: string[];
  walk?: string[];
  attack?: string[];
  death?: string[];
  construct?: string[];
  liftoff?: string[];
  land?: string[];
  train?: string[];
  produce?: string[];
  launch?: string[];
  [key: string]: string[] | undefined; // Allow custom animation types
}

/** Rendering hints for decorations (per-model visual settings) */
export interface RenderingHints {
  envMapIntensity?: number;
  emissive?: string | null;
  emissiveIntensity?: number;
  roughnessOverride?: number | null;
  metalnessOverride?: number | null;
  receiveShadow?: boolean;
  castShadow?: boolean;
  pulseSpeed?: number;
  pulseAmplitude?: number;
  attachLight?: {
    color: string;
    intensity: number;
    distance: number;
  } | null;
}

/** Rotation config supporting all 3 axes */
export interface RotationConfig {
  x?: number; // X-axis rotation offset in degrees (default: 0)
  y?: number; // Y-axis rotation offset in degrees (default: 0)
  z?: number; // Z-axis rotation offset in degrees (default: 0)
}

// ============================================================================
// Vehicle Effects Configuration Types (for VehicleEffectsSystem)
// ============================================================================

/** Conditions under which a vehicle effect is emitted */
export type VehicleEffectCondition = 'always' | 'moving' | 'idle' | 'attacking' | 'flying';

/** Types of vehicle effects that can be attached */
export type VehicleEffectType =
  | 'engine_exhaust'    // Fire + smoke for engines
  | 'thruster'          // Blue/energy thruster glow
  | 'smoke_trail'       // Trailing smoke
  | 'dust_cloud'        // Ground dust behind wheels/tracks
  | 'afterburner'       // Intense engine fire
  | 'hover_dust'        // Dust from hovering/landing
  | 'sparks';           // Mechanical sparks

/** Attachment point for an effect (local coordinates relative to unit) */
export interface EffectAttachment {
  x: number;      // Local offset X (right/left)
  y: number;      // Local offset Y (up/down)
  z: number;      // Local offset Z (front/back)
  scale?: number; // Size multiplier for this attachment (default: 1.0)
}

/** Definition for a single vehicle effect */
export interface VehicleEffectDefinition {
  type: VehicleEffectType;
  attachments: EffectAttachment[];
  emitRate: number;           // Particles per second per attachment
  conditions: VehicleEffectCondition[];
  speedScale?: boolean;       // Scale emit rate with movement speed
}

/** Container for all effects on a unit */
export interface UnitEffectsConfig {
  effects?: Record<string, VehicleEffectDefinition>;
}

/** Single asset configuration */
export interface AssetConfig {
  model: string;
  height?: number; // Target height in game units - model is scaled to this height (optional)
  scale?: number; // Additional scale multiplier applied after height normalization (default: 1.0)
  airborneHeight?: number; // For flying units: height above terrain in game units (default: 8)
  animationSpeed?: number;
  rotation?: RotationConfig; // Rotation offset in degrees on all axes
  animations?: AnimationMappingConfig;
  rendering?: RenderingHints; // Per-model rendering hints (decorations)
  effects?: Record<string, VehicleEffectDefinition>; // Vehicle visual effects (engine trails, exhaust, etc.)
}

/** Default airborne height for flying units (units above terrain) */
export const DEFAULT_AIRBORNE_HEIGHT = 8;

/** Full assets.json structure */
export interface AssetsJsonConfig {
  units: Record<string, AssetConfig>;
  buildings: Record<string, AssetConfig>;
  resources: Record<string, AssetConfig>;
  decorations: Record<string, AssetConfig>;
}

// ============================================================================
// Internal State
// ============================================================================

// Cache for loaded/generated assets
const assetCache = new Map<string, THREE.Object3D>();
const customAssets = new Map<string, THREE.Object3D>();

// LOD storage - separate maps for each LOD level
// LOD0 = highest detail (default, stored in customAssets for backwards compatibility)
// LOD1 = medium detail
// LOD2 = lowest detail (for distant objects)
const customAssetsLOD1 = new Map<string, THREE.Object3D>();
const customAssetsLOD2 = new Map<string, THREE.Object3D>();

// Track which LOD levels are available for each asset
const availableLODLevels = new Map<string, Set<number>>();

// Store animations for custom models
const assetAnimations = new Map<string, THREE.AnimationClip[]>();

// Track which assets are animated/skinned (require SkeletonUtils.clone)
const animatedAssets = new Set<string>();

// Store model Y offsets for correct positioning (needed for instanced rendering)
// This offset is applied during normalization to ground the model
const modelYOffsets = new Map<string, number>();

// Callbacks to notify when custom models are loaded
const onModelsLoadedCallbacks: Array<() => void> = [];

// Store loaded asset configuration (from JSON)
let assetsConfig: AssetsJsonConfig | null = null;

// Store animation speed multipliers from config
const animationSpeedMultipliers = new Map<string, number>();

// Store vehicle effects configurations from config
const unitEffectsConfigs = new Map<string, UnitEffectsConfig>();

// Store animation mappings from config for each asset
const animationMappings = new Map<string, AnimationMappingConfig>();

// Store per-asset rotation offsets in degrees (from config) - supports all 3 axes
const assetRotationOffsets = new Map<string, RotationConfig>();

// Store per-asset scale multipliers (from config)
const assetScaleMultipliers = new Map<string, number>();

// Store per-asset airborne heights for flying units (from config)
const assetAirborneHeights = new Map<string, number>();

// Store per-asset model heights (from config) - the visual size of the model
const assetModelHeights = new Map<string, number>();

// Store rendering hints for decorations (from config)
const renderingHints = new Map<string, RenderingHints>();

// ============================================================================
// Preloading State (for lobby preloading)
// ============================================================================

// Track preloading state for early loading in lobby
let preloadingStarted = false;
let preloadingComplete = false;
let preloadingPromise: Promise<void> | null = null;
let preloadingProgress = 0; // 0-100

// Callbacks for preloading progress updates
const preloadingProgressCallbacks: Array<(progress: number) => void> = [];

// DRACO loader for compressed meshes (self-hosted for faster loading)
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/'); // Self-hosted decoder - no external CDN latency
dracoLoader.setDecoderConfig({ type: 'js' }); // Use JS decoder for compatibility

// GLTF loader instance with DRACO support
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// WebGPU vertex buffer limit
const WEBGPU_MAX_VERTEX_BUFFERS = 8;

/**
 * Clean up excess vertex attributes from a mesh to stay within WebGPU's 8 vertex buffer limit.
 *
 * WebGPU has a maximum of 8 vertex buffers. Standard attributes include:
 * - position (1)
 * - normal (1)
 * - uv (1) - first UV set only
 * - tangent (1) - for normal mapping
 * - color (1) - if used
 * - skinIndex (1) - for skinned meshes
 * - skinWeight (1) - for skinned meshes
 *
 * Models from AI generators (Tripo, Meshy) often include excess attributes that exceed this limit.
 * This function removes:
 * - Extra UV layers (uv1, uv2, uv3, etc.) - keeps only 'uv'
 * - Extra color layers - keeps only first 'color' attribute
 * - Custom/unknown attributes not in the essential list
 *
 * @param geometry The BufferGeometry to clean up
 * @param isSkinned Whether this is a skinned mesh (needs skinIndex/skinWeight)
 * @returns Object with cleanup stats for debugging
 */
function cleanupVertexAttributes(
  geometry: THREE.BufferGeometry,
  isSkinned: boolean
): { removed: string[]; kept: string[]; originalCount: number } {
  const removed: string[] = [];
  const kept: string[] = [];

  // Essential attributes that should be kept
  const essentialAttributes = new Set([
    'position',
    'normal',
    'uv',       // Only first UV set
    'tangent',
    'color',    // Only first color attribute
  ]);

  // Additional attributes for skinned meshes
  if (isSkinned) {
    essentialAttributes.add('skinIndex');
    essentialAttributes.add('skinWeight');
  }

  // Get all attribute names
  const attributeNames = Object.keys(geometry.attributes);
  const originalCount = attributeNames.length;

  // Check each attribute
  for (const name of attributeNames) {
    // Keep essential attributes
    if (essentialAttributes.has(name)) {
      kept.push(name);
      continue;
    }

    // Remove extra UV layers (uv1, uv2, uv3, _uv1, etc.)
    if (name.match(/^_?uv\d+$/i) || name.match(/^texcoord_?\d+$/i)) {
      geometry.deleteAttribute(name);
      removed.push(name);
      continue;
    }

    // Remove extra color attributes (color_0, _color_1, etc.)
    if (name.match(/^_?color_?\d+$/i) && name !== 'color') {
      geometry.deleteAttribute(name);
      removed.push(name);
      continue;
    }

    // Remove morph target attributes (they use additional buffers)
    if (name.startsWith('morphTarget') || name.startsWith('morphNormal')) {
      geometry.deleteAttribute(name);
      removed.push(name);
      continue;
    }

    // Remove custom/unknown attributes that start with underscore (common in AI-generated models)
    if (name.startsWith('_')) {
      geometry.deleteAttribute(name);
      removed.push(name);
      continue;
    }

    // Keep anything else we haven't explicitly removed
    kept.push(name);
  }

  return { removed, kept, originalCount };
}

/**
 * Clean up all meshes in a model to ensure WebGPU compatibility.
 * Logs warnings if attribute count still exceeds the limit after cleanup.
 *
 * @param model The Object3D tree to process
 * @param assetId Asset identifier for logging
 */
function cleanupModelAttributes(model: THREE.Object3D, assetId: string): void {
  let totalRemoved = 0;
  let meshCount = 0;

  model.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
      const isSkinned = child instanceof THREE.SkinnedMesh;
      const geometry = child.geometry as THREE.BufferGeometry;

      if (!geometry || !geometry.attributes) return;

      const result = cleanupVertexAttributes(geometry, isSkinned);

      if (result.removed.length > 0) {
        totalRemoved += result.removed.length;
        debugAssets.log(
          `[AssetManager] ${assetId}: Cleaned mesh, removed ${result.removed.length} excess attributes: [${result.removed.join(', ')}]`
        );
      }

      // Warn if still over limit
      const finalCount = result.kept.length;
      if (finalCount > WEBGPU_MAX_VERTEX_BUFFERS) {
        debugAssets.warn(
          `[AssetManager] ${assetId}: Still has ${finalCount} vertex attributes after cleanup (limit: ${WEBGPU_MAX_VERTEX_BUFFERS}). Kept: [${result.kept.join(', ')}]`
        );
      }

      meshCount++;
    }
  });

  if (totalRemoved > 0) {
    debugAssets.log(
      `[AssetManager] ${assetId}: Cleaned ${meshCount} mesh(es), removed ${totalRemoved} total excess vertex attributes for WebGPU compatibility`
    );
  }
}

/**
 * Normalize a model to a target height and anchor to ground (minY = 0)
 * Per threejs-builder skill: use one anchor rule per asset class
 * Stores the Y offset for later use in instanced rendering
 *
 * @param root - The model's root Object3D
 * @param targetHeight - Target height in game units (model will be scaled to this height)
 * @param assetId - Optional asset ID for caching Y offset
 * @param scaleMultiplier - Optional additional scale multiplier applied after height normalization
 */
function normalizeModel(root: THREE.Object3D, targetHeight: number, assetId?: string, scaleMultiplier: number = 1.0): void {
  // Update world matrices first
  root.updateMatrixWorld(true);

  // Get bounds from the entire model
  const box = new THREE.Box3().setFromObject(root);

  // Check if the bounding box is valid
  if (box.isEmpty()) {
    debugAssets.warn('[AssetManager] normalizeModel: Empty bounding box, skipping normalization');
    return;
  }

  const size = box.getSize(new THREE.Vector3());

  // Log model info for debugging
  debugAssets.log(`[AssetManager] Model bounds: size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}), min.y=${box.min.y.toFixed(2)}`);

  // Scale to target height if model has height, then apply scale multiplier
  if (size.y > 0.001) {
    const heightScale = targetHeight / size.y;
    const finalScale = heightScale * scaleMultiplier;
    root.scale.setScalar(finalScale);
    debugAssets.log(`[AssetManager] Applied scale: ${finalScale.toFixed(4)} (height: ${heightScale.toFixed(4)} × multiplier: ${scaleMultiplier.toFixed(2)}) to achieve height ${(targetHeight * scaleMultiplier).toFixed(2)}`);
  }

  // Update matrices after scaling
  root.updateMatrixWorld(true);

  // Recalculate bounds after scaling
  box.setFromObject(root);

  // Ground the model (set bottom at y=0) - minY anchor
  if (isFinite(box.min.y)) {
    root.position.y = -box.min.y;
    debugAssets.log(`[AssetManager] Grounded model: position.y = ${root.position.y.toFixed(4)}`);

    // Store the Y offset for instanced rendering
    if (assetId) {
      modelYOffsets.set(assetId, root.position.y);
      debugAssets.log(`[AssetManager] Stored Y offset for ${assetId}: ${root.position.y.toFixed(4)}`);
    }
  }
}

/**
 * Apply scale multiplier and ground the model (minY = 0)
 * Simpler version of normalizeModel that doesn't change the model's proportions
 *
 * @param root - The model's root Object3D
 * @param assetId - Asset ID for caching Y offset
 * @param scale - Scale multiplier to apply (default: 1.0)
 */
function applyScaleAndGround(root: THREE.Object3D, assetId: string, scale: number = 1.0): void {
  // Update world matrices first
  root.updateMatrixWorld(true);

  // Get bounds from the entire model
  const box = new THREE.Box3().setFromObject(root);

  // Check if the bounding box is valid
  if (box.isEmpty()) {
    debugAssets.warn('[AssetManager] applyScaleAndGround: Empty bounding box, skipping');
    return;
  }

  const size = box.getSize(new THREE.Vector3());

  // Log model info for debugging
  debugAssets.log(`[AssetManager] ${assetId} original bounds: size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}), min.y=${box.min.y.toFixed(2)}`);

  // Apply scale multiplier
  if (scale !== 1.0) {
    root.scale.setScalar(scale);
    debugAssets.log(`[AssetManager] ${assetId} applied scale: ${scale.toFixed(2)} -> final size: ${(size.y * scale).toFixed(2)}`);
  }

  // Update matrices after scaling
  root.updateMatrixWorld(true);

  // Recalculate bounds after scaling
  box.setFromObject(root);

  // Ground the model (set bottom at y=0) - minY anchor
  if (isFinite(box.min.y)) {
    root.position.y = -box.min.y;
    debugAssets.log(`[AssetManager] ${assetId} grounded: position.y = ${root.position.y.toFixed(4)}`);

    // Store the Y offset for instanced rendering
    modelYOffsets.set(assetId, root.position.y);
  }
}

/**
 * Clone a model properly - uses SkeletonUtils for animated/skinned models
 * Per threejs-builder skill: SkeletonUtils.clone() is REQUIRED for animated models
 */
function cloneModel(original: THREE.Object3D, assetId: string): THREE.Object3D {
  if (animatedAssets.has(assetId)) {
    // Animated/skinned model - must use SkeletonUtils
    return SkeletonUtils.clone(original) as THREE.Object3D;
  }
  // Static model - regular clone is fine
  return original.clone();
}

// Standard materials library
export const Materials = {
  // Dominion (Terran-like) faction
  dominion: {
    metal: new THREE.MeshStandardMaterial({
      color: 0x6080a0,
      roughness: 0.4,
      metalness: 0.8,
    }),
    armor: new THREE.MeshStandardMaterial({
      color: 0x4a5a6a,
      roughness: 0.5,
      metalness: 0.6,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x40a0ff,
      roughness: 0.3,
      metalness: 0.4,
      emissive: 0x102030,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x80c0ff,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.6,
    }),
    building: new THREE.MeshStandardMaterial({
      color: 0x505a64,
      roughness: 0.6,
      metalness: 0.5,
    }),
  },

  // Synthesis (Protoss-like) faction
  synthesis: {
    crystal: new THREE.MeshStandardMaterial({
      color: 0x4080ff,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0x102040,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.3,
      metalness: 0.8,
    }),
    energy: new THREE.MeshStandardMaterial({
      color: 0x40ffff,
      roughness: 0.1,
      metalness: 0.2,
      emissive: 0x204040,
      transparent: true,
      opacity: 0.8,
    }),
  },

  // Swarm (Zerg-like) faction
  swarm: {
    chitin: new THREE.MeshStandardMaterial({
      color: 0x4a3040,
      roughness: 0.7,
      metalness: 0.2,
    }),
    flesh: new THREE.MeshStandardMaterial({
      color: 0x6a4050,
      roughness: 0.8,
      metalness: 0.1,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: 0xff4080,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0x401020,
    }),
  },

  // Resources - bright emissive materials for visibility
  resources: {
    mineral: new THREE.MeshStandardMaterial({
      color: 0x60a0ff,
      roughness: 0.2,
      metalness: 0.4,
      emissive: 0x4080ff,
      emissiveIntensity: 0.8,
    }),
    vespene: new THREE.MeshStandardMaterial({
      color: 0x40ff80,
      roughness: 0.2,
      metalness: 0.3,
      emissive: 0x20ff60,
      emissiveIntensity: 0.6,
    }),
  },
};

// Clone a material with a different color (for player colors)
export function colorMaterial(baseMaterial: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const mat = baseMaterial.clone();
  mat.color.setHex(color);
  return mat;
}

/**
 * Asset Manager - Central system for all 3D assets
 */
export class AssetManager {
  /**
   * Get or generate a unit mesh
   * Uses SkeletonUtils.clone() for custom animated models per threejs-builder skill
   */
  static getUnitMesh(unitId: string, playerColor?: number): THREE.Object3D {
    // Check for custom override first
    if (customAssets.has(unitId)) {
      const original = customAssets.get(unitId)!;
      const cloned = cloneModel(original, unitId);

      // Wrap in a parent group so the renderer can position the group
      // while the model maintains its normalization offset
      const wrapper = new THREE.Group();

      // Apply the normalization offset to the cloned model
      cloned.position.copy(original.position);
      cloned.scale.copy(original.scale);
      cloned.rotation.copy(original.rotation);

      // Ensure all meshes are visible and not culled
      let meshCount = 0;
      cloned.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          child.visible = true;
          child.frustumCulled = false;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      wrapper.add(cloned);
      wrapper.updateMatrixWorld(true);

      debugAssets.log(`[AssetManager] Custom ${unitId}: ${meshCount} meshes, inner pos.y=${cloned.position.y.toFixed(3)}, scale=${cloned.scale.x.toFixed(4)}`);

      return wrapper;
    }

    const cacheKey = `unit_${unitId}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateUnit(unitId);
      assetCache.set(cacheKey, mesh);
    }

    const result = assetCache.get(cacheKey)!.clone();

    // Apply scale multiplier from config to procedural meshes
    const scaleMultiplier = assetScaleMultipliers.get(unitId);
    if (scaleMultiplier !== undefined && scaleMultiplier !== 1.0) {
      result.scale.multiplyScalar(scaleMultiplier);
      debugAssets.log(`[AssetManager] Procedural ${unitId}: applied scale multiplier ${scaleMultiplier}`);
    }

    // Apply player color if provided
    if (playerColor !== undefined) {
      result.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.isAccent) {
          const mat = (child.material as THREE.MeshStandardMaterial).clone();
          mat.color.setHex(playerColor);
          child.material = mat;
        }
      });
    }

    return result;
  }

  /**
   * Get or generate a building mesh
   * Uses SkeletonUtils.clone() for custom animated models per threejs-builder skill
   */
  static getBuildingMesh(buildingId: string, playerColor?: number): THREE.Object3D {
    if (customAssets.has(buildingId)) {
      const original = customAssets.get(buildingId)!;
      const cloned = cloneModel(original, buildingId);

      // Wrap in a parent group so the renderer can position the group
      // while the model maintains its normalization offset (same as getUnitMesh)
      const wrapper = new THREE.Group();

      // Apply the normalization offset to the cloned model
      cloned.position.copy(original.position);
      cloned.scale.copy(original.scale);
      cloned.rotation.copy(original.rotation);

      // Ensure all meshes are visible and not culled
      let meshCount = 0;
      cloned.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          child.visible = true;
          child.frustumCulled = false;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      wrapper.add(cloned);
      wrapper.updateMatrixWorld(true);

      debugAssets.log(`[AssetManager] Custom building ${buildingId}: ${meshCount} meshes, inner pos.y=${cloned.position.y.toFixed(3)}, scale=${cloned.scale.x.toFixed(4)}`);

      return wrapper;
    }

    const cacheKey = `building_${buildingId}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateBuilding(buildingId);
      assetCache.set(cacheKey, mesh);
    }

    const result = assetCache.get(cacheKey)!.clone();

    // Apply scale multiplier from config to procedural meshes
    const scaleMultiplier = assetScaleMultipliers.get(buildingId);
    if (scaleMultiplier !== undefined && scaleMultiplier !== 1.0) {
      result.scale.multiplyScalar(scaleMultiplier);
      debugAssets.log(`[AssetManager] Procedural building ${buildingId}: applied scale multiplier ${scaleMultiplier}`);
    }

    if (playerColor !== undefined) {
      result.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.isAccent) {
          const mat = (child.material as THREE.MeshStandardMaterial).clone();
          mat.color.setHex(playerColor);
          child.material = mat;
        }
      });
    }

    return result;
  }

  /**
   * Get or generate a resource mesh
   */
  static getResourceMesh(resourceType: 'minerals' | 'vespene'): THREE.Object3D {
    // Check for custom model first
    if (customAssets.has(resourceType)) {
      const original = customAssets.get(resourceType)!;
      const cloned = cloneModel(original, resourceType);

      const wrapper = new THREE.Group();
      cloned.position.copy(original.position);
      cloned.scale.copy(original.scale);
      cloned.rotation.copy(original.rotation);

      cloned.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.visible = true;
          child.frustumCulled = false;
        }
      });

      wrapper.add(cloned);
      return wrapper;
    }

    const cacheKey = `resource_${resourceType}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateResource(resourceType);
      assetCache.set(cacheKey, mesh);
    }
    return assetCache.get(cacheKey)!.clone();
  }

  /**
   * Get or generate a decoration mesh (trees, rocks, towers)
   */
  static getDecorationMesh(decorationType: string): THREE.Object3D | null {
    // Check for custom model first
    if (customAssets.has(decorationType)) {
      const original = customAssets.get(decorationType)!;
      const cloned = cloneModel(original, decorationType);

      const wrapper = new THREE.Group();
      cloned.position.copy(original.position);
      cloned.scale.copy(original.scale);
      cloned.rotation.copy(original.rotation);

      cloned.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.visible = true;
          child.frustumCulled = false;
        }
      });

      wrapper.add(cloned);
      return wrapper;
    }

    // No procedural fallback for decorations yet
    return null;
  }

  /**
   * Check if a custom decoration model exists
   */
  static hasDecorationModel(decorationType: string): boolean {
    return customAssets.has(decorationType);
  }

  /**
   * Get the original decoration model for instanced rendering (NOT cloned).
   * Returns the cached original model directly - caller must NOT modify it.
   * Use this for InstancedMesh where we need to extract geometry/material once.
   */
  static getDecorationOriginal(decorationType: string): THREE.Object3D | null {
    return customAssets.get(decorationType) ?? null;
  }

  /**
   * Get rendering hints for a decoration type (emissive, envMap, etc.)
   */
  static getRenderingHints(assetId: string): RenderingHints | null {
    return renderingHints.get(assetId) ?? null;
  }

  /**
   * Check if a decoration has emissive properties
   */
  static hasEmissive(assetId: string): boolean {
    const hints = renderingHints.get(assetId);
    return hints?.emissive != null && hints.emissive !== '';
  }

  /**
   * Get or generate a projectile mesh
   */
  static getProjectileMesh(projectileType: string): THREE.Object3D {
    const cacheKey = `projectile_${projectileType}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateProjectile(projectileType);
      assetCache.set(cacheKey, mesh);
    }
    return assetCache.get(cacheKey)!.clone();
  }

  /**
   * Load a custom GLTF/GLB model
   * Per threejs-builder skill: applies scale and tracks if animated
   *
   * Uses Web Worker for network I/O to keep main thread responsive.
   */
  static async loadGLTF(
    url: string,
    assetId: string,
    options: { targetHeight?: number; scale?: number; isAnimated?: boolean } = {}
  ): Promise<THREE.Object3D> {
    // Fetch GLB data via worker (off main thread)
    const arrayBuffer = await gltfWorkerManager.fetch(url);
    if (!arrayBuffer) {
      throw new Error(`Failed to fetch GLB: ${url}`);
    }

    // Parse the GLB data on main thread (Three.js requires main thread for scene graph)
    return new Promise((resolve, reject) => {
      gltfLoader.parse(
        arrayBuffer,
        '', // resource path (not needed for GLB with embedded resources)
        (gltf: GLTF) => {
          const model = gltf.scene;

          // Clean up excess vertex attributes for WebGPU compatibility (max 8 buffers)
          // This must happen BEFORE any other processing to avoid render pipeline errors
          cleanupModelAttributes(model, assetId);

          // Configure shadows
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Track if animated (has animations or skinned meshes)
          const hasAnimations = gltf.animations && gltf.animations.length > 0;
          let hasSkinning = false;
          model.traverse((child) => {
            if (child instanceof THREE.SkinnedMesh) {
              hasSkinning = true;
            }
          });

          if (options.isAnimated || hasAnimations || hasSkinning) {
            animatedAssets.add(assetId);
            debugAssets.log(`[AssetManager] Registered ${assetId} as animated model`);
          }

          // Log animation names and store them per threejs-builder skill
          if (hasAnimations) {
            debugAssets.log(`[AssetManager] ${assetId} animations:`, gltf.animations.map(a => a.name));
            assetAnimations.set(assetId, gltf.animations);
          }

          // Apply scale (normalize model to target size in game units)
          // If targetHeight is provided, use it for normalization with scale as multiplier
          // Otherwise, use scale directly as the target size
          const targetHeight = options.targetHeight ?? options.scale;
          if (targetHeight && targetHeight > 0) {
            const scaleMultiplier = options.targetHeight ? (options.scale ?? 1.0) : 1.0;
            normalizeModel(model, targetHeight, assetId, scaleMultiplier);
          } else {
            // Just ground the model without scaling
            applyScaleAndGround(model, assetId, 1.0);
          }

          // Apply model forward offset + per-asset rotation offset on all 3 axes
          // Base Y offset converts GLTF +Z forward to game's +X forward
          // Per-asset offsets allow fixing models that face wrong direction or need tilting
          const baseYOffset = REFERENCE_FRAME.MODEL_FORWARD_OFFSET;
          const assetRotation = assetRotationOffsets.get(assetId) ?? { x: 0, y: 0, z: 0 };
          const xOffsetRadians = (assetRotation.x ?? 0) * (Math.PI / 180);
          const yOffsetRadians = (assetRotation.y ?? 0) * (Math.PI / 180);
          const zOffsetRadians = (assetRotation.z ?? 0) * (Math.PI / 180);
          model.rotation.set(xOffsetRadians, baseYOffset + yOffsetRadians, zOffsetRadians);

          customAssets.set(assetId, model);
          resolve(model);
        },
        (error: unknown) => reject(error)
      );
    });
  }

  /**
   * Load a GLTF model for a specific LOD level (1 or 2).
   * LOD0 is loaded via regular loadGLTF and stored in customAssets.
   *
   * Uses Web Worker for network I/O to keep main thread responsive.
   */
  private static async loadGLTFForLOD(
    url: string,
    assetId: string,
    lodLevel: 1 | 2,
    options: { targetHeight?: number; scale?: number } = {}
  ): Promise<THREE.Object3D> {
    // Fetch GLB data via worker (off main thread)
    const arrayBuffer = await gltfWorkerManager.fetch(url);
    if (!arrayBuffer) {
      throw new Error(`Failed to fetch LOD${lodLevel} GLB: ${url}`);
    }

    return new Promise((resolve, reject) => {
      gltfLoader.parse(
        arrayBuffer,
        '',
        (gltf: GLTF) => {
          const model = gltf.scene;

          // Clean up excess vertex attributes for WebGPU compatibility (max 8 buffers)
          cleanupModelAttributes(model, `${assetId}_LOD${lodLevel}`);

          // Configure shadows (same as LOD0)
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Apply scale (normalize model to target size) - same as LOD0
          const targetHeight = options.targetHeight ?? options.scale;
          if (targetHeight && targetHeight > 0) {
            const scaleMultiplier = options.targetHeight ? (options.scale ?? 1.0) : 1.0;
            normalizeModel(model, targetHeight, `${assetId}_LOD${lodLevel}`, scaleMultiplier);
          } else {
            applyScaleAndGround(model, `${assetId}_LOD${lodLevel}`, 1.0);
          }

          // Apply model forward offset + per-asset rotation offset on all 3 axes (same as LOD0)
          const baseYOffset = REFERENCE_FRAME.MODEL_FORWARD_OFFSET;
          const assetRotation = assetRotationOffsets.get(assetId) ?? { x: 0, y: 0, z: 0 };
          const xOffsetRadians = (assetRotation.x ?? 0) * (Math.PI / 180);
          const yOffsetRadians = (assetRotation.y ?? 0) * (Math.PI / 180);
          const zOffsetRadians = (assetRotation.z ?? 0) * (Math.PI / 180);
          model.rotation.set(xOffsetRadians, baseYOffset + yOffsetRadians, zOffsetRadians);

          // Store in the appropriate LOD map
          if (lodLevel === 1) {
            customAssetsLOD1.set(assetId, model);
          } else {
            customAssetsLOD2.set(assetId, model);
          }

          resolve(model);
        },
        (error: unknown) => reject(error)
      );
    });
  }

  /**
   * Register a custom mesh to replace a default asset
   */
  static registerCustomAsset(assetId: string, mesh: THREE.Object3D): void {
    customAssets.set(assetId, mesh);
  }

  /**
   * Get a custom mesh by ID
   * Uses SkeletonUtils.clone() for animated models per threejs-builder skill
   */
  static getCustomMesh(assetId: string): THREE.Object3D | null {
    const asset = customAssets.get(assetId);
    return asset ? cloneModel(asset, assetId) : null;
  }

  /**
   * Get animations for an asset
   */
  static getAnimations(assetId: string): THREE.AnimationClip[] {
    return assetAnimations.get(assetId) || [];
  }

  /**
   * Check if an asset has animations
   */
  static hasAnimations(assetId: string): boolean {
    return animatedAssets.has(assetId);
  }

  /**
   * Get the Y offset for a model (used for instanced rendering positioning)
   * This offset is applied during normalization to ground the model
   */
  static getModelYOffset(assetId: string): number {
    return modelYOffsets.get(assetId) ?? 0;
  }

  /**
   * Get the rotation offset for a model in radians (all 3 axes)
   * Combines base MODEL_FORWARD_OFFSET with per-asset rotation from config
   * Returns { x, y, z } in radians
   */
  static getModelRotation(assetId: string): { x: number; y: number; z: number } {
    const baseYOffset = REFERENCE_FRAME.MODEL_FORWARD_OFFSET;
    const assetRotation = assetRotationOffsets.get(assetId) ?? { x: 0, y: 0, z: 0 };
    return {
      x: (assetRotation.x ?? 0) * (Math.PI / 180),
      y: baseYOffset + (assetRotation.y ?? 0) * (Math.PI / 180),
      z: (assetRotation.z ?? 0) * (Math.PI / 180),
    };
  }

  /**
   * Get just the Y-axis rotation offset for a model in radians
   * Used for instanced rendering where only Y rotation is applied at runtime
   */
  static getModelRotationY(assetId: string): number {
    const baseYOffset = REFERENCE_FRAME.MODEL_FORWARD_OFFSET;
    const assetRotation = assetRotationOffsets.get(assetId) ?? { x: 0, y: 0, z: 0 };
    return baseYOffset + (assetRotation.y ?? 0) * (Math.PI / 180);
  }

  /**
   * Get the airborne height for a flying unit (height above terrain in game units).
   * Returns the configured value from assets.json, or DEFAULT_AIRBORNE_HEIGHT (8) if not specified.
   * This controls how HIGH a flying unit hovers, independent of its visual size.
   */
  static getAirborneHeight(assetId: string): number {
    return assetAirborneHeights.get(assetId) ?? DEFAULT_AIRBORNE_HEIGHT;
  }

  /**
   * Get the model height for an asset (visual size in game units).
   * Returns the configured value from assets.json, or 1.5 as default.
   * This is the height the model is scaled to, useful for positioning overlays.
   */
  static getModelHeight(assetId: string): number {
    return assetModelHeights.get(assetId) ?? 1.5;
  }

  /**
   * Get the scale multiplier for an asset.
   * Returns 1.0 if not configured. This is applied after height normalization.
   */
  static getScaleMultiplier(assetId: string): number {
    return assetScaleMultipliers.get(assetId) ?? 1.0;
  }

  /**
   * Get vehicle effects configuration for a unit.
   * Returns the effects config from assets.json, or null if no effects defined.
   * Used by VehicleEffectsSystem for engine trails, exhaust, dust, etc.
   */
  static getUnitEffects(assetId: string): UnitEffectsConfig | null {
    const result = unitEffectsConfigs.get(assetId) ?? null;
    console.log(`[AssetManager] getUnitEffects('${assetId}') - map size: ${unitEffectsConfigs.size}, result:`, result);
    return result;
  }

  /**
   * Get the final scale for a unit (for attachment point positioning).
   * This is the scale multiplier from config, used to position effects correctly.
   */
  static getUnitScale(assetId: string): number {
    return assetScaleMultipliers.get(assetId) ?? 1.0;
  }

  // ============================================================================
  // LOD (Level of Detail) Methods
  // ============================================================================

  /**
   * Get available LOD levels for an asset.
   * Returns a Set containing 0, 1, and/or 2 depending on what's loaded.
   */
  static getAvailableLODLevels(assetId: string): Set<number> {
    return availableLODLevels.get(assetId) ?? new Set([0]);
  }

  /**
   * Check if an asset has a specific LOD level available.
   */
  static hasLODLevel(assetId: string, level: LODLevel): boolean {
    const levels = availableLODLevels.get(assetId);
    if (!levels) return level === 0 && customAssets.has(assetId);
    return levels.has(level);
  }

  /**
   * Get the best available LOD level for a given distance.
   * Falls back to the closest available LOD if the ideal one isn't loaded.
   */
  static getBestLODForDistance(
    assetId: string,
    distance: number,
    lodDistances: { LOD0_MAX: number; LOD1_MAX: number } = DEFAULT_LOD_DISTANCES
  ): LODLevel {
    // Determine ideal LOD based on distance
    let idealLOD: LODLevel;
    if (distance <= lodDistances.LOD0_MAX) {
      idealLOD = 0;
    } else if (distance <= lodDistances.LOD1_MAX) {
      idealLOD = 1;
    } else {
      idealLOD = 2;
    }

    // Check if ideal LOD is available
    const levels = availableLODLevels.get(assetId);
    if (!levels) return 0; // Only LOD0 available (or procedural)

    if (levels.has(idealLOD)) return idealLOD;

    // Fall back to closest available LOD
    if (idealLOD === 2) {
      // Wanted LOD2, try LOD1, then LOD0
      if (levels.has(1)) return 1;
      return 0;
    } else if (idealLOD === 1) {
      // Wanted LOD1, try LOD2 (lower detail ok), then LOD0
      if (levels.has(2)) return 2;
      return 0;
    }

    return 0;
  }

  /**
   * Get the original model at a specific LOD level (NOT cloned).
   * Returns the cached original model - caller must NOT modify it.
   * Use for InstancedMesh where we extract geometry/material once.
   */
  static getModelOriginalAtLOD(assetId: string, lodLevel: LODLevel): THREE.Object3D | null {
    switch (lodLevel) {
      case 0:
        return customAssets.get(assetId) ?? null;
      case 1:
        return customAssetsLOD1.get(assetId) ?? customAssets.get(assetId) ?? null;
      case 2:
        return customAssetsLOD2.get(assetId) ?? customAssetsLOD1.get(assetId) ?? customAssets.get(assetId) ?? null;
      default:
        return null;
    }
  }

  /**
   * Get a cloned model at a specific LOD level.
   * Uses SkeletonUtils.clone() for animated models.
   */
  static getModelAtLOD(assetId: string, lodLevel: LODLevel): THREE.Object3D | null {
    const original = this.getModelOriginalAtLOD(assetId, lodLevel);
    if (!original) return null;

    // Use skeleton-aware cloning for animated assets
    if (animatedAssets.has(assetId)) {
      return SkeletonUtils.clone(original);
    }
    return original.clone();
  }

  /**
   * Clear all cached assets (useful for hot-reloading)
   */
  static clearCache(): void {
    assetCache.clear();
  }

  // ============================================================================
  // Lobby Preloading Methods
  // ============================================================================

  /**
   * Start preloading assets in the background (call from lobby/setup page).
   * This allows assets to load while players configure game settings.
   * Returns a promise that resolves when preloading is complete.
   *
   * Safe to call multiple times - subsequent calls return the existing promise.
   */
  static startPreloading(): Promise<void> {
    if (preloadingPromise) {
      return preloadingPromise;
    }

    preloadingStarted = true;
    debugAssets.log('[AssetManager] Starting lobby preloading...');

    preloadingPromise = this.loadCustomModels((processed, total) => {
      preloadingProgress = Math.round((processed / total) * 100);
      // Notify all progress listeners
      for (const callback of preloadingProgressCallbacks) {
        callback(preloadingProgress);
      }
    }).then(() => {
      preloadingComplete = true;
      preloadingProgress = 100;
      debugAssets.log('[AssetManager] Lobby preloading complete');
    });

    return preloadingPromise;
  }

  /**
   * Check if preloading has already started.
   */
  static isPreloadingStarted(): boolean {
    return preloadingStarted;
  }

  /**
   * Check if preloading is complete.
   */
  static isPreloadingComplete(): boolean {
    return preloadingComplete;
  }

  /**
   * Get the current preloading progress (0-100).
   */
  static getPreloadingProgress(): number {
    return preloadingProgress;
  }

  /**
   * Wait for preloading to complete.
   * If preloading hasn't started, starts it automatically.
   * Returns immediately if already complete.
   */
  static async waitForPreloading(): Promise<void> {
    console.log('[AssetManager] waitForPreloading() called, complete:', preloadingComplete, 'started:', preloadingStarted);
    if (preloadingComplete) {
      console.log('[AssetManager] waitForPreloading() returning early - already complete, unitEffectsConfigs size:', unitEffectsConfigs.size);
      return;
    }

    if (!preloadingStarted) {
      console.log('[AssetManager] waitForPreloading() starting preloading...');
      return this.startPreloading();
    }

    console.log('[AssetManager] waitForPreloading() waiting for existing promise...');
    return preloadingPromise || Promise.resolve();
  }

  /**
   * Register a callback to receive preloading progress updates.
   * Callback receives progress as 0-100.
   */
  static onPreloadingProgress(callback: (progress: number) => void): void {
    preloadingProgressCallbacks.push(callback);
    // Immediately call with current progress if preloading is in progress
    if (preloadingStarted) {
      callback(preloadingProgress);
    }
  }

  /**
   * Preload all common assets for better performance
   */
  static preloadCommonAssets(): void {
    // Units
    ['fabricator', 'trooper', 'breacher', 'medic', 'devastator', 'valkyrie', 'specter'].forEach(id => {
      this.getUnitMesh(id);
    });

    // Buildings
    ['headquarters', 'supply_cache', 'infantry_bay', 'extractor', 'forge', 'hangar'].forEach(id => {
      this.getBuildingMesh(id);
    });

    // Resources
    this.getResourceMesh('minerals');
    this.getResourceMesh('vespene');

    // Projectiles
    ['bullet', 'missile', 'laser'].forEach(id => {
      this.getProjectileMesh(id);
    });
  }

  /**
   * Register a callback to be called when custom models finish loading.
   * Used by renderers to refresh meshes with new custom models.
   */
  static onModelsLoaded(callback: () => void): void {
    onModelsLoadedCallbacks.push(callback);
  }

  /**
   * Get animation mappings for an asset (from JSON config).
   * Returns the configured mapping of game actions to animation clip names.
   */
  static getAnimationMappings(assetId: string): AnimationMappingConfig | null {
    return animationMappings.get(assetId) ?? null;
  }

  /**
   * Get animation speed multiplier for an asset (from JSON config).
   * Returns 1.0 if not configured.
   */
  static getAnimationSpeed(assetId: string): number {
    return animationSpeedMultipliers.get(assetId) ?? 1.0;
  }

  /**
   * Get the loaded assets configuration.
   * Returns null if config hasn't been loaded yet.
   */
  static getConfig(): AssetsJsonConfig | null {
    return assetsConfig;
  }

  /**
   * Load asset configuration from public/config/assets.json.
   * This should be called before loadCustomModels().
   */
  static async loadConfig(): Promise<AssetsJsonConfig | null> {
    console.log('[AssetManager] loadConfig() called, assetsConfig =', !!assetsConfig);
    if (assetsConfig) {
      console.log('[AssetManager] loadConfig() returning early - already loaded');
      return assetsConfig; // Already loaded
    }

    try {
      console.log('[AssetManager] loadConfig() fetching /config/assets.json...');
      const response = await fetch('/config/assets.json');
      if (!response.ok) {
        console.warn('[AssetManager] Could not load assets.json, status:', response.status);
        debugAssets.warn('[AssetManager] Could not load assets.json, using defaults');
        return null;
      }

      assetsConfig = await response.json();
      console.log('[AssetManager] Loaded asset configuration from assets.json, units:', Object.keys(assetsConfig?.units || {}));
      debugAssets.log('[AssetManager] Loaded asset configuration from assets.json');

      // Extract animation speeds and mappings from config
      if (assetsConfig) {
        // Process units
        const unitEntries = Object.entries(assetsConfig.units);
        console.log(`[AssetManager] Processing ${unitEntries.length} units from config`);
        for (const [assetId, config] of unitEntries) {
          console.log(`[AssetManager] Processing unit: ${assetId}, has effects:`, !!config.effects);
          if (config.animationSpeed !== undefined) {
            animationSpeedMultipliers.set(assetId, config.animationSpeed);
          }
          if (config.animations) {
            animationMappings.set(assetId, config.animations);
          }
          // Store vehicle effects configuration if defined
          if (config.effects) {
            unitEffectsConfigs.set(assetId, { effects: config.effects });
            console.log(`[AssetManager] Loaded ${Object.keys(config.effects).length} effects for ${assetId}`);
          }
        }
        // Process buildings
        for (const [assetId, config] of Object.entries(assetsConfig.buildings)) {
          if (config.animationSpeed !== undefined) {
            animationSpeedMultipliers.set(assetId, config.animationSpeed);
          }
          if (config.animations) {
            animationMappings.set(assetId, config.animations);
          }
        }
        // Process resources
        for (const [assetId, config] of Object.entries(assetsConfig.resources)) {
          if (config.animationSpeed !== undefined) {
            animationSpeedMultipliers.set(assetId, config.animationSpeed);
          }
          if (config.animations) {
            animationMappings.set(assetId, config.animations);
          }
        }

        console.log(`[AssetManager] loadConfig() complete. unitEffectsConfigs size: ${unitEffectsConfigs.size}`);
      }

      return assetsConfig;
    } catch (error) {
      debugAssets.warn('[AssetManager] Error loading assets.json:', error);
      return null;
    }
  }

  /**
   * Load custom 3D models from public/models folder
   * Replaces procedural meshes with custom GLB models when available
   * Logs animation names to console for debugging
   *
   * Models and their configurations are loaded from public/config/assets.json.
   * If assets.json doesn't exist, falls back to hardcoded defaults.
   *
   * @param onProgress Optional callback for loading progress (loaded: number, total: number, assetId: string) - can be async
   */
  static async loadCustomModels(
    onProgress?: (loaded: number, total: number, assetId: string) => void | Promise<void>
  ): Promise<void> {
    // Try to load config from JSON first
    await this.loadConfig();

    // Build model list from config or use hardcoded defaults
    const customModels: Array<{ path: string; assetId: string; targetHeight?: number; scale?: number }> = [];

    if (!assetsConfig) {
      debugAssets.warn('[AssetManager] assets.json not found, using procedural meshes only');
      return;
    }

    debugAssets.log('[AssetManager] Building model list from assets.json');

    // Add units from config
    for (const [assetId, config] of Object.entries(assetsConfig.units)) {
      customModels.push({
        path: config.model,
        assetId,
        targetHeight: config.height,
        scale: config.scale,
      });
      // Store rotation offset if specified (in degrees)
      if (config.rotation !== undefined) {
        assetRotationOffsets.set(assetId, config.rotation);
      }
      // Store scale multiplier if specified
      if (config.scale !== undefined) {
        assetScaleMultipliers.set(assetId, config.scale);
      }
      // Store airborne height if specified (for flying units)
      if (config.airborneHeight !== undefined) {
        assetAirborneHeights.set(assetId, config.airborneHeight);
      }
      // Store model height for overlay positioning (use height if set, otherwise scale)
      const modelHeight = config.height ?? config.scale;
      if (modelHeight !== undefined) {
        assetModelHeights.set(assetId, modelHeight);
      }
    }

    // Add buildings from config
    for (const [assetId, config] of Object.entries(assetsConfig.buildings)) {
      customModels.push({
        path: config.model,
        assetId,
        targetHeight: config.height,
        scale: config.scale,
      });
      if (config.rotation !== undefined) {
        assetRotationOffsets.set(assetId, config.rotation);
      }
      if (config.scale !== undefined) {
        assetScaleMultipliers.set(assetId, config.scale);
      }
      // Store model height for overlay positioning (use height if set, otherwise scale)
      const buildingHeight = config.height ?? config.scale;
      if (buildingHeight !== undefined) {
        assetModelHeights.set(assetId, buildingHeight);
      }
    }

    // Add resources from config
    for (const [assetId, config] of Object.entries(assetsConfig.resources)) {
      customModels.push({
        path: config.model,
        assetId,
        targetHeight: config.height,
        scale: config.scale,
      });
      if (config.rotation !== undefined) {
        assetRotationOffsets.set(assetId, config.rotation);
      }
      if (config.scale !== undefined) {
        assetScaleMultipliers.set(assetId, config.scale);
      }
    }

    // Add decorations from config
    for (const [assetId, config] of Object.entries(assetsConfig.decorations)) {
      customModels.push({
        path: config.model,
        assetId,
        targetHeight: config.height,
        scale: config.scale,
      });
      if (config.rotation !== undefined) {
        assetRotationOffsets.set(assetId, config.rotation);
      }
      if (config.scale !== undefined) {
        assetScaleMultipliers.set(assetId, config.scale);
      }
      // Store rendering hints for this decoration
      if (config.rendering) {
        renderingHints.set(assetId, config.rendering);
      }
    }

    debugAssets.log('[AssetManager] Loading custom models with LOD support (parallel)...');
    const totalModels = customModels.length;
    let processedCount = 0;
    let loadedCount = 0;

    // Concurrency limit for parallel loading (saturate connection without overwhelming)
    const CONCURRENCY_LIMIT = 8;

    /**
     * Load a single model with all its LOD levels
     * Uses worker for network I/O - no HEAD requests needed (worker handles 404s gracefully)
     */
    const loadModelWithLODs = async (model: { path: string; assetId: string; targetHeight?: number; scale?: number }): Promise<boolean> => {
      try {
        const lod0Path = model.path;
        const lod1Path = lod0Path.replace('_LOD0.glb', '_LOD1.glb');
        const lod2Path = lod0Path.replace('_LOD0.glb', '_LOD2.glb');

        // Initialize LOD level tracking
        const lodLevels = new Set<number>();

        // Load LOD0 first (required) - this will throw if file doesn't exist
        try {
          await this.loadGLTF(lod0Path, model.assetId, { targetHeight: model.targetHeight, scale: model.scale });
          lodLevels.add(0);
        } catch {
          // LOD0 doesn't exist - use procedural mesh
          debugAssets.log(`[AssetManager] No custom model found at ${lod0Path}, using procedural mesh`);
          return false;
        }

        // Load LOD1 and LOD2 in parallel (optional, silent fail)
        // No HEAD requests - worker fetch returns null for missing files
        await Promise.all([
          this.loadGLTFForLOD(lod1Path, model.assetId, 1, { targetHeight: model.targetHeight, scale: model.scale })
            .then(() => { lodLevels.add(1); })
            .catch(() => { /* LOD1 not available */ }),
          this.loadGLTFForLOD(lod2Path, model.assetId, 2, { targetHeight: model.targetHeight, scale: model.scale })
            .then(() => { lodLevels.add(2); })
            .catch(() => { /* LOD2 not available */ }),
        ]);

        // Store available LOD levels for this asset
        availableLODLevels.set(model.assetId, lodLevels);
        debugAssets.log(`[AssetManager] ✓ Loaded ${model.assetId} with LOD levels: [${Array.from(lodLevels).join(', ')}]`);
        return true;
      } catch (error) {
        debugAssets.log(`[AssetManager] Could not load ${model.path}:`, error);
        return false;
      }
    };

    /**
     * Process models in parallel with concurrency limit
     */
    const processBatch = async (batch: typeof customModels): Promise<number> => {
      const results = await Promise.all(batch.map(loadModelWithLODs));
      return results.filter(Boolean).length;
    };

    // Process models in concurrent batches
    const startTime = performance.now();
    for (let i = 0; i < customModels.length; i += CONCURRENCY_LIMIT) {
      const batch = customModels.slice(i, i + CONCURRENCY_LIMIT);
      const batchLoaded = await processBatch(batch);
      loadedCount += batchLoaded;
      processedCount += batch.length;

      // Report progress after each batch
      if (onProgress) {
        for (const model of batch) {
          await onProgress(processedCount, totalModels, model.assetId);
        }
      }
    }
    const loadTime = performance.now() - startTime;
    debugAssets.log(`[AssetManager] Parallel loading completed in ${loadTime.toFixed(0)}ms (${CONCURRENCY_LIMIT} concurrent)`)

    // Log LOD summary
    let lodSummary = '[AssetManager] LOD Summary: ';
    let assetsWithAllLODs = 0;
    let assetsWithSomeLODs = 0;
    for (const [assetId, levels] of availableLODLevels) {
      if (levels.size === 3) assetsWithAllLODs++;
      else if (levels.size > 1) assetsWithSomeLODs++;
    }
    lodSummary += `${assetsWithAllLODs} assets with full LOD (0/1/2), ${assetsWithSomeLODs} with partial LOD`;
    debugAssets.log(lodSummary);

    debugAssets.log(`[AssetManager] Custom model loading complete (${loadedCount} models loaded)`);

    // Notify all listeners that models have been loaded
    if (loadedCount > 0) {
      debugAssets.log(`[AssetManager] Notifying ${onModelsLoadedCallbacks.length} listeners to refresh meshes`);
      for (const callback of onModelsLoadedCallbacks) {
        try {
          callback();
        } catch (err) {
          debugAssets.error('[AssetManager] Error in onModelsLoaded callback:', err);
        }
      }
    }
  }
}

/**
 * Procedural mesh generator for all game assets
 */
export class ProceduralGenerator {
  /**
   * Generate a unit mesh
   */
  static generateUnit(unitId: string): THREE.Group {
    switch (unitId) {
      case 'fabricator':
        return this.generateFabricator();
      case 'trooper':
        return this.generateTrooper();
      case 'breacher':
        return this.generateBreacher();
      case 'medic':
        return this.generateMedic();
      case 'devastator':
        return this.generateDevastator();
      case 'valkyrie':
        return this.generateValkyrie();
      case 'specter':
        return this.generateSpecter();
      case 'dreadnought':
        return this.generateDreadnought();
      default:
        return this.generateGenericUnit();
    }
  }

  /**
   * Generate a building mesh
   */
  static generateBuilding(buildingId: string): THREE.Group {
    switch (buildingId) {
      case 'headquarters':
        return this.generateHeadquarters();
      case 'supply_cache':
        return this.generateSupplyCache();
      case 'infantry_bay':
        return this.generateInfantryBay();
      case 'extractor':
        return this.generateExtractor();
      case 'forge':
        return this.generateForge();
      case 'hangar':
        return this.generateHangar();
      case 'tech_center':
        return this.generateTechCenter();
      case 'arsenal':
        return this.generateArsenal();
      case 'garrison':
        return this.generateGarrison();
      case 'defense_turret':
        return this.generateDefenseTurret();
      default:
        return this.generateGenericBuilding();
    }
  }

  /**
   * Generate resource meshes
   */
  static generateResource(type: 'minerals' | 'vespene'): THREE.Group {
    const group = new THREE.Group();

    if (type === 'minerals') {
      // Blue crystal formation
      for (let i = 0; i < 5; i++) {
        const height = 1 + Math.random() * 1.5;
        const geo = new THREE.ConeGeometry(0.3 + Math.random() * 0.2, height, 6);
        const mesh = new THREE.Mesh(geo, Materials.resources.mineral);
        mesh.position.set(
          (Math.random() - 0.5) * 1.5,
          height / 2,
          (Math.random() - 0.5) * 1.5
        );
        mesh.rotation.set(
          (Math.random() - 0.5) * 0.3,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 0.3
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    } else {
      // Green vespene geyser
      const baseGeo = new THREE.CylinderGeometry(1.2, 1.5, 0.5, 8);
      const base = new THREE.Mesh(baseGeo, Materials.dominion.armor);
      base.position.y = 0.25;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      // Gas plume
      const plumeGeo = new THREE.ConeGeometry(0.5, 2, 8);
      const plume = new THREE.Mesh(plumeGeo, Materials.resources.vespene);
      plume.position.y = 1.5;
      plume.castShadow = true;
      group.add(plume);
    }

    return group;
  }

  /**
   * Generate projectile meshes
   */
  static generateProjectile(type: string): THREE.Group {
    const group = new THREE.Group();

    switch (type) {
      case 'bullet': {
        const geo = new THREE.SphereGeometry(0.1, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        break;
      }
      case 'missile': {
        const bodyGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.5, 8);
        const body = new THREE.Mesh(bodyGeo, Materials.dominion.metal);
        body.rotation.x = Math.PI / 2;
        group.add(body);

        const flameGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.rotation.x = -Math.PI / 2;
        flame.position.z = -0.35;
        group.add(flame);
        break;
      }
      case 'laser': {
        const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        group.add(mesh);
        break;
      }
    }

    return group;
  }

  // === UNIT GENERATORS ===

  private static generateFabricator(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.6, 0.6);
    const body = new THREE.Mesh(bodyGeo, Materials.dominion.armor);
    body.position.y = 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Cockpit
    const cockpitGeo = new THREE.BoxGeometry(0.4, 0.3, 0.3);
    const cockpit = new THREE.Mesh(cockpitGeo, Materials.dominion.glass);
    cockpit.position.set(0.3, 0.7, 0);
    cockpit.castShadow = true;
    group.add(cockpit);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    const leftArm = new THREE.Mesh(armGeo, Materials.dominion.metal);
    leftArm.position.set(-0.2, 0.35, 0.4);
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, Materials.dominion.metal);
    rightArm.position.set(-0.2, 0.35, -0.4);
    rightArm.castShadow = true;
    group.add(rightArm);

    // Tool/drill on one arm
    const drillGeo = new THREE.ConeGeometry(0.1, 0.3, 8);
    const drill = new THREE.Mesh(drillGeo, Materials.dominion.accent);
    drill.userData.isAccent = true;
    drill.position.set(-0.2, 0.1, 0.4);
    drill.rotation.x = Math.PI;
    drill.castShadow = true;
    group.add(drill);

    // Legs/treads
    const treadGeo = new THREE.BoxGeometry(0.6, 0.2, 0.2);
    const leftTread = new THREE.Mesh(treadGeo, Materials.dominion.armor);
    leftTread.position.set(0, 0.1, 0.3);
    leftTread.castShadow = true;
    group.add(leftTread);

    const rightTread = new THREE.Mesh(treadGeo, Materials.dominion.armor);
    rightTread.position.set(0, 0.1, -0.3);
    rightTread.castShadow = true;
    group.add(rightTread);

    return group;
  }

  private static generateTrooper(): THREE.Group {
    const group = new THREE.Group();

    // Body/torso
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.6, 0.4);
    const torso = new THREE.Mesh(torsoGeo, Materials.dominion.armor);
    torso.position.y = 0.6;
    torso.castShadow = true;
    group.add(torso);

    // Head/helmet
    const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const head = new THREE.Mesh(headGeo, Materials.dominion.armor);
    head.position.y = 1.05;
    head.castShadow = true;
    group.add(head);

    // Visor
    const visorGeo = new THREE.BoxGeometry(0.22, 0.08, 0.15);
    const visor = new THREE.Mesh(visorGeo, Materials.dominion.glass);
    visor.position.set(0.1, 1.05, 0);
    group.add(visor);

    // Shoulder pads
    const shoulderGeo = new THREE.BoxGeometry(0.2, 0.15, 0.25);
    const leftShoulder = new THREE.Mesh(shoulderGeo, Materials.dominion.accent);
    leftShoulder.userData.isAccent = true;
    leftShoulder.position.set(0, 0.85, 0.35);
    leftShoulder.castShadow = true;
    group.add(leftShoulder);

    const rightShoulder = new THREE.Mesh(shoulderGeo, Materials.dominion.accent);
    rightShoulder.userData.isAccent = true;
    rightShoulder.position.set(0, 0.85, -0.35);
    rightShoulder.castShadow = true;
    group.add(rightShoulder);

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8);
    const leftArm = new THREE.Mesh(armGeo, Materials.dominion.armor);
    leftArm.position.set(0, 0.5, 0.35);
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, Materials.dominion.armor);
    rightArm.position.set(0, 0.5, -0.35);
    rightArm.castShadow = true;
    group.add(rightArm);

    // Gun
    const gunGeo = new THREE.BoxGeometry(0.5, 0.1, 0.1);
    const gun = new THREE.Mesh(gunGeo, Materials.dominion.metal);
    gun.position.set(0.3, 0.5, 0.35);
    gun.castShadow = true;
    group.add(gun);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8);
    const leftLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    leftLeg.position.set(0, 0.15, 0.15);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    rightLeg.position.set(0, 0.15, -0.15);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    return group;
  }

  private static generateBreacher(): THREE.Group {
    const group = new THREE.Group();

    // Larger, bulkier body
    const torsoGeo = new THREE.BoxGeometry(0.7, 0.8, 0.6);
    const torso = new THREE.Mesh(torsoGeo, Materials.dominion.armor);
    torso.position.y = 0.7;
    torso.castShadow = true;
    group.add(torso);

    // Heavy helmet
    const headGeo = new THREE.BoxGeometry(0.4, 0.35, 0.35);
    const head = new THREE.Mesh(headGeo, Materials.dominion.armor);
    head.position.y = 1.25;
    head.castShadow = true;
    group.add(head);

    // Large shoulder grenade launchers
    const launcherGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.4, 8);
    const leftLauncher = new THREE.Mesh(launcherGeo, Materials.dominion.accent);
    leftLauncher.userData.isAccent = true;
    leftLauncher.position.set(0.1, 0.95, 0.45);
    leftLauncher.rotation.x = Math.PI / 2;
    leftLauncher.castShadow = true;
    group.add(leftLauncher);

    const rightLauncher = new THREE.Mesh(launcherGeo, Materials.dominion.accent);
    rightLauncher.userData.isAccent = true;
    rightLauncher.position.set(0.1, 0.95, -0.45);
    rightLauncher.rotation.x = Math.PI / 2;
    rightLauncher.castShadow = true;
    group.add(rightLauncher);

    // Heavy legs
    const legGeo = new THREE.BoxGeometry(0.2, 0.35, 0.2);
    const leftLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    leftLeg.position.set(0, 0.175, 0.2);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    rightLeg.position.set(0, 0.175, -0.2);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    return group;
  }

  private static generateMedic(): THREE.Group {
    const group = this.generateTrooper();

    // Change color to white/red medical scheme
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material === Materials.dominion.armor) {
          const mat = Materials.dominion.armor.clone();
          mat.color.setHex(0xeeeeee);
          child.material = mat;
        }
        if (child.userData.isAccent) {
          const mat = Materials.dominion.accent.clone();
          mat.color.setHex(0xff4040);
          mat.emissive.setHex(0x200000);
          child.material = mat;
        }
      }
    });

    // Add healing device instead of gun
    const healerGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8);
    const healerMat = new THREE.MeshStandardMaterial({
      color: 0x40ff40,
      emissive: 0x104010,
      roughness: 0.3,
      metalness: 0.5,
    });
    const healer = new THREE.Mesh(healerGeo, healerMat);
    healer.position.set(0.3, 0.5, 0.35);
    healer.rotation.z = Math.PI / 2;
    healer.castShadow = true;
    group.add(healer);

    return group;
  }

  private static generateDevastator(): THREE.Group {
    const group = new THREE.Group();

    // Tank body
    const bodyGeo = new THREE.BoxGeometry(1.6, 0.5, 0.9);
    const body = new THREE.Mesh(bodyGeo, Materials.dominion.armor);
    body.position.y = 0.4;
    body.castShadow = true;
    group.add(body);

    // Turret base
    const turretBaseGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.25, 12);
    const turretBase = new THREE.Mesh(turretBaseGeo, Materials.dominion.metal);
    turretBase.position.set(-0.2, 0.75, 0);
    turretBase.castShadow = true;
    group.add(turretBase);

    // Main cannon
    const cannonGeo = new THREE.CylinderGeometry(0.12, 0.15, 1.2, 8);
    const cannon = new THREE.Mesh(cannonGeo, Materials.dominion.accent);
    cannon.userData.isAccent = true;
    cannon.position.set(0.4, 0.8, 0);
    cannon.rotation.z = Math.PI / 2;
    cannon.castShadow = true;
    group.add(cannon);

    // Treads
    const treadGeo = new THREE.BoxGeometry(1.4, 0.2, 0.25);
    const leftTread = new THREE.Mesh(treadGeo, Materials.dominion.armor);
    leftTread.position.set(0, 0.1, 0.5);
    leftTread.castShadow = true;
    group.add(leftTread);

    const rightTread = new THREE.Mesh(treadGeo, Materials.dominion.armor);
    rightTread.position.set(0, 0.1, -0.5);
    rightTread.castShadow = true;
    group.add(rightTread);

    return group;
  }

  private static generateValkyrie(): THREE.Group {
    const group = new THREE.Group();

    // Main body
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.4, 0.5);
    const body = new THREE.Mesh(bodyGeo, Materials.dominion.armor);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const cockpit = new THREE.Mesh(cockpitGeo, Materials.dominion.glass);
    cockpit.position.set(0.3, 1.0, 0);
    cockpit.scale.set(1, 0.6, 0.8);
    group.add(cockpit);

    // Wings
    const wingGeo = new THREE.BoxGeometry(0.6, 0.08, 1.2);
    const wings = new THREE.Mesh(wingGeo, Materials.dominion.metal);
    wings.position.set(-0.1, 1.0, 0);
    wings.castShadow = true;
    group.add(wings);

    // Engines
    const engineGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.4, 8);
    const leftEngine = new THREE.Mesh(engineGeo, Materials.dominion.accent);
    leftEngine.userData.isAccent = true;
    leftEngine.position.set(-0.3, 0.9, 0.5);
    leftEngine.rotation.x = Math.PI / 2;
    leftEngine.castShadow = true;
    group.add(leftEngine);

    const rightEngine = new THREE.Mesh(engineGeo, Materials.dominion.accent);
    rightEngine.userData.isAccent = true;
    rightEngine.position.set(-0.3, 0.9, -0.5);
    rightEngine.rotation.x = Math.PI / 2;
    rightEngine.castShadow = true;
    group.add(rightEngine);

    // Legs (for transformation)
    const legGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const leftLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    leftLeg.position.set(0, 0.3, 0.25);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, Materials.dominion.armor);
    rightLeg.position.set(0, 0.3, -0.25);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    return group;
  }

  private static generateSpecter(): THREE.Group {
    const group = new THREE.Group();

    // Sleek body
    const bodyGeo = new THREE.BoxGeometry(1.0, 0.25, 0.4);
    const body = new THREE.Mesh(bodyGeo, Materials.dominion.armor);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const cockpit = new THREE.Mesh(cockpitGeo, Materials.dominion.glass);
    cockpit.position.set(0.35, 1.05, 0);
    cockpit.scale.set(1.2, 0.7, 0.8);
    group.add(cockpit);

    // Angled wings
    const wingGeo = new THREE.BoxGeometry(0.4, 0.05, 0.8);
    const leftWing = new THREE.Mesh(wingGeo, Materials.dominion.metal);
    leftWing.position.set(-0.1, 0.95, 0.5);
    leftWing.rotation.z = -0.2;
    leftWing.castShadow = true;
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, Materials.dominion.metal);
    rightWing.position.set(-0.1, 0.95, -0.5);
    rightWing.rotation.z = 0.2;
    rightWing.castShadow = true;
    group.add(rightWing);

    // Rockets under wings
    const rocketGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8);
    for (let i = 0; i < 4; i++) {
      const rocket = new THREE.Mesh(rocketGeo, Materials.dominion.accent);
      rocket.userData.isAccent = true;
      rocket.position.set(0, 0.85, (i < 2 ? 0.4 : -0.4) + (i % 2 === 0 ? 0.1 : -0.1));
      rocket.castShadow = true;
      group.add(rocket);
    }

    return group;
  }

  private static generateDreadnought(): THREE.Group {
    const group = new THREE.Group();

    // Main hull
    const hullGeo = new THREE.BoxGeometry(3.0, 0.6, 1.0);
    const hull = new THREE.Mesh(hullGeo, Materials.dominion.armor);
    hull.position.y = 1.5;
    hull.castShadow = true;
    group.add(hull);

    // Bridge
    const bridgeGeo = new THREE.BoxGeometry(0.8, 0.4, 0.5);
    const bridge = new THREE.Mesh(bridgeGeo, Materials.dominion.metal);
    bridge.position.set(0.8, 2.0, 0);
    bridge.castShadow = true;
    group.add(bridge);

    // Engine section
    const engineGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.8, 12);
    for (let i = 0; i < 3; i++) {
      const engine = new THREE.Mesh(engineGeo, Materials.dominion.accent);
      engine.userData.isAccent = true;
      engine.position.set(-1.3, 1.5, (i - 1) * 0.4);
      engine.rotation.z = Math.PI / 2;
      engine.castShadow = true;
      group.add(engine);
    }

    // Nova cannon
    const cannonGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.0, 8);
    const cannon = new THREE.Mesh(cannonGeo, Materials.dominion.accent);
    cannon.userData.isAccent = true;
    cannon.position.set(1.5, 1.3, 0);
    cannon.rotation.z = Math.PI / 2;
    cannon.castShadow = true;
    group.add(cannon);

    return group;
  }

  private static generateGenericUnit(): THREE.Group {
    const group = new THREE.Group();

    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mesh = new THREE.Mesh(geo, Materials.dominion.armor);
    mesh.position.y = 0.25;
    mesh.castShadow = true;
    group.add(mesh);

    return group;
  }

  // === BUILDING GENERATORS ===

  private static generateHeadquarters(): THREE.Group {
    const group = new THREE.Group();

    // Main structure
    const baseGeo = new THREE.BoxGeometry(5, 2, 5);
    const base = new THREE.Mesh(baseGeo, Materials.dominion.building);
    base.position.y = 1;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Control tower
    const towerGeo = new THREE.BoxGeometry(1.5, 2.5, 1.5);
    const tower = new THREE.Mesh(towerGeo, Materials.dominion.metal);
    tower.position.set(-1.2, 3.25, 0);
    tower.castShadow = true;
    group.add(tower);

    // Landing pad markings (accent color)
    const padGeo = new THREE.BoxGeometry(3, 0.1, 3);
    const pad = new THREE.Mesh(padGeo, Materials.dominion.accent);
    pad.userData.isAccent = true;
    pad.position.set(0.5, 2.05, 0);
    pad.receiveShadow = true;
    group.add(pad);

    // Antenna
    const antennaGeo = new THREE.CylinderGeometry(0.05, 0.05, 2, 8);
    const antenna = new THREE.Mesh(antennaGeo, Materials.dominion.metal);
    antenna.position.set(-1.2, 5.5, 0);
    group.add(antenna);

    // Dish
    const dishGeo = new THREE.CircleGeometry(0.4, 16);
    const dish = new THREE.Mesh(dishGeo, Materials.dominion.accent);
    dish.userData.isAccent = true;
    dish.position.set(-1.2, 6.5, 0);
    dish.rotation.x = -Math.PI / 4;
    group.add(dish);

    return group;
  }

  private static generateSupplyCache(): THREE.Group {
    const group = new THREE.Group();

    // Main container (reduced to half size)
    const containerGeo = new THREE.BoxGeometry(1.25, 0.75, 1.25);
    const container = new THREE.Mesh(containerGeo, Materials.dominion.building);
    container.position.y = 0.375;
    container.castShadow = true;
    container.receiveShadow = true;
    group.add(container);

    // Top detail
    const topGeo = new THREE.BoxGeometry(1, 0.15, 1);
    const top = new THREE.Mesh(topGeo, Materials.dominion.accent);
    top.userData.isAccent = true;
    top.position.y = 0.825;
    top.castShadow = true;
    group.add(top);

    // Side vents
    for (let i = 0; i < 4; i++) {
      const ventGeo = new THREE.BoxGeometry(0.05, 0.25, 0.15);
      const vent = new THREE.Mesh(ventGeo, Materials.dominion.metal);
      const angle = (i / 4) * Math.PI * 2;
      vent.position.set(Math.cos(angle) * 0.65, 0.25, Math.sin(angle) * 0.65);
      vent.rotation.y = angle;
      group.add(vent);
    }

    return group;
  }

  private static generateInfantryBay(): THREE.Group {
    const group = new THREE.Group();

    // Main building
    const mainGeo = new THREE.BoxGeometry(4, 2.5, 3);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1.25;
    main.castShadow = true;
    main.receiveShadow = true;
    group.add(main);

    // Entrance
    const entranceGeo = new THREE.BoxGeometry(1, 1.8, 0.5);
    const entrance = new THREE.Mesh(entranceGeo, Materials.dominion.accent);
    entrance.userData.isAccent = true;
    entrance.position.set(0, 0.9, 1.7);
    entrance.castShadow = true;
    group.add(entrance);

    // Roof detail
    const roofGeo = new THREE.BoxGeometry(3.5, 0.3, 2.5);
    const roof = new THREE.Mesh(roofGeo, Materials.dominion.metal);
    roof.position.y = 2.65;
    roof.castShadow = true;
    group.add(roof);

    // Flag pole
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8);
    const pole = new THREE.Mesh(poleGeo, Materials.dominion.metal);
    pole.position.set(1.5, 3.5, 1);
    group.add(pole);

    // Flag
    const flagGeo = new THREE.PlaneGeometry(0.6, 0.4);
    const flag = new THREE.Mesh(flagGeo, Materials.dominion.accent);
    flag.userData.isAccent = true;
    flag.position.set(1.8, 4.0, 1);
    group.add(flag);

    return group;
  }

  private static generateExtractor(): THREE.Group {
    const group = new THREE.Group();

    // Main structure
    const mainGeo = new THREE.CylinderGeometry(1.5, 1.8, 2, 12);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1;
    main.castShadow = true;
    main.receiveShadow = true;
    group.add(main);

    // Processing tower
    const towerGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 8);
    const tower = new THREE.Mesh(towerGeo, Materials.dominion.metal);
    tower.position.set(0.8, 2.5, 0.8);
    tower.castShadow = true;
    group.add(tower);

    // Pipes
    for (let i = 0; i < 3; i++) {
      const pipeGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8);
      const pipe = new THREE.Mesh(pipeGeo, Materials.dominion.accent);
      pipe.userData.isAccent = true;
      pipe.position.set(-0.8, 0.75, (i - 1) * 0.5);
      pipe.rotation.z = Math.PI / 2;
      group.add(pipe);
    }

    // Green gas effect
    const gasGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.5, 8);
    const gasMat = new THREE.MeshBasicMaterial({
      color: 0x40ff80,
      transparent: true,
      opacity: 0.5,
    });
    const gas = new THREE.Mesh(gasGeo, gasMat);
    gas.position.set(0.8, 4.2, 0.8);
    group.add(gas);

    return group;
  }

  private static generateForge(): THREE.Group {
    const group = new THREE.Group();

    // Main building (increased by 50%)
    const mainGeo = new THREE.BoxGeometry(7.5, 3.75, 6);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1.875;
    main.castShadow = true;
    main.receiveShadow = true;
    group.add(main);

    // Production bay door
    const doorGeo = new THREE.BoxGeometry(3, 3, 0.3);
    const door = new THREE.Mesh(doorGeo, Materials.dominion.accent);
    door.userData.isAccent = true;
    door.position.set(0, 1.5, 3.15);
    door.castShadow = true;
    group.add(door);

    // Smoke stacks
    for (let i = 0; i < 2; i++) {
      const stackGeo = new THREE.CylinderGeometry(0.3, 0.45, 2.25, 8);
      const stack = new THREE.Mesh(stackGeo, Materials.dominion.metal);
      stack.position.set(-3 + i * 1.2, 4.875, -1.5);
      stack.castShadow = true;
      group.add(stack);
    }

    // Crane arm
    const craneGeo = new THREE.BoxGeometry(4.5, 0.3, 0.3);
    const crane = new THREE.Mesh(craneGeo, Materials.dominion.metal);
    crane.position.set(0, 4.5, 0);
    crane.castShadow = true;
    group.add(crane);

    return group;
  }

  private static generateHangar(): THREE.Group {
    const group = new THREE.Group();

    // Main hangar
    const hangarGeo = new THREE.BoxGeometry(5, 2, 5);
    const hangar = new THREE.Mesh(hangarGeo, Materials.dominion.building);
    hangar.position.y = 1;
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    group.add(hangar);

    // Control tower
    const towerGeo = new THREE.CylinderGeometry(0.5, 0.6, 3, 12);
    const tower = new THREE.Mesh(towerGeo, Materials.dominion.metal);
    tower.position.set(-2, 3.5, -2);
    tower.castShadow = true;
    group.add(tower);

    // Radar dish
    const dishGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.1, 16);
    const dish = new THREE.Mesh(dishGeo, Materials.dominion.accent);
    dish.userData.isAccent = true;
    dish.position.set(-2, 5.2, -2);
    dish.rotation.x = Math.PI / 6;
    group.add(dish);

    // Landing lights
    for (let i = 0; i < 4; i++) {
      const lightGeo = new THREE.SphereGeometry(0.15, 8, 8);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0x40ff40 });
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(
        (i % 2 === 0 ? -1.5 : 1.5),
        2.1,
        (i < 2 ? -1.5 : 1.5)
      );
      group.add(light);
    }

    return group;
  }

  private static generateTechCenter(): THREE.Group {
    const group = new THREE.Group();

    const mainGeo = new THREE.BoxGeometry(3, 2, 3);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1;
    main.castShadow = true;
    group.add(main);

    // Satellite dish
    const dishGeo = new THREE.CircleGeometry(1, 16);
    const dish = new THREE.Mesh(dishGeo, Materials.dominion.accent);
    dish.userData.isAccent = true;
    dish.position.set(0, 3, 0);
    dish.rotation.x = -Math.PI / 3;
    group.add(dish);

    return group;
  }

  private static generateArsenal(): THREE.Group {
    const group = new THREE.Group();

    const mainGeo = new THREE.BoxGeometry(3.5, 2.5, 3.5);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1.25;
    main.castShadow = true;
    group.add(main);

    // Heavy reinforced look
    const reinforceGeo = new THREE.BoxGeometry(3.7, 0.3, 3.7);
    const reinforce = new THREE.Mesh(reinforceGeo, Materials.dominion.metal);
    reinforce.position.y = 2.65;
    group.add(reinforce);

    return group;
  }

  private static generateGarrison(): THREE.Group {
    const group = new THREE.Group();

    // Low fortified structure
    const mainGeo = new THREE.BoxGeometry(3, 1.5, 3);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.armor);
    main.position.y = 0.75;
    main.castShadow = true;
    group.add(main);

    // Firing slits
    for (let i = 0; i < 4; i++) {
      const slitGeo = new THREE.BoxGeometry(0.5, 0.2, 0.1);
      const slit = new THREE.Mesh(slitGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
      const angle = (i / 4) * Math.PI * 2;
      slit.position.set(Math.cos(angle) * 1.5, 1.0, Math.sin(angle) * 1.5);
      slit.rotation.y = angle;
      group.add(slit);
    }

    return group;
  }

  private static generateDefenseTurret(): THREE.Group {
    const group = new THREE.Group();

    // Base
    const baseGeo = new THREE.CylinderGeometry(1, 1.2, 0.5, 12);
    const base = new THREE.Mesh(baseGeo, Materials.dominion.building);
    base.position.y = 0.25;
    base.castShadow = true;
    group.add(base);

    // Turret body
    const turretGeo = new THREE.CylinderGeometry(0.6, 0.7, 1, 12);
    const turret = new THREE.Mesh(turretGeo, Materials.dominion.metal);
    turret.position.y = 1;
    turret.castShadow = true;
    group.add(turret);

    // Missile launchers
    for (let i = 0; i < 2; i++) {
      const launcherGeo = new THREE.CylinderGeometry(0.15, 0.15, 1, 8);
      const launcher = new THREE.Mesh(launcherGeo, Materials.dominion.accent);
      launcher.userData.isAccent = true;
      launcher.position.set(0.2, 1.7, (i === 0 ? 0.3 : -0.3));
      launcher.rotation.x = Math.PI / 6;
      launcher.castShadow = true;
      group.add(launcher);
    }

    return group;
  }

  private static generateGenericBuilding(): THREE.Group {
    const group = new THREE.Group();

    const geo = new THREE.BoxGeometry(3, 2, 3);
    const mesh = new THREE.Mesh(geo, Materials.dominion.building);
    mesh.position.y = 1;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    return group;
  }
}

export default AssetManager;
