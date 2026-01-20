/**
 * Overlay Computation Web Worker
 *
 * Offloads expensive overlay calculations to a separate thread.
 * Handles:
 * - Navmesh connectivity visualization (progressive chunk-based)
 * - Threat zone computation
 * - Buildable grid computation
 *
 * Messages:
 *   Input:  { type: 'init', mapWidth, mapHeight } - Initialize worker
 *   Input:  { type: 'computeNavmesh', refX, refY, walkableData, terrainData } - Start navmesh viz
 *   Input:  { type: 'computeThreat', enemies } - Compute threat zones
 *   Input:  { type: 'computeBuildable', terrainData, buildings } - Compute buildable grid
 *   Input:  { type: 'cancel' } - Cancel current operation
 *   Output: { type: 'initialized' }
 *   Output: { type: 'navmeshChunk', chunkX, chunkY, data, progress }
 *   Output: { type: 'navmeshComplete', stats }
 *   Output: { type: 'threatResult', data }
 *   Output: { type: 'buildableResult', data }
 */

// Chunk size for progressive navmesh computation
const CHUNK_SIZE = 32;

// State
let mapWidth = 0;
let mapHeight = 0;
let initialized = false;
let cancelled = false;

// Message types
interface InitMessage {
  type: 'init';
  mapWidth: number;
  mapHeight: number;
}

interface ComputeNavmeshMessage {
  type: 'computeNavmesh';
  refX: number;
  refY: number;
  // Pre-computed walkability data from main thread (avoids navmesh queries in worker)
  walkableData: Uint8Array; // 1 = walkable, 0 = not walkable
  // Terrain type data for color coding
  terrainData: Uint8Array; // 0 = normal, 1 = ramp, 2 = unwalkable
  // Connectivity data - which cells can reach reference point
  connectivityData: Uint8Array; // 1 = connected, 0 = disconnected
}

interface ComputeThreatMessage {
  type: 'computeThreat';
  enemies: Array<{
    x: number;
    y: number;
    attackRange: number;
    isBuilding: boolean;
  }>;
}

interface ComputeBuildableMessage {
  type: 'computeBuildable';
  terrainData: Uint8Array; // 0 = buildable, 1 = unbuildable, 2 = occupied
  buildings: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

interface CancelMessage {
  type: 'cancel';
}

type WorkerMessage = InitMessage | ComputeNavmeshMessage | ComputeThreatMessage | ComputeBuildableMessage | CancelMessage;

/**
 * Initialize the worker with map dimensions
 */
function init(width: number, height: number): void {
  mapWidth = width;
  mapHeight = height;
  initialized = true;
  cancelled = false;
}

/**
 * Compute navmesh visualization in chunks
 * This processes pre-computed data from the main thread into colored texture data
 */
function computeNavmesh(
  refX: number,
  refY: number,
  walkableData: Uint8Array,
  terrainData: Uint8Array,
  connectivityData: Uint8Array
): void {
  if (!initialized) {
    self.postMessage({ type: 'error', message: 'Worker not initialized' });
    return;
  }

  cancelled = false;

  const chunksX = Math.ceil(mapWidth / CHUNK_SIZE);
  const chunksY = Math.ceil(mapHeight / CHUNK_SIZE);
  const totalChunks = chunksX * chunksY;
  let processedChunks = 0;

  let connectedCount = 0;
  let disconnectedCount = 0;
  let unwalkableCount = 0;
  let notOnNavmeshCount = 0;

  // Process chunks
  for (let cy = 0; cy < chunksY && !cancelled; cy++) {
    for (let cx = 0; cx < chunksX && !cancelled; cx++) {
      const startX = cx * CHUNK_SIZE;
      const startY = cy * CHUNK_SIZE;
      const endX = Math.min(startX + CHUNK_SIZE, mapWidth);
      const endY = Math.min(startY + CHUNK_SIZE, mapHeight);
      const chunkWidth = endX - startX;
      const chunkHeight = endY - startY;

      // Create chunk data (RGBA)
      const chunkData = new Uint8Array(chunkWidth * chunkHeight * 4);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const mapIndex = y * mapWidth + x;
          const chunkIndex = ((y - startY) * chunkWidth + (x - startX)) * 4;

          const isWalkable = walkableData[mapIndex] === 1;
          const terrainType = terrainData[mapIndex]; // 0 = normal, 1 = ramp, 2 = unwalkable
          const isConnected = connectivityData[mapIndex] === 1;

          if (terrainType === 2) {
            // Unwalkable - dark gray
            chunkData[chunkIndex + 0] = 60;
            chunkData[chunkIndex + 1] = 60;
            chunkData[chunkIndex + 2] = 60;
            chunkData[chunkIndex + 3] = 150;
            unwalkableCount++;
          } else if (!isWalkable) {
            // Should be walkable but navmesh says no - red
            chunkData[chunkIndex + 0] = 255;
            chunkData[chunkIndex + 1] = 50;
            chunkData[chunkIndex + 2] = 50;
            chunkData[chunkIndex + 3] = 220;
            notOnNavmeshCount++;
          } else if (isConnected) {
            // Connected to reference point
            if (terrainType === 1) {
              // Connected ramp - bright cyan/green
              chunkData[chunkIndex + 0] = 50;
              chunkData[chunkIndex + 1] = 255;
              chunkData[chunkIndex + 2] = 200;
              chunkData[chunkIndex + 3] = 220;
            } else {
              // Normal connected cell - green
              chunkData[chunkIndex + 0] = 50;
              chunkData[chunkIndex + 1] = 200;
              chunkData[chunkIndex + 2] = 50;
              chunkData[chunkIndex + 3] = 180;
            }
            connectedCount++;
          } else {
            // Disconnected - on navmesh but can't reach reference
            if (terrainType === 1) {
              // Disconnected ramp - magenta (critical issue!)
              chunkData[chunkIndex + 0] = 255;
              chunkData[chunkIndex + 1] = 50;
              chunkData[chunkIndex + 2] = 255;
              chunkData[chunkIndex + 3] = 255;
            } else {
              // Normal disconnected cell - yellow/orange
              chunkData[chunkIndex + 0] = 255;
              chunkData[chunkIndex + 1] = 200;
              chunkData[chunkIndex + 2] = 50;
              chunkData[chunkIndex + 3] = 220;
            }
            disconnectedCount++;
          }
        }
      }

      processedChunks++;
      const progress = processedChunks / totalChunks;

      // Send chunk data back to main thread
      self.postMessage({
        type: 'navmeshChunk',
        chunkX: startX,
        chunkY: startY,
        chunkWidth,
        chunkHeight,
        data: chunkData,
        progress,
      }, { transfer: [chunkData.buffer] });
    }
  }

  if (!cancelled) {
    self.postMessage({
      type: 'navmeshComplete',
      stats: {
        connected: connectedCount,
        disconnected: disconnectedCount,
        notOnNavmesh: notOnNavmeshCount,
        unwalkable: unwalkableCount,
      },
    });
  }
}

/**
 * Compute threat zones from enemy positions
 */
function computeThreat(
  enemies: Array<{ x: number; y: number; attackRange: number; isBuilding: boolean }>
): void {
  if (!initialized) {
    self.postMessage({ type: 'error', message: 'Worker not initialized' });
    return;
  }

  const data = new Uint8Array(mapWidth * mapHeight * 4);

  // Initialize to transparent
  for (let i = 0; i < data.length; i += 4) {
    data[i + 0] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 0;
  }

  // Accumulate threat from all enemies
  for (const enemy of enemies) {
    const cx = Math.floor(enemy.x);
    const cy = Math.floor(enemy.y);
    const rangeInt = Math.ceil(enemy.attackRange);
    const baseIntensity = enemy.isBuilding ? 100 : 80;
    const baseAlpha = enemy.isBuilding ? 80 : 60;

    for (let dy = -rangeInt; dy <= rangeInt; dy++) {
      for (let dx = -rangeInt; dx <= rangeInt; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= mapWidth || py < 0 || py >= mapHeight) continue;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= enemy.attackRange) {
          const i = (py * mapWidth + px) * 4;
          const intensity = Math.min(255, data[i + 0] + baseIntensity);
          data[i + 0] = intensity;
          data[i + 3] = Math.min(220, data[i + 3] + baseAlpha);
        }
      }
    }
  }

  self.postMessage({
    type: 'threatResult',
    data,
  }, { transfer: [data.buffer] });
}

/**
 * Compute buildable grid
 */
function computeBuildable(
  terrainData: Uint8Array,
  buildings: Array<{ x: number; y: number; width: number; height: number }>
): void {
  if (!initialized) {
    self.postMessage({ type: 'error', message: 'Worker not initialized' });
    return;
  }

  const data = new Uint8Array(mapWidth * mapHeight * 4);

  // First pass: terrain buildability
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const i = (y * mapWidth + x) * 4;
      const terrainType = terrainData[y * mapWidth + x];

      if (terrainType === 0) {
        // Buildable - green tint
        data[i + 0] = 50;
        data[i + 1] = 200;
        data[i + 2] = 50;
        data[i + 3] = 100;
      } else {
        // Unbuildable - red tint
        data[i + 0] = 200;
        data[i + 1] = 50;
        data[i + 2] = 50;
        data[i + 3] = 100;
      }
    }
  }

  // Second pass: mark occupied cells
  for (const building of buildings) {
    const startX = Math.floor(building.x - building.width / 2);
    const startY = Math.floor(building.y - building.height / 2);
    const endX = startX + building.width;
    const endY = startY + building.height;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) continue;
        const i = (y * mapWidth + x) * 4;
        // Occupied - gray
        data[i + 0] = 100;
        data[i + 1] = 100;
        data[i + 2] = 100;
        data[i + 3] = 150;
      }
    }
  }

  self.postMessage({
    type: 'buildableResult',
    data,
  }, { transfer: [data.buffer] });
}

// Message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      init(message.mapWidth, message.mapHeight);
      self.postMessage({ type: 'initialized' });
      break;

    case 'computeNavmesh':
      computeNavmesh(
        message.refX,
        message.refY,
        message.walkableData,
        message.terrainData,
        message.connectivityData
      );
      break;

    case 'computeThreat':
      computeThreat(message.enemies);
      break;

    case 'computeBuildable':
      computeBuildable(message.terrainData, message.buildings);
      break;

    case 'cancel':
      cancelled = true;
      break;
  }
};

// Export for TypeScript module resolution
export {};
