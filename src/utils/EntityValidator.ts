/**
 * EntityValidator - Utility for tracking and reporting missing entity references
 *
 * Instead of silently continuing when an entity is missing, this utility:
 * 1. Tracks missing entity occurrences by source (system/component name)
 * 2. Periodically logs aggregated reports (to avoid log spam)
 * 3. Provides debugging tools to identify stale reference issues
 *
 * Usage:
 *   const entity = world.getEntity(id);
 *   if (!EntityValidator.validate(entity, id, 'CombatSystem')) continue;
 */

import { debugPerformance } from './debugLogger';

interface MissingEntityRecord {
  count: number;
  lastTick: number;
  entityIds: Set<number>;
}

const REPORT_INTERVAL_MS = 5000; // Report aggregated stats every 5 seconds
const MAX_TRACKED_IDS = 100; // Limit tracked IDs per source to prevent memory bloat

class EntityValidatorClass {
  private missingBySource: Map<string, MissingEntityRecord> = new Map();
  private lastReportTime = 0;
  private totalMissing = 0;
  private enabled = true;

  /**
   * Validate that an entity exists. If not, tracks the missing reference.
   * @param entity The entity (or null/undefined)
   * @param entityId The ID that was queried
   * @param source The source system/component tracking this (for reporting)
   * @param currentTick Optional current game tick for temporal analysis
   * @returns true if entity exists, false if missing
   */
  validate<T>(
    entity: T | null | undefined,
    entityId: number,
    source: string,
    currentTick?: number
  ): entity is T {
    if (entity !== null && entity !== undefined) {
      return true;
    }

    if (!this.enabled) {
      return false;
    }

    this.trackMissing(entityId, source, currentTick ?? 0);
    return false;
  }

  /**
   * Track a missing entity reference
   */
  private trackMissing(entityId: number, source: string, tick: number): void {
    let record = this.missingBySource.get(source);
    if (!record) {
      record = { count: 0, lastTick: tick, entityIds: new Set() };
      this.missingBySource.set(source, record);
    }

    record.count++;
    record.lastTick = tick;
    this.totalMissing++;

    // Track unique entity IDs (limited to prevent memory issues)
    if (record.entityIds.size < MAX_TRACKED_IDS) {
      record.entityIds.add(entityId);
    }

    // Check if we should report
    this.maybeReport();
  }

  /**
   * Periodically report aggregated missing entity stats
   */
  private maybeReport(): void {
    const now = performance.now();
    if (now - this.lastReportTime < REPORT_INTERVAL_MS) {
      return;
    }

    if (this.totalMissing === 0) {
      this.lastReportTime = now;
      return;
    }

    // Build report
    const sources: string[] = [];
    for (const [source, record] of this.missingBySource) {
      if (record.count > 0) {
        const uniqueIds = record.entityIds.size;
        sources.push(`${source}: ${record.count} refs (${uniqueIds} unique IDs)`);
      }
    }

    if (sources.length > 0) {
      debugPerformance.warn(
        `[EntityValidator] Missing entity references in last ${REPORT_INTERVAL_MS / 1000}s:\n  ` +
        sources.join('\n  ')
      );
    }

    // Reset counters but keep tracking IDs for pattern analysis
    for (const record of this.missingBySource.values()) {
      record.count = 0;
    }
    this.totalMissing = 0;
    this.lastReportTime = now;
  }

  /**
   * Get a detailed report of missing entities by source
   */
  getReport(): Map<string, { count: number; uniqueIds: number[] }> {
    const report = new Map<string, { count: number; uniqueIds: number[] }>();
    for (const [source, record] of this.missingBySource) {
      report.set(source, {
        count: record.count,
        uniqueIds: Array.from(record.entityIds),
      });
    }
    return report;
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.missingBySource.clear();
    this.totalMissing = 0;
  }

  /**
   * Enable or disable tracking (disable in production for performance)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const EntityValidator = new EntityValidatorClass();

/**
 * Convenience function for inline validation
 *
 * @example
 * for (const id of entityIds) {
 *   const entity = world.getEntity(id);
 *   if (!validateEntity(entity, id, 'CombatSystem')) continue;
 *   // entity is now typed as non-null
 * }
 */
export function validateEntity<T>(
  entity: T | null | undefined,
  entityId: number,
  source: string,
  currentTick?: number
): entity is T {
  return EntityValidator.validate(entity, entityId, source, currentTick);
}
