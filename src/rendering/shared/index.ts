/**
 * Shared rendering utilities
 *
 * Consolidates common rendering patterns used across UnitRenderer and BuildingRenderer.
 */

export { HealthBarRenderer, DEFAULT_HEALTH_BAR_CONFIG } from './HealthBarRenderer';
export type { HealthBarConfig } from './HealthBarRenderer';

export { SelectionRingRenderer } from './SelectionRingRenderer';
export type { SelectionRingConfig, SelectionRingInstance } from './SelectionRingRenderer';

export {
  TransformUtils,
  InstancedMeshUtils,
  CachedTerrainHeight,
  SmoothRotation,
  EntityIdTracker,
} from './InstancedMeshPool';
