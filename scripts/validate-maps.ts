/**
 * Validate map JSON files by deserializing and checking terrain at key locations.
 */

import { jsonToMapData } from '../src/data/maps/serialization/deserialize';
import type { MapJson } from '../src/data/maps/schema/MapJsonSchema';
import { validateMapJson } from '../src/data/maps/schema/MapJsonSchema';
import * as fs from 'fs';
import * as path from 'path';

const MAP_DIR = path.join(__dirname, '..', 'src', 'data', 'maps', 'json');

const files = fs.readdirSync(MAP_DIR).filter((f) => f.endsWith('.json'));

let hasErrors = false;

for (const file of files) {
  const filePath = path.join(MAP_DIR, file);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`\n=== ${file} ===`);

  // Schema validation
  if (!validateMapJson(raw)) {
    console.error(`  FAIL: Schema validation failed`);
    hasErrors = true;
    continue;
  }

  const json = raw as MapJson;

  // Deserialize
  let mapData;
  try {
    mapData = jsonToMapData(json);
  } catch (e) {
    console.error(`  FAIL: Deserialization error: ${e}`);
    hasErrors = true;
    continue;
  }

  console.log(`  OK: Deserialized ${mapData.width}x${mapData.height}, ${mapData.playerCount}p`);

  // Check spawns are on walkable terrain
  for (const spawn of mapData.spawns) {
    const cell = mapData.terrain[spawn.y]?.[spawn.x];
    if (!cell) {
      console.error(
        `  FAIL: Spawn P${spawn.playerSlot} at (${spawn.x},${spawn.y}) is OUT OF BOUNDS`
      );
      hasErrors = true;
    } else if (cell.terrain === 'unwalkable') {
      console.error(
        `  FAIL: Spawn P${spawn.playerSlot} at (${spawn.x},${spawn.y}) is on UNWALKABLE terrain (elev=${cell.elevation}, feature=${cell.feature})`
      );
      hasErrors = true;
    } else {
      console.log(
        `  OK: Spawn P${spawn.playerSlot} at (${spawn.x},${spawn.y}) terrain=${cell.terrain} elev=${cell.elevation}`
      );
    }
  }

  // Check expansion positions
  for (const exp of mapData.expansions) {
    const cell = mapData.terrain[exp.y]?.[exp.x];
    if (!cell) {
      console.error(`  FAIL: Expansion "${exp.name}" at (${exp.x},${exp.y}) is OUT OF BOUNDS`);
      hasErrors = true;
    } else if (cell.terrain === 'unwalkable') {
      console.error(
        `  WARN: Expansion "${exp.name}" at (${exp.x},${exp.y}) is on UNWALKABLE terrain`
      );
    }

    // Check minerals/plasma positions
    for (const m of exp.minerals) {
      const mc = mapData.terrain[Math.floor(m.y)]?.[Math.floor(m.x)];
      if (!mc) {
        console.error(`  FAIL: Mineral at (${m.x},${m.y}) for "${exp.name}" is OUT OF BOUNDS`);
        hasErrors = true;
      }
    }
  }

  // Check terrain array dimensions
  if (mapData.terrain.length !== mapData.height) {
    console.error(`  FAIL: terrain rows ${mapData.terrain.length} != height ${mapData.height}`);
    hasErrors = true;
  }
  if (mapData.terrain[0]?.length !== mapData.width) {
    console.error(`  FAIL: terrain cols ${mapData.terrain[0]?.length} != width ${mapData.width}`);
    hasErrors = true;
  }

  // Check for required isSpecialMode for battle_arena
  if (json.id === 'battle_arena' && !json.isSpecialMode) {
    console.error(`  FAIL: battle_arena missing isSpecialMode: true`);
    hasErrors = true;
  }
}

console.log(hasErrors ? '\n*** ERRORS FOUND ***' : '\n*** ALL MAPS VALID ***');
process.exit(hasErrors ? 1 : 0);
