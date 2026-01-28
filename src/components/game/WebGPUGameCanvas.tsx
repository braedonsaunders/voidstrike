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
 *
 * Game Logic Architecture (Worker Mode):
 * ┌────────────────────────────────────────┐
 * │            Web Worker                  │
 * │  (ECS, AI, Physics - NOT throttled)    │
 * │                                        │
 * │  ↓ RenderState snapshots               │
 * ├────────────────────────────────────────┤
 * │           Main Thread                  │
 * │  (Rendering, Audio, Input)             │
 * │                                        │
 * │  ↑ GameCommands (user input)           │
 * └────────────────────────────────────────┘
 *
 * This component is a thin orchestrator that delegates to specialized hooks:
 * - useWebGPURenderer: Renderer setup, scene, and game loop
 * - useGameInput: Mouse and keyboard input handling
 * - useCameraControl: Camera position management
 * - usePostProcessing: Effects pipeline and graphics settings
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import * as Phaser from 'phaser';

import { Game } from '@/engine/core/Game';
import type { EventBus } from '@/engine/core/EventBus';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import {
  WorkerBridge,
  MainThreadEventHandler,
  RenderStateWorldAdapter,
  type RenderState,
  type GameEvent,
} from '@/engine/workers';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getLocalPlayerId, isSpectatorMode, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { useMultiplayerStore, isMultiplayerMode } from '@/store/multiplayerStore';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { GraphicsOptionsPanel } from './GraphicsOptionsPanel';
import { DebugMenuPanel } from './DebugMenuPanel';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { ALL_MAPS, DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { OverlayScene } from '@/phaser/scenes/OverlayScene';
import { debugInitialization, debugNetworking } from '@/utils/debugLogger';
import AssetManager from '@/assets/AssetManager';
import { useUIStore, UIState } from '@/store/uiStore';

import { useWebGPURenderer, useGameInput, useCameraControl, usePostProcessing } from './hooks';

// Map reference
let CURRENT_MAP: MapData = DEFAULT_MAP;

export function WebGPUGameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Phaser refs
  const phaserContainerRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const overlaySceneRef = useRef<OverlayScene | null>(null);
  const phaserLoopWorkerRef = useRef<Worker | null>(null);
  const lastPhaserUpdateTimeRef = useRef<number>(0);

  // Game engine refs - worker mode is the only mode
  // Game instance is kept for selection system and placement validation
  const gameRef = useRef<Game | null>(null);
  const workerBridgeRef = useRef<WorkerBridge | null>(null);
  const eventHandlerRef = useRef<MainThreadEventHandler | null>(null);
  // Use singleton pattern for render state adapter so UI components can access it
  const renderStateAdapterRef = useRef<RenderStateWorldAdapter>(RenderStateWorldAdapter.getInstance());

  // Refs for hook consumption - these point to worker mode data sources
  const worldProviderRef = useRef<IWorldProvider | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);

  // Event listener cleanup
  const eventUnsubscribersRef = useRef<(() => void)[]>([]);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing');
  const [isWebGPU, setIsWebGPU] = useState(false);
  const [fadeInOpacity, setFadeInOpacity] = useState(1);

  // Get store state
  const {
    isBuilding,
    buildingType,
    buildingPlacementQueue,
    isSettingRallyPoint,
    isRepairMode,
    isLandingMode,
    landingBuildingId,
    abilityTargetMode,
    isWallPlacementMode,
    commandTargetMode,
  } = useGameStore();

  // Progress callback for renderer initialization
  const handleProgress = useCallback((progress: number, status: string) => {
    setLoadingProgress(progress);
    setLoadingStatus(status);
  }, []);

  // WebGPU detection callback
  const handleWebGPUDetected = useCallback((detected: boolean) => {
    setIsWebGPU(detected);
  }, []);

  // Handle render state updates from worker (only in worker mode)
  const firstRenderStateLoggedRef = useRef(false);
  const handleRenderState = useCallback((state: RenderState) => {
    // Debug: log first render state received
    if (!firstRenderStateLoggedRef.current && (state.units.length > 0 || state.buildings.length > 0 || state.resources.length > 0)) {
      console.log('[WebGPUGameCanvas] Received first render state:', {
        tick: state.tick,
        units: state.units.length,
        buildings: state.buildings.length,
        resources: state.resources.length,
      });
      firstRenderStateLoggedRef.current = true;
    }

    renderStateAdapterRef.current.updateFromRenderState(state);
    // Update game time in store
    useGameStore.getState().setGameTime(state.gameTime);
  }, []);

  // Handle game events from worker (only in worker mode)
  const handleGameEvent = useCallback((event: GameEvent) => {
    // Events are dispatched through eventBus by MainThreadEventHandler
  }, []);

  // Handle game over
  const handleGameOver = useCallback((winnerId: string | null, reason: string) => {
    debugInitialization.log(`[WebGPUGameCanvas] Game over: winner=${winnerId}, reason=${reason}`);
    // Notify UI of game over
    const message = winnerId
      ? `Game over! ${winnerId === getLocalPlayerId() ? 'Victory!' : 'Defeat!'}`
      : `Game over: ${reason}`;
    useUIStore.getState().addNotification(
      winnerId === getLocalPlayerId() ? 'success' : 'warning',
      message,
      10000
    );
  }, []);

  // Handle worker errors
  const handleWorkerError = useCallback((message: string, stack?: string) => {
    console.error('[GameWorker Error]', message, stack);
    useUIStore.getState().addNotification('error', `Game error: ${message}`, 5000);
  }, []);

  // Game time getter - uses render state adapter (synced from worker)
  const getGameTime = useCallback(() => {
    return renderStateAdapterRef.current.getGameTime();
  }, []);

  // Game finished checker - uses game state from worker
  const [isGameFinished, setIsGameFinished] = useState(false);
  const checkGameFinished = useCallback(() => {
    return isGameFinished;
  }, [isGameFinished]);

  // Initialize renderer hook
  const { refs, initializeRenderer } = useWebGPURenderer({
    canvasRef: threeCanvasRef,
    containerRef,
    gameRef,
    worldProviderRef,
    eventBusRef,
    getGameTime,
    isGameFinished: checkGameFinished,
    map: CURRENT_MAP,
    onProgress: handleProgress,
    onWebGPUDetected: handleWebGPUDetected,
  });

  // Camera control hook
  const { lastControlGroupTap } = useCameraControl({
    cameraRef: refs.camera,
    gameRef,
  });

  // Input handling hook
  const { selectionState, handleMouseDown, handleMouseMove, handleMouseUp, handleContextMenu } = useGameInput({
    containerRef,
    cameraRef: refs.camera,
    gameRef,
    worldProviderRef,
    eventBusRef,
    placementPreviewRef: refs.placementPreview,
    wallPlacementPreviewRef: refs.wallPlacementPreview,
    overlayManagerRef: refs.overlayManager,
    lastControlGroupTap,
  });

  // Post-processing hook
  usePostProcessing({
    renderContextRef: refs.renderContext,
    renderPipelineRef: refs.renderPipeline,
    sceneRef: refs.scene,
    cameraRef: refs.camera,
    environmentRef: refs.environment,
    lightPoolRef: refs.lightPool,
    fogOfWarRef: refs.fogOfWar,
    containerRef,
    map: CURRENT_MAP,
  });

  // Callback for when loading screen completes
  const handleLoadingComplete = useCallback(() => {
    setIsLoading(false);
    useGameStore.getState().setGameReady(true);

    setTimeout(() => {
      const eventBus = workerBridgeRef.current?.eventBus;
      if (eventBus) {
        eventBus.emit('game:countdown');
      }
    }, 50);

    const startTime = Date.now();
    const duration = 1000;

    const animateFadeIn = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      setFadeInOpacity(1 - eased);

      if (progress < 1) {
        requestAnimationFrame(animateFadeIn);
      }
    };

    requestAnimationFrame(animateFadeIn);
  }, []);

  // Initialize game
  useEffect(() => {
    if (!containerRef.current || !threeCanvasRef.current || !phaserContainerRef.current) return;

    const initializeGame = async () => {
      try {
        // Check for custom map first
        const customMap = useGameSetupStore.getState().customMapData;
        if (customMap) {
          CURRENT_MAP = customMap;
          debugInitialization.log(`[WebGPUGameCanvas] Loading custom/preview map: ${CURRENT_MAP.name}`);
        } else {
          const selectedMapId = useGameSetupStore.getState().selectedMapId;
          const requestedMap = getMapById(selectedMapId);
          if (requestedMap) {
            CURRENT_MAP = requestedMap;
            debugInitialization.log(`[WebGPUGameCanvas] Loading map: ${CURRENT_MAP.name} (${CURRENT_MAP.width}x${CURRENT_MAP.height})`);
          } else {
            debugInitialization.warn(`[WebGPUGameCanvas] Map '${selectedMapId}' not found in registry, falling back to default`);
            debugInitialization.log(`[WebGPUGameCanvas] Available maps:`, Object.keys(ALL_MAPS).join(', '));
            CURRENT_MAP = DEFAULT_MAP;
            debugInitialization.log(`[WebGPUGameCanvas] Fallback to map: ${CURRENT_MAP.name} (${CURRENT_MAP.width}x${CURRENT_MAP.height})`);
          }
        }

        setLoadingStatus('Loading 3D models');
        setLoadingProgress(10);

        // Wait for asset preloading
        const preloadStarted = AssetManager.isPreloadingStarted();
        if (preloadStarted) {
          setLoadingStatus('Finishing 3D model loading');
          debugInitialization.log('[WebGPUGameCanvas] Waiting for lobby preloading to complete...');
        }
        await AssetManager.waitForPreloading();
        setLoadingProgress(50);

        setLoadingStatus('Initializing WebGPU renderer');
        setLoadingProgress(60);

        // Initialize game engine
        // All game logic runs in Web Worker for anti-throttling and performance
        const mapWidth = CURRENT_MAP.width;
        const mapHeight = CURRENT_MAP.height;
        const localPlayerId = getLocalPlayerId();
        const isMultiplayer = isMultiplayerMode();

        debugInitialization.log('[WebGPUGameCanvas] Initializing game (worker mode)');

        // Create worker bridge for game logic communication
        const bridge = WorkerBridge.getInstance({
          config: {
            mapWidth,
            mapHeight,
            tickRate: 20,
            isMultiplayer,
            playerId: localPlayerId ?? 'spectator',
            aiEnabled: !isBattleSimulatorMode() && !isMultiplayer,
            aiDifficulty: 'medium',
          },
          playerId: localPlayerId ?? 'spectator',
          onRenderState: handleRenderState,
          onGameEvent: handleGameEvent,
          onGameOver: (winnerId, reason) => {
            handleGameOver(winnerId, reason);
            setIsGameFinished(true);
          },
          onError: handleWorkerError,
        });
        workerBridgeRef.current = bridge;

        // Set up refs for hook consumption
        worldProviderRef.current = renderStateAdapterRef.current;
        eventBusRef.current = bridge.eventBus;

        // Create main thread event handler for audio/effects
        const eventHandler = new MainThreadEventHandler(bridge);
        eventHandlerRef.current = eventHandler;

        // Initialize the worker
        await bridge.initialize();

        // Set terrain data on worker
        bridge.setTerrainGrid(CURRENT_MAP.terrain);

        // Multiplayer: Remote player quit
        eventUnsubscribersRef.current.push(
          bridge.eventBus.on('multiplayer:playerQuit', () => {
            debugNetworking.log('[Game] Remote player quit the game');
            useUIStore.getState().addNotification('warning', 'Remote player has left the game', 10000);
          })
        );

        // Create minimal Game instance for selection system and placement validation
        // Game loop is NOT started - worker handles game logic
        const game = Game.getInstance({
          mapWidth,
          mapHeight,
          tickRate: 20,
          isMultiplayer,
          playerId: localPlayerId ?? 'spectator',
          aiEnabled: false, // AI runs in worker
        });
        gameRef.current = game;

        // Initialize renderer (which creates all sub-renderers)
        const success = await initializeRenderer();
        if (!success) {
          debugInitialization.error('[WebGPUGameCanvas] Renderer initialization failed');
          setLoadingStatus('Error - falling back to WebGL');
          return;
        }

        // Spawn entities (skip in battle simulator)
        if (!isBattleSimulatorMode() && workerBridgeRef.current) {
          // Map player slots to the expected type format
          const playerSlots = useGameSetupStore.getState().playerSlots.map(slot => ({
            id: slot.id,
            type: (slot.type === 'open' || slot.type === 'closed') ? 'empty' as const : slot.type,
            faction: slot.faction,
            aiDifficulty: slot.aiDifficulty,
          }));
          workerBridgeRef.current.spawnInitialEntities(CURRENT_MAP, playerSlots);
        }

        // Re-set player ID on fog of war now that players are registered
        if (refs.fogOfWar.current && localPlayerId) {
          refs.fogOfWar.current.setPlayerId(localPlayerId);
        }

        // Initialize audio (via main thread event handler)
        if (eventHandlerRef.current) {
          await eventHandlerRef.current.startGameplayMusic();
        }

        setLoadingStatus('Initializing overlay system');
        setLoadingProgress(80);

        // Initialize Phaser overlay
        initializePhaserOverlay();

        setLoadingProgress(100);
        setLoadingStatus('Ready');
      } catch (error) {
        debugInitialization.error('[WebGPUGameCanvas] Initialization failed:', error);
        setLoadingStatus('Error - falling back to WebGL');
      }
    };

    const initializePhaserOverlay = () => {
      const eventBus = workerBridgeRef.current?.eventBus;

      if (!phaserContainerRef.current || !eventBus) return;

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
        // Don't include OverlayScene here - we add it manually with eventBus data
        scene: [],
        input: {
          mouse: {
            preventDefaultWheel: false,
          },
        },
      };

      const phaserGame = new Phaser.Game(config);
      phaserGameRef.current = phaserGame;

      phaserGame.events.once('ready', () => {
        // Add and start the scene with eventBus data in one call
        // This prevents the double-initialization that occurred when scene was in config
        phaserGame.scene.add('OverlayScene', OverlayScene, true, { eventBus });
        const scene = phaserGame.scene.getScene('OverlayScene') as OverlayScene;
        overlaySceneRef.current = scene;

        if (refs.environment.current) {
          const terrain = refs.environment.current.terrain;
          scene.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));
        }

        // Start game logic (runs in worker)
        setTimeout(() => {
          workerBridgeRef.current?.start();
        }, 100);

        // Initialize Phaser loop worker for background tab immunity (ES module for Next.js 16+ Turbopack)
        try {
          const worker = new Worker(new URL('../../workers/phaserLoopWorker.ts', import.meta.url), { type: 'module' });

          worker.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'tick') {
              const { time, delta } = e.data;

              if (document.hidden && phaserGameRef.current) {
                const pGame = phaserGameRef.current;
                if (pGame.loop && pGame.isRunning) {
                  pGame.loop.now = time;
                  pGame.loop.delta = delta;
                  pGame.loop.rawDelta = delta;

                  pGame.scene.scenes.forEach((s: Phaser.Scene) => {
                    if (s.sys.isActive() && s.sys.settings.status === Phaser.Scenes.RUNNING) {
                      s.sys.step(time, delta);
                    }
                  });

                  lastPhaserUpdateTimeRef.current = time;
                }
              }
            }
          };

          worker.postMessage({ type: 'start', intervalMs: 16 });
          phaserLoopWorkerRef.current = worker;
        } catch (err) {
          debugInitialization.warn('[WebGPUGameCanvas] Phaser loop worker failed to initialize:', err);
        }
      });
    };

    // Handle Phaser resize
    const handlePhaserResize = () => {
      if (phaserGameRef.current) {
        const phaserWidth = containerRef.current?.clientWidth ?? window.innerWidth;
        const phaserHeight = containerRef.current?.clientHeight ?? window.innerHeight;
        phaserGameRef.current.scale.resize(phaserWidth, phaserHeight);
      }
    };

    window.addEventListener('resize', handlePhaserResize);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(handlePhaserResize);
      resizeObserver.observe(containerRef.current);
    }

    initializeGame();

    return () => {
      // Unsubscribe from events
      for (const unsubscribe of eventUnsubscribersRef.current) {
        unsubscribe();
      }
      eventUnsubscribersRef.current = [];

      window.removeEventListener('resize', handlePhaserResize);
      resizeObserver?.disconnect();

      // Stop Phaser loop worker
      if (phaserLoopWorkerRef.current) {
        phaserLoopWorkerRef.current.postMessage({ type: 'stop' });
        phaserLoopWorkerRef.current.terminate();
        phaserLoopWorkerRef.current = null;
      }

      phaserGameRef.current?.destroy(true);

      // Cleanup worker and game resources
      if (eventHandlerRef.current) {
        eventHandlerRef.current.stopGameplayMusic();
        eventHandlerRef.current.dispose();
        eventHandlerRef.current = null;
      }
      if (workerBridgeRef.current) {
        WorkerBridge.resetInstance();
        workerBridgeRef.current = null;
      }
      RenderStateWorldAdapter.resetInstance();
      worldProviderRef.current = null;
      eventBusRef.current = null;

      if (gameRef.current) {
        Game.resetInstance();
      }
    };
  }, [initializeRenderer, refs.camera, refs.environment, refs.fogOfWar, refs.battleEffects, handleRenderState, handleGameEvent, handleGameOver, handleWorkerError]);

  // Building placement preview
  useEffect(() => {
    if (refs.placementPreview.current) {
      if (isBuilding && buildingType) {
        refs.placementPreview.current.startPlacement(buildingType);
      } else {
        refs.placementPreview.current.stopPlacement();
      }
    }
  }, [isBuilding, buildingType, refs.placementPreview]);

  // Wall placement preview
  useEffect(() => {
    if (refs.wallPlacementPreview.current) {
      if (isWallPlacementMode) {
        const wallType = useGameStore.getState().buildingType || 'wall_segment';
        refs.wallPlacementPreview.current.startPlacement(wallType);
      } else {
        refs.wallPlacementPreview.current.stopPlacement();
      }
    }
  }, [isWallPlacementMode, refs.wallPlacementPreview]);

  // Sync building placement queue
  useEffect(() => {
    if (refs.placementPreview.current) {
      refs.placementPreview.current.setQueuedPlacements(buildingPlacementQueue);
    }
  }, [buildingPlacementQueue, refs.placementPreview]);

  // Landing mode preview
  useEffect(() => {
    if (refs.placementPreview.current) {
      if (isLandingMode && landingBuildingId) {
        // Get building type from render state adapter
        const building = renderStateAdapterRef.current.getEntity(landingBuildingId);
        const buildingId = building?.get<{ buildingId: string }>('Building')?.buildingId;

        if (buildingId) {
          refs.placementPreview.current.startPlacement(buildingId);
        }
      } else if (!isBuilding) {
        refs.placementPreview.current.stopPlacement();
      }
    }
  }, [isLandingMode, landingBuildingId, isBuilding, refs.placementPreview]);

  // Subscribe to overlay settings changes
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState) => {
      const overlaySettings = state.overlaySettings;
      const prevOverlaySettings = prevState.overlaySettings;

      if (overlaySettings === prevOverlaySettings) return;

      if (refs.overlayManager.current) {
        refs.overlayManager.current.setActiveOverlay(overlaySettings.activeOverlay);

        const opacityKey = `${overlaySettings.activeOverlay}OverlayOpacity` as keyof typeof overlaySettings;
        if (opacityKey in overlaySettings && typeof overlaySettings[opacityKey] === 'number') {
          refs.overlayManager.current.setOpacity(overlaySettings[opacityKey] as number);
        }
      }
    });

    return () => unsubscribe();
  }, [refs.overlayManager]);

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

      {/* Fade-in from black overlay */}
      {!isLoading && fadeInOpacity > 0 && (
        <div
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ zIndex: 100, opacity: fadeInOpacity }}
        />
      )}

      {/* Three.js canvas */}
      <canvas ref={threeCanvasRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }} />

      {/* Phaser overlay container */}
      <div
        ref={phaserContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 10 }}
      />

      {/* Selection box */}
      {selectionState.isSelecting && (
        <SelectionBox
          startX={selectionState.selectionStart.x}
          startY={selectionState.selectionStart.y}
          endX={selectionState.selectionEnd.x}
          endY={selectionState.selectionEnd.y}
        />
      )}

      {/* Mode indicators */}
      {isBuilding && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-void-600 z-20">
          <span className="text-void-300">Placing {buildingType} - Click to place, ESC to cancel</span>
        </div>
      )}

      {commandTargetMode === 'attack' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-red-600 z-20">
          <span className="text-red-400">Attack-Move - Click canvas or minimap, ESC to cancel</span>
        </div>
      )}

      {commandTargetMode === 'move' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-blue-600 z-20">
          <span className="text-blue-400">Move - Click canvas or minimap, ESC to cancel</span>
        </div>
      )}

      {isSettingRallyPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-green-600 z-20">
          <span className="text-green-400">Set Rally Point - Right-click to set, ESC to cancel</span>
        </div>
      )}

      {commandTargetMode === 'patrol' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-yellow-600 z-20">
          <span className="text-yellow-400">Patrol Mode - Click canvas or minimap, ESC to cancel</span>
        </div>
      )}

      {isRepairMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-cyan-600 z-20">
          <span className="text-cyan-400">Repair Mode - Right-click on building or mech unit, ESC to cancel</span>
        </div>
      )}

      {abilityTargetMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-purple-600 z-20">
          <span className="text-purple-400">Select Target - Click location, ESC to cancel</span>
        </div>
      )}

      {isLandingMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-blue-600 z-20">
          <span className="text-blue-400">Landing Mode - Right-click to select landing location, ESC to cancel</span>
        </div>
      )}

      {/* Graphics Options Panel */}
      <GraphicsOptionsPanel />

      {/* Debug Menu Panel */}
      <DebugMenuPanel />
    </div>
  );
}
