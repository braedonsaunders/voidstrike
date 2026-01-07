'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HUD } from '@/components/game/HUD';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useGameSetupStore } from '@/store/gameSetupStore';

// Dynamic import for Phaser game (no SSR - Phaser requires browser)
const PhaserGame = dynamic(
  () => import('@/phaser/PhaserGame').then((mod) => mod.PhaserGame),
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
        <PhaserGame />
        <HUD />
      </Suspense>
    </div>
  );
}
