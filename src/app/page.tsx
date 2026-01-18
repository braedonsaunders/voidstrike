'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { useUIStore } from '@/store/uiStore';
import { useGameSetupStore } from '@/store/gameSetupStore';

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
  const [hasMounted, setHasMounted] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const startBattleSimulator = useGameSetupStore((state) => state.startBattleSimulator);
  const musicEnabledStore = useUIStore((state) => state.musicEnabled);
  const musicVolume = useUIStore((state) => state.musicVolume);
  const toggleMusic = useUIStore((state) => state.toggleMusic);
  const isFullscreenStore = useUIStore((state) => state.isFullscreen);
  const toggleFullscreen = useUIStore((state) => state.toggleFullscreen);
  const setFullscreen = useUIStore((state) => state.setFullscreen);
  const preferWebGPUStore = useUIStore((state) => state.preferWebGPU);
  const setPreferWebGPU = useUIStore((state) => state.setPreferWebGPU);

  // Use default values during SSR/hydration to avoid mismatch, then sync after mount
  const musicEnabled = hasMounted ? musicEnabledStore : true;
  const isFullscreen = hasMounted ? isFullscreenStore : false;
  const preferWebGPU = hasMounted ? preferWebGPUStore : true;

  // Mark as mounted after hydration
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const handleMusicToggle = useCallback(() => {
    toggleMusic();
    const newEnabled = !musicEnabledStore;
    MusicPlayer.setMuted(!newEnabled);
    if (!newEnabled) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.resume();
    }
  }, [toggleMusic, musicEnabledStore]);

  // Initialize and play menu music
  // Use musicEnabledStore directly (not the SSR-safe wrapper) since MusicPlayer only runs client-side
  useEffect(() => {
    let userInteracted = false;
    let musicStarted = false;

    const startMenuMusic = async () => {
      await MusicPlayer.initialize();
      MusicPlayer.setVolume(musicVolume);
      MusicPlayer.setMuted(!musicEnabledStore);
      await MusicPlayer.discoverTracks();

      // Try to play - if it fails due to autoplay policy, we'll retry on interaction
      if (musicEnabledStore && MusicPlayer.getCurrentCategory() !== 'menu') {
        try {
          await MusicPlayer.play('menu');
          musicStarted = true;
        } catch {
          // Autoplay likely blocked - will retry on user interaction
        }
      }
    };

    // Start music immediately on any user interaction (before they click "PLAY NOW")
    const handleFirstInteraction = async () => {
      if (userInteracted || musicStarted) return;
      userInteracted = true;

      // If music hasn't started yet and is enabled, start it now
      if (musicEnabledStore && !MusicPlayer.isCurrentlyPlaying() && MusicPlayer.getCurrentCategory() !== 'menu') {
        MusicPlayer.play('menu');
      }

      // Remove listeners after first interaction
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('mousemove', handleFirstInteraction);
      window.removeEventListener('scroll', handleFirstInteraction);
    };

    // Set up listeners BEFORE attempting autoplay
    window.addEventListener('click', handleFirstInteraction, { once: false });
    window.addEventListener('keydown', handleFirstInteraction, { once: false });
    window.addEventListener('touchstart', handleFirstInteraction, { once: false });
    window.addEventListener('mousemove', handleFirstInteraction, { once: false });
    window.addEventListener('scroll', handleFirstInteraction, { once: false });

    startMenuMusic();

    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
      window.removeEventListener('mousemove', handleFirstInteraction);
      window.removeEventListener('scroll', handleFirstInteraction);
    };
  }, [musicEnabledStore, musicVolume]);

  // Sync volume changes - use store value directly since MusicPlayer only runs client-side
  useEffect(() => {
    MusicPlayer.setVolume(musicVolume);
    MusicPlayer.setMuted(!musicEnabledStore);
  }, [musicVolume, musicEnabledStore]);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    // Sync initial state
    setFullscreen(!!document.fullscreenElement);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [setFullscreen]);

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

            {/* Toggle Buttons */}
            <div className="flex items-center gap-3">
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
            <h1 className="font-display text-[11vw] md:text-[10vw] lg:text-[9vw] xl:text-[8rem] font-bold tracking-wider mb-8 relative leading-none">
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
          </div>

          {/* Secondary links - subtle text links */}
          <div
            className={`
              mt-6 flex items-center gap-4
              transition-all duration-1000 delay-900
              ${isLoaded ? 'opacity-100' : 'opacity-0'}
            `}
          >
            <button
              onClick={() => {
                startBattleSimulator();
                router.push('/game');
              }}
              className="text-void-500/60 text-sm tracking-wider hover:text-void-400 transition-colors duration-300"
            >
              Battle Simulator
            </button>
            <span className="text-void-600/40">|</span>
            <button
              onClick={() => router.push('/game/setup/editor?new=true')}
              className="text-void-500/60 text-sm tracking-wider hover:text-void-400 transition-colors duration-300"
            >
              Map Editor
            </button>
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

          {/* Renderer Toggle */}
          <div className="flex items-center justify-center mt-6">
            <button
              onClick={() => setPreferWebGPU(!preferWebGPU)}
              className="group flex items-center gap-3 px-4 py-2 rounded-full
                       bg-white/[0.02] hover:bg-white/[0.05]
                       border border-white/[0.05] hover:border-white/[0.1]
                       transition-all duration-300 active:scale-[0.98]"
              title={preferWebGPU ? 'Using WebGPU (experimental)' : 'Using WebGL (stable)'}
            >
              {/* Label */}
              <span className="text-white/30 text-[10px] tracking-widest uppercase group-hover:text-white/50 transition-colors">
                Renderer
              </span>

              {/* Toggle Track */}
              <div className={`
                relative w-[52px] h-7 rounded-full transition-all duration-300
                ${preferWebGPU
                  ? 'bg-gradient-to-r from-void-600/50 to-void-500/50 border-void-500/40 shadow-[0_0_12px_rgba(132,61,255,0.15)]'
                  : 'bg-white/[0.06] border-white/10'}
                border
              `}>
                {/* Glow pulse on toggle */}
                <div className={`
                  absolute inset-0 rounded-full transition-opacity duration-500
                  ${preferWebGPU ? 'opacity-100' : 'opacity-0'}
                  bg-gradient-to-r from-void-500/20 to-void-400/20
                  animate-pulse
                `} style={{ animationDuration: '2s' }} />

                {/* Toggle Knob */}
                <div
                  className={`
                    absolute top-1 w-5 h-5 rounded-full
                    transition-all duration-500
                    ${preferWebGPU
                      ? 'left-[27px] bg-gradient-to-br from-void-400 to-void-600 shadow-[0_0_8px_rgba(132,61,255,0.5)]'
                      : 'left-1 bg-gradient-to-br from-white/50 to-white/30'}
                  `}
                  style={{
                    transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  {/* Shine effect on knob */}
                  <div className="absolute inset-0.5 rounded-full bg-gradient-to-b from-white/30 to-transparent" />
                  {/* Inner dot */}
                  <div className={`
                    absolute inset-0 flex items-center justify-center
                    transition-opacity duration-300
                    ${preferWebGPU ? 'opacity-100' : 'opacity-50'}
                  `}>
                    <div className={`
                      w-1.5 h-1.5 rounded-full
                      ${preferWebGPU ? 'bg-white/40' : 'bg-white/20'}
                    `} />
                  </div>
                </div>

                {/* Labels inside track - positioned to avoid knob */}
                <span className={`
                  absolute left-[7px] top-1/2 -translate-y-1/2
                  text-[9px] font-semibold tracking-wide leading-none
                  transition-all duration-300
                  ${preferWebGPU ? 'opacity-50 text-void-300' : 'opacity-0 translate-x-1'}
                `}>
                  GL
                </span>
                <span className={`
                  absolute right-[5px] top-1/2 -translate-y-1/2
                  text-[9px] font-semibold tracking-wide leading-none
                  transition-all duration-300
                  ${preferWebGPU ? 'opacity-0 -translate-x-1' : 'opacity-40 text-white'}
                `}>
                  GPU
                </span>
              </div>

              {/* Status indicator */}
              <span className={`
                text-[10px] tracking-wider transition-all duration-300
                ${preferWebGPU ? 'text-void-400/70' : 'text-white/30'}
              `}>
                {preferWebGPU ? 'WebGPU' : 'WebGL'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
