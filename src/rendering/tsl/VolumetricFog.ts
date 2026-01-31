/**
 * Volumetric Fog TSL Implementation
 *
 * Raymarched volumetric fog with light scattering for atmospheric effects.
 * Can be used for global atmosphere, building smoke, geyser gas, etc.
 */

import * as THREE from 'three';
import {
  Fn,
  vec2,
  vec3,
  vec4,
  float,
  int,
  uniform,
  uv,
  texture,
  clamp,
  smoothstep,
  mix,
  max,
  min,
  dot,
  normalize,
  length,
  exp,
  abs,
  Loop,
  If,
  Break,
} from 'three/tsl';

// Quality presets - number of raymarch steps
export const VOLUMETRIC_FOG_QUALITY = {
  low: 16,
  medium: 32,
  high: 64,
  ultra: 128,
} as const;

export type VolumetricFogQuality = keyof typeof VOLUMETRIC_FOG_QUALITY;

export interface VolumetricFogConfig {
  quality: VolumetricFogQuality;
  density: number; // Base fog density multiplier
  scattering: number; // Light scattering intensity
  fogColor: THREE.Color;
  lightColor: THREE.Color;
  lightDirection: THREE.Vector3;
  heightFalloff: number; // How quickly fog dissipates with height
  maxDistance: number; // Maximum raymarch distance
}

/**
 * Henyey-Greenstein phase function for anisotropic scattering
 * g: anisotropy factor (-1 to 1, 0 = isotropic, positive = forward scattering)
 */
const henyeyGreenstein = Fn(({ cosTheta, g }: { cosTheta: any; g: any }) => {
  const g2 = g.mul(g);
  const denom = float(1.0).add(g2).sub(g.mul(2.0).mul(cosTheta));
  return float(1.0).sub(g2).div(denom.pow(1.5).mul(4.0 * Math.PI));
});

/**
 * Create volumetric fog post-processing node
 *
 * @param sceneColorTexture - Scene color input
 * @param depthTexture - Scene depth buffer
 * @param camera - Camera for world space reconstruction
 */
export function createVolumetricFogNode(
  sceneColorTexture: any,
  depthTexture: any,
  camera: THREE.PerspectiveCamera
) {
  // Uniforms
  const uEnabled = uniform(1.0);
  const uDensity = uniform(0.02);
  const uScattering = uniform(1.0);
  const uFogColor = uniform(new THREE.Color(0x4466aa));
  const uLightColor = uniform(new THREE.Color(0xffeedd));
  const uLightDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uHeightFalloff = uniform(0.1);
  const uMaxDistance = uniform(100.0);
  const uSteps = uniform(32);
  const uTime = uniform(0.0);

  // Camera uniforms for world reconstruction
  const uCameraNear = uniform(camera.near);
  const uCameraFar = uniform(camera.far);
  const uCameraPos = uniform(camera.position);
  const uInverseProjection = uniform(new THREE.Matrix4());
  const uInverseView = uniform(new THREE.Matrix4());

  // Fog node using TSL Fn
  const volumetricFogNode = Fn(() => {
    const fragUV = uv();
    // Use sceneColorTexture directly - it works with both texture nodes (auto-sampled at current UV)
    // and Fn nodes (already computed values from previous effect chain like SSGI/SSR)
    const sceneColor = vec3(sceneColorTexture);

    // Early exit if disabled
    const enabled = uEnabled.greaterThan(0.5);

    // Sample depth and convert to linear
    const depthSample = texture(depthTexture, fragUV).r;

    // Convert depth to linear distance
    const z = depthSample.mul(2.0).sub(1.0);
    const linearDepth = uCameraNear.mul(uCameraFar).div(
      uCameraFar.sub(z.mul(uCameraFar.sub(uCameraNear)))
    );

    // Reconstruct world position from depth
    const ndcPos = vec4(
      fragUV.x.mul(2.0).sub(1.0),
      fragUV.y.mul(2.0).sub(1.0),
      z,
      float(1.0)
    );

    // Calculate ray direction (simplified - assumes standard camera setup)
    const rayDir = normalize(vec3(
      fragUV.x.sub(0.5).mul(2.0),
      fragUV.y.sub(0.5).mul(2.0).mul(-1.0),
      float(-1.0)
    ));

    // Raymarch parameters
    const maxDist = min(linearDepth, uMaxDistance);
    const stepSize = maxDist.div(uSteps);

    // Accumulation variables
    const transmittance = float(1.0).toVar();
    const inScattering = vec3(0.0).toVar();

    // Raymarch loop with manual counter
    // Use max quality (128) with early exit for dynamic quality control
    const loopIndex = int(0).toVar();
    Loop(128, () => {
      // Early exit when we've done enough steps for current quality
      If(loopIndex.greaterThanEqual(uSteps), () => {
        Break();
      });

      const t = float(loopIndex).mul(stepSize);
      const samplePos = uCameraPos.add(rayDir.mul(t));

      // Height-based density falloff
      const heightFactor = exp(samplePos.y.negate().mul(uHeightFalloff));
      const localDensity = uDensity.mul(heightFactor);

      // Light scattering (Henyey-Greenstein with g=0.3 for slight forward scatter)
      const cosTheta = dot(rayDir, uLightDir);
      const phase = henyeyGreenstein({ cosTheta, g: float(0.3) });

      // Accumulate scattering
      const scatterAmount = localDensity.mul(phase).mul(uScattering).mul(stepSize);
      inScattering.addAssign(
        uLightColor.mul(scatterAmount).mul(transmittance)
      );

      // Beer-Lambert absorption
      transmittance.mulAssign(exp(localDensity.mul(stepSize).negate()));

      // Increment loop counter
      loopIndex.addAssign(1);
    });

    // Combine fog with scene
    const fogContribution = uFogColor.mul(float(1.0).sub(transmittance)).add(inScattering);
    const finalColor = mix(fogContribution, sceneColor, transmittance);

    // Return final color, with fallback to scene color if disabled
    return vec4(
      mix(sceneColor, finalColor, uEnabled),
      float(1.0)
    );
  });

  return {
    node: volumetricFogNode(),
    uniforms: {
      enabled: uEnabled,
      density: uDensity,
      scattering: uScattering,
      fogColor: uFogColor,
      lightColor: uLightColor,
      lightDir: uLightDir,
      heightFalloff: uHeightFalloff,
      maxDistance: uMaxDistance,
      steps: uSteps,
      time: uTime,
      cameraNear: uCameraNear,
      cameraFar: uCameraFar,
      cameraPos: uCameraPos,
      inverseProjection: uInverseProjection,
      inverseView: uInverseView,
    },
    /**
     * Update camera matrices (call before render)
     */
    updateCamera: (cam: THREE.PerspectiveCamera) => {
      uCameraNear.value = cam.near;
      uCameraFar.value = cam.far;
      uCameraPos.value.copy(cam.position);
      uInverseProjection.value.copy(cam.projectionMatrixInverse);
      uInverseView.value.copy(cam.matrixWorld);
    },
    /**
     * Apply configuration
     */
    applyConfig: (config: Partial<VolumetricFogConfig>) => {
      if (config.quality !== undefined) {
        uSteps.value = VOLUMETRIC_FOG_QUALITY[config.quality];
      }
      if (config.density !== undefined) {
        uDensity.value = config.density * 0.02; // Scale to reasonable range
      }
      if (config.scattering !== undefined) {
        uScattering.value = config.scattering;
      }
      if (config.fogColor !== undefined) {
        uFogColor.value.copy(config.fogColor);
      }
      if (config.lightColor !== undefined) {
        uLightColor.value.copy(config.lightColor);
      }
      if (config.lightDirection !== undefined) {
        uLightDir.value.copy(config.lightDirection).normalize();
      }
      if (config.heightFalloff !== undefined) {
        uHeightFalloff.value = config.heightFalloff;
      }
      if (config.maxDistance !== undefined) {
        uMaxDistance.value = config.maxDistance;
      }
    },
    /**
     * Enable/disable fog
     */
    setEnabled: (enabled: boolean) => {
      uEnabled.value = enabled ? 1.0 : 0.0;
    },
  };
}

export type VolumetricFogNode = ReturnType<typeof createVolumetricFogNode>;
