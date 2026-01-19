/**
 * TSL (Three.js Shading Language) Module
 *
 * WebGPU-compatible rendering components for VOIDSTRIKE.
 * All components automatically compile to WGSL (WebGPU) or GLSL (WebGL fallback).
 *
 * Type declarations for WebGPU/TSL are in src/types/three-webgpu.d.ts
 */

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

// Post-processing (includes TRAA from Three.js)
export {
  RenderPipeline,
  createSimplePostProcessing,
  ScreenShake,
  DamageVignette,
  type PostProcessingConfig,
  type AntiAliasingMode,
  type UpscalingMode,
} from './PostProcessing';

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

// Resolution Upscaling (EASU/RCAS - FSR-inspired)
export {
  easuUpscale,
  rcasSharpening,
  createEASUPass,
  createRCASPass,
  TemporalSpatialUpscaler,
  type EASUConfig,
  type RCASConfig,
  type TSUConfig,
} from './UpscalerNode';
