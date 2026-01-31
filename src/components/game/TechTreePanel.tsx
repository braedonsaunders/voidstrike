'use client';

import { memo, useMemo, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { TECH_CATEGORIES, TechCategory, UpgradeChain, formatEffect, getEffectIcon } from '@/data/tech-tree';
import { ResearchDefinition } from '@/data/research/dominion';
import { BaseModal } from './BaseModal';
import { getBuildingIcon, getResearchIcon } from './icons';

type UpgradeStatus = 'researched' | 'available' | 'locked' | 'in_progress';

interface UpgradeStatusInfo {
  status: UpgradeStatus;
  missingRequirements: string[];
}

/**
 * Get the status of an upgrade for the current player
 */
function useUpgradeStatus(upgradeId: string): UpgradeStatusInfo {
  const playerId = useGameStore((state) => state.playerId);
  const hasResearch = useGameStore((state) => state.hasResearch);

  return useMemo(() => {
    const upgrade = TECH_CATEGORIES
      .flatMap(c => c.upgrades)
      .find(u => u.id === upgradeId);

    if (!upgrade) return { status: 'locked' as const, missingRequirements: [] };

    // Check if already researched
    if (hasResearch(playerId, upgradeId)) {
      return { status: 'researched' as const, missingRequirements: [] };
    }

    // Check requirements
    const missingReqs: string[] = [];
    if (upgrade.requirements) {
      for (const req of upgrade.requirements) {
        // Check research requirements (not building requirements)
        const reqUpgrade = TECH_CATEGORIES
          .flatMap(c => c.upgrades)
          .find(u => u.id === req);
        if (reqUpgrade && !hasResearch(playerId, req)) {
          missingReqs.push(reqUpgrade.name);
        }
      }
    }

    if (missingReqs.length > 0) {
      return { status: 'locked' as const, missingRequirements: missingReqs };
    }

    return { status: 'available' as const, missingRequirements: [] };
  }, [playerId, hasResearch, upgradeId]);
}

/**
 * Single upgrade tier in a chain
 */
const UpgradeTier = memo(function UpgradeTier({
  upgrade,
  isFirst,
  isLast,
}: {
  upgrade: ResearchDefinition;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { status, missingRequirements } = useUpgradeStatus(upgrade.id);
  const minerals = useGameStore((state) => state.minerals);
  const vespene = useGameStore((state) => state.vespene);

  const canAfford = minerals >= upgrade.mineralCost && vespene >= upgrade.vespeneCost;

  const statusColors = {
    researched: 'border-green-500 bg-green-900/30',
    available: canAfford ? 'border-blue-500 bg-blue-900/20' : 'border-yellow-600 bg-yellow-900/10',
    locked: 'border-void-700 bg-void-900/50 opacity-60',
    in_progress: 'border-cyan-500 bg-cyan-900/20',
  };

  const levelLabel = upgrade.level ? `Lv.${upgrade.level}` : '';

  return (
    <div className="flex items-center">
      {/* Connector line (left) */}
      {!isFirst && (
        <div className="w-4 h-0.5 bg-void-600" />
      )}

      {/* Upgrade box */}
      <div
        className={`
          relative p-2 rounded border-2 min-w-[70px] text-center transition-all
          hover:scale-105 cursor-default
          ${statusColors[status]}
        `}
        title={`${upgrade.name}\n${upgrade.description}\n\nCost: ${upgrade.mineralCost}m / ${upgrade.vespeneCost}v\nTime: ${upgrade.researchTime}s${missingRequirements.length > 0 ? `\n\nRequires: ${missingRequirements.join(', ')}` : ''}`}
      >
        {/* Level badge */}
        {levelLabel && (
          <div className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[10px] font-bold bg-void-800 border border-void-600 rounded">
            {levelLabel}
          </div>
        )}

        {/* Status indicator */}
        {status === 'researched' && (
          <div className="absolute -top-1 -left-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-[10px]">
            ✓
          </div>
        )}

        {/* Icon */}
        <div className="text-lg mb-0.5">
          {getResearchIcon(upgrade.id)}
        </div>

        {/* Cost (only if not researched) */}
        {status !== 'researched' && (
          <div className="flex justify-center gap-1 text-[9px]">
            <span className={minerals >= upgrade.mineralCost ? 'text-blue-300' : 'text-red-400'}>
              {upgrade.mineralCost}
            </span>
            <span className="text-void-500">/</span>
            <span className={vespene >= upgrade.vespeneCost ? 'text-green-400' : 'text-red-400'}>
              {upgrade.vespeneCost}
            </span>
          </div>
        )}
      </div>

      {/* Connector line (right) */}
      {!isLast && (
        <div className="w-4 h-0.5 bg-void-600" />
      )}
    </div>
  );
});

/**
 * A chain of tiered upgrades (e.g., Infantry Weapons 1 -> 2 -> 3)
 */
const UpgradeChainRow = memo(function UpgradeChainRow({
  chain,
}: {
  chain: UpgradeChain;
}) {
  return (
    <div className="flex items-center gap-0 py-2">
      {/* Chain name and icon */}
      <div className="w-28 flex-shrink-0 pr-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{getEffectIcon(chain.effectType)}</span>
          <span className="text-xs font-medium text-void-300 truncate" title={chain.name}>
            {chain.name}
          </span>
        </div>
      </div>

      {/* Tiers */}
      <div className="flex items-center">
        {chain.levels.map((upgrade, idx) => (
          <UpgradeTier
            key={upgrade.id}
            upgrade={upgrade}
            isFirst={idx === 0}
            isLast={idx === chain.levels.length - 1}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * Single standalone upgrade (no tiers)
 */
const StandaloneUpgrade = memo(function StandaloneUpgrade({
  upgrade,
}: {
  upgrade: ResearchDefinition;
}) {
  const { status, missingRequirements } = useUpgradeStatus(upgrade.id);
  const minerals = useGameStore((state) => state.minerals);
  const vespene = useGameStore((state) => state.vespene);

  const canAfford = minerals >= upgrade.mineralCost && vespene >= upgrade.vespeneCost;

  const statusColors = {
    researched: 'border-green-500 bg-green-900/30',
    available: canAfford ? 'border-blue-500 bg-blue-900/20' : 'border-yellow-600 bg-yellow-900/10',
    locked: 'border-void-700 bg-void-900/50 opacity-60',
    in_progress: 'border-cyan-500 bg-cyan-900/20',
  };

  return (
    <div
      className={`
        relative p-3 rounded-lg border-2 transition-all hover:scale-[1.02] cursor-default
        ${statusColors[status]}
      `}
    >
      {/* Status indicator */}
      {status === 'researched' && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-xs">
          ✓
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{getResearchIcon(upgrade.id)}</span>
        <span className="font-medium text-sm text-white">{upgrade.name}</span>
      </div>

      {/* Description */}
      <p className="text-xs text-void-400 mb-2">{upgrade.description}</p>

      {/* Effects */}
      <div className="flex flex-wrap gap-1 mb-2">
        {upgrade.effects.map((effect, idx) => (
          <span
            key={idx}
            className="px-1.5 py-0.5 text-[10px] bg-void-800 rounded text-void-300"
          >
            {getEffectIcon(effect.type)} {formatEffect(effect)}
          </span>
        ))}
      </div>

      {/* Cost and time (only if not researched) */}
      {status !== 'researched' && (
        <div className="flex items-center gap-3 text-xs">
          <span className={minerals >= upgrade.mineralCost ? 'text-blue-300' : 'text-red-400'}>
            ◆ {upgrade.mineralCost}
          </span>
          <span className={vespene >= upgrade.vespeneCost ? 'text-green-400' : 'text-red-400'}>
            ● {upgrade.vespeneCost}
          </span>
          <span className="text-void-500">
            {upgrade.researchTime}s
          </span>
        </div>
      )}

      {/* Requirements warning */}
      {status === 'locked' && missingRequirements.length > 0 && (
        <div className="mt-2 text-[10px] text-yellow-500">
          Requires: {missingRequirements.join(', ')}
        </div>
      )}
    </div>
  );
});

/**
 * Category section containing upgrades
 */
const CategorySection = memo(function CategorySection({
  category,
  isExpanded,
  onToggle,
}: {
  category: TechCategory;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Separate tiered chains from standalone upgrades
  const tieredChains = category.upgradeChains.filter(c => c.levels.length > 1);
  const standaloneUpgrades = category.upgradeChains
    .filter(c => c.levels.length === 1)
    .map(c => c.levels[0]);

  return (
    <div className="border border-void-700 rounded-lg overflow-hidden">
      {/* Category header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-void-800/50 hover:bg-void-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{getBuildingIcon(category.buildingId.replace('_research_module', ''))}</span>
          <div className="text-left">
            <div className="font-medium text-white">{category.name}</div>
            <div className="text-xs text-void-500">{category.buildingName}</div>
          </div>
        </div>
        <span className="text-void-400 text-lg">
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Category content */}
      {isExpanded && (
        <div className="p-3 bg-void-900/30">
          {/* Tiered upgrade chains */}
          {tieredChains.length > 0 && (
            <div className="mb-4">
              {tieredChains.map(chain => (
                <UpgradeChainRow key={chain.id} chain={chain} />
              ))}
            </div>
          )}

          {/* Standalone upgrades */}
          {standaloneUpgrades.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {standaloneUpgrades.map(upgrade => (
                <StandaloneUpgrade key={upgrade.id} upgrade={upgrade} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Legend showing status colors
 */
function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-void-400 px-2">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded border-2 border-green-500 bg-green-900/30" />
        <span>Researched</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-900/20" />
        <span>Available</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded border-2 border-yellow-600 bg-yellow-900/10" />
        <span>Can&apos;t Afford</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded border-2 border-void-700 bg-void-900/50 opacity-60" />
        <span>Locked</span>
      </div>
    </div>
  );
}

/**
 * Tech tree panel showing all available researches
 * Fully data-driven from tech-tree.ts configuration
 */
export function TechTreePanel() {
  const { showTechTree, setShowTechTree } = useGameStore();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(TECH_CATEGORIES.map(c => c.id)) // All expanded by default
  );

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const handleClose = () => setShowTechTree(false);

  // Group categories for layout
  const leftCategories = TECH_CATEGORIES.slice(0, 4);
  const rightCategories = TECH_CATEGORIES.slice(4);

  return (
    <BaseModal
      title="Tech Tree - Dominion"
      isOpen={showTechTree}
      onClose={handleClose}
      width="1100px"
      maxWidth="95vw"
      height="85vh"
      closeHint="Press ESC to close"
      testId="tech-tree-panel"
    >
      {/* Legend */}
      <div className="px-4 py-2 border-b border-void-700 bg-void-900/50">
        <Legend />
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left column */}
          <div className="space-y-3">
            {leftCategories.map(category => (
              <CategorySection
                key={category.id}
                category={category}
                isExpanded={expandedCategories.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
              />
            ))}
          </div>

          {/* Right column */}
          <div className="space-y-3">
            {rightCategories.map(category => (
              <CategorySection
                key={category.id}
                category={category}
                isExpanded={expandedCategories.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
