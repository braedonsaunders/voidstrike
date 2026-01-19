/**
 * BuildingMaterials - Factory functions for building-related materials
 *
 * Centralizes material creation for BuildingRenderer following the
 * factory function pattern used by SelectionMaterial.ts.
 *
 * Each function accepts configuration and returns a ready-to-use material.
 */

import * as THREE from 'three';
import {
  BUILDING_CONSTRUCTION,
  BUILDING_SELECTION_RING,
  BUILDING_FIRE,
  BUILDING_PARTICLES,
  BUILDING_SCAFFOLD,
} from '@/data/rendering.config';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ConstructionMaterialConfig {
  color?: number;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}

export interface SelectionRingMaterialConfig {
  color: number;
  opacity?: number;
}

export interface FireMaterialConfig {
  color?: number;
  opacity?: number;
}

export interface ParticleMaterialConfig {
  color: number;
  size: number;
  opacity?: number;
  blending?: THREE.Blending;
  depthWrite?: boolean;
  sizeAttenuation?: boolean;
}

export interface LineMaterialConfig {
  color: number;
  opacity?: number;
  linewidth?: number;
}

export interface BasicMeshMaterialConfig {
  color: number;
  opacity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  depthWrite?: boolean;
}

// ============================================
// CONSTRUCTION MATERIALS
// ============================================

/**
 * Create material for buildings under construction
 */
export function createConstructingMaterial(
  config: ConstructionMaterialConfig = {}
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: config.color ?? BUILDING_CONSTRUCTION.COLOR,
    roughness: config.roughness ?? BUILDING_CONSTRUCTION.ROUGHNESS,
    metalness: config.metalness ?? BUILDING_CONSTRUCTION.METALNESS,
    transparent: true,
    opacity: config.opacity ?? BUILDING_CONSTRUCTION.OPACITY,
  });
}

// ============================================
// SELECTION RING MATERIALS
// ============================================

/**
 * Create material for building selection rings (non-animated)
 *
 * Note: This is distinct from SelectionMaterial.ts's createSelectionRingMaterial
 * which creates animated TSL materials for unit selection.
 */
export function createBuildingSelectionMaterial(
  config: SelectionRingMaterialConfig
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: config.opacity ?? BUILDING_SELECTION_RING.OPACITY,
    side: THREE.DoubleSide,
  });
}

/**
 * Create material for owned building selection (green)
 */
export function createOwnedSelectionMaterial(): THREE.MeshBasicMaterial {
  return createBuildingSelectionMaterial({
    color: BUILDING_SELECTION_RING.OWNED_COLOR,
  });
}

/**
 * Create material for enemy building selection (red)
 */
export function createEnemySelectionMaterial(): THREE.MeshBasicMaterial {
  return createBuildingSelectionMaterial({
    color: BUILDING_SELECTION_RING.ENEMY_COLOR,
  });
}

// ============================================
// FIRE EFFECT MATERIALS
// ============================================

/**
 * Create material for building fire effects
 */
export function createFireMaterial(
  config: FireMaterialConfig = {}
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: config.color ?? BUILDING_FIRE.COLOR,
    transparent: true,
    opacity: config.opacity ?? BUILDING_FIRE.OPACITY,
  });
}

/**
 * Create material for building smoke effects
 */
export function createSmokeMaterial(
  config: FireMaterialConfig = {}
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: config.color ?? BUILDING_FIRE.SMOKE_COLOR,
    transparent: true,
    opacity: config.opacity ?? BUILDING_FIRE.SMOKE_OPACITY,
  });
}

// ============================================
// PARTICLE MATERIALS
// ============================================

/**
 * Create generic particle material
 */
export function createParticleMaterial(
  config: ParticleMaterialConfig
): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    color: config.color,
    size: config.size,
    transparent: true,
    opacity: config.opacity ?? 1.0,
    blending: config.blending ?? THREE.NormalBlending,
    sizeAttenuation: config.sizeAttenuation ?? true,
    depthWrite: config.depthWrite ?? true,
  });
}

/**
 * Create material for construction dust particles
 */
export function createConstructionDustMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.DUST_COLOR,
    size: BUILDING_PARTICLES.DUST_SIZE,
    opacity: BUILDING_PARTICLES.DUST_OPACITY,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
}

/**
 * Create material for construction spark particles
 */
export function createConstructionSparkMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.SPARK_COLOR,
    size: BUILDING_PARTICLES.SPARK_SIZE,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Create material for thruster core particles (flying buildings)
 */
export function createThrusterCoreMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.THRUSTER_CORE_COLOR,
    size: BUILDING_PARTICLES.THRUSTER_CORE_SIZE,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Create material for thruster glow particles (flying buildings)
 */
export function createThrusterGlowMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.THRUSTER_GLOW_COLOR,
    size: BUILDING_PARTICLES.THRUSTER_GLOW_SIZE,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Create material for ground dust effect
 */
export function createGroundDustMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.GROUND_DUST_COLOR,
    size: BUILDING_PARTICLES.GROUND_DUST_SIZE,
    opacity: BUILDING_PARTICLES.GROUND_DUST_OPACITY,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
}

/**
 * Create material for metal debris particles
 */
export function createMetalDebrisMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.METAL_DEBRIS_COLOR,
    size: BUILDING_PARTICLES.METAL_DEBRIS_SIZE,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Create material for welding flash particles
 */
export function createWeldingFlashMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.WELDING_FLASH_COLOR,
    size: BUILDING_PARTICLES.WELDING_FLASH_SIZE,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Create material for blueprint pulse particles
 */
export function createBlueprintPulseMaterial(): THREE.PointsMaterial {
  return createParticleMaterial({
    color: BUILDING_PARTICLES.BLUEPRINT_PULSE_COLOR,
    size: BUILDING_PARTICLES.BLUEPRINT_PULSE_SIZE,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
}

// ============================================
// LINE MATERIALS
// ============================================

/**
 * Create generic line material
 */
export function createLineMaterial(
  config: LineMaterialConfig
): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: config.opacity ?? 1.0,
    linewidth: config.linewidth ?? 1,
  });
}

/**
 * Create material for blueprint holographic lines
 */
export function createBlueprintLineMaterial(): THREE.LineBasicMaterial {
  return createLineMaterial({
    color: BUILDING_PARTICLES.BLUEPRINT_LINE_COLOR,
    opacity: 0.8,
    linewidth: 1,
  });
}

/**
 * Create material for scaffold wireframe
 */
export function createScaffoldWireframeMaterial(): THREE.LineBasicMaterial {
  return createLineMaterial({
    color: BUILDING_SCAFFOLD.WIREFRAME_COLOR,
    opacity: BUILDING_SCAFFOLD.WIREFRAME_OPACITY,
    linewidth: 2,
  });
}

// ============================================
// MESH BASIC MATERIALS
// ============================================

/**
 * Create generic mesh basic material
 */
export function createBasicMeshMaterial(
  config: BasicMeshMaterialConfig
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: config.transparent ?? false,
    opacity: config.opacity ?? 1.0,
    side: config.side ?? THREE.FrontSide,
    depthWrite: config.depthWrite ?? true,
  });
}

/**
 * Create material for blueprint scan plane
 */
export function createBlueprintScanMaterial(): THREE.MeshBasicMaterial {
  return createBasicMeshMaterial({
    color: BUILDING_PARTICLES.BLUEPRINT_SCAN_COLOR,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Create material for scaffold poles
 */
export function createScaffoldPoleMaterial(): THREE.MeshBasicMaterial {
  return createBasicMeshMaterial({
    color: BUILDING_SCAFFOLD.POLE_COLOR,
  });
}

/**
 * Create material for scaffold beams
 */
export function createScaffoldBeamMaterial(): THREE.MeshBasicMaterial {
  return createBasicMeshMaterial({
    color: BUILDING_SCAFFOLD.BEAM_COLOR,
  });
}

// ============================================
// GEOMETRY HELPERS
// ============================================

/**
 * Create fire cone geometry
 */
export function createFireGeometry(): THREE.ConeGeometry {
  return new THREE.ConeGeometry(
    BUILDING_FIRE.CONE_RADIUS,
    BUILDING_FIRE.CONE_HEIGHT,
    BUILDING_FIRE.CONE_SEGMENTS
  );
}

/**
 * Create scaffold pole geometry (height = 1, scale to actual height)
 */
export function createScaffoldPoleGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(
    BUILDING_SCAFFOLD.POLE_RADIUS,
    BUILDING_SCAFFOLD.POLE_RADIUS,
    1,
    BUILDING_SCAFFOLD.SEGMENTS
  );
}

/**
 * Create scaffold beam geometry (height = 1, scale to actual length)
 */
export function createScaffoldBeamGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(
    BUILDING_SCAFFOLD.BEAM_RADIUS,
    BUILDING_SCAFFOLD.BEAM_RADIUS,
    1,
    BUILDING_SCAFFOLD.SEGMENTS
  );
}

/**
 * Create scaffold diagonal geometry (height = 1, scale to actual length)
 */
export function createScaffoldDiagonalGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(
    BUILDING_SCAFFOLD.DIAGONAL_RADIUS,
    BUILDING_SCAFFOLD.DIAGONAL_RADIUS,
    1,
    BUILDING_SCAFFOLD.SEGMENTS
  );
}

// ============================================
// MATERIAL BUNDLE (convenience)
// ============================================

export interface BuildingMaterialBundle {
  constructing: THREE.MeshStandardMaterial;
  selection: THREE.MeshBasicMaterial;
  enemySelection: THREE.MeshBasicMaterial;
  fire: THREE.MeshBasicMaterial;
  smoke: THREE.MeshBasicMaterial;
  constructionDust: THREE.PointsMaterial;
  constructionSpark: THREE.PointsMaterial;
  thrusterCore: THREE.PointsMaterial;
  thrusterGlow: THREE.PointsMaterial;
  blueprintLine: THREE.LineBasicMaterial;
  blueprintPulse: THREE.PointsMaterial;
  blueprintScan: THREE.MeshBasicMaterial;
  groundDust: THREE.PointsMaterial;
  metalDebris: THREE.PointsMaterial;
  weldingFlash: THREE.PointsMaterial;
  scaffoldWireframe: THREE.LineBasicMaterial;
  scaffoldPole: THREE.MeshBasicMaterial;
  scaffoldBeam: THREE.MeshBasicMaterial;
}

/**
 * Create all building materials at once
 *
 * Convenience function for creating the full set of materials
 * needed by BuildingRenderer.
 */
export function createBuildingMaterialBundle(): BuildingMaterialBundle {
  return {
    constructing: createConstructingMaterial(),
    selection: createOwnedSelectionMaterial(),
    enemySelection: createEnemySelectionMaterial(),
    fire: createFireMaterial(),
    smoke: createSmokeMaterial(),
    constructionDust: createConstructionDustMaterial(),
    constructionSpark: createConstructionSparkMaterial(),
    thrusterCore: createThrusterCoreMaterial(),
    thrusterGlow: createThrusterGlowMaterial(),
    blueprintLine: createBlueprintLineMaterial(),
    blueprintPulse: createBlueprintPulseMaterial(),
    blueprintScan: createBlueprintScanMaterial(),
    groundDust: createGroundDustMaterial(),
    metalDebris: createMetalDebrisMaterial(),
    weldingFlash: createWeldingFlashMaterial(),
    scaffoldWireframe: createScaffoldWireframeMaterial(),
    scaffoldPole: createScaffoldPoleMaterial(),
    scaffoldBeam: createScaffoldBeamMaterial(),
  };
}

export interface BuildingGeometryBundle {
  fire: THREE.ConeGeometry;
  scaffoldPole: THREE.CylinderGeometry;
  scaffoldBeam: THREE.CylinderGeometry;
  scaffoldDiagonal: THREE.CylinderGeometry;
}

/**
 * Create all building geometries at once
 *
 * Convenience function for creating shared geometries
 * used by BuildingRenderer.
 */
export function createBuildingGeometryBundle(): BuildingGeometryBundle {
  return {
    fire: createFireGeometry(),
    scaffoldPole: createScaffoldPoleGeometry(),
    scaffoldBeam: createScaffoldBeamGeometry(),
    scaffoldDiagonal: createScaffoldDiagonalGeometry(),
  };
}

/**
 * Dispose all materials in a bundle
 */
export function disposeMaterialBundle(bundle: BuildingMaterialBundle): void {
  Object.values(bundle).forEach((material) => {
    if (material && typeof material.dispose === 'function') {
      material.dispose();
    }
  });
}

/**
 * Dispose all geometries in a bundle
 */
export function disposeGeometryBundle(bundle: BuildingGeometryBundle): void {
  Object.values(bundle).forEach((geometry) => {
    if (geometry && typeof geometry.dispose === 'function') {
      geometry.dispose();
    }
  });
}
