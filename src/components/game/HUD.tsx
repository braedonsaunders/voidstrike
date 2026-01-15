'use client';

import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useUIStore, GameOverlayType } from '@/store/uiStore';
import { isMultiplayerMode, useGameSetupStore } from '@/store/gameSetupStore';
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
import { PerformancePanel } from './PerformancePanel';
import { BattleSimulatorPanel } from './BattleSimulatorPanel';

// PERF: Wrap HUD in memo to prevent unnecessary re-renders when parent state changes
export const HUD = memo(function HUD() {
  const { isPaused, togglePause, setShowTechTree, setShowKeyboardShortcuts, isGameReady } = useGameStore();
  const { toggleGraphicsOptions, showGraphicsOptions, toggleSoundOptions, showSoundOptions, toggleDebugMenu, showDebugMenu, togglePerformancePanel, showPerformancePanel, isFullscreen, toggleFullscreen, setFullscreen, overlaySettings, toggleOverlay } = useUIStore();
  const isBattleSimulator = useGameSetupStore((state) => state.isBattleSimulator);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPlayerStatus, setShowPlayerStatus] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);

  // Disable edge scrolling when mouse is over UI elements
  // IMPORTANT: All hooks must be called before any early returns to comply with React's rules of hooks
  const handleUIMouseEnter = useCallback(() => {
    setEdgeScrollEnabled(false);
  }, []);

  const handleUIMouseLeave = useCallback(() => {
    setEdgeScrollEnabled(true);
  }, []);

  // Disable edge scrolling when game is paused
  useEffect(() => {
    if (isPaused) {
      setEdgeScrollEnabled(false);
      return () => {
        setEdgeScrollEnabled(true);
      };
    }
  }, [isPaused]);

  // Disable edge scrolling when any HUD dropdown/panel is open
  useEffect(() => {
    if (showOptionsMenu || showOverlayMenu || showPlayerStatus) {
      setEdgeScrollEnabled(false);
      return () => {
        setEdgeScrollEnabled(true);
      };
    }
  }, [showOptionsMenu, showOverlayMenu, showPlayerStatus]);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    setFullscreen(!!document.fullscreenElement);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

  // Don't render HUD until game is ready (prevents flash during loading)
  // This early return is placed AFTER all hooks to comply with React's rules of hooks
  if (!isGameReady) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none">

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start p-2 pointer-events-auto">
        {/* Resources (includes game time) - hidden in simulator mode */}
        {!isBattleSimulator && <ResourcePanel />}
        {isBattleSimulator && <div />}

        {/* Menu buttons */}
        <div
          className="flex gap-2"
          onMouseEnter={handleUIMouseEnter}
          onMouseLeave={handleUIMouseLeave}
        >
          <IdleWorkerButton />
          <div className="relative">
            <button
              onClick={() => {
                // Close any open option panels first
                if (showGraphicsOptions) toggleGraphicsOptions();
                if (showSoundOptions) toggleSoundOptions();
                if (showPerformancePanel) togglePerformancePanel();
                if (showDebugMenu) toggleDebugMenu();
                // Then toggle the main options menu
                setShowOptionsMenu(!showOptionsMenu);
                setShowOverlayMenu(false);
              }}
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
                    setShowPlayerStatus(!showPlayerStatus);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Players</span>
                  <span className={showPlayerStatus ? 'text-green-400' : 'text-void-500'}>{showPlayerStatus ? 'ON' : 'OFF'}</span>
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
                {/* Overlays submenu */}
                <div className="relative">
                  <button
                    onClick={() => setShowOverlayMenu(!showOverlayMenu)}
                    className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                  >
                    <span>Overlays</span>
                    <span className={overlaySettings.activeOverlay !== 'none' ? 'text-green-400' : 'text-void-500'}>
                      {overlaySettings.activeOverlay !== 'none' ? overlaySettings.activeOverlay.toUpperCase() : ''}
                    </span>
                  </button>
                  {showOverlayMenu && (
                    <div className="absolute right-full top-0 mr-1 bg-void-900 border border-void-700 rounded shadow-lg z-50 min-w-[180px]">
                      <button
                        onClick={() => {
                          toggleOverlay('terrain');
                          setShowOverlayMenu(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-void-800 transition-colors flex justify-between items-center ${
                          overlaySettings.activeOverlay === 'terrain' ? 'text-green-400' : 'text-void-200'
                        }`}
                      >
                        <span>Terrain (Walkability)</span>
                        {overlaySettings.activeOverlay === 'terrain' && <span>ON</span>}
                      </button>
                      <button
                        onClick={() => {
                          toggleOverlay('elevation');
                          setShowOverlayMenu(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-void-800 transition-colors flex justify-between items-center ${
                          overlaySettings.activeOverlay === 'elevation' ? 'text-cyan-400' : 'text-void-200'
                        }`}
                      >
                        <span>Elevation (High Ground)</span>
                        {overlaySettings.activeOverlay === 'elevation' && <span>ON</span>}
                      </button>
                      <button
                        onClick={() => {
                          toggleOverlay('threat');
                          setShowOverlayMenu(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-void-800 transition-colors flex justify-between items-center ${
                          overlaySettings.activeOverlay === 'threat' ? 'text-red-400' : 'text-void-200'
                        }`}
                      >
                        <span>Threat Ranges (Enemy)</span>
                        {overlaySettings.activeOverlay === 'threat' && <span>ON</span>}
                      </button>
                      <div className="border-t border-void-700 my-1" />
                      <div className="px-4 py-1 text-xs text-void-500">
                        Press O to cycle overlays
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={toggleFullscreen}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Fullscreen</span>
                  <span className={isFullscreen ? 'text-green-400' : 'text-void-500'}>{isFullscreen ? 'ON' : 'OFF'}</span>
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
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    togglePerformancePanel();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-void-200 hover:bg-void-800 transition-colors flex justify-between items-center"
                >
                  <span>Performance</span>
                  <span className={showPerformancePanel ? 'text-green-400' : 'text-void-500'}>{showPerformancePanel ? 'OPEN' : ''}</span>
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

      {/* Bottom bar - pointer-events-none to allow drag selection through empty areas */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between items-end p-2 pointer-events-none">
        {/* Minimap - disable edge scroll when hovering */}
        <div className="pointer-events-auto" onMouseEnter={handleUIMouseEnter} onMouseLeave={handleUIMouseLeave}>
          <Minimap />
        </div>

        {/* Selection panel - allow drag selection through but enable clicks on panel content */}
        <div className="flex-1 mx-4 pointer-events-auto">
          <SelectionPanel />
        </div>

        {/* Command card - disable edge scroll when hovering */}
        <div className="pointer-events-auto" onMouseEnter={handleUIMouseEnter} onMouseLeave={handleUIMouseLeave}>
          <CommandCard />
        </div>
      </div>

      {/* Player Status Panel - top right (toggleable) */}
      {showPlayerStatus && (
        <div className="absolute top-12 right-2 pointer-events-auto">
          <PlayerStatusPanel />
        </div>
      )}

      {/* Battle Simulator Panel */}
      {isBattleSimulator && <BattleSimulatorPanel />}

      {/* Tech Tree Modal */}
      <TechTreePanel />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsPanel />

      {/* Sound Options Panel */}
      <SoundOptionsPanel />

      {/* Performance Panel */}
      <PerformancePanel />

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
});
