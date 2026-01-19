/**
 * Worker Distribution System for RTS AI
 *
 * Manages optimal worker distribution across bases:
 * - Auto-transfer oversaturated workers
 * - Balance mining between bases
 * - Gas saturation management
 * - Idle worker assignment
 */

import { Entity } from '../ecs/Entity';
import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { Building } from '../components/Building';
import { Resource } from '../components/Resource';

/**
 * Base saturation status
 */
export interface BaseSaturation {
  baseEntityId: number;
  basePosition: { x: number; y: number };
  /** Workers assigned to minerals */
  mineralWorkers: number;
  /** Workers assigned to gas */
  gasWorkers: number;
  /** Optimal mineral workers */
  optimalMineralWorkers: number;
  /** Optimal gas workers */
  optimalGasWorkers: number;
  /** Mineral patches at this base */
  mineralPatches: number;
  /** Gas extractors at this base */
  gasExtractors: number;
  /** Is this base oversaturated? */
  isOversaturated: boolean;
  /** Is this base undersaturated? */
  isUndersaturated: boolean;
  /** Net worker need (positive = needs workers) */
  workerNeed: number;
}

/**
 * Worker transfer order
 */
export interface WorkerTransfer {
  workerId: number;
  fromBase: number;
  toBase: number;
  targetResource: number | null; // Specific resource to assign to
}

/**
 * Configuration for worker distribution
 */
export interface WorkerDistributionConfig {
  /** Optimal workers per mineral patch */
  workersPerMineral: number;
  /** Optimal workers per gas extractor */
  workersPerGas: number;
  /** Distance to consider a worker "at" a base */
  baseRadius: number;
  /** Oversaturation threshold (ratio above optimal) */
  oversaturationThreshold: number;
  /** Undersaturation threshold (ratio below optimal) */
  undersaturationThreshold: number;
  /** Minimum workers to transfer at once */
  minTransferBatch: number;
  /** Ticks between distribution checks */
  checkInterval: number;
}

const DEFAULT_CONFIG: WorkerDistributionConfig = {
  workersPerMineral: 2,
  workersPerGas: 3,
  baseRadius: 12,
  oversaturationThreshold: 1.3, // 30% over optimal
  undersaturationThreshold: 0.7, // 30% under optimal
  minTransferBatch: 2,
  checkInterval: 40,
};

/**
 * Worker Distribution - Manages worker allocation across bases
 */
export class WorkerDistribution {
  private config: WorkerDistributionConfig;

  // Cached saturation data per player
  private saturationCache: Map<string, BaseSaturation[]> = new Map();
  private lastUpdateTick: Map<string, number> = new Map();

  // Pending transfers
  private pendingTransfers: Map<string, WorkerTransfer[]> = new Map();

  constructor(config?: Partial<WorkerDistributionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update worker distribution for a player
   */
  public update(world: World, playerId: string, currentTick: number): WorkerTransfer[] {
    // Check if update needed
    const lastUpdate = this.lastUpdateTick.get(playerId) || 0;
    if (currentTick - lastUpdate < this.config.checkInterval) {
      return [];
    }
    this.lastUpdateTick.set(playerId, currentTick);

    // Calculate saturation for all bases
    const saturations = this.calculateSaturations(world, playerId);
    this.saturationCache.set(playerId, saturations);

    // Determine transfers needed
    const transfers = this.calculateTransfers(world, playerId, saturations);

    // Store pending transfers
    this.pendingTransfers.set(playerId, transfers);

    return transfers;
  }

  /**
   * Calculate saturation for all bases
   */
  private calculateSaturations(world: World, playerId: string): BaseSaturation[] {
    const saturations: BaseSaturation[] = [];

    // Find all bases
    const bases = this.findPlayerBases(world, playerId);

    // Find all workers
    const workers = this.findPlayerWorkers(world, playerId);

    // Find all resources
    const resources = this.findAllResources(world);

    for (const base of bases) {
      const baseTransform = base.get<Transform>('Transform')!;
      const basePos = { x: baseTransform.x, y: baseTransform.y };

      // Count resources at this base
      let mineralPatches = 0;
      let gasExtractors = 0;
      const resourcesAtBase: number[] = [];

      // Find mineral patches near base
      for (const resource of resources) {
        const resourceTransform = resource.get<Transform>('Transform')!;
        const resourceComp = resource.get<Resource>('Resource')!;

        const dx = resourceTransform.x - basePos.x;
        const dy = resourceTransform.y - basePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= this.config.baseRadius) {
          if (resourceComp.resourceType === 'minerals' && resourceComp.amount > 0) {
            mineralPatches++;
            resourcesAtBase.push(resource.id);
          }
        }
      }

      // Find gas extractors near base (they're buildings)
      const buildings = world.getEntitiesWith('Building', 'Transform', 'Selectable');
      for (const building of buildings) {
        const buildingComp = building.get<Building>('Building')!;
        const buildingTransform = building.get<Transform>('Transform')!;
        const selectable = building.get<Selectable>('Selectable')!;

        if (selectable.playerId !== playerId) continue;
        if (!['extractor', 'refinery', 'assimilator'].includes(buildingComp.buildingId)) continue;
        if (!buildingComp.isComplete()) continue;

        const dx = buildingTransform.x - basePos.x;
        const dy = buildingTransform.y - basePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= this.config.baseRadius) {
          gasExtractors++;
          resourcesAtBase.push(building.id);
        }
      }

      // Calculate optimal workers
      const optimalMineralWorkers = mineralPatches * this.config.workersPerMineral;
      const optimalGasWorkers = gasExtractors * this.config.workersPerGas;
      const optimalTotal = optimalMineralWorkers + optimalGasWorkers;

      // Count workers at this base
      let mineralWorkers = 0;
      let gasWorkers = 0;

      for (const worker of workers) {
        const workerTransform = worker.get<Transform>('Transform')!;
        const workerUnit = worker.get<Unit>('Unit')!;

        const dx = workerTransform.x - basePos.x;
        const dy = workerTransform.y - basePos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= this.config.baseRadius) {
          // Check what the worker is gathering
          if (workerUnit.gatherTargetId !== null) {
            const targetEntity = world.getEntity(workerUnit.gatherTargetId);
            if (targetEntity) {
              const resourceComp = targetEntity.get<Resource>('Resource');
              const buildingComp = targetEntity.get<Building>('Building');

              if (resourceComp && resourceComp.resourceType === 'minerals') {
                mineralWorkers++;
              } else if (buildingComp && ['extractor', 'refinery', 'assimilator'].includes(buildingComp.buildingId)) {
                gasWorkers++;
              } else {
                mineralWorkers++; // Default to mineral
              }
            } else {
              mineralWorkers++; // Target not found, count as mineral
            }
          } else if (workerUnit.state === 'gathering' || workerUnit.carryingMinerals > 0 || workerUnit.carryingVespene > 0) {
            // Gathering but no target - probably returning
            if (workerUnit.carryingVespene > 0) {
              gasWorkers++;
            } else {
              mineralWorkers++;
            }
          } else {
            // Idle worker at base
            mineralWorkers++; // Count idle as potential mineral workers
          }
        }
      }

      const totalWorkers = mineralWorkers + gasWorkers;
      const saturationRatio = optimalTotal > 0 ? totalWorkers / optimalTotal : 0;

      const isOversaturated = saturationRatio > this.config.oversaturationThreshold;
      const isUndersaturated = saturationRatio < this.config.undersaturationThreshold && optimalTotal > 0;
      const workerNeed = optimalMineralWorkers - mineralWorkers + optimalGasWorkers - gasWorkers;

      saturations.push({
        baseEntityId: base.id,
        basePosition: basePos,
        mineralWorkers,
        gasWorkers,
        optimalMineralWorkers,
        optimalGasWorkers,
        mineralPatches,
        gasExtractors,
        isOversaturated,
        isUndersaturated,
        workerNeed,
      });
    }

    return saturations;
  }

  /**
   * Calculate worker transfers needed
   */
  private calculateTransfers(
    world: World,
    playerId: string,
    saturations: BaseSaturation[]
  ): WorkerTransfer[] {
    const transfers: WorkerTransfer[] = [];

    // Find oversaturated and undersaturated bases
    const oversaturated = saturations.filter(s => s.isOversaturated && s.workerNeed < -this.config.minTransferBatch);
    const undersaturated = saturations.filter(s => s.isUndersaturated && s.workerNeed > this.config.minTransferBatch);

    if (oversaturated.length === 0 || undersaturated.length === 0) {
      return [];
    }

    // Find workers at oversaturated bases
    const workers = this.findPlayerWorkers(world, playerId);

    for (const fromBase of oversaturated) {
      // How many to transfer from this base
      let toTransfer = Math.min(
        Math.abs(fromBase.workerNeed),
        this.config.minTransferBatch * 2
      );

      // Find best target base
      const toBase = undersaturated.reduce((best, current) => {
        if (!best) return current;
        return current.workerNeed > best.workerNeed ? current : best;
      }, undersaturated[0]);

      if (!toBase) continue;

      // Find workers to transfer (prioritize idle workers, then those furthest from minerals)
      const workersAtBase = workers.filter(w => {
        const transform = w.get<Transform>('Transform')!;
        const dx = transform.x - fromBase.basePosition.x;
        const dy = transform.y - fromBase.basePosition.y;
        return Math.sqrt(dx * dx + dy * dy) <= this.config.baseRadius;
      });

      // Sort: idle first, then by distance from return point (CC)
      workersAtBase.sort((a, b) => {
        const unitA = a.get<Unit>('Unit')!;
        const unitB = b.get<Unit>('Unit')!;

        // Idle workers first
        if (unitA.state === 'idle' && unitB.state !== 'idle') return -1;
        if (unitB.state === 'idle' && unitA.state !== 'idle') return 1;

        return 0;
      });

      // Create transfer orders
      for (let i = 0; i < Math.min(toTransfer, workersAtBase.length); i++) {
        transfers.push({
          workerId: workersAtBase[i].id,
          fromBase: fromBase.baseEntityId,
          toBase: toBase.baseEntityId,
          targetResource: null, // Will be assigned when executed
        });

        // Update counts
        fromBase.workerNeed++;
        toBase.workerNeed--;
      }
    }

    return transfers;
  }

  /**
   * Execute a worker transfer
   */
  public executeTransfer(world: World, transfer: WorkerTransfer): boolean {
    const worker = world.getEntity(transfer.workerId);
    const toBase = world.getEntity(transfer.toBase);

    if (!worker || !toBase) return false;

    const unit = worker.get<Unit>('Unit');
    const baseTransform = toBase.get<Transform>('Transform');

    if (!unit || !baseTransform) return false;

    // Find a resource at the target base
    const targetResource = this.findResourceAtBase(world, baseTransform.x, baseTransform.y);

    if (targetResource) {
      // Set worker to gather at new base
      unit.setGatherTarget(targetResource);
    } else {
      // Just move to base area if no resource found
      unit.setMoveTarget(baseTransform.x + 3, baseTransform.y + 3);
    }

    return true;
  }

  /**
   * Find a resource near a base position
   */
  private findResourceAtBase(world: World, baseX: number, baseY: number): number | null {
    const resources = world.getEntitiesWith('Resource', 'Transform');

    let closest: number | null = null;
    let closestDist = Infinity;

    for (const resource of resources) {
      const transform = resource.get<Transform>('Transform')!;
      const resourceComp = resource.get<Resource>('Resource')!;

      if (resourceComp.amount <= 0) continue;
      if (resourceComp.resourceType !== 'minerals') continue;

      const dx = transform.x - baseX;
      const dy = transform.y - baseY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= this.config.baseRadius && dist < closestDist) {
        closestDist = dist;
        closest = resource.id;
      }
    }

    return closest;
  }

  /**
   * Find all bases for a player
   */
  private findPlayerBases(world: World, playerId: string): Entity[] {
    const bases: Entity[] = [];
    const buildings = world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    const baseTypes = ['headquarters', 'orbital_station', 'command_center', 'nexus', 'hatchery', 'bastion'];

    for (const entity of buildings) {
      const building = entity.get<Building>('Building')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue;
      if (!baseTypes.includes(building.buildingId)) continue;

      bases.push(entity);
    }

    return bases;
  }

  /**
   * Find all workers for a player
   */
  private findPlayerWorkers(world: World, playerId: string): Entity[] {
    const workers: Entity[] = [];
    const units = world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (!unit.isWorker) continue;

      workers.push(entity);
    }

    return workers;
  }

  /**
   * Find all resources in the world
   */
  private findAllResources(world: World): Entity[] {
    return Array.from(world.getEntitiesWith('Resource', 'Transform'));
  }

  // ==================== PUBLIC API ====================

  /**
   * Get saturation status for all bases
   */
  public getSaturations(playerId: string): BaseSaturation[] {
    return this.saturationCache.get(playerId) || [];
  }

  /**
   * Get pending transfers
   */
  public getPendingTransfers(playerId: string): WorkerTransfer[] {
    return this.pendingTransfers.get(playerId) || [];
  }

  /**
   * Check if any base is oversaturated
   */
  public hasOversaturation(playerId: string): boolean {
    const saturations = this.saturationCache.get(playerId);
    if (!saturations) return false;
    return saturations.some(s => s.isOversaturated);
  }

  /**
   * Check if any base is undersaturated
   */
  public hasUndersaturation(playerId: string): boolean {
    const saturations = this.saturationCache.get(playerId);
    if (!saturations) return false;
    return saturations.some(s => s.isUndersaturated);
  }

  /**
   * Get total worker deficit/surplus
   */
  public getTotalWorkerNeed(playerId: string): number {
    const saturations = this.saturationCache.get(playerId);
    if (!saturations) return 0;
    return saturations.reduce((sum, s) => sum + s.workerNeed, 0);
  }

  /**
   * Find best base for a new worker
   */
  public findBestBaseForWorker(world: World, playerId: string): { x: number; y: number } | null {
    const saturations = this.saturationCache.get(playerId);
    if (!saturations || saturations.length === 0) {
      // Fallback: find first base
      const bases = this.findPlayerBases(world, playerId);
      if (bases.length > 0) {
        const transform = bases[0].get<Transform>('Transform')!;
        return { x: transform.x, y: transform.y };
      }
      return null;
    }

    // Find base with most need
    const best = saturations.reduce((best, current) => {
      if (!best) return current;
      return current.workerNeed > best.workerNeed ? current : best;
    }, saturations[0]);

    return best.basePosition;
  }

  /**
   * Assign idle workers to resources
   */
  public assignIdleWorkers(world: World, playerId: string): number {
    const workers = this.findPlayerWorkers(world, playerId);
    let assigned = 0;

    for (const worker of workers) {
      const unit = worker.get<Unit>('Unit')!;

      // Only assign truly idle workers
      if (unit.state !== 'idle') continue;
      if (unit.gatherTargetId !== null) continue;
      if (unit.constructingBuildingId !== null) continue;

      const transform = worker.get<Transform>('Transform')!;

      // Find nearest resource
      const resources = this.findAllResources(world);
      let closest: number | null = null;
      let closestDist = Infinity;

      for (const resource of resources) {
        const resourceTransform = resource.get<Transform>('Transform')!;
        const resourceComp = resource.get<Resource>('Resource')!;

        if (resourceComp.amount <= 0) continue;

        const dx = resourceTransform.x - transform.x;
        const dy = resourceTransform.y - transform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < closestDist) {
          closestDist = dist;
          closest = resource.id;
        }
      }

      if (closest !== null) {
        unit.setGatherTarget(closest);
        assigned++;
      }
    }

    return assigned;
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.saturationCache.clear();
    this.lastUpdateTick.clear();
    this.pendingTransfers.clear();
  }
}
