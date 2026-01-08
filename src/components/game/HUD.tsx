'use client';

import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { Minimap } from './Minimap';
import { ResourcePanel } from './ResourcePanel';
import { SelectionPanel } from './SelectionPanel';
import { CommandCard } from './CommandCard';
import { TechTreePanel } from './TechTreePanel';
import { ProductionQueuePanel } from './ProductionQueuePanel';
import { IdleWorkerButton } from './IdleWorkerButton';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';

export function HUD() {
  const { isPaused, togglePause, setShowTechTree, setShowKeyboardShortcuts } = useGameStore();
  const { showFPS, toggleFPS } = useUIStore();
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
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

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* FPS Counter - positioned in top left under resource panel */}
      {showFPS && (
        <div className="absolute top-14 left-2 bg-black/70 px-2 py-1 rounded text-xs font-mono text-green-400 pointer-events-none z-50">
          {fps} FPS
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start p-2 pointer-events-auto">
        {/* Resources (includes game time) */}
        <ResourcePanel />

        {/* Menu buttons */}
        <div className="flex gap-2">
          <IdleWorkerButton />
          <button
            onClick={() => setShowTechTree(true)}
            className="game-button text-sm"
            title="View Tech Tree (T)"
          >
            Tech
          </button>
          <button
            onClick={() => setShowKeyboardShortcuts(true)}
            className="game-button text-sm"
            title="Keyboard Shortcuts (?)"
          >
            ?
          </button>
          <button
            onClick={togglePause}
            className="game-button text-sm"
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              className="game-button text-sm"
            >
              Options
            </button>
            {showOptionsMenu && (
              <div className="absolute right-0 top-full mt-1 bg-void-900 border border-void-700 rounded shadow-lg z-50 min-w-[150px]">
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setShowKeyboardShortcuts(true);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors"
                >
                  Controls
                </button>
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setShowTechTree(true);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors"
                >
                  Tech Tree
                </button>
                <button
                  onClick={toggleFPS}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Show FPS</span>
                  <span className={showFPS ? 'text-green-400' : 'text-void-500'}>{showFPS ? 'ON' : 'OFF'}</span>
                </button>
                <div className="border-t border-void-700 my-1" />
                <button
                  onClick={() => {
                    if (confirm('Return to main menu? Progress will be lost.')) {
                      window.location.href = '/';
                    }
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-void-800 transition-colors"
                >
                  Exit to Menu
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-end p-2 pointer-events-auto">
        {/* Minimap */}
        <Minimap />

        {/* Selection panel */}
        <div className="flex-1 mx-4">
          <SelectionPanel />
        </div>

        {/* Command card */}
        <CommandCard />
      </div>

      {/* Production Queue Panel - right side */}
      <div className="absolute top-16 right-2 pointer-events-auto">
        <ProductionQueuePanel />
      </div>

      {/* Tech Tree Modal */}
      <TechTreePanel />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsPanel />

      {/* Pause overlay */}
      {isPaused && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-auto">
          <div className="text-center">
            <h2 className="font-display text-4xl text-void-300 mb-4">PAUSED</h2>
            <button
              onClick={togglePause}
              className="game-button-primary text-lg px-8 py-3"
            >
              Resume Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
