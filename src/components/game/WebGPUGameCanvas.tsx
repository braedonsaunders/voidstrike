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
import { RTSCamera } from '@/rendering/Camera';
import { TerrainGrid } from '@/rendering/Terrain';
import { EnvironmentManager } from '@/rendering/EnvironmentManager';
import { UnitRenderer } from '@/rendering/UnitRenderer';
import { BuildingRenderer } from '@/rendering/BuildingRenderer';
import { ResourceRenderer } from '@/rendering/ResourceRenderer';
import { EffectsRenderer } from '@/rendering/EffectsRenderer';
import { RallyPointRenderer } from '@/rendering/RallyPointRenderer';
import { WatchTowerRenderer } from '@/rendering/WatchTowerRenderer';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { WallPlacementPreview } from '@/rendering/WallPlacementPreview';
import { CommandQueueRenderer } from '@/rendering/CommandQueueRenderer';

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

import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getLocalPlayerId, isSpectatorMode, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { GraphicsOptionsPanel } from './GraphicsOptionsPanel';
import { DebugMenuPanel } from './DebugMenuPanel';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { useUIStore } from '@/store/uiStore';
import { debugInitialization, debugPerformance } from '@/utils/debugLogger';
import { DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { Resource } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Building } from '@/engine/components/Building';
import AssetManager from '@/assets/AssetManager';
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
  const effectsRendererRef = useRef<EffectsRenderer | null>(null);
  const rallyPointRendererRef = useRef<RallyPointRenderer | null>(null);
  const watchTowerRendererRef = useRef<WatchTowerRenderer | null>(null);
  const placementPreviewRef = useRef<BuildingPlacementPreview | null>(null);
  const wallPlacementPreviewRef = useRef<WallPlacementPreview | null>(null);
  const environmentRef = useRef<EnvironmentManager | null>(null);

  // Strategic overlays and command queue
  const overlayManagerRef = useRef<TSLGameOverlayManager | null>(null);
  const commandQueueRendererRef = useRef<CommandQueueRenderer | null>(null);

  // TSL Visual Systems (WebGPU-compatible)
  const selectionSystemRef = useRef<SelectionSystem | null>(null);
  const effectEmitterRef = useRef<EffectEmitter | null>(null);
  const renderPipelineRef = useRef<RenderPipeline | null>(null);

  // Phaser refs
  const phaserContainerRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const overlaySceneRef = useRef<OverlayScene | null>(null);

  // Game engine ref
  const gameRef = useRef<Game | null>(null);

  // UI state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });
  const [isAttackMove, setIsAttackMove] = useState(false);
  const [isPatrolMode, setIsPatrolMode] = useState(false);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing');
  const [isWebGPU, setIsWebGPU] = useState(false);

  // Control group tracking
  const lastControlGroupTap = useRef<{ group: number; time: number } | null>(null);
  const subgroupIndexRef = useRef(0);

  // Double-click detection
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const DOUBLE_CLICK_TIME = 400;
  const DOUBLE_CLICK_DIST = 10;

  const { isBuilding, buildingType, buildingPlacementQueue, isSettingRallyPoint, isRepairMode, isLandingMode, landingBuildingId, abilityTargetMode, isWallPlacementMode } = useGameStore();

  // Initialize both Three.js (WebGPU) and Phaser
  useEffect(() => {
    if (!containerRef.current || !threeCanvasRef.current || !phaserContainerRef.current) return;

    const initializeGame = async () => {
      try {
        // Load selected map from store
        const selectedMapId = useGameSetupStore.getState().selectedMapId;
        CURRENT_MAP = getMapById(selectedMapId) || DEFAULT_MAP;
        debugInitialization.log(`[WebGPUGameCanvas] Loading map: ${CURRENT_MAP.name}`);

        setLoadingStatus('Loading 3D models');
        setLoadingProgress(10);

        await AssetManager.loadCustomModels();
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

        await new Promise(resolve => setTimeout(resolve, 300));
        setIsLoading(false);
      } catch (error) {
        debugInitialization.error('[WebGPUGameCanvas] Initialization failed:', error);
        setLoadingStatus('Error - falling back to WebGL');
      }
    };

    const initializeThreeJS = async () => {
      if (!threeCanvasRef.current) return;

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

      debugInitialization.log(`[WebGPUGameCanvas] Using ${renderContext.isWebGPU ? 'WebGPU' : 'WebGL'} backend`);
      if (renderContext.supportsCompute) {
        debugInitialization.log('[WebGPUGameCanvas] GPU Compute shaders available');
      }

      const renderer = renderContext.renderer;
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = useUIStore.getState().graphicsSettings.toneMappingExposure;

      // Create scene
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x1a1a2e, 50, 150);
      sceneRef.current = scene;

      // Create camera
      const mapWidth = CURRENT_MAP.width;
      const mapHeight = CURRENT_MAP.height;
      const camera = new RTSCamera(
        window.innerWidth / window.innerHeight,
        mapWidth,
        mapHeight
      );

      // Start at local player's spawn
      const localPlayerSlot = useGameSetupStore.getState().getLocalPlayerSlot();
      const playerSpawn = CURRENT_MAP.spawns.find(s => s.playerSlot === localPlayerSlot) || CURRENT_MAP.spawns[0];
      camera.setPosition(playerSpawn.x, playerSpawn.y);
      cameraRef.current = camera;
      setCameraRef(camera);

      // Create environment
      const environment = new EnvironmentManager(scene, CURRENT_MAP);
      environmentRef.current = environment;
      const terrain = environment.terrain;

      camera.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      // Set up projection store
      useProjectionStore.getState().setWorldToScreen((worldX: number, worldZ: number, worldY?: number) => {
        return camera.worldToScreen(worldX, worldZ, worldY);
      });

      // Create terrain grid
      const grid = new TerrainGrid(mapWidth, mapHeight, 1);
      scene.add(grid.mesh);

      // Initialize game engine
      const localPlayerId = getLocalPlayerId();
      const game = Game.getInstance({
        mapWidth,
        mapHeight,
        tickRate: 20,
        isMultiplayer: false,
        playerId: localPlayerId ?? 'spectator',
        aiEnabled: !isBattleSimulatorMode(), // Disable AI in battle simulator
      });
      gameRef.current = game;

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

      // Initialize navmesh for pathfinding (must complete before spawning entities)
      setLoadingStatus('Generating navigation mesh');
      setLoadingProgress(55);
      console.log('[WebGPUGameCanvas] Generating walkable geometry...');
      const walkableGeometry = terrain.generateWalkableGeometry();
      console.log('[WebGPUGameCanvas] Walkable geometry generated:', {
        positions: walkableGeometry.positions.length,
        indices: walkableGeometry.indices.length,
      });
      console.log('[WebGPUGameCanvas] Initializing navmesh...');
      const navMeshSuccess = await game.initializeNavMesh(walkableGeometry.positions, walkableGeometry.indices);
      console.log('[WebGPUGameCanvas] NavMesh result:', navMeshSuccess);
      if (!navMeshSuccess) {
        console.error('[WebGPUGameCanvas] NavMesh initialization failed!');
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

      effectsRendererRef.current = new EffectsRenderer(scene, game.eventBus, (x, z) => terrain.getHeightAt(x, z));
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
      placementPreviewRef.current.setPlacementValidator((centerX, centerY, width, height) => {
        return game.isValidBuildingPlacement(centerX, centerY, width, height);
      });
      scene.add(placementPreviewRef.current.group);

      // Wall placement preview for click-and-drag wall lines
      wallPlacementPreviewRef.current = new WallPlacementPreview(
        CURRENT_MAP,
        (x, y) => terrain.getHeightAt(x, y)
      );
      wallPlacementPreviewRef.current.setPlacementValidator((x, y, w, h) => {
        return game.isValidBuildingPlacement(x, y, w, h);
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
          }
        );
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

      // Configure environment map
      environmentRef.current?.setEnvironmentMapEnabled(graphicsSettings.environmentMapEnabled);

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
      game.eventBus.on('combat:attack', (data: {
        attackerPos?: { x: number; y: number };
        targetPos?: { x: number; y: number };
        damageType?: string;
      }) => {
        if (data.attackerPos && data.targetPos && effectEmitterRef.current) {
          const startHeight = terrain.getHeightAt(data.attackerPos.x, data.attackerPos.y) + 0.5;
          const endHeight = terrain.getHeightAt(data.targetPos.x, data.targetPos.y) + 0.5;
          const startPos = new THREE.Vector3(data.attackerPos.x, startHeight, data.attackerPos.y);
          const endPos = new THREE.Vector3(data.targetPos.x, endHeight, data.targetPos.y);
          const direction = endPos.clone().sub(startPos).normalize();

          effectEmitterRef.current.muzzleFlash(startPos, direction);
          effectEmitterRef.current.impact(endPos, direction.negate());
        }
      });

      game.eventBus.on('unit:died', (data: { position?: { x: number; y: number } }) => {
        if (data.position && effectEmitterRef.current) {
          const terrainHeight = terrain.getHeightAt(data.position.x, data.position.y);
          const pos = new THREE.Vector3(data.position.x, terrainHeight + 0.5, data.position.y);
          effectEmitterRef.current.explosion(pos, 1);
        }
      });

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

      // Start game
      game.start();

      // Animation loop
      let lastTime = performance.now();
      let frameCount = 0;
      let lastFpsLog = performance.now();

      const animate = (currentTime: number) => {
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

          t = performance.now();
          effectsRendererRef.current?.update(deltaTime);
          effectsTime = performance.now() - t;

          // Log effects stats periodically
          if (frameCount === 0 && effectsRendererRef.current) {
            const stats = effectsRendererRef.current.getDebugStats();
            debugPerformance.log(
              `[EFFECTS] Attacks: ${stats.attackEffects}, Hits: ${stats.hitEffects}, ` +
              `DmgNums: ${stats.damageNumbers}, Move: ${stats.moveIndicators}, ` +
              `Pools: Proj(${stats.poolStats.projectile.inUse}/${stats.poolStats.projectile.available}) ` +
              `Hit(${stats.poolStats.hitEffect.inUse}/${stats.poolStats.hitEffect.available})`
            );
          }
        } else {
          unitRendererRef.current?.update();
          buildingRendererRef.current?.update();
          resourceRendererRef.current?.update();
          fogOfWarRef.current?.update();
          effectsRendererRef.current?.update(deltaTime);
        }

        rallyPointRendererRef.current?.update();
        watchTowerRendererRef.current?.update(deltaTime);
        placementPreviewRef.current?.update(deltaTime / 1000);

        const gameTime = gameRef.current?.getGameTime() ?? 0;
        environmentRef.current?.update(deltaTime / 1000, gameTime);

        // Update shadow camera to follow the game camera for proper shadow rendering
        // This ensures shadows appear for objects near the camera, not just at map center
        environmentRef.current?.updateShadowCameraPosition(camera.target.x, camera.target.z);
        // PERF: Throttled shadow updates - only updates shadow map every N frames
        environmentRef.current?.updateShadows();

        // Update TSL visual systems
        selectionSystemRef.current?.update(deltaTime);
        effectEmitterRef.current?.update(deltaTime / 1000);

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
                if (transform) {
                  const terrainHeight = environmentRef.current?.getHeightAt(transform.x, transform.y) ?? 0;
                  selectionSystemRef.current.updateSelectionRing(unitId, transform.x, terrainHeight, transform.y);
                }
              }
            }
          }
        }

        // Throttle zustand store updates
        if (deltaTime > 0 && Math.floor(currentTime / 100) !== Math.floor(prevTime / 100)) {
          useGameStore.getState().setGameTime(gameTime);
          const pos = camera.getPosition();
          useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());
        }

        // Render with post-processing
        const renderStart = performance.now();
        if (renderPipelineRef.current) {
          renderPipelineRef.current.render();
        } else {
          renderer.render(scene, camera.camera);
        }
        const renderElapsed = performance.now() - renderStart;

        const frameElapsed = performance.now() - frameStart;
        if (frameElapsed > 16) { // Log if frame takes more than 16ms (60fps target)
          debugPerformance.warn(`[FRAME] Total: ${frameElapsed.toFixed(1)}ms, Render: ${renderElapsed.toFixed(1)}ms`);
        }

        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    };

    const initializePhaserOverlay = () => {
      if (!phaserContainerRef.current || !gameRef.current) return;

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.WEBGL,
        parent: phaserContainerRef.current,
        width: window.innerWidth,
        height: window.innerHeight,
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
        }
      });
    };

    // Handle resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (renderContextRef.current && cameraRef.current) {
        renderContextRef.current.renderer.setSize(width, height);
        cameraRef.current.camera.aspect = width / height;
        cameraRef.current.camera.updateProjectionMatrix();
      }

      if (phaserGameRef.current) {
        phaserGameRef.current.scale.resize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);

    initializeGame();

    return () => {
      window.removeEventListener('resize', handleResize);

      useProjectionStore.getState().setWorldToScreen(null);

      renderContextRef.current?.renderer.dispose();
      environmentRef.current?.dispose();
      fogOfWarRef.current?.dispose();
      effectsRendererRef.current?.dispose();
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

      phaserGameRef.current?.destroy(true);

      if (gameRef.current) {
        gameRef.current.audioSystem.dispose();
        Game.resetInstance();
      }
    };
  }, []);

  // Mouse handlers (same as HybridGameCanvas)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      if (isAttackMove) {
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          if (selectedUnits.length > 0) {
            gameRef.current.eventBus.emit('command:attack', {
              entityIds: selectedUnits,
              targetPosition: { x: worldPos.x, y: worldPos.z },
              queue: e.shiftKey,
            });
          }
        }
        if (!e.shiftKey) setIsAttackMove(false);
      } else if (isPatrolMode) {
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          if (selectedUnits.length > 0) {
            gameRef.current.eventBus.emit('command:patrol', {
              entityIds: selectedUnits,
              targetPosition: { x: worldPos.x, y: worldPos.z },
            });
          }
        }
        setIsPatrolMode(false);
      } else if (abilityTargetMode) {
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);

          gameRef.current.eventBus.emit('command:ability', {
            entityIds: selectedUnits,
            abilityId: abilityTargetMode,
            targetPosition: { x: worldPos.x, y: worldPos.z },
            targetEntityId: clickedEntity?.entity.id,
          });
        }
        useGameStore.getState().setAbilityTargetMode(null);
      } else if (isWallPlacementMode) {
        // Wall placement mode - start drag to place wall line
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && wallPlacementPreviewRef.current) {
          wallPlacementPreviewRef.current.startLine(worldPos.x, worldPos.z);
        }
      } else if (isBuilding && buildingType) {
        // Place building (supports shift-click to queue multiple placements)
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          gameRef.current.eventBus.emit('building:place', {
            buildingType,
            position: { x: worldPos.x, y: worldPos.z },
            workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
          });

          if (e.shiftKey) {
            // Shift held: add to queue for visual display, stay in building mode
            useGameStore.getState().addToBuildingQueue({
              buildingType,
              x: worldPos.x,
              y: worldPos.z,
            });
          } else {
            // No shift: exit building mode
            useGameStore.getState().setBuildingMode(null);
          }
        }
      } else if (isBattleSimulatorMode()) {
        // In battle simulator, left-click emits spawn event for the panel
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          gameRef.current.eventBus.emit('simulator:spawn', {
            worldX: worldPos.x,
            worldY: worldPos.z,
          });
        }
      } else {
        setIsSelecting(true);
        setSelectionStart({ x: e.clientX, y: e.clientY });
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      }
    } else if (e.button === 2) {
      handleRightClick(e);
    }
  }, [isBuilding, buildingType, isAttackMove, isPatrolMode, isSettingRallyPoint, isRepairMode, isLandingMode, landingBuildingId, abilityTargetMode, isWallPlacementMode]);

  const handleRightClick = (e: React.MouseEvent) => {
    // Right-click cancels command modes (alternative to ESC, especially useful in fullscreen)
    if (isAttackMove) {
      setIsAttackMove(false);
      return;
    }
    if (isPatrolMode) {
      setIsPatrolMode(false);
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

    const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
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

        if (isValid) {
          game.eventBus.emit('command:land', {
            buildingId: landingBuildingId,
            position: { x: snappedPos.x, y: snappedPos.y },
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

          if (workerIds.length > 0) {
            game.eventBus.emit('command:gather', {
              entityIds: workerIds,
              targetEntityId: clickedEntity.entity.id,
              queue,
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

      // Check if all selected entities are production buildings - if so, set rally point
      const selectedBuildings: number[] = [];
      let allAreProductionBuildings = true;
      for (const id of selectedUnits) {
        const entity = game.world.getEntity(id);
        const building = entity?.get<Building>('Building');
        if (building && building.canProduce.length > 0) {
          selectedBuildings.push(id);
        } else {
          allAreProductionBuildings = false;
          break;
        }
      }

      if (allAreProductionBuildings && selectedBuildings.length > 0) {
        // Set rally point for all selected production buildings
        // Check if clicking on a resource for auto-gather rally
        let targetId: number | undefined = undefined;
        if (clickedEntity) {
          const resource = clickedEntity.entity.get<Resource>('Resource');
          if (resource) {
            targetId = clickedEntity.entity.id;
          }
        }
        for (const buildingId of selectedBuildings) {
          game.eventBus.emit('rally:set', {
            buildingId,
            x: worldPos.x,
            y: worldPos.z,
            targetId,
          });
        }
        return;
      }

      // Check if selected entities include flying buildings - they need special move handling
      const flyingBuildingIds: number[] = [];
      const unitIds: number[] = [];

      for (const id of selectedUnits) {
        const entity = game.world.getEntity(id);
        const building = entity?.get<Building>('Building');
        const unit = entity?.get<Unit>('Unit');

        if (building?.isFlying && building.state === 'flying') {
          flyingBuildingIds.push(id);
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

      // Move units normally
      if (unitIds.length > 0) {
        game.eventBus.emit('command:move', {
          entityIds: unitIds,
          targetPosition: { x: worldPos.x, y: worldPos.z },
          queue,
        });
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
    if (isSelecting) {
      setSelectionEnd({ x: e.clientX, y: e.clientY });
    }

    // Wall placement mode - update wall line preview while dragging
    if (isWallPlacementMode && wallPlacementPreviewRef.current && cameraRef.current) {
      const worldPos = cameraRef.current.screenToWorld(e.clientX, e.clientY);
      if (worldPos) {
        wallPlacementPreviewRef.current.updateLine(worldPos.x, worldPos.z);
      }
    }

    // Update placement preview for both building mode and landing mode
    if (placementPreviewRef.current && cameraRef.current) {
      if ((isBuilding && buildingType) || isLandingMode) {
        const worldPos = cameraRef.current.screenToWorld(e.clientX, e.clientY);
        if (worldPos) {
          placementPreviewRef.current.updatePosition(worldPos.x, worldPos.z);
        }
      }
    }
  }, [isSelecting, isBuilding, buildingType, isLandingMode, isWallPlacementMode]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
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
            const clickDx = Math.abs(e.clientX - lastClickRef.current.x);
            const clickDy = Math.abs(e.clientY - lastClickRef.current.y);

            isDoubleClick = timeDiff < DOUBLE_CLICK_TIME &&
                           clickDx < DOUBLE_CLICK_DIST &&
                           clickDy < DOUBLE_CLICK_DIST;
          }

          lastClickRef.current = { time: now, x: e.clientX, y: e.clientY };

          // Use screen-space click selection for accurate flying unit handling
          game.eventBus.emit('selection:clickScreen', {
            screenX: e.clientX,
            screenY: e.clientY,
            additive: e.shiftKey,
            selectAllOfType: e.ctrlKey || isDoubleClick,
            playerId: getLocalPlayerId(),
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd, isWallPlacementMode]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

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
              isAttackMove ||
              isPatrolMode ||
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

            if (isAttackMove) setIsAttackMove(false);
            else if (isPatrolMode) setIsPatrolMode(false);
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
            if (store.selectedUnits.length > 0) {
              const firstEntity = game.world.getEntity(store.selectedUnits[0]);
              const building = firstEntity?.get<Building>('Building');
              if (building?.canLiftOff) {
                if (building.isFlying && building.state === 'flying') {
                  // Land - enter landing mode
                  store.setLandingMode(true, store.selectedUnits[0]);
                } else if (building.state === 'complete' && !building.isFlying && building.productionQueue.length === 0) {
                  // Lift off
                  game.eventBus.emit('command:liftOff', {
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
            // Cycle through overlays: none -> terrain -> elevation -> threat -> none
            const uiStore = useUIStore.getState();
            const currentOverlay = uiStore.overlaySettings.activeOverlay;
            const overlayOrder: Array<'none' | 'terrain' | 'elevation' | 'threat'> = ['none', 'terrain', 'elevation', 'threat'];
            const currentIndex = overlayOrder.indexOf(currentOverlay);
            const nextIndex = (currentIndex + 1) % overlayOrder.length;
            uiStore.setActiveOverlay(overlayOrder[nextIndex]);
          }
          break;
        case 'a':
          if (!isBuilding) {
            setIsAttackMove(true);
          }
          break;
        case 'p':
          if (!isBuilding) {
            setIsPatrolMode(true);
          }
          break;
        case 's':
          game.eventBus.emit('command:stop', {
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'h':
          game.eventBus.emit('command:holdPosition', {
            entityIds: useGameStore.getState().selectedUnits,
          });
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
  }, [isBuilding, isAttackMove, isPatrolMode, isRepairMode, isLandingMode, isSettingRallyPoint, abilityTargetMode, isWallPlacementMode]);

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

      // Update renderer exposure
      if (renderContextRef.current) {
        renderContextRef.current.renderer.toneMappingExposure = settings.toneMappingExposure;
      }

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
            }
          );
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

        // Update environment map
        if (settings.environmentMapEnabled !== prevSettings.environmentMapEnabled) {
          environmentRef.current.setEnvironmentMapEnabled(settings.environmentMapEnabled);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Loading screen */}
      {isLoading && (
        <LoadingScreen progress={loadingProgress} status={loadingStatus} />
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

      {isAttackMove && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-red-600 z-20">
          <span className="text-red-400">
            Attack-Move - Click target, ESC to cancel
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

      {isPatrolMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-yellow-600 z-20">
          <span className="text-yellow-400">
            Patrol Mode - Click destination, ESC to cancel
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
