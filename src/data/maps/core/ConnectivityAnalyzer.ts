/**
 * ConnectivityAnalyzer - Analyzes map terrain to build connectivity graph
 *
 * Uses flood-fill from each base location to determine which bases
 * can reach which other bases via walkable paths.
 *
 * IMPORTANT: Uses WALKABLE_CLIMB_ELEVATION from central pathfinding config
 * to ensure validation matches actual in-game Recast Navigation pathfinding.
 */

import type { MapData, MapCell } from '../MapTypes';
import { TERRAIN_FEATURE_CONFIG } from '../MapTypes';
import { type Point, toXY } from './ElevationMap';
import {
  type ConnectivityGraph,
  type ConnectivityNode,
  type ConnectivityEdge,
  type NodeType,
  type EdgeType,
  createEmptyGraph,
  createNode,
  createEdge,
  edgeKey,
  distance,
} from './ConnectivityGraph';
import { WALKABLE_CLIMB_ELEVATION } from '@/data/pathfinding.config';
import { clamp } from '@/utils/math';

// =============================================================================
// WALKABILITY
// =============================================================================

/** Check if a cell is walkable for pathfinding */
function isCellWalkable(cell: MapCell): boolean {
  if (cell.terrain === 'unwalkable') return false;
  const config = TERRAIN_FEATURE_CONFIG[cell.feature];
  return config.walkable;
}

/**
 * Check if movement between two elevations is allowed.
 * Uses WALKABLE_CLIMB_ELEVATION from central pathfinding config.
 */
function canTraverseElevation(fromElev: number, toElev: number, isRamp: boolean): boolean {
  const diff = Math.abs(toElev - fromElev);

  // Ramps allow any elevation change
  if (isRamp) return true;

  // Without ramp, can only traverse elevation differences within walkableClimb
  return diff <= WALKABLE_CLIMB_ELEVATION;
}

// =============================================================================
// FLOOD FILL
// =============================================================================

interface FloodFillResult {
  /** Set of cell indices (y * width + x) that are reachable */
  reachable: Set<number>;
  /** Map of cell index to the path from start (for path reconstruction) */
  pathMap: Map<number, number[]>;
}

/**
 * Flood fill from a starting point, respecting elevation and walkability.
 * Returns all reachable cells and paths to them.
 */
function floodFillFrom(
  terrain: MapCell[][],
  startX: number,
  startY: number,
  width: number,
  height: number
): FloodFillResult {
  const reachable = new Set<number>();
  const pathMap = new Map<number, number[]>();

  // Clamp start position
  const sx = clamp(Math.floor(startX), 0, width - 1);
  const sy = clamp(Math.floor(startY), 0, height - 1);
  const startIdx = sy * width + sx;

  // Find walkable cell near start if start isn't walkable
  let actualStart: { x: number; y: number } | null = null;

  if (isCellWalkable(terrain[sy][sx])) {
    actualStart = { x: sx, y: sy };
  } else {
    // Search outward for walkable cell
    for (let r = 1; r <= 10 && !actualStart; r++) {
      for (let dy = -r; dy <= r && !actualStart; dy++) {
        for (let dx = -r; dx <= r && !actualStart; dx++) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (isCellWalkable(terrain[ny][nx])) {
              actualStart = { x: nx, y: ny };
            }
          }
        }
      }
    }
  }

  if (!actualStart) {
    return { reachable, pathMap };
  }

  // BFS flood fill
  const queue: Array<{ x: number; y: number; path: number[] }> = [];
  const startCellIdx = actualStart.y * width + actualStart.x;

  queue.push({ x: actualStart.x, y: actualStart.y, path: [startCellIdx] });
  reachable.add(startCellIdx);
  pathMap.set(startCellIdx, [startCellIdx]);

  // 8-directional movement
  const directions = [
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentCell = terrain[current.y][current.x];

    for (const { dx, dy } of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const idx = ny * width + nx;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (reachable.has(idx)) continue;

      const nextCell = terrain[ny][nx];

      // Check walkability
      if (!isCellWalkable(nextCell)) continue;

      // Check elevation traversability
      const isRamp = currentCell.terrain === 'ramp' || nextCell.terrain === 'ramp';
      if (!canTraverseElevation(currentCell.elevation, nextCell.elevation, isRamp)) {
        continue;
      }

      // Add to reachable
      reachable.add(idx);
      const newPath = [...current.path, idx];
      pathMap.set(idx, newPath);
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }

  return { reachable, pathMap };
}

// =============================================================================
// NODE EXTRACTION
// =============================================================================

/** Extract connectivity nodes from MapData */
function extractNodes(mapData: MapData): ConnectivityNode[] {
  const nodes: ConnectivityNode[] = [];
  const terrain = mapData.terrain;

  // Extract main bases from spawns
  for (const spawn of mapData.spawns) {
    const x = Math.floor(spawn.x);
    const y = Math.floor(spawn.y);
    const elevation = terrain[y]?.[x]?.elevation ?? 0;

    nodes.push(createNode(
      `main_${spawn.playerSlot}`,
      'main',
      [spawn.x, spawn.y],
      elevation,
      spawn.playerSlot
    ));
  }

  // Extract expansion bases
  for (const exp of mapData.expansions) {
    // Determine expansion type from name or flags
    let type: NodeType = 'third';
    if (exp.isMain) continue; // Skip mains, already added from spawns
    if (exp.isNatural) type = 'natural';
    else if (exp.name.toLowerCase().includes('gold')) type = 'gold';
    else if (exp.name.toLowerCase().includes('fourth')) type = 'fourth';
    else if (exp.name.toLowerCase().includes('natural')) type = 'natural';

    const x = Math.floor(exp.x);
    const y = Math.floor(exp.y);
    const elevation = terrain[y]?.[x]?.elevation ?? 0;

    // Generate unique ID
    const existingOfType = nodes.filter(n => n.type === type).length;
    const id = `${type}_${existingOfType + 1}`;

    nodes.push(createNode(id, type, [exp.x, exp.y], elevation));
  }

  // Extract watch towers
  for (let i = 0; i < mapData.watchTowers.length; i++) {
    const tower = mapData.watchTowers[i];
    const x = Math.floor(tower.x);
    const y = Math.floor(tower.y);
    const elevation = terrain[y]?.[x]?.elevation ?? 0;

    nodes.push(createNode(
      `watchtower_${i + 1}`,
      'watchtower',
      [tower.x, tower.y],
      elevation
    ));
  }

  return nodes;
}

// =============================================================================
// GRAPH BUILDING
// =============================================================================

/**
 * Analyze a map and build its connectivity graph.
 * This performs flood-fill from each node to determine reachability.
 */
export function analyzeConnectivity(mapData: MapData): ConnectivityGraph {
  const graph = createEmptyGraph();
  const { terrain, width, height } = mapData;

  // Extract all nodes
  const nodes = extractNodes(mapData);

  // Add nodes to graph
  for (const node of nodes) {
    graph.nodes.set(node.id, node);
  }

  // Flood fill from each node to find reachability
  const reachabilityMaps = new Map<string, FloodFillResult>();

  for (const node of nodes) {
    const pos = toXY(node.position);
    const result = floodFillFrom(terrain, pos.x, pos.y, width, height);
    reachabilityMaps.set(node.id, result);
  }

  // Build edges based on reachability
  const nodeList = Array.from(graph.nodes.values());

  for (let i = 0; i < nodeList.length; i++) {
    const nodeA = nodeList[i];
    const reachA = reachabilityMaps.get(nodeA.id)!;

    for (let j = i + 1; j < nodeList.length; j++) {
      const nodeB = nodeList[j];

      // Check if B is reachable from A
      const bPos = toXY(nodeB.position);
      const bx = Math.floor(bPos.x);
      const by = Math.floor(bPos.y);
      const bIdx = by * width + bx;

      // Check if reachable (also check nearby cells)
      let isReachable = reachA.reachable.has(bIdx);
      let reachableIdx = bIdx;

      if (!isReachable) {
        // Check nearby cells
        for (let r = 1; r <= 5 && !isReachable; r++) {
          for (let dy = -r; dy <= r && !isReachable; dy++) {
            for (let dx = -r; dx <= r && !isReachable; dx++) {
              const nx = bx + dx;
              const ny = by + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (reachA.reachable.has(nIdx)) {
                  isReachable = true;
                  reachableIdx = nIdx;
                }
              }
            }
          }
        }
      }

      // Create edge
      const key = edgeKey(nodeA.id, nodeB.id);
      let edgeType: EdgeType = 'blocked';
      let path: Point[] | undefined;
      let pathDistance: number | undefined;

      if (isReachable) {
        // Determine if this is a ramp connection
        const pathIndices = reachA.pathMap.get(reachableIdx);
        if (pathIndices) {
          // Check if path goes through ramps
          const hasRamp = pathIndices.some(idx => {
            const py = Math.floor(idx / width);
            const px = idx % width;
            return terrain[py][px].terrain === 'ramp';
          });

          edgeType = hasRamp ? 'ramp' : 'ground';
          pathDistance = pathIndices.length;

          // Convert path indices to points (sample every N cells to avoid huge paths)
          const sampleRate = Math.max(1, Math.floor(pathIndices.length / 20));
          path = pathIndices
            .filter((_, i) => i % sampleRate === 0 || i === pathIndices.length - 1)
            .map(idx => {
              const py = Math.floor(idx / width);
              const px = idx % width;
              return [px, py] as Point;
            });
        }

        // Update node reachability sets
        nodeA.reachable.add(nodeB.id);
        nodeB.reachable.add(nodeA.id);
      }

      const edge = createEdge(
        nodeA.id,
        nodeB.id,
        nodeA.position,
        nodeB.position,
        nodeA.elevation,
        nodeB.elevation,
        edgeType
      );
      edge.path = path;
      edge.pathDistance = pathDistance;

      graph.edges.set(key, edge);
    }
  }

  // Find connected components (islands)
  graph.islands = findIslands(graph);

  // Check if all mains are connected
  const mainNodes = nodeList.filter(n => n.type === 'main');
  if (mainNodes.length > 1) {
    const firstMain = mainNodes[0];
    graph.allMainsConnected = mainNodes.every(m =>
      m.id === firstMain.id || firstMain.reachable.has(m.id)
    );
  } else {
    graph.allMainsConnected = true;
  }

  // Check if each main can reach at least one natural
  const naturalNodes = nodeList.filter(n => n.type === 'natural');
  if (naturalNodes.length > 0 && mainNodes.length > 0) {
    graph.mainsReachNaturals = mainNodes.every(main =>
      naturalNodes.some(nat => main.reachable.has(nat.id))
    );
  } else {
    graph.mainsReachNaturals = true;
  }

  return graph;
}

/**
 * Find connected components (islands) in the graph using Union-Find.
 */
function findIslands(graph: ConnectivityGraph): string[][] {
  const nodes = Array.from(graph.nodes.keys());
  const parent = new Map<string, string>();

  // Initialize each node as its own parent
  for (const id of nodes) {
    parent.set(id, id);
  }

  // Find with path compression
  function find(id: string): string {
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  }

  // Union connected nodes
  for (const edge of graph.edges.values()) {
    if (edge.type !== 'blocked') {
      const rootA = find(edge.from);
      const rootB = find(edge.to);
      if (rootA !== rootB) {
        parent.set(rootA, rootB);
      }
    }
  }

  // Group nodes by their root
  const groups = new Map<string, string[]>();
  for (const id of nodes) {
    const root = find(id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(id);
  }

  return Array.from(groups.values());
}

/**
 * Get a summary of the connectivity analysis.
 */
export function getConnectivitySummary(graph: ConnectivityGraph): string {
  const lines: string[] = [];

  lines.push(`Connectivity Analysis:`);
  lines.push(`  Nodes: ${graph.nodes.size}`);
  lines.push(`  Islands: ${graph.islands.length}`);
  lines.push(`  All Mains Connected: ${graph.allMainsConnected ? 'Yes' : 'NO!'}`);
  lines.push(`  Mains Reach Naturals: ${graph.mainsReachNaturals ? 'Yes' : 'NO!'}`);

  if (graph.islands.length > 1) {
    lines.push(`  Island Details:`);
    for (let i = 0; i < graph.islands.length; i++) {
      lines.push(`    Island ${i + 1}: ${graph.islands[i].join(', ')}`);
    }
  }

  // Count edge types
  let groundEdges = 0;
  let rampEdges = 0;
  let blockedEdges = 0;

  for (const edge of graph.edges.values()) {
    if (edge.type === 'ground') groundEdges++;
    else if (edge.type === 'ramp') rampEdges++;
    else blockedEdges++;
  }

  lines.push(`  Edges: ${graph.edges.size} total`);
  lines.push(`    Ground: ${groundEdges}`);
  lines.push(`    Ramp: ${rampEdges}`);
  lines.push(`    Blocked: ${blockedEdges}`);

  return lines.join('\n');
}
