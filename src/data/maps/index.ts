// Map exports
export * from './MapTypes';
export { VOID_ASSAULT } from './VoidAssault';
export { CRYSTAL_CAVERNS } from './CrystalCaverns';
export { TRAINING_GROUNDS } from './TrainingGrounds';

import { MapData } from './MapTypes';
import { VOID_ASSAULT } from './VoidAssault';
import { CRYSTAL_CAVERNS } from './CrystalCaverns';
import { TRAINING_GROUNDS } from './TrainingGrounds';

// All available maps
export const ALL_MAPS: Record<string, MapData> = {
  [VOID_ASSAULT.id]: VOID_ASSAULT,
  [CRYSTAL_CAVERNS.id]: CRYSTAL_CAVERNS,
  [TRAINING_GROUNDS.id]: TRAINING_GROUNDS,
};

// Maps available for ranked play
export const RANKED_MAPS: MapData[] = Object.values(ALL_MAPS).filter(m => m.isRanked);

// Get map by ID
export function getMapById(id: string): MapData | undefined {
  return ALL_MAPS[id];
}

// Default map for quick play
export const DEFAULT_MAP = TRAINING_GROUNDS;
