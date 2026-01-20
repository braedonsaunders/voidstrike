/**
 * ConnectivityGraph - Data structures for map connectivity analysis
 *
 * This module defines the graph structure used to analyze and validate
 * map connectivity, ensuring all bases are reachable.
 */

import { type Point, toXY } from './ElevationMap';
import { distanceXY } from '@/utils/math';

// =============================================================================
// NODE TYPES
// =============================================================================

/** Types of nodes in the connectivity graph */
export type NodeType = 'main' | 'natural' | 'third' | 'fourth' | 'gold' | 'watchtower';

/** A node in the connectivity graph (represents a base or key location) */
export interface ConnectivityNode {
  /** Unique identifier (e.g., 'main_1', 'natural_2') */
  id: string;

  /** Type of location */
  type: NodeType;

  /** Position on the map */
  position: Point;

  /** Elevation at this position */
  elevation: number;

  /** Player number (for main bases) */
  player?: number;

  /** Set of node IDs this node can reach via walkable path */
  reachable: Set<string>;
}

// =============================================================================
// EDGE TYPES
// =============================================================================

/** Types of connections between nodes */
export type EdgeType = 'ground' | 'ramp' | 'blocked';

/** An edge in the connectivity graph (connection between two nodes) */
export interface ConnectivityEdge {
  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;

  /** Type of connection */
  type: EdgeType;

  /** Straight-line distance */
  distance: number;

  /** Actual path distance (if reachable) */
  pathDistance?: number;

  /** The walkable path between nodes (if reachable) */
  path?: Point[];

  /** Elevation change (positive = uphill from→to) */
  elevationDelta: number;
}

// =============================================================================
// GRAPH STRUCTURE
// =============================================================================

/** The complete connectivity graph for a map */
export interface ConnectivityGraph {
  /** All nodes indexed by ID */
  nodes: Map<string, ConnectivityNode>;

  /** All edges indexed by "from:to" */
  edges: Map<string, ConnectivityEdge>;

  /** Groups of mutually connected nodes (islands) */
  islands: string[][];

  /** Whether all main bases are connected */
  allMainsConnected: boolean;

  /** Whether each main can reach its closest natural */
  mainsReachNaturals: boolean;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

/** Severity of connectivity issues */
export type IssueSeverity = 'error' | 'warning';

/** A connectivity issue found during validation */
export interface ConnectivityIssue {
  /** Severity level */
  severity: IssueSeverity;

  /** Human-readable message */
  message: string;

  /** Issue type for programmatic handling */
  type:
    | 'island_isolated'      // A group of bases is completely cut off
    | 'main_unreachable'     // A main base can't reach another main
    | 'natural_unreachable'  // A main can't reach its natural
    | 'expansion_isolated'   // An expansion is cut off
    | 'missing_ramp';        // Elevation difference without ramp

  /** Affected node IDs */
  affectedNodes: string[];

  /** Suggested fix (if available) */
  suggestedFix?: SuggestedFix;
}

/** A suggested fix for a connectivity issue */
export interface SuggestedFix {
  /** Type of fix */
  type: 'add_ramp' | 'lower_elevation' | 'remove_obstacle';

  /** Description of the fix */
  description: string;

  /** For 'add_ramp': the ramp parameters */
  ramp?: {
    from: Point;
    to: Point;
    width: number;
  };

  /** For 'lower_elevation': the area to modify */
  area?: {
    center: Point;
    radius: number;
    targetElevation: number;
  };
}

// =============================================================================
// VALIDATION RESULT
// =============================================================================

/** Result of connectivity validation */
export interface ConnectivityResult {
  /** Whether the map is valid (no errors, warnings OK) */
  valid: boolean;

  /** The connectivity graph */
  graph: ConnectivityGraph;

  /** List of issues found */
  issues: ConnectivityIssue[];

  /** Summary statistics */
  stats: {
    totalNodes: number;
    totalEdges: number;
    islandCount: number;
    connectedPairs: number;
    blockedPairs: number;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** Generate a node ID from type and optional index */
export function nodeId(type: NodeType, index?: number): string {
  return index !== undefined ? `${type}_${index}` : type;
}

/** Parse a node ID into type and index */
export function parseNodeId(id: string): { type: NodeType; index?: number } {
  const parts = id.split('_');
  const type = parts[0] as NodeType;
  const index = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  return { type, index };
}

/** Generate an edge key from two node IDs */
export function edgeKey(from: string, to: string): string {
  // Normalize so 'a:b' and 'b:a' map to the same key
  return from < to ? `${from}:${to}` : `${to}:${from}`;
}

/** Calculate straight-line distance between two points */
export function distance(a: Point, b: Point): number {
  return distanceXY(toXY(a), toXY(b));
}

/** Create an empty connectivity graph */
export function createEmptyGraph(): ConnectivityGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    islands: [],
    allMainsConnected: false,
    mainsReachNaturals: false,
  };
}

/** Create a connectivity node */
export function createNode(
  id: string,
  type: NodeType,
  position: Point,
  elevation: number,
  player?: number
): ConnectivityNode {
  return {
    id,
    type,
    position,
    elevation,
    player,
    reachable: new Set(),
  };
}

/** Create a connectivity edge */
export function createEdge(
  from: string,
  to: string,
  fromPos: Point,
  toPos: Point,
  fromElev: number,
  toElev: number,
  type: EdgeType = 'blocked'
): ConnectivityEdge {
  return {
    from,
    to,
    type,
    distance: distance(fromPos, toPos),
    elevationDelta: toElev - fromElev,
  };
}
