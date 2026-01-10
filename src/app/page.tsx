'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';

// Dynamically import the Three.js background to avoid SSR issues
const HomeBackground = dynamic(() => import('@/components/home/HomeBackground'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-gradient-to-b from-[#0a0015] via-[#050010] to-black" />
  ),
});

// Animated counter for stats
function AnimatedNumber({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (hasAnimated) return;
    setHasAnimated(true);

    let start = 0;
    const end = target;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [target, duration, hasAnimated]);

  return <span>{count.toLocaleString()}</span>;
}

// Glowing orb component for visual interest
function GlowingOrb({ color, size, position, delay }: {
  color: string;
  size: number;
  position: { x: string; y: string };
  delay: number;
}) {
  return (
    <div
      className="absolute rounded-full animate-pulse-slow pointer-events-none"
      style={{
        width: size,
        height: size,
        left: position.x,
        top: position.y,
        background: `radial-gradient(circle, ${color}40 0%, ${color}00 70%)`,
        filter: 'blur(40px)',
        animationDelay: `${delay}s`,
      }}
    />
  );
}

export default function Home() {
  const [hoveredFaction, setHoveredFaction] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);

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
      if (musicEnabled && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }
    };

    startMenuMusic();
  }, []);

  // Sync volume changes
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabled);
  }, [musicVolume, musicEnabled]);

  // Loading animation
  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Parallax mouse tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (heroRef.current) {
        const rect = heroRef.current.getBoundingClientRect();
        setMousePosition({
          x: (e.clientX - rect.left - rect.width / 2) / rect.width,
          y: (e.clientY - rect.top - rect.height / 2) / rect.height,
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const factions = [
    {
      id: 'dominion',
      name: 'DOMINION',
      subtitle: 'Human Military Forces',
      description: 'Versatile, adaptive, and masters of siege warfare. Command the most balanced forces in the galaxy.',
      color: '#4A90D9',
      gradient: 'from-blue-600/20 to-blue-900/30',
      icon: '⚔️',
      stats: { units: 24, buildings: 16, abilities: 32 },
    },
    {
      id: 'synthesis',
      name: 'SYNTHESIS',
      subtitle: 'Machine Consciousness',
      description: 'Transcendent AI entities. Powerful units protected by regenerating shields and psionic abilities.',
      color: '#9B59B6',
      gradient: 'from-purple-600/20 to-purple-900/30',
      icon: '🔮',
      stats: { units: 20, buildings: 14, abilities: 28 },
    },
    {
      id: 'swarm',
      name: 'SWARM',
      subtitle: 'Organic Hive-Mind',
      description: 'Overwhelm enemies with cheap, fast-spawning forces. Evolution is your greatest weapon.',
      color: '#D4A84B',
      gradient: 'from-amber-600/20 to-amber-900/30',
      icon: '🦠',
      stats: { units: 28, buildings: 12, abilities: 24 },
    },
  ];

  return (
    <main className="relative min-h-screen bg-black overflow-hidden">
      {/* Cinematic 3D Background */}
      <HomeBackground />

      {/* Ambient glow orbs for atmosphere */}
      <GlowingOrb color="#843dff" size={400} position={{ x: '10%', y: '20%' }} delay={0} />
      <GlowingOrb color="#4A90D9" size={300} position={{ x: '80%', y: '60%' }} delay={1} />
      <GlowingOrb color="#9B59B6" size={350} position={{ x: '60%', y: '10%' }} delay={2} />

      {/* Main Content Container */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Navigation Bar */}
        <nav className={`
          fixed top-0 left-0 right-0 z-50
          px-6 py-4
          transition-all duration-1000
          ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}
        `}>
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-void-500 to-void-700
                            flex items-center justify-center shadow-lg shadow-void-500/30">
                <span className="text-white font-bold text-xl">V</span>
              </div>
              <span className="font-display text-xl tracking-wider text-white/90 hidden sm:block">
                VOIDSTRIKE
              </span>
            </div>

            {/* Nav Links */}
            <div className="flex items-center gap-6">
              <Link
                href="/game/setup"
                className="text-white/70 hover:text-white transition-colors text-sm font-medium"
              >
                Play
              </Link>
              <Link
                href="/lobby"
                className="text-white/70 hover:text-white transition-colors text-sm font-medium"
              >
                Multiplayer
              </Link>
              <button
                onClick={handleMusicToggle}
                className="w-9 h-9 rounded-full flex items-center justify-center
                         bg-white/5 hover:bg-white/10 border border-white/10
                         transition-all duration-200 hover:scale-105"
                title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
              >
                <span className="text-sm">{musicEnabled ? '🔊' : '🔇'}</span>
              </button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <div
          ref={heroRef}
          className="flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-10"
        >
          {/* Animated Title */}
          <div
            className={`
              text-center mb-8
              transition-all duration-1000 delay-300
              ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
            style={{
              transform: `translate(${mousePosition.x * -10}px, ${mousePosition.y * -10}px)`,
            }}
          >
            {/* Pre-title */}
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-void-500" />
              <span className="text-void-400 text-sm tracking-[0.3em] uppercase font-light">
                Browser-Based RTS
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-void-500" />
            </div>

            {/* Main Title */}
            <h1 className="font-display text-7xl md:text-9xl font-bold tracking-wider mb-6 relative">
              <span className="absolute inset-0 bg-gradient-to-r from-void-400 via-white to-void-400
                             bg-clip-text text-transparent blur-sm opacity-50">
                VOIDSTRIKE
              </span>
              <span className="relative bg-gradient-to-r from-void-400 via-white to-void-400
                             bg-clip-text text-transparent animate-shimmer bg-[length:200%_100%]">
                VOIDSTRIKE
              </span>
            </h1>

            {/* Tagline */}
            <p className="text-void-300/80 text-lg md:text-xl max-w-xl mx-auto font-light leading-relaxed">
              Command your forces. Dominate the void.
              <br />
              <span className="text-void-400">Zero downloads. Pure strategy.</span>
            </p>
          </div>

          {/* CTA Buttons */}
          <div
            className={`
              flex flex-col sm:flex-row gap-4 mb-16
              transition-all duration-1000 delay-500
              ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
          >
            <Link
              href="/game/setup"
              className="group relative px-10 py-4 overflow-hidden rounded-lg
                       bg-gradient-to-r from-void-600 to-void-700
                       hover:from-void-500 hover:to-void-600
                       transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-void-500/30"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0
                            translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              <span className="relative font-display text-lg tracking-wider text-white">
                PLAY NOW
              </span>
            </Link>
            <Link
              href="/lobby"
              className="group relative px-10 py-4 overflow-hidden rounded-lg
                       bg-white/5 backdrop-blur-sm border border-white/10
                       hover:bg-white/10 hover:border-white/20
                       transition-all duration-300 hover:scale-105"
            >
              <span className="font-display text-lg tracking-wider text-white/90">
                MULTIPLAYER
              </span>
            </Link>
          </div>

          {/* Faction Cards */}
          <div
            className={`
              w-full max-w-6xl mx-auto
              transition-all duration-1000 delay-700
              ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
          >
            <div className="text-center mb-8">
              <h2 className="font-display text-2xl text-white/80 tracking-wide mb-2">
                CHOOSE YOUR FACTION
              </h2>
              <p className="text-void-400/60 text-sm">
                Each faction offers a unique playstyle and strategic depth
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {factions.map((faction, index) => (
                <div
                  key={faction.id}
                  className={`
                    group relative overflow-hidden rounded-xl
                    bg-gradient-to-br ${faction.gradient}
                    backdrop-blur-md border border-white/10
                    transition-all duration-500 cursor-pointer
                    hover:scale-[1.02] hover:border-white/20
                    ${hoveredFaction === faction.id ? 'shadow-2xl' : 'shadow-lg'}
                  `}
                  style={{
                    boxShadow: hoveredFaction === faction.id
                      ? `0 25px 50px -12px ${faction.color}40`
                      : undefined,
                    transitionDelay: `${index * 100}ms`,
                  }}
                  onMouseEnter={() => setHoveredFaction(faction.id)}
                  onMouseLeave={() => setHoveredFaction(null)}
                >
                  {/* Glow effect on hover */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `radial-gradient(circle at 50% 0%, ${faction.color}30 0%, transparent 60%)`,
                    }}
                  />

                  {/* Card content */}
                  <div className="relative p-6">
                    {/* Icon and Title */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3
                          className="font-display text-2xl tracking-wider mb-1 transition-colors duration-300"
                          style={{ color: hoveredFaction === faction.id ? faction.color : 'white' }}
                        >
                          {faction.name}
                        </h3>
                        <p className="text-white/50 text-sm font-light">
                          {faction.subtitle}
                        </p>
                      </div>
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl
                                  bg-black/30 border border-white/10
                                  group-hover:scale-110 group-hover:border-white/20
                                  transition-all duration-300"
                      >
                        {faction.icon}
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-white/60 text-sm leading-relaxed mb-6 min-h-[3rem]">
                      {faction.description}
                    </p>

                    {/* Stats bar */}
                    <div className="flex gap-4 pt-4 border-t border-white/10">
                      <div className="flex-1">
                        <div className="text-white/40 text-xs mb-1">Units</div>
                        <div className="font-display text-lg" style={{ color: faction.color }}>
                          {faction.stats.units}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="text-white/40 text-xs mb-1">Buildings</div>
                        <div className="font-display text-lg" style={{ color: faction.color }}>
                          {faction.stats.buildings}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="text-white/40 text-xs mb-1">Abilities</div>
                        <div className="font-display text-lg" style={{ color: faction.color }}>
                          {faction.stats.abilities}
                        </div>
                      </div>
                    </div>

                    {/* Select button - appears on hover */}
                    <div className={`
                      mt-4 overflow-hidden transition-all duration-300
                      ${hoveredFaction === faction.id ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'}
                    `}>
                      <Link
                        href={`/game/setup?faction=${faction.id}`}
                        className="block w-full py-2 rounded-lg text-center text-sm font-medium
                                 transition-all duration-200 hover:scale-[1.02]"
                        style={{
                          backgroundColor: `${faction.color}30`,
                          color: faction.color,
                          border: `1px solid ${faction.color}50`,
                        }}
                      >
                        SELECT FACTION
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Stats Bar */}
        <div
          className={`
            relative z-10 py-6 px-6
            bg-gradient-to-t from-black/80 to-transparent
            transition-all duration-1000 delay-1000
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
          `}
        >
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
            {/* Stats */}
            <div className="flex gap-8">
              <div className="text-center">
                <div className="font-display text-2xl text-void-400">
                  <AnimatedNumber target={72} />
                </div>
                <div className="text-white/40 text-xs">Total Units</div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl text-void-400">
                  <AnimatedNumber target={42} />
                </div>
                <div className="text-white/40 text-xs">Buildings</div>
              </div>
              <div className="text-center">
                <div className="font-display text-2xl text-void-400">
                  <AnimatedNumber target={84} />
                </div>
                <div className="text-white/40 text-xs">Abilities</div>
              </div>
            </div>

            {/* Tech stack */}
            <div className="flex items-center gap-4 text-white/30 text-xs">
              <span>Next.js 14</span>
              <span className="w-1 h-1 rounded-full bg-void-500" />
              <span>Three.js</span>
              <span className="w-1 h-1 rounded-full bg-void-500" />
              <span>TypeScript</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
