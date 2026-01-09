'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ALL_MAPS, MapData } from '@/data/maps';
import { BIOMES } from '@/rendering/Biomes';
import {
  useGameSetupStore,
  PLAYER_COLORS,
  TEAM_COLORS,
  StartingResources,
  GameSpeed,
  AIDifficulty,
  PlayerType,
  PlayerSlot,
  TeamNumber,
} from '@/store/gameSetupStore';

// Helper to convert THREE.Color to hex string
function colorToHex(color: { r: number; g: number; b: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// Helper to convert hex number to CSS color
function hexToCSS(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// Map preview component
function MapPreview({ map, isSelected, onSelect }: {
  map: MapData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const biome = BIOMES[map.biome || 'grassland'];
  const groundColors = biome.colors.ground;
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
      <div
        className="h-20 w-full relative"
        style={{
          background: `linear-gradient(135deg,
            ${colorToHex(groundColors[2])},
            ${colorToHex(groundColors[0])},
            ${colorToHex(groundColors[1])})`
        }}
      >
        <div className="absolute top-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-void-300">
          {map.width}x{map.height}
        </div>
        <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[10px] capitalize"
             style={{ color: accentColor }}>
          {map.biome || 'grassland'}
        </div>
      </div>

      <div className="p-2 bg-void-950">
        <h3 className="font-display text-white text-xs mb-0.5">{map.name}</h3>
        <p className="text-void-400 text-[10px] line-clamp-1">{map.description}</p>
      </div>

      {isSelected && (
        <div className="absolute top-1 left-1 bg-void-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">
          ✓
        </div>
      )}
    </button>
  );
}

// Player slot row component
function PlayerSlotRow({
  slot,
  index,
  usedColors,
  onTypeChange,
  onFactionChange,
  onColorChange,
  onDifficultyChange,
  onTeamChange,
  onRemove,
  canRemove,
}: {
  slot: PlayerSlot;
  index: number;
  usedColors: Set<string>;
  onTypeChange: (type: PlayerType) => void;
  onFactionChange: (faction: string) => void;
  onColorChange: (colorId: string) => void;
  onDifficultyChange: (difficulty: AIDifficulty) => void;
  onTeamChange: (team: TeamNumber) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const selectedColor = PLAYER_COLORS.find(c => c.id === slot.colorId);

  return (
    <div className="flex items-center gap-2 p-2 bg-void-900/50 rounded-lg border border-void-800/50">
      {/* Player number */}
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
           style={{ backgroundColor: hexToCSS(selectedColor?.hex ?? 0x808080), color: '#000' }}>
        {index + 1}
      </div>

      {/* Player type */}
      <select
        value={slot.type}
        onChange={(e) => onTypeChange(e.target.value as PlayerType)}
        className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                   focus:outline-none focus:border-void-500 cursor-pointer min-w-[70px]"
      >
        <option value="human">Human</option>
        <option value="ai">AI</option>
        <option value="open">Open</option>
        <option value="closed">Closed</option>
      </select>

      {/* Team selection (only for human/ai) */}
      {(slot.type === 'human' || slot.type === 'ai') && (
        <select
          value={slot.team}
          onChange={(e) => onTeamChange(Number(e.target.value) as TeamNumber)}
          className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                     focus:outline-none focus:border-void-500 cursor-pointer min-w-[65px]"
          style={{ borderLeftColor: TEAM_COLORS[slot.team].color, borderLeftWidth: '3px' }}
        >
          {Object.entries(TEAM_COLORS).map(([key, { name }]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>
      )}

      {/* Faction (only for human/ai) */}
      {(slot.type === 'human' || slot.type === 'ai') && (
        <select
          value={slot.faction}
          onChange={(e) => onFactionChange(e.target.value)}
          className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                     focus:outline-none focus:border-void-500 cursor-pointer min-w-[80px]"
        >
          <option value="dominion">Dominion</option>
        </select>
      )}

      {/* AI Difficulty (only for AI) */}
      {slot.type === 'ai' && (
        <select
          value={slot.aiDifficulty}
          onChange={(e) => onDifficultyChange(e.target.value as AIDifficulty)}
          className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                     focus:outline-none focus:border-void-500 cursor-pointer min-w-[65px]"
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
          <option value="insane">Insane</option>
        </select>
      )}

      {/* Color selector (only for human/ai) */}
      {(slot.type === 'human' || slot.type === 'ai') && (
        <div className="flex gap-1">
          {PLAYER_COLORS.map((color) => {
            const isUsed = usedColors.has(color.id) && slot.colorId !== color.id;
            return (
              <button
                key={color.id}
                onClick={() => !isUsed && onColorChange(color.id)}
                title={color.name}
                disabled={isUsed}
                className={`w-5 h-5 rounded-full transition-all duration-200
                  ${slot.colorId === color.id
                    ? 'ring-2 ring-white scale-110'
                    : isUsed
                      ? 'opacity-30 cursor-not-allowed'
                      : 'hover:scale-110'
                  }`}
                style={{ backgroundColor: hexToCSS(color.hex) }}
              />
            );
          })}
        </div>
      )}

      {/* Remove button */}
      {canRemove && (
        <button
          onClick={onRemove}
          className="w-6 h-6 flex items-center justify-center text-void-500 hover:text-red-400
                     hover:bg-red-900/30 rounded transition-colors"
          title="Remove player"
        >
          ✕
        </button>
      )}
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
  options: { value: T; label: string }[];
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

export default function GameSetupPage() {
  const router = useRouter();
  const {
    selectedMapId,
    startingResources,
    gameSpeed,
    fogOfWar,
    playerSlots,
    setSelectedMap,
    setStartingResources,
    setGameSpeed,
    setFogOfWar,
    setPlayerSlotType,
    setPlayerSlotFaction,
    setPlayerSlotColor,
    setPlayerSlotAIDifficulty,
    setPlayerSlotTeam,
    addPlayerSlot,
    removePlayerSlot,
    startGame,
  } = useGameSetupStore();

  const maps = Object.values(ALL_MAPS);
  const selectedMap = ALL_MAPS[selectedMapId] || maps[0];

  // Get used colors for duplicate prevention
  const usedColors = new Set(
    playerSlots
      .filter(s => s.type === 'human' || s.type === 'ai')
      .map(s => s.colorId)
  );

  // Count active players
  const activePlayerCount = playerSlots.filter(s => s.type === 'human' || s.type === 'ai').length;

  // Handle map selection - trim excess players if new map has fewer slots
  const handleMapSelect = (mapId: string) => {
    const newMap = ALL_MAPS[mapId];
    if (newMap) {
      setSelectedMap(mapId);
      // Remove excess players if map has fewer max players
      // Get fresh state from store each iteration
      let currentSlots = useGameSetupStore.getState().playerSlots;
      while (currentSlots.length > newMap.maxPlayers) {
        const lastSlot = currentSlots[currentSlots.length - 1];
        if (lastSlot) {
          removePlayerSlot(lastSlot.id);
          currentSlots = useGameSetupStore.getState().playerSlots;
        } else {
          break;
        }
      }
    }
  };

  const handleStartGame = () => {
    startGame();
    router.push('/game');
  };

  // Limit players to map's maxPlayers, and global max of 8
  const maxPlayersForMap = selectedMap.maxPlayers;
  const canAddPlayer = playerSlots.length < maxPlayersForMap && playerSlots.length < 8;
  const canRemovePlayer = playerSlots.length > 2;

  return (
    <main className="h-screen bg-black overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-b from-void-950/50 via-black to-black" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(132,61,255,0.1),transparent_70%)]" />

      {/* Content - scrollable */}
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link href="/" className="text-void-400 hover:text-void-300 text-sm mb-1 inline-block">
              &larr; Back to Menu
            </Link>
            <h1 className="font-display text-2xl text-white">Game Setup</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map Selection - Takes 2 columns */}
          <div className="lg:col-span-2">
            <h2 className="font-display text-lg text-white mb-2">Select Map</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {maps.map((map) => (
                <MapPreview
                  key={map.id}
                  map={map}
                  isSelected={selectedMapId === map.id}
                  onSelect={() => handleMapSelect(map.id)}
                />
              ))}
            </div>

            {/* Selected map details */}
            <div className="mt-3 p-3 bg-void-900/50 rounded-lg border border-void-800/50">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-display text-base text-white">{selectedMap.name}</h3>
                <span className="text-void-400 text-xs">{selectedMap.width}x{selectedMap.height} • {selectedMap.maxPlayers}P</span>
              </div>
              <p className="text-void-400 text-xs">{selectedMap.description}</p>
            </div>

            {/* Players Section */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-lg text-white">
                  Players ({activePlayerCount}/{maxPlayersForMap})
                </h2>
                <button
                  onClick={addPlayerSlot}
                  disabled={!canAddPlayer}
                  className={`text-sm px-2 py-1 rounded border transition-colors
                    ${canAddPlayer
                      ? 'text-void-400 hover:text-void-300 border-void-700 hover:border-void-500'
                      : 'text-void-600 border-void-800 cursor-not-allowed opacity-50'
                    }`}
                >
                  + Add Player
                </button>
              </div>
              <div className="space-y-2">
                {playerSlots.map((slot, index) => (
                  <PlayerSlotRow
                    key={slot.id}
                    slot={slot}
                    index={index}
                    usedColors={usedColors}
                    onTypeChange={(type) => setPlayerSlotType(slot.id, type)}
                    onFactionChange={(faction) => setPlayerSlotFaction(slot.id, faction)}
                    onColorChange={(colorId) => setPlayerSlotColor(slot.id, colorId)}
                    onDifficultyChange={(diff) => setPlayerSlotAIDifficulty(slot.id, diff)}
                    onTeamChange={(team) => setPlayerSlotTeam(slot.id, team)}
                    onRemove={() => removePlayerSlot(slot.id)}
                    canRemove={canRemovePlayer}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Settings Panel - 1 column */}
          <div className="space-y-4">
            {/* Game Settings */}
            <div>
              <h2 className="font-display text-lg text-white mb-2">Game Settings</h2>
              <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-3">
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

                <div className="flex items-center justify-between py-2">
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
              </div>
            </div>

            {/* Start Game Button */}
            <button
              onClick={handleStartGame}
              disabled={activePlayerCount < 2}
              className="w-full game-button-primary text-lg px-8 py-3 font-display disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Game
            </button>

            {activePlayerCount < 2 && (
              <p className="text-center text-red-400 text-xs">
                At least 2 active players required
              </p>
            )}

            {/* Keyboard hint */}
            <p className="text-center text-void-600 text-[10px]">
              Press <kbd className="px-1 py-0.5 bg-void-800 rounded text-[10px]">?</kbd> during game for controls
            </p>
          </div>
        </div>
        </div>
      </div>
    </main>
  );
}
