/**
 * ConnectivityValidator - Validates map connectivity and reports issues
 *
 * Checks that:
 * 1. All main bases can reach each other
 * 2. Each main can reach at least one natural expansion
 * 3. No important bases are isolated
 *
 * Uses WALKABLE_CLIMB_ELEVATION from central pathfinding config.
 */

import { toXY } from './ElevationMap';
import {
  type ConnectivityGraph,
  type ConnectivityNode,
  type ConnectivityIssue,
  type ConnectivityResult,
  type SuggestedFix,
  distance,
} from './ConnectivityGraph';
import { WALKABLE_CLIMB_ELEVATION } from '@/data/pathfinding.config';
import { clamp } from '@/utils/math';

// =============================================================================
// VALIDATION RULES
// =============================================================================

/**
 * Rule: All main bases must be able to reach each other.
 * This is critical - if mains can't reach each other, the game is broken.
 */
function validateMainsConnected(graph: ConnectivityGraph): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];
  const mainNodes = Array.from(graph.nodes.values()).filter(n => n.type === 'main');

  if (mainNodes.length < 2) return issues;

  // Check each pair of mains
  for (let i = 0; i < mainNodes.length; i++) {
    for (let j = i + 1; j < mainNodes.length; j++) {
      const mainA = mainNodes[i];
      const mainB = mainNodes[j];

      if (!mainA.reachable.has(mainB.id)) {
        // Find suggested ramp placement
        const suggestedFix = suggestRampBetween(graph, mainA, mainB);

        issues.push({
          severity: 'error',
          message: `Main base ${mainA.id} cannot reach ${mainB.id}`,
          type: 'main_unreachable',
          affectedNodes: [mainA.id, mainB.id],
          suggestedFix,
        });
      }
    }
  }

  return issues;
}

/**
 * Rule: Each main should be able to reach at least one natural expansion.
 * Naturals are the first expansion and should be accessible from main.
 */
function validateMainsReachNaturals(graph: ConnectivityGraph): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];
  const mainNodes = Array.from(graph.nodes.values()).filter(n => n.type === 'main');
  const naturalNodes = Array.from(graph.nodes.values()).filter(n => n.type === 'natural');

  if (naturalNodes.length === 0) return issues;

  for (const main of mainNodes) {
    // Find closest natural
    let closestNatural: ConnectivityNode | null = null;
    let closestDist = Infinity;

    for (const nat of naturalNodes) {
      const d = distance(main.position, nat.position);
      if (d < closestDist) {
        closestDist = d;
        closestNatural = nat;
      }
    }

    if (closestNatural && !main.reachable.has(closestNatural.id)) {
      const suggestedFix = suggestRampBetween(graph, main, closestNatural);

      issues.push({
        severity: 'error',
        message: `Main base ${main.id} cannot reach its closest natural (${closestNatural.id})`,
        type: 'natural_unreachable',
        affectedNodes: [main.id, closestNatural.id],
        suggestedFix,
      });
    }
  }

  return issues;
}

/**
 * Rule: Check for completely isolated islands.
 * An island containing a main base that can't reach other mains is critical.
 */
function validateNoIsolatedIslands(graph: ConnectivityGraph): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];

  if (graph.islands.length <= 1) return issues;

  // Find which island has the most main bases
  let largestMainIsland: string[] = [];
  let largestMainCount = 0;

  for (const island of graph.islands) {
    const mainCount = island.filter(id => {
      const node = graph.nodes.get(id);
      return node?.type === 'main';
    }).length;

    if (mainCount > largestMainCount) {
      largestMainCount = mainCount;
      largestMainIsland = island;
    }
  }

  // Check other islands for important bases
  for (const island of graph.islands) {
    if (island === largestMainIsland) continue;

    const hasMains = island.some(id => graph.nodes.get(id)?.type === 'main');
    const hasNaturals = island.some(id => graph.nodes.get(id)?.type === 'natural');
    const hasExpansions = island.some(id => {
      const type = graph.nodes.get(id)?.type;
      return type === 'third' || type === 'fourth' || type === 'gold';
    });

    if (hasMains) {
      issues.push({
        severity: 'error',
        message: `Island containing ${island.filter(id => graph.nodes.get(id)?.type === 'main').join(', ')} is isolated from the main game area`,
        type: 'island_isolated',
        affectedNodes: island,
      });
    } else if (hasNaturals || hasExpansions) {
      issues.push({
        severity: 'warning',
        message: `Island containing ${island.join(', ')} is isolated`,
        type: 'expansion_isolated',
        affectedNodes: island,
      });
    }
  }

  return issues;
}

/**
 * Rule: Check for blocked edges between adjacent bases (might need ramps).
 */
function validateRampNeeds(graph: ConnectivityGraph): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];

  for (const edge of graph.edges.values()) {
    if (edge.type !== 'blocked') continue;

    const nodeA = graph.nodes.get(edge.from);
    const nodeB = graph.nodes.get(edge.to);

    if (!nodeA || !nodeB) continue;

    // Check if these are adjacent bases that should be connected
    const isMainNatural =
      (nodeA.type === 'main' && nodeB.type === 'natural') ||
      (nodeA.type === 'natural' && nodeB.type === 'main');

    const isNaturalThird =
      (nodeA.type === 'natural' && nodeB.type === 'third') ||
      (nodeA.type === 'third' && nodeB.type === 'natural');

    // Only flag if distance is reasonable (< 100 units) and elevation differs
    const dist = distance(nodeA.position, nodeB.position);
    const elevDiff = Math.abs(nodeA.elevation - nodeB.elevation);

    // Use central pathfinding config threshold
    if ((isMainNatural || isNaturalThird) && dist < 100 && elevDiff > WALKABLE_CLIMB_ELEVATION) {
      const suggestedFix = suggestRampBetween(graph, nodeA, nodeB);

      issues.push({
        severity: 'warning',
        message: `${nodeA.id} and ${nodeB.id} are close but blocked by elevation (diff: ${elevDiff})`,
        type: 'missing_ramp',
        affectedNodes: [nodeA.id, nodeB.id],
        suggestedFix,
      });
    }
  }

  return issues;
}

// =============================================================================
// FIX SUGGESTIONS
// =============================================================================

/**
 * Suggest a ramp placement to connect two nodes.
 */
function suggestRampBetween(
  graph: ConnectivityGraph,
  nodeA: ConnectivityNode,
  nodeB: ConnectivityNode
): SuggestedFix {
  // Calculate midpoint for ramp placement
  const posA = toXY(nodeA.position);
  const posB = toXY(nodeB.position);
  const _midX = (posA.x + posB.x) / 2;
  const _midY = (posA.y + posB.y) / 2;

  // Determine ramp direction and width based on distance
  const dist = distance(nodeA.position, nodeB.position);
  const rampWidth = clamp(Math.floor(dist / 5), 8, 12);

  return {
    type: 'add_ramp',
    description: `Add ramp between ${nodeA.id} and ${nodeB.id}`,
    ramp: {
      from: nodeA.position,
      to: nodeB.position,
      width: rampWidth,
    },
  };
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Validate a connectivity graph and return all issues found.
 */
export function validateConnectivity(graph: ConnectivityGraph): ConnectivityResult {
  const issues: ConnectivityIssue[] = [];

  // Run all validation rules
  issues.push(...validateMainsConnected(graph));
  issues.push(...validateMainsReachNaturals(graph));
  issues.push(...validateNoIsolatedIslands(graph));
  issues.push(...validateRampNeeds(graph));

  // Calculate statistics
  let connectedPairs = 0;
  let blockedPairs = 0;

  for (const edge of graph.edges.values()) {
    if (edge.type === 'blocked') {
      blockedPairs++;
    } else {
      connectedPairs++;
    }
  }

  // Map is valid if there are no errors (warnings are OK)
  const hasErrors = issues.some(i => i.severity === 'error');

  return {
    valid: !hasErrors,
    graph,
    issues,
    stats: {
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.size,
      islandCount: graph.islands.length,
      connectedPairs,
      blockedPairs,
    },
  };
}

/**
 * Get all suggested fixes from validation issues.
 */
export function getSuggestedFixes(result: ConnectivityResult): SuggestedFix[] {
  return result.issues
    .filter(i => i.suggestedFix)
    .map(i => i.suggestedFix!);
}

/**
 * Format validation result as human-readable string.
 */
export function formatValidationResult(result: ConnectivityResult): string {
  const lines: string[] = [];

  lines.push(`Map Connectivity Validation: ${result.valid ? 'PASSED' : 'FAILED'}`);
  lines.push(`  Nodes: ${result.stats.totalNodes}`);
  lines.push(`  Islands: ${result.stats.islandCount}`);
  lines.push(`  Connected Pairs: ${result.stats.connectedPairs}`);
  lines.push(`  Blocked Pairs: ${result.stats.blockedPairs}`);

  if (result.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');

    const errors = result.issues.filter(i => i.severity === 'error');
    const warnings = result.issues.filter(i => i.severity === 'warning');

    if (errors.length > 0) {
      lines.push(`  Errors (${errors.length}):`);
      for (const error of errors) {
        lines.push(`    ❌ ${error.message}`);
        if (error.suggestedFix) {
          lines.push(`       Fix: ${error.suggestedFix.description}`);
        }
      }
    }

    if (warnings.length > 0) {
      lines.push(`  Warnings (${warnings.length}):`);
      for (const warning of warnings) {
        lines.push(`    ⚠️ ${warning.message}`);
        if (warning.suggestedFix) {
          lines.push(`       Fix: ${warning.suggestedFix.description}`);
        }
      }
    }
  }

  return lines.join('\n');
}
