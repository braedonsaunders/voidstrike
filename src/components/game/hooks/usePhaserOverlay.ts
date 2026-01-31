/**
 * usePhaserOverlay Hook
 *
 * Manages the Phaser 4 overlay canvas lifecycle including game initialization,
 * scene setup, loop worker for background tab immunity, and resize handling.
 */

import type { MutableRefObject, RefObject } from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import * as Phaser from 'phaser';

import type { WorkerBridge } from '@/engine/workers';
import type { EnvironmentManager } from '@/rendering/EnvironmentManager';
import { OverlayScene } from '@/phaser/scenes/OverlayScene';
import { debugInitialization } from '@/utils/debugLogger';

export interface UsePhaserOverlayProps {
  /** Container ref for sizing */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Phaser container element ref */
  phaserContainerRef: RefObject<HTMLDivElement | null>;
  /** Worker bridge for event bus access */
  workerBridgeRef: MutableRefObject<WorkerBridge | null>;
  /** Environment manager for terrain height function */
  environmentRef: MutableRefObject<EnvironmentManager | null>;
}

export interface UsePhaserOverlayReturn {
  /** Reference to the Phaser game instance */
  phaserGameRef: MutableRefObject<Phaser.Game | null>;
  /** Reference to the overlay scene */
  overlaySceneRef: MutableRefObject<OverlayScene | null>;
  /** Whether Phaser is initialized */
  isInitialized: boolean;
  /** Initialize the Phaser overlay */
  initializePhaserOverlay: () => void;
}

export function usePhaserOverlay({
  containerRef,
  phaserContainerRef,
  workerBridgeRef,
  environmentRef,
}: UsePhaserOverlayProps): UsePhaserOverlayReturn {
  // Refs
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const overlaySceneRef = useRef<OverlayScene | null>(null);
  const phaserLoopWorkerRef = useRef<Worker | null>(null);
  const lastPhaserUpdateTimeRef = useRef<number>(0);

  // State
  const [isInitialized, setIsInitialized] = useState(false);

  // Handle Phaser resize
  const handlePhaserResize = useCallback(() => {
    if (phaserGameRef.current) {
      const phaserWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const phaserHeight = containerRef.current?.clientHeight ?? window.innerHeight;
      phaserGameRef.current.scale.resize(phaserWidth, phaserHeight);
    }
  }, [containerRef]);

  // Initialize Phaser overlay
  const initializePhaserOverlay = useCallback(() => {
    const eventBus = workerBridgeRef.current?.eventBus;

    if (!phaserContainerRef.current || !eventBus) {
      debugInitialization.warn('[usePhaserOverlay] Cannot initialize - missing container or eventBus');
      return;
    }

    if (phaserGameRef.current) {
      debugInitialization.log('[usePhaserOverlay] Already initialized');
      return;
    }

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

      if (environmentRef.current) {
        const terrain = environmentRef.current.terrain;
        scene.setTerrainHeightFunction((x, z) => terrain.getHeightAt(x, z));
      }

      // Start game logic after countdown completes (runs in worker)
      eventBus.once('game:countdownComplete', () => {
        workerBridgeRef.current?.start();
      });

      // Initialize Phaser loop worker for background tab immunity (ES module for Next.js 16+ Turbopack)
      try {
        const worker = new Worker(new URL('../../../workers/phaserLoopWorker.ts', import.meta.url), { type: 'module' });

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
        debugInitialization.warn('[usePhaserOverlay] Phaser loop worker failed to initialize:', err);
      }

      setIsInitialized(true);
    });
  }, [containerRef, phaserContainerRef, workerBridgeRef, environmentRef]);

  // Handle resize events
  useEffect(() => {
    if (!isInitialized) return;

    window.addEventListener('resize', handlePhaserResize);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(handlePhaserResize);
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handlePhaserResize);
      resizeObserver?.disconnect();
    };
  }, [isInitialized, handlePhaserResize, containerRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop Phaser loop worker
      if (phaserLoopWorkerRef.current) {
        phaserLoopWorkerRef.current.postMessage({ type: 'stop' });
        phaserLoopWorkerRef.current.terminate();
        phaserLoopWorkerRef.current = null;
      }

      phaserGameRef.current?.destroy(true);
      phaserGameRef.current = null;
      overlaySceneRef.current = null;
    };
  }, []);

  return {
    phaserGameRef,
    overlaySceneRef,
    isInitialized,
    initializePhaserOverlay,
  };
}
