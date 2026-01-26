/**
 * EditorModelLoader - GLTF model loader for the map editor
 *
 * Loads real 3D models for decorations and objects in the editor,
 * replacing placeholder geometries with actual game assets.
 * Uses the same scale values as assets.json for consistency.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Model configuration mapping decoration IDs to model paths and settings
export interface ModelConfig {
  path: string;
  scale: number; // Target height in game units (matches assets.json)
  rotationY?: number; // Base rotation offset in degrees
}

// Maps editor object type IDs to their model configurations
// Scale values match assets.json for consistency with game rendering
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Trees - from assets.json decorations section
  decoration_tree_pine_tall: {
    path: '/models/decorations/tree_pine_tall_LOD0.glb',
    scale: 14.0,
    rotationY: -90,
  },
  decoration_tree_pine_medium: {
    path: '/models/decorations/tree_pine_tall_LOD0.glb',
    scale: 10.0,
    rotationY: -90,
  },
  decoration_tree_dead: {
    path: '/models/decorations/tree_dead_LOD0.glb',
    scale: 9.0,
    rotationY: -90,
  },
  decoration_tree_alien: {
    path: '/models/decorations/tree_alien_LOD0.glb',
    scale: 11.0,
    rotationY: -90,
  },
  decoration_tree_palm: {
    path: '/models/decorations/tree_palm_LOD0.glb',
    scale: 11.0,
    rotationY: -90,
  },
  decoration_tree_mushroom: {
    path: '/models/decorations/tree_mushroom_LOD0.glb',
    scale: 8.0,
    rotationY: -90,
  },

  // Rocks - from assets.json decorations section
  decoration_rocks_large: {
    path: '/models/decorations/rocks_large_LOD0.glb',
    scale: 3.0,
    rotationY: -90,
  },
  decoration_rocks_small: {
    path: '/models/decorations/rocks_small_LOD0.glb',
    scale: 2.0,
    rotationY: -90,
  },
  decoration_rock_single: {
    path: '/models/decorations/rock_single_LOD0.glb',
    scale: 2.5,
    rotationY: -90,
  },

  // Special decorations - from assets.json decorations section
  decoration_crystal_formation: {
    path: '/models/decorations/crystal_formation_LOD0.glb',
    scale: 4.0,
    rotationY: -90,
  },
  decoration_bush: {
    path: '/models/decorations/shrub_LOD0.glb',
    scale: 1.5,
    rotationY: -90,
  },
  decoration_ruined_wall: {
    path: '/models/decorations/ruined_wall_LOD0.glb',
    scale: 5.0,
    rotationY: -90,
  },
  decoration_alien_tower: {
    path: '/models/decorations/alien_tower_LOD0.glb',
    scale: 14.0,
    rotationY: -90,
  },
  decoration_debris: {
    path: '/models/decorations/debris_LOD0.glb',
    scale: 1.5,
    rotationY: -90,
  },

  // Game objects using decoration models
  watch_tower: {
    path: '/models/decorations/alien_tower_LOD0.glb',
    scale: 14.0,
    rotationY: -90,
  },
  destructible_rock: {
    path: '/models/decorations/rock_single_LOD0.glb',
    scale: 2.5,
    rotationY: -90,
  },
  destructible_debris: {
    path: '/models/decorations/debris_LOD0.glb',
    scale: 1.5,
    rotationY: -90,
  },
};

// DRACO loader for compressed meshes
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
dracoLoader.setDecoderConfig({ type: 'js' });

// GLTF loader instance with DRACO support
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// Cache for loaded models (template instances)
const modelCache = new Map<string, THREE.Object3D>();

// Loading promises to prevent duplicate loads
const loadingPromises = new Map<string, Promise<THREE.Object3D | null>>();

// Track loading state
let isInitialized = false;
let initPromise: Promise<void> | null = null;

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
  const config = MODEL_CONFIGS[typeId];
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
        console.warn(`[EditorModelLoader] Failed to load model for ${typeId}:`, error);
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
 */
export class EditorModelLoader {
  /**
   * Initialize the model loader and preload common models
   */
  static async initialize(): Promise<void> {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      // Preload all decoration models
      const modelTypes = Object.keys(MODEL_CONFIGS);
      await Promise.all(modelTypes.map((typeId) => loadModel(typeId)));
      isInitialized = true;
    })();

    return initPromise;
  }

  /**
   * Check if a model is available for a given type
   */
  static hasModel(typeId: string): boolean {
    return MODEL_CONFIGS[typeId] !== undefined;
  }

  /**
   * Get the model config for a type
   */
  static getModelConfig(typeId: string): ModelConfig | null {
    return MODEL_CONFIGS[typeId] || null;
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
    const total = Object.keys(MODEL_CONFIGS).length;
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
}

export default EditorModelLoader;
