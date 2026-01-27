/**
 * Pathfinding Web Worker
 *
 * Offloads path computation to a separate thread to prevent main thread blocking.
 * Uses recast-navigation WASM for navmesh queries.
 * Supports both ground and water navmeshes for naval units.
 *
 * Messages:
 *   Input:  { type: 'init' } - Initialize WASM module
 *   Input:  { type: 'loadNavMesh', data: Uint8Array } - Load navmesh from binary
 *   Input:  { type: 'loadNavMeshFromGeometry', positions, indices } - Generate navmesh
 *   Input:  { type: 'loadWaterNavMesh', positions, indices } - Load water navmesh for naval units
 *   Input:  { type: 'findPath', requestId, startX, startY, endX, endY, agentRadius }
 *   Input:  { type: 'findWaterPath', requestId, startX, startY, endX, endY, agentRadius }
 *   Input:  { type: 'addObstacle', entityId, centerX, centerY, width, height }
 *   Input:  { type: 'removeObstacle', entityId }
 *   Output: { type: 'initialized', success: boolean }
 *   Output: { type: 'navMeshLoaded', success: boolean }
 *   Output: { type: 'waterNavMeshLoaded', success: boolean }
 *   Output: { type: 'pathResult', requestId, path, found }
 *   Output: { type: 'waterPathResult', requestId, path, found }
 */

import {
  init,
  NavMesh,
  NavMeshQuery,
  TileCache,
  importNavMesh,
  type Obstacle,
} from 'recast-navigation';
import { generateTileCache, generateSoloNavMesh } from '@recast-navigation/generators';
import { distance } from '@/utils/math';
import { NAVMESH_CONFIG, SOLO_NAVMESH_CONFIG } from '@/data/pathfinding.config';

const WALKABLE_DISTANCE_TOLERANCE = Math.max(
  NAVMESH_CONFIG.walkableRadius * 1.5,
  NAVMESH_CONFIG.cs * 1.5
);
const WALKABLE_HEIGHT_TOLERANCE = NAVMESH_CONFIG.walkableClimb * 2;

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
  heightMap?: Float32Array;
  heightMapWidth?: number;
  heightMapHeight?: number;
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

interface LoadWaterNavMeshMessage {
  type: 'loadWaterNavMesh';
  positions: Float32Array;
  indices: Uint32Array;
}

interface FindWaterPathMessage {
  type: 'findWaterPath';
  requestId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  agentRadius: number;
}

interface IsWaterWalkableMessage {
  type: 'isWaterWalkable';
  requestId: number;
  x: number;
  y: number;
}

type WorkerMessage =
  | InitMessage
  | LoadNavMeshMessage
  | LoadNavMeshFromGeometryMessage
  | FindPathMessage
  | AddObstacleMessage
  | RemoveObstacleMessage
  | IsWalkableMessage
  | FindNearestPointMessage
  | LoadWaterNavMeshMessage
  | FindWaterPathMessage
  | IsWaterWalkableMessage;

// Ground navmesh state
let navMesh: NavMesh | null = null;
let navMeshQuery: NavMeshQuery | null = null;
let tileCache: TileCache | null = null;
let initialized = false;
let heightMap: Float32Array | null = null;
let heightMapWidth = 0;
let heightMapHeight = 0;

// Water navmesh state (for naval units)
let waterNavMesh: NavMesh | null = null;
let waterNavMeshQuery: NavMeshQuery | null = null;
const WATER_SURFACE_HEIGHT = 0.15;

function getQueryHalfExtents(searchRadius: number): { x: number; y: number; z: number } {
  const heightTolerance = heightMap ? WALKABLE_HEIGHT_TOLERANCE * 1.5 : 20;
  return { x: searchRadius, y: heightTolerance, z: searchRadius };
}

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
    heightMap = null;
    heightMapWidth = 0;
    heightMapHeight = 0;
    // LIMITATION: TileCache state cannot be serialized/deserialized with recast-navigation-js.
    // Pre-exported navmesh files only contain the static navmesh geometry.
    // Dynamic obstacles (buildings) require TileCache, which is only available when
    // generating the navmesh at runtime via loadNavMeshFromGeometry().
    //
    // Recommended approach: Always use loadNavMeshFromGeometry() for games with buildings.
    // Pre-exported navmesh is only suitable for static maps with no destructible obstacles.
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
  indices: Uint32Array,
  heightMapData?: Float32Array,
  heightMapW?: number,
  heightMapH?: number
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

  if (heightMapData && heightMapW && heightMapH) {
    heightMap = heightMapData;
    heightMapWidth = heightMapW;
    heightMapHeight = heightMapH;
  } else {
    heightMap = null;
    heightMapWidth = 0;
    heightMapHeight = 0;
  }

  try {
    // Try TileCache first (supports dynamic obstacles)
    const result = generateTileCache(positions, indices, NAVMESH_CONFIG);

    if (result.success && result.tileCache && result.navMesh) {
      tileCache = result.tileCache;
      navMesh = result.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      if (heightMapData && heightMapW && heightMapH) {
        heightMap = heightMapData;
        heightMapWidth = heightMapW;
        heightMapHeight = heightMapH;
      }
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
      if (heightMapData && heightMapW && heightMapH) {
        heightMap = heightMapData;
        heightMapWidth = heightMapW;
        heightMapHeight = heightMapH;
      }
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

function getHeightAt(x: number, y: number): number {
  if (!heightMap || heightMapWidth === 0 || heightMapHeight === 0) {
    return 0;
  }

  const maxX = heightMapWidth - 1;
  const maxY = heightMapHeight - 1;

  if (x < 0 || x >= maxX || y < 0 || y >= maxY) {
    return 0;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, maxX);
  const y1 = Math.min(y0 + 1, maxY);

  const fx = x - x0;
  const fy = y - y0;

  const h00 = heightMap[y0 * heightMapWidth + x0];
  const h10 = heightMap[y0 * heightMapWidth + x1];
  const h01 = heightMap[y1 * heightMapWidth + x0];
  const h11 = heightMap[y1 * heightMapWidth + x1];

  return h00 * (1 - fx) * (1 - fy) +
         h10 * fx * (1 - fy) +
         h01 * (1 - fx) * fy +
         h11 * fx * fy;
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
  startHeight?: number,
  endHeight?: number
): { path: Array<{ x: number; y: number }>; found: boolean } {
  if (!navMeshQuery) {
    return { path: [], found: false };
  }

  try {
    const searchRadius = Math.max(agentRadius * 4, 2);
    const halfExtents = getQueryHalfExtents(searchRadius);

    const resolvedStartHeight = startHeight ?? getHeightAt(startX, startY);
    const resolvedEndHeight = endHeight ?? getHeightAt(endX, endY);

    const startQuery = { x: startX, y: resolvedStartHeight, z: startY };
    const endQuery = { x: endX, y: resolvedEndHeight, z: endY };

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
  const dist = distance(from.x, from.y, to.x, to.y);

  if (dist < 0.5) return true;

  const stepSize = agentRadius * 0.5;
  const steps = Math.ceil(dist / stepSize);

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
function isWalkable(x: number, y: number, height?: number): boolean {
  if (!navMeshQuery) return false;

  try {
    const halfExtents = getQueryHalfExtents(2);
    const queryHeight = height ?? getHeightAt(x, y);
    const result = navMeshQuery.findClosestPoint({ x, y: queryHeight, z: y }, { halfExtents });
    if (!result.success || !result.point) return false;

    const dist = distance(x, y, result.point.x, result.point.z);
    const heightDiff = Math.abs(queryHeight - result.point.y);
    return dist < WALKABLE_DISTANCE_TOLERANCE && heightDiff <= WALKABLE_HEIGHT_TOLERANCE;
  } catch {
    return false;
  }
}

/**
 * Find nearest walkable point
 */
function findNearestPoint(x: number, y: number, height?: number): { x: number; y: number } | null {
  if (!navMeshQuery) return null;

  try {
    const halfExtents = getQueryHalfExtents(5);
    const queryHeight = height ?? getHeightAt(x, y);
    const result = navMeshQuery.findClosestPoint({ x, y: queryHeight, z: y }, { halfExtents });
    if (result.success && result.point) {
      return { x: result.point.x, y: result.point.z };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Add cylinder obstacle (5-10x faster than box for TileCache updates)
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
    // Use cylinder for fast TileCache updates
    // Cylinder approximates rectangular building using max dimension
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

// ==================== WATER NAVMESH FUNCTIONS ====================

/**
 * Load water navmesh from geometry (for naval units)
 */
function loadWaterNavMesh(positions: Float32Array, indices: Uint32Array): boolean {
  if (!initialized) {
    console.error('[PathfindingWorker] WASM not initialized');
    return false;
  }

  if (DEBUG) {
    console.log('[PathfindingWorker] Generating water navmesh:', {
      vertices: positions.length / 3,
      triangles: indices.length / 3,
    });
  }

  try {
    // Use solo navmesh for water (no dynamic obstacles needed on water)
    const result = generateSoloNavMesh(positions, indices, SOLO_NAVMESH_CONFIG);

    if (result.success && result.navMesh) {
      waterNavMesh = result.navMesh;
      waterNavMeshQuery = new NavMeshQuery(waterNavMesh);
      if (DEBUG) console.log('[PathfindingWorker] Water navmesh generated successfully');
      return true;
    }

    console.error('[PathfindingWorker] Water navmesh generation failed');
    return false;
  } catch (error) {
    console.error('[PathfindingWorker] Error generating water navmesh:', error);
    return false;
  }
}

/**
 * Find path on water navmesh (for naval units)
 */
function findWaterPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  agentRadius: number
): { path: Array<{ x: number; y: number }>; found: boolean } {
  if (!waterNavMeshQuery) {
    return { path: [], found: false };
  }

  try {
    const halfExtents = { x: 5, y: 2, z: 5 };

    const startResult = waterNavMeshQuery.findClosestPoint(
      { x: startX, y: WATER_SURFACE_HEIGHT, z: startY },
      { halfExtents }
    );

    const endResult = waterNavMeshQuery.findClosestPoint(
      { x: endX, y: WATER_SURFACE_HEIGHT, z: endY },
      { halfExtents }
    );

    if (!startResult.success || !startResult.point) {
      return { path: [], found: false };
    }

    if (!endResult.success || !endResult.point) {
      return { path: [], found: false };
    }

    const pathResult = waterNavMeshQuery.computePath(startResult.point, endResult.point, { halfExtents });

    if (!pathResult.success || !pathResult.path || pathResult.path.length === 0) {
      return { path: [], found: false };
    }

    // Convert to 2D path
    const path = pathResult.path.map((p: { x: number; z: number }) => ({ x: p.x, y: p.z }));
    return { path, found: true };
  } catch {
    return { path: [], found: false };
  }
}

/**
 * Check if point is on water navmesh
 */
function isWaterWalkable(x: number, y: number): boolean {
  if (!waterNavMeshQuery) return false;

  try {
    const halfExtents = { x: 2, y: 2, z: 2 };
    const result = waterNavMeshQuery.findClosestPoint(
      { x, y: WATER_SURFACE_HEIGHT, z: y },
      { halfExtents }
    );

    if (!result.success || !result.point) return false;

    const dist = distance(x, y, result.point.x, result.point.z);
    return dist < WALKABLE_DISTANCE_TOLERANCE;
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
      const success = loadNavMeshFromGeometry(
        message.positions,
        message.indices,
        message.heightMap,
        message.heightMapWidth,
        message.heightMapHeight
      );
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

    case 'loadWaterNavMesh': {
      const success = loadWaterNavMesh(message.positions, message.indices);
      self.postMessage({ type: 'waterNavMeshLoaded', success });
      break;
    }

    case 'findWaterPath': {
      const result = findWaterPath(
        message.startX,
        message.startY,
        message.endX,
        message.endY,
        message.agentRadius
      );
      self.postMessage({
        type: 'waterPathResult',
        requestId: message.requestId,
        path: result.path,
        found: result.found,
      });
      break;
    }

    case 'isWaterWalkable': {
      const walkable = isWaterWalkable(message.x, message.y);
      self.postMessage({
        type: 'isWaterWalkableResult',
        requestId: message.requestId,
        walkable,
      });
      break;
    }
  }
};

// Export for TypeScript module resolution
export {};
