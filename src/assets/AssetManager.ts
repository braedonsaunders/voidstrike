/**
 * VOIDSTRIKE Asset Manager
 *
 * Easy system for generating and loading 3D assets for buildings, units, workers, and map objects.
 *
 * USAGE:
 * 1. Procedural Assets (built-in):
 *    const mesh = AssetManager.getUnitMesh('constructor');
 *    const building = AssetManager.getBuildingMesh('headquarters');
 *
 * 2. Custom GLTF/GLB Models:
 *    await AssetManager.loadGLTF('/models/custom_unit.glb', 'my_unit');
 *    const mesh = AssetManager.getCustomMesh('my_unit');
 *
 * 3. Replace default assets:
 *    AssetManager.registerCustomAsset('constructor', myCustomConstructorMesh);
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// Reference Frame Contract Constants
// Per threejs-builder skill: document these upfront to avoid reference-frame bugs
export const REFERENCE_FRAME = {
  // World axes: +X right, +Y up, +Z toward camera (Three.js default)
  // GLTF models face -Z by default
  MODEL_FORWARD_OFFSET: 0, // radians - adjust if models face wrong direction

  // Unit scale: 1 unit = ~1 meter
  UNIT_HEIGHTS: {
    constructor: 1.0,
    trooper: 1.2,
    breacher: 1.5,
    medic: 1.2,
    devastator: 1.2,
    valkyrie: 1.8,
    specter: 1.5,
    dreadnought: 2.5,
  } as Record<string, number>,

  BUILDING_HEIGHTS: {
    headquarters: 4.5,
    supply_cache: 0.9, // Half size for supply cache
    infantry_bay: 2.8,
    extractor: 2.0, // Half size for extractor
    forge: 3.5, // Increased size
    hangar: 2.2,
  } as Record<string, number>,

  // Anchor mode: units/buildings have bottom at y=0 (minY anchor)
  ANCHOR_MODE: 'minY' as const,
};

// Asset definition types
export interface AssetDefinition {
  id: string;
  type: 'unit' | 'building' | 'resource' | 'decoration' | 'projectile';
  scale: number;
  heightOffset: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

// Cache for loaded/generated assets
const assetCache = new Map<string, THREE.Object3D>();
const customAssets = new Map<string, THREE.Object3D>();

// Store animations for custom models
const assetAnimations = new Map<string, THREE.AnimationClip[]>();

// Track which assets are animated/skinned (require SkeletonUtils.clone)
const animatedAssets = new Set<string>();

// Callbacks to notify when custom models are loaded
const onModelsLoadedCallbacks: Array<() => void> = [];

// DRACO loader for compressed meshes
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
dracoLoader.setDecoderConfig({ type: 'js' }); // Use JS decoder for compatibility

// GLTF loader instance with DRACO support
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * Normalize a model to a target height and anchor to ground (minY = 0)
 * Per threejs-builder skill: use one anchor rule per asset class
 */
function normalizeModel(root: THREE.Object3D, targetHeight: number): void {
  // Update world matrices first
  root.updateMatrixWorld(true);

  // Get bounds from the entire model
  const box = new THREE.Box3().setFromObject(root);

  // Check if the bounding box is valid
  if (box.isEmpty()) {
    console.warn('[AssetManager] normalizeModel: Empty bounding box, skipping normalization');
    return;
  }

  const size = box.getSize(new THREE.Vector3());

  // Log model info for debugging
  console.log(`[AssetManager] Model bounds: size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}), min.y=${box.min.y.toFixed(2)}`);

  // Scale to target height if model has height
  if (size.y > 0.001) {
    const scale = targetHeight / size.y;
    root.scale.setScalar(scale);
    console.log(`[AssetManager] Applied scale: ${scale.toFixed(4)} to achieve height ${targetHeight}`);
  }

  // Update matrices after scaling
  root.updateMatrixWorld(true);

  // Recalculate bounds after scaling
  box.setFromObject(root);

  // Ground the model (set bottom at y=0) - minY anchor
  if (isFinite(box.min.y)) {
    root.position.y = -box.min.y;
    console.log(`[AssetManager] Grounded model: position.y = ${root.position.y.toFixed(4)}`);
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

      console.log(`[AssetManager] Custom ${unitId}: ${meshCount} meshes, inner pos.y=${cloned.position.y.toFixed(3)}, scale=${cloned.scale.x.toFixed(4)}`);

      return wrapper;
    }

    const cacheKey = `unit_${unitId}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateUnit(unitId);
      assetCache.set(cacheKey, mesh);
    }

    const result = assetCache.get(cacheKey)!.clone();

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

      console.log(`[AssetManager] Custom building ${buildingId}: ${meshCount} meshes, inner pos.y=${cloned.position.y.toFixed(3)}, scale=${cloned.scale.x.toFixed(4)}`);

      return wrapper;
    }

    const cacheKey = `building_${buildingId}`;
    if (!assetCache.has(cacheKey)) {
      const mesh = ProceduralGenerator.generateBuilding(buildingId);
      assetCache.set(cacheKey, mesh);
    }

    const result = assetCache.get(cacheKey)!.clone();

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
   * Per threejs-builder skill: normalizes model and tracks if animated
   */
  static async loadGLTF(
    url: string,
    assetId: string,
    options: { targetHeight?: number; isAnimated?: boolean } = {}
  ): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      gltfLoader.load(
        url,
        (gltf) => {
          const model = gltf.scene;

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
            console.log(`[AssetManager] Registered ${assetId} as animated model`);
          }

          // Log animation names and store them per threejs-builder skill
          if (hasAnimations) {
            console.log(`[AssetManager] ${assetId} animations:`, gltf.animations.map(a => a.name));
            assetAnimations.set(assetId, gltf.animations);
          }

          // Normalize to target height if specified
          if (options.targetHeight) {
            normalizeModel(model, options.targetHeight);
          }

          // Apply model forward offset if needed
          if (REFERENCE_FRAME.MODEL_FORWARD_OFFSET !== 0) {
            model.rotation.y = REFERENCE_FRAME.MODEL_FORWARD_OFFSET;
          }

          customAssets.set(assetId, model);
          resolve(model);
        },
        undefined,
        (error) => reject(error)
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
   * Clear all cached assets (useful for hot-reloading)
   */
  static clearCache(): void {
    assetCache.clear();
  }

  /**
   * Preload all common assets for better performance
   */
  static preloadCommonAssets(): void {
    // Units
    ['constructor', 'trooper', 'breacher', 'medic', 'devastator', 'valkyrie', 'specter'].forEach(id => {
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
   * Load custom 3D models from public/models folder
   * Replaces procedural meshes with custom GLB models when available
   * Logs animation names to console for debugging
   */
  static async loadCustomModels(): Promise<void> {
    // Define custom model paths - add more as models are created
    const customModels: Array<{ path: string; assetId: string; targetHeight: number }> = [
      // Units
      { path: '/models/units/constructor.glb', assetId: 'constructor', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.constructor || 1.0 },
      { path: '/models/units/trooper.glb', assetId: 'trooper', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.trooper || 1.2 },
      { path: '/models/units/breacher.glb', assetId: 'breacher', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.breacher || 1.5 },
      { path: '/models/units/vanguard.glb', assetId: 'vanguard', targetHeight: 1.3 },
      { path: '/models/units/operative.glb', assetId: 'operative', targetHeight: 1.3 },
      { path: '/models/units/scorcher.glb', assetId: 'scorcher', targetHeight: 1.0 },
      { path: '/models/units/devastator.glb', assetId: 'devastator', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.devastator || 1.2 },
      { path: '/models/units/colossus.glb', assetId: 'colossus', targetHeight: 2.5 },
      { path: '/models/units/valkyrie.glb', assetId: 'valkyrie', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.valkyrie || 1.8 },
      { path: '/models/units/lifter.glb', assetId: 'lifter', targetHeight: 1.5 },
      { path: '/models/units/specter.glb', assetId: 'specter', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.specter || 1.5 },
      { path: '/models/units/overseer.glb', assetId: 'overseer', targetHeight: 1.5 },
      { path: '/models/units/dreadnought.glb', assetId: 'dreadnought', targetHeight: REFERENCE_FRAME.UNIT_HEIGHTS.dreadnought || 2.5 },
      // Buildings
      { path: '/models/buildings/headquarters.glb', assetId: 'headquarters', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.headquarters || 4.5 },
      { path: '/models/buildings/orbital_station.glb', assetId: 'orbital_station', targetHeight: 4.5 },
      { path: '/models/buildings/bastion.glb', assetId: 'bastion', targetHeight: 4.5 },
      { path: '/models/buildings/supply_cache.glb', assetId: 'supply_cache', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.supply_cache || 1.8 },
      { path: '/models/buildings/extractor.glb', assetId: 'extractor', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.extractor || 2.0 },
      { path: '/models/buildings/infantry_bay.glb', assetId: 'infantry_bay', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.infantry_bay || 2.8 },
      { path: '/models/buildings/tech_center.glb', assetId: 'tech_center', targetHeight: 2.5 },
      { path: '/models/buildings/garrison.glb', assetId: 'garrison', targetHeight: 2.0 },
      { path: '/models/buildings/forge.glb', assetId: 'forge', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.forge || 2.8 },
      { path: '/models/buildings/arsenal.glb', assetId: 'arsenal', targetHeight: 2.8 },
      { path: '/models/buildings/hangar.glb', assetId: 'hangar', targetHeight: REFERENCE_FRAME.BUILDING_HEIGHTS.hangar || 2.2 },
      { path: '/models/buildings/power_core.glb', assetId: 'power_core', targetHeight: 3.0 },
      { path: '/models/buildings/ops_center.glb', assetId: 'ops_center', targetHeight: 2.8 },
      { path: '/models/buildings/radar_array.glb', assetId: 'radar_array', targetHeight: 4.0 },
      { path: '/models/buildings/defense_turret.glb', assetId: 'defense_turret', targetHeight: 2.5 },
      { path: '/models/buildings/research_module.glb', assetId: 'research_module', targetHeight: 2.0 },
      { path: '/models/buildings/production_module.glb', assetId: 'production_module', targetHeight: 2.0 },
      // Resources
      { path: '/models/resources/minerals.glb', assetId: 'minerals', targetHeight: 2.0 },
      { path: '/models/resources/vespene.glb', assetId: 'vespene', targetHeight: 2.0 },
      // Decorations
      { path: '/models/decorations/alien_tower.glb', assetId: 'alien_tower', targetHeight: 7.0 },
      { path: '/models/decorations/rocks_large.glb', assetId: 'rocks_large', targetHeight: 2.0 },
      { path: '/models/decorations/rocks_small.glb', assetId: 'rocks_small', targetHeight: 1.0 },
      { path: '/models/decorations/rock_single.glb', assetId: 'rock_single', targetHeight: 1.0 },
      { path: '/models/decorations/tree_pine_tall.glb', assetId: 'tree_pine_tall', targetHeight: 5.5 },
      { path: '/models/decorations/tree_pine_medium.glb', assetId: 'tree_pine_medium', targetHeight: 3.5 },
      { path: '/models/decorations/tree_dead.glb', assetId: 'tree_dead', targetHeight: 3.5 },
      { path: '/models/decorations/tree_alien.glb', assetId: 'tree_alien', targetHeight: 4.5 },
      { path: '/models/decorations/tree_palm.glb', assetId: 'tree_palm', targetHeight: 4.5 },
      { path: '/models/decorations/tree_mushroom.glb', assetId: 'tree_mushroom', targetHeight: 3.5 },
      { path: '/models/decorations/crystal_formation.glb', assetId: 'crystal_formation', targetHeight: 1.5 },
      { path: '/models/decorations/bush.glb', assetId: 'bush', targetHeight: 0.5 },
      { path: '/models/decorations/grass_clump.glb', assetId: 'grass_clump', targetHeight: 0.3 },
      { path: '/models/decorations/debris.glb', assetId: 'debris', targetHeight: 0.5 },
      { path: '/models/decorations/escape_pod.glb', assetId: 'escape_pod', targetHeight: 1.5 },
      { path: '/models/decorations/ruined_wall.glb', assetId: 'ruined_wall', targetHeight: 2.0 },
    ];

    console.log('[AssetManager] Loading custom models...');
    let loadedCount = 0;

    for (const model of customModels) {
      try {
        // Check if file exists by trying to fetch headers
        const response = await fetch(model.path, { method: 'HEAD' });
        if (!response.ok) {
          console.log(`[AssetManager] No custom model found at ${model.path}, using procedural mesh`);
          continue;
        }

        // Load the GLTF model
        await this.loadGLTF(model.path, model.assetId, { targetHeight: model.targetHeight });
        console.log(`[AssetManager] ✓ Loaded custom model: ${model.assetId} from ${model.path}`);
        loadedCount++;
      } catch (error) {
        console.log(`[AssetManager] Could not load ${model.path}:`, error);
      }
    }

    console.log(`[AssetManager] Custom model loading complete (${loadedCount} models loaded)`);

    // Notify all listeners that models have been loaded
    if (loadedCount > 0) {
      console.log(`[AssetManager] Notifying ${onModelsLoadedCallbacks.length} listeners to refresh meshes`);
      for (const callback of onModelsLoadedCallbacks) {
        try {
          callback();
        } catch (err) {
          console.error('[AssetManager] Error in onModelsLoaded callback:', err);
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
      case 'constructor':
        return this.generateConstructor();
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

  private static generateConstructor(): THREE.Group {
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

    // Main container
    const containerGeo = new THREE.BoxGeometry(2.5, 1.5, 2.5);
    const container = new THREE.Mesh(containerGeo, Materials.dominion.building);
    container.position.y = 0.75;
    container.castShadow = true;
    container.receiveShadow = true;
    group.add(container);

    // Top detail
    const topGeo = new THREE.BoxGeometry(2, 0.3, 2);
    const top = new THREE.Mesh(topGeo, Materials.dominion.accent);
    top.userData.isAccent = true;
    top.position.y = 1.65;
    top.castShadow = true;
    group.add(top);

    // Side vents
    for (let i = 0; i < 4; i++) {
      const ventGeo = new THREE.BoxGeometry(0.1, 0.5, 0.3);
      const vent = new THREE.Mesh(ventGeo, Materials.dominion.metal);
      const angle = (i / 4) * Math.PI * 2;
      vent.position.set(Math.cos(angle) * 1.3, 0.5, Math.sin(angle) * 1.3);
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

    // Main building
    const mainGeo = new THREE.BoxGeometry(5, 2.5, 4);
    const main = new THREE.Mesh(mainGeo, Materials.dominion.building);
    main.position.y = 1.25;
    main.castShadow = true;
    main.receiveShadow = true;
    group.add(main);

    // Production bay door
    const doorGeo = new THREE.BoxGeometry(2, 2, 0.2);
    const door = new THREE.Mesh(doorGeo, Materials.dominion.accent);
    door.userData.isAccent = true;
    door.position.set(0, 1, 2.1);
    door.castShadow = true;
    group.add(door);

    // Smoke stacks
    for (let i = 0; i < 2; i++) {
      const stackGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 8);
      const stack = new THREE.Mesh(stackGeo, Materials.dominion.metal);
      stack.position.set(-2 + i * 0.8, 3.25, -1);
      stack.castShadow = true;
      group.add(stack);
    }

    // Crane arm
    const craneGeo = new THREE.BoxGeometry(3, 0.2, 0.2);
    const crane = new THREE.Mesh(craneGeo, Materials.dominion.metal);
    crane.position.set(0, 3, 0);
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
