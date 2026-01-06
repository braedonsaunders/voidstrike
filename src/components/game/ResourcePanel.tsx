'use client';

import { useGameStore } from '@/store/gameStore';

export function ResourcePanel() {
  const { minerals, vespene, supply, maxSupply } = useGameStore();

  return (
    <div className="flex gap-4">
      {/* Minerals */}
      <div className="resource-display">
        <div className="w-4 h-4 bg-blue-400 rounded-sm" title="Minerals" />
        <span className="font-mono text-blue-300">{minerals}</span>
      </div>

      {/* Vespene */}
      <div className="resource-display">
        <div className="w-4 h-4 bg-green-500 rounded-full" title="Vespene Gas" />
        <span className="font-mono text-green-400">{vespene}</span>
      </div>

      {/* Supply */}
      <div className="resource-display">
        <div className="w-4 h-4 flex items-center justify-center" title="Supply">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4 text-yellow-400"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className={`font-mono ${supply >= maxSupply ? 'text-red-400' : 'text-yellow-300'}`}>
          {supply}/{maxSupply}
        </span>
      </div>
    </div>
  );
}
