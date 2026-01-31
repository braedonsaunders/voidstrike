'use client';

import { useEffect, useState } from 'react';
import { usePublicLobbies, PublicLobby } from '@/hooks/usePublicLobbies';

interface LobbyBrowserProps {
  onJoin: (code: string) => void;
  onClose: () => void;
  playerName: string;
}

export function LobbyBrowser({ onJoin, onClose, playerName: _playerName }: LobbyBrowserProps) {
  const { lobbies, isLoading, error, refresh, startBrowsing, stopBrowsing } = usePublicLobbies();
  const [filter, setFilter] = useState<'all' | 'available'>('available');

  useEffect(() => {
    startBrowsing();
    return () => stopBrowsing();
  }, [startBrowsing, stopBrowsing]);

  const filteredLobbies = lobbies.filter(lobby => {
    if (filter === 'available') {
      return lobby.currentPlayers < lobby.maxPlayers;
    }
    return true;
  });

  // Sort by most recent first
  const sortedLobbies = [...filteredLobbies].sort((a, b) => b.createdAt - a.createdAt);

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor(Date.now() / 1000) - timestamp;
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-void-900 border border-void-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-void-700">
          <h2 className="text-lg font-bold text-void-100 flex items-center gap-2">
            <span className="text-xl">🌐</span>
            Public Lobbies
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="px-3 py-1.5 bg-void-800 hover:bg-void-700 border border-void-600 rounded text-sm text-void-200 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-void-400 hover:text-void-200 hover:bg-void-800 rounded transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-4 p-3 border-b border-void-800 bg-void-900/50">
          <label className="flex items-center gap-2 text-sm text-void-300">
            <input
              type="checkbox"
              checked={filter === 'available'}
              onChange={(e) => setFilter(e.target.checked ? 'available' : 'all')}
              className="w-4 h-4 rounded border-void-600 bg-void-800 text-plasma-500 focus:ring-plasma-500"
            />
            Show available only
          </label>
          <span className="text-void-500 text-sm">
            {sortedLobbies.length} {sortedLobbies.length === 1 ? 'lobby' : 'lobbies'} found
          </span>
        </div>

        {/* Lobby list */}
        <div className="flex-1 overflow-y-auto p-2">
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-700/50 rounded text-red-300 text-sm mb-2">
              {error}
            </div>
          )}

          {isLoading && sortedLobbies.length === 0 && (
            <div className="flex items-center justify-center py-12 text-void-400">
              <div className="flex flex-col items-center gap-2">
                <div className="animate-spin w-6 h-6 border-2 border-void-600 border-t-plasma-500 rounded-full" />
                <span className="text-sm">Searching for lobbies...</span>
              </div>
            </div>
          )}

          {!isLoading && sortedLobbies.length === 0 && (
            <div className="flex items-center justify-center py-12 text-void-400">
              <div className="flex flex-col items-center gap-2">
                <span className="text-3xl">🔍</span>
                <span className="text-sm">No public lobbies found</span>
                <span className="text-xs text-void-500">Try again later or create your own!</span>
              </div>
            </div>
          )}

          {sortedLobbies.length > 0 && (
            <div className="space-y-2">
              {sortedLobbies.map((lobby) => (
                <LobbyRow
                  key={lobby.id}
                  lobby={lobby}
                  onJoin={() => onJoin(lobby.code)}
                  formatTimeAgo={formatTimeAgo}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-void-800 bg-void-900/50 text-xs text-void-500 text-center">
          Lobbies are discovered via Nostr relays. Make your lobby public to appear here.
        </div>
      </div>
    </div>
  );
}

function LobbyRow({
  lobby,
  onJoin,
  formatTimeAgo,
}: {
  lobby: PublicLobby;
  onJoin: () => void;
  formatTimeAgo: (timestamp: number) => string;
}) {
  const isFull = lobby.currentPlayers >= lobby.maxPlayers;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded border transition-colors ${
        isFull
          ? 'bg-void-900/30 border-void-800 opacity-60'
          : 'bg-void-800/50 border-void-700 hover:border-void-600'
      }`}
    >
      {/* Host info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-void-100 truncate">{lobby.hostName}</span>
          <span className="text-xs text-void-500 px-1.5 py-0.5 bg-void-800 rounded">
            {lobby.code}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-void-400">
          <span className="truncate">{lobby.mapName}</span>
          <span className="text-void-600">•</span>
          <span>{formatTimeAgo(lobby.createdAt)}</span>
        </div>
      </div>

      {/* Players */}
      <div className="flex items-center gap-1 text-sm">
        <span className={isFull ? 'text-red-400' : 'text-green-400'}>
          {lobby.currentPlayers}/{lobby.maxPlayers}
        </span>
        <span className="text-void-500">players</span>
      </div>

      {/* Join button */}
      <button
        onClick={onJoin}
        disabled={isFull}
        className={`px-4 py-2 rounded font-medium text-sm transition-colors ${
          isFull
            ? 'bg-void-800 text-void-500 cursor-not-allowed'
            : 'bg-plasma-600 hover:bg-plasma-500 text-white'
        }`}
      >
        {isFull ? 'Full' : 'Join'}
      </button>
    </div>
  );
}
