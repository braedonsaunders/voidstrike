/**
 * ConnectivityFixer - Automatically fixes connectivity issues
 *
 * Takes validation issues and generates ramp commands to fix them.
 * Can apply fixes directly to MapData or return paint commands for blueprints.
 */

import type { MapData, MapCell, Ramp, ElevationLevel } from '../MapTypes';
import { type Point, type RampCommand, ramp as createRampCommand, CLIFF_THRESHOLD, toXY } from './ElevationMap';
import { distance, clamp } from '@/utils/math';
import type {
  ConnectivityResult,
  ConnectivityIssue,
  SuggestedFix,
  ConnectivityGraph,
} from './ConnectivityGraph';
import { analyzeConnectivity } from './ConnectivityAnalyzer';
import { validateConnectivity, getSuggestedFixes } from './ConnectivityValidator';

// =============================================================================
// TYPES
// =============================================================================

/** Result of applying connectivity fixes */
export interface FixResult {
  /** Whether all fixes were successfully applied */
  success: boolean;

  /** Number of ramps added */
  rampsAdded: number;

  /** The ramp commands that were generated (for adding to blueprint) */
  rampCommands: RampCommand[];

  /** Messages about what was fixed */
  messages: string[];

  /** Re-validation result after fixes */
  revalidation?: ConnectivityResult;
}

// =============================================================================
// RAMP GENERATION
// =============================================================================

/**
 * Generate a RampCommand from a suggested fix.
 */
function generateRampCommand(fix: SuggestedFix): RampCommand | null {
  if (fix.type !== 'add_ramp' || !fix.ramp) return null;

  return createRampCommand(fix.ramp.from, fix.ramp.to, fix.ramp.width);
}

/**
 * Convert elevation (0-255) to legacy elevation level (0, 1, 2).
 */
function elevationToLevel(elevation: number): ElevationLevel {
  if (elevation <= 85) return 0;
  if (elevation <= 170) return 1;
  return 2;
}

/**
 * Apply a ramp directly to the terrain grid.
 */
function applyRampToTerrain(
  terrain: MapCell[][],
  from: Point,
  to: Point,
  width: number
): Ramp {
  const fromPt = toXY(from);
  const toPt = toXY(to);
  const x1 = fromPt.x;
  const y1 = fromPt.y;
  const x2 = toPt.x;
  const y2 = toPt.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = distance(x1, y1, x2, y2);

  // Determine ramp direction
  let direction: 'north' | 'south' | 'east' | 'west';
  if (Math.abs(dx) > Math.abs(dy)) {
    direction = dx > 0 ? 'east' : 'west';
  } else {
    direction = dy > 0 ? 'south' : 'north';
  }

  // Get elevations at endpoints
  const fromY = clamp(Math.floor(y1), 0, terrain.length - 1);
  const fromX = clamp(Math.floor(x1), 0, terrain[0].length - 1);
  const toY = clamp(Math.floor(y2), 0, terrain.length - 1);
  const toX = clamp(Math.floor(x2), 0, terrain[0].length - 1);

  const fromElevation = terrain[fromY][fromX].elevation;
  const toElevation = terrain[toY][toX].elevation;

  // Calculate ramp dimensions
  const rampLength = Math.ceil(length);
  const rampWidth = width;

  // Calculate ramp position (centered on the line between from and to)
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  let rampX: number, rampY: number;
  let rampW: number, rampH: number;

  if (direction === 'north' || direction === 'south') {
    rampX = centerX - rampWidth / 2;
    rampY = Math.min(y1, y2);
    rampW = rampWidth;
    rampH = rampLength;
  } else {
    rampX = Math.min(x1, x2);
    rampY = centerY - rampWidth / 2;
    rampW = rampLength;
    rampH = rampWidth;
  }

  // Paint ramp cells onto terrain
  const perpX = -dy / length;
  const perpY = dx / length;

  for (let i = 0; i <= Math.ceil(length); i++) {
    const t = i / Math.ceil(length);
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;

    // Interpolate elevation
    const elevation = Math.round(fromElevation + (toElevation - fromElevation) * t);

    for (let w = -width / 2; w <= width / 2; w++) {
      const px = Math.floor(cx + perpX * w);
      const py = Math.floor(cy + perpY * w);

      if (py >= 0 && py < terrain.length && px >= 0 && px < terrain[0].length) {
        terrain[py][px] = {
          terrain: 'ramp',
          elevation,
          feature: 'none',
          textureId: Math.floor(Math.random() * 4),
        };
      }
    }
  }

  // Return Ramp object for MapData.ramps array
  return {
    x: Math.floor(rampX),
    y: Math.floor(rampY),
    width: rampW,
    height: rampH,
    direction,
    fromElevation: elevationToLevel(fromElevation),
    toElevation: elevationToLevel(toElevation),
  };
}

// =============================================================================
// FIX APPLICATION
// =============================================================================

/**
 * Apply all suggested fixes to a MapData object.
 * Modifies the terrain grid directly and adds ramps to the ramps array.
 */
export function applyFixes(mapData: MapData, fixes: SuggestedFix[]): FixResult {
  const messages: string[] = [];
  const rampCommands: RampCommand[] = [];
  let rampsAdded = 0;

  for (const fix of fixes) {
    if (fix.type === 'add_ramp' && fix.ramp) {
      // Generate paint command for blueprint
      const cmd = generateRampCommand(fix);
      if (cmd) {
        rampCommands.push(cmd);
      }

      // Apply to terrain
      const ramp = applyRampToTerrain(
        mapData.terrain,
        fix.ramp.from,
        fix.ramp.to,
        fix.ramp.width
      );
      mapData.ramps.push(ramp);
      rampsAdded++;
      messages.push(`Added ramp: ${fix.description}`);
    }
  }

  return {
    success: true,
    rampsAdded,
    rampCommands,
    messages,
  };
}

/**
 * Automatically fix connectivity issues on a map.
 * This is a high-level function that:
 * 1. Analyzes the map
 * 2. Validates connectivity
 * 3. Applies fixes for any issues
 * 4. Re-validates to confirm fixes worked
 */
export function autoFixConnectivity(mapData: MapData): FixResult {
  // Initial analysis
  const graph = analyzeConnectivity(mapData);
  const validation = validateConnectivity(graph);

  if (validation.valid) {
    return {
      success: true,
      rampsAdded: 0,
      rampCommands: [],
      messages: ['Map connectivity is already valid'],
    };
  }

  // Get suggested fixes
  const fixes = getSuggestedFixes(validation);

  if (fixes.length === 0) {
    return {
      success: false,
      rampsAdded: 0,
      rampCommands: [],
      messages: ['Connectivity issues found but no automatic fixes available'],
    };
  }

  // Apply fixes
  const result = applyFixes(mapData, fixes);

  // Re-validate
  const reGraph = analyzeConnectivity(mapData);
  const reValidation = validateConnectivity(reGraph);

  result.revalidation = reValidation;

  if (!reValidation.valid) {
    result.success = false;
    result.messages.push('Some connectivity issues remain after fixes');
  }

  return result;
}

/**
 * Get ramp commands needed to fix connectivity issues (without applying them).
 * Useful for generating blueprint modifications.
 */
export function getRequiredRamps(validationResult: ConnectivityResult): RampCommand[] {
  const fixes = getSuggestedFixes(validationResult);
  return fixes
    .map(generateRampCommand)
    .filter((cmd): cmd is RampCommand => cmd !== null);
}

/**
 * Check if a map needs connectivity fixes.
 */
export function needsConnectivityFixes(mapData: MapData): boolean {
  const graph = analyzeConnectivity(mapData);
  const validation = validateConnectivity(graph);
  return !validation.valid;
}

/**
 * Format fix result as human-readable string.
 */
export function formatFixResult(result: FixResult): string {
  const lines: string[] = [];

  lines.push(`Connectivity Fix Result: ${result.success ? 'SUCCESS' : 'PARTIAL'}`);
  lines.push(`  Ramps Added: ${result.rampsAdded}`);

  if (result.messages.length > 0) {
    lines.push('  Actions:');
    for (const msg of result.messages) {
      lines.push(`    - ${msg}`);
    }
  }

  if (result.rampCommands.length > 0) {
    lines.push('  Paint Commands for Blueprint:');
    for (const cmd of result.rampCommands) {
      const from = toXY(cmd.from);
      const to = toXY(cmd.to);
      lines.push(`    ramp([${from.x}, ${from.y}], [${to.x}, ${to.y}], ${cmd.width}),`);
    }
  }

  if (result.revalidation) {
    lines.push('');
    lines.push(`  Re-validation: ${result.revalidation.valid ? 'PASSED' : 'FAILED'}`);
    if (!result.revalidation.valid) {
      lines.push(`    Remaining Issues: ${result.revalidation.issues.length}`);
    }
  }

  return lines.join('\n');
}
