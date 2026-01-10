'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
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
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore } from '@/store/gameSetupStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { Resource } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import AssetManager from '@/assets/AssetManager';

// Map reference - loaded dynamically from store
let CURRENT_MAP: MapData = DEFAULT_MAP;

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<RTSCamera | null>(null);

  const unitRendererRef = useRef<UnitRenderer | null>(null);
  const buildingRendererRef = useRef<BuildingRenderer | null>(null);
  const resourceRendererRef = useRef<ResourceRenderer | null>(null);
  const fogOfWarRef = useRef<FogOfWar | null>(null);
  const effectsRendererRef = useRef<EffectsRenderer | null>(null);
  const rallyPointRendererRef = useRef<RallyPointRenderer | null>(null);
  const watchTowerRendererRef = useRef<WatchTowerRenderer | null>(null);
  const environmentRef = useRef<EnvironmentManager | null>(null);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });
  const [isAttackMove, setIsAttackMove] = useState(false);
  const [isPatrolMode, setIsPatrolMode] = useState(false);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing');

  // Track double-tap for control groups
  const lastControlGroupTap = useRef<{ group: number; time: number } | null>(null);

  // Track current subgroup index for Tab cycling
  const subgroupIndexRef = useRef(0);

  const { isBuilding, buildingType, isSettingRallyPoint, abilityTargetMode } = useGameStore();

  // Initialize Three.js and game engine
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // Load all assets before starting the game
    const initializeGame = async () => {
      // Load selected map from store
      const selectedMapId = useGameSetupStore.getState().selectedMapId;
      CURRENT_MAP = getMapById(selectedMapId) || DEFAULT_MAP;
      console.log(`[GameCanvas] Loading map: ${CURRENT_MAP.name} (${CURRENT_MAP.id})`);

      // Stage 1: Loading 3D models (0-45%)
      setLoadingStatus('Loading 3D models');
      setLoadingProgress(2);

      await AssetManager.loadCustomModels((loaded, total, assetId) => {
        const modelProgress = Math.floor((loaded / total) * 43);
        setLoadingProgress(2 + modelProgress);
        // Show current asset being loaded
        const displayName = assetId.replace(/_/g, ' ');
        setLoadingStatus(`Loading: ${displayName}`);
      });

      // Stage 2: Initialize game world with progress tracking
      await initializeGameWorldWithProgress();

      setLoadingProgress(100);
      setLoadingStatus('Ready');

      // Fade out loading screen
      await new Promise(resolve => setTimeout(resolve, 500));
      setIsLoading(false);
    };

    // Initialize game world with granular progress reporting
    const initializeGameWorldWithProgress = async () => {
      if (!canvasRef.current) return;

      // Stage 2: Creating WebGL renderer (45-50%)
      setLoadingStatus('Creating WebGL renderer');
      setLoadingProgress(47);
      await new Promise(resolve => setTimeout(resolve, 16)); // Allow UI update

      // Create renderer with performance optimizations
      const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: false, // PERFORMANCE: Disable antialiasing - major GPU cost
        powerPreference: 'high-performance',
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.enabled = false;
      rendererRef.current = renderer;

      setLoadingProgress(50);

      // Stage 3: Creating scene and camera (50-55%)
      setLoadingStatus('Setting up camera');
      await new Promise(resolve => setTimeout(resolve, 16));

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const mapWidth = CURRENT_MAP.width;
      const mapHeight = CURRENT_MAP.height;

      const camera = new RTSCamera(
        window.innerWidth / window.innerHeight,
        mapWidth,
        mapHeight
      );
      const playerSpawn = CURRENT_MAP.spawns.find(s => s.playerSlot === 1) || CURRENT_MAP.spawns[0];
      camera.setPosition(playerSpawn.x, playerSpawn.y);
      cameraRef.current = camera;

      setLoadingProgress(55);

      // Stage 4: Building terrain and environment (55-65%)
      setLoadingStatus('Generating terrain');
      await new Promise(resolve => setTimeout(resolve, 16));

      const environment = new EnvironmentManager(scene, CURRENT_MAP);
      environmentRef.current = environment;
      const terrain = environment.terrain;

      camera.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      setLoadingProgress(60);
      setLoadingStatus('Placing decorations');
      await new Promise(resolve => setTimeout(resolve, 16));

      const grid = new TerrainGrid(mapWidth, mapHeight, 1);
      scene.add(grid.mesh);

      setLoadingProgress(65);

      // Stage 5: Initializing game engine (65-75%)
      setLoadingStatus('Initializing game engine');
      await new Promise(resolve => setTimeout(resolve, 16));

      const game = Game.getInstance({
        mapWidth,
        mapHeight,
        tickRate: 20,
        isMultiplayer: false,
        playerId: 'player1',
        aiEnabled: true,
      });
      gameRef.current = game;

      game.setDecorationCollisions(environment.getRockCollisions());

      setLoadingProgress(72);
      setLoadingStatus('Registering game systems');
      await new Promise(resolve => setTimeout(resolve, 16));

      setLoadingProgress(75);

      // Stage 6: Creating renderers (75-85%)
      setLoadingStatus('Creating unit renderer');
      await new Promise(resolve => setTimeout(resolve, 16));

      const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;

      unitRendererRef.current = new UnitRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );

      setLoadingProgress(78);
      setLoadingStatus('Creating building renderer');
      await new Promise(resolve => setTimeout(resolve, 16));

      buildingRendererRef.current = new BuildingRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );

      setLoadingProgress(80);
      setLoadingStatus('Creating resource renderer');
      await new Promise(resolve => setTimeout(resolve, 16));

      resourceRendererRef.current = new ResourceRenderer(scene, game.world, terrain);

      if (fogOfWarEnabled) {
        setLoadingProgress(82);
        setLoadingStatus('Setting up fog of war');
        await new Promise(resolve => setTimeout(resolve, 16));

        const fogOfWar = new FogOfWar({ mapWidth, mapHeight });
        fogOfWar.setVisionSystem(game.visionSystem);
        fogOfWar.setPlayerId('player1');
        scene.add(fogOfWar.mesh);
        fogOfWarRef.current = fogOfWar;
      }

      setLoadingProgress(84);
      setLoadingStatus('Creating effects renderer');
      await new Promise(resolve => setTimeout(resolve, 16));

      const effectsRenderer = new EffectsRenderer(scene, game.eventBus);
      effectsRendererRef.current = effectsRenderer;

      const rallyPointRenderer = new RallyPointRenderer(scene, game.eventBus, game.world, 'player1');
      rallyPointRendererRef.current = rallyPointRenderer;

      setLoadingProgress(85);

      // Stage 7: Spawning entities (85-90%)
      setLoadingStatus('Spawning units and buildings');
      await new Promise(resolve => setTimeout(resolve, 16));

      spawnInitialEntities(game, CURRENT_MAP);

      setLoadingProgress(88);

      if (CURRENT_MAP.watchTowers && CURRENT_MAP.watchTowers.length > 0) {
        setLoadingStatus('Setting up watch towers');
        await new Promise(resolve => setTimeout(resolve, 16));

        game.visionSystem.setWatchTowers(CURRENT_MAP.watchTowers);
        watchTowerRendererRef.current = new WatchTowerRenderer(scene, game.visionSystem);
      }

      setLoadingProgress(90);

      // Stage 8: Initializing audio (90-95%)
      setLoadingStatus('Initializing audio system');
      await new Promise(resolve => setTimeout(resolve, 16));

      game.audioSystem.initialize(camera.camera, CURRENT_MAP.biome);

      setLoadingProgress(95);

      // Stage 9: Starting game (95-100%)
      setLoadingStatus('Starting game engine');
      await new Promise(resolve => setTimeout(resolve, 16));

      game.start();

      // Animation loop
      let lastTime = performance.now();

      const animate = (currentTime: number) => {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        const pendingMove = useGameStore.getState().pendingCameraMove;
        if (pendingMove) {
          camera.setPosition(pendingMove.x, pendingMove.y);
          useGameStore.getState().clearPendingCameraMove();
        }

        camera.update(deltaTime);

        unitRendererRef.current?.update(deltaTime / 1000);
        buildingRendererRef.current?.update();
        resourceRendererRef.current?.update();
        fogOfWarRef.current?.update();
        effectsRendererRef.current?.update(deltaTime);
        rallyPointRendererRef.current?.update();
        watchTowerRendererRef.current?.update(deltaTime);

        const gameTime = gameRef.current?.getGameTime() ?? 0;
        environmentRef.current?.update(deltaTime / 1000, gameTime);

        useGameStore.getState().setGameTime(gameTime);

        const pos = camera.getPosition();
        useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());

        renderer.render(scene, camera.camera);

        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);

      const handleResize = () => {
        if (!renderer || !camera) return;
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.camera.aspect = window.innerWidth / window.innerHeight;
        camera.camera.updateProjectionMatrix();
      };

      window.addEventListener('resize', handleResize);

      setLoadingProgress(98);
    };

    // Store cleanup function in ref
    const cleanupRef = { current: () => {} };

    // Wrapper to track cleanup
    const wrappedInit = async () => {
      await initializeGame();

      // Set up cleanup after initialization
      cleanupRef.current = () => {
        if (rendererRef.current) rendererRef.current.dispose();
        if (environmentRef.current) environmentRef.current.dispose();
        fogOfWarRef.current?.dispose();
        effectsRendererRef.current?.dispose();
        rallyPointRendererRef.current?.dispose();
        watchTowerRendererRef.current?.dispose();
        cameraRef.current?.dispose();
        unitRendererRef.current?.dispose();
        buildingRendererRef.current?.dispose();
        resourceRendererRef.current?.dispose();
        if (gameRef.current) {
          gameRef.current.audioSystem.dispose();
          Game.resetInstance();
        }
      };
    };

    wrappedInit();

    // Return cleanup function
    return () => {
      cleanupRef.current();
    };
  }, []);

  // Handle mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left click - start selection, place building, attack-move, or patrol
      if (isAttackMove) {
        // Attack-move command (supports shift-click queuing)
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          if (selectedUnits.length > 0) {
            // Check if clicking on an enemy to target them specifically
            const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);
            const selectable = clickedEntity?.entity.get<Selectable>('Selectable');
            const health = clickedEntity?.entity.get<Health>('Health');

            if (clickedEntity && selectable && selectable.playerId !== 'player1' && health && !health.isDead()) {
              // Attack specific enemy target
              gameRef.current.eventBus.emit('command:attack', {
                entityIds: selectedUnits,
                targetEntityId: clickedEntity.entity.id,
                queue: e.shiftKey,
              });
            } else {
              // Attack-move to ground position
              gameRef.current.eventBus.emit('command:attack', {
                entityIds: selectedUnits,
                targetPosition: { x: worldPos.x, y: worldPos.z },
                queue: e.shiftKey,
              });
            }
          }
        }
        if (!e.shiftKey) setIsAttackMove(false);
      } else if (isPatrolMode) {
        // Patrol command
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
        // Ability targeting mode - cast ability at clicked position/target
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          // Check if clicking on an entity (for unit-targeted abilities)
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
        // Place building
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          // Pass the selected worker ID so the specific SCV that triggered the build is assigned
          const selectedUnits = useGameStore.getState().selectedUnits;
          gameRef.current.eventBus.emit('building:place', {
            buildingType,
            position: { x: worldPos.x, y: worldPos.z },
            workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
          });
          useGameStore.getState().setBuildingMode(null);
        }
      } else {
        // Start selection box
        setIsSelecting(true);
        setSelectionStart({ x: e.clientX, y: e.clientY });
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      }
    } else if (e.button === 2) {
      // Right click - issue move command, set rally, or cancel attack-move/patrol
      if (isAttackMove) {
        setIsAttackMove(false);
        return;
      }
      if (isPatrolMode) {
        setIsPatrolMode(false);
        return;
      }

      const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
      if (worldPos && gameRef.current) {
        const selectedUnits = useGameStore.getState().selectedUnits;

        // If in rally point mode, set rally point for selected buildings
        if (isSettingRallyPoint) {
          // Check if clicking on a resource to enable auto-gather for newly spawned workers
          const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);
          const resourceTarget = clickedEntity?.entity.get<Resource>('Resource') ? clickedEntity.entity.id : undefined;

          for (const buildingId of selectedUnits) {
            gameRef.current.eventBus.emit('rally:set', {
              buildingId,
              x: worldPos.x,
              y: worldPos.z,
              targetId: resourceTarget,
            });
          }
          useGameStore.getState().setRallyPointMode(false);
          return;
        }

        if (selectedUnits.length > 0) {
          // Shift-click queues the command
          const queue = e.shiftKey;

          // Smart right-click: detect what we clicked on
          const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);

          if (clickedEntity) {
            const resource = clickedEntity.entity.get<Resource>('Resource');
            const selectable = clickedEntity.entity.get<Selectable>('Selectable');
            const health = clickedEntity.entity.get<Health>('Health');

            // Check if clicking on a resource (for gathering)
            if (resource) {
              // Check if any selected units are workers
              const hasWorkers = selectedUnits.some((id) => {
                const entity = gameRef.current!.world.getEntity(id);
                const unit = entity?.get<Unit>('Unit');
                return unit?.isWorker;
              });

              if (hasWorkers) {
                // Issue gather command (queue if shift held)
                gameRef.current.eventBus.emit('command:gather', {
                  entityIds: selectedUnits,
                  targetEntityId: clickedEntity.entity.id,
                  queue,
                });
                return;
              }
            }

            // Check if clicking on an enemy unit/building (for attacking)
            if (selectable && selectable.playerId !== 'player1' && health && !health.isDead()) {
              gameRef.current.eventBus.emit('command:attack', {
                entityIds: selectedUnits,
                targetEntityId: clickedEntity.entity.id,
                queue,
              });
              return;
            }
          }

          // Default: move command (queue if shift held)
          gameRef.current.eventBus.emit('command:move', {
            entityIds: selectedUnits,
            targetPosition: { x: worldPos.x, y: worldPos.z },
            queue,
          });
        }
      }
    }
  }, [isBuilding, buildingType, isAttackMove, isPatrolMode, isSettingRallyPoint, abilityTargetMode]);

  // Helper function to find entity at world position
  const findEntityAtPosition = (game: Game, x: number, z: number): { entity: ReturnType<typeof game.world.getEntity> extends infer T ? NonNullable<T> : never } | null => {
    const clickRadius = 1.5;

    // Check resources first
    const resources = game.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
        return { entity };
      }
    }

    // Check units
    const units = game.world.getEntitiesWith('Unit', 'Transform', 'Health');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
        return { entity };
      }
    }

    // Check buildings
    const buildings = game.world.getEntitiesWith('Building', 'Transform', 'Health');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < 4) { // Buildings are larger
        return { entity };
      }
    }

    return null;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSelecting) {
      setSelectionEnd({ x: e.clientX, y: e.clientY });
    }
  }, [isSelecting]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && isSelecting) {
      setIsSelecting(false);

      // Calculate world coordinates for selection box
      const camera = cameraRef.current;
      const game = gameRef.current;

      if (camera && game) {
        const start = camera.screenToWorld(selectionStart.x, selectionStart.y);
        const end = camera.screenToWorld(selectionEnd.x, selectionEnd.y);

        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.z - start.z);

        if (dx > 1 || dy > 1) {
          // Box selection
          game.eventBus.emit('selection:box', {
            startX: Math.min(start.x, end.x),
            startY: Math.min(start.z, end.z),
            endX: Math.max(start.x, end.x),
            endY: Math.max(start.z, end.z),
            additive: e.shiftKey,
            playerId: 'player1',
          });
        } else {
          // Click selection
          game.eventBus.emit('selection:click', {
            x: end.x,
            y: end.z,
            additive: e.shiftKey,
            selectAllOfType: e.ctrlKey, // Ctrl+click to select all of same type
            playerId: 'player1',
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      const camera = cameraRef.current;
      if (!game) return;

      // F1 - Select idle worker
      if (e.key === 'F1') {
        e.preventDefault();
        const workers = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
        const idleWorkers: Array<{ id: number; x: number; y: number }> = [];

        for (const entity of workers) {
          const unit = entity.get<Unit>('Unit')!;
          const transform = entity.get<Transform>('Transform')!;
          const selectable = entity.get<Selectable>('Selectable')!;

          if (unit.isWorker && unit.state === 'idle' && selectable.playerId === 'player1') {
            idleWorkers.push({ id: entity.id, x: transform.x, y: transform.y });
          }
        }

        if (idleWorkers.length > 0) {
          const worker = idleWorkers[0];
          useGameStore.getState().selectUnits([worker.id]);
          if (camera) {
            camera.setPosition(worker.x, worker.y);
          }
        }
        return;
      }

      // Camera location hotkeys (F5-F8)
      if (e.key >= 'F5' && e.key <= 'F8') {
        e.preventDefault();
        const slot = e.key; // 'F5', 'F6', 'F7', 'F8'
        if (camera) {
          if (e.ctrlKey) {
            // Save camera location
            camera.saveLocation(slot);
          } else {
            // Recall camera location
            camera.recallLocation(slot);
          }
        }
        return;
      }

      // Tab - cycle through unit subgroups
      if (e.key === 'Tab') {
        e.preventDefault();
        const selectedUnits = useGameStore.getState().selectedUnits;
        if (selectedUnits.length > 0) {
          // Group units by type
          const unitsByType = new Map<string, number[]>();
          for (const id of selectedUnits) {
            const entity = game.world.getEntity(id);
            const unit = entity?.get<Unit>('Unit');
            if (unit) {
              const type = unit.unitId;
              if (!unitsByType.has(type)) {
                unitsByType.set(type, []);
              }
              unitsByType.get(type)!.push(id);
            }
          }

          // Get unique types and cycle
          const types = Array.from(unitsByType.keys());
          if (types.length > 1) {
            subgroupIndexRef.current = (subgroupIndexRef.current + 1) % types.length;
            const typeToSelect = types[subgroupIndexRef.current];
            const unitsOfType = unitsByType.get(typeToSelect) || [];
            useGameStore.getState().selectUnits(unitsOfType);
          }
        }
        return;
      }

      // Control groups with double-tap detection
      if (e.ctrlKey && e.key >= '0' && e.key <= '9') {
        const group = parseInt(e.key);
        const selectedUnits = useGameStore.getState().selectedUnits;

        if (selectedUnits.length > 0) {
          game.eventBus.emit('selection:controlGroup:set', {
            group,
            entityIds: selectedUnits,
          });
        }
      } else if (!e.ctrlKey && !e.altKey && e.key >= '0' && e.key <= '9') {
        const group = parseInt(e.key);
        const now = Date.now();

        // Check for double-tap (within 300ms)
        if (lastControlGroupTap.current &&
            lastControlGroupTap.current.group === group &&
            now - lastControlGroupTap.current.time < 300) {
          // Double-tap: center camera on control group
          const groupUnits = useGameStore.getState().getControlGroup(group);
          if (groupUnits.length > 0 && camera) {
            // Get average position of units in group
            let avgX = 0, avgZ = 0;
            let count = 0;
            for (const id of groupUnits) {
              const entity = game.world.getEntity(id);
              const transform = entity?.get<Transform>('Transform');
              if (transform) {
                avgX += transform.x;
                avgZ += transform.y;
                count++;
              }
            }
            if (count > 0) {
              camera.setPosition(avgX / count, avgZ / count);
            }
          }
          lastControlGroupTap.current = null;
        } else {
          // Single tap: select control group
          game.eventBus.emit('selection:controlGroup:get', { group });
          lastControlGroupTap.current = { group, time: now };
        }
        return;
      }

      // Commands
      switch (e.key.toLowerCase()) {
        case 'a':
          // Attack move - enable attack cursor
          if (useGameStore.getState().selectedUnits.length > 0) {
            setIsAttackMove(true);
            setIsPatrolMode(false);
          }
          break;
        case 'p':
          // Patrol mode
          if (useGameStore.getState().selectedUnits.length > 0) {
            setIsPatrolMode(true);
            setIsAttackMove(false);
          }
          break;
        case 's':
          // Stop
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'STOP',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'h':
          // Hold position
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'HOLD',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'escape':
          // Cancel modes or clear selection
          if (isAttackMove) {
            setIsAttackMove(false);
          } else if (isPatrolMode) {
            setIsPatrolMode(false);
          } else if (isSettingRallyPoint) {
            useGameStore.getState().setRallyPointMode(false);
          } else if (abilityTargetMode) {
            useGameStore.getState().setAbilityTargetMode(null);
          } else if (isBuilding) {
            useGameStore.getState().setBuildingMode(null);
          } else {
            game.eventBus.emit('selection:clear');
          }
          break;
        case 'r':
          // Rally point shortcut for buildings
          {
            const store = useGameStore.getState();
            if (store.selectedUnits.length > 0) {
              store.setRallyPointMode(true);
            }
          }
          break;
        case '?':
          // Toggle keyboard shortcuts panel
          {
            const store = useGameStore.getState();
            store.setShowKeyboardShortcuts(!store.showKeyboardShortcuts);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBuilding, isAttackMove, isPatrolMode, isSettingRallyPoint, abilityTargetMode]);

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

      <canvas ref={canvasRef} className="w-full h-full" />

      {isSelecting && (
        <SelectionBox
          startX={selectionStart.x}
          startY={selectionStart.y}
          endX={selectionEnd.x}
          endY={selectionEnd.y}
        />
      )}

      {isBuilding && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-void-600">
          <span className="text-void-300">
            Placing {buildingType} - Click to place, ESC to cancel
          </span>
        </div>
      )}

      {isAttackMove && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-red-600">
          <span className="text-red-400">
            Attack-Move - Click target, ESC to cancel
          </span>
        </div>
      )}

      {isSettingRallyPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-green-600">
          <span className="text-green-400">
            Set Rally Point - Right-click to set, ESC to cancel
          </span>
        </div>
      )}

      {isPatrolMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-yellow-600">
          <span className="text-yellow-400">
            Patrol Mode - Click destination, ESC to cancel
          </span>
        </div>
      )}

      {abilityTargetMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-purple-600">
          <span className="text-purple-400">
            Select Target - Click location, ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
}
