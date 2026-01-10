/**
 * TSL Procedural Terrain Material
 *
 * WebGPU-compatible procedural terrain shader using Three.js Shading Language.
 * Features:
 * - Multi-octave noise for realistic detail
 * - Procedural normal maps for surface micro-detail
 * - Height and slope-based material blending
 * - Triplanar mapping for cliffs (no UV stretching)
 * - Atmospheric distance fog
 * - PBR-like lighting model
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  uniform,
  attribute,
  varyingProperty,
  positionLocal,
  positionWorld,
  normalWorld,
  normalLocal,
  cameraPosition,
  modelWorldMatrix,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  color,
  Fn,
  normalize,
  abs,
  max,
  min,
  mix,
  dot,
  pow,
  smoothstep,
  clamp,
  exp,
  length,
  cross,
  reflect,
} from 'three/tsl';

import { snoise3D, fbm3, fbm4, fbm5, triplanarNoise, calculateDetailNormal } from './noise';

// ============================================
// UNIFORM DEFINITIONS
// ============================================

export interface ProceduralTerrainConfig {
  groundColor: THREE.Color;
  rockColor: THREE.Color;
  accentColor: THREE.Color;
  snowLine: number;
  fogDensity: number;
  fogColor: THREE.Color;
  sunDirection?: THREE.Vector3;
  sunIntensity?: number;
}

// ============================================
// TERRAIN MATERIAL FACTORY
// ============================================

export function createProceduralTerrainMaterial(config: ProceduralTerrainConfig): MeshStandardNodeMaterial {
  // Create uniforms
  const uTime = uniform(0);
  const uGroundColor = uniform(config.groundColor);
  const uRockColor = uniform(config.rockColor);
  const uAccentColor = uniform(config.accentColor);
  const uSnowLine = uniform(config.snowLine);
  const uFogDensity = uniform(config.fogDensity);
  const uFogColor = uniform(config.fogColor);
  const uSunDirection = uniform(config.sunDirection ?? new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunIntensity = uniform(config.sunIntensity ?? 1.0);

  // Get slope factor (0 = flat, 1 = vertical cliff)
  const getSlopeFactor = Fn(([normal]: [any]) => {
    return float(1.0).sub(abs(dot(normal, vec3(0.0, 1.0, 0.0))));
  });

  // Blend terrain materials based on height, slope, and noise
  const blendTerrainMaterials = Fn(([
    worldPos,
    worldNormal,
    elevation,
    groundCol,
    rockCol,
    accentCol,
    snowLineHeight
  ]: [any, any, any, any, any, any, any]) => {
    const slope = getSlopeFactor(worldNormal);

    // Base noise for variation
    const largeNoise = fbm3(worldPos.mul(0.1)).mul(0.5).add(0.5);
    const mediumNoise = fbm4(worldPos.mul(0.3)).mul(0.5).add(0.5);
    const fineNoise = fbm5(worldPos.mul(1.2)).mul(0.5).add(0.5);

    // Ground color with variation
    const groundVaried = vec3(groundCol).toVar();
    groundVaried.assign(mix(groundVaried, groundCol.mul(0.7), mediumNoise.mul(0.3)));
    groundVaried.assign(mix(groundVaried, accentCol, smoothstep(0.6, 0.9, largeNoise).mul(0.15)));

    // Rock color with variation
    const rockVaried = vec3(rockCol).toVar();
    rockVaried.assign(mix(rockVaried, rockCol.mul(0.6), fineNoise.mul(0.4)));
    rockVaried.assign(mix(rockVaried, rockCol.mul(1.2), mediumNoise.mul(0.2)));

    // Height-based blending
    const heightFactor = smoothstep(2.0, 5.0, elevation);

    // Slope-based blending (steep = rock)
    const slopeFactor = smoothstep(0.3, 0.7, slope);

    // Combine factors with noise for natural transitions
    const rockBlend = max(slopeFactor, heightFactor.mul(0.5)).toVar();
    rockBlend.addAssign(fineNoise.sub(0.5).mul(0.2));
    rockBlend.assign(clamp(rockBlend, 0.0, 1.0));

    const result = mix(groundVaried, rockVaried, rockBlend).toVar();

    // Snow on high areas (if snow line is set)
    const snowFactor = smoothstep(snowLineHeight.sub(1.0), snowLineHeight.add(1.0), elevation).toVar();
    snowFactor.mulAssign(float(1.0).sub(slope.mul(0.7)));
    snowFactor.addAssign(fineNoise.sub(0.5).mul(0.15));
    snowFactor.assign(clamp(snowFactor, 0.0, 1.0));

    const snowColor = vec3(0.95, 0.97, 1.0);
    result.assign(mix(result, snowColor, snowFactor.mul(float(snowLineHeight).greaterThan(0.0).select(1.0, 0.0))));

    return result;
  });

  // Calculate lighting
  const calculateLighting = Fn(([
    baseColor,
    worldNormal,
    proceduralNormal,
    viewDir,
    sunDir,
    sunIntensity
  ]: [any, any, any, any, any, any]) => {
    // Combine geometry normal with procedural detail normal
    const finalNormal = normalize(worldNormal.add(proceduralNormal.mul(0.3)));

    // Diffuse lighting
    const NdotL = max(dot(finalNormal, sunDir), 0.0);
    const diffuse = NdotL.mul(sunIntensity);

    // Ambient with slight AO from procedural normal
    const ao = float(0.5).add(dot(worldNormal, proceduralNormal).mul(0.5));
    const ambient = float(0.4).mul(ao);

    // Rim lighting for depth
    const rim = float(1.0).sub(max(dot(viewDir, finalNormal), 0.0)).toVar();
    rim.assign(pow(rim, 3.0).mul(0.15));

    // Specular highlight (subtle)
    const halfVec = normalize(sunDir.add(viewDir));
    const spec = pow(max(dot(finalNormal, halfVec), 0.0), 32.0).mul(0.1);

    const lit = baseColor.mul(ambient.add(diffuse)).add(vec3(spec)).add(vec3(rim.mul(0.5)));

    return lit;
  });

  // Create the material
  const material = new MeshStandardNodeMaterial();

  // Vertex color from geometry
  const vertexColor = attribute('color', 'vec3');

  // Pass elevation through varying
  const vElevation = varyingProperty('float', 'vElevation');

  // Set up vertex shader - compute elevation
  // Note: positionLocal.z is elevation before rotation
  material.positionNode = Fn(() => {
    vElevation.assign(positionLocal.z);
    return positionLocal;
  })();

  // Main fragment shader logic
  material.colorNode = Fn(() => {
    const worldPos = positionWorld;
    const worldNorm = normalWorld;
    const viewDir = normalize(cameraPosition.sub(worldPos));
    const elevation = vElevation;

    // Calculate procedural normal for surface detail
    const proceduralNormal = calculateDetailNormal(worldPos, float(0.5), float(0.8));

    // Get terrain base color from material blending
    const baseColor = blendTerrainMaterials(
      worldPos,
      worldNorm,
      elevation,
      uGroundColor,
      uRockColor,
      uAccentColor,
      uSnowLine
    );

    // Mix with vertex colors for map-specific variation
    const mixedColor = mix(baseColor, vertexColor, 0.3);

    // Add fine detail noise for texture
    const detailNoise = fbm5(worldPos.mul(3.0)).mul(0.5).add(0.5);
    const texturedColor = mixedColor.mul(float(0.85).add(detailNoise.mul(0.3)));

    // Apply lighting
    const litColor = calculateLighting(
      texturedColor,
      worldNorm,
      proceduralNormal,
      viewDir,
      uSunDirection,
      uSunIntensity
    ).toVar();

    // Distance fog
    const dist = length(worldPos.sub(cameraPosition));
    const fogFactor = float(1.0).sub(exp(dist.mul(uFogDensity).mul(0.01).negate())).toVar();
    fogFactor.assign(clamp(fogFactor, 0.0, 0.6));
    litColor.assign(mix(litColor, uFogColor, fogFactor));

    // Slight color grading for richness
    litColor.assign(pow(litColor, vec3(0.95)));
    litColor.assign(mix(litColor, litColor.mul(vec3(1.02, 1.0, 0.98)), 0.3));

    return litColor;
  })();

  // Store uniforms for external updates
  (material as any)._uniforms = {
    uTime,
    uGroundColor,
    uRockColor,
    uAccentColor,
    uSnowLine,
    uFogDensity,
    uFogColor,
    uSunDirection,
    uSunIntensity,
  };

  return material;
}

/**
 * Update terrain shader uniforms per frame
 */
export function updateProceduralTerrainMaterial(
  material: MeshStandardNodeMaterial,
  deltaTime: number,
  sunDirection?: THREE.Vector3
): void {
  const uniforms = (material as any)._uniforms;
  if (!uniforms) return;

  uniforms.uTime.value += deltaTime;

  if (sunDirection) {
    uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }
}

/**
 * Get biome shader configuration
 */
export function getBiomeShaderConfig(biome: {
  colors: {
    ground: THREE.Color[];
    rock: THREE.Color;
    accent: THREE.Color[];
    water: THREE.Color;
  };
  atmosphere: {
    fogColor: THREE.Color;
    fogDensity: number;
    sunColor: THREE.Color;
    sunIntensity: number;
    ambientIntensity: number;
  };
  features: {
    snowLine: number;
    waterLevel: number;
    treeLineMax: number;
    treeLineMin: number;
  };
}): ProceduralTerrainConfig {
  return {
    groundColor: biome.colors.ground[0] ?? new THREE.Color(0.4, 0.5, 0.3),
    rockColor: biome.colors.rock,
    accentColor: biome.colors.accent[0] ?? new THREE.Color(0.5, 0.4, 0.3),
    snowLine: biome.features.snowLine,
    fogDensity: biome.atmosphere.fogDensity,
    fogColor: biome.atmosphere.fogColor,
    sunIntensity: biome.atmosphere.sunIntensity,
  };
}
