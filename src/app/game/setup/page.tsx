'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { ALL_MAPS, MapData } from '@/data/maps';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
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
import { useLobby } from '@/hooks/useMultiplayer';
import { useMultiplayerStore } from '@/store/multiplayerStore';

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
function MapPreview({ map, isSelected, onSelect, onEdit }: {
  map: MapData;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const biome = BIOMES[map.biome || 'grassland'];
  const groundColors = biome.colors.ground;
  const accentColor = colorToHex(biome.colors.accent[0]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border-2 transition-all duration-300
        ${isSelected
          ? 'border-void-400 shadow-[0_0_20px_rgba(132,61,255,0.4)]'
          : 'border-void-800/50 hover:border-void-600'
        }`}
    >
      <button
        onClick={onSelect}
        className="w-full text-left"
      >
        <div
          className="h-10 w-full relative"
          style={{
            background: `linear-gradient(135deg,
              ${colorToHex(groundColors[2])},
              ${colorToHex(groundColors[0])},
              ${colorToHex(groundColors[1])})`
          }}
        >
          <div className="absolute top-0.5 right-0.5 bg-black/60 px-1 py-0.5 rounded text-[8px] text-void-300">
            {map.width}x{map.height}
          </div>
          <div className="absolute bottom-0.5 left-0.5 bg-black/60 px-1 py-0.5 rounded text-[8px] capitalize"
               style={{ color: accentColor }}>
            {map.biome || 'grassland'}
          </div>
        </div>

        <div className="px-1.5 py-1 bg-void-950">
          <h3 className="font-display text-white text-[10px] leading-tight">{map.name}</h3>
        </div>
      </button>

      {/* Edit button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="absolute bottom-1 right-1 px-1 py-0.5 bg-void-700/80 hover:bg-void-600
                   text-void-200 text-[8px] rounded transition-colors backdrop-blur-sm"
        title="Edit map"
      >
        Edit
      </button>

      {isSelected && (
        <div className="absolute top-0.5 left-0.5 bg-void-500 text-white px-1 py-0.5 rounded text-[8px] font-bold">
          ✓
        </div>
      )}
    </div>
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
  isLocalPlayer,
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
  isLocalPlayer: boolean;
}) {
  const selectedColor = PLAYER_COLORS.find(c => c.id === slot.colorId);
  const isActive = slot.type === 'human' || slot.type === 'ai';
  const isGuest = slot.isGuest;

  return (
    <div className="flex flex-col gap-2 p-2 bg-void-900/50 rounded-lg border border-void-800/50">
      <div className="flex items-center gap-2">
        {/* Player number */}
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
             style={{ backgroundColor: hexToCSS(selectedColor?.hex ?? 0x808080), color: '#000' }}>
          {index + 1}
        </div>

        {/* Player type selector */}
        {!isGuest ? (
          <select
            value={slot.type}
            onChange={(e) => onTypeChange(e.target.value as PlayerType)}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[70px]"
          >
            {isLocalPlayer ? (
              <option value="human">You</option>
            ) : (
              <>
                <option value="ai">AI</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </>
            )}
          </select>
        ) : (
          <span className="px-2 py-1 bg-green-800/50 border border-green-600/50 rounded text-green-300 text-xs">
            {slot.guestName || 'Guest'}
          </span>
        )}

        {/* Team selection (only for active players) */}
        {isActive && (
          <select
            value={slot.team}
            onChange={(e) => onTeamChange(Number(e.target.value) as TeamNumber)}
            disabled={isGuest}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[65px]
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderLeftColor: TEAM_COLORS[slot.team].color, borderLeftWidth: '3px' }}
          >
            {Object.entries(TEAM_COLORS).map(([key, { name }]) => (
              <option key={key} value={key}>{name}</option>
            ))}
          </select>
        )}

        {/* Faction (only for active players) */}
        {isActive && (
          <select
            value={slot.faction}
            onChange={(e) => onFactionChange(e.target.value)}
            disabled={isGuest}
            className="bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-xs
                       focus:outline-none focus:border-void-500 cursor-pointer min-w-[80px]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="dominion">Dominion</option>
          </select>
        )}

        {/* AI Difficulty (only for AI) */}
        {slot.type === 'ai' && !isGuest && (
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

        {/* Open slot indicator */}
        {slot.type === 'open' && (
          <span className="text-void-500 text-xs italic">Waiting for player...</span>
        )}

        {/* Color selector (only for active players) */}
        {isActive && (
          <div className="flex gap-1 ml-auto">
            {PLAYER_COLORS.map((color) => {
              const isUsed = usedColors.has(color.id) && slot.colorId !== color.id;
              return (
                <button
                  key={color.id}
                  onClick={() => !isUsed && !isGuest && onColorChange(color.id)}
                  title={color.name}
                  disabled={isUsed || isGuest}
                  className={`w-5 h-5 rounded-full transition-all duration-200
                    ${slot.colorId === color.id
                      ? 'ring-2 ring-white scale-110'
                      : isUsed || isGuest
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
        {canRemove && !isLocalPlayer && (
          <button
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center text-void-500 hover:text-red-400
                       hover:bg-red-900/30 rounded transition-colors"
            title={isGuest ? 'Kick player' : 'Remove player'}
          >
            ✕
          </button>
        )}
      </div>
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
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);
  const toggleMusic = useUIStore((state) => state.toggleMusic);
  const isFullscreen = useUIStore((state) => state.isFullscreen);
  const toggleFullscreen = useUIStore((state) => state.toggleFullscreen);
  const setFullscreen = useUIStore((state) => state.setFullscreen);

  // Join lobby modal state
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('Player');

  const handleMusicToggle = useCallback(() => {
    toggleMusic();
    const newEnabled = !musicEnabled;
    MusicPlayer.setMuted(!newEnabled);
    if (!newEnabled) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.resume();
    }
  }, [toggleMusic, musicEnabled]);

  // Continue menu music (or start if navigated directly here)
  useEffect(() => {
    const continueMenuMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabled);
      await MusicPlayer.discoverTracks();
      // Only start if not already playing menu music
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };

    continueMenuMusic();
    // Don't stop on unmount - music stops when game starts
  }, []);

  // Sync volume changes
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    setFullscreen(!!document.fullscreenElement);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

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
    fillOpenSlotWithGuest,
    removeGuest,
    startGame,
  } = useGameSetupStore();

  // Lobby hook with callbacks for guest management
  const handleGuestJoin = useCallback((guestName: string) => {
    return fillOpenSlotWithGuest(guestName);
  }, [fillOpenSlotWithGuest]);

  const handleGuestLeave = useCallback((slotId: string) => {
    removeGuest(slotId);
  }, [removeGuest]);

  const {
    status: lobbyStatus,
    lobbyCode,
    error: lobbyError,
    guests,
    hostConnection,
    isHost,
    joinLobby,
    leaveLobby,
    kickGuest,
  } = useLobby(handleGuestJoin, handleGuestLeave);

  // Multiplayer store for game
  const {
    setMultiplayer,
    setConnected,
    setHost,
    setDataChannel,
  } = useMultiplayerStore();

  // Check if we have any open slots
  const hasOpenSlot = playerSlots.some(s => s.type === 'open');
  const hasGuests = guests.length > 0;

  // When connected as guest, set up multiplayer store
  useEffect(() => {
    if (lobbyStatus === 'connected' && hostConnection) {
      setMultiplayer(true);
      setConnected(true);
      setHost(false);
      setDataChannel(hostConnection);
    }
  }, [lobbyStatus, hostConnection, setMultiplayer, setConnected, setHost, setDataChannel]);

  // When hosting with connected guests, set up multiplayer
  useEffect(() => {
    if (isHost && guests.some(g => g.dataChannel)) {
      setMultiplayer(true);
      setConnected(true);
      setHost(true);
      // For multiple guests, we'd need to handle multiple channels
      const firstConnectedGuest = guests.find(g => g.dataChannel);
      if (firstConnectedGuest?.dataChannel) {
        setDataChannel(firstConnectedGuest.dataChannel);
      }
    }
  }, [isHost, guests, setMultiplayer, setConnected, setHost, setDataChannel]);

  const [mapSearch, setMapSearch] = useState('');
  const allMaps = Object.values(ALL_MAPS);
  const maps = allMaps.filter(map =>
    map.name.toLowerCase().includes(mapSearch.toLowerCase()) ||
    map.biome?.toLowerCase().includes(mapSearch.toLowerCase())
  );
  const selectedMap = ALL_MAPS[selectedMapId] || allMaps[0];

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

  const handleJoinLobby = async () => {
    if (joinCode.length === 4) {
      await joinLobby(joinCode, playerName);
      setShowJoinModal(false);
    }
  };

  // Limit players to map's maxPlayers, and global max of 8
  const maxPlayersForMap = selectedMap.maxPlayers;
  const canAddPlayer = playerSlots.length < maxPlayersForMap && playerSlots.length < 8;
  const canRemovePlayer = playerSlots.length > 2;

  // Determine if we're in guest mode (joined someone else's lobby)
  const isGuestMode = lobbyStatus === 'connected' && !isHost;

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
            <h1 className="font-display text-2xl text-white">
              {isGuestMode ? 'Joining Lobby' : 'Game Setup'}
            </h1>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-3">
            {/* Join Game button (only when hosting) */}
            {isHost && lobbyStatus === 'hosting' && (
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-2 bg-void-700 hover:bg-void-600 text-white text-sm rounded-lg
                           border border-void-600 transition-colors"
              >
                Join Game
              </button>
            )}

            {/* Leave lobby button (when guest) */}
            {isGuestMode && (
              <button
                onClick={leaveLobby}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-300 text-sm rounded-lg
                           border border-red-700/50 transition-colors"
              >
                Leave Lobby
              </button>
            )}

            <button
              onClick={handleMusicToggle}
              className="w-10 h-10 rounded-full flex items-center justify-center
                       bg-white/5 hover:bg-white/10 border border-white/10
                       transition-all duration-200 hover:scale-105 hover:border-void-500/50"
              title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
            >
              <span className="text-base">{musicEnabled ? '🔊' : '🔇'}</span>
            </button>
            <button
              onClick={toggleFullscreen}
              className="w-10 h-10 rounded-full flex items-center justify-center
                       bg-white/5 hover:bg-white/10 border border-white/10
                       transition-all duration-200 hover:scale-105 hover:border-void-500/50"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              <span className="text-base">{isFullscreen ? '⛶' : '⛶'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Players Section - Takes 2 columns on left */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-lg text-white">
                Players ({activePlayerCount}/{maxPlayersForMap})
              </h2>
              {!isGuestMode && (
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
              )}
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
                  onRemove={() => {
                    if (slot.isGuest) {
                      // Find the guest and kick them
                      const guest = guests.find(g => g.slotId === slot.id);
                      if (guest) kickGuest(guest.pubkey);
                    } else {
                      removePlayerSlot(slot.id);
                    }
                  }}
                  canRemove={canRemovePlayer && !isGuestMode}
                  isLocalPlayer={index === 0 && !isGuestMode}
                />
              ))}
            </div>
          </div>

          {/* Right Column - Lobby Code, Maps and Settings */}
          <div className="space-y-4">
            {/* Lobby Code Section - Only show when hosting */}
            {isHost && (
              <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-4">
                <h2 className="font-display text-lg text-white mb-2">Lobby Code</h2>
                {lobbyStatus === 'initializing' && (
                  <p className="text-void-400 text-sm">Generating code...</p>
                )}
                {lobbyStatus === 'hosting' && lobbyCode && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <span className="px-4 py-2 bg-void-700 rounded-lg font-mono text-2xl text-white tracking-widest">
                        {lobbyCode}
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(lobbyCode)}
                        className="px-3 py-2 bg-void-800 hover:bg-void-700 text-void-300 text-xs rounded transition"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-void-500 text-xs">
                      Share this code with friends to let them join your lobby
                    </p>
                    {hasOpenSlot && (
                      <p className="text-green-400/70 text-xs">
                        Waiting for players to join open slots...
                      </p>
                    )}
                    {hasGuests && (
                      <p className="text-green-400 text-xs">
                        {guests.length} player{guests.length > 1 ? 's' : ''} connected
                      </p>
                    )}
                  </div>
                )}
                {lobbyStatus === 'error' && (
                  <p className="text-red-400 text-sm">{lobbyError || 'Failed to create lobby'}</p>
                )}
              </div>
            )}

            {/* Guest mode indicator */}
            {isGuestMode && (
              <div className="bg-green-900/30 rounded-lg border border-green-700/50 p-4">
                <h2 className="font-display text-lg text-green-300 mb-1">Connected to Lobby</h2>
                <p className="text-green-400/70 text-xs">
                  Waiting for host to start the game...
                </p>
              </div>
            )}

            {/* Map Selection - Compact (only for host) */}
            {!isGuestMode && (
              <div>
                <h2 className="font-display text-lg text-white mb-2">Select Map</h2>
                {/* Search box */}
                <input
                  type="text"
                  value={mapSearch}
                  onChange={(e) => setMapSearch(e.target.value)}
                  placeholder="Search maps..."
                  className="w-full bg-void-900 border border-void-700 rounded px-2 py-1 text-white text-xs
                             placeholder:text-void-500 focus:outline-none focus:border-void-500 mb-2"
                />
                {/* Scrollable map grid - max 2 rows visible */}
                <div className="max-h-[140px] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-1.5">
                    {maps.map((map) => (
                      <MapPreview
                        key={map.id}
                        map={map}
                        isSelected={selectedMapId === map.id}
                        onSelect={() => handleMapSelect(map.id)}
                        onEdit={() => router.push(`/game/setup/editor?map=${map.id}`)}
                      />
                    ))}
                  </div>
                </div>

                {/* Selected map details */}
                <div className="mt-2 p-2 bg-void-900/50 rounded-lg border border-void-800/50">
                  <div className="flex items-center justify-between mb-0.5">
                    <h3 className="font-display text-sm text-white">{selectedMap.name}</h3>
                    <span className="text-void-400 text-[10px]">{selectedMap.width}x{selectedMap.height} • {selectedMap.maxPlayers}P</span>
                  </div>
                  <p className="text-void-400 text-[10px] line-clamp-2">{selectedMap.description}</p>
                </div>
              </div>
            )}

            {/* Game Settings (only for host) */}
            {!isGuestMode && (
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
            )}

            {/* Start Game Button (only for host) */}
            {!isGuestMode && (
              <>
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
              </>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Join Lobby Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-void-900 border border-void-700 rounded-lg p-6 max-w-sm w-full mx-4">
            <h2 className="font-display text-xl text-white mb-4">Join Game</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-void-300 text-sm mb-1">Your Name</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full bg-void-800 border border-void-600 rounded px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-void-300 text-sm mb-1">Lobby Code</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="XXXX"
                  maxLength={4}
                  className="w-full bg-void-800 border border-void-600 rounded px-3 py-2 text-white
                             font-mono text-2xl text-center tracking-widest uppercase"
                />
              </div>

              {lobbyStatus === 'joining' && (
                <p className="text-void-400 text-sm text-center">Looking for lobby...</p>
              )}

              {lobbyError && (
                <p className="text-red-400 text-sm text-center">{lobbyError}</p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowJoinModal(false)}
                className="flex-1 px-4 py-2 bg-void-800 hover:bg-void-700 text-white rounded transition"
              >
                Cancel
              </button>
              <button
                onClick={handleJoinLobby}
                disabled={joinCode.length !== 4 || lobbyStatus === 'joining'}
                className="flex-1 px-4 py-2 bg-void-500 hover:bg-void-400 disabled:bg-void-700
                           disabled:cursor-not-allowed text-white rounded transition"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
