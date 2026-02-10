'use client';

import { useState, useCallback, useEffect } from 'react';
import { SettingSelect } from '@/components/game-setup';
import type { StartingResources, GameSpeed, AIDifficulty } from '@/store/gameSetupStore';

export interface PreviewSettings {
  startingResources: StartingResources;
  gameSpeed: GameSpeed;
  fogOfWar: boolean;
  aiDifficulty: AIDifficulty;
  numPlayers: number;
}

interface MapPreviewModalProps {
  maxPlayers: number;
  onLaunch: (settings: PreviewSettings) => void;
  onCancel: () => void;
}

export function MapPreviewModal({ maxPlayers, onLaunch, onCancel }: MapPreviewModalProps) {
  const [startingResources, setStartingResources] = useState<StartingResources>('insane');
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>('normal');
  const [fogOfWar, setFogOfWar] = useState(false);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [numPlayers, setNumPlayers] = useState(2);

  // Clamp player count if maxPlayers changes
  useEffect(() => {
    if (numPlayers > maxPlayers) {
      setNumPlayers(maxPlayers);
    }
  }, [maxPlayers, numPlayers]);

  const handleLaunch = useCallback(() => {
    onLaunch({ startingResources, gameSpeed, fogOfWar, aiDifficulty, numPlayers });
  }, [startingResources, gameSpeed, fogOfWar, aiDifficulty, numPlayers, onLaunch]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Build player count options from 2 to maxPlayers
  const playerOptions = [];
  for (let i = 2; i <= maxPlayers; i++) {
    playerOptions.push({ value: String(i), label: `${i} Players` });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-void-950 border border-void-700/50 rounded-xl shadow-2xl shadow-void-900/50 w-full max-w-sm mx-4">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-void-800/50">
          <h2 className="font-display text-lg text-white">Preview Settings</h2>
          <p className="text-void-400 text-xs mt-0.5">Configure your map test</p>
        </div>

        {/* Settings */}
        <div className="px-5 py-4 space-y-1">
          {maxPlayers > 2 && (
            <SettingSelect
              label="Players"
              value={String(numPlayers)}
              options={playerOptions}
              onChange={(v) => setNumPlayers(parseInt(v, 10))}
            />
          )}

          <SettingSelect
            label="AI Difficulty"
            value={aiDifficulty}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
              { value: 'insane', label: 'Insane' },
            ]}
            onChange={setAiDifficulty}
          />

          <SettingSelect
            label="Starting Resources"
            value={startingResources}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'insane', label: 'Insane' },
            ]}
            onChange={setStartingResources}
          />

          <SettingSelect
            label="Game Speed"
            value={gameSpeed}
            options={[
              { value: 'slower', label: '0.5x' },
              { value: 'normal', label: '1x' },
              { value: 'faster', label: '1.5x' },
              { value: 'fastest', label: '2x' },
            ]}
            onChange={setGameSpeed}
          />

          <div className="flex items-center justify-between py-1">
            <span className="text-void-300 text-xs">Fog of War</span>
            <button
              onClick={() => setFogOfWar(!fogOfWar)}
              className={`w-10 h-5 rounded-full transition-all duration-200 relative
                ${fogOfWar ? 'bg-void-500' : 'bg-void-800'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200
                ${fogOfWar ? 'left-5' : 'left-0.5'}`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-2 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-void-800 hover:bg-void-700 text-void-300 hover:text-white
                       text-sm rounded-lg border border-void-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            className="flex-1 px-4 py-2 bg-plasma-600 hover:bg-plasma-500 text-white
                       text-sm rounded-lg border border-plasma-500 transition-colors font-display"
          >
            Launch Preview
          </button>
        </div>
      </div>
    </div>
  );
}
