'use client';

import { memo, useMemo, useEffect, useRef, useState } from 'react';
import { useGameStore, GameState } from '@/store/gameStore';
import { useUIStore, PerformanceMetrics } from '@/store/uiStore';
import { useGameSetupStore, GameSetupState } from '@/store/gameSetupStore';

// Format number with K/M suffix for large numbers
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

// PERFORMANCE: Memoized ResourcePanel to prevent unnecessary re-renders
export const ResourcePanel = memo(function ResourcePanel() {
  // Use selectors to minimize re-renders - only re-render when these specific values change
  const minerals = useGameStore((state: GameState) => state.minerals);
  const vespene = useGameStore((state: GameState) => state.vespene);
  const supply = useGameStore((state: GameState) => state.supply);
  const maxSupply = useGameStore((state: GameState) => state.maxSupply);
  const gameTime = useGameStore((state: GameState) => state.gameTime);
  const showFPS = useUIStore((state) => state.showFPS);
  const performanceMetrics = useUIStore((state) => state.performanceMetrics);
  const isSpectator = useGameSetupStore((state: GameSetupState) => state.isSpectator());
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  // FPS counter
  useEffect(() => {
    if (!showFPS) return;

    let animationId: number;
    const updateFPS = () => {
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      animationId = requestAnimationFrame(updateFPS);
    };

    animationId = requestAnimationFrame(updateFPS);
    return () => cancelAnimationFrame(animationId);
  }, [showFPS]);

  // PERFORMANCE: Memoize derived values
  const formattedTime = useMemo(() => {
    const minutes = Math.floor(gameTime / 60);
    const seconds = Math.floor(gameTime % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [gameTime]);

  const { isSupplyBlocked, supplyPercent } = useMemo(() => ({
    isSupplyBlocked: supply >= maxSupply && maxSupply > 0,
    supplyPercent: maxSupply > 0 ? (supply / maxSupply) * 100 : 0,
  }), [supply, maxSupply]);

  return (
    <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm px-3 py-1 rounded text-sm">
      {/* Game Time */}
      <span className="font-mono text-void-300">{formattedTime}</span>

      {/* Spectator Mode Indicator */}
      {isSpectator && (
        <>
          <div className="w-px h-4 bg-void-600" />
          <span className="font-mono text-orange-400 text-xs font-semibold">SPECTATING</span>
        </>
      )}

      {/* Resources - Only show if not spectating */}
      {!isSpectator && (
        <>
          <div className="w-px h-4 bg-void-600" />

          {/* Minerals */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-400 rounded-sm transform rotate-45" />
            <span className="font-mono text-blue-300 font-semibold">{minerals}</span>
          </div>

          {/* Vespene */}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-green-500 rounded-full" />
            <span className="font-mono text-green-400 font-semibold">{vespene}</span>
          </div>

          {/* Supply */}
          <div className="flex items-center gap-1.5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`w-3 h-3 ${isSupplyBlocked ? 'text-red-400' : 'text-yellow-400'}`}
            >
              <circle cx="9" cy="7" r="4" />
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            </svg>
            <span className={`font-mono font-semibold ${isSupplyBlocked ? 'text-red-400' : 'text-yellow-300'}`}>
              {supply}/{maxSupply}
            </span>
            {isSupplyBlocked && (
              <span className="text-red-400 text-xs animate-pulse">!</span>
            )}
          </div>
        </>
      )}

      {/* Performance Stats */}
      {showFPS && (
        <>
          <div className="w-px h-4 bg-void-600" />
          {/* FPS */}
          <span className="font-mono text-green-400 text-xs">{fps} FPS</span>

          {/* CPU/GPU timing */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-cyan-400 text-xs" title="CPU time (game logic)">
              CPU:{performanceMetrics.cpuTime.toFixed(1)}ms
            </span>
            <span className="font-mono text-orange-400 text-xs" title="GPU time (rendering)">
              GPU:{performanceMetrics.gpuTime.toFixed(1)}ms
            </span>
          </div>

          {/* Triangles and draw calls */}
          <div className="flex items-center gap-1">
            <span className="font-mono text-purple-400 text-xs" title="Triangles rendered">
              {formatNumber(performanceMetrics.triangles)}△
            </span>
            <span className="font-mono text-yellow-400 text-xs" title="Draw calls">
              {performanceMetrics.drawCalls}dc
            </span>
          </div>

          {/* Resolution info - show if render != display (FSR active) */}
          {performanceMetrics.renderWidth > 0 && performanceMetrics.renderWidth !== performanceMetrics.displayWidth && (
            <span className="font-mono text-gray-400 text-xs" title="Render → Display resolution">
              {performanceMetrics.renderWidth}×{performanceMetrics.renderHeight}→{performanceMetrics.displayWidth}×{performanceMetrics.displayHeight}
            </span>
          )}
          {performanceMetrics.renderWidth > 0 && performanceMetrics.renderWidth === performanceMetrics.displayWidth && (
            <span className="font-mono text-gray-400 text-xs" title="Render resolution">
              {performanceMetrics.displayWidth}×{performanceMetrics.displayHeight}
            </span>
          )}
        </>
      )}
    </div>
  );
});

// Set display name for debugging
ResourcePanel.displayName = 'ResourcePanel';
