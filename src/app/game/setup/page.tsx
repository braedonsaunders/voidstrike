'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ALL_MAPS } from '@/data/maps';
import { useGameSetupStore, type PlayerSlot } from '@/store/gameSetupStore';
import { LobbyBrowser } from '@/components/lobby/LobbyBrowser';

// Extracted components
import {
  MapPreview,
  PlayerSlotRow,
  SettingSelect,
  JoinLobbyModal,
} from '@/components/game-setup';

// Extracted hooks
import { useGameSetupMusic } from '@/hooks/useGameSetupMusic';
import { useLobbySync } from '@/hooks/useLobbySync';
import { useGameStart } from '@/hooks/useGameStart';

export default function GameSetupPage() {
  const router = useRouter();

  // UI state
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showLobbyBrowser, setShowLobbyBrowser] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('Player');
  const [codeCopied, setCodeCopied] = useState(false);
  const [isPublicLobby, setIsPublicLobby] = useState(false);
  const [mapSearch, setMapSearch] = useState('');

  // Music and fullscreen
  const {
    musicEnabled,
    isFullscreen,
    handleMusicToggle,
    toggleFullscreen,
  } = useGameSetupMusic();

  // Lobby sync (multiplayer)
  const {
    displayPlayerSlots,
    displayMapId,
    displayStartingResources,
    displayGameSpeed,
    displayFogOfWar,
    displayActivePlayerCount,
    isGuestMode,
    isHost,
    lobbyStatus,
    lobbyCode,
    lobbyError,
    guests,
    hasOpenSlot,
    hasGuests,
    guestSlotCount,
    connectedGuestCount,
    mySlotId,
    joinLobby,
    leaveLobby,
    kickGuest,
    sendGameStart,
  } = useLobbySync({ playerName, isPublicLobby });

  // Game start handling
  const { startGameError, handleStartGame } = useGameStart({
    guestSlotCount,
    connectedGuestCount,
    sendGameStart,
  });

  // Game setup store (for host controls)
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
    setPlayerSlotName,
    addPlayerSlot,
    removePlayerSlot,
  } = useGameSetupStore();

  // Map filtering
  const allMaps = Object.values(ALL_MAPS);
  const lobbyMaps = allMaps.filter(map => !map.isSpecialMode);
  const maps = lobbyMaps.filter(map =>
    map.name.toLowerCase().includes(mapSearch.toLowerCase()) ||
    map.biome?.toLowerCase().includes(mapSearch.toLowerCase())
  );
  const selectedMap = ALL_MAPS[selectedMapId] || lobbyMaps[0];
  const displayMap = ALL_MAPS[displayMapId] || lobbyMaps[0];

  // Get used colors for duplicate prevention
  const usedColors = new Set(
    playerSlots
      .filter((s: PlayerSlot) => s.type === 'human' || s.type === 'ai')
      .map((s: PlayerSlot) => s.colorId)
  );

  // Count active players
  const activePlayerCount = playerSlots.filter((s: PlayerSlot) => s.type === 'human' || s.type === 'ai').length;

  // Player slot limits
  const maxPlayersForMap = selectedMap.maxPlayers;
  const canAddPlayer = playerSlots.length < maxPlayersForMap && playerSlots.length < 8;
  const canRemovePlayer = playerSlots.length > 2;

  // Handle map selection - trim excess players if new map has fewer slots
  const handleMapSelect = (mapId: string) => {
    const newMap = ALL_MAPS[mapId];
    if (newMap) {
      setSelectedMap(mapId);
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

  const handleJoinLobby = async () => {
    if (joinCode.length === 4) {
      await joinLobby(joinCode, playerName);
    }
  };

  // Close join modal when connected
  useEffect(() => {
    if (lobbyStatus === 'connected' && showJoinModal) {
      setShowJoinModal(false);
    }
  }, [lobbyStatus, showJoinModal]);

  // Sync player name with first slot
  const firstSlotId = playerSlots[0]?.id;
  const firstSlotName = playerSlots[0]?.name;
  useEffect(() => {
    if (firstSlotId && !isGuestMode && playerName !== firstSlotName) {
      setPlayerSlotName(firstSlotId, playerName);
    }
  }, [playerName, firstSlotId, firstSlotName, isGuestMode, setPlayerSlotName]);

  return (
    <main className="h-screen bg-black overflow-hidden flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 bg-gradient-to-b from-void-950/50 via-black to-black" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(132,61,255,0.1),transparent_70%)]" />

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        <div className="max-w-6xl w-full mx-auto px-6 py-3 flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div>
              <Link href="/" className="text-void-400 hover:text-void-300 text-sm mb-0.5 inline-block">
                &larr; Back to Menu
              </Link>
              <h1 className="font-display text-xl text-white">
                {isGuestMode ? 'Joining Lobby' : 'Game Setup'}
              </h1>
            </div>

            {/* Header actions */}
            <div className="flex items-center gap-3">
              {isHost && lobbyStatus === 'hosting' && (
                <>
                  <button
                    onClick={() => setShowLobbyBrowser(true)}
                    className="px-4 py-2 bg-plasma-700 hover:bg-plasma-600 text-white text-sm rounded-lg
                               border border-plasma-600 transition-colors"
                  >
                    Browse Lobbies
                  </button>
                  <button
                    onClick={() => setShowJoinModal(true)}
                    className="px-4 py-2 bg-void-700 hover:bg-void-600 text-white text-sm rounded-lg
                               border border-void-600 transition-colors"
                  >
                    Join Game
                  </button>
                </>
              )}

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
                className="w-9 h-9 rounded-full flex items-center justify-center
                         bg-white/5 hover:bg-white/10 border border-white/10
                         transition-all duration-200 hover:scale-105 hover:border-void-500/50"
                title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
              >
                <span className="text-sm">{musicEnabled ? '🔊' : '🔇'}</span>
              </button>
              <button
                onClick={toggleFullscreen}
                className="w-9 h-9 rounded-full flex items-center justify-center
                         bg-white/5 hover:bg-white/10 border border-white/10
                         transition-all duration-200 hover:scale-105 hover:border-void-500/50"
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                <span className="text-sm">{isFullscreen ? '⛶' : '⛶'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
            {/* Players Section */}
            <div className="lg:col-span-2 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h2 className="font-display text-base text-white">
                  Players ({displayActivePlayerCount}/{displayMap.maxPlayers})
                </h2>
                {!isGuestMode && (
                  <button
                    onClick={addPlayerSlot}
                    disabled={!canAddPlayer}
                    className={`text-xs px-2 py-1 rounded border transition-colors
                      ${canAddPlayer
                        ? 'text-void-400 hover:text-void-300 border-void-700 hover:border-void-500'
                        : 'text-void-600 border-void-800 cursor-not-allowed opacity-50'
                      }`}
                  >
                    + Add Player
                  </button>
                )}
              </div>
              <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0 pr-1">
                {displayPlayerSlots.map((slot, index) => (
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
                        const guest = guests.find(g => g.slotId === slot.id);
                        if (guest) kickGuest(guest.pubkey);
                      } else {
                        removePlayerSlot(slot.id);
                      }
                    }}
                    canRemove={canRemovePlayer && !isGuestMode}
                    isLocalPlayer={isGuestMode ? slot.id === mySlotId : false}
                  />
                ))}
              </div>
            </div>

            {/* Right Column */}
            <div className="flex flex-col gap-3 min-h-0">
              {/* Multiplayer Section (host only) */}
              {isHost && (
                <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-3 flex-shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-display text-base text-white">Multiplayer</h2>
                    {lobbyStatus === 'initializing' && (
                      <span className="text-void-500 text-xs">...</span>
                    )}
                    {lobbyStatus === 'hosting' && lobbyCode && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(lobbyCode);
                          setCodeCopied(true);
                          setTimeout(() => setCodeCopied(false), 1500);
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 bg-void-700 hover:bg-void-600 rounded transition group relative"
                        title="Click to copy"
                      >
                        <span className="font-mono text-base text-white tracking-wider">{lobbyCode}</span>
                        {codeCopied ? (
                          <span className="text-green-400 text-[10px] animate-pulse">Copied!</span>
                        ) : (
                          <span className="text-void-400 group-hover:text-void-300 text-[10px]">📋</span>
                        )}
                      </button>
                    )}
                    {lobbyStatus === 'error' && (
                      <span className="text-red-400 text-xs">Error</span>
                    )}
                  </div>

                  <div className="mb-2">
                    <label className="block text-void-400 text-[10px] mb-0.5">Your Name</label>
                    <input
                      type="text"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full bg-void-800 border border-void-700 rounded px-2 py-1 text-white text-sm
                                 focus:outline-none focus:border-void-500"
                    />
                  </div>

                  <div className="mb-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={isPublicLobby}
                        onChange={(e) => setIsPublicLobby(e.target.checked)}
                        className="w-4 h-4 rounded border-void-600 bg-void-800 text-plasma-500
                                   focus:ring-plasma-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-void-300 text-xs group-hover:text-void-200 transition-colors">
                        Make lobby public
                      </span>
                    </label>
                    {isPublicLobby && (
                      <p className="text-plasma-400/70 text-[10px] mt-0.5 ml-6">
                        Your lobby will appear in the public browser
                      </p>
                    )}
                  </div>

                  <p className="text-void-500 text-[10px]">
                    Share code with friends. Set slot to "Open" to let them join.
                  </p>

                  {hasOpenSlot && (
                    <p className="text-green-400/70 text-[10px] mt-0.5">
                      Waiting for players...
                    </p>
                  )}
                  {hasGuests && (
                    <p className="text-green-400 text-[10px] mt-0.5">
                      {guests.length} player{guests.length > 1 ? 's' : ''} connected
                    </p>
                  )}
                </div>
              )}

              {/* Guest mode indicator */}
              {isGuestMode && (
                <div className="flex flex-col gap-3">
                  <div className="bg-green-900/30 rounded-lg border border-green-700/50 p-3 flex-shrink-0">
                    <h2 className="font-display text-base text-green-300 mb-0.5">Connected to Lobby</h2>
                    <p className="text-green-400/70 text-[10px]">
                      Waiting for host to start the game...
                    </p>
                  </div>

                  {/* Map display for guest (read-only) */}
                  <div className="flex-shrink-0">
                    <h2 className="font-display text-base text-white mb-1">Map</h2>
                    <div className="p-2 bg-void-900/50 rounded-lg border border-void-800/50">
                      <div className="flex items-center justify-between mb-0.5">
                        <h3 className="font-display text-xs text-white">{displayMap.name}</h3>
                        <span className="text-void-400 text-[10px]">{displayMap.width}x{displayMap.height} • {displayMap.maxPlayers}P</span>
                      </div>
                      <p className="text-void-400 text-[10px] line-clamp-1">{displayMap.description}</p>
                    </div>
                  </div>

                  {/* Settings display for guest (read-only) */}
                  <div className="flex-shrink-0">
                    <h2 className="font-display text-base text-white mb-1">Game Settings</h2>
                    <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-2 space-y-1 text-xs">
                      <div className="flex items-center justify-between text-void-300">
                        <span>Starting Resources</span>
                        <span className="text-white capitalize">{displayStartingResources}</span>
                      </div>
                      <div className="flex items-center justify-between text-void-300">
                        <span>Game Speed</span>
                        <span className="text-white capitalize">{displayGameSpeed}</span>
                      </div>
                      <div className="flex items-center justify-between text-void-300">
                        <span>Fog of War</span>
                        <span className="text-white">{displayFogOfWar ? 'On' : 'Off'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Map Selection (host only) */}
              {!isGuestMode && (
                <div className="flex-1 flex flex-col min-h-0">
                  <h2 className="font-display text-base text-white mb-1 flex-shrink-0">Select Map</h2>
                  <input
                    type="text"
                    value={mapSearch}
                    onChange={(e) => setMapSearch(e.target.value)}
                    placeholder="Search maps..."
                    className="w-full bg-void-900 border border-void-700 rounded px-2 py-1 text-white text-xs
                               placeholder:text-void-500 focus:outline-none focus:border-void-500 mb-1 flex-shrink-0"
                  />
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="grid grid-cols-2 gap-1">
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

                  <div className="mt-1 p-1.5 bg-void-900/50 rounded-lg border border-void-800/50 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-xs text-white">{selectedMap.name}</h3>
                      <span className="text-void-400 text-[10px]">{selectedMap.width}x{selectedMap.height} • {selectedMap.maxPlayers}P</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Game Settings (host only) */}
              {!isGuestMode && (
                <div className="flex-shrink-0">
                  <h2 className="font-display text-base text-white mb-1">Game Settings</h2>
                  <div className="bg-void-900/50 rounded-lg border border-void-800/50 p-2">
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
                </div>
              )}

              {/* Start Game Button (host only) */}
              {!isGuestMode && (
                <div className="flex-shrink-0">
                  <button
                    onClick={handleStartGame}
                    disabled={activePlayerCount < 2 || (guestSlotCount > 0 && connectedGuestCount < guestSlotCount)}
                    className="w-full game-button-primary text-base px-6 py-2 font-display disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Start Game
                  </button>

                  {activePlayerCount < 2 && (
                    <p className="text-center text-red-400 text-[10px] mt-1">
                      At least 2 players required
                    </p>
                  )}
                  {activePlayerCount >= 2 && guestSlotCount > 0 && connectedGuestCount < guestSlotCount && (
                    <p className="text-center text-yellow-400 text-[10px] mt-1">
                      Waiting for {guestSlotCount - connectedGuestCount} guest(s) to connect...
                    </p>
                  )}
                  {startGameError && (
                    <p className="text-center text-red-400 text-[10px] mt-1">
                      {startGameError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Join Lobby Modal */}
      {showJoinModal && (
        <JoinLobbyModal
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          joinCode={joinCode}
          onJoinCodeChange={setJoinCode}
          lobbyStatus={lobbyStatus}
          lobbyError={lobbyError}
          onJoin={handleJoinLobby}
          onClose={() => setShowJoinModal(false)}
        />
      )}

      {/* Lobby Browser Modal */}
      {showLobbyBrowser && (
        <LobbyBrowser
          onJoin={(code) => {
            setJoinCode(code);
            setShowLobbyBrowser(false);
            setShowJoinModal(true);
          }}
          onClose={() => setShowLobbyBrowser(false)}
          playerName={playerName}
        />
      )}
    </main>
  );
}
