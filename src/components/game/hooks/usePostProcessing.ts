/**
 * usePostProcessing Hook
 *
 * Manages the post-processing pipeline configuration and graphics settings subscriptions.
 * Handles runtime updates to visual effects, fog of war, shadows, and environment settings.
 */

import type { MutableRefObject, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RenderContext, RenderPipeline, TSLFogOfWar } from '@/rendering/tsl';
import { EnvironmentManager } from '@/rendering/EnvironmentManager';
import { LightPool } from '@/rendering/LightPool';
import { RTSCamera } from '@/rendering/Camera';
import { initCameraMatrices } from '@/rendering/tsl/InstancedVelocity';
import { useUIStore, FIXED_RESOLUTIONS, UIState } from '@/store/uiStore';
import { useGameSetupStore, isSpectatorMode } from '@/store/gameSetupStore';
import { MapData } from '@/data/maps';

export interface UsePostProcessingProps {
  renderContextRef: MutableRefObject<RenderContext | null>;
  renderPipelineRef: MutableRefObject<RenderPipeline | null>;
  sceneRef: MutableRefObject<THREE.Scene | null>;
  cameraRef: MutableRefObject<RTSCamera | null>;
  environmentRef: MutableRefObject<EnvironmentManager | null>;
  lightPoolRef: MutableRefObject<LightPool | null>;
  /** @deprecated Fog of war is now handled via RenderPipeline */
  fogOfWarRef?: MutableRefObject<TSLFogOfWar | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  map: MapData;
}

export function usePostProcessing({
  renderContextRef,
  renderPipelineRef,
  sceneRef,
  cameraRef,
  environmentRef,
  lightPoolRef,
  fogOfWarRef: _fogOfWarRef,
  containerRef,
  map,
}: UsePostProcessingProps): void {
  // Store map in a ref so effects always get the latest value
  const mapRef = useRef<MapData>(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  // Subscribe to overlay settings changes
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState) => {
      const overlaySettings = state.overlaySettings;
      const prevOverlaySettings = prevState.overlaySettings;

      if (overlaySettings === prevOverlaySettings) return;

      // Overlay settings are handled by the overlay manager in useWebGPURenderer
      // This hook focuses on post-processing pipeline settings
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to graphics settings changes
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState) => {
      const settings = state.graphicsSettings;
      const prevSettings = prevState.graphicsSettings;

      if (settings === prevSettings) return;

      // Update post-processing pipeline
      if (renderPipelineRef.current) {
        renderPipelineRef.current.applyConfig({
          bloomEnabled: settings.bloomEnabled,
          bloomStrength: settings.bloomStrength,
          bloomRadius: settings.bloomRadius,
          bloomThreshold: settings.bloomThreshold,
          aoEnabled: settings.ssaoEnabled,
          aoRadius: settings.ssaoRadius,
          aoIntensity: settings.ssaoIntensity,
          ssrEnabled: settings.ssrEnabled,
          ssrOpacity: settings.ssrOpacity,
          ssrMaxRoughness: settings.ssrMaxRoughness,
          ssgiEnabled: settings.ssgiEnabled,
          ssgiRadius: settings.ssgiRadius,
          ssgiIntensity: settings.ssgiIntensity,
          ssgiThickness: 1,
          antiAliasingMode: settings.antiAliasingMode,
          fxaaEnabled: settings.fxaaEnabled,
          taaEnabled: settings.taaEnabled,
          taaSharpeningEnabled: settings.taaSharpeningEnabled,
          taaSharpeningIntensity: settings.taaSharpeningIntensity,
          upscalingMode: settings.upscalingMode,
          renderScale: settings.renderScale,
          easuSharpness: settings.easuSharpness,
          vignetteEnabled: settings.vignetteEnabled,
          vignetteIntensity: settings.vignetteIntensity,
          exposure: settings.toneMappingExposure,
          saturation: settings.saturation,
          contrast: settings.contrast,
          volumetricFogEnabled: settings.volumetricFogEnabled,
          volumetricFogQuality: settings.volumetricFogQuality,
          volumetricFogDensity: settings.volumetricFogDensity,
          volumetricFogScattering: settings.volumetricFogScattering,
          fogOfWarQuality: settings.fogOfWarQuality,
          fogOfWarEdgeBlur: settings.fogOfWarEdgeBlur,
          fogOfWarDesaturation: settings.fogOfWarDesaturation,
          fogOfWarExploredDarkness: settings.fogOfWarExploredDarkness,
          fogOfWarUnexploredDarkness: settings.fogOfWarUnexploredDarkness,
          fogOfWarCloudSpeed: settings.fogOfWarCloudSpeed,
          fogOfWarRimIntensity: settings.fogOfWarRimIntensity,
          fogOfWarHeightInfluence: settings.fogOfWarHeightInfluence,
        });
      }

      // Handle post-processing toggle
      if (settings.postProcessingEnabled !== prevSettings.postProcessingEnabled) {
        if (!settings.postProcessingEnabled) {
          renderPipelineRef.current?.dispose();
          renderPipelineRef.current = null;
        } else if (renderContextRef.current && sceneRef.current && cameraRef.current) {
          renderPipelineRef.current = new RenderPipeline(
            renderContextRef.current.renderer,
            sceneRef.current,
            cameraRef.current.camera,
            {
              bloomEnabled: settings.bloomEnabled,
              bloomStrength: settings.bloomStrength,
              bloomRadius: settings.bloomRadius,
              bloomThreshold: settings.bloomThreshold,
              aoEnabled: settings.ssaoEnabled,
              aoRadius: settings.ssaoRadius,
              aoIntensity: settings.ssaoIntensity,
              ssrEnabled: settings.ssrEnabled,
              ssrOpacity: settings.ssrOpacity,
              ssrMaxRoughness: settings.ssrMaxRoughness,
              ssgiEnabled: settings.ssgiEnabled,
              ssgiRadius: settings.ssgiRadius,
              ssgiIntensity: settings.ssgiIntensity,
              ssgiThickness: 1,
              antiAliasingMode: settings.antiAliasingMode,
              fxaaEnabled: settings.fxaaEnabled,
              taaEnabled: settings.taaEnabled,
              taaSharpeningEnabled: settings.taaSharpeningEnabled,
              taaSharpeningIntensity: settings.taaSharpeningIntensity,
              upscalingMode: settings.upscalingMode,
              renderScale: settings.renderScale,
              easuSharpness: settings.easuSharpness,
              vignetteEnabled: settings.vignetteEnabled,
              vignetteIntensity: settings.vignetteIntensity,
              exposure: settings.toneMappingExposure,
              saturation: settings.saturation,
              contrast: settings.contrast,
              volumetricFogEnabled: settings.volumetricFogEnabled,
              volumetricFogQuality: settings.volumetricFogQuality,
              volumetricFogDensity: settings.volumetricFogDensity,
              volumetricFogScattering: settings.volumetricFogScattering,
              fogOfWarEnabled: useGameSetupStore.getState().fogOfWar && !isSpectatorMode(),
              fogOfWarQuality: settings.fogOfWarQuality,
              fogOfWarEdgeBlur: settings.fogOfWarEdgeBlur,
              fogOfWarDesaturation: settings.fogOfWarDesaturation,
              fogOfWarExploredDarkness: settings.fogOfWarExploredDarkness,
              fogOfWarUnexploredDarkness: settings.fogOfWarUnexploredDarkness,
              fogOfWarCloudSpeed: settings.fogOfWarCloudSpeed,
              fogOfWarRimIntensity: settings.fogOfWarRimIntensity,
              fogOfWarHeightInfluence: settings.fogOfWarHeightInfluence,
            }
          );

          // Set fog of war map dimensions
          if (useGameSetupStore.getState().fogOfWar && !isSpectatorMode()) {
            renderPipelineRef.current.setFogOfWarMapDimensions(mapRef.current.width, mapRef.current.height);
          }

          // Initialize camera matrices for TAA
          if (settings.taaEnabled) {
            initCameraMatrices(cameraRef.current.camera);
          }
        }
      }

      // Update shadow settings
      // Note: renderer.shadowMap.enabled is ALWAYS true to keep shadow map depth texture valid
      // Shadow visibility is controlled via EnvironmentManager.setShadowsEnabled() which toggles
      // receiveShadow on meshes and skips shadow updates when disabled
      if (environmentRef.current) {
        if (settings.shadowsEnabled !== prevSettings.shadowsEnabled) {
          environmentRef.current.setShadowsEnabled(settings.shadowsEnabled);
        }
        if (settings.shadowQuality !== prevSettings.shadowQuality) {
          environmentRef.current.setShadowQuality(settings.shadowQuality);
        }
        if (settings.shadowDistance !== prevSettings.shadowDistance) {
          environmentRef.current.setShadowDistance(settings.shadowDistance);
        }

        // Update fog settings
        if (settings.fogEnabled !== prevSettings.fogEnabled) {
          environmentRef.current.setFogEnabled(settings.fogEnabled);
        }
        if (settings.fogDensity !== prevSettings.fogDensity) {
          environmentRef.current.setFogDensity(settings.fogDensity);
        }

        // Update particle settings
        if (settings.particlesEnabled !== prevSettings.particlesEnabled) {
          environmentRef.current.setParticlesEnabled(settings.particlesEnabled);
        }
        if (settings.particleDensity !== prevSettings.particleDensity) {
          environmentRef.current.setParticleDensity(settings.particleDensity);
        }

        // Update environment map
        if (settings.environmentMapEnabled !== prevSettings.environmentMapEnabled) {
          environmentRef.current.setEnvironmentMapEnabled(settings.environmentMapEnabled);
        }

        // Update shadow fill
        if (settings.shadowFill !== prevSettings.shadowFill) {
          environmentRef.current.setShadowFill(settings.shadowFill);
        }

        // Update emissive decorations
        if (settings.emissiveDecorationsEnabled !== prevSettings.emissiveDecorationsEnabled) {
          environmentRef.current.setEmissiveDecorationsEnabled(settings.emissiveDecorationsEnabled);
        }
        if (settings.emissiveIntensityMultiplier !== prevSettings.emissiveIntensityMultiplier) {
          environmentRef.current.setEmissiveIntensityMultiplier(settings.emissiveIntensityMultiplier);
        }

        // Update water settings
        if (settings.waterEnabled !== prevSettings.waterEnabled) {
          environmentRef.current.setWaterEnabled(settings.waterEnabled);
        }
        if (settings.waterQuality !== prevSettings.waterQuality) {
          environmentRef.current.setWaterQuality(settings.waterQuality);
        }
        if (settings.waterReflectionsEnabled !== prevSettings.waterReflectionsEnabled) {
          environmentRef.current.setWaterReflectionsEnabled(settings.waterReflectionsEnabled);
        }
      }

      // Update dynamic lights settings
      if (lightPoolRef.current) {
        if (settings.dynamicLightsEnabled !== prevSettings.dynamicLightsEnabled) {
          lightPoolRef.current.setEnabled(settings.dynamicLightsEnabled);
        }
        if (settings.maxDynamicLights !== prevSettings.maxDynamicLights) {
          lightPoolRef.current.setMaxLights(settings.maxDynamicLights);
        }
      }

      // Handle resolution settings changes
      const resolutionChanged =
        settings.resolutionMode !== prevSettings.resolutionMode ||
        settings.fixedResolution !== prevSettings.fixedResolution ||
        settings.resolutionScale !== prevSettings.resolutionScale ||
        settings.maxPixelRatio !== prevSettings.maxPixelRatio;

      if (resolutionChanged && renderContextRef.current && cameraRef.current) {
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const containerHeight = containerRef.current?.clientHeight ?? window.innerHeight;
        const devicePixelRatio = window.devicePixelRatio || 1;

        let targetWidth: number;
        let targetHeight: number;
        let effectivePixelRatio: number;

        switch (settings.resolutionMode) {
          case 'fixed': {
            const fixedResKey = settings.fixedResolution as keyof typeof FIXED_RESOLUTIONS;
            const fixedRes = FIXED_RESOLUTIONS[fixedResKey];
            effectivePixelRatio = 1.0;
            targetWidth = fixedRes.width;
            targetHeight = fixedRes.height;
            break;
          }
          case 'percentage':
            effectivePixelRatio = Math.min(devicePixelRatio, settings.maxPixelRatio);
            targetWidth = Math.floor(containerWidth * settings.resolutionScale);
            targetHeight = Math.floor(containerHeight * settings.resolutionScale);
            break;
          case 'native':
          default:
            effectivePixelRatio = Math.min(devicePixelRatio, settings.maxPixelRatio);
            targetWidth = containerWidth;
            targetHeight = containerHeight;
            break;
        }

        const renderer = renderContextRef.current.renderer;
        renderer.setPixelRatio(effectivePixelRatio);
        renderer.setSize(targetWidth, targetHeight, false);
        cameraRef.current.setScreenDimensions(targetWidth, targetHeight);

        if (renderPipelineRef.current) {
          renderPipelineRef.current.setSize(targetWidth * effectivePixelRatio, targetHeight * effectivePixelRatio);
        }
      }
    });

    return () => unsubscribe();
  }, [
    renderContextRef,
    renderPipelineRef,
    sceneRef,
    cameraRef,
    environmentRef,
    lightPoolRef,
    containerRef,
    map.width,
    map.height,
  ]);
}
