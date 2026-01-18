/**
 * Desync Detection and Debugging Utilities
 *
 * This module provides tools for detecting, analyzing, and debugging
 * multiplayer desynchronization issues. It works in conjunction with
 * the ChecksumSystem to provide detailed diagnostics.
 */

import { Game } from '../core/Game';
import { ChecksumSystem, ChecksumData, GameStateSnapshot, DesyncReport } from '../systems/ChecksumSystem';
import { quantize, QUANT_POSITION, QUANT_DAMAGE } from '@/utils/FixedPoint';
import { debugNetworking } from '@/utils/debugLogger';

// =============================================================================
// Desync Detection Configuration
// =============================================================================

export interface DesyncDetectionConfig {
  /** Enable/disable desync detection. Default: true */
  enabled: boolean;
  /** Automatically pause game on desync. Default: false (for production) */
  pauseOnDesync: boolean;
  /** Show visual indicator on desync. Default: true */
  showDesyncIndicator: boolean;
  /** Maximum desync history to keep. Default: 100 */
  maxDesyncHistory: number;
  /** Enable detailed logging. Default: false */
  verboseLogging: boolean;
  /** Callback when desync is detected */
  onDesyncDetected?: (report: DesyncReport) => void;
}

const DEFAULT_CONFIG: DesyncDetectionConfig = {
  enabled: true,
  pauseOnDesync: false,
  showDesyncIndicator: true,
  maxDesyncHistory: 100,
  verboseLogging: false,
};

// =============================================================================
// Desync Analysis Results
// =============================================================================

export interface DesyncAnalysis {
  /** The tick where desync was first detected */
  desyncTick: number;
  /** Possible causes based on state comparison */
  possibleCauses: string[];
  /** Entities with state differences */
  divergedEntities: DivergentEntity[];
  /** Summary of the desync */
  summary: string;
  /** Recommended actions */
  recommendations: string[];
}

export interface DivergentEntity {
  entityId: number;
  entityType: 'unit' | 'building' | 'resource';
  entityName: string;
  differences: EntityDifference[];
}

export interface EntityDifference {
  field: string;
  localValue: string | number;
  remoteValue: string | number;
  significance: 'critical' | 'major' | 'minor';
}

// =============================================================================
// State Dump Format (for export/import)
// =============================================================================

export interface SerializedStateDump {
  version: string;
  gameId: string;
  tick: number;
  timestamp: number;
  checksum: number;
  entities: SerializedEntity[];
  commands: SerializedCommand[];
}

export interface SerializedEntity {
  id: number;
  type: string;
  playerId?: string;
  position: { x: number; y: number; z: number };
  health?: { current: number; max: number; shield?: number };
  state?: string;
  target?: { x?: number; y?: number; entityId?: number | null };
  custom?: Record<string, unknown>;
}

export interface SerializedCommand {
  tick: number;
  playerId: string;
  type: string;
  data: unknown;
}

// =============================================================================
// Desync Detection Manager
// =============================================================================

export class DesyncDetectionManager {
  private game: Game;
  private checksumSystem: ChecksumSystem | null = null;
  private config: DesyncDetectionConfig;
  private desyncHistory: DesyncReport[] = [];
  private isInDesyncState: boolean = false;
  private lastDesyncTick: number = -1;
  private commandHistory: Map<number, SerializedCommand[]> = new Map();
  private lastCleanupTick: number = 0;
  private static readonly CLEANUP_INTERVAL_TICKS = 100; // Cleanup every 100 ticks (~5 seconds at 20 TPS)

  constructor(game: Game, config: Partial<DesyncDetectionConfig> = {}) {
    this.game = game;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupEventListeners();
  }

  /**
   * Set the checksum system reference
   */
  public setChecksumSystem(system: ChecksumSystem): void {
    this.checksumSystem = system;
  }

  /**
   * Setup event listeners for desync detection
   */
  private setupEventListeners(): void {
    // Listen for desync events from ChecksumSystem
    this.game.eventBus.on('desync:detected', this.handleDesyncDetected.bind(this));

    // Listen for commands to track for replay
    this.game.eventBus.on('command:issued', this.trackCommand.bind(this));

    // Listen for game state changes
    this.game.eventBus.on('game:tick', this.onTick.bind(this));
  }

  /**
   * Handle desync detection event
   */
  private handleDesyncDetected(data: {
    tick: number;
    localChecksum: number;
    remoteChecksum: number;
    remotePeerId: string;
    report: DesyncReport;
  }): void {
    if (!this.config.enabled) return;

    this.isInDesyncState = true;
    this.lastDesyncTick = data.tick;

    // Store in history
    this.desyncHistory.push(data.report);
    while (this.desyncHistory.length > this.config.maxDesyncHistory) {
      this.desyncHistory.shift();
    }

    // Log if verbose
    if (this.config.verboseLogging) {
      debugNetworking.log(`[DesyncDetection] Desync detected at tick ${data.tick}`);
      debugNetworking.log(`[DesyncDetection] Local checksum: 0x${data.localChecksum.toString(16)}`);
      debugNetworking.log(`[DesyncDetection] Remote checksum: 0x${data.remoteChecksum.toString(16)}`);
      debugNetworking.log(`[DesyncDetection] Remote peer ID: ${data.remotePeerId}`);
      debugNetworking.log('[DesyncDetection] Desync report:', data.report);
    }

    // Pause game if configured
    if (this.config.pauseOnDesync) {
      this.game.pause();
      debugNetworking.warn('[DesyncDetection] Game paused due to desync');
    }

    // Emit UI event for visual indicator
    if (this.config.showDesyncIndicator) {
      this.game.eventBus.emit('ui:desyncIndicator', {
        show: true,
        tick: data.tick,
        localChecksum: data.localChecksum,
        remoteChecksum: data.remoteChecksum,
      });
    }

    // Call custom callback
    if (this.config.onDesyncDetected) {
      this.config.onDesyncDetected(data.report);
    }
  }

  /**
   * Track commands for replay/debugging
   */
  private trackCommand(data: {
    tick: number;
    playerId: string;
    type: string;
    command: unknown;
  }): void {
    const commands = this.commandHistory.get(data.tick) || [];
    commands.push({
      tick: data.tick,
      playerId: data.playerId,
      type: data.type,
      data: data.command,
    });
    this.commandHistory.set(data.tick, commands);

    // PERF: Periodic cleanup instead of per-command to reduce O(n) sweeps
    const currentTick = this.game.getCurrentTick();
    if (currentTick - this.lastCleanupTick >= DesyncDetectionManager.CLEANUP_INTERVAL_TICKS) {
      this.cleanupCommandHistory();
      this.lastCleanupTick = currentTick;
    }
  }

  /**
   * Cleanup old command history
   */
  private cleanupCommandHistory(): void {
    const currentTick = this.game.getCurrentTick();
    const maxAge = 2000; // Keep 2000 ticks of history

    const ticksToRemove: number[] = [];
    for (const tick of this.commandHistory.keys()) {
      if (currentTick - tick > maxAge) {
        ticksToRemove.push(tick);
      }
    }

    for (const tick of ticksToRemove) {
      this.commandHistory.delete(tick);
    }
  }

  /**
   * Per-tick update
   */
  private onTick(_data: { tick: number; deltaTime: number }): void {
    // Clear desync indicator after some time
    if (this.isInDesyncState && this.game.getCurrentTick() - this.lastDesyncTick > 100) {
      this.isInDesyncState = false;
      if (this.config.showDesyncIndicator) {
        this.game.eventBus.emit('ui:desyncIndicator', { show: false });
      }
    }
  }

  // =============================================================================
  // Analysis Methods
  // =============================================================================

  /**
   * Analyze a desync report and provide detailed diagnosis
   */
  public analyzeDesync(report: DesyncReport): DesyncAnalysis {
    const possibleCauses: string[] = [];
    const divergedEntities: DivergentEntity[] = [];
    const recommendations: string[] = [];

    // Analyze the snapshot if available
    if (report.localSnapshot) {
      // Check for common issues
      const snapshot = report.localSnapshot;

      // Count entity types
      const unitCount = snapshot.entities.filter(e => e.type === 'unit').length;
      const buildingCount = snapshot.entities.filter(e => e.type === 'building').length;

      // Look for suspicious patterns
      for (const entity of snapshot.entities) {
        const differences: EntityDifference[] = [];

        // Check for floating point precision issues in positions
        if (entity.qx % 1000 !== 0 || entity.qy % 1000 !== 0) {
          // Position has sub-unit precision - potential source of divergence
          possibleCauses.push(`Entity ${entity.id} has sub-unit position precision`);
        }

        // Check for entities with target positions very close to their current position
        if (entity.qTargetX !== undefined && entity.qTargetY !== undefined) {
          const dx = Math.abs(entity.qTargetX - entity.qx);
          const dy = Math.abs(entity.qTargetY - entity.qy);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100 && dist > 0) {
            // Very close target - rounding differences could cause different behavior
            possibleCauses.push(`Entity ${entity.id} has near-zero movement target`);
            differences.push({
              field: 'targetDistance',
              localValue: dist / QUANT_POSITION,
              remoteValue: 'unknown',
              significance: 'major',
            });
          }
        }

        if (differences.length > 0) {
          divergedEntities.push({
            entityId: entity.id,
            entityType: entity.type,
            entityName: entity.unitId || entity.buildingId || entity.resourceType || 'unknown',
            differences,
          });
        }
      }

      // General recommendations
      if (possibleCauses.length === 0) {
        possibleCauses.push('No obvious cause detected - may be floating-point precision issue');
        recommendations.push('Enable verbose checksum logging to narrow down the divergence point');
        recommendations.push('Check if any system uses Math.random() instead of SeededRandom');
        recommendations.push('Verify all pathfinding results are deterministic');
      } else {
        recommendations.push('Review the flagged entities for non-deterministic operations');
        recommendations.push('Check position snapping is applied consistently');
        recommendations.push('Verify damage calculations use quantized values');
      }
    } else {
      possibleCauses.push('No state snapshot available for analysis');
      recommendations.push('Enable autoDumpOnDesync in ChecksumSystem configuration');
    }

    const summary = this.generateDesyncSummary(report, possibleCauses, divergedEntities);

    return {
      desyncTick: report.localTick,
      possibleCauses,
      divergedEntities,
      summary,
      recommendations,
    };
  }

  /**
   * Generate a human-readable summary of the desync
   */
  private generateDesyncSummary(
    report: DesyncReport,
    causes: string[],
    diverged: DivergentEntity[]
  ): string {
    const lines: string[] = [];

    lines.push(`Desync detected at tick ${report.localTick}`);
    lines.push(`Local checksum: 0x${report.localChecksum.toString(16)}`);
    lines.push(`Remote checksum: 0x${report.remoteChecksum.toString(16)}`);
    lines.push(`Peer: ${report.remotePeerId}`);

    if (diverged.length > 0) {
      lines.push(`\n${diverged.length} entities with suspicious state:`);
      for (const entity of diverged.slice(0, 5)) {
        lines.push(`  - ${entity.entityType} ${entity.entityId} (${entity.entityName})`);
      }
      if (diverged.length > 5) {
        lines.push(`  ... and ${diverged.length - 5} more`);
      }
    }

    if (causes.length > 0) {
      lines.push(`\nPossible causes:`);
      for (const cause of causes.slice(0, 5)) {
        lines.push(`  - ${cause}`);
      }
    }

    return lines.join('\n');
  }

  // =============================================================================
  // State Export/Import
  // =============================================================================

  /**
   * Export current state for debugging
   */
  public exportState(): SerializedStateDump {
    const snapshot = this.checksumSystem?.dumpCurrentState();
    const tick = this.game.getCurrentTick();

    // Get commands around this tick
    const commands: SerializedCommand[] = [];
    for (let t = tick - 10; t <= tick; t++) {
      const tickCommands = this.commandHistory.get(t);
      if (tickCommands) {
        commands.push(...tickCommands);
      }
    }

    const entities: SerializedEntity[] = [];
    if (snapshot) {
      for (const entity of snapshot.entities) {
        entities.push({
          id: entity.id,
          type: entity.type,
          playerId: entity.playerId,
          position: {
            x: entity.qx / QUANT_POSITION,
            y: entity.qy / QUANT_POSITION,
            z: entity.qz / QUANT_POSITION,
          },
          health: entity.qMaxHealth > 0 ? {
            current: entity.qHealth / QUANT_DAMAGE,
            max: entity.qMaxHealth / QUANT_DAMAGE,
            shield: entity.qShield !== undefined ? entity.qShield / QUANT_DAMAGE : undefined,
          } : undefined,
          state: entity.state || entity.buildingState,
          target: entity.qTargetX !== undefined ? {
            x: entity.qTargetX / QUANT_POSITION,
            y: entity.qTargetY !== undefined ? entity.qTargetY / QUANT_POSITION : undefined,
            entityId: entity.targetEntityId,
          } : undefined,
        });
      }
    }

    return {
      version: '1.0.0',
      gameId: `game_${Date.now()}`,
      tick,
      timestamp: Date.now(),
      checksum: snapshot?.checksum || 0,
      entities,
      commands,
    };
  }

  /**
   * Export state as JSON string for copy/paste
   */
  public exportStateAsJson(): string {
    return JSON.stringify(this.exportState(), null, 2);
  }

  /**
   * Download state as a file
   */
  public downloadState(filename?: string): void {
    const state = this.exportState();
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `voidstrike_state_tick${state.tick}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Get all desync reports
   */
  public getDesyncHistory(): DesyncReport[] {
    return [...this.desyncHistory];
  }

  /**
   * Check if currently in desync state
   */
  public isDesynced(): boolean {
    return this.isInDesyncState;
  }

  /**
   * Get the last tick where desync was detected
   */
  public getLastDesyncTick(): number {
    return this.lastDesyncTick;
  }

  /**
   * Update configuration
   */
  public setConfig(config: Partial<DesyncDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  public getConfig(): DesyncDetectionConfig {
    return { ...this.config };
  }

  /**
   * Clear desync history
   */
  public clearHistory(): void {
    this.desyncHistory = [];
    this.isInDesyncState = false;
    this.lastDesyncTick = -1;
  }

  /**
   * Force analyze the most recent desync
   */
  public analyzeLastDesync(): DesyncAnalysis | null {
    if (this.desyncHistory.length === 0) return null;
    return this.analyzeDesync(this.desyncHistory[this.desyncHistory.length - 1]);
  }

  /**
   * Manually trigger a checksum verification
   */
  public forceChecksumVerification(): ChecksumData | null {
    return this.checksumSystem?.forceChecksum() || null;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a simple visual desync indicator for the UI
 */
export function createDesyncIndicatorElement(): HTMLElement {
  const indicator = document.createElement('div');
  indicator.id = 'desync-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 10px 20px;
    background: rgba(255, 0, 0, 0.9);
    color: white;
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    border-radius: 4px;
    z-index: 10000;
    display: none;
    animation: desync-pulse 1s infinite;
  `;
  indicator.innerHTML = '⚠️ DESYNC DETECTED';

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes desync-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  document.head.appendChild(style);

  return indicator;
}

/**
 * Format a checksum for display
 */
export function formatChecksum(checksum: number): string {
  return `0x${checksum.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Compare two checksums and return a human-readable diff
 */
export function compareChecksums(local: ChecksumData, remote: ChecksumData): string[] {
  const differences: string[] = [];

  if (local.checksum !== remote.checksum) {
    differences.push(`Checksum: ${formatChecksum(local.checksum)} vs ${formatChecksum(remote.checksum)}`);
  }

  if (local.unitCount !== remote.unitCount) {
    differences.push(`Unit count: ${local.unitCount} vs ${remote.unitCount}`);
  }

  if (local.buildingCount !== remote.buildingCount) {
    differences.push(`Building count: ${local.buildingCount} vs ${remote.buildingCount}`);
  }

  if (local.resourceSum !== remote.resourceSum) {
    differences.push(`Resource sum: ${local.resourceSum} vs ${remote.resourceSum}`);
  }

  if (local.healthSum !== remote.healthSum) {
    differences.push(`Health sum: ${local.healthSum} vs ${remote.healthSum}`);
  }

  return differences;
}
