/**
 * AIEconomyManager - Worker management, resource gathering, and repair
 *
 * Handles:
 * - Worker assignment to mineral patches and refineries
 * - Optimal saturation management across bases
 * - Resume incomplete building construction
 * - Repair of damaged buildings and mechanical units
 *
 * Integrates WorkerDistribution primitive for optimal saturation:
 * - Tracks worker counts per base
 * - Calculates transfer recommendations
 * - Manages optimal workers per mineral/gas
 *
 * Uses simulation-based economy (real worker gathering, no passive income).
 */

import { Entity } from '../../ecs/Entity';
import { Transform } from '../../components/Transform';
import { Unit } from '../../components/Unit';
import { Building } from '../../components/Building';
import { Health } from '../../components/Health';
import { Selectable } from '../../components/Selectable';
import { Resource } from '../../components/Resource';
import { Game } from '../../core/Game';
import { debugAI } from '@/utils/debugLogger';
import type { AICoordinator, AIPlayer } from './AICoordinator';

export class AIEconomyManager {
  private game: Game;
  private coordinator: AICoordinator;

  constructor(game: Game, coordinator: AICoordinator) {
    this.game = game;
    this.coordinator = coordinator;
  }

  private get world() {
    return this.game.world;
  }

  // === Worker Finding ===

  /**
   * Find an available worker for the AI to assign to construction.
   * Prefers idle workers, then gathering workers, then moving workers.
   */
  public findAvailableWorker(playerId: string): number | null {
    const units = this.coordinator.getCachedUnits();

    let gatheringWorker: number | null = null;
    let movingWorker: number | null = null;

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      if (unit.state === 'idle') {
        return entity.id;
      } else if (unit.state === 'gathering' && gatheringWorker === null) {
        gatheringWorker = entity.id;
      } else if (unit.state === 'moving' && movingWorker === null) {
        movingWorker = entity.id;
      }
    }

    return gatheringWorker ?? movingWorker ?? null;
  }

  /**
   * Find an available worker that's not already building.
   */
  public findAvailableWorkerNotBuilding(playerId: string): number | null {
    const units = this.coordinator.getCachedUnits();

    let bestId: number | null = null;
    let bestPriority = 0;

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;
      if (unit.constructingBuildingId !== null) continue;

      let priority = 0;
      if (unit.state === 'idle') {
        priority = 3;
      } else if (unit.state === 'gathering') {
        priority = 2;
      } else if (unit.state === 'moving') {
        priority = 1;
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestId = entity.id;
        if (priority === 3) return bestId;
      }
    }

    return bestId;
  }

  // === Incomplete Building Management ===

  /**
   * Find incomplete buildings (paused or waiting_for_worker) that need workers assigned.
   */
  public findIncompleteBuildings(playerId: string): Array<{ buildingId: number; progress: number }> {
    const buildings = this.coordinator.getCachedBuildingsWithTransform();
    const incomplete: Array<{ buildingId: number; progress: number }> = [];

    for (const entity of buildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!building || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;

      if (building.state === 'paused' || building.state === 'waiting_for_worker') {
        incomplete.push({
          buildingId: entity.id,
          progress: building.buildProgress,
        });
      }
    }

    incomplete.sort((a, b) => b.progress - a.progress);

    return incomplete;
  }

  /**
   * Try to resume construction on incomplete buildings.
   */
  public tryResumeIncompleteBuildings(ai: AIPlayer): boolean {
    const incompleteBuildings = this.findIncompleteBuildings(ai.playerId);

    if (incompleteBuildings.length === 0) {
      return false;
    }

    const workerId = this.findAvailableWorkerNotBuilding(ai.playerId);
    if (workerId === null) {
      return false;
    }

    const target = incompleteBuildings[0];

    debugAI.log(`[AIEconomy] ${ai.playerId}: Resuming incomplete building ${target.buildingId} at ${Math.round(target.progress * 100)}% with worker ${workerId}`);

    this.game.eventBus.emit('command:resume_construction', {
      workerId,
      buildingId: target.buildingId,
    });

    return true;
  }

  // === Repair Management ===

  /**
   * Assign workers to repair damaged buildings and mechanical units.
   */
  public assignWorkersToRepair(ai: AIPlayer): void {
    const damagedBuildings: Array<{ entityId: number; x: number; y: number; healthPercent: number }> = [];
    const buildings = this.coordinator.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!building.isComplete()) continue;

      const healthPercent = health.getHealthPercent();
      if (healthPercent < 0.9) {
        damagedBuildings.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          healthPercent
        });
      }
    }

    const damagedUnits: Array<{ entityId: number; x: number; y: number; healthPercent: number }> = [];
    const units = this.coordinator.getCachedUnitsWithTransform();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (health.isDead()) continue;
      if (!unit.isMechanical) continue;
      if (unit.isWorker) continue;

      const healthPercent = health.getHealthPercent();
      if (healthPercent < 0.9) {
        damagedUnits.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          healthPercent
        });
      }
    }

    if (damagedBuildings.length === 0 && damagedUnits.length === 0) return;

    damagedBuildings.sort((a, b) => a.healthPercent - b.healthPercent);
    damagedUnits.sort((a, b) => a.healthPercent - b.healthPercent);

    const availableWorkers: Array<{ entityId: number; x: number; y: number; isIdle: boolean }> = [];

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (!unit.canRepair) continue;
      if (health.isDead()) continue;
      if (unit.isRepairing) continue;
      if (unit.constructingBuildingId !== null) continue;
      if (unit.state === 'building') continue;

      const isIdle = unit.state === 'idle' || unit.state === 'moving';
      const isGathering = unit.state === 'gathering';

      if (isIdle || isGathering) {
        availableWorkers.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          isIdle
        });
      }
    }

    if (availableWorkers.length === 0) return;

    availableWorkers.sort((a, b) => (b.isIdle ? 1 : 0) - (a.isIdle ? 1 : 0));

    let workerIndex = 0;

    for (const building of damagedBuildings) {
      if (building.healthPercent < 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    for (const building of damagedBuildings) {
      if (building.healthPercent >= 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    for (const unit of damagedUnits) {
      if (workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: unit.entityId,
        });
      }
    }
  }

  // === Resource Gathering with WorkerDistribution ===

  /**
   * Get saturation summary from WorkerDistribution.
   */
  private getSaturationSummary(ai: AIPlayer): {
    totalMineralWorkers: number;
    optimalMineralWorkers: number;
    totalGasWorkers: number;
    optimalGasWorkers: number;
  } {
    const saturations = ai.workerDistribution.getSaturations(ai.playerId);
    let totalMineralWorkers = 0;
    let optimalMineralWorkers = 0;
    let totalGasWorkers = 0;
    let optimalGasWorkers = 0;

    for (const saturation of saturations) {
      totalMineralWorkers += saturation.mineralWorkers;
      optimalMineralWorkers += saturation.optimalMineralWorkers;
      totalGasWorkers += saturation.gasWorkers;
      optimalGasWorkers += saturation.optimalGasWorkers;
    }

    return {
      totalMineralWorkers,
      optimalMineralWorkers,
      totalGasWorkers,
      optimalGasWorkers,
    };
  }

  /**
   * Find idle workers and send them to gather minerals or vespene.
   * Uses WorkerDistribution primitive for optimal saturation management.
   */
  public assignIdleWorkersToGather(ai: AIPlayer): void {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;
    const workerDistribution = ai.workerDistribution;
    const currentTick = this.game.getCurrentTick();

    // Update WorkerDistribution with current game state (handles all tracking internally)
    workerDistribution.update(this.world, ai.playerId, currentTick);

    // Find ALL AI base positions
    const basePositions: Array<{ entityId: number; x: number; y: number }> = [];
    const buildings = this.coordinator.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (!building.isComplete()) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ entityId: entity.id, x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) {
      debugAI.log(`[AIEconomy] ${ai.playerId}: No base found for gathering!`);
      return;
    }

    // Get transfer recommendations from WorkerDistribution
    const transfers = workerDistribution.getPendingTransfers(ai.playerId);

    // Build resource lookup maps
    const resources = this.coordinator.getCachedResources();
    const baseToResources = new Map<number, {
      minerals: Array<{ entityId: number; x: number; y: number; currentWorkers: number }>;
      refineries: Array<{ entityId: number; resourceEntityId: number; currentWorkers: number }>;
    }>();

    // Initialize resource maps for each base
    for (const base of basePositions) {
      baseToResources.set(base.entityId, { minerals: [], refineries: [] });
    }

    // Populate mineral data
    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      // Find nearest base
      let nearestBase: { entityId: number; distance: number } | null = null;
      for (const base of basePositions) {
        const dx = transform.x - base.x;
        const dy = transform.y - base.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 30 && (!nearestBase || distance < nearestBase.distance)) {
          nearestBase = { entityId: base.entityId, distance };
        }
      }

      if (nearestBase) {
        const baseResources = baseToResources.get(nearestBase.entityId);
        if (baseResources) {
          baseResources.minerals.push({
            entityId: entity.id,
            x: transform.x,
            y: transform.y,
            currentWorkers: resource.getCurrentGatherers(),
          });
        }
      }
    }

    // Populate refinery data
    const extractorBuildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');
    const extractorToResource = new Map<number, { entity: Entity; resource: Resource }>();

    for (const resEntity of resources) {
      const resource = resEntity.get<Resource>('Resource');
      if (!resource || resource.resourceType !== 'vespene') continue;
      if (resource.extractorEntityId !== null) {
        extractorToResource.set(resource.extractorEntityId, { entity: resEntity, resource });
      }
    }

    for (const entity of extractorBuildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');
      const transform = entity.get<Transform>('Transform');

      if (!building || !selectable || !transform) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (building.buildingId !== config.roles.gasExtractor) continue;
      if (!building.isComplete()) continue;

      const vespeneData = extractorToResource.get(entity.id);
      if (!vespeneData) continue;

      // Find nearest base
      let nearestBase: { entityId: number; distance: number } | null = null;
      for (const base of basePositions) {
        const dx = transform.x - base.x;
        const dy = transform.y - base.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 30 && (!nearestBase || distance < nearestBase.distance)) {
          nearestBase = { entityId: base.entityId, distance };
        }
      }

      if (nearestBase) {
        const baseResources = baseToResources.get(nearestBase.entityId);
        if (baseResources) {
          baseResources.refineries.push({
            entityId: entity.id,
            resourceEntityId: vespeneData.entity.id,
            currentWorkers: vespeneData.resource.getCurrentGatherers(),
          });
        }
      }
    }

    // Find idle workers
    const units = this.coordinator.getCachedUnitsWithTransform();
    const idleWorkers: Array<{ entityId: number; x: number; y: number }> = [];
    const workerStates: Record<string, number> = {};

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');

      if (!selectable || !unit || !health || !transform) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      workerStates[unit.state] = (workerStates[unit.state] || 0) + 1;

      const isIdle = unit.state === 'idle';
      const isMovingNoTarget = unit.state === 'moving' &&
                               unit.targetX === null &&
                               unit.targetY === null &&
                               unit.gatherTargetId === null;

      if (isIdle || isMovingNoTarget) {
        idleWorkers.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
        });
      }
    }

    // Debug log periodically
    if (this.game.getCurrentTick() % 200 === 0) {
      const statesStr = Object.entries(workerStates).map(([k, v]) => `${k}:${v}`).join(', ');
      const saturationSummary = this.getSaturationSummary(ai);
      debugAI.log(
        `[AIEconomy] ${ai.playerId}: workers=[${statesStr}], idle=${idleWorkers.length}, ` +
        `saturation: ${saturationSummary.totalMineralWorkers}/${saturationSummary.optimalMineralWorkers} minerals, ` +
        `${saturationSummary.totalGasWorkers}/${saturationSummary.optimalGasWorkers} gas`
      );
    }

    // Process worker transfers first
    // Note: WorkerDistribution may select workers that are actively gathering (not idle)
    // when rebalancing oversaturated bases, so we issue commands regardless of idle state
    for (const transfer of transfers) {
      const workerId = transfer.workerId;

      // Find destination base
      const destBase = basePositions.find(b => b.entityId === transfer.toBase);
      if (!destBase) continue;

      const destResources = baseToResources.get(transfer.toBase);
      if (!destResources) continue;

      // If transfer has a specific target resource, use it
      if (transfer.targetResource !== null) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: transfer.targetResource,
        });
        debugAI.log(`[AIEconomy] ${ai.playerId}: Transferring worker ${workerId} to resource ${transfer.targetResource}`);
      } else {
        // Otherwise assign to undersaturated resource at destination
        const refinery = destResources.refineries.find(r => r.currentWorkers < 3);
        if (refinery) {
          this.game.eventBus.emit('command:gather', {
            entityIds: [workerId],
            targetEntityId: refinery.resourceEntityId,
          });
          refinery.currentWorkers++;
          debugAI.log(`[AIEconomy] ${ai.playerId}: Transferring worker ${workerId} to refinery at base ${transfer.toBase}`);
          continue;
        }

        const mineral = destResources.minerals.find(m => m.currentWorkers < 2);
        if (mineral) {
          this.game.eventBus.emit('command:gather', {
            entityIds: [workerId],
            targetEntityId: mineral.entityId,
          });
          mineral.currentWorkers++;
          debugAI.log(`[AIEconomy] ${ai.playerId}: Transferring worker ${workerId} to minerals at base ${transfer.toBase}`);
        }
      }

      // Remove from idle workers list if present (so we don't double-assign)
      const workerIndex = idleWorkers.findIndex(w => w.entityId === workerId);
      if (workerIndex !== -1) {
        idleWorkers.splice(workerIndex, 1);
      }
    }

    // Assign remaining idle workers to resources
    for (const worker of idleWorkers) {
      // Find nearest base for this worker
      let nearestBase: { entityId: number; distance: number } | null = null;
      for (const base of basePositions) {
        const dx = worker.x - base.x;
        const dy = worker.y - base.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!nearestBase || distance < nearestBase.distance) {
          nearestBase = { entityId: base.entityId, distance };
        }
      }

      if (!nearestBase) continue;

      const targetResources = baseToResources.get(nearestBase.entityId);
      if (!targetResources) continue;

      // Check saturation to determine if we need gas workers
      const saturations = workerDistribution.getSaturations(ai.playerId);
      const baseSaturation = saturations.find(s => s.baseEntityId === nearestBase.entityId);

      // Prioritize gas if undersaturated
      if (baseSaturation && baseSaturation.gasWorkers < baseSaturation.optimalGasWorkers) {
        const refinery = targetResources.refineries.find(r => r.currentWorkers < 3);
        if (refinery) {
          this.game.eventBus.emit('command:gather', {
            entityIds: [worker.entityId],
            targetEntityId: refinery.resourceEntityId,
          });
          refinery.currentWorkers++;
          continue;
        }
      }

      // Assign to undersaturated mineral (optimal is 2 per patch)
      const mineral = targetResources.minerals
        .filter(m => m.currentWorkers < 2)
        .sort((a, b) => a.currentWorkers - b.currentWorkers)[0];

      if (mineral) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [worker.entityId],
          targetEntityId: mineral.entityId,
        });
        mineral.currentWorkers++;
        continue;
      }

      // Allow 3rd worker on minerals if all at 2
      const oversatMineral = targetResources.minerals
        .filter(m => m.currentWorkers < 3)
        .sort((a, b) => a.currentWorkers - b.currentWorkers)[0];

      if (oversatMineral) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [worker.entityId],
          targetEntityId: oversatMineral.entityId,
        });
        oversatMineral.currentWorkers++;
        continue;
      }

      // Fallback: assign to any mineral
      if (targetResources.minerals.length > 0) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [worker.entityId],
          targetEntityId: targetResources.minerals[0].entityId,
        });
      }
    }
  }

  // === Vespene Geyser Finding ===

  /**
   * Find a vespene geyser near any AI base that doesn't have a refinery yet.
   */
  public findAvailableVespeneGeyser(ai: AIPlayer, _basePos: { x: number; y: number }): { x: number; y: number } | null {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    const basePositions: Array<{ x: number; y: number }> = [];
    const buildings = this.coordinator.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) return null;

    const resources = this.coordinator.getCachedResources();
    let closestGeyser: { x: number; y: number; distance: number } | null = null;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.hasRefinery()) continue;

      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 30) {
          if (!closestGeyser || distance < closestGeyser.distance) {
            closestGeyser = { x: transform.x, y: transform.y, distance };
          }
          break;
        }
      }
    }

    return closestGeyser ? { x: closestGeyser.x, y: closestGeyser.y } : null;
  }

  /**
   * Count the number of available vespene geysers near AI bases.
   */
  public countAvailableVespeneGeysers(ai: AIPlayer): number {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    const basePositions: Array<{ x: number; y: number }> = [];
    const buildings = this.coordinator.getCachedBuildingsWithTransform();

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const building = entity.get<Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== ai.playerId) continue;
      if (baseTypes.includes(building.buildingId)) {
        basePositions.push({ x: transform.x, y: transform.y });
      }
    }

    if (basePositions.length === 0) return 0;

    const resources = this.coordinator.getCachedResources();
    let availableCount = 0;

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.hasRefinery()) continue;

      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 30) {
          availableCount++;
          break;
        }
      }
    }

    return availableCount;
  }

}
