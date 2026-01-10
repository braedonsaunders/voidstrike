'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';

interface LobbyRoom {
  id: string;
  name: string;
  host: string;
  map: string;
  players: number;
  maxPlayers: number;
}

export default function LobbyPage() {
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);

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
  }, []);

  // Sync volume changes
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  const [rooms] = useState<LobbyRoom[]>([
    { id: '1', name: 'Quick Match #1', host: 'Player123', map: 'Void Assault', players: 1, maxPlayers: 2 },
    { id: '2', name: 'Ranked 1v1', host: 'ProGamer', map: 'Crystal Valley', players: 1, maxPlayers: 2 },
    { id: '3', name: 'Practice Room', host: 'NewPlayer', map: 'Training Grounds', players: 1, maxPlayers: 2 },
  ]);

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-black p-8">
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
            <button className="game-button">Create Game</button>
            <button className="game-button-primary">Quick Match</button>
          </div>
        </div>

        {/* Room List */}
        <div className="game-panel p-4">
          <div className="grid grid-cols-5 gap-4 text-void-500 text-sm font-medium mb-4 px-4">
            <span>Room Name</span>
            <span>Host</span>
            <span>Map</span>
            <span>Players</span>
            <span></span>
          </div>

          <div className="space-y-2">
            {rooms.map((room) => (
              <div
                key={room.id}
                className={`grid grid-cols-5 gap-4 items-center p-4 rounded border transition cursor-pointer
                  ${selectedRoom === room.id
                    ? 'border-void-500 bg-void-900/50'
                    : 'border-void-800 hover:border-void-700 hover:bg-void-900/30'
                  }`}
                onClick={() => setSelectedRoom(room.id)}
              >
                <span className="text-void-200">{room.name}</span>
                <span className="text-void-400">{room.host}</span>
                <span className="text-void-400">{room.map}</span>
                <span className="text-void-400">
                  {room.players}/{room.maxPlayers}
                </span>
                <div className="text-right">
                  <button
                    className="game-button text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      // TODO: Join room
                    }}
                  >
                    Join
                  </button>
                </div>
              </div>
            ))}
          </div>

          {rooms.length === 0 && (
            <div className="text-center py-12 text-void-500">
              No games available. Create one to get started!
            </div>
          )}
        </div>

        {/* Room Details */}
        {selectedRoom && (
          <div className="game-panel p-6 mt-4">
            <h2 className="font-display text-xl text-void-300 mb-4">Room Settings</h2>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <label className="block text-void-500 text-sm mb-2">Map</label>
                <select className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200">
                  <option>Void Assault</option>
                  <option>Crystal Valley</option>
                  <option>Training Grounds</option>
                </select>
              </div>
              <div>
                <label className="block text-void-500 text-sm mb-2">Game Speed</label>
                <select className="w-full bg-void-900 border border-void-700 rounded px-4 py-2 text-void-200">
                  <option>Normal</option>
                  <option>Fast</option>
                  <option>Faster</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button
                className="game-button"
                onClick={() => setSelectedRoom(null)}
              >
                Cancel
              </button>
              <Link href="/game" className="game-button-primary">
                Start Game
              </Link>
            </div>
          </div>
        )}

        {/* Info panel */}
        <div className="grid grid-cols-3 gap-6 mt-8">
          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Your Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-void-500">ELO Rating</span>
                <span className="text-void-200">1000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-500">Games Played</span>
                <span className="text-void-200">0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-500">Win Rate</span>
                <span className="text-void-200">-</span>
              </div>
            </div>
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Online Players</h3>
            <div className="text-4xl font-mono text-void-400">127</div>
            <p className="text-void-500 text-sm mt-1">players online</p>
          </div>

          <div className="game-panel p-4">
            <h3 className="font-display text-lg text-void-300 mb-2">Quick Tips</h3>
            <p className="text-void-500 text-sm">
              Use control groups (Ctrl+1-9) to quickly select units. Press the number key to select the group.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
