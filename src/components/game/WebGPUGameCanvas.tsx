'use client';

/**
 * WebGPU Game Canvas
 *
 * This component uses the WebGPU renderer with automatic WebGL fallback.
 * All shaders are written in TSL (Three.js Shading Language) for cross-backend
 * compatibility.
 *
 * Architecture:
 * ┌────────────────────────────────────────┐
 * │         Phaser 4 Overlay Canvas        │  <- Top layer (transparent)
 * │  (tactical view, alerts, screen FX)    │
 * ├────────────────────────────────────────┤
 * │       Three.js WebGPU Canvas           │  <- Bottom layer
 * │  (terrain, units, buildings, 3D FX)    │
 * └────────────────────────────────────────┘
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import * as Phaser from 'phaser';

import { Game } from '@/engine/core/Game';
import { PerformanceMonitor } from '@/engine/core/PerformanceMonitor';
import { RTSCamera } from '@/rendering/Camera';
import { TerrainGrid } from '@/rendering/Terrain';
import { EnvironmentManager } from '@/rendering/EnvironmentManager';
import { UnitRenderer } from '@/rendering/UnitRenderer';
import { BuildingRenderer } from '@/rendering/BuildingRenderer';
import { ResourceRenderer } from '@/rendering/ResourceRenderer';
import { BattleEffectsRenderer, AdvancedParticleSystem, ParticleType, VehicleEffectsSystem } from '@/rendering/effects';
import { RallyPointRenderer } from '@/rendering/RallyPointRenderer';
import { WatchTowerRenderer } from '@/rendering/WatchTowerRenderer';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { CommandQueueRenderer } from '@/rendering/CommandQueueRenderer';
import { LightPool } from '@/rendering/LightPool';

// TSL Components (WebGPU-compatible)
import {
  createWebGPURenderer,
  RenderContext,
  SelectionSystem,
  GPUParticleSystem,
  RenderPipeline,
  EffectEmitter,
  TSLFogOfWar,
  TSLGameOverlayManager,
} from '@/rendering/tsl';
import { initCameraMatrices, setCameraMatricesBeforeRender, updateCameraMatrices, setMaxVertexBuffers } from '@/rendering/tsl/InstancedVelocity';

import { useGameStore } from '@/store/gameStore';

// PERF: Pooled Vector3 objects for combat event handlers (avoids allocation per attack/death)
const _combatStartPos = new THREE.Vector3();
const _combatEndPos = new THREE.Vector3();
const _combatDirection = new THREE.Vector3();
const _deathPos = new THREE.Vector3();

import { useGameSetupStore, getLocalPlayerId, isSpectatorMode, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { useMultiplayerStore, isMultiplayerMode } from '@/store/multiplayerStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { GraphicsOptionsPanel } from './GraphicsOptionsPanel';
import { DebugMenuPanel } from './DebugMenuPanel';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { useUIStore, FIXED_RESOLUTIONS, GameOverlayType } from '@/store/uiStore';
import { debugInitialization, debugPerformance, debugNetworking } from '@/utils/debugLogger';
import { DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { Resource } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Building } from '@/engine/components/Building';
import AssetManager, { DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';
import { OverlayScene } from '@/phaser/scenes/OverlayScene';
import { useProjectionStore } from '@/store/projectionStore';
import { setCameraRef } from '@/store/cameraStore';

// Map reference
let CURRENT_MAP: MapData = DEFAULT_MAP;

export function WebGPUGameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas refs
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Renderer context (WebGPU or WebGL fallback)
  const renderContextRef = useRef<RenderContext | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<RTSCamera | null>(null);

  // Renderers
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

  // Strategic overlays and command queue
  const overlayManagerRef = useRef<TSLGameOverlayManager | null>(null);
  const commandQueueRendererRef = useRef<CommandQueueRenderer | null>(null);

  // Dynamic lighting
  const lightPoolRef = useRef<LightPool | null>(null);

  // TSL Visual Systems (WebGPU-compatible)
  const selectionSystemRef = useRef<SelectionSystem | null>(null);
  const effectEmitterRef = useRef<EffectEmitter | null>(null);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);

  // Phaser refs
  const phaserContainerRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const overlaySceneRef = useRef<OverlayScene | null>(null);

  // Phaser loop worker - ensures overlay updates even when tab is in background
  const phaserLoopWorkerRef = useRef<Worker | null>(null);
  const lastPhaserUpdateTimeRef = useRef<number>(0);

  // Game engine ref
  const gameRef = useRef<Game | null>(null);

  // Event listener cleanup
  const eventUnsubscribersRef = useRef<(() => void)[]>([]);

  // Track if final game time update has been done (for victory overlay sync)
  const finalGameTimeUpdatedRef = useRef(false);

  // UI state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing');
  const [isWebGPU, setIsWebGPU] = useState(false);
  const [fadeInOpacity, setFadeInOpacity] = useState(1); // Starts black, fades to transparent

  // Callback for when loading screen completes (after fade to black)
  // Game world fades in while countdown plays on top
  const handleLoadingComplete = useCallback(() => {
    setIsLoading(false);

    // Mark game as ready (HUD will now show)
    useGameStore.getState().setGameReady(true);

    // Trigger countdown immediately - it plays while game fades in
    setTimeout(() => {
      if (gameRef.current?.eventBus) {
        gameRef.current.eventBus.emit('game:countdown');
      }
    }, 50);

    // Smooth fade in from black - animate opacity from 1 to 0
    const startTime = Date.now();
    const duration = 1000; // 1 second fade in (countdown runs during this)

    const animateFadeIn = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out for smooth reveal
      const eased = 1 - Math.pow(1 - progress, 2);
      setFadeInOpacity(1 - eased);

      if (progress < 1) {
        requestAnimationFrame(animateFadeIn);
      }
    };

    requestAnimationFrame(animateFadeIn);
  }, []);

  // Control group tracking
  const lastControlGroupTap = useRef<{ group: number; time: number } | null>(null);
  const subgroupIndexRef = useRef(0);

  // Double-click detection
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const DOUBLE_CLICK_TIME = 400;
  const DOUBLE_CLICK_DIST = 10;

  const { isBuilding, buildingType, buildingPlacementQueue, isSettingRallyPoint, isRepairMode, isLandingMode, landingBuildingId, abilityTargetMode, isWallPlacementMode, commandTargetMode } = useGameStore();

  // Initialize both Three.js (WebGPU) and Phaser
  useEffect(() => {
    if (!containerRef.current || !threeCanvasRef.current || !phaserContainerRef.current) return;

    const initializeGame = async () => {
      try {
        // Check for custom map first (from editor preview), then fall back to selected map
        const customMap = useGameSetupStore.getState().customMapData;
        if (customMap) {
          CURRENT_MAP = customMap;
          debugInitialization.log(`[WebGPUGameCanvas] Loading custom/preview map: ${CURRENT_MAP.name}`);
        } else {
          const selectedMapId = useGameSetupStore.getState().selectedMapId;
          CURRENT_MAP = getMapById(selectedMapId) || DEFAULT_MAP;
          debugInitialization.log(`[WebGPUGameCanvas] Loading map: ${CURRENT_MAP.name}`);
        }

        setLoadingStatus('Loading 3D models');
        setLoadingProgress(10);

        // Use preloading system - if assets were preloaded in lobby, this returns immediately
        // Otherwise starts loading now. Either way, waits for completion.
        const preloadStarted = AssetManager.isPreloadingStarted();
        if (preloadStarted) {
          setLoadingStatus('Finishing 3D model loading');
          debugInitialization.log('[WebGPUGameCanvas] Waiting for lobby preloading to complete...');
        }
        await AssetManager.waitForPreloading();
        if (preloadStarted) {
          debugInitialization.log('[WebGPUGameCanvas] Lobby preloading complete, continuing initialization');
        }
        setLoadingProgress(50);

        setLoadingStatus('Initializing WebGPU renderer');
        setLoadingProgress(60);

        // Initialize Three.js with WebGPU
        await initializeThreeJS();

        setLoadingStatus('Initializing overlay system');
        setLoadingProgress(80);

        // Initialize Phaser overlay
        initializePhaserOverlay();

        setLoadingProgress(100);
        setLoadingStatus('Ready');
        // LoadingScreen will handle the fade-to-black and countdown sequence
        // then call onComplete to hide the loading screen
      } catch (error) {
        debugInitialization.error('[WebGPUGameCanvas] Initialization failed:', error);
        setLoadingStatus('Error - falling back to WebGL');
      }
    };

    const initializeThreeJS = async () => {
      if (!threeCanvasRef.current) return;

      // Load saved graphics settings from localStorage
      useUIStore.getState().loadSavedGraphicsSettings();

      const graphicsSettings = useUIStore.getState().graphicsSettings;
      const preferWebGPU = useUIStore.getState().preferWebGPU;

      // Create WebGPU renderer with automatic fallback
      // IMPORTANT: Disable hardware MSAA when post-processing is enabled.
      // GTAO/SSAO doesn't work with multisampled depth textures in WebGPU/WGSL.
      // We use FXAA in the post-processing pipeline for anti-aliasing instead.
      const useHardwareAA = !graphicsSettings.postProcessingEnabled;
      const renderContext = await createWebGPURenderer({
        canvas: threeCanvasRef.current,
        antialias: useHardwareAA,
        powerPreference: 'high-performance',
        forceWebGL: !preferWebGPU, // Use user preference from main menu toggle
      });

      renderContextRef.current = renderContext;
      setIsWebGPU(renderContext.isWebGPU);

      // Set renderer API in UI store for graphics options display
      useUIStore.getState().setRendererAPI(renderContext.isWebGPU ? 'WebGPU' : 'WebGL');

      // Set the max vertex buffers from the device limits for velocity tracking
      setMaxVertexBuffers(renderContext.deviceLimits.maxVertexBuffers);

      debugInitialization.log(`[WebGPUGameCanvas] Using ${renderContext.isWebGPU ? 'WebGPU' : 'WebGL'} backend`);
      if (renderContext.supportsCompute) {
        debugInitialization.log('[WebGPUGameCanvas] GPU Compute shaders available');
      }

      const renderer = renderContext.renderer;

      // Calculate initial display resolution based on settings
      // Use container dimensions for accurate sizing with DevTools docked
      const initSettings = graphicsSettings;
      const initContainerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const initContainerHeight = containerRef.current?.clientHeight ?? window.innerHeight;
      const initDevicePixelRatio = window.devicePixelRatio || 1;

      let initTargetWidth: number;
      let initTargetHeight: number;
      let initEffectivePixelRatio: number;

      switch (initSettings.resolutionMode) {
        case 'fixed': {
          // Fixed resolution = exact device pixel count, so pixelRatio = 1
          const fixedResKey = initSettings.fixedResolution as keyof typeof FIXED_RESOLUTIONS;
          const fixedRes = FIXED_RESOLUTIONS[fixedResKey];
          initEffectivePixelRatio = 1.0;
          initTargetWidth = fixedRes.width;
          initTargetHeight = fixedRes.height;
          break;
        }
        case 'percentage':
          initEffectivePixelRatio = Math.min(initDevicePixelRatio, initSettings.maxPixelRatio);
          initTargetWidth = Math.floor(initContainerWidth * initSettings.resolutionScale);
          initTargetHeight = Math.floor(initContainerHeight * initSettings.resolutionScale);
          break;
        case 'native':
        default:
          initEffectivePixelRatio = Math.min(initDevicePixelRatio, initSettings.maxPixelRatio);
          initTargetWidth = initContainerWidth;
          initTargetHeight = initContainerHeight;
          break;
      }

      renderer.setPixelRatio(initEffectivePixelRatio);
      renderer.setSize(initTargetWidth, initTargetHeight, false); // false = don't update CSS, canvas stays fullscreen

      // IMPORTANT: Disable renderer tone mapping - PostProcessing handles all tone mapping
      // via ACES Filmic in the color grading pass. This prevents double-application of
      // exposure and tone mapping which causes washed out colors.
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1.0; // Neutral, not used when NoToneMapping

      // Create scene
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x1a1a2e, 50, 150);
      sceneRef.current = scene;

      // Create camera with calculated aspect ratio
      const mapWidth = CURRENT_MAP.width;
      const mapHeight = CURRENT_MAP.height;
      const camera = new RTSCamera(
        initTargetWidth / initTargetHeight,
        mapWidth,
        mapHeight
      );

      cameraRef.current = camera;
      setCameraRef(camera);

      // Sync camera screen dimensions immediately for accurate screenToWorld conversion
      camera.setScreenDimensions(initTargetWidth, initTargetHeight);

      // Create environment
      const environment = new EnvironmentManager(scene, CURRENT_MAP);
      environmentRef.current = environment;
      const terrain = environment.terrain;

      camera.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      // Position camera at player's spawn AFTER terrain is configured
      // This ensures terrain height is factored into the initial camera position
      const localPlayerSlot = useGameSetupStore.getState().getLocalPlayerSlot();
      const playerSpawn = CURRENT_MAP.spawns?.find(s => s.playerSlot === localPlayerSlot)
        || CURRENT_MAP.spawns?.[0]
        || { x: CURRENT_MAP.width / 2, y: CURRENT_MAP.height / 2 }; // Fallback to map center
      camera.setPosition(playerSpawn.x, playerSpawn.y);
      camera.setAngle(0); // Always look north

      // Set up projection store
      useProjectionStore.getState().setWorldToScreen((worldX: number, worldZ: number, worldY?: number) => {
        return camera.worldToScreen(worldX, worldZ, worldY);
      });

      // Create terrain grid
      const grid = new TerrainGrid(mapWidth, mapHeight, 1);
      scene.add(grid.mesh);

      // Initialize game engine
      const localPlayerId = getLocalPlayerId();
      const isMultiplayer = isMultiplayerMode();
      const game = Game.getInstance({
        mapWidth,
        mapHeight,
        tickRate: 20,
        isMultiplayer,
        playerId: localPlayerId ?? 'spectator',
        // Disable AI in multiplayer and battle simulator
        aiEnabled: !isBattleSimulatorMode() && !isMultiplayer,
      });
      gameRef.current = game;
      finalGameTimeUpdatedRef.current = false; // Reset for new game

      // Wire up screen-space selection for accurate selection of flying units
      game.selectionSystem.setWorldToScreen((worldX: number, worldZ: number, worldY?: number) => {
        return camera.worldToScreen(worldX, worldZ, worldY);
      });

      // Wire up terrain height lookup for accurate screen projection on elevated terrain
      game.selectionSystem.setTerrainHeightFunction((x: number, z: number) => {
        return terrain.getHeightAt(x, z);
      });

      // Set terrain data
      game.setTerrainGrid(CURRENT_MAP.terrain);
      game.setDecorationCollisions(environment.getRockCollisions());

      // Set up multiplayer command synchronization
      if (isMultiplayer) {
        const multiplayerStore = useMultiplayerStore.getState();

        // Commands to sync over network
        const commandTypes = [
          'command:move',
          'command:attack',
          'command:patrol',
          'command:stop',
          'command:holdPosition',
          'command:build',
          'command:train',
          'command:research',
          'command:ability',
          'command:gather',
          'command:repair',
          'command:heal',
          'command:transform',
          'command:cloak',
          'command:load',
          'command:unload',
          'command:loadBunker',
          'command:unloadBunker',
          'command:liftOff',
          'command:land',
          'command:demolish',
        ];

        // Listen for local commands and send to peer
        for (const cmdType of commandTypes) {
          const unsubscribe = game.eventBus.on(cmdType, (data: unknown) => {
            // Only send commands from the local player
            const cmd = data as { playerId?: string };
            if (cmd.playerId === localPlayerId) {
              multiplayerStore.sendMessage({
                type: 'command',
                commandType: cmdType,
                data,
                tick: game.getCurrentTick(),
              });
            }
          });
          eventUnsubscribersRef.current.push(unsubscribe);
        }

        // Note: Receive handler is now in Game.ts setupMultiplayerMessageHandler()
        // which handles both message formats (payload and commandType/data)

        debugNetworking.log('[Multiplayer] Command sync enabled');
      }

      // Initialize navmesh for pathfinding (must complete before spawning entities)
      setLoadingStatus('Generating navigation mesh');
      setLoadingProgress(55);
      debugInitialization.log('[WebGPUGameCanvas] Generating walkable geometry...');
      const walkableGeometry = terrain.generateWalkableGeometry();
      debugInitialization.log('[WebGPUGameCanvas] Walkable geometry generated:', {
        positions: walkableGeometry.positions.length,
        indices: walkableGeometry.indices.length,
      });

      // Set terrain height function BEFORE navmesh init - critical for crowd agent placement
      // The terrain's heightMap is used to generate navmesh geometry, so the height provider
      // must return the same values. Using raw elevation * 0.04 (from game.getTerrainHeightAt)
      // can cause mismatch due to heightMap smoothing, placing agents off the navmesh surface.
      game.pathfindingSystem.setTerrainHeightFunction((x: number, z: number) => {
        return terrain.getHeightAt(x, z);
      });

      debugInitialization.log('[WebGPUGameCanvas] Initializing navmesh...');
      const navMeshSuccess = await game.initializeNavMesh(walkableGeometry.positions, walkableGeometry.indices);
      debugInitialization.log('[WebGPUGameCanvas] NavMesh result:', navMeshSuccess);
      if (!navMeshSuccess) {
        debugInitialization.error('[WebGPUGameCanvas] NavMesh initialization failed!');
      }

      const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;

      // Create renderers
      unitRendererRef.current = new UnitRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );
      if (fogOfWarEnabled && localPlayerId) {
        unitRendererRef.current.setPlayerId(localPlayerId);
      }

      // Enable GPU-driven rendering if WebGPU compute is available
      if (renderContext.supportsCompute && renderContext.isWebGPU) {
        unitRendererRef.current.enableGPUDrivenRendering();
        unitRendererRef.current.setRenderer(renderer as import('three/webgpu').WebGPURenderer);
        unitRendererRef.current.setCamera(camera.camera);
        debugInitialization.log('[WebGPUGameCanvas] GPU-driven unit rendering enabled');
      }

      buildingRendererRef.current = new BuildingRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );
      if (fogOfWarEnabled && localPlayerId) {
        buildingRendererRef.current.setPlayerId(localPlayerId);
      }

      resourceRendererRef.current = new ResourceRenderer(scene, game.world, terrain);

      // TSL FogOfWar - WebGPU compatible
      if (fogOfWarEnabled && !isSpectatorMode()) {
        const fogOfWar = new TSLFogOfWar({ mapWidth, mapHeight });
        fogOfWar.setVisionSystem(game.visionSystem);
        fogOfWar.setPlayerId(localPlayerId);
        scene.add(fogOfWar.mesh);
        fogOfWarRef.current = fogOfWar;
      }

      // Battle effects (projectile trails, explosions, decals)
      battleEffectsRef.current = new BattleEffectsRenderer(scene, game.eventBus, (x, z) => terrain.getHeightAt(x, z));

      // Advanced GPU particle system for smoke, fire, debris
      advancedParticlesRef.current = new AdvancedParticleSystem(scene, 15000);
      advancedParticlesRef.current.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      // Connect particle system to battle effects for volumetric explosions
      battleEffectsRef.current.setParticleSystem(advancedParticlesRef.current);

      // Vehicle effects system for continuous engine trails, exhaust, dust
      vehicleEffectsRef.current = new VehicleEffectsSystem(game, advancedParticlesRef.current, AssetManager);
      vehicleEffectsRef.current.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      rallyPointRendererRef.current = new RallyPointRenderer(
        scene,
        game.eventBus,
        game.world,
        localPlayerId,
        (x, y) => terrain.getHeightAt(x, y)
      );

      placementPreviewRef.current = new BuildingPlacementPreview(
        CURRENT_MAP,
        (x, y) => terrain.getHeightAt(x, y)
      );
      placementPreviewRef.current.setVespeneGeyserChecker((x, y) => {
        const resources = game.world.getEntitiesWith('Resource', 'Transform');
        const searchRadius = 1.5;
        for (const entity of resources) {
          const resource = entity.get<Resource>('Resource');
          if (resource?.resourceType !== 'vespene') continue;
          if (resource.hasRefinery()) continue;
          const transform = entity.get<Transform>('Transform');
          if (!transform) continue;
          const dx = Math.abs(transform.x - x);
          const dy = Math.abs(transform.y - y);
          if (dx <= searchRadius && dy <= searchRadius) return true;
        }
        return false;
      });
      // Connect placement preview to game's validation for accurate preview
      // Skip unit check - units will be pushed away when building is placed
      placementPreviewRef.current.setPlacementValidator((centerX, centerY, width, height) => {
        return game.isValidBuildingPlacement(centerX, centerY, width, height, undefined, true);
      });
      scene.add(placementPreviewRef.current.group);

      // Wall placement preview for click-and-drag wall lines
      wallPlacementPreviewRef.current = new WallPlacementPreview(
        CURRENT_MAP,
        (x, y) => terrain.getHeightAt(x, y)
      );
      // Skip unit check - units will be pushed away when building is placed
      wallPlacementPreviewRef.current.setPlacementValidator((x, y, w, h) => {
        return game.isValidBuildingPlacement(x, y, w, h, undefined, true);
      });
      scene.add(wallPlacementPreviewRef.current.group);

      // Initialize TSL Visual Systems (WebGPU-compatible)
      selectionSystemRef.current = new SelectionSystem(scene);

      // GPU Particle Effects
      effectEmitterRef.current = new EffectEmitter(scene, renderer as any, 10000);

      // Post-processing pipeline (TSL-based)
      // Note: graphicsSettings already declared at top of function
      if (graphicsSettings.postProcessingEnabled) {
        renderPipelineRef.current = new RenderPipeline(
          renderer,
          scene,
          camera.camera,
          {
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
          }
        );

        // Set the correct display size (renderer.getSize returns CSS pixels, we need device pixels)
        renderPipelineRef.current.setSize(
          initTargetWidth * initEffectivePixelRatio,
          initTargetHeight * initEffectivePixelRatio
        );

        // Initialize camera matrices for TAA/SSGI velocity calculation
        if (graphicsSettings.taaEnabled || graphicsSettings.ssgiEnabled) {
          initCameraMatrices(camera.camera);
        }
      }

      // Configure shadows based on settings
      if (graphicsSettings.shadowsEnabled) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        environmentRef.current?.setShadowsEnabled(true);
        environmentRef.current?.setShadowQuality(graphicsSettings.shadowQuality);
        environmentRef.current?.setShadowDistance(graphicsSettings.shadowDistance);
      }

      // Configure fog
      environmentRef.current?.setFogEnabled(graphicsSettings.fogEnabled);
      environmentRef.current?.setFogDensity(graphicsSettings.fogDensity);

      // Configure particles
      environmentRef.current?.setParticlesEnabled(graphicsSettings.particlesEnabled);
      environmentRef.current?.setParticleDensity(graphicsSettings.particleDensity);

      // Configure environment map
      environmentRef.current?.setEnvironmentMapEnabled(graphicsSettings.environmentMapEnabled);

      // Configure shadow fill (ground bounce lighting)
      environmentRef.current?.setShadowFill(graphicsSettings.shadowFill);

      // Configure emissive decorations (crystals, alien structures)
      environmentRef.current?.setEmissiveDecorationsEnabled(graphicsSettings.emissiveDecorationsEnabled);
      environmentRef.current?.setEmissiveIntensityMultiplier(graphicsSettings.emissiveIntensityMultiplier);

      // Initialize light pool for dynamic effects
      if (graphicsSettings.dynamicLightsEnabled) {
        lightPoolRef.current = new LightPool(scene, graphicsSettings.maxDynamicLights);
      }

      // TSL GameOverlayManager - WebGPU compatible
      overlayManagerRef.current = new TSLGameOverlayManager(
        scene,
        CURRENT_MAP,
        (x, y) => terrain.getHeightAt(x, y)
      );
      overlayManagerRef.current.setWorld(game.world);

      // Initialize command queue waypoint visualization
      commandQueueRendererRef.current = new CommandQueueRenderer(
        scene,
        game.eventBus,
        game.world,
        localPlayerId,
        (x, y) => terrain.getHeightAt(x, y)
      );

      // Hook particle system to combat events
      // PERF: Uses pooled Vector3 objects to avoid allocation per attack
      eventUnsubscribersRef.current.push(game.eventBus.on('combat:attack', (data: {
        attackerId?: string; // Unit type ID for airborne height lookup
        attackerPos?: { x: number; y: number };
        targetPos?: { x: number; y: number };
        targetUnitType?: string; // Unit type ID for airborne height lookup
        damageType?: string;
        attackerIsFlying?: boolean;
        targetIsFlying?: boolean;
      }) => {
        if (data.attackerPos && data.targetPos && effectEmitterRef.current) {
          // Calculate terrain heights
          const attackerTerrainHeight = terrain.getHeightAt(data.attackerPos.x, data.attackerPos.y);
          const targetTerrainHeight = terrain.getHeightAt(data.targetPos.x, data.targetPos.y);

          // Calculate flying offsets using per-unit-type airborne heights from assets.json
          const attackerAirborneHeight = data.attackerId ? AssetManager.getAirborneHeight(data.attackerId) : DEFAULT_AIRBORNE_HEIGHT;
          const targetAirborneHeight = data.targetUnitType ? AssetManager.getAirborneHeight(data.targetUnitType) : DEFAULT_AIRBORNE_HEIGHT;
          const attackerFlyingOffset = data.attackerIsFlying ? attackerAirborneHeight : 0;
          const targetFlyingOffset = data.targetIsFlying ? targetAirborneHeight : 0;

          const startHeight = attackerTerrainHeight + 0.5 + attackerFlyingOffset;
          const endHeight = targetTerrainHeight + 0.5 + targetFlyingOffset;

          _combatStartPos.set(data.attackerPos.x, startHeight, data.attackerPos.y);
          _combatEndPos.set(data.targetPos.x, endHeight, data.targetPos.y);
          _combatDirection.copy(_combatEndPos).sub(_combatStartPos).normalize();

          effectEmitterRef.current.muzzleFlash(_combatStartPos, _combatDirection);
          effectEmitterRef.current.impact(_combatEndPos, _combatDirection.negate());
        }
      }));

      // Death explosion - uses AdvancedParticleSystem only (BattleEffectsRenderer handles death rings)
      eventUnsubscribersRef.current.push(game.eventBus.on('unit:died', (data: {
        position?: { x: number; y: number };
        isFlying?: boolean;
        unitType?: string; // Unit type ID for airborne height lookup
      }) => {
        if (data.position && advancedParticlesRef.current) {
          const terrainHeight = terrain.getHeightAt(data.position.x, data.position.y);
          // Calculate flying offset using per-unit-type airborne heights from assets.json
          const airborneHeight = data.unitType ? AssetManager.getAirborneHeight(data.unitType) : DEFAULT_AIRBORNE_HEIGHT;
          const flyingOffset = data.isFlying ? airborneHeight : 0;
          const effectHeight = terrainHeight + 0.5 + flyingOffset;

          _deathPos.set(data.position.x, effectHeight, data.position.y);
          advancedParticlesRef.current.emitExplosion(_deathPos, 1.2);
        }
      }));

      // Building destroyed - big explosion with advanced particles
      eventUnsubscribersRef.current.push(game.eventBus.on('building:destroyed', (data: {
        entityId: number;
        playerId: string;
        buildingType: string;
        position: { x: number; y: number };
      }) => {
        if (advancedParticlesRef.current) {
          const terrainHeight = terrain.getHeightAt(data.position.x, data.position.y);
          const isLarge = ['headquarters', 'infantry_bay', 'forge', 'hangar'].includes(data.buildingType);
          _deathPos.set(data.position.x, terrainHeight + 1, data.position.y);
          advancedParticlesRef.current.emitExplosion(_deathPos, isLarge ? 2.5 : 1.5);
        }
      }));

      // Multiplayer: Remote player quit
      eventUnsubscribersRef.current.push(game.eventBus.on('multiplayer:playerQuit', () => {
        debugNetworking.log('[Game] Remote player quit the game');
        useUIStore.getState().addNotification('warning', 'Remote player has left the game', 10000);
      }));

      // Spawn entities (skip in battle simulator - user spawns manually)
      if (!isBattleSimulatorMode()) {
        spawnInitialEntities(game, CURRENT_MAP);
      }

      // Initialize watch towers
      if (CURRENT_MAP.watchTowers && CURRENT_MAP.watchTowers.length > 0) {
        game.visionSystem.setWatchTowers(CURRENT_MAP.watchTowers);
        watchTowerRendererRef.current = new WatchTowerRenderer(scene, game.visionSystem);
      }

      // Initialize audio (must await to ensure sounds are preloaded before game starts)
      await game.audioSystem.initialize(camera.camera, CURRENT_MAP.biome);

      // NOTE: game.start() is called in initializePhaserOverlay after Phaser is ready
      // This ensures the countdown overlay is visible when it triggers

      // Animation loop
      let lastTime = performance.now();
      let lastRenderTime = 0; // For FPS limiting
      let frameCount = 0;
      let lastFpsLog = performance.now();

      const animate = (currentTime: number) => {
        // Frame rate limiting - check before doing any work
        const maxFPS = useUIStore.getState().graphicsSettings.maxFPS;
        if (maxFPS > 0) {
          const minFrameTime = 1000 / maxFPS;
          if (currentTime - lastRenderTime < minFrameTime) {
            // Not enough time has passed, skip this frame
            requestAnimationFrame(animate);
            return;
          }
        }
        lastRenderTime = currentTime;

        const frameStart = performance.now();
        const deltaTime = currentTime - lastTime;
        const prevTime = lastTime;
        lastTime = currentTime;

        // Log actual FPS every second
        frameCount++;
        if (currentTime - lastFpsLog > 1000) {
          const actualFps = frameCount / ((currentTime - lastFpsLog) / 1000);
          if (actualFps < 30) {
            debugPerformance.warn(`[FPS] Actual: ${actualFps.toFixed(1)}, deltaTime avg: ${((currentTime - lastFpsLog) / frameCount).toFixed(1)}ms`);
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

        // Update systems with timing (only log if total updates > 10ms)
        const updatesStart = performance.now();
        camera.update(deltaTime);

        // PERF: Set camera reference for frustum culling in renderers
        const threeCamera = camera.camera;
        unitRendererRef.current?.setCamera(threeCamera);
        buildingRendererRef.current?.setCamera(threeCamera);
        resourceRendererRef.current?.setCamera(threeCamera);
        vehicleEffectsRef.current?.setCamera(threeCamera);

        // PERF: Update camera matrix once before all renderer frustum culling
        // This avoids each renderer calling updateMatrixWorld() separately
        threeCamera.updateMatrixWorld();

        // PERF: Per-system timing for debugging - gated by debug settings for zero overhead
        const DETAILED_TIMING = useUIStore.getState().debugSettings.debugPerformance;
        let unitTime = 0, buildingTime = 0, resourceTime = 0, fogTime = 0, effectsTime = 0;

        // PERF: Monitor scene object count for leak detection
        const sceneChildCount = scene.children.length;

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

        rallyPointRendererRef.current?.update();
        watchTowerRendererRef.current?.update(deltaTime);
        placementPreviewRef.current?.update(deltaTime / 1000);

        const gameTime = gameRef.current?.getGameTime() ?? 0;
        // PERF: Pass camera for decoration frustum culling
        environmentRef.current?.update(deltaTime / 1000, gameTime, camera.camera);

        // Update shadow camera to follow the game camera for proper shadow rendering
        // This ensures shadows appear for objects near the camera, not just at map center
        environmentRef.current?.updateShadowCameraPosition(camera.target.x, camera.target.z);
        // PERF: Adaptive shadow updates - fast when units present, slow for empty/static scenes
        const entityCount = gameRef.current?.world.getEntityCount() ?? 0;
        environmentRef.current?.setHasMovingEntities(entityCount > 0);
        environmentRef.current?.updateShadows();

        // Update TSL visual systems
        selectionSystemRef.current?.update(deltaTime);
        effectEmitterRef.current?.update(deltaTime / 1000);

        // Update battle effects
        battleEffectsRef.current?.update(deltaTime);
        advancedParticlesRef.current?.update(deltaTime / 1000, cameraRef.current?.camera);

        // Update vehicle effects (engine trails, exhaust, dust)
        vehicleEffectsRef.current?.update(deltaTime / 1000);

        // Update dynamic lighting pool
        lightPoolRef.current?.update();

        // Update strategic overlays and command queue
        overlayManagerRef.current?.update(deltaTime);
        commandQueueRendererRef.current?.update();

        const updatesElapsed = performance.now() - updatesStart;
        if (updatesElapsed > 10) {
          if (DETAILED_TIMING) {
            debugPerformance.warn(
              `[UPDATES] Total: ${updatesElapsed.toFixed(1)}ms | ` +
              `Unit: ${unitTime.toFixed(1)}ms | ` +
              `Building: ${buildingTime.toFixed(1)}ms | ` +
              `Resource: ${resourceTime.toFixed(1)}ms | ` +
              `Fog: ${fogTime.toFixed(1)}ms | ` +
              `Effects: ${effectsTime.toFixed(1)}ms | ` +
              `SceneObjects: ${sceneChildCount}`
            );
          } else {
            debugPerformance.warn(`[UPDATES] Total update time: ${updatesElapsed.toFixed(1)}ms`);
          }
        }

        // PERF: Monitor for scene object leak (warn if count grows unexpectedly)
        if (DETAILED_TIMING && sceneChildCount > 500) {
          debugPerformance.warn(`[LEAK?] Scene has ${sceneChildCount} children - check for object leaks!`);
        }

        // PERF: Update selection rings with optimized change detection
        const selectedUnits = useGameStore.getState().selectedUnits;
        const gameInstance = gameRef.current;
        if (gameInstance && selectionSystemRef.current) {
          const rings = (selectionSystemRef.current as any).selectionRings as Map<number, unknown> | undefined;
          const ringsSize = rings?.size ?? 0;
          const selectedCount = selectedUnits.length;

          // PERF: Only process if there's something to do
          if (selectedCount > 0 || ringsSize > 0) {
            // PERF: Build Set only when we have rings to check against (avoid allocation when empty)
            // Also reuse approach: check rings directly instead of building intermediate Set

            // PERF: Create rings for newly selected units - check directly against rings Map
            for (let i = 0; i < selectedCount; i++) {
              const unitId = selectedUnits[i];
              if (!rings?.has(unitId)) {
                const entity = gameInstance.world.getEntity(unitId);
                if (entity) {
                  const selectable = entity.get<Selectable>('Selectable');
                  if (selectable) {
                    selectionSystemRef.current.createSelectionRing(unitId, selectable.playerId, 1);
                  }
                }
              }
            }

            // PERF: Remove rings for deselected units - only if we have rings
            if (ringsSize > 0) {
              // PERF: For small selections, iterate rings and check against array (avoid Set allocation)
              // For large selections, building a Set is worth it
              if (selectedCount <= 20) {
                // Small selection: O(rings * selected) but avoids allocation
                for (const [id] of rings!) {
                  let found = false;
                  for (let i = 0; i < selectedCount; i++) {
                    if (selectedUnits[i] === id) {
                      found = true;
                      break;
                    }
                  }
                  if (!found) {
                    selectionSystemRef.current.removeSelectionRing(id);
                  }
                }
              } else {
                // Large selection: build Set for O(1) lookup
                const selectedSet = new Set(selectedUnits);
                for (const [id] of rings!) {
                  if (!selectedSet.has(id)) {
                    selectionSystemRef.current.removeSelectionRing(id);
                  }
                }
              }
            }

            // Update positions for all selected units (units may have moved)
            for (let i = 0; i < selectedCount; i++) {
              const unitId = selectedUnits[i];
              const entity = gameInstance.world.getEntity(unitId);
              if (entity) {
                const transform = entity.get<Transform>('Transform');
                const unit = entity.get<Unit>('Unit');
                if (transform) {
                  const terrainHeight = environmentRef.current?.getHeightAt(transform.x, transform.y) ?? 0;
                  // Add airborne height for flying units so selection ring appears at unit height
                  const airborneHeight = unit?.isFlying ? AssetManager.getAirborneHeight(unit.unitId) : 0;
                  selectionSystemRef.current.updateSelectionRing(unitId, transform.x, terrainHeight + airborneHeight, transform.y);
                }
              }
            }
          }
        }

        // Throttle zustand store updates
        if (deltaTime > 0) {
          // Update game time once per second (only displays MM:SS)
          const isGameFinished = gameRef.current?.gameStateSystem.isGameFinished() ?? false;
          if (Math.floor(currentTime / 1000) !== Math.floor(prevTime / 1000)) {
            if (!isGameFinished) {
              useGameStore.getState().setGameTime(gameTime);
            }
          }
          // Final update when game ends to sync HUD clock with victory overlay.
          // Critical for inactive tabs: game loop (Web Worker) continues but render loop
          // (RAF) is throttled, causing store to fall behind actual game time.
          if (isGameFinished && !finalGameTimeUpdatedRef.current) {
            finalGameTimeUpdatedRef.current = true;
            useGameStore.getState().setGameTime(gameTime);
          }
          // Update camera position every 100ms for responsive UI
          if (Math.floor(currentTime / 100) !== Math.floor(prevTime / 100)) {
            const pos = camera.getPosition();
            useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());
          }
        }

        // Render with post-processing
        // Note: TRAANode handles camera jitter internally - don't apply manual jitter
        const renderStart = performance.now();

        // IMPORTANT: Save unjittered camera matrices BEFORE render
        // TRAA applies sub-pixel jitter during render, which would cause velocity shake
        // Also needed for SSGI which uses temporal filtering
        if (renderPipelineRef.current?.isTAAEnabled() || renderPipelineRef.current?.isSSGIEnabled()) {
          setCameraMatricesBeforeRender(camera.camera);
        }

        if (renderPipelineRef.current) {
          renderPipelineRef.current.render();
        } else {
          renderer.render(scene, camera.camera);
        }
        const renderElapsed = performance.now() - renderStart;

        // Update camera matrices for TAA velocity calculation (after render, for next frame)
        if (renderPipelineRef.current?.isTAAEnabled()) {
          updateCameraMatrices(camera.camera);
        }

        const frameElapsed = performance.now() - frameStart;
        if (DETAILED_TIMING && frameElapsed > 16) { // Log if frame takes more than 16ms (60fps target)
          debugPerformance.warn(`[FRAME] Total: ${frameElapsed.toFixed(1)}ms, Render: ${renderElapsed.toFixed(1)}ms`);
        }

        // Update performance metrics for display (throttled to once per second)
        if (Math.floor(currentTime / 1000) !== Math.floor(prevTime / 1000)) {
          const rendererInfo = renderer.info;
          const cpuTime = updatesElapsed; // Time spent in JS before render
          const gpuTime = renderElapsed;  // Estimated GPU time (render call duration)

          // Get render/display resolution
          let renderWidth = 0, renderHeight = 0, displayWidth = 0, displayHeight = 0;
          if (renderPipelineRef.current) {
            const renderRes = renderPipelineRef.current.getRenderResolution();
            const displayRes = renderPipelineRef.current.getDisplayResolution();
            renderWidth = renderRes.width;
            renderHeight = renderRes.height;
            displayWidth = displayRes.width;
            displayHeight = displayRes.height;
          } else {
            const size = new THREE.Vector2();
            renderer.getSize(size);
            const pixelRatio = window.devicePixelRatio || 1;
            renderWidth = displayWidth = Math.floor(size.x * pixelRatio);
            renderHeight = displayHeight = Math.floor(size.y * pixelRatio);
          }

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
          });

          // Update PerformanceMonitor with per-frame render metrics
          // Note: triangles/drawCalls are accumulated over 1 second, fps used to calculate per-frame
          const currentFps = 1000 / frameElapsed;
          PerformanceMonitor.updateRenderMetrics(
            rendererInfo.render.calls,
            rendererInfo.render.triangles,
            currentFps
          );

          // Reset renderer info for next frame's accurate count
          rendererInfo.reset();
        }

        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    };

    const initializePhaserOverlay = () => {
      if (!phaserContainerRef.current || !gameRef.current) return;

      // Use container dimensions for accurate sizing with DevTools docked
      const phaserWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const phaserHeight = containerRef.current?.clientHeight ?? window.innerHeight;

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.WEBGL,
        parent: phaserContainerRef.current,
        width: phaserWidth,
        height: phaserHeight,
        transparent: true,
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        render: {
          pixelArt: false,
          antialias: true,
        },
        scene: [OverlayScene],
        input: {
          mouse: {
            preventDefaultWheel: false,
          },
        },
      };

      const phaserGame = new Phaser.Game(config);
      phaserGameRef.current = phaserGame;

      phaserGame.events.once('ready', () => {
        const scene = phaserGame.scene.getScene('OverlayScene') as OverlayScene;
        overlaySceneRef.current = scene;

        if (gameRef.current) {
          phaserGame.scene.start('OverlayScene', { eventBus: gameRef.current.eventBus });

          // Wire up terrain height function for accurate damage number positioning
          if (environmentRef.current) {
            const terrain = environmentRef.current.terrain;
            scene.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));
          }

          // Start the game AFTER Phaser overlay is ready
          // This ensures the countdown is visible when it triggers
          // Small delay to ensure scene is fully initialized
          setTimeout(() => {
            gameRef.current?.start();
          }, 100);
        }

        // Initialize Phaser loop worker for background tab immunity
        // Web Workers are not throttled when tab is inactive, ensuring overlay stays in sync
        try {
          const worker = new Worker(
            new URL('../../workers/phaserLoopWorker.ts', import.meta.url)
          );

          worker.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'tick') {
              const { time, delta } = e.data;

              // Only step Phaser when the tab is hidden (RAF is throttled)
              // When tab is visible, Phaser's internal loop handles updates
              if (document.hidden && phaserGameRef.current) {
                // Step Phaser's game loop manually
                // This keeps tweens, timers, and scene updates running
                const game = phaserGameRef.current;
                if (game.loop && game.isRunning) {
                  // Update the game's time delta for accurate timing
                  game.loop.now = time;
                  game.loop.delta = delta;
                  game.loop.rawDelta = delta;

                  // Step all active scenes
                  game.scene.scenes.forEach((scene: Phaser.Scene) => {
                    if (scene.sys.isActive() && scene.sys.settings.status === Phaser.Scenes.RUNNING) {
                      scene.sys.step(time, delta);
                    }
                  });

                  lastPhaserUpdateTimeRef.current = time;
                }
              }
            }
          };

          // Start the worker immediately - it will only step Phaser when tab is hidden
          worker.postMessage({ type: 'start', intervalMs: 16 }); // 60fps
          phaserLoopWorkerRef.current = worker;
        } catch (err) {
          // Worker failed to initialize - Phaser will still work via RAF when tab is visible
          console.warn('[WebGPUGameCanvas] Phaser loop worker failed to initialize:', err);
        }
      });
    };

    // Calculate display resolution based on graphics settings
    // Uses container dimensions when available for accurate sizing with DevTools docked
    const calculateDisplayResolution = () => {
      const settings = useUIStore.getState().graphicsSettings;
      const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const containerHeight = containerRef.current?.clientHeight ?? window.innerHeight;
      const devicePixelRatio = window.devicePixelRatio || 1;

      let targetWidth: number;
      let targetHeight: number;
      let effectivePixelRatio: number;

      switch (settings.resolutionMode) {
        case 'fixed': {
          // Fixed resolution = exact device pixel count, so pixelRatio = 1
          const fixedResKey = settings.fixedResolution as keyof typeof FIXED_RESOLUTIONS;
          const fixedRes = FIXED_RESOLUTIONS[fixedResKey];
          effectivePixelRatio = 1.0;
          targetWidth = fixedRes.width;
          targetHeight = fixedRes.height;
          break;
        }
        case 'percentage':
          // Scale the container resolution by a percentage
          effectivePixelRatio = Math.min(devicePixelRatio, settings.maxPixelRatio);
          targetWidth = Math.floor(containerWidth * settings.resolutionScale);
          targetHeight = Math.floor(containerHeight * settings.resolutionScale);
          break;
        case 'native':
        default:
          // Use full container size with device pixel ratio
          effectivePixelRatio = Math.min(devicePixelRatio, settings.maxPixelRatio);
          targetWidth = containerWidth;
          targetHeight = containerHeight;
          break;
      }

      return {
        width: targetWidth,
        height: targetHeight,
        pixelRatio: effectivePixelRatio,
      };
    };

    // Handle resize - applies resolution settings
    const handleResize = () => {
      const { width, height, pixelRatio } = calculateDisplayResolution();

      if (renderContextRef.current && cameraRef.current) {
        const renderer = renderContextRef.current.renderer;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false); // false = don't update CSS, canvas stays fullscreen

        // Sync camera's internal screen dimensions for accurate screenToWorld conversion
        // This is critical when DevTools opens/closes (ResizeObserver fires but window resize may not)
        cameraRef.current.setScreenDimensions(width, height);

        // Update PostProcessing display size
        if (renderPipelineRef.current) {
          renderPipelineRef.current.setSize(width * pixelRatio, height * pixelRatio);
        }
      }

      // Phaser uses container dimensions for accurate sizing with DevTools docked
      if (phaserGameRef.current) {
        const phaserWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const phaserHeight = containerRef.current?.clientHeight ?? window.innerHeight;
        phaserGameRef.current.scale.resize(phaserWidth, phaserHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    // Use ResizeObserver to detect container size changes (e.g., DevTools open/close)
    // Window resize events don't fire when DevTools changes the available viewport
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);
    }

    initializeGame();

    return () => {
      // Unsubscribe from all event listeners
      for (const unsubscribe of eventUnsubscribersRef.current) {
        unsubscribe();
      }
      eventUnsubscribersRef.current = [];

      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();

      useProjectionStore.getState().setWorldToScreen(null);

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

      selectionSystemRef.current?.dispose();
      effectEmitterRef.current?.dispose();
      renderPipelineRef.current?.dispose();
      overlayManagerRef.current?.dispose();
      commandQueueRendererRef.current?.dispose();
      lightPoolRef.current?.dispose();

      // Stop and terminate Phaser loop worker
      if (phaserLoopWorkerRef.current) {
        phaserLoopWorkerRef.current.postMessage({ type: 'stop' });
        phaserLoopWorkerRef.current.terminate();
        phaserLoopWorkerRef.current = null;
      }

      phaserGameRef.current?.destroy(true);

      if (gameRef.current) {
        gameRef.current.audioSystem.dispose();
        Game.resetInstance();
      }
    };
  }, []);

  // Helper to convert mouse coordinates to container-relative coordinates
  // Critical for DevTools docking and any case where canvas doesn't fill viewport
  const getContainerCoords = useCallback((e: React.MouseEvent | MouseEvent): { x: number; y: number } => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    // Fallback to raw clientX/clientY if container not available
    return { x: e.clientX, y: e.clientY };
  }, []);

  // Mouse handlers (same as HybridGameCanvas)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const coords = getContainerCoords(e);
    if (e.button === 0) {
      if (commandTargetMode === 'attack') {
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const localPlayer = getLocalPlayerId();
          if (selectedUnits.length > 0 && localPlayer) {
            gameRef.current.issueCommand({
              tick: gameRef.current.getCurrentTick(),
              playerId: localPlayer,
              type: 'ATTACK',
              entityIds: selectedUnits,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
            // Visual feedback for attack-ground command
            gameRef.current.eventBus.emit('command:attackGround', {
              targetPosition: { x: worldPos.x, y: worldPos.z },
              playerId: localPlayer,
            });
          }
        }
        if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
      } else if (commandTargetMode === 'patrol') {
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const localPlayer = getLocalPlayerId();
          if (selectedUnits.length > 0 && localPlayer) {
            gameRef.current.issueCommand({
              tick: gameRef.current.getCurrentTick(),
              playerId: localPlayer,
              type: 'PATROL',
              entityIds: selectedUnits,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
          }
        }
        useGameStore.getState().setCommandTargetMode(null);
      } else if (commandTargetMode === 'move') {
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const localPlayer = getLocalPlayerId();
          if (selectedUnits.length > 0 && localPlayer) {
            gameRef.current.issueCommand({
              tick: gameRef.current.getCurrentTick(),
              playerId: localPlayer,
              type: 'MOVE',
              entityIds: selectedUnits,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
            // Visual feedback for move command
            gameRef.current.eventBus.emit('command:moveGround', {
              targetPosition: { x: worldPos.x, y: worldPos.z },
              playerId: localPlayer,
            });
          }
        }
        if (!e.shiftKey) useGameStore.getState().setCommandTargetMode(null);
      } else if (abilityTargetMode) {
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);
          const localPlayer = getLocalPlayerId();

          if (localPlayer) {
            gameRef.current.issueCommand({
              tick: gameRef.current.getCurrentTick(),
              playerId: localPlayer,
              type: 'ABILITY',
              entityIds: selectedUnits,
              abilityId: abilityTargetMode,
              targetPosition: { x: worldPos.x, y: worldPos.z },
              targetEntityId: clickedEntity?.entity.id,
            });
          }
        }
        useGameStore.getState().setAbilityTargetMode(null);
      } else if (isWallPlacementMode) {
        // Wall placement mode - start drag to place wall line
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && wallPlacementPreviewRef.current) {
          wallPlacementPreviewRef.current.startLine(worldPos.x, worldPos.z);
        }
      } else if (isLandingMode && landingBuildingId) {
        // Handle landing mode - left-click to land flying building
        if (placementPreviewRef.current && gameRef.current) {
          const snappedPos = placementPreviewRef.current.getSnappedPosition();
          const isValid = placementPreviewRef.current.isPlacementValid();
          const localPlayer = getLocalPlayerId();

          if (isValid && localPlayer) {
            gameRef.current.issueCommand({
              tick: gameRef.current.getCurrentTick(),
              playerId: localPlayer,
              type: 'LAND',
              entityIds: [landingBuildingId],
              buildingId: landingBuildingId,
              targetPosition: { x: snappedPos.x, y: snappedPos.y },
            });
            useGameStore.getState().setLandingMode(false);
          }
          // If not valid, stay in landing mode - player can try another spot
        }
      } else if (isBuilding && buildingType && placementPreviewRef.current) {
        // Place building (supports shift-click to queue multiple placements)
        const snappedPos = placementPreviewRef.current.getSnappedPosition();
        const isValid = placementPreviewRef.current.isPlacementValid();

        if (isValid && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          gameRef.current.eventBus.emit('building:place', {
            buildingType,
            position: { x: snappedPos.x, y: snappedPos.y },
            workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
          });

          if (e.shiftKey) {
            // Shift held: add to queue for visual display, stay in building mode
            useGameStore.getState().addToBuildingQueue({
              buildingType,
              x: snappedPos.x,
              y: snappedPos.y,
            });
          } else {
            // No shift: exit building mode
            useGameStore.getState().setBuildingMode(null);
          }
        } else if (!isValid) {
          // Invalid placement - show error, exit mode if not shift-clicking
          if (!e.shiftKey) {
            useGameStore.getState().setBuildingMode(null);
          }
        }
      } else if (isBattleSimulatorMode()) {
        // In battle simulator, left-click emits spawn event for the panel
        const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
        if (worldPos && gameRef.current) {
          gameRef.current.eventBus.emit('simulator:spawn', {
            worldX: worldPos.x,
            worldY: worldPos.z,
          });
        }
      } else {
        setIsSelecting(true);
        setSelectionStart({ x: coords.x, y: coords.y });
        setSelectionEnd({ x: coords.x, y: coords.y });
      }
    } else if (e.button === 2) {
      handleRightClick(e);
    }
  }, [isBuilding, buildingType, commandTargetMode, isSettingRallyPoint, isRepairMode, isLandingMode, landingBuildingId, abilityTargetMode, isWallPlacementMode, getContainerCoords]);

  const handleRightClick = (e: React.MouseEvent) => {
    // Right-click cancels command modes (alternative to ESC, especially useful in fullscreen)
    if (commandTargetMode) {
      useGameStore.getState().setCommandTargetMode(null);
      return;
    }
    if (isWallPlacementMode) {
      wallPlacementPreviewRef.current?.cancelLine();
      useGameStore.getState().setWallPlacementMode(false);
      return;
    }
    if (isBuilding) {
      useGameStore.getState().setBuildingMode(null);
      return;
    }
    if (abilityTargetMode) {
      useGameStore.getState().setAbilityTargetMode(null);
      return;
    }

    const coords = getContainerCoords(e);
    const worldPos = cameraRef.current?.screenToWorld(coords.x, coords.y);
    if (!worldPos || !gameRef.current) return;

    const selectedUnits = useGameStore.getState().selectedUnits;
    const game = gameRef.current;

    if (isSettingRallyPoint) {
      for (const buildingId of selectedUnits) {
        game.eventBus.emit('rally:set', {
          buildingId,
          x: worldPos.x,
          y: worldPos.z,
        });
      }
      useGameStore.getState().setRallyPointMode(false);
      return;
    }

    // Handle repair mode - right-click on repairable target
    if (isRepairMode) {
      const clickedEntity = findEntityAtPosition(game, worldPos.x, worldPos.z);
      if (clickedEntity) {
        const building = clickedEntity.entity.get<Building>('Building');
        const unit = clickedEntity.entity.get<Unit>('Unit');
        const health = clickedEntity.entity.get<Health>('Health');
        const selectable = clickedEntity.entity.get<Selectable>('Selectable');

        // Can repair own buildings or mechanical units
        const localPlayerForRepair = getLocalPlayerId();
        if (localPlayerForRepair && selectable?.playerId === localPlayerForRepair && health && !health.isDead()) {
          if (building || unit?.isMechanical) {
            game.eventBus.emit('command:repair', {
              entityIds: selectedUnits,
              targetId: clickedEntity.entity.id,
            });
            useGameStore.getState().setRepairMode(false);
            return;
          }
        }
      }
      // Clicked on invalid target - cancel repair mode
      useGameStore.getState().setRepairMode(false);
      return;
    }

    // Handle landing mode - right-click to land flying building
    if (isLandingMode && landingBuildingId) {
      // Use the placement preview's snapped position and validity check
      if (placementPreviewRef.current) {
        const snappedPos = placementPreviewRef.current.getSnappedPosition();
        const isValid = placementPreviewRef.current.isPlacementValid();
        const localPlayer = getLocalPlayerId();

        if (isValid && localPlayer) {
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'LAND',
            entityIds: [landingBuildingId],
            buildingId: landingBuildingId,
            targetPosition: { x: snappedPos.x, y: snappedPos.y },
          });
          useGameStore.getState().setLandingMode(false);
        }
        // If not valid, stay in landing mode - player can try another spot
      }
      return;
    }

    if (selectedUnits.length > 0) {
      const queue = e.shiftKey;
      const clickedEntity = findEntityAtPosition(game, worldPos.x, worldPos.z);

      if (clickedEntity) {
        const resource = clickedEntity.entity.get<Resource>('Resource');
        const selectable = clickedEntity.entity.get<Selectable>('Selectable');
        const health = clickedEntity.entity.get<Health>('Health');

        if (resource) {
          const workerIds = selectedUnits.filter((id) => {
            const entity = game.world.getEntity(id);
            const unit = entity?.get<Unit>('Unit');
            return unit?.isWorker;
          });
          const localPlayer = getLocalPlayerId();

          if (workerIds.length > 0 && localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'GATHER',
              entityIds: workerIds,
              targetEntityId: clickedEntity.entity.id,
            });
            return;
          }
        }

        const localPlayerId = getLocalPlayerId();
        if (selectable && localPlayerId && selectable.playerId !== localPlayerId && health && !health.isDead()) {
          game.eventBus.emit('command:attack', {
            entityIds: selectedUnits,
            targetEntityId: clickedEntity.entity.id,
            queue,
          });
          return;
        }

        // Check if clicking on a paused/waiting building to resume construction
        const building = clickedEntity.entity.get<Building>('Building');
        if (building && localPlayerId && selectable?.playerId === localPlayerId) {
          if (building.state === 'paused' || building.state === 'waiting_for_worker' || building.state === 'constructing') {
            // Find workers in selected units
            const workerIds = selectedUnits.filter((id) => {
              const entity = game.world.getEntity(id);
              const unit = entity?.get<Unit>('Unit');
              return unit?.isWorker;
            });

            if (workerIds.length > 0) {
              // Assign the first worker to resume construction
              game.eventBus.emit('command:resume_construction', {
                workerId: workerIds[0],
                buildingId: clickedEntity.entity.id,
              });
              return;
            }
          }
        }
      }

      // Categorize selected entities: flying buildings, grounded production buildings, and units
      const flyingBuildingIds: number[] = [];
      const groundedProductionBuildingIds: number[] = [];
      const unitIds: number[] = [];

      for (const id of selectedUnits) {
        const entity = game.world.getEntity(id);
        const building = entity?.get<Building>('Building');
        const unit = entity?.get<Unit>('Unit');

        if (building?.isFlying && building.state === 'flying') {
          // Flying buildings can be moved
          flyingBuildingIds.push(id);
        } else if (building && building.canProduce.length > 0 && !building.isFlying) {
          // Grounded production buildings get rally points
          groundedProductionBuildingIds.push(id);
        } else if (unit) {
          unitIds.push(id);
        }
      }

      // Move flying buildings
      if (flyingBuildingIds.length > 0) {
        for (const buildingId of flyingBuildingIds) {
          game.eventBus.emit('command:flyingBuildingMove', {
            buildingId,
            targetPosition: { x: worldPos.x, y: worldPos.z },
          });
        }
      }

      // Set rally point for grounded production buildings
      if (groundedProductionBuildingIds.length > 0 && flyingBuildingIds.length === 0 && unitIds.length === 0) {
        // Only set rally when ONLY grounded production buildings are selected
        let targetId: number | undefined = undefined;
        if (clickedEntity) {
          const resource = clickedEntity.entity.get<Resource>('Resource');
          if (resource) {
            targetId = clickedEntity.entity.id;
          }
        }
        for (const buildingId of groundedProductionBuildingIds) {
          game.eventBus.emit('rally:set', {
            buildingId,
            x: worldPos.x,
            y: worldPos.z,
            targetId,
          });
        }
      }

      // Move units normally
      if (unitIds.length > 0) {
        const localPlayer = getLocalPlayerId();
        if (localPlayer) {
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'MOVE',
            entityIds: unitIds,
            targetPosition: { x: worldPos.x, y: worldPos.z },
          });
          // Visual feedback for move command
          game.eventBus.emit('command:moveGround', {
            targetPosition: { x: worldPos.x, y: worldPos.z },
            playerId: localPlayer,
          });
        }
      }
    }
  };

  const findEntityAtPosition = (game: Game, x: number, z: number) => {
    const resourceClickRadius = 2.5;
    const unitClickRadius = 1.5;

    const resources = game.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < resourceClickRadius * resourceClickRadius) {
        return { entity };
      }
    }

    const units = game.world.getEntitiesWith('Unit', 'Transform', 'Health');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < unitClickRadius * unitClickRadius) {
        return { entity };
      }
    }

    const buildingClickRadius = 2.0;
    const buildings = game.world.getEntitiesWith('Building', 'Transform', 'Health');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < buildingClickRadius * buildingClickRadius) {
        return { entity };
      }
    }

    return null;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const coords = getContainerCoords(e);
    if (isSelecting) {
      setSelectionEnd({ x: coords.x, y: coords.y });
    }

    // Wall placement mode - update wall line preview while dragging
    if (isWallPlacementMode && wallPlacementPreviewRef.current && cameraRef.current) {
      const worldPos = cameraRef.current.screenToWorld(coords.x, coords.y);
      if (worldPos) {
        wallPlacementPreviewRef.current.updateLine(worldPos.x, worldPos.z);
      }
    }

    // Update placement preview for both building mode and landing mode
    if (placementPreviewRef.current && cameraRef.current) {
      if ((isBuilding && buildingType) || isLandingMode) {
        const worldPos = cameraRef.current.screenToWorld(coords.x, coords.y);
        if (worldPos) {
          placementPreviewRef.current.updatePosition(worldPos.x, worldPos.z);
        }
      }
    }
  }, [isSelecting, isBuilding, buildingType, isLandingMode, isWallPlacementMode, getContainerCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const coords = getContainerCoords(e);
    // Handle wall placement finish
    if (e.button === 0 && isWallPlacementMode && wallPlacementPreviewRef.current?.isCurrentlyDrawing()) {
      const result = wallPlacementPreviewRef.current.finishLine();
      const game = gameRef.current;

      if (game && result.positions.length > 0) {
        // Get the building type from the store
        const store = useGameStore.getState();
        const wallBuildingType = store.buildingType || 'wall_segment';

        // Emit the wall placement event
        game.eventBus.emit('wall:place_line', {
          positions: result.positions,
          buildingType: wallBuildingType,
          playerId: getLocalPlayerId(),
        });

        // Exit wall placement mode unless shift is held
        if (!e.shiftKey) {
          useGameStore.getState().setWallPlacementMode(false);
        }
      }
      return;
    }

    if (e.button === 0 && isSelecting) {
      setIsSelecting(false);

      const game = gameRef.current;

      if (game) {
        // Calculate screen-space box size
        const screenDx = Math.abs(selectionEnd.x - selectionStart.x);
        const screenDy = Math.abs(selectionEnd.y - selectionStart.y);

        // Minimum drag distance for box selection (pixels)
        const MIN_BOX_DRAG = 10;

        if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
          // Box selection - use screen-space for accurate perspective handling
          game.eventBus.emit('selection:boxScreen', {
            screenStartX: selectionStart.x,
            screenStartY: selectionStart.y,
            screenEndX: selectionEnd.x,
            screenEndY: selectionEnd.y,
            additive: e.shiftKey,
            playerId: getLocalPlayerId(),
          });
          lastClickRef.current = null;
        } else {
          // Click selection - check for double-click
          const now = Date.now();
          let isDoubleClick = false;

          if (lastClickRef.current) {
            const timeDiff = now - lastClickRef.current.time;
            const clickDx = Math.abs(coords.x - lastClickRef.current.x);
            const clickDy = Math.abs(coords.y - lastClickRef.current.y);

            isDoubleClick = timeDiff < DOUBLE_CLICK_TIME &&
                           clickDx < DOUBLE_CLICK_DIST &&
                           clickDy < DOUBLE_CLICK_DIST;
          }

          lastClickRef.current = { time: now, x: coords.x, y: coords.y };

          // Use screen-space click selection for accurate flying unit handling
          game.eventBus.emit('selection:clickScreen', {
            screenX: coords.x,
            screenY: coords.y,
            additive: e.shiftKey,
            selectAllOfType: e.ctrlKey || isDoubleClick,
            playerId: getLocalPlayerId(),
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd, isWallPlacementMode, getContainerCoords]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Document-level mouse listeners to handle drag selection over UI elements
  // Without this, dragging the selection box over the bottom bar (CommandCard, etc.)
  // would not update properly because mouse events fire on the UI element, not the canvas
  useEffect(() => {
    if (!isSelecting) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      const coords = getContainerCoords(e);
      setSelectionEnd({ x: coords.x, y: coords.y });
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      setIsSelecting(false);

      const game = gameRef.current;
      if (!game) return;

      // Use the final mouse position for the selection end (container-relative)
      const coords = getContainerCoords(e);
      const finalEndX = coords.x;
      const finalEndY = coords.y;

      // Calculate screen-space box size
      const screenDx = Math.abs(finalEndX - selectionStart.x);
      const screenDy = Math.abs(finalEndY - selectionStart.y);

      // Minimum drag distance for box selection (pixels)
      const MIN_BOX_DRAG = 10;

      if (screenDx > MIN_BOX_DRAG || screenDy > MIN_BOX_DRAG) {
        // Box selection - use screen-space for accurate perspective handling
        game.eventBus.emit('selection:boxScreen', {
          screenStartX: selectionStart.x,
          screenStartY: selectionStart.y,
          screenEndX: finalEndX,
          screenEndY: finalEndY,
          additive: e.shiftKey,
          playerId: getLocalPlayerId(),
        });
        lastClickRef.current = null;
      } else {
        // Click selection - check for double-click
        const now = Date.now();
        let isDoubleClick = false;

        if (lastClickRef.current) {
          const timeDiff = now - lastClickRef.current.time;
          const clickDx = Math.abs(coords.x - lastClickRef.current.x);
          const clickDy = Math.abs(coords.y - lastClickRef.current.y);

          isDoubleClick = timeDiff < DOUBLE_CLICK_TIME &&
                         clickDx < DOUBLE_CLICK_DIST &&
                         clickDy < DOUBLE_CLICK_DIST;
        }

        lastClickRef.current = { time: now, x: coords.x, y: coords.y };

        // Use screen-space click selection for accurate flying unit handling
        game.eventBus.emit('selection:clickScreen', {
          screenX: coords.x,
          screenY: coords.y,
          additive: e.shiftKey,
          selectAllOfType: e.ctrlKey || isDoubleClick,
          playerId: getLocalPlayerId(),
        });
      }
    };

    // Add listeners to document to catch mouse events anywhere on the page
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isSelecting, selectionStart, getContainerCoords]);

  // Building placement preview
  useEffect(() => {
    if (placementPreviewRef.current) {
      if (isBuilding && buildingType) {
        placementPreviewRef.current.startPlacement(buildingType);
      } else {
        placementPreviewRef.current.stopPlacement();
      }
    }
  }, [isBuilding, buildingType]);

  // Wall placement preview
  useEffect(() => {
    if (wallPlacementPreviewRef.current) {
      if (isWallPlacementMode) {
        const wallType = useGameStore.getState().buildingType || 'wall_segment';
        wallPlacementPreviewRef.current.startPlacement(wallType);
      } else {
        wallPlacementPreviewRef.current.stopPlacement();
      }
    }
  }, [isWallPlacementMode]);

  // Sync building placement queue to preview for visual path lines
  useEffect(() => {
    if (placementPreviewRef.current) {
      placementPreviewRef.current.setQueuedPlacements(buildingPlacementQueue);
    }
  }, [buildingPlacementQueue]);

  // Landing mode preview - show blueprint when selecting landing spot
  useEffect(() => {
    if (placementPreviewRef.current && gameRef.current) {
      if (isLandingMode && landingBuildingId) {
        // Get the building type from the landing building entity
        const entity = gameRef.current.world.getEntity(landingBuildingId);
        const building = entity?.get<Building>('Building');
        if (building) {
          placementPreviewRef.current.startPlacement(building.buildingId);
        }
      } else if (!isBuilding) {
        // Only stop if we're not in regular building mode
        placementPreviewRef.current.stopPlacement();
      }
    }
  }, [isLandingMode, landingBuildingId, isBuilding]);

  // Keyboard handlers
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const key = e.key.toLowerCase();

      switch (key) {
        case 'escape':
          {
            // Check if there's an active command mode that ESC should cancel
            const hasActiveCommand =
              commandTargetMode !== null ||
              isRepairMode ||
              isLandingMode ||
              isSettingRallyPoint ||
              abilityTargetMode !== null ||
              isBuilding ||
              isWallPlacementMode;

            // In fullscreen mode, prevent ESC from exiting fullscreen when canceling a command
            // This allows ESC to cancel commands without accidentally exiting fullscreen
            if (hasActiveCommand && useUIStore.getState().isFullscreen) {
              e.preventDefault();
            }

            if (commandTargetMode) useGameStore.getState().setCommandTargetMode(null);
            else if (isRepairMode) useGameStore.getState().setRepairMode(false);
            else if (isLandingMode) useGameStore.getState().setLandingMode(false);
            else if (isSettingRallyPoint) useGameStore.getState().setRallyPointMode(false);
            else if (abilityTargetMode) useGameStore.getState().setAbilityTargetMode(null);
            else if (isWallPlacementMode) {
              wallPlacementPreviewRef.current?.cancelLine();
              useGameStore.getState().setWallPlacementMode(false);
            }
            else if (isBuilding) useGameStore.getState().setBuildingMode(null);
            else game.eventBus.emit('selection:clear');
          }
          break;
        case 'l':
          {
            const store = useGameStore.getState();
            const localPlayer = getLocalPlayerId();
            if (store.selectedUnits.length > 0 && localPlayer) {
              const firstEntity = game.world.getEntity(store.selectedUnits[0]);
              const building = firstEntity?.get<Building>('Building');
              if (building?.canLiftOff) {
                if (building.isFlying && building.state === 'flying') {
                  // Land - enter landing mode
                  store.setLandingMode(true, store.selectedUnits[0]);
                } else if (building.state === 'complete' && !building.isFlying && building.productionQueue.length === 0) {
                  // Lift off - use issueCommand for multiplayer sync
                  game.issueCommand({
                    tick: game.getCurrentTick(),
                    playerId: localPlayer,
                    type: 'LIFTOFF',
                    entityIds: [store.selectedUnits[0]],
                    buildingId: store.selectedUnits[0],
                  });
                }
              }
            }
          }
          break;
        case 'r':
          {
            const store = useGameStore.getState();
            if (store.selectedUnits.length > 0) {
              // Check if selected units are workers (repair) or buildings (rally)
              const firstEntity = game.world.getEntity(store.selectedUnits[0]);
              const unit = firstEntity?.get<Unit>('Unit');
              const building = firstEntity?.get<Building>('Building');

              if (unit?.isWorker && unit?.canRepair) {
                store.setRepairMode(true);
              } else if (building) {
                store.setRallyPointMode(true);
              }
            }
          }
          break;
        case 'o':
          {
            // Cycle through overlays: none -> terrain -> elevation -> threat -> navmesh -> none
            const uiStore = useUIStore.getState();
            const currentOverlay = uiStore.overlaySettings.activeOverlay;
            const overlayOrder: GameOverlayType[] = ['none', 'terrain', 'elevation', 'threat', 'navmesh'];
            const currentIndex = overlayOrder.indexOf(currentOverlay);
            const nextIndex = (currentIndex + 1) % overlayOrder.length;
            uiStore.setActiveOverlay(overlayOrder[nextIndex]);
          }
          break;
        case 'a':
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('attack');
          }
          break;
        case 'm':
          // SC2-style: M for move targeting mode
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('move');
          }
          break;
        case 'p':
          if (!isBuilding) {
            useGameStore.getState().setCommandTargetMode('patrol');
          }
          break;
        case 's':
          {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'STOP',
                entityIds: selectedUnits,
              });
            }
          }
          break;
        case 'h':
          {
            const selectedUnits = useGameStore.getState().selectedUnits;
            const localPlayer = getLocalPlayerId();
            if (selectedUnits.length > 0 && localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'HOLD',
                entityIds: selectedUnits,
              });
            }
          }
          break;
        case '?':
          {
            const store = useGameStore.getState();
            store.setShowKeyboardShortcuts(!store.showKeyboardShortcuts);
          }
          break;
      }

      // Control groups (0-9)
      if (/^[0-9]$/.test(key)) {
        const groupNumber = parseInt(key);
        const store = useGameStore.getState();

        if (e.ctrlKey || e.metaKey) {
          // Assign control group
          store.setControlGroup(groupNumber, store.selectedUnits);
        } else if (e.shiftKey) {
          // Add to control group - optimized to avoid multiple spread operations
          const existing = store.controlGroups.get(groupNumber) || [];
          const selected = store.selectedUnits;
          // Use Set directly without spreading into array twice
          const combinedSet = new Set(existing);
          for (let i = 0; i < selected.length; i++) {
            combinedSet.add(selected[i]);
          }
          store.setControlGroup(groupNumber, Array.from(combinedSet));
        } else {
          // Select control group (double-tap to center camera)
          const group = store.controlGroups.get(groupNumber);
          if (group && group.length > 0) {
            const now = Date.now();
            const lastTap = lastControlGroupTap.current;

            if (lastTap && lastTap.group === groupNumber && now - lastTap.time < 300) {
              // Double-tap: center camera on first unit
              const firstEntity = game.world.getEntity(group[0]);
              const transform = firstEntity?.get<Transform>('Transform');
              if (transform && cameraRef.current) {
                cameraRef.current.setPosition(transform.x, transform.y);
              }
            }

            lastControlGroupTap.current = { group: groupNumber, time: now };
            store.selectUnits(group);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBuilding, commandTargetMode, isRepairMode, isLandingMode, isSettingRallyPoint, abilityTargetMode, isWallPlacementMode]);

  // Subscribe to overlay settings changes
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state, prevState) => {
      const overlaySettings = state.overlaySettings;
      const prevOverlaySettings = prevState.overlaySettings;

      // Only update if overlay settings changed
      if (overlaySettings === prevOverlaySettings) return;

      // Update overlay manager
      if (overlayManagerRef.current) {
        overlayManagerRef.current.setActiveOverlay(overlaySettings.activeOverlay);

        // Update opacity based on active overlay
        const opacityKey = `${overlaySettings.activeOverlay}OverlayOpacity` as keyof typeof overlaySettings;
        if (opacityKey in overlaySettings && typeof overlaySettings[opacityKey] === 'number') {
          overlayManagerRef.current.setOpacity(overlaySettings[opacityKey] as number);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to graphics settings changes
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state, prevState) => {
      const settings = state.graphicsSettings;
      const prevSettings = prevState.graphicsSettings;

      if (settings === prevSettings) return;

      // NOTE: Renderer tone mapping is disabled (NoToneMapping).
      // All tone mapping is handled by PostProcessing via ACES Filmic.
      // Exposure is passed to the PostProcessing pipeline below.

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
          ssgiThickness: 1, // Fixed value, not exposed in UI
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
        });
      }

      // Handle post-processing toggle (enable/disable entire pipeline)
      if (settings.postProcessingEnabled !== prevSettings.postProcessingEnabled) {
        if (!settings.postProcessingEnabled) {
          // Disable post-processing - dispose pipeline
          renderPipelineRef.current?.dispose();
          renderPipelineRef.current = null;
        } else if (renderContextRef.current && sceneRef.current && cameraRef.current) {
          // Re-enable post-processing - create new pipeline
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
            }
          );

          // Initialize camera matrices for TAA velocity calculation
          if (settings.taaEnabled) {
            initCameraMatrices(cameraRef.current.camera);
          }
        }
      }

      // Update shadow settings
      if (environmentRef.current) {
        if (settings.shadowsEnabled !== prevSettings.shadowsEnabled) {
          environmentRef.current.setShadowsEnabled(settings.shadowsEnabled);
          if (renderContextRef.current) {
            renderContextRef.current.renderer.shadowMap.enabled = settings.shadowsEnabled;
          }
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

        // Update shadow fill (ground bounce lighting)
        if (settings.shadowFill !== prevSettings.shadowFill) {
          environmentRef.current.setShadowFill(settings.shadowFill);
        }

        // Update emissive decorations (crystals, alien structures)
        if (settings.emissiveDecorationsEnabled !== prevSettings.emissiveDecorationsEnabled) {
          environmentRef.current.setEmissiveDecorationsEnabled(settings.emissiveDecorationsEnabled);
        }
        if (settings.emissiveIntensityMultiplier !== prevSettings.emissiveIntensityMultiplier) {
          environmentRef.current.setEmissiveIntensityMultiplier(settings.emissiveIntensityMultiplier);
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
        // Re-calculate and apply display resolution
        // Use container dimensions for accurate sizing with DevTools docked
        const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const containerHeight = containerRef.current?.clientHeight ?? window.innerHeight;
        const devicePixelRatio = window.devicePixelRatio || 1;

        let targetWidth: number;
        let targetHeight: number;

        // For fixed resolutions, use pixelRatio=1 so the fixed res IS the device pixel count
        // For native/percentage, use device pixel ratio (capped by maxPixelRatio)
        let effectivePixelRatio: number;

        switch (settings.resolutionMode) {
          case 'fixed': {
            const fixedResKey = settings.fixedResolution as keyof typeof FIXED_RESOLUTIONS;
            const fixedRes = FIXED_RESOLUTIONS[fixedResKey];
            // Fixed resolution = exact device pixel count, so pixelRatio = 1
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
        renderer.setSize(targetWidth, targetHeight, false); // false = don't update CSS, canvas stays fullscreen

        // Sync camera screen dimensions for accurate screenToWorld conversion
        cameraRef.current.setScreenDimensions(targetWidth, targetHeight);

        // Update PostProcessing display size (in device pixels)
        if (renderPipelineRef.current) {
          renderPipelineRef.current.setSize(
            targetWidth * effectivePixelRatio,
            targetHeight * effectivePixelRatio
          );
        }
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Loading screen */}
      {isLoading && (
        <LoadingScreen progress={loadingProgress} status={loadingStatus} onComplete={handleLoadingComplete} />
      )}

      {/* Fade-in from black overlay - smooth transition after loading */}
      {!isLoading && fadeInOpacity > 0 && (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ zIndex: 100, opacity: fadeInOpacity }}
        />
      )}

      {/* Three.js canvas */}
      <canvas
        ref={threeCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />

      {/* Phaser overlay container */}
      <div
        ref={phaserContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 10 }}
      />

      {/* React UI overlays */}
      {isSelecting && (
        <SelectionBox
          startX={selectionStart.x}
          startY={selectionStart.y}
          endX={selectionEnd.x}
          endY={selectionEnd.y}
        />
      )}

      {isBuilding && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-void-600 z-20">
          <span className="text-void-300">
            Placing {buildingType} - Click to place, ESC to cancel
          </span>
        </div>
      )}

      {commandTargetMode === 'attack' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-red-600 z-20">
          <span className="text-red-400">
            Attack-Move - Click canvas or minimap, ESC to cancel
          </span>
        </div>
      )}

      {commandTargetMode === 'move' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-blue-600 z-20">
          <span className="text-blue-400">
            Move - Click canvas or minimap, ESC to cancel
          </span>
        </div>
      )}

      {isSettingRallyPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-green-600 z-20">
          <span className="text-green-400">
            Set Rally Point - Right-click to set, ESC to cancel
          </span>
        </div>
      )}

      {commandTargetMode === 'patrol' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-yellow-600 z-20">
          <span className="text-yellow-400">
            Patrol Mode - Click canvas or minimap, ESC to cancel
          </span>
        </div>
      )}

      {isRepairMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-cyan-600 z-20">
          <span className="text-cyan-400">
            Repair Mode - Right-click on building or mech unit, ESC to cancel
          </span>
        </div>
      )}

      {abilityTargetMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-purple-600 z-20">
          <span className="text-purple-400">
            Select Target - Click location, ESC to cancel
          </span>
        </div>
      )}

      {isLandingMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-blue-600 z-20">
          <span className="text-blue-400">
            Landing Mode - Right-click to select landing location, ESC to cancel
          </span>
        </div>
      )}

      {/* Graphics Options Panel */}
      <GraphicsOptionsPanel />

      {/* Debug Menu Panel */}
      <DebugMenuPanel />
    </div>
  );
}
