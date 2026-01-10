'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import { useAuth } from '@/hooks/useAuth';
import { useLobbyBrowser, useLobby } from '@/hooks/useLobby';
import { AuthModal } from '@/components/auth/AuthModal';
import { getOnlinePlayerCount } from '@/lib/auth';
import type { Lobby } from '@/engine/network/types';

export default function LobbyPage() {
  const router = useRouter();
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);

  // Auth state
  const {
    user,
    profile,
    isLoading: authLoading,
    isAuthenticated,
    isMultiplayerEnabled,
  } = useAuth();

  // Lobby browser
  const { lobbies, isLoading: lobbiesLoading } = useLobbyBrowser();

  // Lobby actions (for creating/joining)
  const {
    create: createLobby,
    join: joinLobby,
    isLoading: lobbyActionLoading,
    error: lobbyError,
  } = useLobby(user?.id || null);

  // UI state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [selectedLobby, setSelectedLobby] = useState<Lobby | null>(null);

  // Continue menu music
  useEffect(() => {
    const continueMenuMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabled);
      await MusicPlayer.discoverTracks();
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };

    continueMenuMusic();
  }, []);

  // Sync volume changes
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  // Fetch online player count
  useEffect(() => {
    const fetchOnlineCount = async () => {
      const count = await getOnlinePlayerCount();
      setOnlineCount(count);
    };

    fetchOnlineCount();
    const interval = setInterval(fetchOnlineCount, 30000); // Update every 30s

    return () => clearInterval(interval);
  }, []);

  // Handle create game
  const handleCreateGame = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!profile) return;

    const lobby = await createLobby(
      user!.id,
      profile.username,
      profile.elo_rating
    );

    if (lobby) {
      router.push(`/lobby/${lobby.code}`);
    }
  };

  // Handle join by code
  const handleJoinByCode = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!profile || !joinCode.trim()) return;

    const lobby = await joinLobby(
      joinCode.trim().toUpperCase(),
      user!.id,
      profile.username,
      profile.elo_rating
    );

    if (lobby) {
      router.push(`/lobby/${lobby.code}`);
    }
  };

  // Handle join from list
  const handleJoinLobby = async (lobby: Lobby) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!profile) return;

    const joined = await joinLobby(
      lobby.code,
      user!.id,
      profile.username,
      profile.elo_rating
    );

    if (joined) {
      router.push(`/lobby/${lobby.code}`);
    }
  };

  // Quick match (create public lobby)
  const handleQuickMatch = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!profile) return;

    // For now, quick match just creates a public lobby
    // TODO: Implement proper matchmaking queue
    const lobby = await createLobby(
      user!.id,
      profile.username,
      profile.elo_rating,
      { isRanked: false },
      false // public
    );

    if (lobby) {
      router.push(`/lobby/${lobby.code}`);
    }
  };

  const isLoading = authLoading || lobbyActionLoading;

  return (
    <main className="min-h-screen bg-black p-8">
      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => setShowAuthModal(false)}
      />

      {/* Join Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="game-panel p-8 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl text-void-300">Join Game</h2>
              <button
                onClick={() => setShowJoinModal(false)}
                className="text-void-500 hover:text-void-300 text-2xl"
              >
                &times;
              </button>
            </div>

            {lobbyError && (
              <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-2 mb-4 text-red-400 text-sm">
                {lobbyError}
              </div>
            )}

            <div className="mb-6">
              <label className="block text-void-500 text-sm mb-2">Game Code</label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="Enter 6-letter code"
                className="w-full bg-void-900 border border-void-700 rounded px-4 py-3 text-void-200 text-center text-2xl tracking-widest font-mono focus:border-void-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowJoinModal(false)}
                className="game-button flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleJoinByCode}
                disabled={joinCode.length !== 6 || isLoading}
                className="game-button-primary flex-1 disabled:opacity-50"
              >
                {isLoading ? 'Joining...' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-void-500 hover:text-void-400 transition">
              ← Back to Menu
            </Link>
            <h1 className="font-display text-4xl text-void-300 mt-2">Multiplayer Lobby</h1>
          </div>

          <div className="flex gap-4">
            {!isMultiplayerEnabled ? (
              <div className="text-void-500 text-sm">
                Multiplayer not configured
              </div>
            ) : !isAuthenticated ? (
              <button
                onClick={() => setShowAuthModal(true)}
                className="game-button-primary"
              >
                Sign In to Play
              </button>
            ) : (
              <>
                <button
                  onClick={() => setShowJoinModal(true)}
                  className="game-button"
                >
                  Join by Code
                </button>
                <button
                  onClick={handleCreateGame}
                  disabled={isLoading}
                  className="game-button"
                >
                  {isLoading ? 'Creating...' : 'Create Game'}
                </button>
                <button
                  onClick={handleQuickMatch}
                  disabled={isLoading}
                  className="game-button-primary"
                >
                  Quick Match
                </button>
              </>
            )}
          </div>
        </div>

        {lobbyError && !showJoinModal && (
          <div className="bg-red-900/30 border border-red-500/50 rounded px-4 py-2 mb-4 text-red-400 text-sm">
            {lobbyError}
          </div>
        )}

        {/* Room List */}
        <div className="game-panel p-4">
          <div className="grid grid-cols-5 gap-4 text-void-500 text-sm font-medium mb-4 px-4">
            <span>Host</span>
            <span>Map</span>
            <span>Mode</span>
            <span>Players</span>
            <span></span>
          </div>

          <div className="space-y-2">
            {lobbiesLoading ? (
              <div className="text-center py-12 text-void-500">
                Loading games...
              </div>
            ) : lobbies.length === 0 ? (
              <div className="text-center py-12 text-void-500">
                No games available. Create one to get started!
              </div>
            ) : (
              lobbies.map((lobby) => {
                const host = lobby.players.find(p => p.isHost);
                return (
                  <div
                    key={lobby.id}
                    className={`grid grid-cols-5 gap-4 items-center p-4 rounded border transition cursor-pointer
                      ${selectedLobby?.id === lobby.id
                        ? 'border-void-500 bg-void-900/50'
                        : 'border-void-800 hover:border-void-700 hover:bg-void-900/30'
                      }`}
                    onClick={() => setSelectedLobby(lobby)}
                  >
                    <span className="text-void-200">{host?.username || 'Unknown'}</span>
                    <span className="text-void-400">{lobby.settings.mapName}</span>
                    <span className="text-void-400">
                      {lobby.settings.isRanked ? 'Ranked' : 'Casual'} 1v1
                    </span>
                    <span className="text-void-400">
                      {lobby.players.length}/{lobby.settings.maxPlayers}
                    </span>
                    <div className="text-right">
                      <button
                        className="game-button text-sm"
                        disabled={lobby.players.length >= lobby.settings.maxPlayers || isLoading}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJoinLobby(lobby);
                        }}
                      >
                        {lobby.players.length >= lobby.settings.maxPlayers ? 'Full' : 'Join'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Room Details */}
        {selectedLobby && (
          <div className="game-panel p-6 mt-4">
            <h2 className="font-display text-xl text-void-300 mb-4">Game Details</h2>
            <div className="grid grid-cols-3 gap-8">
              <div>
                <label className="block text-void-500 text-sm mb-1">Map</label>
                <div className="text-void-200">{selectedLobby.settings.mapName}</div>
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-1">Game Speed</label>
                <div className="text-void-200">
                  {selectedLobby.settings.gameSpeed === 1 ? 'Normal' :
                   selectedLobby.settings.gameSpeed < 1 ? 'Slower' : 'Faster'}
                </div>
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-1">Starting Resources</label>
                <div className="text-void-200 capitalize">{selectedLobby.settings.startingResources}</div>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-void-500 text-sm mb-2">Players</label>
              <div className="flex gap-2">
                {selectedLobby.players.map((player) => (
                  <div
                    key={player.id}
                    className="bg-void-900 border border-void-700 rounded px-3 py-1 text-sm"
                  >
                    <span className="text-void-200">{player.username}</span>
                    {player.isHost && (
                      <span className="text-void-500 ml-2">(Host)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button
                className="game-button"
                onClick={() => setSelectedLobby(null)}
              >
                Close
              </button>
              <button
                className="game-button-primary"
                disabled={selectedLobby.players.length >= selectedLobby.settings.maxPlayers || isLoading}
                onClick={() => handleJoinLobby(selectedLobby)}
              >
                Join Game
              </button>
            </div>
          </div>
        )}

        {/* Info panel */}
        <div className="grid grid-cols-3 gap-6 mt-8">
          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Your Stats</h3>
            {profile ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-void-500">Username</span>
                  <span className="text-void-200">{profile.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-500">ELO Rating</span>
                  <span className="text-void-200">{profile.elo_rating}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-500">Games Played</span>
                  <span className="text-void-200">{profile.games_played}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-500">Win Rate</span>
                  <span className="text-void-200">
                    {profile.games_played > 0
                      ? `${Math.round((profile.wins / profile.games_played) * 100)}%`
                      : '-'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-void-500 text-sm">
                Sign in to track your stats
              </div>
            )}
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Online Players</h3>
            <div className="text-4xl font-mono text-void-400">{onlineCount}</div>
            <p className="text-void-500 text-sm mt-1">players online</p>
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">How to Play</h3>
            <p className="text-void-500 text-sm">
              Create a game or join an existing one. Share your game code with friends, or use Quick Match to find an opponent automatically.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
