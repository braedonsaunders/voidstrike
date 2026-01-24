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
  render,
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

// Selection ring materials (instanced)
export {
  createSelectionRingMaterial,
  createHoverRingMaterial,
  updateSelectionRingTime,
  TEAM_COLORS,
  type SelectionRingConfig,
} from './SelectionMaterial';

// Post-processing (includes TRAA from Three.js)
export {
  RenderPipeline,
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

// Water/Lava (legacy - main water now in WaterMesh.ts)
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
