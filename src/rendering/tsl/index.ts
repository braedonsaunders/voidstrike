/**
 * TSL (Three.js Shading Language) Module
 *
 * WebGPU-compatible rendering components for VOIDSTRIKE.
 * All components automatically compile to WGSL (WebGPU) or GLSL (WebGL fallback).
 */

// Type declarations for Three.js WebGPU/TSL modules
/// <reference path="./types.d.ts" />

// Core renderer
export {
  createWebGPURenderer,
  updateRendererSize,
  executeCompute,
  render,
  renderAsync,
  disposeRenderer,
  type WebGPURendererConfig,
  type RenderContext,
} from './WebGPURenderer';

// Noise utilities
export {
  snoise3D,
  fbm2,
  fbm3,
  fbm4,
  fbm5,
  voronoi2D,
  hashNoise2D,
  triplanarNoise,
  calculateDetailNormal,
  calculateMicroNormal,
} from './noise';

// Terrain materials
export {
  createProceduralTerrainMaterial,
  updateProceduralTerrainMaterial,
  getBiomeShaderConfig as getProceduralBiomeConfig,
  type ProceduralTerrainConfig,
} from './ProceduralTerrainMaterial';

export {
  createTextureTerrainMaterial,
  updateTextureTerrainMaterial,
  getBiomeTextureConfig,
  type TextureTerrainConfig,
  type BiomeTextureType,
} from './TextureTerrainMaterial';

// Selection system
export {
  SelectionSystem,
  createSelectionRingMaterial,
  createHoverRingMaterial,
  updateSelectionMaterial,
  TEAM_COLORS,
  type SelectionRingConfig,
} from './SelectionMaterial';

// Particle system
export {
  GPUParticleSystem,
  EffectEmitter,
  PARTICLE_PRESETS,
  type ParticleEffectConfig,
} from './ParticleSystem';

// Post-processing
export {
  RenderPipeline,
  createSimplePostProcessing,
  ScreenShake,
  DamageVignette,
  type PostProcessingConfig,
  type AntiAliasingMode,
} from './PostProcessing';

// Temporal Anti-Aliasing (TAA)
export {
  TAASystem,
  TAAJitterManager,
  TAAHistoryManager,
  TAAMotionVectorGenerator,
  createTAAResolvePass,
  createRCASPass,
  HALTON_SEQUENCE_16,
  DEFAULT_TAA_CONFIG,
  type TAAConfig,
} from './TAA';

// Map effects
export {
  TSLMapBorderFog,
  type MapBorderFogConfig,
} from './MapBorderFog';

// Fog of War
export {
  TSLFogOfWar,
  type TSLFogOfWarConfig,
} from './FogOfWar';

// Water/Lava
export {
  TSLWaterPlane,
} from './WaterPlane';

// Game Overlays
export {
  TSLGameOverlayManager,
} from './GameOverlay';

// Terrain Material
export {
  TSLTerrainMaterial,
  type TSLTerrainConfig,
} from './TerrainMaterial';
