/**
 * EditorModelLoader - Dynamic GLTF model loader for the map editor
 *
 * Loads real 3D models for decorations and objects in the editor.
 * Configuration is read dynamically from assets.json to stay in sync
 * with the game's asset definitions. This allows the editor to work
 * with any game that follows the same asset configuration format.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { debugAssets } from '@/utils/debugLogger';

// Model configuration loaded from assets.json
export interface ModelConfig {
  path: string;
  scale: number;
  rotationY: number;
}

// Asset configuration structure from assets.json
interface AssetJsonConfig {
  decorations?: Record<string, {
    model: string;
    scale?: number;
    rotation?: { x?: number; y?: number; z?: number };
  }>;
  resources?: Record<string, {
    model: string;
    scale?: number;
    rotation?: { x?: number; y?: number; z?: number };
  }>;
}

// DRACO loader for compressed meshes
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
dracoLoader.setDecoderConfig({ type: 'js' });

// GLTF loader instance with DRACO support
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// Dynamic model configurations loaded from assets.json
const modelConfigs = new Map<string, ModelConfig>();

// Cache for loaded models (template instances)
const modelCache = new Map<string, THREE.Object3D>();

// Loading promises to prevent duplicate loads
const loadingPromises = new Map<string, Promise<THREE.Object3D | null>>();

// Track loading state
let isInitialized = false;
let initPromise: Promise<void> | null = null;
let configLoaded = false;

/**
 * Load asset configuration from assets.json
 */
async function loadAssetConfig(): Promise<void> {
  if (configLoaded) return;

  try {
    const response = await fetch('/config/assets.json');
    if (!response.ok) {
      debugAssets.warn('[EditorModelLoader] assets.json not found, using fallback');
      return;
    }

    const config: AssetJsonConfig = await response.json();

    // Register decoration models
    if (config.decorations) {
      for (const [assetId, assetConfig] of Object.entries(config.decorations)) {
        const editorId = `decoration_${assetId}`;
        modelConfigs.set(editorId, {
          path: assetConfig.model,
          scale: assetConfig.scale ?? 1.0,
          rotationY: assetConfig.rotation?.y ?? 0,
        });
      }
    }

    // Register resource models (minerals, plasma)
    if (config.resources) {
      for (const [assetId, assetConfig] of Object.entries(config.resources)) {
        const editorId = `resource_${assetId}`;
        modelConfigs.set(editorId, {
          path: assetConfig.model,
          scale: assetConfig.scale ?? 1.0,
          rotationY: assetConfig.rotation?.y ?? 0,
        });
      }
    }

    // Add common editor type aliases that map to asset IDs
    // This handles cases where editor uses different naming conventions
    const aliases: Record<string, string> = {
      // Trees
      'decoration_tree_pine_tall': 'decoration_tree_pine_tall',
      'decoration_tree_pine_medium': 'decoration_tree_pine_tall', // Uses same model, different scale
      'decoration_tree_dead': 'decoration_tree_dead',
      'decoration_tree_alien': 'decoration_tree_alien',
      'decoration_tree_palm': 'decoration_tree_palm',
      'decoration_tree_mushroom': 'decoration_tree_mushroom',
      // Rocks
      'decoration_rocks_large': 'decoration_rocks_large',
      'decoration_rocks_small': 'decoration_rocks_small',
      'decoration_rock_single': 'decoration_rock_single',
      // Special
      'decoration_crystal_formation': 'decoration_crystal_formation',
      'decoration_bush': 'decoration_shrub',
      'decoration_ruined_wall': 'decoration_ruined_wall',
      'decoration_alien_tower': 'decoration_alien_tower',
      'decoration_debris': 'decoration_debris',
      // Game objects using decoration models
      'watch_tower': 'decoration_alien_tower',
      'destructible_rock': 'decoration_rock_single',
      'destructible_debris': 'decoration_debris',
    };

    // Apply aliases - copy config from source to alias
    for (const [alias, source] of Object.entries(aliases)) {
      if (!modelConfigs.has(alias) && modelConfigs.has(source)) {
        const sourceConfig = modelConfigs.get(source)!;
        modelConfigs.set(alias, { ...sourceConfig });
      }
    }

    // Special case: decoration_tree_pine_medium uses pine_tall model but smaller
    if (modelConfigs.has('decoration_tree_pine_tall') && !modelConfigs.has('decoration_tree_pine_medium')) {
      const pineConfig = modelConfigs.get('decoration_tree_pine_tall')!;
      modelConfigs.set('decoration_tree_pine_medium', {
        ...pineConfig,
        scale: pineConfig.scale * 0.7, // 70% of tall pine
      });
    }

    configLoaded = true;
    debugAssets.log(`[EditorModelLoader] Loaded ${modelConfigs.size} model configurations from assets.json`);
  } catch (error) {
    debugAssets.warn('[EditorModelLoader] Failed to load assets.json:', error);
  }
}

/**
 * Normalize a model: scale to target height and ground to y=0
 * This matches how the game's AssetManager handles model scaling.
 */
function normalizeModel(root: THREE.Object3D, targetScale: number, rotationY: number = 0): void {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());

  // Normalize to unit height first, then multiply by target scale
  // This ensures model height equals targetScale in world units
  if (size.y > 0.001) {
    const normalizeScale = targetScale / size.y;
    root.scale.setScalar(normalizeScale);
  }

  // Apply base rotation
  root.rotation.y = THREE.MathUtils.degToRad(rotationY);

  // Update matrices after transform
  root.updateMatrixWorld(true);

  // Recalculate bounds after scaling
  box.setFromObject(root);

  // Ground the model (set bottom at y=0)
  if (isFinite(box.min.y)) {
    root.position.y = -box.min.y;
  }
}

/**
 * Load a single model by its type ID
 */
async function loadModel(typeId: string): Promise<THREE.Object3D | null> {
  const config = modelConfigs.get(typeId);
  if (!config) {
    return null;
  }

  // Check cache first
  if (modelCache.has(typeId)) {
    return modelCache.get(typeId)!;
  }

  // Check if already loading
  if (loadingPromises.has(typeId)) {
    return loadingPromises.get(typeId)!;
  }

  // Start loading
  const loadPromise = new Promise<THREE.Object3D | null>((resolve) => {
    gltfLoader.load(
      config.path,
      (gltf: GLTF) => {
        const model = gltf.scene;

        // Normalize the model to target height
        normalizeModel(model, config.scale, config.rotationY);

        // Enable shadows and visibility
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.visible = true;
            child.frustumCulled = false;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Cache the template
        modelCache.set(typeId, model);
        loadingPromises.delete(typeId);
        resolve(model);
      },
      undefined,
      (error) => {
        debugAssets.warn(`[EditorModelLoader] Failed to load model for ${typeId}:`, error);
        loadingPromises.delete(typeId);
        resolve(null);
      }
    );
  });

  loadingPromises.set(typeId, loadPromise);
  return loadPromise;
}

/**
 * Editor Model Loader - Manages 3D models for the map editor
 *
 * Dynamically loads model configurations from assets.json to stay
 * in sync with the game's asset definitions.
 */
export class EditorModelLoader {
  /**
   * Initialize the model loader and preload common models
   */
  static async initialize(): Promise<void> {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      // Load configuration from assets.json
      await loadAssetConfig();

      // Preload all registered models
      const modelTypes = Array.from(modelConfigs.keys());
      await Promise.all(modelTypes.map((typeId) => loadModel(typeId)));
      isInitialized = true;
    })();

    return initPromise;
  }

  /**
   * Register a custom model configuration
   * Useful for game-specific extensions or runtime additions
   */
  static registerModel(typeId: string, config: ModelConfig): void {
    modelConfigs.set(typeId, config);
  }

  /**
   * Register multiple model configurations at once
   */
  static registerModels(configs: Record<string, ModelConfig>): void {
    for (const [typeId, config] of Object.entries(configs)) {
      modelConfigs.set(typeId, config);
    }
  }

  /**
   * Check if a model is available for a given type
   */
  static hasModel(typeId: string): boolean {
    return modelConfigs.has(typeId);
  }

  /**
   * Get the model config for a type
   */
  static getModelConfig(typeId: string): ModelConfig | null {
    return modelConfigs.get(typeId) || null;
  }

  /**
   * Get all registered model type IDs
   */
  static getRegisteredTypes(): string[] {
    return Array.from(modelConfigs.keys());
  }

  /**
   * Get a clone of a model for placing in the scene
   * Returns null if model is not available or not yet loaded
   */
  static getModelInstance(typeId: string): THREE.Object3D | null {
    const template = modelCache.get(typeId);
    if (!template) {
      // Start loading in background if not cached
      loadModel(typeId);
      return null;
    }

    // Clone the template
    const clone = template.clone(true);

    // Deep clone materials to allow per-instance modifications
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => m.clone());
        } else {
          child.material = child.material.clone();
        }
      }
    });

    return clone;
  }

  /**
   * Async version - loads and returns model instance
   */
  static async getModelInstanceAsync(typeId: string): Promise<THREE.Object3D | null> {
    await loadModel(typeId);
    return this.getModelInstance(typeId);
  }

  /**
   * Check if models are loaded and ready
   */
  static isReady(): boolean {
    return isInitialized;
  }

  /**
   * Get loading progress (0-1)
   */
  static getLoadingProgress(): number {
    const total = modelConfigs.size;
    if (total === 0) return 1;
    return modelCache.size / total;
  }

  /**
   * Dispose all cached models
   */
  static dispose(): void {
    for (const model of modelCache.values()) {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }
    modelCache.clear();
    loadingPromises.clear();
    isInitialized = false;
    initPromise = null;
  }

  /**
   * Reset and reload configurations
   * Useful when assets.json is updated
   */
  static async reload(): Promise<void> {
    this.dispose();
    modelConfigs.clear();
    configLoaded = false;
    await this.initialize();
  }
}

export default EditorModelLoader;
