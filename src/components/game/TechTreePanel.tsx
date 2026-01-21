'use client';

import { memo, useMemo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { RESEARCH_DEFINITIONS, ResearchDefinition } from '@/data/research/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { BaseModal } from './BaseModal';

interface TechCategory {
  name: string;
  building: string;
  upgrades: string[];
}

const TECH_CATEGORIES: TechCategory[] = [
  {
    name: 'Infantry',
    building: 'Engineering Bay',
    upgrades: [
      'infantry_weapons_1', 'infantry_weapons_2', 'infantry_weapons_3',
      'infantry_armor_1', 'infantry_armor_2', 'infantry_armor_3',
    ],
  },
  {
    name: 'Vehicles',
    building: 'Armory',
    upgrades: [
      'vehicle_weapons_1', 'vehicle_weapons_2', 'vehicle_weapons_3',
      'vehicle_armor_1', 'vehicle_armor_2', 'vehicle_armor_3',
    ],
  },
  {
    name: 'Ships',
    building: 'Armory',
    upgrades: [
      'ship_weapons_1', 'ship_weapons_2', 'ship_weapons_3',
      'ship_armor_1', 'ship_armor_2', 'ship_armor_3',
    ],
  },
  {
    name: 'Infantry Abilities',
    building: 'Barracks',
    upgrades: ['stim_pack', 'combat_shield', 'concussive_shells'],
  },
  {
    name: 'Vehicle Abilities',
    building: 'Factory',
    upgrades: ['siege_tech', 'drilling_claws'],
  },
  {
    name: 'Air Abilities',
    building: 'Starport',
    upgrades: ['cloaking_field', 'caduceus_reactor'],
  },
  {
    name: 'Capital Ships',
    building: 'Fusion Core',
    upgrades: ['power_cannon', 'capital_weapon_refit'],
  },
  {
    name: 'Structures',
    building: 'Engineering Bay',
    upgrades: ['auto_tracking', 'building_armor'],
  },
];

// PERF: Memoized UpgradeCard to prevent re-renders when other cards change
const UpgradeCard = memo(function UpgradeCard({ upgradeId }: { upgradeId: string }) {
  // PERF: Use individual selectors instead of destructuring to minimize re-renders
  const playerId = useGameStore((state) => state.playerId);
  const hasResearch = useGameStore((state) => state.hasResearch);
  const minerals = useGameStore((state) => state.minerals);
  const vespene = useGameStore((state) => state.vespene);
  const upgrade = RESEARCH_DEFINITIONS[upgradeId];

  if (!upgrade) return null;

  const isResearched = hasResearch(playerId, upgradeId);

  // Check requirements
  let reqMet = true;
  let reqText = '';
  if (upgrade.requirements) {
    for (const req of upgrade.requirements) {
      const isUpgrade = RESEARCH_DEFINITIONS[req];
      if (isUpgrade && !hasResearch(playerId, req)) {
        reqMet = false;
        reqText = `Requires: ${isUpgrade.name}`;
        break;
      }
      const isBuilding = BUILDING_DEFINITIONS[req];
      if (isBuilding) {
        reqText = `Requires: ${isBuilding.name}`;
      }
    }
  }

  const canAfford = minerals >= upgrade.mineralCost && vespene >= upgrade.vespeneCost;

  return (
    <div
      className={`
        relative p-2 rounded border transition-all
        ${isResearched
          ? 'bg-green-900/50 border-green-500'
          : reqMet
            ? canAfford
              ? 'bg-void-800/80 border-void-500 hover:border-void-400'
              : 'bg-void-800/50 border-void-600'
            : 'bg-void-900/50 border-void-700 opacity-60'
        }
      `}
    >
      {/* Upgrade Name */}
      <div className="font-medium text-sm text-white mb-1">
        {upgrade.name}
        {isResearched && (
          <span className="ml-2 text-green-400 text-xs">
            ✓ Complete
          </span>
        )}
      </div>

      {/* Description */}
      <div className="text-xs text-void-400 mb-2">
        {upgrade.description}
      </div>

      {/* Cost */}
      {!isResearched && (
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

      {/* Requirements */}
      {!isResearched && reqText && (
        <div className={`text-xs mt-1 ${reqMet ? 'text-void-500' : 'text-yellow-500'}`}>
          {reqText}
        </div>
      )}

      {/* Level indicator for tiered upgrades */}
      {upgrade.level && (
        <div className="absolute top-1 right-1 text-xs text-void-500">
          Lv.{upgrade.level}
        </div>
      )}
    </div>
  );
});

// PERF: Memoized CategorySection to prevent re-renders
const CategorySection = memo(function CategorySection({ category }: { category: TechCategory }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-bold text-void-300">{category.name}</h3>
        <span className="text-xs text-void-500">({category.building})</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {category.upgrades.map((upgradeId) => (
          <UpgradeCard key={upgradeId} upgradeId={upgradeId} />
        ))}
      </div>
    </div>
  );
});

/**
 * Tech tree panel showing all available researches
 * NOTE: Edge scrolling is now controlled centrally by HUD.tsx via isAnyMenuOpen selector
 */
export function TechTreePanel() {
  const { showTechTree, setShowTechTree } = useGameStore();

  const handleClose = () => setShowTechTree(false);

  return (
    <BaseModal
      title="Tech Tree - Dominion"
      isOpen={showTechTree}
      onClose={handleClose}
      width="900px"
      maxWidth="95vw"
      height="85vh"
      testId="tech-tree-panel"
    >
      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {/* Upgrade Categories */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            {TECH_CATEGORIES.slice(0, 4).map((cat) => (
              <CategorySection key={cat.name} category={cat} />
            ))}
          </div>
          <div>
            {TECH_CATEGORIES.slice(4).map((cat) => (
              <CategorySection key={cat.name} category={cat} />
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-void-700">
          <div className="flex items-center gap-6 text-xs text-void-400">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-900/50 border border-green-500 rounded" />
              <span>Researched</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-void-800/80 border border-void-500 rounded" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-void-900/50 border border-void-700 rounded opacity-60" />
              <span>Locked</span>
            </div>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
