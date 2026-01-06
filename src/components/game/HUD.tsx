'use client';

import { useGameStore } from '@/store/gameStore';
import { Minimap } from './Minimap';
import { ResourcePanel } from './ResourcePanel';
import { SelectionPanel } from './SelectionPanel';
import { CommandCard } from './CommandCard';

export function HUD() {
  const { isPaused, togglePause, gameTime } = useGameStore();

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-start p-2 pointer-events-auto">
        {/* Resources */}
        <ResourcePanel />

        {/* Game time */}
        <div className="game-panel px-4 py-2">
          <span className="font-mono text-void-300">{formatTime(gameTime)}</span>
        </div>

        {/* Menu buttons */}
        <div className="flex gap-2">
          <button
            onClick={togglePause}
            className="game-button text-sm"
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="game-button text-sm"
          >
            Menu
          </button>
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
