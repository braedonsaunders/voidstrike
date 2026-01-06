'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { HUD } from '@/components/game/HUD';
import { LoadingScreen } from '@/components/ui/LoadingScreen';

// Dynamic import for Three.js components (no SSR)
const GameCanvas = dynamic(
  () => import('@/components/game/GameCanvas').then((mod) => mod.GameCanvas),
  { ssr: false }
);

export default function GamePage() {
  return (
    <div className="game-container w-screen h-screen bg-black overflow-hidden">
      <Suspense fallback={<LoadingScreen />}>
        <GameCanvas />
        <HUD />
      </Suspense>
    </div>
  );
}
