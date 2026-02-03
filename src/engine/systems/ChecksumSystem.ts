/**
 * Checksum System - Per-Tick State Verification for Multiplayer Determinism
 *
 * This system computes deterministic checksums of game state at configurable
 * intervals to detect desync between clients. When a desync is detected,
 * it uses Merkle tree binary search for O(log n) divergent entity identification.
 *
 * Merkle Tree Structure:
 *                     [Root Hash]
 *                    /           \
 *           [Units Hash]      [Buildings Hash]      [Resources Hash]
 *           /         \        /            \
 *     [Player1]    [Player2]  [Player1]    [Player2]
 *        /    \
 *   [Entity1] [Entity2]...
 *
 * The checksum algorithm uses a simple but effective hash that:
 * 1. Is deterministic across platforms
 * 2. Is sensitive to small state differences
 * 3. Is fast enough to run every few ticks
 */

import { System } from '../ecs/System';
import type { Game } from '../core/Game';
import { debugNetworking } from '@/utils/debugLogger';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Building } from '../components/Building';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Resource } from '../components/Resource';
import { Projectile } from '../components/Projectile';
import { quantize, QUANT_POSITION, QUANT_DAMAGE, QUANT_COOLDOWN } from '@/utils/FixedPoint';
import {
  MerkleNode,
  MerkleTreeData,
  MerkleTreeBuilder,
  MerkleTreeComparator,
  NetworkMerkleTree,
  DivergenceResult,
} from '../network/MerkleTree';

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
  projectileCount: number;
  resourceSum: number;
  unitPositionHash: number;
  healthSum: number;
  timestamp: number;
  /** Merkle tree for O(log n) divergence detection */
  merkleTree?: MerkleTreeData;
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
  playerResources: Map<string, { minerals: number; plasma: number; supply: number; maxSupply: number }>;
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
  /** Merkle tree divergence result for O(log n) entity identification */
  divergence?: DivergenceResult;
  /** Divergent entity IDs found via Merkle tree binary search */
  divergentEntityIds?: number[];
}

// =============================================================================
// Checksum System
// =============================================================================

export class ChecksumSystem extends System {
  public readonly name = 'ChecksumSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after GameStateSystem)

  private config: ChecksumConfig;
  private checksumHistory: Map<number, ChecksumData> = new Map();
  private stateSnapshots: GameStateSnapshot[] = [];
  private remoteChecksums: Map<string, Map<number, ChecksumData>> = new Map();
  private desyncReports: DesyncReport[] = [];
  private pendingDesyncChecks: Map<number, { remotePeerId: string; remoteChecksum: number; remoteMerkleTree?: NetworkMerkleTree; receivedTick: number }[]> = new Map();

  // Merkle tree storage for remote peers
  private remoteMerkleTrees: Map<string, Map<number, NetworkMerkleTree>> = new Map();

  // Performance tracking
  private lastChecksumTime: number = 0;
  private avgChecksumTimeMs: number = 0;
  private lastMerkleTreeTime: number = 0;
  private avgMerkleTreeTimeMs: number = 0;

  // PERF: Pre-allocated buffers for sorting to avoid allocation during checksum
  private _sortBufferUnits: import('../ecs/Entity').Entity[] = [];
  private _sortBufferBuildings: import('../ecs/Entity').Entity[] = [];
  private _sortBufferResources: import('../ecs/Entity').Entity[] = [];
  private _sortBufferProjectiles: import('../ecs/Entity').Entity[] = [];

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
    merkleTree?: NetworkMerkleTree;
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
      projectileCount: 0,
      resourceSum: data.resourceSum,
      unitPositionHash: 0,
      healthSum: 0,
      timestamp: Date.now(),
    });

    // Store remote Merkle tree if provided
    if (data.merkleTree) {
      if (!this.remoteMerkleTrees.has(data.peerId)) {
        this.remoteMerkleTrees.set(data.peerId, new Map());
      }
      this.remoteMerkleTrees.get(data.peerId)!.set(data.tick, data.merkleTree);
    }

    // Check for desync
    this.checkForDesync(data.peerId, data.tick, data.checksum, data.merkleTree);

    // Cleanup old checksums
    this.cleanupOldChecksums(peerChecksums);
  }

  /**
   * Check if local and remote checksums match for a given tick
   */
  private checkForDesync(
    peerId: string,
    remoteTick: number,
    remoteChecksum: number,
    remoteMerkleTree?: NetworkMerkleTree
  ): void {
    const localChecksum = this.checksumHistory.get(remoteTick);

    if (!localChecksum) {
      // We haven't computed this tick yet - queue for later verification
      const pending = this.pendingDesyncChecks.get(remoteTick) || [];
      pending.push({
        remotePeerId: peerId,
        remoteChecksum,
        remoteMerkleTree,
        receivedTick: this.game.getCurrentTick(),
      });
      this.pendingDesyncChecks.set(remoteTick, pending);
      return;
    }

    if (localChecksum.checksum !== remoteChecksum) {
      this.reportDesync(remoteTick, localChecksum, remoteChecksum, peerId, remoteMerkleTree);
    }
  }

  /**
   * Report a desync and use Merkle tree for O(log n) divergent entity detection
   */
  private reportDesync(
    tick: number,
    localChecksumData: ChecksumData,
    remoteChecksum: number,
    remotePeerId: string,
    remoteMerkleTree?: NetworkMerkleTree
  ): void {
    const localChecksum = localChecksumData.checksum;
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

    // Use Merkle tree for O(log n) divergent entity detection
    if (localChecksumData.merkleTree && remoteMerkleTree) {
      const divergence = MerkleTreeComparator.findDivergence(
        localChecksumData.merkleTree.root,
        this.reconstructRemoteMerkleNode(remoteMerkleTree)
      );
      report.divergence = divergence;
      report.divergentEntityIds = divergence.entityIds;

      debugNetworking.warn(
        `[ChecksumSystem] Merkle tree analysis: Found ${divergence.entityIds.length} divergent entities in ${divergence.comparisons} comparisons (O(log n))`
      );
      debugNetworking.warn(`[ChecksumSystem] Divergent path: ${divergence.path.join(' -> ')}`);
      if (divergence.entityIds.length > 0) {
        debugNetworking.warn(`[ChecksumSystem] Divergent entity IDs: ${divergence.entityIds.join(', ')}`);
      }
    } else if (localChecksumData.merkleTree) {
      // Use category-level comparison if we only have local tree
      const divergentCategories = this.findDivergentCategoriesByHash(
        localChecksumData.merkleTree,
        remoteChecksum
      );
      if (divergentCategories.length > 0) {
        debugNetworking.warn(`[ChecksumSystem] Likely divergent categories: ${divergentCategories.join(', ')}`);
      }
    }

    this.desyncReports.push(report);

    // Keep only recent reports
    while (this.desyncReports.length > this.config.maxStateDumps) {
      this.desyncReports.shift();
    }

    // Emit desync event with Merkle tree info
    this.game.eventBus.emit('desync:detected', {
      tick,
      localChecksum,
      remoteChecksum,
      remotePeerId,
      report,
      divergentEntityIds: report.divergentEntityIds,
    });

    // Log warning
    debugNetworking.warn(
      `[ChecksumSystem] DESYNC DETECTED at tick ${tick}:`,
      `Local: 0x${localChecksum.toString(16)}, Remote: 0x${remoteChecksum.toString(16)}`,
      `(Peer: ${remotePeerId})`
    );

    // Auto-dump state if configured
    if (this.config.autoDumpOnDesync && snapshot) {
      debugNetworking.warn('[ChecksumSystem] State snapshot at desync tick:', snapshot);
    }
  }

  /**
   * Reconstruct a MerkleNode from NetworkMerkleTree for comparison
   * Only creates the structure needed for binary search, not full tree
   */
  private reconstructRemoteMerkleNode(remote: NetworkMerkleTree): MerkleNode {
    const categoryChildren: MerkleNode[] = [];

    for (const [categoryLabel, categoryHash] of Object.entries(remote.categoryHashes)) {
      const groupChildren: MerkleNode[] = [];
      const groups = remote.groupHashes[categoryLabel] || {};

      for (const [groupLabel, groupHash] of Object.entries(groups)) {
        groupChildren.push({
          hash: groupHash,
          type: 'group',
          label: groupLabel,
          children: [], // Entity-level not available in compact format
        });
      }

      groupChildren.sort((a, b) => a.label.localeCompare(b.label));

      categoryChildren.push({
        hash: categoryHash,
        type: 'category',
        label: categoryLabel,
        children: groupChildren,
      });
    }

    categoryChildren.sort((a, b) => a.label.localeCompare(b.label));

    return {
      hash: remote.rootHash,
      type: 'root',
      label: 'root',
      children: categoryChildren,
    };
  }

  /**
   * Find potentially divergent categories when we don't have remote Merkle tree
   */
  private findDivergentCategoriesByHash(
    localTree: MerkleTreeData,
    _remoteRootHash: number
  ): string[] {
    // Without remote category hashes, we can only report which categories
    // have the most entities (likely sources of divergence)
    const categories = localTree.root.children
      .map((c) => ({
        label: c.label,
        entityCount: this.countEntitiesInNode(c),
      }))
      .sort((a, b) => b.entityCount - a.entityCount);

    return categories.slice(0, 2).map((c) => c.label);
  }

  /**
   * Count entities in a Merkle node subtree
   */
  private countEntitiesInNode(node: MerkleNode): number {
    if (node.type === 'entity') return 1;
    let count = 0;
    for (const child of node.children) {
      count += this.countEntitiesInNode(child);
    }
    return count;
  }

  /**
   * Handle debug checksum request
   */
  private handleChecksumRequest(): void {
    const currentTick = this.game.getCurrentTick();
    const checksumData = this.computeChecksum(currentTick);
    debugNetworking.log(`[ChecksumSystem] Tick ${currentTick} checksum:`, checksumData);
  }

  /**
   * Dump current game state for debugging
   */
  public dumpCurrentState(): GameStateSnapshot {
    const tick = this.game.getCurrentTick();
    const snapshot = this.createStateSnapshot(tick);

    debugNetworking.log('[ChecksumSystem] Current state dump:', snapshot);

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

    // Emit checksum for network synchronization (includes serialized Merkle tree)
    if (this.config.emitNetworkChecksums) {
      const merkleTree = checksumData.merkleTree
        ? MerkleTreeComparator.serializeForNetwork(checksumData.merkleTree)
        : undefined;

      this.game.eventBus.emit('checksum:computed', {
        tick: currentTick,
        checksum: checksumData.checksum,
        unitCount: checksumData.unitCount,
        buildingCount: checksumData.buildingCount,
        resourceSum: checksumData.resourceSum,
        merkleTree,
      });
    }

    // Log if configured
    if (this.config.logChecksums) {
      debugNetworking.log(
        `[ChecksumSystem] Tick ${currentTick}: 0x${checksumData.checksum.toString(16)}`,
        `(${checksumData.unitCount} units, ${checksumData.buildingCount} buildings, ${checksumData.projectileCount} projectiles)`
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
            this.reportDesync(tick, localChecksum, pending.remoteChecksum, pending.remotePeerId, pending.remoteMerkleTree);
          }
        }
        ticksToRemove.push(tick);
      } else if (currentTick - tick > this.config.desyncConfirmationTicks) {
        // CRITICAL: Unable to verify checksums for old tick - potential undetected desync
        // This shouldn't happen in normal gameplay; log as warning
        debugNetworking.warn(`[ChecksumSystem] UNVERIFIED: Could not verify checksums for tick ${tick} (${pendingList.length} pending). Local computation may be delayed.`);
        // If we have pending remote checksums but no local, something is wrong
        // In production, this could indicate desync or severe lag
        if (pendingList.length > 0) {
          console.error(`[ChecksumSystem] Potential desync: remote checksums received but local not computed for tick ${tick}`);
        }
        ticksToRemove.push(tick);
      }
    }

    for (const tick of ticksToRemove) {
      this.pendingDesyncChecks.delete(tick);
    }
  }

  /**
   * Compute a deterministic checksum of the current game state
   * Also builds a Merkle tree for O(log n) divergence detection
   */
  private computeChecksum(tick: number): ChecksumData {
    const merkleStartTime = performance.now();

    let checksum = 0;
    let unitCount = 0;
    let buildingCount = 0;
    let projectileCount = 0;
    let resourceSum = 0;
    let unitPositionHash = 0;
    let healthSum = 0;

    // Merkle tree leaf nodes grouped by player
    const unitNodesByPlayer = new Map<string, MerkleNode[]>();
    const buildingNodesByPlayer = new Map<string, MerkleNode[]>();
    const projectileNodesByPlayer = new Map<string, MerkleNode[]>();
    const resourceNodes: MerkleNode[] = [];

    // Hash units and build Merkle leaf nodes
    // PERF: Reuse pre-allocated buffer instead of creating new array with spread
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Health', 'Selectable');
    this._sortBufferUnits.length = 0;
    for (let i = 0; i < units.length; i++) {
      this._sortBufferUnits.push(units[i]);
    }
    // Sort by entity ID for deterministic ordering
    this._sortBufferUnits.sort((a, b) => a.id - b.id);

    for (const entity of this._sortBufferUnits) {
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

      // Compute entity hash for Merkle leaf
      let entityHash = 0;
      entityHash = this.hashCombine(entityHash, entity.id);
      entityHash = this.hashCombine(entityHash, qx);
      entityHash = this.hashCombine(entityHash, qy);
      entityHash = this.hashCombine(entityHash, qz);
      entityHash = this.hashCombine(entityHash, qHealth);
      entityHash = this.hashCombine(entityHash, this.hashString(unit.state));
      entityHash = this.hashCombine(entityHash, unit.targetEntityId || 0);

      // Hash target position if moving
      if (unit.targetX !== null && unit.targetY !== null) {
        const qtx = quantize(unit.targetX, QUANT_POSITION);
        const qty = quantize(unit.targetY, QUANT_POSITION);
        entityHash = this.hashCombine(entityHash, qtx);
        entityHash = this.hashCombine(entityHash, qty);
      }

      // Hash cooldowns
      const qLastAttack = quantize(unit.lastAttackTime, QUANT_COOLDOWN);
      entityHash = this.hashCombine(entityHash, qLastAttack);

      // Create Merkle leaf node
      const leafNode = MerkleTreeBuilder.createEntityNode(entity.id, 'unit', entityHash);

      // Group by player
      const playerId = selectable.playerId || 'neutral';
      if (!unitNodesByPlayer.has(playerId)) {
        unitNodesByPlayer.set(playerId, []);
      }
      unitNodesByPlayer.get(playerId)!.push(leafNode);

      // Combine into flat checksum
      checksum = this.hashCombine(checksum, entityHash);

      // Track aggregates
      unitPositionHash = this.hashCombine(unitPositionHash, qx ^ qy);
      healthSum += qHealth;
    }

    // Hash buildings and build Merkle leaf nodes
    // PERF: Reuse pre-allocated buffer instead of creating new array with spread
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Health', 'Selectable');
    this._sortBufferBuildings.length = 0;
    for (let i = 0; i < buildings.length; i++) {
      this._sortBufferBuildings.push(buildings[i]);
    }
    this._sortBufferBuildings.sort((a, b) => a.id - b.id);

    for (const entity of this._sortBufferBuildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;
      const health = entity.get<Health>('Health')!;
      const selectable = entity.get<Selectable>('Selectable');

      if (health.isDead() || building.state === 'destroyed') continue;

      buildingCount++;

      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qHealth = quantize(health.current, QUANT_DAMAGE);
      const qProgress = quantize(building.buildProgress, 100);

      // Compute entity hash for Merkle leaf
      let entityHash = 0;
      entityHash = this.hashCombine(entityHash, entity.id);
      entityHash = this.hashCombine(entityHash, qx);
      entityHash = this.hashCombine(entityHash, qy);
      entityHash = this.hashCombine(entityHash, qHealth);
      entityHash = this.hashCombine(entityHash, this.hashString(building.state));
      entityHash = this.hashCombine(entityHash, qProgress);

      // Create Merkle leaf node
      const leafNode = MerkleTreeBuilder.createEntityNode(entity.id, 'building', entityHash);

      // Group by player
      const playerId = selectable?.playerId || 'neutral';
      if (!buildingNodesByPlayer.has(playerId)) {
        buildingNodesByPlayer.set(playerId, []);
      }
      buildingNodesByPlayer.get(playerId)!.push(leafNode);

      // Combine into flat checksum
      checksum = this.hashCombine(checksum, entityHash);

      healthSum += qHealth;
    }

    // Hash resources and build Merkle leaf nodes
    // PERF: Reuse pre-allocated buffer instead of creating new array with spread
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    this._sortBufferResources.length = 0;
    for (let i = 0; i < resources.length; i++) {
      this._sortBufferResources.push(resources[i]);
    }
    this._sortBufferResources.sort((a, b) => a.id - b.id);

    for (const entity of this._sortBufferResources) {
      const resource = entity.get<Resource>('Resource')!;
      const transform = entity.get<Transform>('Transform')!;

      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qAmount = resource.amount | 0;

      // Compute entity hash for Merkle leaf
      let entityHash = 0;
      entityHash = this.hashCombine(entityHash, entity.id);
      entityHash = this.hashCombine(entityHash, qx);
      entityHash = this.hashCombine(entityHash, qy);
      entityHash = this.hashCombine(entityHash, qAmount);

      // Create Merkle leaf node (resources are not owned by players)
      const leafNode = MerkleTreeBuilder.createEntityNode(entity.id, 'resource', entityHash);
      resourceNodes.push(leafNode);

      // Combine into flat checksum
      checksum = this.hashCombine(checksum, entityHash);

      resourceSum += qAmount;
    }

    // Hash projectiles and build Merkle leaf nodes
    // PERF: Reuse pre-allocated buffer instead of creating new array with spread
    const projectiles = this.world.getEntitiesWith('Projectile', 'Transform');
    this._sortBufferProjectiles.length = 0;
    for (let i = 0; i < projectiles.length; i++) {
      this._sortBufferProjectiles.push(projectiles[i]);
    }
    this._sortBufferProjectiles.sort((a, b) => a.id - b.id);

    for (const entity of this._sortBufferProjectiles) {
      const transform = entity.get<Transform>('Transform')!;
      const projectile = entity.get<Projectile>('Projectile')!;

      if (projectile.hasImpacted) continue;

      projectileCount++;

      // Quantize position for deterministic hashing
      const qx = quantize(transform.x, QUANT_POSITION);
      const qy = quantize(transform.y, QUANT_POSITION);
      const qz = quantize(transform.z, QUANT_POSITION);
      const qTargetX = quantize(projectile.targetX, QUANT_POSITION);
      const qTargetY = quantize(projectile.targetY, QUANT_POSITION);
      const qTargetZ = quantize(projectile.targetZ, QUANT_POSITION);
      const qDamage = quantize(projectile.damage, QUANT_DAMAGE);

      // Compute entity hash for Merkle leaf
      let entityHash = 0;
      entityHash = this.hashCombine(entityHash, entity.id);
      entityHash = this.hashCombine(entityHash, qx);
      entityHash = this.hashCombine(entityHash, qy);
      entityHash = this.hashCombine(entityHash, qz);
      entityHash = this.hashCombine(entityHash, qTargetX);
      entityHash = this.hashCombine(entityHash, qTargetY);
      entityHash = this.hashCombine(entityHash, qTargetZ);
      entityHash = this.hashCombine(entityHash, qDamage);
      entityHash = this.hashCombine(entityHash, projectile.sourceEntityId);
      entityHash = this.hashCombine(entityHash, projectile.targetEntityId || 0);
      entityHash = this.hashCombine(entityHash, this.hashString(projectile.behavior));
      entityHash = this.hashCombine(entityHash, projectile.spawnTick);

      // Create Merkle leaf node
      const leafNode = MerkleTreeBuilder.createEntityNode(entity.id, 'projectile', entityHash);

      // Group by source player
      const playerId = projectile.sourcePlayerId || 'neutral';
      if (!projectileNodesByPlayer.has(playerId)) {
        projectileNodesByPlayer.set(playerId, []);
      }
      projectileNodesByPlayer.get(playerId)!.push(leafNode);

      // Combine into flat checksum
      checksum = this.hashCombine(checksum, entityHash);
    }

    // Include tick in final hash for ordering verification
    checksum = this.hashCombine(checksum, tick);

    // Build Merkle tree structure
    const merkleTree = this.buildMerkleTree(
      tick,
      unitNodesByPlayer,
      buildingNodesByPlayer,
      projectileNodesByPlayer,
      resourceNodes,
      unitCount + buildingCount + projectileCount + resourceNodes.length
    );

    // Track Merkle tree performance
    const merkleElapsed = performance.now() - merkleStartTime;
    this.lastMerkleTreeTime = merkleElapsed;
    this.avgMerkleTreeTimeMs = this.avgMerkleTreeTimeMs * 0.9 + merkleElapsed * 0.1;

    return {
      tick,
      checksum: checksum >>> 0, // Ensure unsigned
      unitCount,
      buildingCount,
      projectileCount,
      resourceSum,
      unitPositionHash: unitPositionHash >>> 0,
      healthSum,
      timestamp: Date.now(),
      merkleTree,
    };
  }

  /**
   * Build the Merkle tree from entity leaf nodes
   *
   * Tree Structure:
   *                     [Root Hash]
   *                    /           \             \              \
   *           [Units Hash]   [Buildings Hash]  [Projectiles]  [Resources Hash]
   *           /         \        /            \
   *     [Player1]    [Player2]  [Player1]    [Player2]
   *        /    \
   *   [Entity1] [Entity2]...
   */
  private buildMerkleTree(
    tick: number,
    unitNodesByPlayer: Map<string, MerkleNode[]>,
    buildingNodesByPlayer: Map<string, MerkleNode[]>,
    projectileNodesByPlayer: Map<string, MerkleNode[]>,
    resourceNodes: MerkleNode[],
    entityCount: number
  ): MerkleTreeData {
    // Build Units category
    const unitGroups: MerkleNode[] = [];
    for (const [playerId, nodes] of unitNodesByPlayer) {
      if (nodes.length > 0) {
        unitGroups.push(MerkleTreeBuilder.createGroupNode(playerId, nodes));
      }
    }
    const unitsCategory = MerkleTreeBuilder.createCategoryNode('units', unitGroups);

    // Build Buildings category
    const buildingGroups: MerkleNode[] = [];
    for (const [playerId, nodes] of buildingNodesByPlayer) {
      if (nodes.length > 0) {
        buildingGroups.push(MerkleTreeBuilder.createGroupNode(playerId, nodes));
      }
    }
    const buildingsCategory = MerkleTreeBuilder.createCategoryNode('buildings', buildingGroups);

    // Build Projectiles category
    const projectileGroups: MerkleNode[] = [];
    for (const [playerId, nodes] of projectileNodesByPlayer) {
      if (nodes.length > 0) {
        projectileGroups.push(MerkleTreeBuilder.createGroupNode(playerId, nodes));
      }
    }
    const projectilesCategory = MerkleTreeBuilder.createCategoryNode('projectiles', projectileGroups);

    // Build Resources category (single group since not player-owned)
    const resourcesCategory = MerkleTreeBuilder.createCategoryNode('resources', [
      MerkleTreeBuilder.createGroupNode('world', resourceNodes),
    ]);

    // Build root
    const categories: MerkleNode[] = [];
    if (unitGroups.length > 0) categories.push(unitsCategory);
    if (buildingGroups.length > 0) categories.push(buildingsCategory);
    if (projectileGroups.length > 0) categories.push(projectilesCategory);
    if (resourceNodes.length > 0) categories.push(resourcesCategory);

    const root = MerkleTreeBuilder.createRootNode(categories);

    return {
      root,
      tick,
      timestamp: Date.now(),
      entityCount,
    };
  }

  /**
   * Create a detailed state snapshot for debugging
   */
  private createStateSnapshot(tick: number): GameStateSnapshot {
    const entities: EntityStateSnapshot[] = [];
    const playerResources = new Map<string, { minerals: number; plasma: number; supply: number; maxSupply: number }>();

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
   * Get performance stats including Merkle tree computation time
   */
  public getPerformanceStats(): {
    lastChecksumTimeMs: number;
    avgChecksumTimeMs: number;
    lastMerkleTreeTimeMs: number;
    avgMerkleTreeTimeMs: number;
  } {
    return {
      lastChecksumTimeMs: this.lastChecksumTime,
      avgChecksumTimeMs: this.avgChecksumTimeMs,
      lastMerkleTreeTimeMs: this.lastMerkleTreeTime,
      avgMerkleTreeTimeMs: this.avgMerkleTreeTimeMs,
    };
  }

  /**
   * Get the latest Merkle tree for the current state
   */
  public getLatestMerkleTree(): MerkleTreeData | null {
    const latestChecksum = this.getLatestChecksum();
    return latestChecksum?.merkleTree || null;
  }

  /**
   * Find divergent entities between local state and a remote Merkle tree
   * Returns O(log n) result instead of O(n) full comparison
   */
  public findDivergentEntities(remoteMerkleTree: NetworkMerkleTree): DivergenceResult | null {
    const localTree = this.getLatestMerkleTree();
    if (!localTree) return null;

    return MerkleTreeComparator.findDivergence(
      localTree.root,
      this.reconstructRemoteMerkleNode(remoteMerkleTree)
    );
  }

  /**
   * Get divergent categories (quick check without full tree comparison)
   */
  public getDivergentCategories(remoteMerkleTree: NetworkMerkleTree): string[] {
    const localTree = this.getLatestMerkleTree();
    if (!localTree) return [];

    return MerkleTreeComparator.findDivergentCategories(localTree, remoteMerkleTree);
  }

  /**
   * Get divergent groups within a category
   */
  public getDivergentGroups(remoteMerkleTree: NetworkMerkleTree, category: string): string[] {
    const localTree = this.getLatestMerkleTree();
    if (!localTree) return [];

    return MerkleTreeComparator.findDivergentGroups(localTree, remoteMerkleTree, category);
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

// Re-export Merkle tree types for external use
export type {
  MerkleNode,
  MerkleTreeData,
  NetworkMerkleTree,
  DivergenceResult,
  MerkleCompareRequest,
  MerkleCompareResponse,
} from '../network/MerkleTree';

export { MerkleTreeBuilder, MerkleTreeComparator } from '../network/MerkleTree';
