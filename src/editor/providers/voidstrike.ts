/**
 * VOIDSTRIKE Data Provider
 *
 * Bridges between the generic editor format and VOIDSTRIKE's MapData format.
 * Handles loading maps, converting between formats, and saving.
 */

import type {
  EditorDataProvider,
  EditorMapData,
  EditorCell,
  EditorObject,
  ValidationResult,
} from '../config/EditorConfig';
import type { MapData, MapCell, Expansion, WatchTower, DestructibleRock, MapDecoration } from '@/data/maps/MapTypes';
import { ALL_MAPS, TERRAIN_FEATURE_CONFIG } from '@/data/maps';
import type { TerrainFeature } from '@/data/maps/MapTypes';

/**
 * Convert VOIDSTRIKE MapData to editor format
 */
function mapDataToEditorFormat(map: MapData): EditorMapData {
  // Convert terrain grid
  const terrain: EditorCell[][] = map.terrain.map((row) =>
    row.map((cell) => {
      const featureConfig = TERRAIN_FEATURE_CONFIG[cell.feature];
      return {
        elevation: cell.elevation,
        feature: cell.feature,
        walkable: cell.terrain !== 'unwalkable' && featureConfig.walkable,
        textureId: cell.textureId,
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
        vespene: exp.vespene,
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
      return {
        terrain: cell.walkable && featureConfig.walkable ? 'ground' : 'unwalkable',
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

  for (const obj of data.objects) {
    if (['main_base', 'natural', 'third', 'fourth', 'gold'].includes(obj.type)) {
      expansions.push({
        name: (obj.properties?.name as string) || `Expansion ${expansions.length + 1}`,
        x: obj.x,
        y: obj.y,
        minerals: (obj.properties?.minerals as any[]) || [],
        vespene: (obj.properties?.vespene as any[]) || [],
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
    decorations: [],
    playerCount: (data.metadata?.playerCount as 2 | 4 | 6 | 8) || 2,
    maxPlayers: (data.metadata?.maxPlayers as number) || 2,
    isRanked: (data.metadata?.isRanked as boolean) || false,
    biome: data.biomeId as any,
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
    // In a real implementation, this would save to a database or file
    // For now, we just convert the format and log it
    const mapData = editorFormatToMapData(data);
    console.log('Saving map:', mapData);
    // TODO: Implement actual persistence
  },

  createMap(width: number, height: number, name: string) {
    return createBlankMap(width, height, name);
  },

  async validateMap(data: EditorMapData): Promise<ValidationResult> {
    // TODO: Use the connectivity validation system
    // For now, return valid
    return {
      valid: true,
      issues: [],
    };
  },

  exportForGame(data: EditorMapData) {
    return editorFormatToMapData(data);
  },
};

export default voidstrikeDataProvider;
