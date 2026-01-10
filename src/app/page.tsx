'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';

export default function Home() {
  const [hoveredFaction, setHoveredFaction] = useState<string | null>(null);
  const musicEnabled = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);
  const toggleMusic = useUIStore((state) => state.toggleMusic);

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

  // Initialize and play menu music
  useEffect(() => {
    const startMenuMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabled);
      await MusicPlayer.discoverTracks();
      // Only start if not already playing menu music
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };

    startMenuMusic();
    // Don't stop music on unmount - let it continue to game setup
  }, []);

  // Sync volume changes
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  const factions = [
    {
      id: 'dominion',
      name: 'The Dominion',
      description: 'Human military forces. Versatile, adaptive, and masters of siege warfare.',
      color: 'from-blue-600 to-blue-900',
      glow: 'hover:shadow-[0_0_30px_rgba(74,144,217,0.5)]',
    },
    {
      id: 'synthesis',
      name: 'The Synthesis',
      description: 'Transcendent machine consciousness. Powerful units protected by regenerating shields.',
      color: 'from-purple-600 to-purple-900',
      glow: 'hover:shadow-[0_0_30px_rgba(155,89,182,0.5)]',
    },
    {
      id: 'swarm',
      name: 'The Swarm',
      description: 'Organic hive-mind species. Overwhelm enemies with cheap, fast-spawning forces.',
      color: 'from-amber-700 to-amber-950',
      glow: 'hover:shadow-[0_0_30px_rgba(139,69,19,0.5)]',
    },
  ];

  return (
    <main className="min-h-screen bg-black flex flex-col">
      {/* Hero Section */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-4">
        {/* Background effect */}
        <div className="absolute inset-0 bg-gradient-to-b from-void-950/50 via-black to-black" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(132,61,255,0.15),transparent_70%)]" />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(rgba(132,61,255,0.3) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(132,61,255,0.3) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 text-center">
          <h1 className="font-display text-6xl md:text-8xl font-bold tracking-wider mb-4 bg-gradient-to-r from-void-400 via-void-300 to-void-500 bg-clip-text text-transparent animate-pulse-glow">
            VOIDSTRIKE
          </h1>
          <p className="text-void-300 text-lg md:text-xl max-w-2xl mx-auto mb-12 font-light">
            Command your forces. Dominate the void. Zero downloads, pure strategy.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link
              href="/game/setup"
              className="game-button-primary text-lg px-8 py-3"
            >
              Play Now
            </Link>
            <Link
              href="/lobby"
              className="game-button text-lg px-8 py-3"
            >
              Multiplayer
            </Link>
          </div>

          {/* Faction Preview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {factions.map((faction) => (
              <div
                key={faction.id}
                className={`relative overflow-hidden rounded-lg border border-void-800/50
                           bg-gradient-to-br ${faction.color} p-6 transition-all duration-300
                           cursor-pointer ${faction.glow}`}
                onMouseEnter={() => setHoveredFaction(faction.id)}
                onMouseLeave={() => setHoveredFaction(null)}
              >
                <h3 className="font-display text-xl mb-2 text-white">
                  {faction.name}
                </h3>
                <p className={`text-sm text-gray-300 transition-opacity duration-300 ${
                  hoveredFaction === faction.id ? 'opacity-100' : 'opacity-70'
                }`}>
                  {faction.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Music Toggle Button */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-20">
        <button
          onClick={handleMusicToggle}
          className="flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 hover:scale-105"
          style={{
            backgroundColor: 'rgba(10, 10, 15, 0.9)',
            border: `1px solid ${musicEnabled ? '#4a8a4a' : '#8a4a4a'}`,
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
          title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
        >
          {/* Music Icon */}
          <span style={{ fontSize: '16px' }}>
            {musicEnabled ? '🔊' : '🔇'}
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: musicEnabled ? '#8fc88f' : '#c88f8f',
            }}
          >
            Music: {musicEnabled ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-void-600 text-sm border-t border-void-900/50">
        <p>Browser-Based RTS • Built with Next.js & Three.js</p>
      </footer>
    </main>
  );
}
