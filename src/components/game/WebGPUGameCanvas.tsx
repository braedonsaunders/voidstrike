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
 */

import { useRef, useEffect, useMemo } from 'react';

import { RenderStateWorldAdapter } from '@/engine/workers';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getLocalPlayerId } from '@/store/gameSetupStore';
import { InputManager, type InputContext } from '@/engine/input';
import { SelectionBox } from './SelectionBox';
import { LoadingScreen } from './LoadingScreen';
import { GraphicsOptionsPanel } from './GraphicsOptionsPanel';
import { DebugMenuPanel } from './DebugMenuPanel';
import { ALL_MAPS, DEFAULT_MAP, MapData, getMapById } from '@/data/maps';
import { debugInitialization } from '@/utils/debugLogger';
import AssetManager from '@/assets/AssetManager';
import { useUIStore, UIState } from '@/store/uiStore';
import { getOverlayCoordinator, resetOverlayCoordinator } from '@/engine/overlay';

import {
  useWebGPURenderer,
  useGameInput,
  useCameraControl,
  usePostProcessing,
  useWorkerBridge,
  usePhaserOverlay,
  useLoadingState,
} from './hooks';

export function WebGPUGameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement>(null);
  const phaserContainerRef = useRef<HTMLDivElement>(null);
  const initializationStartedRef = useRef(false);

  const selectedMapId = useGameSetupStore((state) => state.selectedMapId);
  const customMapData = useGameSetupStore((state) => state.customMapData);
  const currentMap = useMemo<MapData>(() => {
    if (customMapData) {
      return customMapData;
    }

    const requestedMap = getMapById(selectedMapId);
    return requestedMap ?? DEFAULT_MAP;
  }, [customMapData, selectedMapId]);

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

  // Worker bridge hook - manages worker lifecycle, game instance, event bus
  const {
    workerBridgeRef,
    eventHandlerRef,
    gameRef,
    worldProviderRef,
    eventBusRef,
    isInitialized: isWorkerInitialized,
    isGameFinished,
    initializeWorkerBridge,
    spawnEntities,
    getGameTime,
  } = useWorkerBridge({
    map: currentMap,
  });

  // Loading state hook - manages loading screen, progress, fade-in
  const {
    isLoading,
    loadingProgress,
    loadingStatus,
    fadeInOpacity,
    setProgress,
    setWebGPUDetected,
    handleLoadingComplete,
  } = useLoadingState({
    eventBusRef,
  });

  // Check if game is finished
  const checkGameFinished = () => isGameFinished;

  // Initialize renderer hook
  const { refs, initializeRenderer } = useWebGPURenderer({
    canvasRef: threeCanvasRef,
    containerRef,
    gameRef,
    workerBridgeRef,
    worldProviderRef,
    eventBusRef,
    getGameTime,
    isGameFinished: checkGameFinished,
    map: currentMap,
    onProgress: setProgress,
    onWebGPUDetected: setWebGPUDetected,
  });

  // Phaser overlay hook - manages Phaser game, scene, loop worker
  const { initializePhaserOverlay } = usePhaserOverlay({
    containerRef,
    phaserContainerRef,
    workerBridgeRef,
    environmentRef: refs.environment,
  });

  // Camera control hook
  const { lastControlGroupTap } = useCameraControl({
    cameraRef: refs.camera,
    gameRef,
  });

  // Input handling hook
  const { selectionState } = useGameInput({
    containerRef,
    cameraRef: refs.camera,
    gameRef,
    worldProviderRef,
    eventBusRef,
    isGameInitialized: isWorkerInitialized,
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
    containerRef,
    map: currentMap,
  });

  // Initialize game
  useEffect(() => {
    if (!containerRef.current || !threeCanvasRef.current || !phaserContainerRef.current) return;
    if (initializationStartedRef.current) return;

    initializationStartedRef.current = true;

    const initializeGame = async () => {
      try {
        if (customMapData) {
          debugInitialization.log(
            `[WebGPUGameCanvas] Loading custom/preview map: ${currentMap.name}`
          );
        } else {
          if (getMapById(selectedMapId)) {
            debugInitialization.log(
              `[WebGPUGameCanvas] Loading map: ${currentMap.name} (${currentMap.width}x${currentMap.height})`
            );
          } else {
            debugInitialization.warn(
              `[WebGPUGameCanvas] Map '${selectedMapId}' not found in registry, falling back to default`
            );
            debugInitialization.log(
              `[WebGPUGameCanvas] Available maps:`,
              Object.keys(ALL_MAPS).join(', ')
            );
            debugInitialization.log(
              `[WebGPUGameCanvas] Fallback to map: ${currentMap.name} (${currentMap.width}x${currentMap.height})`
            );
          }
        }

        setProgress(10, 'Loading 3D models');

        // Wait for asset preloading
        const preloadStarted = AssetManager.isPreloadingStarted();
        if (preloadStarted) {
          setProgress(10, 'Finishing 3D model loading');
          debugInitialization.log('[WebGPUGameCanvas] Waiting for lobby preloading to complete...');
        }
        await AssetManager.waitForPreloading();
        setProgress(50, 'Initializing worker');

        // Initialize worker bridge (creates WorkerBridge, MainThreadEventHandler, Game)
        const workerSuccess = await initializeWorkerBridge();
        if (!workerSuccess) {
          debugInitialization.error('[WebGPUGameCanvas] Worker initialization failed');
          initializationStartedRef.current = false;
          setProgress(0, 'Error - worker initialization failed');
          return;
        }

        setProgress(60, 'Initializing WebGPU renderer');

        // Set decoration collisions from environment (after renderer creates environment)
        // Initialize renderer (which creates all sub-renderers)
        const success = await initializeRenderer();
        if (!success) {
          debugInitialization.error('[WebGPUGameCanvas] Renderer initialization failed');
          initializationStartedRef.current = false;
          setProgress(0, 'Error - falling back to WebGL');
          return;
        }

        // Set decoration collisions on game instance
        if (gameRef.current && refs.environment.current) {
          gameRef.current.setDecorationCollisions(refs.environment.current.getRockCollisions());
        }

        // Spawn entities
        setProgress(75, 'Synchronizing game state');
        await spawnEntities();

        // Re-set player ID on fog of war now that players are registered
        const localPlayerId = getLocalPlayerId();
        if (refs.fogOfWar.current && localPlayerId) {
          refs.fogOfWar.current.setPlayerId(localPlayerId);
        }

        // Initialize audio system with camera and biome, then start music
        if (eventHandlerRef.current) {
          const camera = refs.camera.current?.camera ?? undefined;
          const biome = currentMap.biome;
          await eventHandlerRef.current.initializeAudio(camera, biome);
          await eventHandlerRef.current.startGameplayMusic();
        }

        setProgress(80, 'Initializing overlay system');

        // Initialize OverlayCoordinator with renderer and event bus
        const overlayCoordinator = getOverlayCoordinator();
        if (refs.overlayManager.current) {
          overlayCoordinator.setOverlayManager(refs.overlayManager.current);
        }
        if (eventBusRef.current) {
          overlayCoordinator.setEventBus(eventBusRef.current);
        }
        overlayCoordinator.initializeFromStore();

        // Initialize Phaser overlay
        initializePhaserOverlay();

        setProgress(100, 'Ready');
      } catch (error) {
        debugInitialization.error('[WebGPUGameCanvas] Initialization failed:', error);
        initializationStartedRef.current = false;
        setProgress(0, 'Error - falling back to WebGL');
      }
    };

    initializeGame();

    return () => {
      initializationStartedRef.current = false;
      // Reset overlay coordinator
      resetOverlayCoordinator();
    };
  }, [
    currentMap,
    customMapData,
    selectedMapId,
    initializeRenderer,
    initializeWorkerBridge,
    spawnEntities,
    initializePhaserOverlay,
    setProgress,
    refs.camera,
    refs.environment,
    refs.fogOfWar,
    refs.overlayManager,
    eventBusRef,
    eventHandlerRef,
    gameRef,
  ]);

  useEffect(() => {
    const inputManager = InputManager.getInstanceSync();
    if (!inputManager) return;

    let targetContext: InputContext = 'gameplay';
    if (isWallPlacementMode) {
      targetContext = 'wall';
    } else if (isLandingMode) {
      targetContext = 'landing';
    } else if (isBuilding) {
      targetContext = 'building';
    } else if (abilityTargetMode) {
      targetContext = 'ability';
    } else if (isRepairMode) {
      targetContext = 'repair';
    } else if (isSettingRallyPoint) {
      targetContext = 'rally';
    } else if (commandTargetMode) {
      targetContext = 'command';
    }

    if (inputManager.getContext() !== targetContext) {
      inputManager.setContext(targetContext);
    }
  }, [
    abilityTargetMode,
    commandTargetMode,
    isBuilding,
    isLandingMode,
    isRepairMode,
    isSettingRallyPoint,
    isWallPlacementMode,
  ]);

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
        const building = RenderStateWorldAdapter.getInstance().getEntity(landingBuildingId);
        const buildingId = building?.get<{ buildingId: string }>('Building')?.buildingId;

        if (buildingId) {
          refs.placementPreview.current.startPlacement(buildingId);
        }
      } else if (!isBuilding) {
        refs.placementPreview.current.stopPlacement();
      }
    }
  }, [isLandingMode, landingBuildingId, isBuilding, refs.placementPreview]);

  // Sync debug settings to worker
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState) => {
      if (state.debugSettings === prevState.debugSettings) return;
      workerBridgeRef.current?.setDebugSettings(state.debugSettings);
    });

    return () => unsubscribe();
  }, [workerBridgeRef]);

  // Subscribe to overlay settings changes from UI (e.g., HUD overlay menu)
  // The OverlayCoordinator handles forwarding to TSLGameOverlayManager
  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state: UIState, prevState: UIState) => {
      const overlaySettings = state.overlaySettings;
      const prevOverlaySettings = prevState.overlaySettings;

      if (overlaySettings === prevOverlaySettings) return;

      // Use coordinator to handle all overlay changes
      const coordinator = getOverlayCoordinator();

      // Active overlay changed
      if (overlaySettings.activeOverlay !== prevOverlaySettings.activeOverlay) {
        coordinator.setActiveOverlay(overlaySettings.activeOverlay);
      }

      // Attack range visibility changed (from UI, not keyboard)
      if (overlaySettings.showAttackRange !== prevOverlaySettings.showAttackRange) {
        coordinator.setShowAttackRange(overlaySettings.showAttackRange);
      }

      // Vision range visibility changed (from UI, not keyboard)
      if (overlaySettings.showVisionRange !== prevOverlaySettings.showVisionRange) {
        coordinator.setShowVisionRange(overlaySettings.showVisionRange);
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Loading screen */}
      {isLoading && (
        <LoadingScreen
          progress={loadingProgress}
          status={loadingStatus}
          onComplete={handleLoadingComplete}
        />
      )}

      {/* Fade-in from black overlay */}
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
          <span className="text-void-300">
            Placing {buildingType} - Click to place, ESC to cancel
          </span>
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
          <span className="text-purple-400">Select Target - Click location, ESC to cancel</span>
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
