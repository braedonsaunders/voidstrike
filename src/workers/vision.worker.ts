/**
 * Vision Web Worker
 *
 * Offloads fog of war calculations to a separate thread.
 * Processes vision updates for all units/buildings and returns updated vision maps.
 *
 * Messages:
 *   Input:  { type: 'init', mapWidth, mapHeight, cellSize } - Initialize vision grid
 *   Input:  { type: 'updateVision', units, buildings, watchTowers, players } - Compute vision
 *   Output: { type: 'initialized', success: boolean }
 *   Output: { type: 'visionResult', playerVisions: Map<playerId, Uint8Array>, version }
 */

// Debug flag for worker logging (workers can't access UI store)
const DEBUG = false;

// Vision states (encoded as numbers for efficient TypedArray transfer)
const VISION_UNEXPLORED = 0;
const VISION_EXPLORED = 1;
const VISION_VISIBLE = 2;

// Message types
interface InitMessage {
  type: 'init';
  mapWidth: number;
  mapHeight: number;
  cellSize: number;
}

interface UnitData {
  id: number;
  x: number;
  y: number;
  sightRange: number;
  playerId: string;
  isFlying?: boolean;
}

interface BuildingData {
  id: number;
  x: number;
  y: number;
  sightRange: number;
  playerId: string;
  isOperational: boolean;
}

interface WatchTowerData {
  id: number;
  x: number;
  y: number;
  radius: number;
}

interface UpdateVisionMessage {
  type: 'updateVision';
  units: UnitData[];
  buildings: BuildingData[];
  watchTowers: WatchTowerData[];
  watchTowerCaptureRadius: number;
  players: string[];
  version: number;
}

type WorkerMessage = InitMessage | UpdateVisionMessage;

// State
let gridWidth = 0;
let gridHeight = 0;
let cellSize = 2;
let initialized = false;

// Vision grids per player (Uint8Array for efficient transfer)
const playerVisions: Map<string, Uint8Array> = new Map();
// Currently visible cells per player (for fog transition)
const currentlyVisible: Map<string, Set<number>> = new Map();

/**
 * Initialize the vision grid dimensions
 */
function init(mapWidth: number, mapHeight: number, newCellSize: number): boolean {
  try {
    gridWidth = Math.ceil(mapWidth / newCellSize);
    gridHeight = Math.ceil(mapHeight / newCellSize);
    cellSize = newCellSize;

    // Clear any existing data
    playerVisions.clear();
    currentlyVisible.clear();

    initialized = true;
    return true;
  } catch (error) {
    console.error('[VisionWorker] Init failed:', error);
    return false;
  }
}

/**
 * Ensure a player has vision data structures initialized
 */
function ensurePlayerRegistered(playerId: string): void {
  if (playerVisions.has(playerId)) return;

  // Create vision grid for this player (all unexplored)
  const visionGrid = new Uint8Array(gridWidth * gridHeight);
  visionGrid.fill(VISION_UNEXPLORED);
  playerVisions.set(playerId, visionGrid);
  currentlyVisible.set(playerId, new Set());
}

/**
 * Reveal a circular area for a player
 */
function revealArea(playerId: string, worldX: number, worldY: number, range: number): void {
  const visionGrid = playerVisions.get(playerId);
  const visible = currentlyVisible.get(playerId);

  if (!visionGrid || !visible) return;

  const cellX = Math.floor(worldX / cellSize);
  const cellY = Math.floor(worldY / cellSize);
  const cellRange = Math.ceil(range / cellSize);

  // Pre-compute squared range
  const cellRangeSq = cellRange * cellRange;

  // Reveal cells in a circle
  for (let dy = -cellRange; dy <= cellRange; dy++) {
    for (let dx = -cellRange; dx <= cellRange; dx++) {
      // Use squared distance - no sqrt needed
      const distSq = dx * dx + dy * dy;
      if (distSq <= cellRangeSq) {
        const x = cellX + dx;
        const y = cellY + dy;

        if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
          const index = y * gridWidth + x;
          visionGrid[index] = VISION_VISIBLE;
          visible.add(index);
        }
      }
    }
  }
}

/**
 * Update watch tower control and grant vision
 */
function updateWatchTowers(
  watchTowers: WatchTowerData[],
  units: UnitData[],
  captureRadius: number
): void {
  const captureRadiusSq = captureRadius * captureRadius;

  for (const tower of watchTowers) {
    const controllingPlayers = new Set<string>();

    // Find units within capture radius
    for (const unit of units) {
      const dx = unit.x - tower.x;
      const dy = unit.y - tower.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= captureRadiusSq) {
        controllingPlayers.add(unit.playerId);
      }
    }

    // Grant vision to controlling players
    for (const playerId of controllingPlayers) {
      revealArea(playerId, tower.x, tower.y, tower.radius);
    }
  }
}

/**
 * Main vision update computation
 */
function computeVision(
  units: UnitData[],
  buildings: BuildingData[],
  watchTowers: WatchTowerData[],
  watchTowerCaptureRadius: number,
  players: string[]
): void {
  // Ensure all players are registered
  for (const playerId of players) {
    ensurePlayerRegistered(playerId);
  }

  // Mark previously visible cells as explored (fog of war transition)
  for (const playerId of players) {
    const visionGrid = playerVisions.get(playerId);
    const visible = currentlyVisible.get(playerId);

    if (!visionGrid || !visible) continue;

    // Mark all currently visible cells as explored
    for (const index of visible) {
      if (visionGrid[index] === VISION_VISIBLE) {
        visionGrid[index] = VISION_EXPLORED;
      }
    }
    visible.clear();
  }

  // Update vision from all units
  for (const unit of units) {
    revealArea(unit.playerId, unit.x, unit.y, unit.sightRange);
  }

  // Update vision from all operational buildings
  for (const building of buildings) {
    if (building.isOperational) {
      revealArea(building.playerId, building.x, building.y, building.sightRange);
    }
  }

  // Update watch towers
  updateWatchTowers(watchTowers, units, watchTowerCaptureRadius);
}

// Message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init': {
      const success = init(message.mapWidth, message.mapHeight, message.cellSize);
      self.postMessage({ type: 'initialized', success });
      break;
    }

    case 'updateVision': {
      if (!initialized) {
        console.error('[VisionWorker] Not initialized');
        return;
      }

      // Compute vision
      computeVision(
        message.units,
        message.buildings,
        message.watchTowers,
        message.watchTowerCaptureRadius,
        message.players
      );

      // Prepare result - convert to transferable format
      // Create a serializable object with player vision data
      const visionData: Record<string, Uint8Array> = {};
      for (const [playerId, visionGrid] of playerVisions) {
        // Copy the array for transfer (worker keeps its own copy)
        visionData[playerId] = new Uint8Array(visionGrid);
      }

      self.postMessage({
        type: 'visionResult',
        playerVisions: visionData,
        version: message.version,
        gridWidth,
        gridHeight,
      });
      break;
    }
  }
};

// Export for TypeScript module resolution
export {};
