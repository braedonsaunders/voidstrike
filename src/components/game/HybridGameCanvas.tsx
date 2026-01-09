'use client';

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
import { SC2SelectionSystem } from '@/rendering/SC2SelectionSystem';
import { SC2ParticleSystem } from '@/rendering/SC2ParticleSystem';
import { SC2PostProcessing } from '@/rendering/SC2PostProcessing';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore } from '@/store/gameSetupStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { Resource } from '@/engine/components/Resource';
import { Unit } from '@/engine/components/Unit';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Building } from '@/engine/components/Building';
import AssetManager from '@/assets/AssetManager';
import { OverlayScene } from '@/phaser/scenes/OverlayScene';

/**
 * HYBRID GAME CANVAS
 *
 * This component combines:
 * - Three.js for the 3D game world (terrain, units, buildings, 3D effects)
 * - Phaser 4 for the 2D overlay (tactical view, screen effects, alerts)
 *
 * Architecture:
 * ┌────────────────────────────────────────┐
 * │         Phaser 4 Overlay Canvas        │  <- Top layer (transparent)
 * │  (tactical view, alerts, screen FX)    │
 * ├────────────────────────────────────────┤
 * │          Three.js 3D Canvas            │  <- Bottom layer
 * │  (terrain, units, buildings, 3D FX)    │
 * └────────────────────────────────────────┘
 */

// Map reference - loaded dynamically from store
let CURRENT_MAP: MapData = DEFAULT_MAP;

export function HybridGameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js refs
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const placementPreviewRef = useRef<BuildingPlacementPreview | null>(null);
  const environmentRef = useRef<EnvironmentManager | null>(null);

  // SC2-level visual systems
  const selectionSystemRef = useRef<SC2SelectionSystem | null>(null);
  const particleSystemRef = useRef<SC2ParticleSystem | null>(null);
  const postProcessingRef = useRef<SC2PostProcessing | null>(null);

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

  // Control group tracking
  const lastControlGroupTap = useRef<{ group: number; time: number } | null>(null);
  const subgroupIndexRef = useRef(0);

  const { isBuilding, buildingType, isSettingRallyPoint, abilityTargetMode } = useGameStore();

  // Initialize both Three.js and Phaser
  useEffect(() => {
    if (!containerRef.current || !threeCanvasRef.current || !phaserContainerRef.current) return;

    const initializeGame = async () => {
      // Load selected map from store
      const selectedMapId = useGameSetupStore.getState().selectedMapId;
      CURRENT_MAP = getMapById(selectedMapId) || DEFAULT_MAP;
      console.log(`[HybridGameCanvas] Loading map: ${CURRENT_MAP.name} (${CURRENT_MAP.id})`);

      setLoadingStatus('Loading 3D models');
      setLoadingProgress(10);

      await AssetManager.loadCustomModels();
      setLoadingProgress(50);

      setLoadingStatus('Initializing 3D world');
      setLoadingProgress(60);

      // Initialize Three.js world
      initializeThreeJS();

      setLoadingStatus('Initializing overlay system');
      setLoadingProgress(80);

      // Initialize Phaser overlay
      initializePhaserOverlay();

      setLoadingProgress(100);
      setLoadingStatus('Ready');

      await new Promise(resolve => setTimeout(resolve, 300));
      setIsLoading(false);
    };

    const initializeThreeJS = () => {
      if (!threeCanvasRef.current) return;

      // Create renderer with SC2-level quality settings
      const renderer = new THREE.WebGLRenderer({
        canvas: threeCanvasRef.current,
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
      });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      // Enable local clipping for construction animations
      renderer.localClippingEnabled = true;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;

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

      // Start at player spawn
      const playerSpawn = CURRENT_MAP.spawns.find(s => s.playerSlot === 1) || CURRENT_MAP.spawns[0];
      camera.setPosition(playerSpawn.x, playerSpawn.y);
      cameraRef.current = camera;

      // Create environment
      const environment = new EnvironmentManager(scene, CURRENT_MAP);
      environmentRef.current = environment;
      const terrain = environment.terrain;

      camera.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));

      // Create terrain grid
      const grid = new TerrainGrid(mapWidth, mapHeight, 1);
      scene.add(grid.mesh);

      // Initialize game engine
      const game = Game.getInstance({
        mapWidth,
        mapHeight,
        tickRate: 20,
        isMultiplayer: false,
        playerId: 'player1',
        aiEnabled: true,
      });
      gameRef.current = game;

      // Set terrain grid for building placement validation
      game.setTerrainGrid(CURRENT_MAP.terrain);

      // Pass decoration collision data to game for building placement validation
      game.setDecorationCollisions(environment.getRockCollisions());

      const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;

      // Create renderers
      unitRendererRef.current = new UnitRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );
      buildingRendererRef.current = new BuildingRenderer(
        scene,
        game.world,
        fogOfWarEnabled ? game.visionSystem : undefined,
        terrain
      );
      resourceRendererRef.current = new ResourceRenderer(scene, game.world, terrain);

      if (fogOfWarEnabled) {
        const fogOfWar = new FogOfWar({ mapWidth, mapHeight });
        fogOfWar.setVisionSystem(game.visionSystem);
        fogOfWar.setPlayerId('player1');
        scene.add(fogOfWar.mesh);
        fogOfWarRef.current = fogOfWar;
      }

      effectsRendererRef.current = new EffectsRenderer(scene, game.eventBus);
      rallyPointRendererRef.current = new RallyPointRenderer(
        scene,
        game.eventBus,
        game.world,
        'player1',
        (x, y) => terrain.getHeightAt(x, y)
      );

      // Building placement preview (SC2-style grid + ghost)
      placementPreviewRef.current = new BuildingPlacementPreview(
        CURRENT_MAP,
        (x, y) => terrain.getHeightAt(x, y)
      );
      // Set up vespene geyser checker for refinery placement
      placementPreviewRef.current.setVespeneGeyserChecker((x, y) => {
        const resources = game.world.getEntitiesWith('Resource', 'Transform');
        const searchRadius = 1.5; // Must be placed directly on top of geyser
        for (const entity of resources) {
          const resource = entity.get<Resource>('Resource');
          if (resource?.resourceType !== 'vespene') continue;
          if (resource.hasRefinery()) continue; // Skip geysers that already have a refinery
          const transform = entity.get<Transform>('Transform');
          if (!transform) continue;
          const dx = Math.abs(transform.x - x);
          const dy = Math.abs(transform.y - y);
          if (dx <= searchRadius && dy <= searchRadius) {
            return true;
          }
        }
        return false;
      });
      scene.add(placementPreviewRef.current.group);

      // Initialize SC2-level visual systems
      selectionSystemRef.current = new SC2SelectionSystem(scene);
      particleSystemRef.current = new SC2ParticleSystem(scene);
      // PERFORMANCE: Post-processing disabled by default for M1/low-end devices
      // Can be enabled via settings for high-end devices
      const enablePostProcessing = false; // TODO: Add to game settings
      if (enablePostProcessing) {
        postProcessingRef.current = new SC2PostProcessing(renderer, scene, camera.camera);
      }

      // Hook particle system to combat events
      game.eventBus.on('combat:attack', (data: {
        attackerPos?: { x: number; y: number };
        targetPos?: { x: number; y: number };
        damageType?: string;
      }) => {
        if (data.attackerPos && data.targetPos && particleSystemRef.current) {
          const startPos = new THREE.Vector3(data.attackerPos.x, 0.5, data.attackerPos.y);
          const endPos = new THREE.Vector3(data.targetPos.x, 0.5, data.targetPos.y);
          const direction = endPos.clone().sub(startPos).normalize();

          // Muzzle flash
          particleSystemRef.current.spawnMuzzleFlash(startPos, direction);

          // Impact effect based on damage type
          if (data.damageType === 'psionic') {
            particleSystemRef.current.spawnImpact(endPos, 'energy');
          } else {
            particleSystemRef.current.spawnImpact(endPos, 'normal');
          }
        }
      });

      game.eventBus.on('unit:died', (data: { position?: { x: number; y: number } }) => {
        if (data.position && particleSystemRef.current) {
          const pos = new THREE.Vector3(data.position.x, 0.5, data.position.y);
          particleSystemRef.current.spawnDeathEffect(pos, 1);
        }
      });

      // Spawn entities
      spawnInitialEntities(game, CURRENT_MAP);

      // Initialize watch towers from map data
      if (CURRENT_MAP.watchTowers && CURRENT_MAP.watchTowers.length > 0) {
        game.visionSystem.setWatchTowers(CURRENT_MAP.watchTowers);
        // Create watch tower renderer for visual effects
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
        const prevTime = lastTime; // Save for throttle check
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

        // Update SC2 visual systems
        selectionSystemRef.current?.update(deltaTime);
        particleSystemRef.current?.update(deltaTime);

        // Update SC2 selection rings for selected units
        const selectedUnits = useGameStore.getState().selectedUnits;
        const game = gameRef.current;
        if (game && selectionSystemRef.current) {
          // Create/update selection rings for selected entities
          for (const unitId of selectedUnits) {
            const entity = game.world.getEntity(unitId);
            if (entity) {
              const transform = entity.get<Transform>('Transform');
              const selectable = entity.get<Selectable>('Selectable');
              if (transform && selectable) {
                const terrainHeight = environmentRef.current?.getHeightAt(transform.x, transform.y) ?? 0;
                if (!selectionSystemRef.current['selectionRings'].has(unitId)) {
                  selectionSystemRef.current.createSelectionRing(unitId, selectable.playerId, 1);
                }
                selectionSystemRef.current.updateSelectionRing(unitId, transform.x, terrainHeight, transform.y);
              }
            }
          }
          // Remove rings for deselected units
          for (const [id] of selectionSystemRef.current['selectionRings']) {
            if (!selectedUnits.includes(id)) {
              selectionSystemRef.current.removeSelectionRing(id);
            }
          }
        }

        // PERFORMANCE: Throttle zustand store updates to reduce React re-renders
        // Only update every 100ms instead of every frame (60fps -> 10fps for store updates)
        if (deltaTime > 0 && Math.floor(currentTime / 100) !== Math.floor(prevTime / 100)) {
          useGameStore.getState().setGameTime(gameTime);
          const pos = camera.getPosition();
          useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());
        }

        // Render Three.js with post-processing
        if (postProcessingRef.current) {
          postProcessingRef.current.render();
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
        transparent: true, // Critical: transparent background to show Three.js beneath
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
            preventDefaultWheel: false, // Let Three.js handle wheel
          },
        },
      };

      const phaserGame = new Phaser.Game(config);
      phaserGameRef.current = phaserGame;

      // Start the overlay scene with event bus
      phaserGame.events.once('ready', () => {
        const scene = phaserGame.scene.getScene('OverlayScene') as OverlayScene;
        overlaySceneRef.current = scene;

        // Pass event bus to overlay scene
        if (gameRef.current) {
          phaserGame.scene.start('OverlayScene', { eventBus: gameRef.current.eventBus });
        }
      });
    };

    // Handle resize
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (rendererRef.current && cameraRef.current) {
        rendererRef.current.setSize(width, height);
        cameraRef.current.camera.aspect = width / height;
        cameraRef.current.camera.updateProjectionMatrix();
      }

      // Update post-processing for new size
      postProcessingRef.current?.setSize(width, height);

      if (phaserGameRef.current) {
        phaserGameRef.current.scale.resize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);

    initializeGame();

    return () => {
      window.removeEventListener('resize', handleResize);

      // Cleanup Three.js
      rendererRef.current?.dispose();
      environmentRef.current?.dispose();
      fogOfWarRef.current?.dispose();
      effectsRendererRef.current?.dispose();
      rallyPointRendererRef.current?.dispose();
      watchTowerRendererRef.current?.dispose();
      cameraRef.current?.dispose();
      unitRendererRef.current?.dispose();
      buildingRendererRef.current?.dispose();
      resourceRendererRef.current?.dispose();

      // Cleanup SC2 systems
      selectionSystemRef.current?.dispose();
      particleSystemRef.current?.dispose();
      postProcessingRef.current?.dispose();

      // Cleanup Phaser
      phaserGameRef.current?.destroy(true);

      // Cleanup game engine
      if (gameRef.current) {
        gameRef.current.audioSystem.dispose();
        Game.resetInstance();
      }
    };
  }, []);

  // Mouse handlers
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
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          const selectedUnits = useGameStore.getState().selectedUnits;
          gameRef.current.eventBus.emit('building:place', {
            buildingType,
            position: { x: worldPos.x, y: worldPos.z },
            workerId: selectedUnits.length > 0 ? selectedUnits[0] : undefined,
          });
          useGameStore.getState().setBuildingMode(null);
        }
      } else {
        setIsSelecting(true);
        setSelectionStart({ x: e.clientX, y: e.clientY });
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      }
    } else if (e.button === 2) {
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

        if (isSettingRallyPoint) {
          for (const buildingId of selectedUnits) {
            gameRef.current.eventBus.emit('rally:set', {
              buildingId,
              x: worldPos.x,
              y: worldPos.z,
            });
          }
          useGameStore.getState().setRallyPointMode(false);
          return;
        }

        if (selectedUnits.length > 0) {
          const queue = e.shiftKey;
          const clickedEntity = findEntityAtPosition(gameRef.current, worldPos.x, worldPos.z);

          // Check if selected entities are BUILDINGS (for rally point)
          const selectedBuildings: number[] = [];
          const selectedUnitEntities: number[] = [];

          for (const id of selectedUnits) {
            const entity = gameRef.current.world.getEntity(id);
            if (!entity) continue;

            const building = entity.get<Building>('Building');
            const unit = entity.get<Unit>('Unit');

            if (building && building.canProduce && building.canProduce.length > 0) {
              selectedBuildings.push(id);
            } else if (unit) {
              selectedUnitEntities.push(id);
            }
          }

          // If ONLY production buildings are selected, set rally point
          if (selectedBuildings.length > 0 && selectedUnitEntities.length === 0) {
            for (const buildingId of selectedBuildings) {
              gameRef.current.eventBus.emit('rally:set', {
                buildingId,
                x: worldPos.x,
                y: worldPos.z,
              });
            }
            return;
          }

          if (clickedEntity) {
            const resource = clickedEntity.entity.get<Resource>('Resource');
            const selectable = clickedEntity.entity.get<Selectable>('Selectable');
            const health = clickedEntity.entity.get<Health>('Health');

            if (resource) {
              const hasWorkers = selectedUnits.some((id) => {
                const entity = gameRef.current!.world.getEntity(id);
                const unit = entity?.get<Unit>('Unit');
                return unit?.isWorker;
              });

              if (hasWorkers) {
                gameRef.current.eventBus.emit('command:gather', {
                  entityIds: selectedUnits,
                  targetEntityId: clickedEntity.entity.id,
                  queue,
                });
                return;
              }
            }

            if (selectable && selectable.playerId !== 'player1' && health && !health.isDead()) {
              gameRef.current.eventBus.emit('command:attack', {
                entityIds: selectedUnits,
                targetEntityId: clickedEntity.entity.id,
                queue,
              });
              return;
            }
          }

          gameRef.current.eventBus.emit('command:move', {
            entityIds: selectedUnits,
            targetPosition: { x: worldPos.x, y: worldPos.z },
            queue,
          });
        }
      }
    }
  }, [isBuilding, buildingType, isAttackMove, isPatrolMode, isSettingRallyPoint, abilityTargetMode]);

  // Handle building placement preview start/stop
  useEffect(() => {
    if (placementPreviewRef.current) {
      if (isBuilding && buildingType) {
        placementPreviewRef.current.startPlacement(buildingType);
      } else {
        placementPreviewRef.current.stopPlacement();
      }
    }
  }, [isBuilding, buildingType]);

  const findEntityAtPosition = (game: Game, x: number, z: number) => {
    const clickRadius = 1.5;

    const resources = game.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
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
      if (dx * dx + dy * dy < clickRadius * clickRadius) {
        return { entity };
      }
    }

    const buildings = game.world.getEntitiesWith('Building', 'Transform', 'Health');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;
      if (health.isDead()) continue;
      const dx = transform.x - x;
      const dy = transform.y - z;
      if (dx * dx + dy * dy < 4) {
        return { entity };
      }
    }

    return null;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSelecting) {
      setSelectionEnd({ x: e.clientX, y: e.clientY });
    }

    // Update building placement preview position
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
            playerId: 'player1',
          });
        } else {
          game.eventBus.emit('selection:click', {
            x: end.x,
            y: end.z,
            additive: e.shiftKey,
            selectAllOfType: e.ctrlKey,
            playerId: 'player1',
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      const camera = cameraRef.current;
      if (!game) return;

      if (e.key === 'F1') {
        e.preventDefault();
        const workers = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
        for (const entity of workers) {
          const unit = entity.get<Unit>('Unit')!;
          const transform = entity.get<Transform>('Transform')!;
          const selectable = entity.get<Selectable>('Selectable')!;

          if (unit.isWorker && unit.state === 'idle' && selectable.playerId === 'player1') {
            useGameStore.getState().selectUnits([entity.id]);
            if (camera) {
              camera.setPosition(transform.x, transform.y);
            }
            break;
          }
        }
        return;
      }

      if (e.key >= 'F5' && e.key <= 'F8') {
        e.preventDefault();
        if (camera) {
          if (e.ctrlKey) {
            camera.saveLocation(e.key);
          } else {
            camera.recallLocation(e.key);
          }
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const selectedUnits = useGameStore.getState().selectedUnits;
        if (selectedUnits.length > 0) {
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

        if (lastControlGroupTap.current &&
            lastControlGroupTap.current.group === group &&
            now - lastControlGroupTap.current.time < 300) {
          const groupUnits = useGameStore.getState().getControlGroup(group);
          if (groupUnits.length > 0 && camera) {
            let avgX = 0, avgZ = 0, count = 0;
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
          game.eventBus.emit('selection:controlGroup:get', { group });
          lastControlGroupTap.current = { group, time: now };
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          if (useGameStore.getState().selectedUnits.length > 0) {
            setIsAttackMove(true);
            setIsPatrolMode(false);
          }
          break;
        case 'p':
          if (useGameStore.getState().selectedUnits.length > 0) {
            setIsPatrolMode(true);
            setIsAttackMove(false);
          }
          break;
        case 's':
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'STOP',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'h':
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'HOLD',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'escape':
          if (isAttackMove) setIsAttackMove(false);
          else if (isPatrolMode) setIsPatrolMode(false);
          else if (isSettingRallyPoint) useGameStore.getState().setRallyPointMode(false);
          else if (abilityTargetMode) useGameStore.getState().setAbilityTargetMode(null);
          else if (isBuilding) useGameStore.getState().setBuildingMode(null);
          else game.eventBus.emit('selection:clear');
          break;
        case 'r':
          {
            const store = useGameStore.getState();
            if (store.selectedUnits.length > 0) {
              store.setRallyPointMode(true);
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

      {/* Three.js canvas (bottom layer - 3D world) */}
      <canvas
        ref={threeCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />

      {/* Phaser overlay container (top layer - 2D effects) */}
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

      {abilityTargetMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-purple-600 z-20">
          <span className="text-purple-400">
            Select Target - Click location, ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
}
