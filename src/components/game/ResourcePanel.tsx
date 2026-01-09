'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';

export function ResourcePanel() {
  const { minerals, vespene, supply, maxSupply, gameTime } = useGameStore();
  const { showFPS } = useUIStore();
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

  // Format game time as mm:ss
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const isSupplyBlocked = supply >= maxSupply && maxSupply > 0;

  return (
    <div className="flex items-center gap-3 bg-black/40 backdrop-blur-sm px-3 py-1 rounded text-sm">
      {/* Game Time */}
      <span className="font-mono text-void-300">{formatTime(gameTime)}</span>

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

      {/* FPS Counter */}
      {showFPS && (
        <>
          <div className="w-px h-4 bg-void-600" />
          <span className="font-mono text-green-400 text-xs">{fps}</span>
        </>
      )}
    </div>
  );
}
