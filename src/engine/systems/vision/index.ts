/**
 * Vision System Module Index
 *
 * Industry-standard fog of war implementation:
 * - VisionOptimizer: Reference counting and cell boundary tracking
 * - LineOfSight: Height-based LOS blocking
 */

export {
  VisionOptimizer,
  type VisionCasterState,
  type CellReferenceCount,
  type VisionOptimizerConfig,
} from './VisionOptimizer';
export { LineOfSight, type LOSConfig, type HeightProvider } from './LineOfSight';
