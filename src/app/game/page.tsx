'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HUD } from '@/components/game/HUD';
import { MultiplayerOverlay } from '@/components/game/MultiplayerOverlay';
import { useGameSetupStore } from '@/store/gameSetupStore';

// Dynamic import for WebGPU game canvas (Three.js + Phaser overlay)
// Uses WebGPU with automatic WebGL fallback
// No SSR - both Three.js and Phaser require browser
const WebGPUGameCanvas = dynamic(
  () => import('@/components/game/WebGPUGameCanvas').then((mod) => mod.WebGPUGameCanvas),
  { ssr: false, loading: () => null }
);

// Simple black screen fallback - no content to prevent flash
function BlackScreen() {
  return <div className="fixed inset-0 bg-black" />;
}

export default function GamePage() {
  const router = useRouter();
  const { gameStarted, endGame } = useGameSetupStore();
  const [mounted, setMounted] = useState(false);

  // Hydration mount pattern: intentionally triggers re-render after client hydration
  // to avoid SSR/client mismatch when rendering browser-only content
  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- intentional hydration pattern
  }, []);

  useEffect(() => {
    // Redirect to setup if game wasn't started from pregame lobby
    if (!gameStarted) {
      router.replace('/game/setup');
      return;
    }

    // Clean up gameStarted flag when component unmounts (leaving game)
    return () => {
      endGame();
    };
  }, [gameStarted, router, endGame]);

  // Start with black screen, prevent any flash
  if (!mounted || !gameStarted) {
    return <BlackScreen />;
  }

  return (
    <div className="game-container fixed inset-0 bg-black overflow-hidden">
      <Suspense fallback={<BlackScreen />}>
        <WebGPUGameCanvas />
        <HUD />
        <MultiplayerOverlay />
      </Suspense>
    </div>
  );
}
