import { describe, expect, it } from 'vitest';
import type { MapGenerationSettings } from '@/editor/services/LLMMapGenerator';
import { generateMapWithLLM } from '@/editor/services/LLMMapGenerator';

const BASE_SETTINGS: MapGenerationSettings = {
  playerCount: 2,
  mapSize: 'medium',
  biome: 'void',
  theme: 'internal test arena',
  includeWater: false,
  includeForests: true,
  islandMap: false,
  borderStyle: 'rocks',
};

describe('internal keyless map generation', () => {
  it('generates valid connected maps for supported player counts', async () => {
    for (const playerCount of [2, 4, 6, 8] as const) {
      const result = await generateMapWithLLM(
        { provider: 'internal', apiKey: '' },
        {
          ...BASE_SETTINGS,
          playerCount,
          theme: `internal_${playerCount}p_validation`,
        }
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.mapData).toBeDefined();
      expect(result.blueprint).toBeDefined();

      const map = result.mapData!;
      expect(map.playerCount).toBe(playerCount);
      expect(map.spawns.length).toBe(playerCount);

      const naturalExpansions = map.expansions.filter((expansion) => expansion.isNatural);
      expect(naturalExpansions.length).toBeGreaterThanOrEqual(playerCount);

      const spawnKeys = new Set(map.spawns.map((spawn) => `${spawn.x},${spawn.y}`));
      expect(spawnKeys.size).toBe(playerCount);

      for (const spawn of map.spawns) {
        const cell = map.terrain[Math.floor(spawn.y)]?.[Math.floor(spawn.x)];
        expect(cell).toBeDefined();
        expect(cell?.terrain).not.toBe('unwalkable');
      }

      expect(map.ramps.length).toBeGreaterThan(0);
    }
  });
});
