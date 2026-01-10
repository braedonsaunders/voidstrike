'use client';

import { useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useUIStore } from '@/store/uiStore';
import { isMultiplayerMode } from '@/store/gameSetupStore';
import { setEdgeScrollEnabled } from '@/store/cameraStore';
import { Minimap } from './Minimap';
import { ResourcePanel } from './ResourcePanel';
import { SelectionPanel } from './SelectionPanel';
import { CommandCard } from './CommandCard';
import { TechTreePanel } from './TechTreePanel';
import { IdleWorkerButton } from './IdleWorkerButton';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { PlayerStatusPanel } from './PlayerStatusPanel';
import { SoundOptionsPanel } from './SoundOptionsPanel';

export function HUD() {
  const { isPaused, togglePause, setShowTechTree, setShowKeyboardShortcuts } = useGameStore();
  const { toggleFPS, showFPS, toggleGraphicsOptions, showGraphicsOptions, toggleSoundOptions, showSoundOptions, toggleDebugMenu, showDebugMenu } = useUIStore();
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPlayerStatus, setShowPlayerStatus] = useState(false);

  // Disable edge scrolling when mouse is over UI elements
  const handleUIMouseEnter = useCallback(() => {
    setEdgeScrollEnabled(false);
  }, []);

  const handleUIMouseLeave = useCallback(() => {
    setEdgeScrollEnabled(true);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none">

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start p-2 pointer-events-auto">
        {/* Resources (includes game time) */}
        <ResourcePanel />

        {/* Menu buttons */}
        <div
          className="flex gap-2"
          onMouseEnter={handleUIMouseEnter}
          onMouseLeave={handleUIMouseLeave}
        >
          <IdleWorkerButton />
          <button
            onClick={() => setShowPlayerStatus(!showPlayerStatus)}
            className={`game-button text-sm ${showPlayerStatus ? 'bg-void-700' : ''}`}
            title="Toggle Player Status Panel"
          >
            Players
          </button>
          <button
            onClick={() => setShowTechTree(true)}
            className="game-button text-sm"
            title="View Tech Tree (T)"
          >
            Tech
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
                    togglePause();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors"
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <div className="border-t border-void-700 my-1" />
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
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    toggleGraphicsOptions();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Graphics</span>
                  <span className={showGraphicsOptions ? 'text-green-400' : 'text-void-500'}>{showGraphicsOptions ? 'OPEN' : ''}</span>
                </button>
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    toggleSoundOptions();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Sound</span>
                  <span className={showSoundOptions ? 'text-green-400' : 'text-void-500'}>{showSoundOptions ? 'OPEN' : ''}</span>
                </button>
                {/* Debug menu only available in single player (not in multiplayer with multiple humans) */}
                {!isMultiplayerMode() && (
                  <button
                    onClick={() => {
                      setShowOptionsMenu(false);
                      toggleDebugMenu();
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                  >
                    <span>Debug</span>
                    <span className={showDebugMenu ? 'text-green-400' : 'text-void-500'}>{showDebugMenu ? 'OPEN' : ''}</span>
                  </button>
                )}
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
      <div
        className="absolute bottom-0 left-0 right-0 flex justify-between items-end p-2 pointer-events-auto"
        onMouseEnter={handleUIMouseEnter}
        onMouseLeave={handleUIMouseLeave}
      >
        {/* Minimap */}
        <Minimap />

        {/* Selection panel */}
        <div className="flex-1 mx-4">
          <SelectionPanel />
        </div>

        {/* Command card */}
        <CommandCard />
      </div>

      {/* Player Status Panel - top right (toggleable) */}
      {showPlayerStatus && (
        <div className="absolute top-12 right-2 pointer-events-auto">
          <PlayerStatusPanel />
        </div>
      )}

      {/* Tech Tree Modal */}
      <TechTreePanel />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsPanel />

      {/* Sound Options Panel */}
      <SoundOptionsPanel />

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
