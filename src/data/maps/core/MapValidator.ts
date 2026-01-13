/**
 * MapValidator.ts - Map Definition Validation
 *
 * Validates map definitions before generation, providing clear
 * error messages and suggestions for fixes.
 */

import {
  MapDefinition,
  RegionDefinition,
  ConnectionDefinition,
  BiomeType,
} from './MapDefinition';

import {
  ConnectivityGraph,
  validateConnectivity,
  findPath,
  getNodesByType,
} from './MapConnectivity';

import { definitionToGraph } from './MapDefinition';

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  location?: {
    type: 'region' | 'connection' | 'decoration' | 'feature' | 'canvas' | 'meta';
    id?: string;
    position?: { x: number; y: number };
  };
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

// ============================================================================
// VALIDATORS
// ============================================================================

/**
 * Validate map metadata
 */
function validateMeta(definition: MapDefinition, issues: ValidationIssue[]): void {
  const { meta } = definition;

  if (!meta.id || meta.id.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'META_MISSING_ID',
      message: 'Map ID is required',
      location: { type: 'meta' },
      suggestion: 'Add a unique identifier like "my_map_name"',
    });
  } else if (!/^[a-z][a-z0-9_]*$/.test(meta.id)) {
    issues.push({
      severity: 'warning',
      code: 'META_ID_FORMAT',
      message: `Map ID "${meta.id}" should be lowercase with underscores`,
      location: { type: 'meta' },
      suggestion: 'Use format like "titans_colosseum" or "crystal_caverns"',
    });
  }

  if (!meta.name || meta.name.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'META_MISSING_NAME',
      message: 'Map name is required',
      location: { type: 'meta' },
    });
  }

  if (!meta.author || meta.author.trim() === '') {
    issues.push({
      severity: 'warning',
      code: 'META_MISSING_AUTHOR',
      message: 'Map author is not specified',
      location: { type: 'meta' },
    });
  }
}

/**
 * Validate canvas settings
 */
function validateCanvas(definition: MapDefinition, issues: ValidationIssue[]): void {
  const { canvas } = definition;

  if (canvas.width < 64) {
    issues.push({
      severity: 'error',
      code: 'CANVAS_TOO_SMALL_WIDTH',
      message: `Map width ${canvas.width} is too small (minimum 64)`,
      location: { type: 'canvas' },
    });
  } else if (canvas.width > 512) {
    issues.push({
      severity: 'warning',
      code: 'CANVAS_LARGE_WIDTH',
      message: `Map width ${canvas.width} is very large, may affect performance`,
      location: { type: 'canvas' },
    });
  }

  if (canvas.height < 64) {
    issues.push({
      severity: 'error',
      code: 'CANVAS_TOO_SMALL_HEIGHT',
      message: `Map height ${canvas.height} is too small (minimum 64)`,
      location: { type: 'canvas' },
    });
  } else if (canvas.height > 512) {
    issues.push({
      severity: 'warning',
      code: 'CANVAS_LARGE_HEIGHT',
      message: `Map height ${canvas.height} is very large, may affect performance`,
      location: { type: 'canvas' },
    });
  }

  const validBiomes: BiomeType[] = ['grassland', 'desert', 'frozen', 'volcanic', 'void', 'jungle'];
  if (!validBiomes.includes(canvas.biome)) {
    issues.push({
      severity: 'error',
      code: 'CANVAS_INVALID_BIOME',
      message: `Invalid biome "${canvas.biome}"`,
      location: { type: 'canvas' },
      suggestion: `Valid biomes: ${validBiomes.join(', ')}`,
    });
  }
}

/**
 * Validate symmetry settings
 */
function validateSymmetry(definition: MapDefinition, issues: ValidationIssue[]): void {
  const { symmetry, regions } = definition;

  // Count player spawns
  const spawnRegions = regions.filter((r) => r.playerSlot !== undefined);
  const playerSlots = new Set(spawnRegions.map((r) => r.playerSlot));

  if (spawnRegions.length !== symmetry.playerCount) {
    issues.push({
      severity: 'warning',
      code: 'SYMMETRY_PLAYER_MISMATCH',
      message: `Symmetry declares ${symmetry.playerCount} players but found ${spawnRegions.length} spawn regions`,
      location: { type: 'canvas' },
    });
  }

  // Check for missing player slots
  for (let p = 1; p <= symmetry.playerCount; p++) {
    if (!playerSlots.has(p)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_PLAYER_SPAWN',
        message: `No spawn region found for player ${p}`,
        location: { type: 'canvas' },
        suggestion: `Add a region with playerSlot: ${p}`,
      });
    }
  }

  // Check for duplicate player slots
  const slotCounts = new Map<number, number>();
  for (const region of spawnRegions) {
    const slot = region.playerSlot!;
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }
  for (const [slot, count] of slotCounts) {
    if (count > 1) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_PLAYER_SLOT',
        message: `Player slot ${slot} is assigned to ${count} regions`,
        location: { type: 'canvas' },
      });
    }
  }
}

/**
 * Validate regions
 */
function validateRegions(definition: MapDefinition, issues: ValidationIssue[]): void {
  const { regions, canvas } = definition;
  const regionIds = new Set<string>();

  for (const region of regions) {
    // Check for duplicate IDs
    if (regionIds.has(region.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_REGION_ID',
        message: `Duplicate region ID "${region.id}"`,
        location: { type: 'region', id: region.id },
      });
    }
    regionIds.add(region.id);

    // Check position bounds
    const margin = region.radius + 10;
    if (region.position.x < margin || region.position.x > canvas.width - margin) {
      issues.push({
        severity: 'warning',
        code: 'REGION_NEAR_EDGE_X',
        message: `Region "${region.id}" is very close to horizontal map edge`,
        location: { type: 'region', id: region.id, position: region.position },
      });
    }
    if (region.position.y < margin || region.position.y > canvas.height - margin) {
      issues.push({
        severity: 'warning',
        code: 'REGION_NEAR_EDGE_Y',
        message: `Region "${region.id}" is very close to vertical map edge`,
        location: { type: 'region', id: region.id, position: region.position },
      });
    }

    // Check elevation
    if (region.elevation < 0 || region.elevation > 2) {
      issues.push({
        severity: 'error',
        code: 'REGION_INVALID_ELEVATION',
        message: `Region "${region.id}" has invalid elevation ${region.elevation} (must be 0, 1, or 2)`,
        location: { type: 'region', id: region.id },
      });
    }

    // Check radius
    if (region.radius < 5) {
      issues.push({
        severity: 'warning',
        code: 'REGION_SMALL_RADIUS',
        message: `Region "${region.id}" has very small radius ${region.radius}`,
        location: { type: 'region', id: region.id },
      });
    }

    // Check main bases have resources
    if (region.type === 'main_base' && !region.resources) {
      issues.push({
        severity: 'warning',
        code: 'MAIN_BASE_NO_RESOURCES',
        message: `Main base "${region.id}" has no resources defined`,
        location: { type: 'region', id: region.id },
        suggestion: 'Add resources: { minerals: 8, vespene: 2 }',
      });
    }
  }

  // Check for overlapping regions
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.radius + b.radius;

      if (dist < minDist * 0.5) {
        issues.push({
          severity: 'warning',
          code: 'REGIONS_OVERLAP',
          message: `Regions "${a.id}" and "${b.id}" significantly overlap`,
          location: { type: 'region', id: a.id },
        });
      }
    }
  }
}

/**
 * Validate connections
 */
function validateConnections(definition: MapDefinition, issues: ValidationIssue[]): void {
  const { connections, regions } = definition;
  const regionIds = new Set(regions.map((r) => r.id));

  for (const conn of connections) {
    // Check endpoints exist
    if (!regionIds.has(conn.from)) {
      issues.push({
        severity: 'error',
        code: 'CONNECTION_INVALID_FROM',
        message: `Connection from "${conn.from}" references non-existent region`,
        location: { type: 'connection', id: `${conn.from}-${conn.to}` },
      });
    }
    if (!regionIds.has(conn.to)) {
      issues.push({
        severity: 'error',
        code: 'CONNECTION_INVALID_TO',
        message: `Connection to "${conn.to}" references non-existent region`,
        location: { type: 'connection', id: `${conn.from}-${conn.to}` },
      });
    }

    // Check width
    if (conn.width < 4) {
      issues.push({
        severity: 'warning',
        code: 'CONNECTION_NARROW',
        message: `Connection ${conn.from} -> ${conn.to} is very narrow (${conn.width})`,
        location: { type: 'connection', id: `${conn.from}-${conn.to}` },
        suggestion: 'Minimum recommended width is 4 for unit pathing',
      });
    }

    // Check ramp elevation difference
    if (conn.type === 'ramp') {
      const fromRegion = regions.find((r) => r.id === conn.from);
      const toRegion = regions.find((r) => r.id === conn.to);

      if (fromRegion && toRegion) {
        if (fromRegion.elevation === toRegion.elevation) {
          issues.push({
            severity: 'warning',
            code: 'RAMP_SAME_ELEVATION',
            message: `Ramp ${conn.from} -> ${conn.to} connects same-elevation regions`,
            location: { type: 'connection', id: `${conn.from}-${conn.to}` },
            suggestion: 'Use "ground" type for same-elevation connections',
          });
        }
      }
    }
  }

  // Check for isolated regions
  const connectedRegions = new Set<string>();
  for (const conn of connections) {
    connectedRegions.add(conn.from);
    connectedRegions.add(conn.to);
  }

  for (const region of regions) {
    if (!connectedRegions.has(region.id) && region.type !== 'island') {
      issues.push({
        severity: 'error',
        code: 'REGION_ISOLATED',
        message: `Region "${region.id}" has no connections`,
        location: { type: 'region', id: region.id },
        suggestion: 'Add connections to this region or mark it as type "island"',
      });
    }
  }
}

/**
 * Validate connectivity graph
 */
function validateGraphConnectivity(definition: MapDefinition, issues: ValidationIssue[]): void {
  const graph = definitionToGraph(definition);
  const validation = validateConnectivity(graph);

  for (const error of validation.errors) {
    issues.push({
      severity: 'error',
      code: 'CONNECTIVITY_ERROR',
      message: error,
    });
  }

  for (const warning of validation.warnings) {
    issues.push({
      severity: 'warning',
      code: 'CONNECTIVITY_WARNING',
      message: warning,
    });
  }

  // Check specific connectivity requirements
  const mainBases = getNodesByType(graph, 'main_base');

  // All main bases should be able to reach each other
  for (let i = 0; i < mainBases.length; i++) {
    for (let j = i + 1; j < mainBases.length; j++) {
      const path = findPath(graph, mainBases[i].id, mainBases[j].id);
      if (!path) {
        issues.push({
          severity: 'error',
          code: 'BASES_NOT_CONNECTED',
          message: `Main base "${mainBases[i].id}" cannot reach "${mainBases[j].id}"`,
          suggestion: 'Ensure all main bases are connected through the map',
        });
      }
    }
  }
}

/**
 * Validate watch towers
 */
function validateWatchTowers(definition: MapDefinition, issues: ValidationIssue[]): void {
  const watchTowers = definition.features?.watchTowers || [];
  const { canvas } = definition;

  const towerIds = new Set<string>();

  for (const tower of watchTowers) {
    // Check for duplicate IDs
    if (towerIds.has(tower.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_TOWER_ID',
        message: `Duplicate watch tower ID "${tower.id}"`,
        location: { type: 'feature', id: tower.id },
      });
    }
    towerIds.add(tower.id);

    // Check bounds
    if (
      tower.position.x < 10 ||
      tower.position.x > canvas.width - 10 ||
      tower.position.y < 10 ||
      tower.position.y > canvas.height - 10
    ) {
      issues.push({
        severity: 'warning',
        code: 'TOWER_NEAR_EDGE',
        message: `Watch tower "${tower.id}" is near map edge`,
        location: { type: 'feature', id: tower.id, position: tower.position },
      });
    }

    // Check vision radius
    if (tower.visionRadius < 10) {
      issues.push({
        severity: 'warning',
        code: 'TOWER_LOW_VISION',
        message: `Watch tower "${tower.id}" has very small vision radius`,
        location: { type: 'feature', id: tower.id },
      });
    }
  }
}

/**
 * Validate destructibles
 */
function validateDestructibles(definition: MapDefinition, issues: ValidationIssue[]): void {
  const destructibles = definition.features?.destructibles || [];
  const destructibleIds = new Set<string>();

  for (const d of destructibles) {
    // Check for duplicate IDs
    if (destructibleIds.has(d.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_DESTRUCTIBLE_ID',
        message: `Duplicate destructible ID factors "${d.id}"`,
        location: { type: 'feature', id: d.id },
      });
    }
    destructibleIds.add(d.id);

    // Check health
    if (d.health <= 0) {
      issues.push({
        severity: 'error',
        code: 'DESTRUCTIBLE_INVALID_HEALTH',
        message: `Destructible "${d.id}" has invalid health ${d.health}`,
        location: { type: 'feature', id: d.id },
      });
    }

    // Check if it blocks a connection
    if (d.blocksConnection) {
      const conn = definition.connections.find(
        (c) => `${c.from}-${c.to}` === d.blocksConnection || `${c.to}-${c.from}` === d.blocksConnection
      );
      if (!conn) {
        issues.push({
          severity: 'warning',
          code: 'DESTRUCTIBLE_INVALID_CONNECTION',
          message: `Destructible "${d.id}" blocks unknown connection "${d.blocksConnection}"`,
          location: { type: 'feature', id: d.id },
        });
      }
    }
  }
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

/**
 * Validate a complete map definition
 */
export function validateMapDefinition(definition: MapDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Run all validators
  validateMeta(definition, issues);
  validateCanvas(definition, issues);
  validateSymmetry(definition, issues);
  validateRegions(definition, issues);
  validateConnections(definition, issues);
  validateGraphConnectivity(definition, issues);
  validateWatchTowers(definition, issues);
  validateDestructibles(definition, issues);

  // Calculate summary
  const summary = {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  return {
    valid: summary.errors === 0,
    issues,
    summary,
  };
}

/**
 * Format validation result as a readable string
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('✓ Map definition is valid');
  } else {
    lines.push('✗ Map definition has errors');
  }

  lines.push(`  ${result.summary.errors} error(s), ${result.summary.warnings} warning(s), ${result.summary.info} info`);
  lines.push('');

  // Group by severity
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const infos = result.issues.filter((i) => i.severity === 'info');

  if (errors.length > 0) {
    lines.push('ERRORS:');
    for (const issue of errors) {
      lines.push(`  ✗ [${issue.code}] ${issue.message}`);
      if (issue.location) {
        const loc = issue.location;
        if (loc.position) {
          lines.push(`    at ${loc.type} "${loc.id || ''}" (${loc.position.x}, ${loc.position.y})`);
        } else if (loc.id) {
          lines.push(`    at ${loc.type} "${loc.id}"`);
        }
      }
      if (issue.suggestion) {
        lines.push(`    → ${issue.suggestion}`);
      }
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('WARNINGS:');
    for (const issue of warnings) {
      lines.push(`  ⚠ [${issue.code}] ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`    → ${issue.suggestion}`);
      }
    }
    lines.push('');
  }

  if (infos.length > 0) {
    lines.push('INFO:');
    for (const issue of infos) {
      lines.push(`  ℹ [${issue.code}] ${issue.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Quick validation check - returns true if valid, throws if not
 */
export function assertValidMapDefinition(definition: MapDefinition): void {
  const result = validateMapDefinition(definition);
  if (!result.valid) {
    const errorMessages = result.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.code}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid map definition:\n${errorMessages}`);
  }
}
