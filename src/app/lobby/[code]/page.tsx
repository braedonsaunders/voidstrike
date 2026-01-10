'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import { useAuth } from '@/hooks/useAuth';
import { useLobby } from '@/hooks/useLobby';
import { PeerManager } from '@/engine/network/PeerManager';
import type { LobbyPlayer, LobbySettings, NetworkState } from '@/engine/network/types';

// Player colors for display
const PLAYER_COLORS = [
  '#4A90D9', // Blue
  '#E74C3C', // Red
  '#2ECC71', // Green
  '#F39C12', // Orange
  '#9B59B6', // Purple
  '#1ABC9C', // Teal
  '#E91E63', // Pink
  '#795548', // Brown
];

// Faction display names
const FACTION_NAMES: Record<string, string> = {
  dominion: 'The Dominion',
  synthesis: 'The Synthesis',
  swarm: 'The Swarm',
};

export default function LobbyRoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);

  // Auth state
  const { user, profile, isAuthenticated } = useAuth();

  // Lobby state
  const {
    lobby,
    isLoading,
    error,
    isConnected,
    isHost,
    localPlayer,
    canStart,
    join,
    leave,
    updatePlayer,
    updateSettings,
    toggleReady,
    startGame,
  } = useLobby(user?.id || null);

  // WebRTC connection state
  const [peerManager, setPeerManager] = useState<PeerManager | null>(null);
  const [networkState, setNetworkState] = useState<NetworkState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // UI state
  const [countdown, setCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Initialize music
  useEffect(() => {
    const initMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabled);
      await MusicPlayer.discoverTracks();
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };
    initMusic();
  }, []);

  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  // Join lobby on mount
  useEffect(() => {
    if (!isAuthenticated || !profile || !user) return;
    if (lobby) return; // Already in a lobby

    join(code, user.id, profile.username, profile.elo_rating);
  }, [isAuthenticated, profile, user, code, join, lobby]);

  // Handle lobby status changes (trigger WebRTC connection)
  useEffect(() => {
    if (!lobby || !localPlayer) return;

    if (lobby.status === 'signaling' && connectionStatus === 'idle') {
      // Start WebRTC connection
      initializeWebRTC();
    }
  }, [lobby?.status, localPlayer, connectionStatus]);

  // Initialize WebRTC connections
  const initializeWebRTC = useCallback(async () => {
    if (!lobby || !localPlayer) return;

    setConnectionStatus('connecting');
    setConnectionError(null);

    const manager = new PeerManager(
      lobby.id,
      localPlayer,
      lobby.players
    );

    manager.onAllConnected = () => {
      setConnectionStatus('connected');
      // Start game after short delay
      setCountdown(3);
    };

    manager.onConnectionFailed = (reason) => {
      setConnectionStatus('failed');
      setConnectionError(reason);
    };

    manager.onNetworkStateChange = (state) => {
      setNetworkState(state);
    };

    setPeerManager(manager);

    const success = await manager.initialize();
    if (!success) {
      setConnectionStatus('failed');
    }
  }, [lobby, localPlayer]);

  // Countdown to game start
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      // Navigate to game
      router.push(`/game?multiplayer=true&lobbyId=${lobby?.id}`);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, lobby?.id, router]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      peerManager?.disconnect();
    };
  }, [peerManager]);

  // Handle leaving
  const handleLeave = async () => {
    peerManager?.disconnect();
    await leave();
    router.push('/lobby');
  };

  // Copy lobby code
  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle start game (host only)
  const handleStartGame = async () => {
    if (!canStart) return;
    await startGame();
  };

  // Render player slot
  const renderPlayerSlot = (slotIndex: number) => {
    const player = lobby?.players.find(p => p.slot === slotIndex);

    if (!player) {
      return (
        <div className="game-panel p-4 border-dashed border-void-700 opacity-50">
          <div className="text-void-600 text-center">Empty Slot</div>
        </div>
      );
    }

    const isLocal = player.id === user?.id;
    const color = PLAYER_COLORS[player.color] || PLAYER_COLORS[0];

    return (
      <div
        className={`game-panel p-4 ${isLocal ? 'border-void-500' : 'border-void-700'}`}
        style={{ borderLeftColor: color, borderLeftWidth: '4px' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-void-200 font-medium">{player.username}</span>
            {player.isHost && (
              <span className="text-xs bg-void-700 text-void-400 px-2 py-0.5 rounded">HOST</span>
            )}
          </div>
          <div className="text-void-500 text-sm">
            {player.eloRating} ELO
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Faction selector */}
          <div>
            <label className="block text-void-600 text-xs mb-1">Faction</label>
            {isLocal ? (
              <select
                value={player.faction}
                onChange={(e) => updatePlayer({ faction: e.target.value })}
                className="w-full bg-void-900 border border-void-700 rounded px-2 py-1 text-void-300 text-sm"
                disabled={player.isReady}
              >
                <option value="dominion">The Dominion</option>
                <option value="synthesis">The Synthesis</option>
                <option value="swarm">The Swarm</option>
              </select>
            ) : (
              <div className="text-void-300 text-sm py-1">
                {FACTION_NAMES[player.faction] || player.faction}
              </div>
            )}
          </div>

          {/* Color selector */}
          <div>
            <label className="block text-void-600 text-xs mb-1">Color</label>
            {isLocal ? (
              <div className="flex gap-1">
                {PLAYER_COLORS.map((c, i) => (
                  <button
                    key={i}
                    className={`w-5 h-5 rounded ${player.color === i ? 'ring-2 ring-white' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => updatePlayer({ color: i })}
                    disabled={player.isReady}
                  />
                ))}
              </div>
            ) : (
              <div
                className="w-5 h-5 rounded"
                style={{ backgroundColor: color }}
              />
            )}
          </div>
        </div>

        {/* Ready status */}
        <div className="mt-3 flex items-center justify-between">
          {isLocal ? (
            <button
              onClick={toggleReady}
              className={`text-sm px-4 py-1 rounded transition ${
                player.isReady
                  ? 'bg-green-600 text-white'
                  : 'bg-void-800 text-void-400 hover:bg-void-700'
              }`}
            >
              {player.isReady ? 'Ready!' : 'Click when ready'}
            </button>
          ) : (
            <div className={`text-sm ${player.isReady ? 'text-green-500' : 'text-void-600'}`}>
              {player.isReady ? 'Ready' : 'Not Ready'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Loading state
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-void-300 text-xl mb-4">Authentication Required</div>
          <Link href="/lobby" className="text-void-500 hover:text-void-400">
            ← Back to Lobby
          </Link>
        </div>
      </main>
    );
  }

  if (isLoading && !lobby) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-void-400 text-lg">Joining lobby...</div>
      </main>
    );
  }

  if (error && !lobby) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">{error}</div>
          <Link href="/lobby" className="text-void-500 hover:text-void-400">
            ← Back to Lobby
          </Link>
        </div>
      </main>
    );
  }

  // WebRTC connecting overlay
  if (connectionStatus === 'connecting' || countdown !== null) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          {countdown !== null ? (
            <>
              <div className="text-6xl font-display text-void-300 mb-4">{countdown}</div>
              <div className="text-void-500">Game starting...</div>
            </>
          ) : (
            <>
              <div className="text-void-300 text-xl mb-4">Connecting to players...</div>
              <div className="text-void-500">
                {peerManager?.connectedPeerCount || 0} / {(lobby?.players.length || 1) - 1} connected
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  if (connectionStatus === 'failed') {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">Connection Failed</div>
          <div className="text-void-500 mb-4">{connectionError}</div>
          <button onClick={handleLeave} className="game-button">
            Back to Lobby
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <button
              onClick={handleLeave}
              className="text-void-500 hover:text-void-400 transition"
            >
              ← Leave Game
            </button>
            <h1 className="font-display text-3xl text-void-300 mt-2">Game Lobby</h1>
          </div>

          {/* Lobby code */}
          <div className="text-right">
            <div className="text-void-500 text-sm mb-1">Game Code</div>
            <button
              onClick={handleCopyCode}
              className="font-mono text-2xl text-void-300 tracking-widest hover:text-void-200 transition"
              title="Click to copy"
            >
              {code}
              {copied && <span className="text-sm text-green-500 ml-2">Copied!</span>}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-2 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Players */}
          <div className="col-span-2 space-y-4">
            <h2 className="font-display text-lg text-void-400">Players</h2>
            <div className="grid grid-cols-2 gap-4">
              {[0, 1].map((slot) => (
                <div key={slot}>{renderPlayerSlot(slot)}</div>
              ))}
            </div>

            {/* Start button (host only) */}
            {isHost && (
              <div className="mt-6">
                <button
                  onClick={handleStartGame}
                  disabled={!canStart}
                  className={`game-button-primary w-full py-3 text-lg ${
                    !canStart ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {canStart ? 'Start Game' : 'Waiting for all players to ready...'}
                </button>
              </div>
            )}

            {!isHost && (
              <div className="mt-6 text-center text-void-500">
                Waiting for host to start the game...
              </div>
            )}
          </div>

          {/* Right: Settings */}
          <div className="space-y-4">
            <h2 className="font-display text-lg text-void-400">Game Settings</h2>

            <div className="game-panel p-4 space-y-4">
              {/* Map */}
              <div>
                <label className="block text-void-500 text-sm mb-1">Map</label>
                {isHost ? (
                  <select
                    value={lobby?.settings.mapId || 'void-assault'}
                    onChange={(e) => updateSettings({
                      mapId: e.target.value,
                      mapName: e.target.options[e.target.selectedIndex].text
                    })}
                    className="w-full bg-void-900 border border-void-700 rounded px-3 py-2 text-void-200"
                  >
                    <option value="void-assault">Void Assault</option>
                    <option value="crystal-valley">Crystal Valley</option>
                    <option value="training-grounds">Training Grounds</option>
                  </select>
                ) : (
                  <div className="text-void-200">{lobby?.settings.mapName}</div>
                )}
              </div>

              {/* Game Speed */}
              <div>
                <label className="block text-void-500 text-sm mb-1">Game Speed</label>
                {isHost ? (
                  <select
                    value={lobby?.settings.gameSpeed || 1}
                    onChange={(e) => updateSettings({ gameSpeed: parseFloat(e.target.value) })}
                    className="w-full bg-void-900 border border-void-700 rounded px-3 py-2 text-void-200"
                  >
                    <option value={0.5}>Slower</option>
                    <option value={1}>Normal</option>
                    <option value={1.5}>Faster</option>
                    <option value={2}>Fastest</option>
                  </select>
                ) : (
                  <div className="text-void-200">
                    {lobby?.settings.gameSpeed === 1 ? 'Normal' :
                     lobby?.settings.gameSpeed === 0.5 ? 'Slower' :
                     lobby?.settings.gameSpeed === 1.5 ? 'Faster' : 'Fastest'}
                  </div>
                )}
              </div>

              {/* Starting Resources */}
              <div>
                <label className="block text-void-500 text-sm mb-1">Starting Resources</label>
                {isHost ? (
                  <select
                    value={lobby?.settings.startingResources || 'normal'}
                    onChange={(e) => updateSettings({
                      startingResources: e.target.value as 'normal' | 'high' | 'insane'
                    })}
                    className="w-full bg-void-900 border border-void-700 rounded px-3 py-2 text-void-200"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="insane">Insane</option>
                  </select>
                ) : (
                  <div className="text-void-200 capitalize">{lobby?.settings.startingResources}</div>
                )}
              </div>

              {/* Fog of War */}
              <div className="flex items-center justify-between">
                <label className="text-void-500 text-sm">Fog of War</label>
                {isHost ? (
                  <button
                    onClick={() => updateSettings({ fogOfWar: !lobby?.settings.fogOfWar })}
                    className={`w-12 h-6 rounded-full transition ${
                      lobby?.settings.fogOfWar ? 'bg-void-500' : 'bg-void-800'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition transform ${
                      lobby?.settings.fogOfWar ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                ) : (
                  <div className="text-void-200">
                    {lobby?.settings.fogOfWar ? 'On' : 'Off'}
                  </div>
                )}
              </div>
            </div>

            {/* Connection status */}
            <div className="game-panel p-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-void-500 text-sm">
                  {isConnected ? 'Connected to lobby' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
