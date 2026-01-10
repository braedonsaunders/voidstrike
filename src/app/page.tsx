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

// Glowing orb component for ambient atmosphere
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

// Animated scanning line effect
function ScanLine() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20">
      <div
        className="absolute w-full h-px bg-gradient-to-r from-transparent via-void-400 to-transparent"
        style={{
          animation: 'scanline 4s linear infinite',
          top: '0%',
        }}
      />
    </div>
  );
}

export default function Home() {
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

  return (
    <main className="relative min-h-screen bg-black overflow-hidden">
      {/* Cinematic 3D Background */}
      <HomeBackground />

      {/* Ambient glow orbs for atmosphere */}
      <GlowingOrb color="#843dff" size={500} position={{ x: '5%', y: '10%' }} delay={0} />
      <GlowingOrb color="#4A90D9" size={400} position={{ x: '85%', y: '70%' }} delay={1.5} />
      <GlowingOrb color="#9B59B6" size={350} position={{ x: '70%', y: '5%' }} delay={0.5} />
      <GlowingOrb color="#843dff" size={300} position={{ x: '20%', y: '80%' }} delay={2} />

      {/* Scan line effect */}
      <ScanLine />

      {/* Main Content Container */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top Navigation */}
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
                            flex items-center justify-center shadow-lg shadow-void-500/30
                            border border-void-400/30">
                <span className="text-white font-bold text-xl">V</span>
              </div>
            </div>

            {/* Music Toggle */}
            <button
              onClick={handleMusicToggle}
              className="w-10 h-10 rounded-full flex items-center justify-center
                       bg-white/5 hover:bg-white/10 border border-white/10
                       transition-all duration-200 hover:scale-105 hover:border-void-500/50"
              title={musicEnabled ? 'Mute Music' : 'Unmute Music'}
            >
              <span className="text-base">{musicEnabled ? '🔊' : '🔇'}</span>
            </button>
          </div>
        </nav>

        {/* Hero Section - Full Height */}
        <div
          ref={heroRef}
          className="flex-1 flex flex-col items-center justify-center px-6"
        >
          {/* Animated Title */}
          <div
            className={`
              text-center mb-12
              transition-all duration-1000 delay-300
              ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
            style={{
              transform: `translate(${mousePosition.x * -15}px, ${mousePosition.y * -15}px)`,
            }}
          >
            {/* Pre-title */}
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-void-500/70" />
              <span className="text-void-400/80 text-xs tracking-[0.4em] uppercase font-light">
                Browser-Based Real-Time Strategy
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-void-500/70" />
            </div>

            {/* Main Title with Layered Glow */}
            <h1 className="font-display text-8xl md:text-[10rem] lg:text-[12rem] font-bold tracking-wider mb-8 relative leading-none">
              {/* Deep shadow layer */}
              <span className="absolute inset-0 bg-gradient-to-r from-void-600 via-void-400 to-void-600
                             bg-clip-text text-transparent blur-xl opacity-30 scale-105">
                VOIDSTRIKE
              </span>
              {/* Mid glow layer */}
              <span className="absolute inset-0 bg-gradient-to-r from-void-500 via-white to-void-500
                             bg-clip-text text-transparent blur-sm opacity-60">
                VOIDSTRIKE
              </span>
              {/* Main text */}
              <span className="relative bg-gradient-to-r from-void-400 via-white to-void-400
                             bg-clip-text text-transparent animate-shimmer bg-[length:200%_100%]">
                VOIDSTRIKE
              </span>
            </h1>

            {/* Tagline */}
            <p className="text-void-300/70 text-xl md:text-2xl max-w-2xl mx-auto font-light leading-relaxed tracking-wide">
              Command your forces. Dominate the void.
            </p>
            <p className="text-void-500/50 text-sm mt-3 tracking-widest uppercase">
              Zero downloads required
            </p>
          </div>

          {/* Decorative Divider */}
          <div className={`
            flex items-center justify-center gap-4 mb-12
            transition-all duration-1000 delay-500
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
          `}>
            <div className="w-24 h-px bg-gradient-to-r from-transparent via-void-600/50 to-transparent" />
            <div className="w-2 h-2 rotate-45 border border-void-500/50" />
            <div className="w-24 h-px bg-gradient-to-r from-transparent via-void-600/50 to-transparent" />
          </div>

          {/* CTA Buttons - Bottom of Hero */}
          <div
            className={`
              flex flex-col sm:flex-row gap-6 items-center
              transition-all duration-1000 delay-700
              ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
            `}
          >
            {/* Primary Button - Play Now */}
            <Link
              href="/game/setup"
              className="group relative"
            >
              {/* Animated border glow */}
              <div className="absolute -inset-1 bg-gradient-to-r from-void-600 via-void-400 to-void-600
                            rounded-xl opacity-70 blur-md group-hover:opacity-100 group-hover:blur-lg
                            transition-all duration-300 animate-pulse-slow" />

              {/* Button */}
              <div className="relative px-16 py-5 rounded-xl
                           bg-gradient-to-b from-void-600 to-void-800
                           border border-void-400/50
                           group-hover:from-void-500 group-hover:to-void-700
                           transition-all duration-300 group-hover:scale-105
                           shadow-xl shadow-void-900/50">
                {/* Shine effect */}
                <div className="absolute inset-0 rounded-xl overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0
                                translate-x-[-100%] group-hover:translate-x-[100%]
                                transition-transform duration-700" />
                </div>

                <span className="relative font-display text-xl tracking-widest text-white">
                  PLAY NOW
                </span>
              </div>
            </Link>

            {/* Secondary Button - Multiplayer */}
            <Link
              href="/lobby"
              className="group relative px-12 py-4 rounded-xl overflow-hidden
                       bg-white/5 backdrop-blur-sm border border-white/10
                       hover:bg-white/10 hover:border-void-500/30
                       transition-all duration-300 hover:scale-105"
            >
              <span className="font-display text-lg tracking-widest text-white/80 group-hover:text-white
                             transition-colors duration-300">
                MULTIPLAYER
              </span>
            </Link>
          </div>
        </div>

        {/* Bottom Info Bar */}
        <div
          className={`
            relative z-10 py-8 px-6
            bg-gradient-to-t from-black/90 via-black/50 to-transparent
            transition-all duration-1000 delay-1000
            ${isLoaded ? 'opacity-100' : 'opacity-0'}
          `}
        >
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-8 text-white/30 text-xs tracking-wider">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-void-500/50" />
              3 Unique Factions
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-void-500/50" />
              70+ Units & Buildings
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-void-500/50" />
              5 AI Difficulty Levels
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-void-500/50" />
              Multiplayer Ready
            </span>
          </div>

          {/* Tech stack - very subtle */}
          <div className="flex items-center justify-center gap-3 mt-4 text-white/20 text-[10px] tracking-widest">
            <span>NEXT.JS</span>
            <span className="w-0.5 h-0.5 rounded-full bg-void-600" />
            <span>THREE.JS</span>
            <span className="w-0.5 h-0.5 rounded-full bg-void-600" />
            <span>TYPESCRIPT</span>
          </div>
        </div>
      </div>
    </main>
  );
}
