/**
 * Water Rendering Module
 *
 * Provides unified water mesh rendering with single draw call optimization.
 * Replaces the legacy WaterMesh implementation that created separate meshes
 * per region, drastically reducing GPU memory usage and draw calls.
 *
 * Components:
 * - UnifiedWaterMesh: Single draw call water surface with depth-based coloring
 * - WaterMemoryManager: GPU memory budget management and quality selection
 * - PlanarReflection: Shared planar reflection for ultra quality water
 */

export {
  UnifiedWaterMesh,
  createBasicWaterMaterial,
  type WaterQuality,
  type WaterRegion,
  type WaterCell,
  type UnifiedWaterConfig,
} from './UnifiedWaterMesh';

export {
  WaterMemoryManager,
  getWaterMemoryManager,
  getWaterMemoryManagerSync,
  type MemoryEstimate,
} from './WaterMemoryManager';

export {
  PlanarReflection,
  createPlanarReflectionForQuality,
  createReflectionLayers,
  type PlanarReflectionConfig,
} from './PlanarReflection';
