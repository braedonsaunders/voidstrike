'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ALL_MAPS, MapData } from '@/data/maps';
import { BIOMES, BiomeType } from '@/rendering/Biomes';
import {
  useGameSetupStore,
  STARTING_RESOURCES_VALUES,
  GAME_SPEED_VALUES,
  PLAYER_COLORS,
  StartingResources,
  GameSpeed,
  AIDifficulty,
} from '@/store/gameSetupStore';

// Helper to convert THREE.Color to hex string
function colorToHex(color: { r: number; g: number; b: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// Map preview component
function MapPreview({ map, isSelected, onSelect }: {
  map: MapData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const biome = BIOMES[map.biome || 'grassland'];

  // Get colors from biome (these are THREE.Color objects)
  const groundColors = biome.colors.ground;
  const cliffColor = colorToHex(biome.colors.cliff[0]);
  const accentColor = colorToHex(biome.colors.accent[0]);

  return (
    <button
      onClick={onSelect}
      className={`relative overflow-hidden rounded-lg border-2 transition-all duration-300 text-left
        ${isSelected
          ? 'border-void-400 shadow-[0_0_20px_rgba(132,61,255,0.4)]'
          : 'border-void-800/50 hover:border-void-600'
        }`}
    >
      {/* Map mini-preview (color based on biome) */}
      <div
        className="h-32 w-full relative"
        style={{
          background: `linear-gradient(135deg,
            ${colorToHex(groundColors[2])},
            ${colorToHex(groundColors[0])},
            ${colorToHex(groundColors[1])})`
        }}
      >
        {/* Spawn points indicator */}
        <div className="absolute inset-0 flex items-center justify-between px-4">
          <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" title="Player 1" />
          <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-lg" title="Player 2" />
        </div>

        {/* Map size badge */}
        <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-void-300">
          {map.width}x{map.height}
        </div>

        {/* Biome badge */}
        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs capitalize"
             style={{ color: accentColor }}>
          {map.biome || 'grassland'}
        </div>
      </div>

      {/* Map info */}
      <div className="p-3 bg-void-950">
        <h3 className="font-display text-white text-sm mb-1">{map.name}</h3>
        <p className="text-void-400 text-xs line-clamp-2">{map.description}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-void-500">
          <span>{map.maxPlayers} Players</span>
          {map.isRanked && <span className="text-yellow-500">Ranked</span>}
        </div>
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-2 left-2 bg-void-500 text-white px-2 py-1 rounded text-xs font-bold">
          Selected
        </div>
      )}
    </button>
  );
}

// Faction selector component
function FactionSelector({ selected, onSelect }: {
  selected: string;
  onSelect: (faction: string) => void;
}) {
  const factions = [
    {
      id: 'dominion',
      name: 'Dominion',
      description: 'Versatile human forces',
      color: 'from-blue-600 to-blue-900',
      available: true,
    },
    {
      id: 'synthesis',
      name: 'Synthesis',
      description: 'Shield-based machines',
      color: 'from-purple-600 to-purple-900',
      available: false,
    },
    {
      id: 'swarm',
      name: 'Swarm',
      description: 'Overwhelming numbers',
      color: 'from-amber-700 to-amber-950',
      available: false,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {factions.map((faction) => (
        <button
          key={faction.id}
          onClick={() => faction.available && onSelect(faction.id)}
          disabled={!faction.available}
          className={`relative overflow-hidden rounded-lg border-2 p-4 transition-all duration-300
            bg-gradient-to-br ${faction.color}
            ${selected === faction.id
              ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.3)]'
              : 'border-transparent'
            }
            ${faction.available
              ? 'cursor-pointer hover:border-white/50'
              : 'opacity-50 cursor-not-allowed'
            }`}
        >
          <h4 className="font-display text-white text-sm">{faction.name}</h4>
          <p className="text-gray-300 text-xs mt-1">{faction.description}</p>
          {!faction.available && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <span className="text-xs text-white/70">Coming Soon</span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// Settings dropdown component
function SettingSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-void-800/50">
      <span className="text-void-300 text-sm">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-void-900 border border-void-700 rounded px-3 py-1.5 text-white text-sm
                   focus:outline-none focus:border-void-500 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Color selector
function ColorSelector({ selected, onSelect }: {
  selected: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-void-800/50">
      <span className="text-void-300 text-sm">Player Color</span>
      <div className="flex gap-1.5">
        {PLAYER_COLORS.map((color) => (
          <button
            key={color.id}
            onClick={() => onSelect(color.id)}
            title={color.name}
            className={`w-6 h-6 rounded-full transition-all duration-200
              ${selected === color.id
                ? 'ring-2 ring-white ring-offset-2 ring-offset-void-950 scale-110'
                : 'hover:scale-110'
              }`}
            style={{ backgroundColor: color.hex }}
          />
        ))}
      </div>
    </div>
  );
}

export default function GameSetupPage() {
  const router = useRouter();
  const {
    selectedMapId,
    startingResources,
    gameSpeed,
    aiDifficulty,
    fogOfWar,
    playerFaction,
    playerColor,
    setSelectedMap,
    setStartingResources,
    setGameSpeed,
    setAIDifficulty,
    setFogOfWar,
    setPlayerFaction,
    setPlayerColor,
  } = useGameSetupStore();

  const maps = Object.values(ALL_MAPS);
  const selectedMap = ALL_MAPS[selectedMapId] || maps[0];

  const { startGame } = useGameSetupStore();

  const handleStartGame = () => {
    // Mark game as started and navigate to game
    startGame();
    router.push('/game');
  };

  return (
    <main className="min-h-screen bg-black">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-b from-void-950/50 via-black to-black" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(132,61,255,0.1),transparent_70%)]" />

      {/* Content */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-void-400 hover:text-void-300 text-sm mb-2 inline-block">
              &larr; Back to Menu
            </Link>
            <h1 className="font-display text-3xl text-white">Game Setup</h1>
          </div>

          <button
            onClick={handleStartGame}
            className="game-button-primary text-lg px-8 py-3"
          >
            Start Game
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Map Selection - Takes 2 columns */}
          <div className="lg:col-span-2">
            <h2 className="font-display text-xl text-white mb-4">Select Map</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {maps.map((map) => (
                <MapPreview
                  key={map.id}
                  map={map}
                  isSelected={selectedMapId === map.id}
                  onSelect={() => setSelectedMap(map.id)}
                />
              ))}
            </div>

            {/* Selected map details */}
            <div className="mt-6 p-4 bg-void-900/50 rounded-lg border border-void-800/50">
              <h3 className="font-display text-lg text-white mb-2">{selectedMap.name}</h3>
              <p className="text-void-400 text-sm mb-4">{selectedMap.description}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-void-500">Size</span>
                  <p className="text-white">{selectedMap.width}x{selectedMap.height}</p>
                </div>
                <div>
                  <span className="text-void-500">Players</span>
                  <p className="text-white">{selectedMap.maxPlayers}</p>
                </div>
                <div>
                  <span className="text-void-500">Expansions</span>
                  <p className="text-white">{selectedMap.expansions.length}</p>
                </div>
                <div>
                  <span className="text-void-500">Biome</span>
                  <p className="text-white capitalize">{selectedMap.biome || 'Grassland'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Settings Panel - 1 column */}
          <div className="space-y-6">
            {/* Faction Selection */}
            <div>
              <h2 className="font-display text-xl text-white mb-4">Faction</h2>
              <FactionSelector
                selected={playerFaction}
                onSelect={setPlayerFaction}
              />
            </div>

            {/* Game Settings */}
            <div>
              <h2 className="font-display text-xl text-white mb-4">Game Settings</h2>
              <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-4">
                <SettingSelect
                  label="Starting Resources"
                  value={startingResources}
                  options={[
                    { value: 'normal', label: 'Normal (50 minerals)' },
                    { value: 'high', label: 'High (500 minerals)' },
                    { value: 'insane', label: 'Insane (10000 minerals)' },
                  ]}
                  onChange={setStartingResources}
                />

                <SettingSelect
                  label="Game Speed"
                  value={gameSpeed}
                  options={[
                    { value: 'slower', label: 'Slower (0.5x)' },
                    { value: 'normal', label: 'Normal (1x)' },
                    { value: 'faster', label: 'Faster (1.5x)' },
                    { value: 'fastest', label: 'Fastest (2x)' },
                  ]}
                  onChange={setGameSpeed}
                />

                <SettingSelect
                  label="AI Difficulty"
                  value={aiDifficulty}
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'hard', label: 'Hard' },
                    { value: 'insane', label: 'Insane' },
                  ]}
                  onChange={setAIDifficulty}
                />

                <div className="flex items-center justify-between py-2 border-b border-void-800/50">
                  <span className="text-void-300 text-sm">Fog of War</span>
                  <button
                    onClick={() => setFogOfWar(!fogOfWar)}
                    className={`w-12 h-6 rounded-full transition-all duration-200 relative
                      ${fogOfWar ? 'bg-void-500' : 'bg-void-800'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-200
                      ${fogOfWar ? 'left-7' : 'left-1'}`}
                    />
                  </button>
                </div>

                <ColorSelector
                  selected={playerColor}
                  onSelect={setPlayerColor}
                />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleStartGame}
                className="flex-1 game-button-primary py-3"
              >
                Start Game
              </button>
            </div>

            {/* Keyboard hint */}
            <p className="text-center text-void-600 text-xs">
              Press <kbd className="px-1.5 py-0.5 bg-void-800 rounded">?</kbd> during game for controls
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
