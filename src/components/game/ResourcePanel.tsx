'use client';

import { useGameStore } from '@/store/gameStore';

export function ResourcePanel() {
  const { minerals, vespene, supply, maxSupply, gameTime } = useGameStore();

  // Format game time as mm:ss
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const isSupplyBlocked = supply >= maxSupply && maxSupply > 0;
  const supplyPercent = maxSupply > 0 ? (supply / maxSupply) * 100 : 0;

  return (
    <div className="flex items-center gap-6 bg-black/70 px-4 py-2 rounded-lg border border-void-700">
      {/* Game Time */}
      <div className="flex flex-col items-center border-r border-void-600 pr-4">
        <span className="text-void-400 text-xs uppercase tracking-wide">Time</span>
        <span className="font-mono text-white text-lg">{formatTime(gameTime)}</span>
      </div>

      {/* Minerals */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 relative">
            <div className="absolute inset-0 bg-blue-400 rounded transform rotate-45 scale-75" />
            <div className="absolute inset-1 bg-blue-300 rounded transform rotate-45 scale-50" />
          </div>
          <span className="text-void-400 text-xs uppercase tracking-wide">Minerals</span>
        </div>
        <span className="font-mono text-blue-300 text-xl font-bold">{minerals}</span>
      </div>

      {/* Vespene */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 relative">
            <div className="w-5 h-5 bg-green-500 rounded-full opacity-80" />
            <div className="absolute inset-1 bg-green-400 rounded-full animate-pulse" />
          </div>
          <span className="text-void-400 text-xs uppercase tracking-wide">Vespene</span>
        </div>
        <span className="font-mono text-green-400 text-xl font-bold">{vespene}</span>
      </div>

      {/* Supply */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`w-5 h-5 ${isSupplyBlocked ? 'text-red-400' : 'text-yellow-400'}`}
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <span className="text-void-400 text-xs uppercase tracking-wide">Supply</span>
        </div>
        <div className="flex flex-col items-center">
          <span className={`font-mono text-xl font-bold ${isSupplyBlocked ? 'text-red-400' : 'text-yellow-300'}`}>
            {supply}/{maxSupply}
          </span>
          {/* Supply bar */}
          <div className="w-20 h-1 bg-void-700 rounded-full overflow-hidden mt-1">
            <div
              className={`h-full transition-all duration-300 ${
                isSupplyBlocked ? 'bg-red-500' : supplyPercent > 80 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(supplyPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Supply Warning */}
      {isSupplyBlocked && (
        <div className="flex items-center gap-2 text-red-400 animate-pulse">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-semibold">SUPPLY BLOCKED</span>
        </div>
      )}
    </div>
  );
}
