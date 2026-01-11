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
import { FogOfWar } from '@/rendering/FogOfWar';
import { EffectsRenderer } from '@/rendering/EffectsRenderer';
import { RallyPointRenderer } from '@/rendering/RallyPointRenderer';
import { WatchTowerRenderer } from '@/rendering/WatchTowerRenderer';
import { BuildingPlacementPreview } from '@/rendering/BuildingPlacementPreview';
import { GameOverlayManager } from '@/rendering/GameOverlayManager';
import { CommandQueueRenderer } from '@/rendering/CommandQueueRenderer';

// TSL Components (WebGPU-compatible)
import {
  createWebGPURenderer,
  RenderContext,
  SelectionSystem,
  GPUParticleSystem,
  RenderPipeline,
  EffectEmitter,
} from '@/rendering/tsl';

import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { GraphicsOptionsPanel } from './GraphicsOptionsPanel';
import { DebugMenuPanel } from './DebugMenuPanel';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { useUIStore } from '@/store/uiStore';
import { debugInitialization } from '@/utils/debugLogger';
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
  const fogOfWarRef = useRef<FogOfWar | null>(null);
  const effectsRendererRef = useRef<EffectsRenderer | null>(null);
  const rallyPointRendererRef = useRef<RallyPointRenderer | null>(null);
  const watchTowerRendererRef = useRef<WatchTowerRenderer | null>(null);
  const placementPreviewRef = useRef<BuildingPlacementPreview | null>(null);
  const environmentRef = useRef<EnvironmentManager | null>(null);

  // Strategic overlays and command queue
  const overlayManagerRef = useRef<GameOverlayManager | null>(null);
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

  const { isBuilding, buildingType, buildingPlacementQueue, isSettingRallyPoint, isRepairMode, abilityTargetMode } = useGameStore();

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
        console.error('[WebGPUGameCanvas] Initialization failed:', error);
        setLoadingStatus('Error - falling back to WebGL');
      }
    };

    const initializeThreeJS = async () => {
      if (!threeCanvasRef.current) return;

      // Create WebGPU renderer with automatic fallback
      const renderContext = await createWebGPURenderer({
        canvas: threeCanvasRef.current,
        antialias: true,
        powerPreference: 'high-performance',
        forceWebGL: false, // Let it try WebGPU first
      });

      renderContextRef.current = renderContext;
      setIsWebGPU(renderContext.isWebGPU);

      // Set renderer API in UI store for graphics options display
      useUIStore.getState().setRendererAPI(renderContext.isWebGPU ? 'WebGPU' : 'WebGL');

      console.log(`[WebGPUGameCanvas] Using ${renderContext.isWebGPU ? 'WebGPU' : 'WebGL'} backend`);
      if (renderContext.supportsCompute) {
        console.log('[WebGPUGameCanvas] GPU Compute shaders available');
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
      useProjectionStore.getState().setWorldToScreen((worldX, worldZ, worldY) => {
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
        aiEnabled: true,
      });
      gameRef.current = game;

      // Set terrain data
      game.setTerrainGrid(CURRENT_MAP.terrain);
      game.setDecorationCollisions(environment.getRockCollisions());

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

      if (fogOfWarEnabled && !isSpectatorMode()) {
        const fogOfWar = new FogOfWar({ mapWidth, mapHeight });
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
      scene.add(placementPreviewRef.current.group);

      // Initialize TSL Visual Systems (WebGPU-compatible)
      selectionSystemRef.current = new SelectionSystem(scene);

      // GPU Particle Effects
      effectEmitterRef.current = new EffectEmitter(scene, renderer as any, 10000);

      // Post-processing pipeline (TSL-based)
      const graphicsSettings = useUIStore.getState().graphicsSettings;
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
            ssaoEnabled: graphicsSettings.ssaoEnabled,
            ssaoRadius: graphicsSettings.ssaoRadius,
            ssaoIntensity: 1.0,
            fxaaEnabled: graphicsSettings.fxaaEnabled,
            vignetteEnabled: true,
            vignetteIntensity: 0.3,
            vignetteRadius: 0.8,
            exposure: graphicsSettings.toneMappingExposure,
            saturation: 1.1,
            contrast: 1.05,
          }
        );
      }

      // Initialize strategic overlays (terrain, elevation, threat)
      overlayManagerRef.current = new GameOverlayManager(
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

      // Spawn entities
      spawnInitialEntities(game, CURRENT_MAP);

      // Initialize watch towers
      if (CURRENT_MAP.watchTowers && CURRENT_MAP.watchTowers.length > 0) {
        game.visionSystem.setWatchTowers(CURRENT_MAP.watchTowers);
        watchTowerRendererRef.current = new WatchTowerRenderer(scene, game.visionSystem);
      }

      // Initialize audio
      game.audioSystem.initialize(camera.camera, CURRENT_MAP.biome);

      // Start game
      game.start();

      // Animation loop
      let lastTime = performance.now();

      const animate = (currentTime: number) => {
        const deltaTime = currentTime - lastTime;
        const prevTime = lastTime;
        lastTime = currentTime;

        // Handle pending camera moves
        const pendingMove = useGameStore.getState().pendingCameraMove;
        if (pendingMove) {
          camera.setPosition(pendingMove.x, pendingMove.y);
          useGameStore.getState().clearPendingCameraMove();
        }

        // Update systems
        camera.update(deltaTime);
        unitRendererRef.current?.update();
        buildingRendererRef.current?.update();
        resourceRendererRef.current?.update();
        fogOfWarRef.current?.update();
        effectsRendererRef.current?.update(deltaTime);
        rallyPointRendererRef.current?.update();
        watchTowerRendererRef.current?.update(deltaTime);

        const gameTime = gameRef.current?.getGameTime() ?? 0;
        environmentRef.current?.update(deltaTime / 1000, gameTime);

        // Update TSL visual systems
        selectionSystemRef.current?.update(deltaTime);
        effectEmitterRef.current?.update(deltaTime / 1000);

        // Update strategic overlays and command queue
        overlayManagerRef.current?.update(deltaTime);
        commandQueueRendererRef.current?.update();

        // Update selection rings
        const selectedUnits = useGameStore.getState().selectedUnits;
        const gameInstance = gameRef.current;
        if (gameInstance && selectionSystemRef.current) {
          for (const unitId of selectedUnits) {
            const entity = gameInstance.world.getEntity(unitId);
            if (entity) {
              const transform = entity.get<Transform>('Transform');
              const selectable = entity.get<Selectable>('Selectable');
              if (transform && selectable) {
                const terrainHeight = environmentRef.current?.getHeightAt(transform.x, transform.y) ?? 0;
                if (!(selectionSystemRef.current as any).selectionRings?.has(unitId)) {
                  selectionSystemRef.current.createSelectionRing(unitId, selectable.playerId, 1);
                }
                selectionSystemRef.current.updateSelectionRing(unitId, transform.x, terrainHeight, transform.y);
              }
            }
          }
          // Remove rings for deselected units
          const rings = (selectionSystemRef.current as any).selectionRings;
          if (rings) {
            for (const [id] of rings) {
              if (!selectedUnits.includes(id)) {
                selectionSystemRef.current.removeSelectionRing(id);
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
        if (renderPipelineRef.current) {
          renderPipelineRef.current.render();
        } else {
          renderer.render(scene, camera.camera);
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
      } else {
        setIsSelecting(true);
        setSelectionStart({ x: e.clientX, y: e.clientY });
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      }
    } else if (e.button === 2) {
      handleRightClick(e);
    }
  }, [isBuilding, buildingType, isAttackMove, isPatrolMode, isSettingRallyPoint, isRepairMode, abilityTargetMode]);

  const handleRightClick = (e: React.MouseEvent) => {
    if (isAttackMove) {
      setIsAttackMove(false);
      return;
    }
    if (isPatrolMode) {
      setIsPatrolMode(false);
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
      }

      game.eventBus.emit('command:move', {
        entityIds: selectedUnits,
        targetPosition: { x: worldPos.x, y: worldPos.z },
        queue,
      });
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

    if (isBuilding && buildingType && placementPreviewRef.current && cameraRef.current) {
      const worldPos = cameraRef.current.screenToWorld(e.clientX, e.clientY);
      if (worldPos) {
        placementPreviewRef.current.updatePosition(worldPos.x, worldPos.z);
      }
    }
  }, [isSelecting, isBuilding, buildingType]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && isSelecting) {
      setIsSelecting(false);

      const camera = cameraRef.current;
      const game = gameRef.current;

      if (camera && game) {
        const start = camera.screenToWorld(selectionStart.x, selectionStart.y);
        const end = camera.screenToWorld(selectionEnd.x, selectionEnd.y);

        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.z - start.z);

        if (dx > 1 || dy > 1) {
          game.eventBus.emit('selection:box', {
            startX: Math.min(start.x, end.x),
            startY: Math.min(start.z, end.z),
            endX: Math.max(start.x, end.x),
            endY: Math.max(start.z, end.z),
            additive: e.shiftKey,
            playerId: getLocalPlayerId(),
          });
          lastClickRef.current = null;
        } else {
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

          game.eventBus.emit('selection:click', {
            x: end.x,
            y: end.z,
            additive: e.shiftKey,
            selectAllOfType: e.ctrlKey || isDoubleClick,
            playerId: getLocalPlayerId(),
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd]);

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

  // Sync building placement queue to preview for visual path lines
  useEffect(() => {
    if (placementPreviewRef.current) {
      placementPreviewRef.current.setQueuedPlacements(buildingPlacementQueue);
    }
  }, [buildingPlacementQueue]);

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
          if (isAttackMove) setIsAttackMove(false);
          else if (isPatrolMode) setIsPatrolMode(false);
          else if (isRepairMode) useGameStore.getState().setRepairMode(false);
          else if (isSettingRallyPoint) useGameStore.getState().setRallyPointMode(false);
          else if (abilityTargetMode) useGameStore.getState().setAbilityTargetMode(null);
          else if (isBuilding) useGameStore.getState().setBuildingMode(null);
          else game.eventBus.emit('selection:clear');
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
          // Add to control group
          const existing = store.controlGroups.get(groupNumber) || [];
          const combined = [...new Set([...existing, ...store.selectedUnits])];
          store.setControlGroup(groupNumber, combined);
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
  }, [isBuilding, isAttackMove, isPatrolMode, isRepairMode, isSettingRallyPoint, abilityTargetMode]);

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

      // Note: Post-processing settings require rebuild of the pipeline
      // For now, only exposure is updated dynamically
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

      {/* Graphics Options Panel */}
      <GraphicsOptionsPanel />

      {/* Debug Menu Panel */}
      <DebugMenuPanel />
    </div>
  );
}
