/**
 * MapConnectivity.ts - Core Connectivity Graph System
 *
 * The heart of the connectivity-first map architecture.
 * This system ensures that walkability is an EXPLICIT GRAPH rather than
 * being inferred from geometry, solving the persistent ramp/cliff issues.
 *
 * Key principle: If two regions are connected in the graph, units CAN walk between them.
 * The navmesh is generated FROM this graph, not the other way around.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Unique identifier for a connectivity node (region)
 */
export type NodeId = string;

/**
 * Types of regions in the map
 */
export type RegionType =
  | 'main_base' // Starting position with resources
  | 'natural' // Natural expansion
  | 'third' // Third expansion
  | 'fourth' // Fourth expansion
  | 'gold' // Rich/gold expansion
  | 'pocket' // Pocket expansion (protected)
  | 'center' // Map center
  | 'choke' // Narrow passage
  | 'high_ground' // Elevated platform
  | 'low_ground' // Valley/depression
  | 'island' // Isolated (only air access)
  | 'watchtower' // Watch tower location
  | 'open'; // Open terrain

/**
 * Types of connections between regions
 */
export type ConnectionType =
  | 'ramp' // Elevation change via ramp
  | 'ground' // Same-level ground connection
  | 'bridge' // Bridge over obstacle/void
  | 'narrow' // Narrow choke point
  | 'wide' // Wide open connection
  | 'destructible'; // Blocked by destructible rocks

/**
 * A node in the connectivity graph representing a walkable region
 */
export interface ConnectivityNode {
  /** Unique identifier */
  id: NodeId;

  /** Human-readable name for debugging */
  name: string;

  /** Type of region */
  type: RegionType;

  /** Center position of the region */
  center: { x: number; y: number };

  /** Elevation level (0 = lowest) */
  elevation: number;

  /** Radius of the region for terrain generation */
  radius: number;

  /** Optional: Player slot if this is a spawn/base */
  playerSlot?: number;

  /** Optional: Resources at this location */
  resources?: {
    minerals: number;
    vespene: number;
    richMinerals?: number;
  };

  /** Optional: Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * An edge in the connectivity graph representing a walkable path
 */
export interface ConnectivityEdge {
  /** Source node ID */
  from: NodeId;

  /** Target node ID */
  to: NodeId;

  /** Type of connection */
  type: ConnectionType;

  /** Width of the connection (affects pathing) */
  width: number;

  /** Optional: Path waypoints for curved connections */
  waypoints?: Array<{ x: number; y: number }>;

  /** Optional: Blocked by destructible (node ID of destructible) */
  blockedBy?: string;

  /** Bidirectional by default, set false for one-way */
  bidirectional?: boolean;
}

/**
 * The complete connectivity graph for a map
 */
export interface ConnectivityGraph {
  /** All nodes in the graph */
  nodes: Map<NodeId, ConnectivityNode>;

  /** All edges in the graph (stored as adjacency list) */
  edges: Map<NodeId, ConnectivityEdge[]>;

  /** Reverse edges for quick lookup */
  reverseEdges: Map<NodeId, ConnectivityEdge[]>;
}

// ============================================================================
// GRAPH CONSTRUCTION
// ============================================================================

/**
 * Create an empty connectivity graph
 */
export function createConnectivityGraph(): ConnectivityGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    reverseEdges: new Map(),
  };
}

/**
 * Add a node to the connectivity graph
 */
export function addNode(graph: ConnectivityGraph, node: ConnectivityNode): void {
  if (graph.nodes.has(node.id)) {
    throw new Error(`Node with ID "${node.id}" already exists in graph`);
  }
  graph.nodes.set(node.id, node);
  graph.edges.set(node.id, []);
  graph.reverseEdges.set(node.id, []);
}

/**
 * Add an edge to the connectivity graph
 */
export function addEdge(graph: ConnectivityGraph, edge: ConnectivityEdge): void {
  if (!graph.nodes.has(edge.from)) {
    throw new Error(`Source node "${edge.from}" does not exist`);
  }
  if (!graph.nodes.has(edge.to)) {
    throw new Error(`Target node "${edge.to}" does not exist`);
  }

  // Add forward edge
  const fromEdges = graph.edges.get(edge.from) || [];
  fromEdges.push(edge);
  graph.edges.set(edge.from, fromEdges);

  // Add to reverse lookup
  const toReverseEdges = graph.reverseEdges.get(edge.to) || [];
  toReverseEdges.push(edge);
  graph.reverseEdges.set(edge.to, toReverseEdges);

  // If bidirectional (default), add reverse edge
  if (edge.bidirectional !== false) {
    const reverseEdge: ConnectivityEdge = {
      ...edge,
      from: edge.to,
      to: edge.from,
      waypoints: edge.waypoints ? [...edge.waypoints].reverse() : undefined,
    };

    const toEdges = graph.edges.get(edge.to) || [];
    toEdges.push(reverseEdge);
    graph.edges.set(edge.to, toEdges);

    const fromReverseEdges = graph.reverseEdges.get(edge.from) || [];
    fromReverseEdges.push(reverseEdge);
    graph.reverseEdges.set(edge.from, fromReverseEdges);
  }
}

// ============================================================================
// GRAPH QUERIES
// ============================================================================

/**
 * Get all nodes connected to a given node
 */
export function getConnectedNodes(graph: ConnectivityGraph, nodeId: NodeId): ConnectivityNode[] {
  const edges = graph.edges.get(nodeId) || [];
  return edges.map((edge) => graph.nodes.get(edge.to)).filter((n): n is ConnectivityNode => n !== undefined);
}

/**
 * Get all edges from a node
 */
export function getEdgesFrom(graph: ConnectivityGraph, nodeId: NodeId): ConnectivityEdge[] {
  return graph.edges.get(nodeId) || [];
}

/**
 * Get all edges to a node
 */
export function getEdgesTo(graph: ConnectivityGraph, nodeId: NodeId): ConnectivityEdge[] {
  return graph.reverseEdges.get(nodeId) || [];
}

/**
 * Check if two nodes are directly connected
 */
export function areConnected(graph: ConnectivityGraph, nodeA: NodeId, nodeB: NodeId): boolean {
  const edges = graph.edges.get(nodeA) || [];
  return edges.some((edge) => edge.to === nodeB);
}

/**
 * Find path between two nodes using BFS
 */
export function findPath(
  graph: ConnectivityGraph,
  start: NodeId,
  end: NodeId,
  options?: {
    avoidDestructibles?: boolean;
  }
): NodeId[] | null {
  if (!graph.nodes.has(start) || !graph.nodes.has(end)) {
    return null;
  }

  if (start === end) {
    return [start];
  }

  const visited = new Set<NodeId>();
  const queue: Array<{ node: NodeId; path: NodeId[] }> = [{ node: start, path: [start] }];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;

    if (visited.has(node)) continue;
    visited.add(node);

    const edges = graph.edges.get(node) || [];
    for (const edge of edges) {
      // Skip destructible-blocked edges if requested
      if (options?.avoidDestructibles && edge.blockedBy) {
        continue;
      }

      if (edge.to === end) {
        return [...path, end];
      }

      if (!visited.has(edge.to)) {
        queue.push({ node: edge.to, path: [...path, edge.to] });
      }
    }
  }

  return null;
}

/**
 * Get all nodes reachable from a starting node
 */
export function getReachableNodes(
  graph: ConnectivityGraph,
  start: NodeId,
  options?: {
    avoidDestructibles?: boolean;
    maxDepth?: number;
  }
): Set<NodeId> {
  const reachable = new Set<NodeId>();
  const queue: Array<{ node: NodeId; depth: number }> = [{ node: start, depth: 0 }];

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;

    if (reachable.has(node)) continue;
    if (options?.maxDepth !== undefined && depth > options.maxDepth) continue;

    reachable.add(node);

    const edges = graph.edges.get(node) || [];
    for (const edge of edges) {
      if (options?.avoidDestructibles && edge.blockedBy) {
        continue;
      }
      if (!reachable.has(edge.to)) {
        queue.push({ node: edge.to, depth: depth + 1 });
      }
    }
  }

  return reachable;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validation result for connectivity graph
 */
export interface ConnectivityValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate connectivity graph integrity
 */
export function validateConnectivity(graph: ConnectivityGraph): ConnectivityValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for orphan nodes (not connected to anything)
  for (const [nodeId, node] of graph.nodes) {
    const edges = graph.edges.get(nodeId) || [];
    const reverseEdges = graph.reverseEdges.get(nodeId) || [];

    if (edges.length === 0 && reverseEdges.length === 0) {
      if (node.type === 'island') {
        // Islands are allowed to be disconnected
        warnings.push(`Node "${nodeId}" is an island with no connections`);
      } else {
        errors.push(`Node "${nodeId}" has no connections and is not an island`);
      }
    }
  }

  // Check that all player spawns can reach each other
  const spawnNodes = Array.from(graph.nodes.values()).filter((n) => n.playerSlot !== undefined);

  for (let i = 0; i < spawnNodes.length; i++) {
    for (let j = i + 1; j < spawnNodes.length; j++) {
      const path = findPath(graph, spawnNodes[i].id, spawnNodes[j].id);
      if (!path) {
        errors.push(
          `Player spawn "${spawnNodes[i].id}" cannot reach "${spawnNodes[j].id}" - map is not fully connected`
        );
      }
    }
  }

  // Check elevation consistency on ramp edges
  for (const [nodeId] of graph.nodes) {
    const edges = graph.edges.get(nodeId) || [];
    for (const edge of edges) {
      if (edge.type === 'ramp') {
        const fromNode = graph.nodes.get(edge.from);
        const toNode = graph.nodes.get(edge.to);
        if (fromNode && toNode && fromNode.elevation === toNode.elevation) {
          warnings.push(
            `Ramp between "${edge.from}" and "${edge.to}" connects same-elevation regions (elevation ${fromNode.elevation})`
          );
        }
      }
    }
  }

  // Check for duplicate edges
  for (const [nodeId] of graph.nodes) {
    const edges = graph.edges.get(nodeId) || [];
    const seen = new Set<NodeId>();
    for (const edge of edges) {
      if (seen.has(edge.to)) {
        warnings.push(`Duplicate edge from "${nodeId}" to "${edge.to}"`);
      }
      seen.add(edge.to);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// GEOMETRY GENERATION
// ============================================================================

/**
 * Generate walkable polygon for a connection (ramp, bridge, etc.)
 * This is used by the terrain generator to create navmesh-compatible geometry
 */
export function generateConnectionGeometry(
  graph: ConnectivityGraph,
  edge: ConnectivityEdge
): Array<{ x: number; y: number; z: number }> {
  const fromNode = graph.nodes.get(edge.from);
  const toNode = graph.nodes.get(edge.to);

  if (!fromNode || !toNode) {
    return [];
  }

  const points: Array<{ x: number; y: number; z: number }> = [];

  // Start point
  const startZ = fromNode.elevation * 2; // elevation to height conversion
  const endZ = toNode.elevation * 2;

  // If there are waypoints, use them
  if (edge.waypoints && edge.waypoints.length > 0) {
    const allPoints = [fromNode.center, ...edge.waypoints, toNode.center];
    const totalSegments = allPoints.length - 1;

    for (let i = 0; i < allPoints.length; i++) {
      const t = i / totalSegments;
      const z = startZ + (endZ - startZ) * t;
      points.push({ x: allPoints[i].x, y: allPoints[i].y, z });
    }
  } else {
    // Direct line with interpolated height
    const steps = Math.max(2, Math.ceil(distance(fromNode.center, toNode.center) / 5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: fromNode.center.x + (toNode.center.x - fromNode.center.x) * t,
        y: fromNode.center.y + (toNode.center.y - fromNode.center.y) * t,
        z: startZ + (endZ - startZ) * t,
      });
    }
  }

  return points;
}

/**
 * Get the bounding box of a connection for walkable area generation
 */
export function getConnectionBounds(
  graph: ConnectivityGraph,
  edge: ConnectivityEdge
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const fromNode = graph.nodes.get(edge.from);
  const toNode = graph.nodes.get(edge.to);

  if (!fromNode || !toNode) {
    return null;
  }

  const halfWidth = edge.width / 2;
  const points = [fromNode.center, ...(edge.waypoints || []), toNode.center];

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x - halfWidth);
    maxX = Math.max(maxX, p.x + halfWidth);
    minY = Math.min(minY, p.y - halfWidth);
    maxY = Math.max(maxY, p.y + halfWidth);
  }

  return { minX, maxX, minY, maxY };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Calculate distance between two points
 */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Get all nodes of a specific type
 */
export function getNodesByType(graph: ConnectivityGraph, type: RegionType): ConnectivityNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.type === type);
}

/**
 * Get all nodes for a specific player
 */
export function getPlayerNodes(graph: ConnectivityGraph, playerSlot: number): ConnectivityNode[] {
  return Array.from(graph.nodes.values()).filter((n) => n.playerSlot === playerSlot);
}

/**
 * Get all edges of a specific type
 */
export function getEdgesByType(graph: ConnectivityGraph, type: ConnectionType): ConnectivityEdge[] {
  const result: ConnectivityEdge[] = [];
  for (const edges of graph.edges.values()) {
    for (const edge of edges) {
      if (edge.type === type) {
        result.push(edge);
      }
    }
  }
  return result;
}

/**
 * Calculate the total walkable area of all connections
 */
export function calculateTotalConnectionArea(graph: ConnectivityGraph): number {
  let total = 0;
  const counted = new Set<string>();

  for (const [nodeId] of graph.nodes) {
    const edges = graph.edges.get(nodeId) || [];
    for (const edge of edges) {
      // Avoid counting bidirectional edges twice
      const key = [edge.from, edge.to].sort().join('-');
      if (counted.has(key)) continue;
      counted.add(key);

      const fromNode = graph.nodes.get(edge.from);
      const toNode = graph.nodes.get(edge.to);
      if (fromNode && toNode) {
        const length = distance(fromNode.center, toNode.center);
        total += length * edge.width;
      }
    }
  }

  return total;
}

/**
 * Export graph to JSON for debugging/visualization
 */
export function graphToJSON(graph: ConnectivityGraph): string {
  const nodes = Array.from(graph.nodes.values());
  const edges: ConnectivityEdge[] = [];
  const seen = new Set<string>();

  for (const [nodeId] of graph.nodes) {
    for (const edge of graph.edges.get(nodeId) || []) {
      const key = [edge.from, edge.to].sort().join('-');
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }

  return JSON.stringify({ nodes, edges }, null, 2);
}

/**
 * Import graph from JSON
 */
export function graphFromJSON(json: string): ConnectivityGraph {
  const data = JSON.parse(json) as { nodes: ConnectivityNode[]; edges: ConnectivityEdge[] };
  const graph = createConnectivityGraph();

  for (const node of data.nodes) {
    addNode(graph, node);
  }

  for (const edge of data.edges) {
    addEdge(graph, edge);
  }

  return graph;
}
