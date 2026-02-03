/**
 * useLoadingState Hook
 *
 * Manages loading screen state, progress tracking, WebGPU detection,
 * and fade-in animation after loading completes.
 */

import type { MutableRefObject } from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';

import type { EventBus } from '@/engine/core/EventBus';
import { useGameStore } from '@/store/gameStore';

export interface UseLoadingStateProps {
  /** Event bus ref for emitting countdown event */
  eventBusRef: MutableRefObject<EventBus | null>;
}

export interface UseLoadingStateReturn {
  /** Whether the game is still loading */
  isLoading: boolean;
  /** Loading progress (0-100) */
  loadingProgress: number;
  /** Current loading status message */
  loadingStatus: string;
  /** Whether WebGPU is being used */
  isWebGPU: boolean;
  /** Fade-in overlay opacity (1 = opaque, 0 = transparent) */
  fadeInOpacity: number;
  /** Update loading progress and status */
  setProgress: (progress: number, status: string) => void;
  /** Set WebGPU detection result */
  setWebGPUDetected: (detected: boolean) => void;
  /** Called when loading screen animation completes */
  handleLoadingComplete: () => void;
}

export function useLoadingState({
  eventBusRef,
}: UseLoadingStateProps): UseLoadingStateReturn {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing');
  const [isWebGPU, setIsWebGPU] = useState(false);
  const [fadeInOpacity, setFadeInOpacity] = useState(1);

  // Track animation frame for cleanup
  const animationFrameRef = useRef<number | null>(null);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Update loading progress and status
  const setProgress = useCallback((progress: number, status: string) => {
    setLoadingProgress(progress);
    setLoadingStatus(status);
  }, []);

  // Set WebGPU detection result
  const setWebGPUDetected = useCallback((detected: boolean) => {
    setIsWebGPU(detected);
  }, []);

  // Handle loading complete
  const handleLoadingComplete = useCallback(() => {
    setIsLoading(false);
    useGameStore.getState().setGameReady(true);
    // Sync playerId with game setup (handles spectator mode where localPlayerId is null)
    useGameStore.getState().syncWithGameSetup();

    // Emit countdown event after a short delay
    setTimeout(() => {
      const eventBus = eventBusRef.current;
      if (eventBus) {
        eventBus.emit('game:countdown');
      }
    }, 50);

    // Animate fade-in
    const startTime = Date.now();
    const duration = 1000;

    const animateFadeIn = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out quad
      const eased = 1 - Math.pow(1 - progress, 2);
      setFadeInOpacity(1 - eased);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animateFadeIn);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animateFadeIn);
  }, [eventBusRef]);

  return {
    isLoading,
    loadingProgress,
    loadingStatus,
    isWebGPU,
    fadeInOpacity,
    setProgress,
    setWebGPUDetected,
    handleLoadingComplete,
  };
}
