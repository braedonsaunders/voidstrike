/**
 * Pathfinding Web Worker
 *
 * Offloads path computation to a separate thread to prevent main thread blocking.
 * Uses recast-navigation WASM for navmesh queries.
 *
 * Messages:
 *   Input:  { type: 'init' } - Initialize WASM module
 *   Input:  { type: 'loadNavMesh', data: Uint8Array } - Load navmesh from binary
 *   Input:  { type: 'findPath', requestId, startX, startY, endX, endY, agentRadius }
 *   Input:  { type: 'addObstacle', entityId, centerX, centerY, width, height }
 *   Input:  { type: 'removeObstacle', entityId }
 *   Output: { type: 'initialized', success: boolean }
 *   Output: { type: 'navMeshLoaded', success: boolean }
 *   Output: { type: 'pathResult', requestId, path, found }
 */

import {
  init,
  NavMesh,
  NavMeshQuery,
  TileCache,
  importNavMesh,
  type Obstacle,
} from 'recast-navigation';
import { generateTileCache, generateSoloNavMesh, type TileCacheGeneratorConfig, type SoloNavMeshGeneratorConfig } from '@recast-navigation/generators';

// Debug flag for worker logging (workers can't access UI store)
const DEBUG = false;

// Message types
interface InitMessage {
  type: 'init';
}

interface LoadNavMeshMessage {
  type: 'loadNavMesh';
  data: Uint8Array;
  mapWidth: number;
  mapHeight: number;
}

interface LoadNavMeshFromGeometryMessage {
  type: 'loadNavMeshFromGeometry';
  positions: Float32Array;
  indices: Uint32Array;
  mapWidth: number;
  mapHeight: number;
}

interface FindPathMessage {
  type: 'findPath';
  requestId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  agentRadius: number;
  startHeight?: number;
  endHeight?: number;
}

interface AddObstacleMessage {
  type: 'addObstacle';
  entityId: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface RemoveObstacleMessage {
  type: 'removeObstacle';
  entityId: number;
}

interface IsWalkableMessage {
  type: 'isWalkable';
  requestId: number;
  x: number;
  y: number;
  height?: number;
}

interface FindNearestPointMessage {
  type: 'findNearestPoint';
  requestId: number;
  x: number;
  y: number;
  height?: number;
}

type WorkerMessage =
  | InitMessage
  | LoadNavMeshMessage
  | LoadNavMeshFromGeometryMessage
  | FindPathMessage
  | AddObstacleMessage
  | RemoveObstacleMessage
  | IsWalkableMessage
  | FindNearestPointMessage;

// NavMesh config - must match main thread config
const NAVMESH_CONFIG: Partial<TileCacheGeneratorConfig> = {
  cs: 0.5,
  ch: 0.2,
  walkableSlopeAngle: 50,
  walkableHeight: 2,
  walkableClimb: 0.3,
  walkableRadius: 0.6,
  maxSimplificationError: 0.5,
  tileSize: 32,
  expectedLayersPerTile: 4,
  maxObstacles: 512,
};

// Fallback solo navmesh config (no dynamic obstacles, but more robust)
const SOLO_NAVMESH_CONFIG: Partial<SoloNavMeshGeneratorConfig> = {
  cs: 0.5,
  ch: 0.2,
  walkableSlopeAngle: 50,
  walkableHeight: 2,
  walkableClimb: 0.3,
  walkableRadius: 0.6,
  maxSimplificationError: 0.5,
};

// State
let navMesh: NavMesh | null = null;
let navMeshQuery: NavMeshQuery | null = null;
let tileCache: TileCache | null = null;
let initialized = false;

// Track obstacles
const obstacleRefs: Map<number, Obstacle> = new Map();

/**
 * Initialize WASM module
 */
async function initialize(): Promise<boolean> {
  try {
    await init();
    initialized = true;
    return true;
  } catch (error) {
    console.error('[PathfindingWorker] WASM init failed:', error);
    return false;
  }
}

/**
 * Load navmesh from exported binary data
 */
function loadNavMesh(data: Uint8Array): boolean {
  if (!initialized) {
    console.error('[PathfindingWorker] WASM not initialized');
    return false;
  }

  try {
    const result = importNavMesh(data);
    if (!result.navMesh) {
      console.error('[PathfindingWorker] Failed to import navmesh');
      return false;
    }

    navMesh = result.navMesh;
    navMeshQuery = new NavMeshQuery(navMesh);
    // Note: TileCache is not exported/imported, so dynamic obstacles won't work
    // with pre-exported navmesh. Use loadNavMeshFromGeometry for full support.
    tileCache = null;

    return true;
  } catch (error) {
    console.error('[PathfindingWorker] Error loading navmesh:', error);
    return false;
  }
}

/**
 * Generate navmesh from geometry (supports dynamic obstacles)
 */
function loadNavMeshFromGeometry(
  positions: Float32Array,
  indices: Uint32Array
): boolean {
  if (!initialized) {
    console.error('[PathfindingWorker] WASM not initialized');
    return false;
  }

  if (DEBUG) {
    console.log('[PathfindingWorker] Generating navmesh from geometry:', {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
      positionsType: positions.constructor.name,
      indicesType: indices.constructor.name,
    });
  }

  try {
    // Try TileCache first (supports dynamic obstacles)
    const result = generateTileCache(positions, indices, NAVMESH_CONFIG);

    if (result.success && result.tileCache && result.navMesh) {
      tileCache = result.tileCache;
      navMesh = result.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      if (DEBUG) console.log('[PathfindingWorker] TileCache navmesh generated successfully');
      return true;
    }

    // TileCache failed - try solo navmesh fallback
    if (DEBUG) {
      console.warn('[PathfindingWorker] TileCache generation failed:', (result as { error?: string }).error);
      console.log('[PathfindingWorker] Trying solo navmesh fallback...');
    }

    // Solo navmesh fallback (no dynamic obstacles but more robust)
    const soloResult = generateSoloNavMesh(positions, indices, SOLO_NAVMESH_CONFIG);

    if (soloResult.success && soloResult.navMesh) {
      tileCache = null; // No dynamic obstacles in solo mode
      navMesh = soloResult.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      if (DEBUG) console.log('[PathfindingWorker] Solo navmesh generated successfully');
      return true;
    }

    console.error('[PathfindingWorker] Solo navmesh also failed:', (soloResult as { error?: string }).error);
    return false;
  } catch (error) {
    console.error('[PathfindingWorker] Error generating navmesh:', error);
    return false;
  }
}

/**
 * Find path between two points
 */
function findPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  agentRadius: number,
  startHeight: number = 0,
  endHeight: number = 0
): { path: Array<{ x: number; y: number }>; found: boolean } {
  if (!navMeshQuery) {
    return { path: [], found: false };
  }

  try {
    const searchRadius = Math.max(agentRadius * 4, 2);
    const halfExtents = { x: searchRadius, y: 10, z: searchRadius };

    const startQuery = { x: startX, y: startHeight, z: startY };
    const endQuery = { x: endX, y: endHeight, z: endY };

    const startOnMesh = navMeshQuery.findClosestPoint(startQuery, { halfExtents });
    const endOnMesh = navMeshQuery.findClosestPoint(endQuery, { halfExtents });

    if (!startOnMesh.success || !startOnMesh.point || !endOnMesh.success || !endOnMesh.point) {
      return { path: [], found: false };
    }

    const result = navMeshQuery.computePath(startOnMesh.point, endOnMesh.point, { halfExtents });

    if (!result.success || !result.path || result.path.length === 0) {
      return { path: [], found: false };
    }

    // Convert path and apply smoothing
    const rawPath = result.path.map((point: { x: number; y: number; z: number }) => ({
      x: point.x,
      y: point.z,
    }));

    const smoothedPath = smoothPath(rawPath, agentRadius);

    return { path: smoothedPath, found: true };
  } catch {
    return { path: [], found: false };
  }
}

/**
 * Smooth path by removing redundant waypoints
 */
function smoothPath(
  path: Array<{ x: number; y: number }>,
  agentRadius: number
): Array<{ x: number; y: number }> {
  if (path.length <= 2) return path;

  const smoothed: Array<{ x: number; y: number }> = [path[0]];
  let currentIndex = 0;

  while (currentIndex < path.length - 1) {
    let farthestReachable = currentIndex + 1;

    for (let i = path.length - 1; i > currentIndex + 1; i--) {
      if (canWalkDirect(path[currentIndex], path[i], agentRadius)) {
        farthestReachable = i;
        break;
      }
    }

    smoothed.push(path[farthestReachable]);
    currentIndex = farthestReachable;
  }

  return smoothed;
}

/**
 * Check if direct path between two points is walkable
 */
function canWalkDirect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  agentRadius: number
): boolean {
  if (!navMeshQuery) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 0.5) return true;

  const stepSize = agentRadius * 0.5;
  const steps = Math.ceil(distance / stepSize);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;

    if (!isWalkable(x, y)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if point is walkable
 */
function isWalkable(x: number, y: number, height: number = 0): boolean {
  if (!navMeshQuery) return false;

  try {
    const halfExtents = { x: 2, y: 20, z: 2 };
    const result = navMeshQuery.findClosestPoint({ x, y: height, z: y }, { halfExtents });
    if (!result.success || !result.point) return false;

    const dx = result.point.x - x;
    const dz = result.point.z - y;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist < 2.0;
  } catch {
    return false;
  }
}

/**
 * Find nearest walkable point
 */
function findNearestPoint(x: number, y: number, height: number = 0): { x: number; y: number } | null {
  if (!navMeshQuery) return null;

  try {
    const halfExtents = { x: 5, y: 20, z: 5 };
    const result = navMeshQuery.findClosestPoint({ x, y: height, z: y }, { halfExtents });
    if (result.success && result.point) {
      return { x: result.point.x, y: result.point.z };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Add box obstacle
 */
function addObstacle(
  entityId: number,
  centerX: number,
  centerY: number,
  width: number,
  height: number
): boolean {
  if (!tileCache || !navMesh) return false;

  // Remove existing obstacle if present
  if (obstacleRefs.has(entityId)) {
    removeObstacle(entityId);
  }

  try {
    const expansionMargin = 0.1;
    const halfExtents = {
      x: (width / 2) + expansionMargin,
      y: 2.0,
      z: (height / 2) + expansionMargin
    };

    const result = tileCache.addBoxObstacle(
      { x: centerX, y: 0, z: centerY },
      halfExtents,
      0
    );

    if (result.success && result.obstacle) {
      obstacleRefs.set(entityId, result.obstacle);
      tileCache.update(navMesh);
      return true;
    }
  } catch {
    // Fallback to cylinder
    try {
      const baseRadius = Math.max(width, height) / 2;
      const expandedRadius = baseRadius + 0.1;

      const result = tileCache.addCylinderObstacle(
        { x: centerX, y: 0, z: centerY },
        expandedRadius,
        2.0
      );

      if (result.success && result.obstacle) {
        obstacleRefs.set(entityId, result.obstacle);
        tileCache.update(navMesh);
        return true;
      }
    } catch {
      // Ignore
    }
  }

  return false;
}

/**
 * Remove obstacle
 */
function removeObstacle(entityId: number): boolean {
  if (!tileCache || !navMesh) return false;

  const obstacle = obstacleRefs.get(entityId);
  if (!obstacle) return false;

  try {
    tileCache.removeObstacle(obstacle);
    obstacleRefs.delete(entityId);
    tileCache.update(navMesh);
    return true;
  } catch {
    return false;
  }
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init': {
      const success = await initialize();
      self.postMessage({ type: 'initialized', success });
      break;
    }

    case 'loadNavMesh': {
      const success = loadNavMesh(message.data);
      self.postMessage({ type: 'navMeshLoaded', success });
      break;
    }

    case 'loadNavMeshFromGeometry': {
      const success = loadNavMeshFromGeometry(message.positions, message.indices);
      self.postMessage({ type: 'navMeshLoaded', success });
      break;
    }

    case 'findPath': {
      const result = findPath(
        message.startX,
        message.startY,
        message.endX,
        message.endY,
        message.agentRadius,
        message.startHeight,
        message.endHeight
      );
      self.postMessage({
        type: 'pathResult',
        requestId: message.requestId,
        path: result.path,
        found: result.found,
      });
      break;
    }

    case 'addObstacle': {
      addObstacle(
        message.entityId,
        message.centerX,
        message.centerY,
        message.width,
        message.height
      );
      break;
    }

    case 'removeObstacle': {
      removeObstacle(message.entityId);
      break;
    }

    case 'isWalkable': {
      const walkable = isWalkable(message.x, message.y, message.height);
      self.postMessage({
        type: 'isWalkableResult',
        requestId: message.requestId,
        walkable,
      });
      break;
    }

    case 'findNearestPoint': {
      const point = findNearestPoint(message.x, message.y, message.height);
      self.postMessage({
        type: 'findNearestPointResult',
        requestId: message.requestId,
        point,
      });
      break;
    }
  }
};

// Export for TypeScript module resolution
export {};
