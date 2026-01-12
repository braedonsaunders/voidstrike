/**
 * Checksum System - Per-Tick State Verification for Multiplayer Determinism
 *
 * This system computes deterministic checksums of game state at configurable
 * intervals to detect desync between clients. When a desync is detected,
 * it can dump the full state for debugging.
 *
 * The checksum algorithm uses a simple but effective hash that:
 * 1. Is deterministic across platforms
 * 2. Is sensitive to small state differences
 * 3. Is fast enough to run every few ticks
 */

import { System } from '../ecs/System';
import { Game } from '../core/Game';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Resource } from '../components/Resource';
import { quantize, QUANT_POSITION, QUANT_DAMAGE, QUANT_COOLDOWN } from '@/utils/FixedPoint';

// =============================================================================
// Configuration
// =============================================================================

export interface ChecksumConfig {
  /** How often to compute checksums (in ticks). Default: 5 */
  checksumInterval: number;
  /** Whether to emit checksums over network for verification. Default: true */
  emitNetworkChecksums: boolean;
  /** Whether to log checksums to console. Default: false */
  logChecksums: boolean;
  /** Whether to automatically dump state on desync. Default: true */
  autoDumpOnDesync: boolean;
  /** Maximum number of state dumps to keep in memory. Default: 10 */
  maxStateDumps: number;
  /** Ticks to wait before confirming desync (allows for network delay). Default: 10 */
  desyncConfirmationTicks: number;
}

const DEFAULT_CONFIG: ChecksumConfig = {
  checksumInterval: 5,
  emitNetworkChecksums: true,
  logChecksums: false,
  autoDumpOnDesync: true,
  maxStateDumps: 10,
  desyncConfirmationTicks: 10,
};

// =============================================================================
// Checksum Data Structures
// =============================================================================

export interface ChecksumData {
  tick: number;
  checksum: number;
  unitCount: number;
  buildingCount: number;
  resourceSum: number;
  unitPositionHash: number;
  healthSum: number;
  timestamp: number;
}

export interface EntityStateSnapshot {
  id: number;
  type: 'unit' | 'building' | 'resource';
  playerId?: string;

  // Position (quantized)
  qx: number;
  qy: number;
  qz: number;

  // Health (quantized)
  qHealth: number;
  qMaxHealth: number;
  qShield?: number;

  // Unit-specific
  unitId?: string;
  state?: string;
  qTargetX?: number;
  qTargetY?: number;
  targetEntityId?: number | null;

  // Building-specific
  buildingId?: string;
  buildingState?: string;
  qProgress?: number;

  // Resource-specific
  resourceType?: string;
  qAmount?: number;
}

export interface GameStateSnapshot {
  tick: number;
  checksum: number;
  timestamp: number;
  entities: EntityStateSnapshot[];
  playerResources: Map<string, { minerals: number; vespene: number; supply: number; maxSupply: number }>;
}

export interface DesyncReport {
  localTick: number;
  remoteTick: number;
  localChecksum: number;
  remoteChecksum: number;
  remotePeerId: string;
  localSnapshot?: GameStateSnapshot;
  differences?: string[];
  timestamp: number;
}

// =============================================================================
// Checksum System
// =============================================================================

export class ChecksumSystem extends System {
  public readonly name = 'ChecksumSystem';
  public priority = 200; // Run after all game logic

  private config: ChecksumConfig;
  private checksumHistory: Map<number, ChecksumData> = new Map();
  private stateSnapshots: GameStateSnapshot[] = [];
  private remoteChecksums: Map<string, Map<number, ChecksumData>> = new Map();
  private desyncReports: DesyncReport[] = [];
  private pendingDesyncChecks: Map<number, { remotePeerId: string; remoteChecksum: number; receivedTick: number }[]> = new Map();

  // Performance tracking
  private lastChecksumTime: number = 0;
  private avgChecksumTimeMs: number = 0;

  constructor(game: Game, config: Partial<ChecksumConfig> = {}) {
    super(game);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for remote checksums
    this.game.eventBus.on('network:checksum', this.handleRemoteChecksum.bind(this));

    // Listen for checksum requests (for debugging)
    this.game.eventBus.on('debug:requestChecksum', this.handleChecksumRequest.bind(this));

    // Listen for state dump requests
    this.game.eventBus.on('debug:dumpState', this.dumpCurrentState.bind(this));
  }

  /**
   * Handle incoming checksum from a remote peer
   */
  private handleRemoteChecksum(data: {
    peerId: string;
    tick: number;
    checksum: number;
    unitCount: number;
    resourceSum: number;
  }): void {
    // Store remote checksum
    if (!this.remoteChecksums.has(data.peerId)) {
      this.remoteChecksums.set(data.peerId, new Map());
    }

    const peerChecksums = this.remoteChecksums.get(data.peerId)!;
    peerChecksums.set(data.tick, {
      tick: data.tick,
      checksum: data.checksum,
      unitCount: data.unitCount,
      buildingCount: 0,
      resourceSum: data.resourceSum,
      unitPositionHash: 0,
      healthSum: 0,
      timestamp: Date.now(),
    });

    // Check for desync
    this.checkForDesync(data.peerId, data.tick, data.checksum);

    // Cleanup old checksums
    this.cleanupOldChecksums(peerChecksums);
  }

  /**
   * Check if local and remote checksums match for a given tick
   */
  private checkForDesync(peerId: string, remoteTick: number, remoteChecksum: number): void {
    const localChecksum = this.checksumHistory.get(remoteTick);

    if (!localChecksum) {
      // We haven't computed this tick yet - queue for later verification
      const pending = this.pendingDesyncChecks.get(remoteTick) || [];
      pending.push({
        remotePeerId: peerId,
        remoteChecksum,
        receivedTick: this.game.getCurrentTick(),
      });
      this.pendingDesyncChecks.set(remoteTick, pending);
      return;
    }

    if (localChecksum.checksum !== remoteChecksum) {
      this.reportDesync(remoteTick, localChecksum.checksum, remoteChecksum, peerId);
    }
  }

  /**
   * Report a desync and optionally dump state
   */
  private reportDesync(
    tick: number,
    localChecksum: number,
    remoteChecksum: number,
    remotePeerId: string
  ): void {
    const report: DesyncReport = {
      localTick: tick,
      remoteTick: tick,
      localChecksum,
      remoteChecksum,
      remotePeerId,
      timestamp: Date.now(),
    };

    // Find the state snapshot for this tick if available
    const snapshot = this.stateSnapshots.find(s => s.tick === tick);
    if (snapshot) {
      report.localSnapshot = snapshot;
    }

    this.desyncReports.push(report);

    // Keep only recent reports
    while (this.desyncReports.length > this.config.maxStateDumps) {
      this.desyncReports.shift();
    }

    // Emit desync event
    this.game.eventBus.emit('desync:detected', {
      tick,
      localChecksum,
      remoteChecksum,
      remotePeerId,
      report,
    });

    // Log warning
    console.warn(
      `[ChecksumSystem] DESYNC DETECTED at tick ${tick}:`,
      `Local: 0x${localChecksum.toString(16)}, Remote: 0x${remoteChecksum.toString(16)}`,
      `(Peer: ${remotePeerId})`
    );

    // Auto-dump state if configured
    if (this.config.autoDumpOnDesync && snapshot) {
      console.warn('[ChecksumSystem] State snapshot at desync tick:', snapshot);
    }
  }

  /**
   * Handle debug checksum request
   */
  private handleChecksumRequest(): void {
    const currentTick = this.game.getCurrentTick();
    const checksumData = this.computeChecksum(currentTick);
    console.log(`[ChecksumSystem] Tick ${currentTick} checksum:`, checksumData);
  }

  /**
   * Dump current game state for debugging
   */
  public dumpCurrentState(): GameStateSnapshot {
    const tick = this.game.getCurrentTick();
    const snapshot = this.createStateSnapshot(tick);

    console.log('[ChecksumSystem] Current state dump:', snapshot);

    return snapshot;
  }

  /**
   * Main update - compute checksums at configured intervals
   */
  public update(_deltaTime: number): void {
    const currentTick = this.game.getCurrentTick();

    // Only compute checksums at the configured interval
    if (currentTick % this.config.checksumInterval !== 0) {
      // But still check pending desync verifications
      this.processPendingDesyncChecks(currentTick);
      return;
    }

    const startTime = performance.now();

    // Compute checksum
    const checksumData = this.computeChecksum(currentTick);

    // Store in history
    this.checksumHistory.set(currentTick, checksumData);

    // Create and store state snapshot (for debugging)
    if (this.config.autoDumpOnDesync) {
      const snapshot = this.createStateSnapshot(currentTick);
      snapshot.checksum = checksumData.checksum;
      this.stateSnapshots.push(snapshot);

      // Keep only recent snapshots
      while (this.stateSnapshots.length > this.config.maxStateDumps) {
        this.stateSnapshots.shift();
      }
    }

    // Emit checksum for network synchronization
    if (this.config.emitNetworkChecksums) {
      this.game.eventBus.emit('checksum:computed', {
        tick: currentTick,
        checksum: checksumData.checksum,
        unitCount: checksumData.unitCount,
        buildingCount: checksumData.buildingCount,
        resourceSum: checksumData.resourceSum,
      });
    }

    // Log if configured
    if (this.config.logChecksums) {
      console.log(
        `[ChecksumSystem] Tick ${currentTick}: 0x${checksumData.checksum.toString(16)}`,
        `(${checksumData.unitCount} units, ${checksumData.buildingCount} buildings)`
      );
    }

    // Process any pending desync checks
    this.processPendingDesyncChecks(currentTick);

    // Cleanup old checksums
    this.cleanupOldChecksums(this.checksumHistory);

    // Track performance
    const elapsed = performance.now() - startTime;
    this.lastChecksumTime = elapsed;
    this.avgChecksumTimeMs = this.avgChecksumTimeMs * 0.9 + elapsed * 0.1;
  }

  /**
   * Process pending desync checks from remote checksums that arrived before local computation
   */
  private processPendingDesyncChecks(currentTick: number): void {
    const ticksToRemove: number[] = [];

    for (const [tick, pendingList] of this.pendingDesyncChecks) {
      const localChecksum = this.checksumHistory.get(tick);

      if (localChecksum) {
        // We now have local checksum - verify
        for (const pending of pendingList) {
          if (localChecksum.checksum !== pending.remoteChecksum) {
            this.reportDesync(tick, localChecksum.checksum, pending.remoteChecksum, pending.remotePeerId);
          }
        }
        ticksToRemove.push(tick);
      } else if (currentTick - tick > this.config.desyncConfirmationTicks) {
        // Too old - remove without checking
        ticksToRemove.push(tick);
      }
    }

    for (const tick of ticksToRemove) {
      this.pendingDesyncChecks.delete(tick);
    }
  }

  /**
   * Compute a deterministic checksum of the current game state
   */
  private computeChecksum(tick: number): ChecksumData {
    let checksum = 0;
    let unitCount = 0;
    let buildingCount = 0;
    let resourceSum = 0;
    let unitPositionHash = 0;
    let healthSum = 0;

    // Hash units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Health', 'Selectable');

    // Sort by entity ID for deterministic ordering
    const sortedUnits = [...units].sort((a, b) => a.id - b.id);

    for (const entity of sortedUnits) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (health.isDead()) continue;

      unitCount++;

      // Quantize position for deterministic hashing
      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qz = quantize(transform.z, QUANT_POSITION);
      const qHealth = quantize(health.current, QUANT_DAMAGE);

      // Hash entity state
      checksum = this.hashCombine(checksum, entity.id);
      checksum = this.hashCombine(checksum, qx);
      checksum = this.hashCombine(checksum, qy);
      checksum = this.hashCombine(checksum, qz);
      checksum = this.hashCombine(checksum, qHealth);
      checksum = this.hashCombine(checksum, this.hashString(unit.state));
      checksum = this.hashCombine(checksum, unit.targetEntityId || 0);

      // Track aggregates
      unitPositionHash = this.hashCombine(unitPositionHash, qx ^ qy);
      healthSum += qHealth;

      // Hash target position if moving
      if (unit.targetX !== null && unit.targetY !== null) {
        const qtx = quantize(unit.targetX, QUANT_POSITION);
        const qty = quantize(unit.targetY, QUANT_POSITION);
        checksum = this.hashCombine(checksum, qtx);
        checksum = this.hashCombine(checksum, qty);
      }

      // Hash cooldowns
      const qLastAttack = quantize(unit.lastAttackTime, QUANT_COOLDOWN);
      checksum = this.hashCombine(checksum, qLastAttack);
    }

    // Hash buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Health', 'Selectable');
    const sortedBuildings = [...buildings].sort((a, b) => a.id - b.id);

    for (const entity of sortedBuildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;

      if (health.isDead() || building.state === 'destroyed') continue;

      buildingCount++;

      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qHealth = quantize(health.current, QUANT_DAMAGE);
      const qProgress = quantize(building.buildProgress, 100);

      checksum = this.hashCombine(checksum, entity.id);
      checksum = this.hashCombine(checksum, qx);
      checksum = this.hashCombine(checksum, qy);
      checksum = this.hashCombine(checksum, qHealth);
      checksum = this.hashCombine(checksum, this.hashString(building.state));
      checksum = this.hashCombine(checksum, qProgress);

      healthSum += qHealth;
    }

    // Hash resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    const sortedResources = [...resources].sort((a, b) => a.id - b.id);

    for (const entity of sortedResources) {
      const resource = entity.get<Resource>('Resource')!;
      const transform = entity.get<Transform>('Transform')!;

      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qAmount = resource.amount | 0;

      checksum = this.hashCombine(checksum, entity.id);
      checksum = this.hashCombine(checksum, qx);
      checksum = this.hashCombine(checksum, qy);
      checksum = this.hashCombine(checksum, qAmount);

      resourceSum += qAmount;
    }

    // Include tick in final hash for ordering verification
    checksum = this.hashCombine(checksum, tick);

    return {
      tick,
      checksum: checksum >>> 0, // Ensure unsigned
      unitCount,
      buildingCount,
      resourceSum,
      unitPositionHash: unitPositionHash >>> 0,
      healthSum,
      timestamp: Date.now(),
    };
  }

  /**
   * Create a detailed state snapshot for debugging
   */
  private createStateSnapshot(tick: number): GameStateSnapshot {
    const entities: EntityStateSnapshot[] = [];
    const playerResources = new Map<string, { minerals: number; vespene: number; supply: number; maxSupply: number }>();

    // Snapshot units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Health', 'Selectable');
    for (const entity of units) {
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (health.isDead()) continue;

      entities.push({
        id: entity.id,
        type: 'unit',
        playerId: selectable.playerId,
        qx: quantize(transform.x, QUANT_POSITION),
        qy: quantize(transform.y, QUANT_POSITION),
        qz: quantize(transform.z, QUANT_POSITION),
        qHealth: quantize(health.current, QUANT_DAMAGE),
        qMaxHealth: quantize(health.max, QUANT_DAMAGE),
        qShield: health.maxShield > 0 ? quantize(health.shield, QUANT_DAMAGE) : undefined,
        unitId: unit.unitId,
        state: unit.state,
        qTargetX: unit.targetX !== null ? quantize(unit.targetX, QUANT_POSITION) : undefined,
        qTargetY: unit.targetY !== null ? quantize(unit.targetY, QUANT_POSITION) : undefined,
        targetEntityId: unit.targetEntityId,
      });
    }

    // Snapshot buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Health', 'Selectable');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable')!;

      if (health.isDead() || building.state === 'destroyed') continue;

      entities.push({
        id: entity.id,
        type: 'building',
        playerId: selectable.playerId,
        qx: quantize(transform.x, QUANT_POSITION),
        qy: quantize(transform.y, QUANT_POSITION),
        qz: quantize(transform.z, QUANT_POSITION),
        qHealth: quantize(health.current, QUANT_DAMAGE),
        qMaxHealth: quantize(health.max, QUANT_DAMAGE),
        buildingId: building.buildingId,
        buildingState: building.state,
        qProgress: quantize(building.buildProgress, 100),
      });
    }

    // Snapshot resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const resource = entity.get<Resource>('Resource')!;

      entities.push({
        id: entity.id,
        type: 'resource',
        qx: quantize(transform.x, QUANT_POSITION),
        qy: quantize(transform.y, QUANT_POSITION),
        qz: quantize(transform.z, QUANT_POSITION),
        qHealth: 0,
        qMaxHealth: 0,
        resourceType: resource.resourceType,
        qAmount: resource.amount | 0,
      });
    }

    // Sort for deterministic ordering
    entities.sort((a, b) => a.id - b.id);

    return {
      tick,
      checksum: 0, // Will be filled in by caller
      timestamp: Date.now(),
      entities,
      playerResources,
    };
  }

  /**
   * Combine two hash values
   * Uses a simple but effective mixing function
   */
  private hashCombine(hash: number, value: number): number {
    // Based on boost::hash_combine
    hash ^= value + 0x9e3779b9 + (hash << 6) + (hash >> 2);
    return hash | 0;
  }

  /**
   * Hash a string deterministically
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = this.hashCombine(hash, str.charCodeAt(i));
    }
    return hash;
  }

  /**
   * Cleanup old checksums to prevent memory growth
   */
  private cleanupOldChecksums(checksums: Map<number, ChecksumData>): void {
    const currentTick = this.game.getCurrentTick();
    const maxAge = 1000; // Keep last 1000 ticks (~50 seconds)

    const ticksToRemove: number[] = [];
    for (const tick of checksums.keys()) {
      if (currentTick - tick > maxAge) {
        ticksToRemove.push(tick);
      }
    }

    for (const tick of ticksToRemove) {
      checksums.delete(tick);
    }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Get the most recent checksum data
   */
  public getLatestChecksum(): ChecksumData | null {
    const ticks = Array.from(this.checksumHistory.keys()).sort((a, b) => b - a);
    if (ticks.length === 0) return null;
    return this.checksumHistory.get(ticks[0]) || null;
  }

  /**
   * Get checksum for a specific tick
   */
  public getChecksum(tick: number): ChecksumData | null {
    return this.checksumHistory.get(tick) || null;
  }

  /**
   * Get all desync reports
   */
  public getDesyncReports(): DesyncReport[] {
    return [...this.desyncReports];
  }

  /**
   * Check if any desyncs have been detected
   */
  public hasDesync(): boolean {
    return this.desyncReports.length > 0;
  }

  /**
   * Get performance stats
   */
  public getPerformanceStats(): { lastChecksumTimeMs: number; avgChecksumTimeMs: number } {
    return {
      lastChecksumTimeMs: this.lastChecksumTime,
      avgChecksumTimeMs: this.avgChecksumTimeMs,
    };
  }

  /**
   * Update configuration
   */
  public setConfig(config: Partial<ChecksumConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  public getConfig(): ChecksumConfig {
    return { ...this.config };
  }

  /**
   * Force checksum computation (for debugging)
   */
  public forceChecksum(): ChecksumData {
    return this.computeChecksum(this.game.getCurrentTick());
  }

  /**
   * Compare two state snapshots and return differences
   */
  public compareSnapshots(local: GameStateSnapshot, remote: GameStateSnapshot): string[] {
    const differences: string[] = [];

    if (local.tick !== remote.tick) {
      differences.push(`Tick mismatch: local=${local.tick}, remote=${remote.tick}`);
    }

    // Build entity maps
    const localEntities = new Map(local.entities.map(e => [e.id, e]));
    const remoteEntities = new Map(remote.entities.map(e => [e.id, e]));

    // Check for missing entities
    for (const [id, entity] of localEntities) {
      if (!remoteEntities.has(id)) {
        differences.push(`Entity ${id} (${entity.type} ${entity.unitId || entity.buildingId}) exists locally but not remotely`);
      }
    }

    for (const [id, entity] of remoteEntities) {
      if (!localEntities.has(id)) {
        differences.push(`Entity ${id} (${entity.type} ${entity.unitId || entity.buildingId}) exists remotely but not locally`);
      }
    }

    // Compare matching entities
    for (const [id, localEntity] of localEntities) {
      const remoteEntity = remoteEntities.get(id);
      if (!remoteEntity) continue;

      if (localEntity.qx !== remoteEntity.qx || localEntity.qy !== remoteEntity.qy) {
        differences.push(
          `Entity ${id} position mismatch: local=(${localEntity.qx},${localEntity.qy}), remote=(${remoteEntity.qx},${remoteEntity.qy})`
        );
      }

      if (localEntity.qHealth !== remoteEntity.qHealth) {
        differences.push(
          `Entity ${id} health mismatch: local=${localEntity.qHealth}, remote=${remoteEntity.qHealth}`
        );
      }

      if (localEntity.state !== remoteEntity.state) {
        differences.push(
          `Entity ${id} state mismatch: local=${localEntity.state}, remote=${remoteEntity.state}`
        );
      }
    }

    return differences;
  }
}
