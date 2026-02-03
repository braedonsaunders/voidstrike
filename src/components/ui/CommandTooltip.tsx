'use client';

import { memo, ReactNode } from 'react';
import { CostDisplay, Cost } from './CostDisplay';

interface CommandTooltipProps {
  icon: ReactNode;
  label: string;
  shortcut: string;
  description?: string;
  cost?: Cost;
  currentMinerals?: number;
  currentPlasma?: number;
  currentSupply?: number;
  maxSupply?: number;
  className?: string;
}

/**
 * Tooltip content for command buttons showing icon, label, shortcut, description, and cost.
 */
function CommandTooltipInner({
  icon,
  label,
  shortcut,
  description,
  cost,
  currentMinerals,
  currentPlasma,
  currentSupply,
  maxSupply,
  className = '',
}: CommandTooltipProps) {
  return (
    <div
      className={`bg-black/95 border border-void-600 rounded p-2 shadow-xl min-w-[200px] max-w-[280px] ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-white font-medium text-sm">{label}</span>
        <span className="text-void-400 text-xs ml-auto">[ {shortcut} ]</span>
      </div>

      {/* Description */}
      {description && (
        <p className="text-void-300 text-xs leading-relaxed">{description}</p>
      )}

      {/* Cost */}
      {cost && (
        <div className="mt-2 pt-2 border-t border-void-700/50">
          <CostDisplay
            cost={cost}
            currentMinerals={currentMinerals}
            currentPlasma={currentPlasma}
            currentSupply={currentSupply}
            maxSupply={maxSupply}
          />
        </div>
      )}
    </div>
  );
}

export const CommandTooltip = memo(CommandTooltipInner);
