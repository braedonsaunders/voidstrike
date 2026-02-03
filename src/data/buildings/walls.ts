/**
 * Wall Building Definitions for the Fortification System
 *
 * This file re-exports wall definitions from the DefinitionRegistry.
 * The source of truth is: public/data/factions/dominion/buildings.json (wall entries)
 *
 * Walls are 1x1 buildings that can be placed in lines and automatically connect.
 * Gates are special wall segments that can open/close for unit passage.
 */

import { DefinitionRegistry } from '@/engine/definitions/DefinitionRegistry';
import type { BuildingDefinition } from '@/engine/components/Building';

// Export types
export type WallConnectionType = 'none' | 'horizontal' | 'vertical' | 'corner_ne' | 'corner_nw' | 'corner_se' | 'corner_sw' | 't_north' | 't_south' | 't_east' | 't_west' | 'cross';
export type GateState = 'closed' | 'open' | 'auto' | 'locked';
export type WallUpgradeType = 'reinforced' | 'shielded' | 'weapon' | 'repair_drone';

export interface WallDefinition extends BuildingDefinition {
  isWall: true;
  isGate?: boolean;
  canMountTurret?: boolean;
  wallUpgrades?: WallUpgradeType[];
}

export interface WallUpgradeDefinition {
  id: WallUpgradeType;
  name: string;
  description: string;
  researchCost: { minerals: number; plasma: number };
  researchTime: number;
  applyCost: { minerals: number; plasma: number };
  applyTime: number;
  researchBuilding: string;
}

/**
 * Proxy object that delegates to the DefinitionRegistry.
 * Provides backwards-compatible access to wall definitions.
 */
export const WALL_DEFINITIONS: Record<string, WallDefinition> = new Proxy(
  {} as Record<string, WallDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[WALL_DEFINITIONS] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      // Get building and check if it's a wall
      const building = DefinitionRegistry.getBuilding(prop);
      if (building && (building as WallDefinition).isWall) {
        return building as WallDefinition;
      }
      return undefined;
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      const building = DefinitionRegistry.getBuilding(prop);
      return building !== undefined && (building as WallDefinition).isWall === true;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      const allBuildings = DefinitionRegistry.getAllBuildings();
      return Object.keys(allBuildings).filter((id) => {
        const building = allBuildings[id];
        return (building as WallDefinition).isWall === true;
      });
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const building = DefinitionRegistry.getBuilding(prop);
      if (!building || !(building as WallDefinition).isWall) return undefined;
      return {
        value: building as WallDefinition,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

/**
 * Proxy object for wall upgrades.
 * Provides backwards-compatible access to wall upgrade definitions.
 */
export const WALL_UPGRADE_DEFINITIONS: Record<WallUpgradeType, WallUpgradeDefinition> = new Proxy(
  {} as Record<WallUpgradeType, WallUpgradeDefinition>,
  {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') {
        return undefined;
      }
      if (!DefinitionRegistry.isInitialized()) {
        console.warn(`[WALL_UPGRADE_DEFINITIONS] Accessing '${prop}' before definitions initialized`);
        return undefined;
      }
      return DefinitionRegistry.getWallUpgrade(prop) as WallUpgradeDefinition | undefined;
    },
    has(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return false;
      return DefinitionRegistry.getWallUpgrade(prop) !== undefined;
    },
    ownKeys() {
      if (!DefinitionRegistry.isInitialized()) return [];
      return Object.keys(DefinitionRegistry.getAllWallUpgrades());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (!DefinitionRegistry.isInitialized()) return undefined;
      const upgrade = DefinitionRegistry.getWallUpgrade(prop);
      if (!upgrade) return undefined;
      return {
        value: upgrade as WallUpgradeDefinition,
        writable: false,
        enumerable: true,
        configurable: true,
      };
    },
  }
);

// ==================== UTILITY FUNCTIONS ====================

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
    const _stepX = dx > 0 ? 1 : -1;
    const _stepY = dy > 0 ? 1 : -1;
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
): { minerals: number; plasma: number } {
  if (!DefinitionRegistry.isInitialized()) {
    console.warn('[calculateWallLineCost] Definitions not initialized');
    return { minerals: 0, plasma: 0 };
  }

  const def = DefinitionRegistry.getBuilding(buildingType);
  if (!def) return { minerals: 0, plasma: 0 };

  return {
    minerals: def.mineralCost * positions.length,
    plasma: def.plasmaCost * positions.length,
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
