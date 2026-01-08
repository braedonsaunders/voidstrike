'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HUD } from '@/components/game/HUD';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useGameSetupStore } from '@/store/gameSetupStore';

// Dynamic import for Hybrid game canvas (Three.js + Phaser overlay)
// No SSR - both Three.js and Phaser require browser
const HybridGameCanvas = dynamic(
  () => import('@/components/game/HybridGameCanvas').then((mod) => mod.HybridGameCanvas),
  { ssr: false }
);

export default function GamePage() {
  const router = useRouter();
  const { gameStarted, endGame } = useGameSetupStore();

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

  // Don't render game if not started from lobby
  if (!gameStarted) {
    return <LoadingScreen />;
  }

  return (
    <div className="game-container w-screen h-screen bg-black overflow-hidden">
      <Suspense fallback={<LoadingScreen />}>
        <HybridGameCanvas />
        <HUD />
      </Suspense>
    </div>
  );
}
