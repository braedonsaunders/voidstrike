/**
 * VOIDSTRIKE Data Provider
 *
 * Bridges between the generic editor format and VOIDSTRIKE's MapData format.
 * Handles loading maps, converting between formats, and saving.
 * Includes full connectivity validation using the map analysis system.
 */

import type {
  EditorDataProvider,
  EditorMapData,
  EditorCell,
  EditorObject,
  ValidationResult,
} from '../config/EditorConfig';
import { debugInitialization } from '@/utils/debugLogger';
import { safeLocalStorageSet, safeLocalStorageGet } from '@/utils/storage';
import type { MapData, MapCell, Expansion, WatchTower, DestructibleRock, MapDecoration, ResourceNode, TerrainType } from '@/data/maps/MapTypes';
import {
  ALL_MAPS,
  TERRAIN_FEATURE_CONFIG,
  createBaseResources,
  DIR,
  MINERAL_DISTANCE_NATURAL,
  autoFixConnectivity,
} from '@/data/maps';
import type { TerrainFeature } from '@/data/maps/MapTypes';
import { getEditorNavigation, resetEditorNavigation } from '../services/EditorNavigation';

// Extended validation result with connectivity details
interface ExtendedValidationResult extends ValidationResult {
  stats?: {
    totalNodes: number;
    totalEdges: number;
    islandCount: number;
    connectedPairs: number;
    blockedPairs: number;
  };
  navmeshStats?: {
    navmeshGenerated: boolean;
    pathsChecked: number;
    pathsFound: number;
    pathsBlocked: number;
    blockedPaths?: Array<{ from: string; to: string }>;
  };
}

/**
 * Convert VOIDSTRIKE MapData to editor format
 */
export function mapDataToEditorFormat(map: MapData): EditorMapData {
  // Convert terrain grid
  const terrain: EditorCell[][] = map.terrain.map((row) =>
    row.map((cell) => {
      const featureConfig = TERRAIN_FEATURE_CONFIG[cell.feature];
      return {
        elevation: cell.elevation,
        feature: cell.feature,
        walkable: cell.terrain !== 'unwalkable' && featureConfig.walkable,
        textureId: cell.textureId,
        isRamp: cell.terrain === 'ramp',
        isPlatform: cell.terrain === 'platform',
      };
    })
  );

  // Convert objects
  const objects: EditorObject[] = [];

  // Convert expansions to objects
  map.expansions.forEach((exp, index) => {
    let objType = 'third'; // default
    if (exp.isMain) objType = 'main_base';
    else if (exp.isNatural) objType = 'natural';
    else if (exp.name.toLowerCase().includes('gold')) objType = 'gold';
    else if (exp.name.toLowerCase().includes('fourth')) objType = 'fourth';

    objects.push({
      id: `exp_${index}`,
      type: objType,
      x: exp.x,
      y: exp.y,
      properties: {
        name: exp.name,
        minerals: exp.minerals,
        plasma: exp.plasma,
      },
    });
  });

  // Convert watch towers
  map.watchTowers.forEach((tower, index) => {
    objects.push({
      id: `tower_${index}`,
      type: 'watch_tower',
      x: tower.x,
      y: tower.y,
      radius: tower.radius,
      properties: {
        visionRadius: tower.radius,
      },
    });
  });

  // Convert destructibles
  map.destructibles.forEach((dest, index) => {
    objects.push({
      id: `dest_${index}`,
      type: 'destructible_rock',
      x: dest.x,
      y: dest.y,
      properties: {
        health: dest.health,
      },
    });
  });

  // Convert decorations
  (map.decorations || []).forEach((dec, index) => {
    objects.push({
      id: `dec_${index}`,
      type: `decoration_${dec.type}`,
      x: dec.x,
      y: dec.y,
      properties: {
        decorationType: dec.type,
        scale: dec.scale || 1.0,
        rotation: dec.rotation || 0,
      },
    });
  });

  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    terrain,
    objects,
    biomeId: map.biome,
    metadata: {
      author: map.author,
      description: map.description,
      playerCount: map.playerCount,
      maxPlayers: map.maxPlayers,
      isRanked: map.isRanked,
    },
  };
}

/**
 * Convert editor format back to VOIDSTRIKE MapData
 */
function editorFormatToMapData(data: EditorMapData): MapData {
  // Convert terrain grid
  const terrain: MapCell[][] = data.terrain.map((row) =>
    row.map((cell) => {
      const featureConfig = TERRAIN_FEATURE_CONFIG[cell.feature as TerrainFeature] || TERRAIN_FEATURE_CONFIG.none;
      // Determine terrain type: ramp > platform > ground/unwalkable
      let terrainType: TerrainType;
      if (cell.isRamp) {
        terrainType = 'ramp';
      } else if (cell.isPlatform) {
        terrainType = 'platform';
      } else if (cell.walkable && featureConfig.walkable) {
        terrainType = 'ground';
      } else {
        terrainType = 'unwalkable';
      }
      return {
        terrain: terrainType,
        elevation: cell.elevation,
        feature: (cell.feature as TerrainFeature) || 'none',
        textureId: cell.textureId || 0,
      };
    })
  );

  // Convert objects back to game structures
  const expansions: Expansion[] = [];
  const watchTowers: WatchTower[] = [];
  const destructibles: DestructibleRock[] = [];
  const decorations: MapDecoration[] = [];

  for (const obj of data.objects) {
    if (['main_base', 'natural', 'third', 'fourth', 'gold'].includes(obj.type)) {
      // Get existing minerals/plasma or generate defaults
      let minerals = obj.properties?.minerals as ResourceNode[] | undefined;
      let plasma = obj.properties?.plasma as ResourceNode[] | undefined;

      // Auto-generate resources if not defined
      if (!minerals || minerals.length === 0 || !plasma || plasma.length === 0) {
        // Determine direction for resource placement (default to right, can be customized later)
        const direction = (obj.properties?.resourceDirection as number) ?? DIR.RIGHT;
        const isGold = obj.type === 'gold';
        const isNatural = obj.type === 'natural';
        const mineralDistance = isNatural ? MINERAL_DISTANCE_NATURAL : 7;

        const resources = createBaseResources(
          obj.x,
          obj.y,
          direction,
          undefined, // default mineral amount
          undefined, // default gas amount
          isGold,
          mineralDistance
        );

        minerals = minerals && minerals.length > 0 ? minerals : resources.minerals;
        plasma = plasma && plasma.length > 0 ? plasma : resources.plasma;
      }

      expansions.push({
        name: (obj.properties?.name as string) || `Expansion ${expansions.length + 1}`,
        x: obj.x,
        y: obj.y,
        minerals: minerals || [],
        plasma: plasma || [],
        isMain: obj.type === 'main_base',
        isNatural: obj.type === 'natural',
      });
    } else if (obj.type === 'watch_tower') {
      watchTowers.push({
        x: obj.x,
        y: obj.y,
        radius: (obj.properties?.visionRadius as number) || 22,
      });
    } else if (obj.type === 'destructible_rock' || obj.type === 'destructible_debris') {
      destructibles.push({
        x: obj.x,
        y: obj.y,
        health: (obj.properties?.health as number) || 2000,
      });
    } else if (obj.type.startsWith('decoration_')) {
      // Extract decoration type from object type (e.g., "decoration_tree_pine_tall" -> "tree_pine_tall")
      const decorationType = (obj.properties?.decorationType as string) || obj.type.replace('decoration_', '');
      decorations.push({
        type: decorationType as MapDecoration['type'], // Cast to DecorationType
        x: obj.x,
        y: obj.y,
        scale: (obj.properties?.scale as number) || 1.0,
        rotation: (obj.properties?.rotation as number) || 0,
      });
    }
  }

  // Generate spawns from main bases
  const spawns = expansions
    .filter((exp) => exp.isMain)
    .map((exp, index) => ({
      x: exp.x,
      y: exp.y,
      playerSlot: index + 1,
      rotation: 0,
    }));

  return {
    id: data.id,
    name: data.name,
    author: (data.metadata?.author as string) || 'Editor',
    description: (data.metadata?.description as string) || '',
    width: data.width,
    height: data.height,
    terrain,
    spawns,
    expansions,
    watchTowers,
    ramps: [], // Ramps are embedded in terrain, not separate
    destructibles,
    decorations,
    playerCount: (data.metadata?.playerCount as 2 | 4 | 6 | 8) || 2,
    maxPlayers: (data.metadata?.maxPlayers as number) || 2,
    isRanked: (data.metadata?.isRanked as boolean) || false,
    biome: data.biomeId as any,
    skipProceduralDecorations: true, // Editor maps don't get auto-generated trees/rocks
  };
}

/**
 * Create a blank map
 */
function createBlankMap(width: number, height: number, name: string): EditorMapData {
  const terrain: EditorCell[][] = [];

  for (let y = 0; y < height; y++) {
    terrain[y] = [];
    for (let x = 0; x < width; x++) {
      terrain[y][x] = {
        elevation: 140, // Mid ground
        feature: 'none',
        walkable: true,
        textureId: Math.floor(Math.random() * 4),
      };
    }
  }

  return {
    id: `map_${Date.now()}`,
    name,
    width,
    height,
    terrain,
    objects: [],
    biomeId: 'grassland',
    metadata: {
      author: 'Editor',
      description: '',
      playerCount: 2,
      maxPlayers: 2,
      isRanked: false,
    },
  };
}

/**
 * VOIDSTRIKE Data Provider implementation
 */
export const voidstrikeDataProvider: EditorDataProvider = {
  async getMapList() {
    return Object.values(ALL_MAPS).map((map) => ({
      id: map.id,
      name: map.name,
      thumbnail: map.thumbnailUrl,
    }));
  },

  async loadMap(id: string) {
    const map = ALL_MAPS[id];
    if (!map) {
      throw new Error(`Map not found: ${id}`);
    }
    return mapDataToEditorFormat(map);
  },

  async saveMap(data: EditorMapData) {
    const mapData = editorFormatToMapData(data);

    // Load existing maps using safe storage
    const existingResult = safeLocalStorageGet<Record<string, MapData>>('voidstrike_editor_maps');
    const savedMaps = existingResult.success && existingResult.data ? existingResult.data : {};

    // Add the new map
    savedMaps[data.id] = mapData;

    // Save with compression for large maps
    const saveResult = safeLocalStorageSet('voidstrike_editor_maps', savedMaps, true);

    if (!saveResult.success) {
      if (saveResult.error === 'quota_exceeded') {
        throw new Error('Storage quota exceeded. Try deleting some saved maps to free up space.');
      }
      throw new Error(saveResult.message || 'Failed to save map to storage');
    }

    debugInitialization.log('[Editor] Map saved to localStorage:', data.id);
  },

  createMap(width: number, height: number, name: string) {
    return createBlankMap(width, height, name);
  },

  async validateMap(data: EditorMapData): Promise<ExtendedValidationResult> {
    const issues: Array<{
      type: 'error' | 'warning';
      message: string;
      issueType?: string;
      affectedNodes?: string[];
      suggestedFix?: { type: string; description: string };
    }> = [];

    // === BASIC VALIDATION ===

    // Check for minimum map size
    if (data.width < 64 || data.height < 64) {
      issues.push({ type: 'error', message: 'Map must be at least 64x64' });
    }

    // Check for spawn points
    const spawns = data.objects.filter(obj => obj.type === 'main_base');
    if (spawns.length < 2) {
      issues.push({
        type: 'error',
        message: 'Map must have at least 2 spawn points (main bases)',
        issueType: 'missing_spawns',
      });
    }

    // Check player count matches spawns
    const playerCount = (data.metadata?.playerCount as number) || 2;
    if (spawns.length !== playerCount) {
      issues.push({
        type: 'warning',
        message: `Player count (${playerCount}) doesn't match spawn count (${spawns.length})`,
        issueType: 'spawn_mismatch',
      });
    }

    // Check for natural expansions
    const naturals = data.objects.filter(obj => obj.type === 'natural');
    if (naturals.length < spawns.length) {
      issues.push({
        type: 'warning',
        message: 'Each spawn should have a natural expansion nearby',
        issueType: 'missing_naturals',
      });
    }

    // === RECAST NAVIGATION VALIDATION ===
    // Uses exact same navmesh as the game for accurate pathfinding validation

    let stats: ExtendedValidationResult['stats'] | undefined;
    let navmeshStats: ExtendedValidationResult['navmeshStats'] | undefined;

    // Only run navmesh validation if we have spawns
    if (spawns.length >= 2) {
      try {
        debugInitialization.log('[Validation] Building navmesh for validation...');

        // Reset and get fresh editor navigation instance
        resetEditorNavigation();
        const editorNav = getEditorNavigation();

        // Build navmesh from editor map data (same as game)
        const buildResult = await editorNav.buildFromMapData(data);

        if (!buildResult.success) {
          issues.push({
            type: 'warning',
            message: `Navmesh generation failed: ${buildResult.error}`,
            issueType: 'navmesh_error',
          });
          navmeshStats = {
            navmeshGenerated: false,
            pathsChecked: 0,
            pathsFound: 0,
            pathsBlocked: 0,
          };
        } else {
          debugInitialization.log('[Validation] Navmesh built, testing paths...');

          // Validate paths between all bases using real navmesh pathfinding
          const pathResults = editorNav.validateBasePaths(data);

          let pathsChecked = 0;
          let pathsFound = 0;
          let pathsBlocked = 0;
          const blockedPaths: Array<{ from: string; to: string }> = [];

          for (const result of pathResults) {
            pathsChecked++;
            if (result.found) {
              pathsFound++;
            } else {
              pathsBlocked++;
              blockedPaths.push({ from: result.from, to: result.to });

              // Add error for blocked critical paths (main bases)
              if (result.from.includes('Main Base') && result.to.includes('Main Base')) {
                issues.push({
                  type: 'error',
                  message: `No path between ${result.from} and ${result.to} - units cannot navigate`,
                  issueType: 'blocked_path',
                  affectedNodes: [result.from, result.to],
                });
              } else {
                // Warning for other blocked paths (naturals, etc.)
                issues.push({
                  type: 'warning',
                  message: `No path from ${result.from} to ${result.to}`,
                  issueType: 'blocked_path',
                  affectedNodes: [result.from, result.to],
                });
              }
            }
          }

          navmeshStats = {
            navmeshGenerated: true,
            pathsChecked,
            pathsFound,
            pathsBlocked,
            blockedPaths: blockedPaths.length > 0 ? blockedPaths : undefined,
          };

          // Add stats (using navmesh results instead of grid-based)
          stats = {
            totalNodes: spawns.length + naturals.length,
            totalEdges: pathsChecked,
            islandCount: pathsBlocked > 0 ? 2 : 1, // Simplified
            connectedPairs: pathsFound,
            blockedPairs: pathsBlocked,
          };

          debugInitialization.log(`[Validation] Path validation complete: ${pathsFound}/${pathsChecked} paths found`);
        }
      } catch (error) {
        debugInitialization.error('[Validation] Navmesh validation failed:', error);
        issues.push({
          type: 'warning',
          message: 'Navmesh validation failed - check console for details',
          issueType: 'navmesh_error',
        });
        navmeshStats = {
          navmeshGenerated: false,
          pathsChecked: 0,
          pathsFound: 0,
          pathsBlocked: 0,
        };
      }
    }

    // Determine overall validity
    const hasErrors = issues.some(i => i.type === 'error');

    return {
      valid: !hasErrors,
      issues,
      stats,
      navmeshStats,
    };
  },

  /**
   * Auto-fix connectivity issues on the map
   */
  async autoFixMap(data: EditorMapData): Promise<EditorMapData | null> {
    try {
      // Convert to MapData
      const mapData = editorFormatToMapData(data);

      // Run auto-fix
      const fixResult = autoFixConnectivity(mapData);

      if (fixResult.rampsAdded === 0) {
        debugInitialization.log('[AutoFix] No fixes applied - map may already be valid or no automatic fixes available');
        return null;
      }

      debugInitialization.log(`[AutoFix] Applied ${fixResult.rampsAdded} ramp(s):`, fixResult.messages);

      // Convert back to editor format
      return mapDataToEditorFormat(mapData);
    } catch (error) {
      debugInitialization.error('[AutoFix] Failed:', error);
      return null;
    }
  },

  exportForGame(data: EditorMapData) {
    return editorFormatToMapData(data);
  },
};

export default voidstrikeDataProvider;
