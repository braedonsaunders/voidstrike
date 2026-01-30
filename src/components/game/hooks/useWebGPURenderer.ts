/**
 * useWebGPURenderer Hook
 *
 * Handles WebGPU/WebGL renderer initialization, sub-renderer creation,
 * and game loop management. Responsible for all Three.js scene setup and teardown.
 */

import type { MutableRefObject, RefObject } from 'react';
import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

import { Game } from '@/engine/core/Game';
import { PerformanceMonitor } from '@/engine/core/PerformanceMonitor';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import type { EventBus } from '@/engine/core/EventBus';
import { RTSCamera } from '@/rendering/Camera';
import { TerrainGrid } from '@/rendering/Terrain';
import { EnvironmentManager } from '@/rendering/EnvironmentManager';
import { preloadWaterNormals } from '@/rendering/WaterMesh';
import { UnitRenderer } from '@/rendering/UnitRenderer';
import { BuildingRenderer } from '@/rendering/BuildingRenderer';
import { ResourceRenderer } from '@/rendering/ResourceRenderer';
import { BattleEffectsRenderer, AdvancedParticleSystem, VehicleEffectsSystem } from '@/rendering/effects';
import { RallyPointRenderer } from '@/rendering/RallyPointRenderer';
import { WatchTowerRenderer } from '@/rendering/WatchTowerRenderer';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { CommandQueueRenderer } from '@/rendering/CommandQueueRenderer';
import { LightPool } from '@/rendering/LightPool';

import {
  createWebGPURenderer,
  RenderContext,
  RenderPipeline,
  TSLFogOfWar,
  TSLGameOverlayManager,
} from '@/rendering/tsl';
import {
  initCameraMatrices,
  setCameraMatricesBeforeRender,
  updateCameraMatrices,
  setMaxVertexBuffers,
  onVelocitySetupFailed,
} from '@/rendering/tsl/InstancedVelocity';

import { useUIStore, FIXED_RESOLUTIONS } from '@/store/uiStore';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { useProjectionStore } from '@/store/projectionStore';
import { setCameraRef } from '@/store/cameraStore';
import { MapData } from '@/data/maps';
import { Resource } from '@/engine/components/Resource';
import { Transform } from '@/engine/components/Transform';
import AssetManager, { DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';
import { debugInitialization, debugPerformance, debugPostProcessing } from '@/utils/debugLogger';

// Pooled Vector3 objects for combat event handlers (avoids allocation per attack/death)
const _combatStartPos = new THREE.Vector3();
const _combatEndPos = new THREE.Vector3();
const _combatDirection = new THREE.Vector3();
const _deathPos = new THREE.Vector3();

export interface WebGPURendererRefs {
  renderContext: MutableRefObject<RenderContext | null>;
  scene: MutableRefObject<THREE.Scene | null>;
  camera: MutableRefObject<RTSCamera | null>;
  unitRenderer: MutableRefObject<UnitRenderer | null>;
  buildingRenderer: MutableRefObject<BuildingRenderer | null>;
  resourceRenderer: MutableRefObject<ResourceRenderer | null>;
  fogOfWar: MutableRefObject<TSLFogOfWar | null>;
  battleEffects: MutableRefObject<BattleEffectsRenderer | null>;
  advancedParticles: MutableRefObject<AdvancedParticleSystem | null>;
  vehicleEffects: MutableRefObject<VehicleEffectsSystem | null>;
  rallyPointRenderer: MutableRefObject<RallyPointRenderer | null>;
  watchTowerRenderer: MutableRefObject<WatchTowerRenderer | null>;
  placementPreview: MutableRefObject<BuildingPlacementPreview | null>;
  wallPlacementPreview: MutableRefObject<WallPlacementPreview | null>;
  environment: MutableRefObject<EnvironmentManager | null>;
  overlayManager: MutableRefObject<TSLGameOverlayManager | null>;
  commandQueueRenderer: MutableRefObject<CommandQueueRenderer | null>;
  lightPool: MutableRefObject<LightPool | null>;
  renderPipeline: MutableRefObject<RenderPipeline | null>;
}

export interface UseWebGPURendererProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  gameRef: MutableRefObject<Game | null>;
  /** World provider for entity queries - if provided, uses this instead of game.world */
  worldProviderRef?: MutableRefObject<IWorldProvider | null>;
  /** Event bus for subscribing to game events - if provided, uses this instead of game.eventBus */
  eventBusRef?: MutableRefObject<EventBus | null>;
  /** Function to get current game time - if provided, uses this instead of game.getGameTime() */
  getGameTime?: () => number;
  /** Function to check if game is finished - if provided, uses this instead of game.gameStateSystem */
  isGameFinished?: () => boolean;
  map: MapData;
  onProgress: (progress: number, status: string) => void;
  onWebGPUDetected: (isWebGPU: boolean) => void;
}

export interface UseWebGPURendererReturn {
  refs: WebGPURendererRefs;
  isInitialized: boolean;
  initializeRenderer: () => Promise<boolean>;
}

export function useWebGPURenderer({
  canvasRef,
  containerRef,
  gameRef,
  worldProviderRef,
  eventBusRef,
  getGameTime: getGameTimeProp,
  isGameFinished: isGameFinishedProp,
  map,
  onProgress,
  onWebGPUDetected,
}: UseWebGPURendererProps): UseWebGPURendererReturn {
  // Store map in a ref so initializeRenderer always gets the latest value
  // This fixes timing issues where CURRENT_MAP is updated after the hook is called
  const mapRef = useRef<MapData>(map);
  mapRef.current = map;

  // All renderer refs
  const renderContextRef = useRef<RenderContext | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<RTSCamera | null>(null);
  const unitRendererRef = useRef<UnitRenderer | null>(null);
  const buildingRendererRef = useRef<BuildingRenderer | null>(null);
  const resourceRendererRef = useRef<ResourceRenderer | null>(null);
  const fogOfWarRef = useRef<TSLFogOfWar | null>(null);
  const battleEffectsRef = useRef<BattleEffectsRenderer | null>(null);
  const advancedParticlesRef = useRef<AdvancedParticleSystem | null>(null);
  const vehicleEffectsRef = useRef<VehicleEffectsSystem | null>(null);
  const rallyPointRendererRef = useRef<RallyPointRenderer | null>(null);
  const watchTowerRendererRef = useRef<WatchTowerRenderer | null>(null);
  const placementPreviewRef = useRef<BuildingPlacementPreview | null>(null);
  const wallPlacementPreviewRef = useRef<WallPlacementPreview | null>(null);
  const environmentRef = useRef<EnvironmentManager | null>(null);
  const overlayManagerRef = useRef<TSLGameOverlayManager | null>(null);
  const commandQueueRendererRef = useRef<CommandQueueRenderer | null>(null);
  const lightPoolRef = useRef<LightPool | null>(null);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);

  // Event cleanup
  const eventUnsubscribersRef = useRef<(() => void)[]>([]);
  const isInitializedRef = useRef(false);

  // Track if final game time update has been done
  const finalGameTimeUpdatedRef = useRef(false);

  // Animation frame ID for cleanup
  const animationFrameIdRef = useRef<number | null>(null);

  const calculateDisplayResolution = useCallback(() => {
    const settings = useUIStore.getState().graphicsSettings;
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

    return { width: targetWidth, height: targetHeight, pixelRatio: effectivePixelRatio };
  }, [containerRef]);

  const handleResize = useCallback(() => {
    const { width, height, pixelRatio } = calculateDisplayResolution();

    if (renderContextRef.current && cameraRef.current) {
      const renderer = renderContextRef.current.renderer;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      cameraRef.current.setScreenDimensions(width, height);

      if (renderPipelineRef.current) {
        renderPipelineRef.current.setSize(width * pixelRatio, height * pixelRatio);
      }
    }
  }, [calculateDisplayResolution]);

  const initializeRenderer = useCallback(async (): Promise<boolean> => {
    if (!canvasRef.current || !containerRef.current) return false;
    if (isInitializedRef.current) return true;

    const game = gameRef.current;
    if (!game) return false;

    // Helper to get world provider (uses worldProviderRef if available, falls back to game.world)
    const getWorldProvider = (): IWorldProvider => worldProviderRef?.current ?? (game.world as unknown as IWorldProvider);
    // Helper to get event bus (uses eventBusRef if available, falls back to game.eventBus)
    const getEventBus = (): EventBus => eventBusRef?.current ?? game.eventBus;

    try {
      // Load saved graphics settings
      useUIStore.getState().loadSavedGraphicsSettings();
      const graphicsSettings = useUIStore.getState().graphicsSettings;
      const preferWebGPU = useUIStore.getState().preferWebGPU;

      // Create WebGPU renderer with automatic fallback
      const useHardwareAA = !graphicsSettings.postProcessingEnabled;
      const renderContext = await createWebGPURenderer({
        canvas: canvasRef.current,
        antialias: useHardwareAA,
        powerPreference: 'high-performance',
        forceWebGL: !preferWebGPU,
      });

      renderContextRef.current = renderContext;
      onWebGPUDetected(renderContext.isWebGPU);

      // Update UI store with renderer info
      useUIStore.getState().setRendererAPI(renderContext.isWebGPU ? 'WebGPU' : 'WebGL');
      useUIStore.getState().setGpuInfo(renderContext.gpuInfo);
      setMaxVertexBuffers(renderContext.deviceLimits.maxVertexBuffers);

      debugInitialization.log(
        `[useWebGPURenderer] Using ${renderContext.isWebGPU ? 'WebGPU' : 'WebGL'} backend`
      );

      const renderer = renderContext.renderer;
      const { width, height, pixelRatio } = calculateDisplayResolution();

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1.0;

      // Create scene
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x1a1a2e, 50, 150);
      sceneRef.current = scene;

      // Create camera
      const currentMap = mapRef.current;
      const mapWidth = currentMap.width;
      const mapHeight = currentMap.height;
      const camera = new RTSCamera(width / height, mapWidth, mapHeight);
      cameraRef.current = camera;
      setCameraRef(camera);
      camera.setScreenDimensions(width, height);

      // Preload water texture before creating environment
      await preloadWaterNormals();

      // Create environment
      const environment = new EnvironmentManager(scene, currentMap);
      environmentRef.current = environment;
      const terrain = environment.terrain;

      camera.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      // Position camera at player spawn
      const localPlayerSlot = useGameSetupStore.getState().getLocalPlayerSlot();
      const playerSpawn =
        currentMap.spawns?.find((s) => s.playerSlot === localPlayerSlot) ||
        currentMap.spawns?.[0] ||
        { x: mapWidth / 2, y: mapHeight / 2 };
      camera.setPosition(playerSpawn.x, playerSpawn.y);
      camera.setAngle(0);

      // Set up projection store
      useProjectionStore.getState().setWorldToScreen((worldX: number, worldZ: number, worldY?: number) => {
        return camera.worldToScreen(worldX, worldZ, worldY);
      });

      // Create terrain grid
      const grid = new TerrainGrid(mapWidth, mapHeight, 1);
      scene.add(grid.mesh);

      // Wire up selection system
      game.selectionSystem.setWorldToScreen((worldX: number, worldZ: number, worldY?: number) => {
        return camera.worldToScreen(worldX, worldZ, worldY);
      });
      game.selectionSystem.setTerrainHeightFunction((x: number, z: number) => {
        return terrain.getHeightAt(x, z);
      });

      // Set terrain data
      game.setTerrainGrid(currentMap.terrain);
      game.setDecorationCollisions(environment.getRockCollisions());

      onProgress(55, 'Generating navigation mesh');

      // Generate navmesh
      debugInitialization.log('[useWebGPURenderer] Generating walkable geometry...');
      const walkableGeometry = terrain.generateWalkableGeometry();

      game.pathfindingSystem.setTerrainHeightFunction((x: number, z: number) => {
        return terrain.getNavmeshHeightAt(x, z);
      });

      const navMeshSuccess = await game.initializeNavMesh(
        walkableGeometry.positions,
        walkableGeometry.indices
      );
      if (!navMeshSuccess) {
        debugInitialization.error('[useWebGPURenderer] NavMesh initialization failed!');
      }

      // Generate water navmesh for naval units (if map has water)
      debugInitialization.log('[useWebGPURenderer] Generating water geometry...');
      const waterGeometry = terrain.generateWaterGeometry();
      if (waterGeometry.positions.length > 0) {
        const waterNavMeshSuccess = await game.initializeWaterNavMesh(
          waterGeometry.positions,
          waterGeometry.indices
        );
        if (waterNavMeshSuccess) {
          debugInitialization.log('[useWebGPURenderer] Water navmesh initialized for naval units');
        }
      }

      const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;
      const localPlayerId = getLocalPlayerId();

      // Register velocity setup failure callback
      onVelocitySetupFailed(() => {
        const currentSettings = useUIStore.getState().graphicsSettings;
        if (currentSettings.antiAliasingMode === 'taa') {
          debugPostProcessing.warn('[useWebGPURenderer] Auto-switching from TAA to FXAA due to vertex buffer limit');
          useUIStore.getState().setAntiAliasingMode('fxaa');
        }
      });

      // Create unit renderer
      // In worker mode, worldProviderRef points to RenderStateWorldAdapter
      // visionSystem is null in worker mode - visibility comes from RenderState
      const worldProvider = getWorldProvider();
      debugInitialization.log(`[useWebGPURenderer] Creating UnitRenderer with worldProvider: ${worldProvider.constructor.name}`);
      unitRendererRef.current = new UnitRenderer(
        scene,
        worldProvider,
        worldProviderRef?.current ? undefined : (fogOfWarEnabled ? game.visionSystem : undefined),
        terrain
      );
      if (localPlayerId) {
        unitRendererRef.current.setPlayerId(localPlayerId);
      }

      // Enable GPU-driven rendering if available
      if (renderContext.supportsCompute && renderContext.isWebGPU) {
        unitRendererRef.current.enableGPUDrivenRendering();
        unitRendererRef.current.setRenderer(renderer as import('three/webgpu').WebGPURenderer);
        unitRendererRef.current.setCamera(camera.camera);
        debugInitialization.log('[useWebGPURenderer] GPU-driven unit rendering ENABLED');
      }

      // Expose debug interface
      if (typeof window !== 'undefined') {
        (window as any).VOIDSTRIKE = {
          gpu: {
            stats: () => unitRendererRef.current?.getGPURenderingStats(),
            forceCPU: (enable: boolean) => unitRendererRef.current?.forceCPUCulling(enable),
            isGPUActive: () => unitRendererRef.current?.isGPUCullingActive(),
          },
        };
      }

      // Create building renderer
      const buildingWorldProvider = getWorldProvider();
      debugInitialization.log(`[useWebGPURenderer] Creating BuildingRenderer with worldProvider: ${buildingWorldProvider.constructor.name}`);
      buildingRendererRef.current = new BuildingRenderer(
        scene,
        buildingWorldProvider,
        worldProviderRef?.current ? undefined : (fogOfWarEnabled ? game.visionSystem : undefined),
        terrain
      );
      if (localPlayerId) {
        buildingRendererRef.current.setPlayerId(localPlayerId);
      }

      // Create resource renderer
      resourceRendererRef.current = new ResourceRenderer(scene, getWorldProvider(), terrain);

      // Create fog of war
      // In worker mode, fog of war visibility comes from RenderState, not visionSystem
      if (fogOfWarEnabled && !isSpectatorMode() && !worldProviderRef?.current) {
        const fogOfWar = new TSLFogOfWar({ mapWidth, mapHeight });
        fogOfWar.setVisionSystem(game.visionSystem);
        fogOfWar.setPlayerId(localPlayerId);
        fogOfWarRef.current = fogOfWar;
      }

      // Create battle effects
      battleEffectsRef.current = new BattleEffectsRenderer(
        scene,
        getEventBus(),
        (x, z) => terrain.getHeightAt(x, z)
      );

      // Create advanced particle system
      advancedParticlesRef.current = new AdvancedParticleSystem(scene, 15000);
      advancedParticlesRef.current.setTerrainHeightFunction((x: number, z: number) => terrain.getHeightAt(x, z));
      battleEffectsRef.current.setParticleSystem(advancedParticlesRef.current);

      // Connect projectile position callback
      battleEffectsRef.current.setProjectilePositionCallback((entityId: number) => {
        const world = getWorldProvider();
        const entity = world.getEntity(entityId);
        if (!entity || entity.isDestroyed()) return null;
        const transform = entity.get<Transform>('Transform');
        if (!transform) return null;
        return { x: transform.x, y: transform.y, z: transform.z };
      });

      // Create vehicle effects
      vehicleEffectsRef.current = new VehicleEffectsSystem(game, advancedParticlesRef.current, AssetManager);
      vehicleEffectsRef.current.setTerrainHeightFunction((x: number, z: number) => terrain.getHeightAt(x, z));

      // Create rally point renderer
      rallyPointRendererRef.current = new RallyPointRenderer(
        scene,
        getEventBus(),
        getWorldProvider(),
        localPlayerId,
        (x: number, y: number) => terrain.getHeightAt(x, y)
      );

      // Create placement preview
      placementPreviewRef.current = new BuildingPlacementPreview(currentMap, (x: number, y: number) => terrain.getHeightAt(x, y));
      placementPreviewRef.current.setVespeneGeyserChecker((x: number, y: number) => {
        const world = getWorldProvider();
        const resources = world.getEntitiesWith('Resource', 'Transform');
        const searchRadius = 1.5;
        for (const entity of resources) {
          const resource = entity.get<Resource>('Resource');
          if (resource?.resourceType !== 'vespene') continue;
          if (resource.hasRefinery?.()) continue;
          const transform = entity.get<Transform>('Transform');
          if (!transform) continue;
          const dx = Math.abs(transform.x - x);
          const dy = Math.abs(transform.y - y);
          if (dx <= searchRadius && dy <= searchRadius) return true;
        }
        return false;
      });
      placementPreviewRef.current.setPlacementValidator((centerX: number, centerY: number, w: number, h: number) => {
        return game.isValidBuildingPlacement(centerX, centerY, w, h, undefined, true);
      });
      scene.add(placementPreviewRef.current.group);

      // Create wall placement preview
      wallPlacementPreviewRef.current = new WallPlacementPreview(currentMap, (x: number, y: number) => terrain.getHeightAt(x, y));
      wallPlacementPreviewRef.current.setPlacementValidator((x: number, y: number, w: number, h: number) => {
        return game.isValidBuildingPlacement(x, y, w, h, undefined, true);
      });
      scene.add(wallPlacementPreviewRef.current.group);

      // Create post-processing pipeline
      if (graphicsSettings.postProcessingEnabled) {
        renderPipelineRef.current = new RenderPipeline(renderer, scene, camera.camera, {
          bloomEnabled: graphicsSettings.bloomEnabled,
          bloomStrength: graphicsSettings.bloomStrength,
          bloomRadius: graphicsSettings.bloomRadius,
          bloomThreshold: graphicsSettings.bloomThreshold,
          aoEnabled: graphicsSettings.ssaoEnabled,
          aoRadius: graphicsSettings.ssaoRadius,
          aoIntensity: graphicsSettings.ssaoIntensity,
          ssrEnabled: graphicsSettings.ssrEnabled,
          ssrOpacity: graphicsSettings.ssrOpacity,
          ssrMaxRoughness: graphicsSettings.ssrMaxRoughness,
          ssgiEnabled: graphicsSettings.ssgiEnabled,
          ssgiRadius: graphicsSettings.ssgiRadius,
          ssgiIntensity: graphicsSettings.ssgiIntensity,
          ssgiThickness: 1,
          antiAliasingMode: graphicsSettings.antiAliasingMode,
          fxaaEnabled: graphicsSettings.fxaaEnabled,
          taaEnabled: graphicsSettings.taaEnabled,
          taaSharpeningEnabled: graphicsSettings.taaSharpeningEnabled,
          taaSharpeningIntensity: graphicsSettings.taaSharpeningIntensity,
          upscalingMode: graphicsSettings.upscalingMode,
          renderScale: graphicsSettings.renderScale,
          easuSharpness: graphicsSettings.easuSharpness,
          vignetteEnabled: graphicsSettings.vignetteEnabled,
          vignetteIntensity: graphicsSettings.vignetteIntensity,
          exposure: graphicsSettings.toneMappingExposure,
          saturation: graphicsSettings.saturation,
          contrast: graphicsSettings.contrast,
          volumetricFogEnabled: graphicsSettings.volumetricFogEnabled,
          volumetricFogQuality: graphicsSettings.volumetricFogQuality,
          volumetricFogDensity: graphicsSettings.volumetricFogDensity,
          volumetricFogScattering: graphicsSettings.volumetricFogScattering,
          fogOfWarEnabled: fogOfWarEnabled && !isSpectatorMode(),
          fogOfWarQuality: graphicsSettings.fogOfWarQuality,
          fogOfWarEdgeBlur: graphicsSettings.fogOfWarEdgeBlur,
          fogOfWarDesaturation: graphicsSettings.fogOfWarDesaturation,
          fogOfWarExploredDarkness: graphicsSettings.fogOfWarExploredDarkness,
          fogOfWarUnexploredDarkness: graphicsSettings.fogOfWarUnexploredDarkness,
          fogOfWarCloudSpeed: graphicsSettings.fogOfWarCloudSpeed,
          fogOfWarRimIntensity: graphicsSettings.fogOfWarRimIntensity,
          fogOfWarHeightInfluence: graphicsSettings.fogOfWarHeightInfluence,
        });

        renderPipelineRef.current.setSize(width * pixelRatio, height * pixelRatio);

        if (fogOfWarEnabled && !isSpectatorMode()) {
          renderPipelineRef.current.setFogOfWarMapDimensions(mapWidth, mapHeight);
        }

        if (graphicsSettings.taaEnabled || graphicsSettings.ssgiEnabled) {
          initCameraMatrices(camera.camera);
        }
      }

      // Configure shadows
      if (graphicsSettings.shadowsEnabled) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        environmentRef.current?.setShadowsEnabled(true);
        environmentRef.current?.setShadowQuality(graphicsSettings.shadowQuality);
        environmentRef.current?.setShadowDistance(graphicsSettings.shadowDistance);
      }

      // Configure environment settings
      environmentRef.current?.setFogEnabled(graphicsSettings.fogEnabled);
      environmentRef.current?.setFogDensity(graphicsSettings.fogDensity);
      environmentRef.current?.setParticlesEnabled(graphicsSettings.particlesEnabled);
      environmentRef.current?.setParticleDensity(graphicsSettings.particleDensity);
      environmentRef.current?.setEnvironmentMapEnabled(graphicsSettings.environmentMapEnabled);
      environmentRef.current?.setShadowFill(graphicsSettings.shadowFill);
      environmentRef.current?.setEmissiveDecorationsEnabled(graphicsSettings.emissiveDecorationsEnabled);
      environmentRef.current?.setEmissiveIntensityMultiplier(graphicsSettings.emissiveIntensityMultiplier);

      // Configure water settings
      environmentRef.current?.setWaterEnabled(graphicsSettings.waterEnabled);
      environmentRef.current?.setWaterQuality(graphicsSettings.waterQuality);
      environmentRef.current?.setWaterReflectionsEnabled(graphicsSettings.waterReflectionsEnabled);

      // Create light pool
      if (graphicsSettings.dynamicLightsEnabled) {
        lightPoolRef.current = new LightPool(scene, graphicsSettings.maxDynamicLights);
      }

      // Create overlay manager
      overlayManagerRef.current = new TSLGameOverlayManager(scene, currentMap, (x, y) => terrain.getHeightAt(x, y));
      overlayManagerRef.current.setWorld(getWorldProvider());

      // Create command queue renderer
      commandQueueRendererRef.current = new CommandQueueRenderer(
        scene,
        getEventBus(),
        getWorldProvider(),
        localPlayerId,
        (x, y) => terrain.getHeightAt(x, y)
      );

      // Subscribe to combat events
      const eventBus = getEventBus();
      eventUnsubscribersRef.current.push(
        eventBus.on(
          'combat:attack',
          (data: {
            attackerId?: string;
            attackerPos?: { x: number; y: number };
            targetPos?: { x: number; y: number };
            targetUnitType?: string;
            damageType?: string;
            attackerIsFlying?: boolean;
            targetIsFlying?: boolean;
          }) => {
            if (data.attackerPos && data.targetPos && advancedParticlesRef.current) {
              const attackerTerrainHeight = terrain.getHeightAt(data.attackerPos.x, data.attackerPos.y);
              const targetTerrainHeight = terrain.getHeightAt(data.targetPos.x, data.targetPos.y);

              const attackerAirborneHeight = data.attackerId
                ? AssetManager.getAirborneHeight(data.attackerId)
                : DEFAULT_AIRBORNE_HEIGHT;
              const targetAirborneHeight = data.targetUnitType
                ? AssetManager.getAirborneHeight(data.targetUnitType)
                : DEFAULT_AIRBORNE_HEIGHT;
              const attackerFlyingOffset = data.attackerIsFlying ? attackerAirborneHeight : 0;
              const targetFlyingOffset = data.targetIsFlying ? targetAirborneHeight : 0;

              const startHeight = attackerTerrainHeight + 0.5 + attackerFlyingOffset;
              const endHeight = targetTerrainHeight + 0.5 + targetFlyingOffset;

              _combatStartPos.set(data.attackerPos.x, startHeight, data.attackerPos.y);
              _combatEndPos.set(data.targetPos.x, endHeight, data.targetPos.y);
              _combatDirection.copy(_combatEndPos).sub(_combatStartPos).normalize();

              advancedParticlesRef.current.emitMuzzleFlash(_combatStartPos, _combatDirection);
              advancedParticlesRef.current.emitImpact(_combatEndPos, _combatDirection.negate());
            }
          }
        )
      );

      eventUnsubscribersRef.current.push(
        eventBus.on(
          'unit:died',
          (data: { position?: { x: number; y: number }; isFlying?: boolean; unitType?: string }) => {
            if (data.position && advancedParticlesRef.current) {
              const terrainHeight = terrain.getHeightAt(data.position.x, data.position.y);
              const airborneHeight = data.unitType
                ? AssetManager.getAirborneHeight(data.unitType)
                : DEFAULT_AIRBORNE_HEIGHT;
              const flyingOffset = data.isFlying ? airborneHeight : 0;
              const effectHeight = terrainHeight + 0.5 + flyingOffset;

              _deathPos.set(data.position.x, effectHeight, data.position.y);
              advancedParticlesRef.current.emitExplosion(_deathPos, 1.2);
            }
          }
        )
      );

      eventUnsubscribersRef.current.push(
        eventBus.on(
          'building:destroyed',
          (data: { entityId: number; playerId: string; buildingType: string; position: { x: number; y: number } }) => {
            if (advancedParticlesRef.current) {
              const terrainHeight = terrain.getHeightAt(data.position.x, data.position.y);
              const isLarge = ['headquarters', 'infantry_bay', 'forge', 'hangar'].includes(data.buildingType);
              _deathPos.set(data.position.x, terrainHeight + 1, data.position.y);
              advancedParticlesRef.current.emitExplosion(_deathPos, isLarge ? 2.5 : 1.5);
            }
          }
        )
      );

      // Create watch tower renderer
      // In worker mode, visionSystem is not available on main thread
      if (currentMap.watchTowers && currentMap.watchTowers.length > 0 && !worldProviderRef?.current) {
        game.visionSystem.setWatchTowers(currentMap.watchTowers);
        watchTowerRendererRef.current = new WatchTowerRenderer(scene, game.visionSystem);
      }

      isInitializedRef.current = true;

      // Start animation loop
      startAnimationLoop();

      return true;
    } catch (error) {
      debugInitialization.error('[useWebGPURenderer] Initialization failed:', error);
      return false;
    }
  }, [canvasRef, containerRef, gameRef, worldProviderRef, eventBusRef, map, onProgress, onWebGPUDetected, calculateDisplayResolution]);

  const startAnimationLoop = useCallback(() => {
    const game = gameRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const renderContext = renderContextRef.current;

    if (!game || !camera || !scene || !renderContext) return;

    // Helper to get world provider (uses worldProviderRef if available, falls back to game.world)
    const getWorldProvider = (): IWorldProvider => worldProviderRef?.current ?? (game.world as unknown as IWorldProvider);
    // Helper to get game time (uses prop if available, falls back to game.getGameTime())
    const getGameTimeValue = (): number => getGameTimeProp?.() ?? game.getGameTime();
    // Helper to check if game is finished (uses prop if available, falls back to game.gameStateSystem)
    const checkGameFinished = (): boolean => isGameFinishedProp?.() ?? game.gameStateSystem.isGameFinished();

    let lastTime = performance.now();
    let lastRenderTime = 0;
    let frameCount = 0;
    let lastFpsLog = performance.now();

    const animate = (currentTime: number) => {
      // Frame rate limiting
      const maxFPS = useUIStore.getState().graphicsSettings.maxFPS;
      if (maxFPS > 0) {
        const minFrameTime = 1000 / maxFPS;
        if (currentTime - lastRenderTime < minFrameTime) {
          animationFrameIdRef.current = requestAnimationFrame(animate);
          return;
        }
      }
      lastRenderTime = currentTime;

      const frameStart = performance.now();
      const deltaTime = currentTime - lastTime;
      const prevTime = lastTime;
      lastTime = currentTime;

      // FPS logging
      frameCount++;
      if (currentTime - lastFpsLog > 1000) {
        const actualFps = frameCount / ((currentTime - lastFpsLog) / 1000);
        if (actualFps < 30) {
          debugPerformance.warn(`[FPS] Actual: ${actualFps.toFixed(1)}`);
        }
        frameCount = 0;
        lastFpsLog = currentTime;
      }

      // Handle pending camera moves
      const pendingMove = useGameStore.getState().pendingCameraMove;
      if (pendingMove) {
        camera.setPosition(pendingMove.x, pendingMove.y);
        useGameStore.getState().clearPendingCameraMove();
      }

      // Update systems
      const updatesStart = performance.now();
      camera.update(deltaTime);

      // Update viewport bounds
      const viewportBounds = camera.getViewportBounds();
      game.selectionSystem.setViewportBounds(
        viewportBounds.minX,
        viewportBounds.maxX,
        viewportBounds.minZ,
        viewportBounds.maxZ
      );

      // Set camera reference for frustum culling
      const threeCamera = camera.camera;
      unitRendererRef.current?.setCamera(threeCamera);
      buildingRendererRef.current?.setCamera(threeCamera);
      resourceRendererRef.current?.setCamera(threeCamera);
      vehicleEffectsRef.current?.setCamera(threeCamera);

      threeCamera.updateMatrixWorld();

      // Update renderers
      const DETAILED_TIMING = useUIStore.getState().debugSettings.debugPerformance;
      const sceneChildCount = scene.children.length;
      let unitTime = 0,
        buildingTime = 0,
        resourceTime = 0,
        fogTime = 0;

      if (DETAILED_TIMING) {
        let t = performance.now();
        unitRendererRef.current?.update();
        unitTime = performance.now() - t;

        t = performance.now();
        buildingRendererRef.current?.update();
        buildingTime = performance.now() - t;

        t = performance.now();
        resourceRendererRef.current?.update();
        resourceTime = performance.now() - t;

        t = performance.now();
        fogOfWarRef.current?.update();
        fogTime = performance.now() - t;
      } else {
        unitRendererRef.current?.update();
        buildingRendererRef.current?.update();
        resourceRendererRef.current?.update();
        fogOfWarRef.current?.update();
      }

      // Update post-processing fog of war
      if (renderPipelineRef.current?.isFogOfWarEnabled() && fogOfWarRef.current) {
        const visionTexture = fogOfWarRef.current.getVisionTexture();
        renderPipelineRef.current.setFogOfWarVisionTexture(visionTexture);
        renderPipelineRef.current.updateFogOfWarTime(currentTime / 1000);
      }

      rallyPointRendererRef.current?.update();
      watchTowerRendererRef.current?.update(deltaTime);
      placementPreviewRef.current?.update(deltaTime / 1000);

      const gameTime = getGameTimeValue();
      environmentRef.current?.update(deltaTime / 1000, gameTime, camera.camera);
      environmentRef.current?.updateShadowCameraPosition(camera.target.x, camera.target.z);

      const entityCount = getWorldProvider().getEntityCount();
      environmentRef.current?.setHasMovingEntities(entityCount > 0);
      environmentRef.current?.updateShadows();

      battleEffectsRef.current?.update(deltaTime);
      advancedParticlesRef.current?.update(deltaTime / 1000, camera.camera);
      vehicleEffectsRef.current?.update(deltaTime / 1000);
      lightPoolRef.current?.update();
      overlayManagerRef.current?.update(deltaTime);
      commandQueueRendererRef.current?.update();

      const updatesElapsed = performance.now() - updatesStart;
      if (updatesElapsed > 10) {
        if (DETAILED_TIMING) {
          debugPerformance.warn(
            `[UPDATES] Total: ${updatesElapsed.toFixed(1)}ms | ` +
              `Unit: ${unitTime.toFixed(1)}ms | Building: ${buildingTime.toFixed(1)}ms | ` +
              `Resource: ${resourceTime.toFixed(1)}ms | Fog: ${fogTime.toFixed(1)}ms | ` +
              `SceneObjects: ${sceneChildCount}`
          );
        } else {
          debugPerformance.warn(`[UPDATES] Total update time: ${updatesElapsed.toFixed(1)}ms`);
        }
      }

      if (DETAILED_TIMING && sceneChildCount > 1500) {
        debugPerformance.warn(`[LEAK?] Scene has ${sceneChildCount} children - check for object leaks!`);
      }

      // Update overlay manager with selected entities
      const selectedUnits = useGameStore.getState().selectedUnits;
      overlayManagerRef.current?.setSelectedEntities(selectedUnits);

      // Throttle zustand store updates
      if (deltaTime > 0) {
        const isFinished = checkGameFinished();
        if (Math.floor(currentTime / 1000) !== Math.floor(prevTime / 1000)) {
          if (!isFinished) {
            useGameStore.getState().setGameTime(gameTime);
          }
        }
        if (isFinished && !finalGameTimeUpdatedRef.current) {
          finalGameTimeUpdatedRef.current = true;
          useGameStore.getState().setGameTime(gameTime);
        }
        if (Math.floor(currentTime / 100) !== Math.floor(prevTime / 100)) {
          const pos = camera.getPosition();
          useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());
        }
      }

      // Render
      const renderStart = performance.now();

      if (renderPipelineRef.current?.isTAAEnabled() || renderPipelineRef.current?.isSSGIEnabled()) {
        setCameraMatricesBeforeRender(camera.camera);
      }

      if (renderPipelineRef.current) {
        renderPipelineRef.current.render();
      } else {
        renderContext.renderer.render(scene, camera.camera);
      }

      const renderElapsed = performance.now() - renderStart;

      if (renderPipelineRef.current?.isTAAEnabled()) {
        updateCameraMatrices(camera.camera);
      }

      const frameElapsed = performance.now() - frameStart;
      if (DETAILED_TIMING && frameElapsed > 16) {
        debugPerformance.warn(`[FRAME] Total: ${frameElapsed.toFixed(1)}ms, Render: ${renderElapsed.toFixed(1)}ms`);
      }

      // Update performance metrics
      if (Math.floor(currentTime / 1000) !== Math.floor(prevTime / 1000)) {
        const rendererInfo = renderContext.renderer.info;
        const cpuTime = updatesElapsed;
        const gpuTime = renderElapsed;

        let renderWidth = 0,
          renderHeight = 0,
          displayWidth = 0,
          displayHeight = 0;
        if (renderPipelineRef.current) {
          const renderRes = renderPipelineRef.current.getRenderResolution();
          const displayRes = renderPipelineRef.current.getDisplayResolution();
          renderWidth = renderRes.width;
          renderHeight = renderRes.height;
          displayWidth = displayRes.width;
          displayHeight = displayRes.height;
        } else {
          const size = new THREE.Vector2();
          renderContext.renderer.getSize(size);
          const pr = window.devicePixelRatio || 1;
          renderWidth = displayWidth = Math.floor(size.x * pr);
          renderHeight = displayHeight = Math.floor(size.y * pr);
        }

        const gpuStats = unitRendererRef.current?.getGPURenderingStats();

        useUIStore.getState().updatePerformanceMetrics({
          cpuTime,
          gpuTime,
          frameTime: frameElapsed,
          triangles: rendererInfo.render.triangles,
          drawCalls: rendererInfo.render.calls,
          renderWidth,
          renderHeight,
          displayWidth,
          displayHeight,
          gpuCullingActive: gpuStats?.isUsingGPUCulling ?? false,
          gpuIndirectActive: gpuStats?.indirectReady ?? false,
          gpuManagedUnits: gpuStats?.managedEntities ?? 0,
        });

        PerformanceMonitor.updateRenderMetrics(
          rendererInfo.render.calls,
          rendererInfo.render.triangles,
          1000 / frameElapsed
        );

        rendererInfo.reset();
      }

      animationFrameIdRef.current = requestAnimationFrame(animate);
    };

    animationFrameIdRef.current = requestAnimationFrame(animate);
  }, [gameRef, worldProviderRef, getGameTimeProp, isGameFinishedProp]);

  // Handle resize
  useEffect(() => {
    if (!isInitializedRef.current) return;

    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [handleResize, containerRef]);

  // Cleanup
  useEffect(() => {
    return () => {
      // Cancel animation frame
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }

      // Unsubscribe from events
      for (const unsubscribe of eventUnsubscribersRef.current) {
        unsubscribe();
      }
      eventUnsubscribersRef.current = [];

      // Clear projection store
      useProjectionStore.getState().setWorldToScreen(null);

      // Dispose all renderers
      renderContextRef.current?.renderer.dispose();
      environmentRef.current?.dispose();
      fogOfWarRef.current?.dispose();
      battleEffectsRef.current?.dispose();
      advancedParticlesRef.current?.dispose();
      vehicleEffectsRef.current?.dispose();
      rallyPointRendererRef.current?.dispose();
      watchTowerRendererRef.current?.dispose();
      cameraRef.current?.dispose();
      setCameraRef(null);
      unitRendererRef.current?.dispose();
      buildingRendererRef.current?.dispose();
      resourceRendererRef.current?.dispose();
      renderPipelineRef.current?.dispose();
      overlayManagerRef.current?.dispose();
      commandQueueRendererRef.current?.dispose();
      lightPoolRef.current?.dispose();

      isInitializedRef.current = false;
    };
  }, []);

  return {
    refs: {
      renderContext: renderContextRef,
      scene: sceneRef,
      camera: cameraRef,
      unitRenderer: unitRendererRef,
      buildingRenderer: buildingRendererRef,
      resourceRenderer: resourceRendererRef,
      fogOfWar: fogOfWarRef,
      battleEffects: battleEffectsRef,
      advancedParticles: advancedParticlesRef,
      vehicleEffects: vehicleEffectsRef,
      rallyPointRenderer: rallyPointRendererRef,
      watchTowerRenderer: watchTowerRendererRef,
      placementPreview: placementPreviewRef,
      wallPlacementPreview: wallPlacementPreviewRef,
      environment: environmentRef,
      overlayManager: overlayManagerRef,
      commandQueueRenderer: commandQueueRendererRef,
      lightPool: lightPoolRef,
      renderPipeline: renderPipelineRef,
    },
    isInitialized: isInitializedRef.current,
    initializeRenderer,
  };
}
