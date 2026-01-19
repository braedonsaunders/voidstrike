/**
 * Effects Module - Post-processing effect creation and management
 *
 * This module exports all effect-related functionality for the
 * post-processing pipeline.
 */

// Effect pass creation functions
export {
  // SSGI
  createSSGIPass,
  type SSGIConfig,
  type SSGIPassResult,

  // GTAO
  createGTAOPass,
  applyAOToColor,
  type GTAOConfig,
  type GTAOPassResult,

  // SSR
  createSSRPass,
  applySSRToColor,
  type SSRConfig,
  type SSRPassResult,

  // Bloom
  createBloomPass,
  type BloomConfig,
  type BloomPassResult,

  // Volumetric Fog
  createVolumetricFogPass,
  type VolumetricFogConfig,
  type VolumetricFogPassResult,

  // Color Grading
  createColorGradingPass,
  acesToneMap,
  type ColorGradingConfig,
  type ColorGradingUniforms,

  // Sharpening
  createSharpeningPass,
  type SharpeningConfig,

  // Anti-aliasing
  createTRAAPass,
  createFXAAPass,
  type TRAAPassResult,
  type FXAAPassResult,

  // Temporal upscaling helpers
  createTemporalAOUpscaleNode,
  createTemporalSSRUpscaleNode,
  createTemporalBlendNode,
  createFullResTemporalSSRNode,
} from './EffectPasses';

// Temporal pipeline management
export {
  // Pipeline creation
  createQuarterAOPipeline,
  createQuarterSSRPipeline,
  type QuarterResPipelineContext,

  // Manager class
  TemporalEffectsManager,

  // Helper functions
  shouldInitializeTemporalEffects,
} from './TemporalManager';

// Temporal utilities (shared building blocks)
export {
  // UV reprojection
  calculateReprojectedUV,
  isUVInBounds,

  // Neighborhood clamping
  sampleNeighborhoodBounds,
  applyNeighborhoodClamp,

  // Core temporal blend
  temporalBlend,

  // High-level blend nodes
  createSimpleTemporalBlendNode,
  createClampedTemporalBlendNode,
  createSingleChannelTemporalBlendNode,

  // Default blend factors
  DEFAULT_AO_BLEND_FACTOR,
  DEFAULT_SSR_BLEND_FACTOR,
  DEFAULT_TEMPORAL_BLEND_FACTOR,

  // Types
  type TemporalBlendConfig,
  type NeighborhoodClampConfig,
} from './TemporalUtils';
