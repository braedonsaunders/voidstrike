'use client';

import { memo } from 'react';

export interface Cost {
  minerals: number;
  plasma: number;
  supply?: number;
}

interface CostDisplayProps {
  cost: Cost;
  currentMinerals?: number;
  currentPlasma?: number;
  currentSupply?: number;
  maxSupply?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Reusable cost display showing minerals, plasma, and optionally supply.
 * Highlights insufficient resources in red.
 */
function CostDisplayInner({
  cost,
  currentMinerals = Infinity,
  currentPlasma = Infinity,
  currentSupply = 0,
  maxSupply = Infinity,
  size = 'sm',
  className = '',
}: CostDisplayProps) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const canAffordMinerals = currentMinerals >= cost.minerals;
  const canAffordPlasma = currentPlasma >= cost.plasma;
  const hasSupply = cost.supply ? currentSupply + cost.supply <= maxSupply : true;

  return (
    <div className={`flex gap-4 ${textSize} ${className}`}>
      <span
        className={`flex items-center gap-1 ${
          canAffordMinerals ? 'text-blue-300' : 'text-red-400'
        }`}
      >
        <span>💎</span>
        {cost.minerals}
      </span>
      {cost.plasma > 0 && (
        <span
          className={`flex items-center gap-1 ${
            canAffordPlasma ? 'text-green-300' : 'text-red-400'
          }`}
        >
          <span>💚</span>
          {cost.plasma}
        </span>
      )}
      {cost.supply !== undefined && cost.supply > 0 && (
        <span
          className={`flex items-center gap-1 ${
            hasSupply ? 'text-yellow-300' : 'text-red-400'
          }`}
        >
          <span>👤</span>
          {cost.supply}
        </span>
      )}
    </div>
  );
}

export const CostDisplay = memo(CostDisplayInner);
