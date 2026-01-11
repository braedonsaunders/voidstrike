import { BuildingDefinition } from '@/engine/components/Building';

/**
 * Wall Building Definitions for the Fortification System
 *
 * Walls are 1x1 buildings that can be placed in lines and automatically connect.
 * Gates are special wall segments that can open/close for unit passage.
 */

export type WallConnectionType = 'none' | 'horizontal' | 'vertical' | 'corner_ne' | 'corner_nw' | 'corner_se' | 'corner_sw' | 't_north' | 't_south' | 't_east' | 't_west' | 'cross';
export type GateState = 'closed' | 'open' | 'auto' | 'locked';
export type WallUpgradeType = 'reinforced' | 'shielded' | 'weapon' | 'repair_drone';

export interface WallDefinition extends BuildingDefinition {
  isWall: true;
  isGate?: boolean;
  canMountTurret?: boolean;
  wallUpgrades?: WallUpgradeType[];
}

export const WALL_DEFINITIONS: Record<string, WallDefinition> = {
  wall_segment: {
    id: 'wall_segment',
    name: 'Wall Segment',
    description: 'Basic defensive wall. Connects to adjacent walls. Can mount turrets.',
    faction: 'dominion',
    mineralCost: 25,
    vespeneCost: 0,
    buildTime: 5,
    width: 1,
    height: 1,
    maxHealth: 400,
    armor: 1,
    sightRange: 3,
    canProduce: [],
    canResearch: [],
    requirements: [],
    isWall: true,
    canMountTurret: true,
    wallUpgrades: ['reinforced', 'shielded', 'weapon', 'repair_drone'],
  },

  wall_gate: {
    id: 'wall_gate',
    name: 'Wall Gate',
    description: 'Entrance gate that opens for friendly units. Can be locked.',
    faction: 'dominion',
    mineralCost: 75,
    vespeneCost: 0,
    buildTime: 10,
    width: 2,
    height: 1,
    maxHealth: 500,
    armor: 2,
    sightRange: 5,
    canProduce: [],
    canResearch: [],
    requirements: [],
    isWall: true,
    isGate: true,
    canMountTurret: false,
  },

  // Upgraded wall variants (created via upgrade, not built directly)
  wall_reinforced: {
    id: 'wall_reinforced',
    name: 'Reinforced Wall',
    description: 'Heavily armored wall segment with increased durability.',
    faction: 'dominion',
    mineralCost: 0, // Created via upgrade
    vespeneCost: 0,
    buildTime: 0,
    width: 1,
    height: 1,
    maxHealth: 800,
    armor: 3,
    sightRange: 3,
    canProduce: [],
    canResearch: [],
    isWall: true,
    canMountTurret: true,
  },

  wall_shielded: {
    id: 'wall_shielded',
    name: 'Shielded Wall',
    description: 'Wall with regenerating energy shield.',
    faction: 'dominion',
    mineralCost: 0,
    vespeneCost: 0,
    buildTime: 0,
    width: 1,
    height: 1,
    maxHealth: 400,
    armor: 2,
    sightRange: 3,
    canProduce: [],
    canResearch: [],
    isWall: true,
    canMountTurret: true,
  },

  wall_weapon: {
    id: 'wall_weapon',
    name: 'Weapon Wall',
    description: 'Wall segment with integrated auto-turret.',
    faction: 'dominion',
    mineralCost: 0,
    vespeneCost: 0,
    buildTime: 0,
    width: 1,
    height: 1,
    maxHealth: 500,
    armor: 2,
    sightRange: 7,
    canProduce: [],
    canResearch: [],
    isWall: true,
    canMountTurret: false, // Already has weapon
    attackRange: 6,
    attackDamage: 5,
    attackSpeed: 1.0,
  },
};

/**
 * Wall upgrade definitions - researched at Arsenal/Tech Center
 */
export interface WallUpgradeDefinition {
  id: WallUpgradeType;
  name: string;
  description: string;
  researchCost: { minerals: number; vespene: number };
  researchTime: number;
  applyCost: { minerals: number; vespene: number };
  applyTime: number;
  researchBuilding: string;
}

export const WALL_UPGRADE_DEFINITIONS: Record<WallUpgradeType, WallUpgradeDefinition> = {
  reinforced: {
    id: 'reinforced',
    name: 'Reinforced Plating',
    description: 'Upgrade walls with reinforced plating. +400 HP, +2 armor.',
    researchCost: { minerals: 100, vespene: 100 },
    researchTime: 60,
    applyCost: { minerals: 25, vespene: 0 },
    applyTime: 5,
    researchBuilding: 'arsenal',
  },
  shielded: {
    id: 'shielded',
    name: 'Shield Generator',
    description: 'Upgrade walls with energy shields. +200 regenerating shield.',
    researchCost: { minerals: 150, vespene: 150 },
    researchTime: 90,
    applyCost: { minerals: 50, vespene: 25 },
    applyTime: 8,
    researchBuilding: 'tech_center',
  },
  weapon: {
    id: 'weapon',
    name: 'Integrated Weapons',
    description: 'Upgrade walls with auto-turrets. 5 damage, 6 range.',
    researchCost: { minerals: 100, vespene: 100 },
    researchTime: 60,
    applyCost: { minerals: 40, vespene: 25 },
    applyTime: 10,
    researchBuilding: 'arsenal',
  },
  repair_drone: {
    id: 'repair_drone',
    name: 'Repair Drone',
    description: 'Deploy repair drones that auto-heal adjacent walls.',
    researchCost: { minerals: 75, vespene: 75 },
    researchTime: 45,
    applyCost: { minerals: 30, vespene: 15 },
    applyTime: 5,
    researchBuilding: 'tech_center',
  },
};

/**
 * Calculate wall line from start to end point
 * Returns array of grid positions for wall segments
 */
export function calculateWallLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];

  // Snap to grid
  const x1 = Math.round(startX);
  const y1 = Math.round(startY);
  const x2 = Math.round(endX);
  const y2 = Math.round(endY);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Determine primary direction (horizontal, vertical, or diagonal)
  if (absDx >= absDy * 2) {
    // Horizontal line
    const step = dx > 0 ? 1 : -1;
    for (let x = x1; x !== x2 + step; x += step) {
      positions.push({ x, y: y1 });
    }
  } else if (absDy >= absDx * 2) {
    // Vertical line
    const step = dy > 0 ? 1 : -1;
    for (let y = y1; y !== y2 + step; y += step) {
      positions.push({ x: x1, y });
    }
  } else {
    // Diagonal line (45 degrees)
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const steps = Math.max(absDx, absDy);
    for (let i = 0; i <= steps; i++) {
      const x = x1 + Math.round((i / steps) * dx);
      const y = y1 + Math.round((i / steps) * dy);
      // Avoid duplicates
      if (positions.length === 0 || positions[positions.length - 1].x !== x || positions[positions.length - 1].y !== y) {
        positions.push({ x, y });
      }
    }
  }

  return positions;
}

/**
 * Calculate total cost for a wall line
 */
export function calculateWallLineCost(
  positions: Array<{ x: number; y: number }>,
  buildingType: string = 'wall_segment'
): { minerals: number; vespene: number } {
  const def = WALL_DEFINITIONS[buildingType];
  if (!def) return { minerals: 0, vespene: 0 };

  return {
    minerals: def.mineralCost * positions.length,
    vespene: def.vespeneCost * positions.length,
  };
}

/**
 * Determine wall connection type based on neighbors
 */
export function getWallConnectionType(
  hasNorth: boolean,
  hasSouth: boolean,
  hasEast: boolean,
  hasWest: boolean
): WallConnectionType {
  const count = [hasNorth, hasSouth, hasEast, hasWest].filter(Boolean).length;

  if (count === 0) return 'none';
  if (count === 4) return 'cross';

  if (count === 3) {
    if (!hasNorth) return 't_south';
    if (!hasSouth) return 't_north';
    if (!hasEast) return 't_west';
    if (!hasWest) return 't_east';
  }

  if (count === 2) {
    if (hasNorth && hasSouth) return 'vertical';
    if (hasEast && hasWest) return 'horizontal';
    if (hasNorth && hasEast) return 'corner_ne';
    if (hasNorth && hasWest) return 'corner_nw';
    if (hasSouth && hasEast) return 'corner_se';
    if (hasSouth && hasWest) return 'corner_sw';
  }

  if (count === 1) {
    if (hasNorth || hasSouth) return 'vertical';
    return 'horizontal';
  }

  return 'none';
}

export const WALL_BUILDINGS = Object.values(WALL_DEFINITIONS);
