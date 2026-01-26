/**
 * AIEconomyManager - Worker management, resource gathering, and repair
 *
 * Handles:
 * - Worker assignment to mineral patches and refineries
 * - Optimal saturation management across bases
 * - Resume incomplete building construction
 * - Repair of damaged buildings and mechanical units
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

// Optimal workers per resource patch (standard RTS saturation model)
const OPTIMAL_WORKERS_PER_MINERAL = 2;
const OPTIMAL_WORKERS_PER_VESPENE = 3;

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
   * Single-pass implementation for performance.
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

      // Track by priority - idle > gathering > moving
      if (unit.state === 'idle') {
        return entity.id; // Best priority - return immediately
      } else if (unit.state === 'gathering' && gatheringWorker === null) {
        gatheringWorker = entity.id;
      } else if (unit.state === 'moving' && movingWorker === null) {
        movingWorker = entity.id;
      }
    }

    return gatheringWorker ?? movingWorker ?? null;
  }

  /**
   * Find multiple available workers for the AI to assign to construction.
   * Returns up to `count` worker IDs, prioritizing idle workers first.
   */
  public findAvailableWorkers(playerId: string, count: number): number[] {
    if (count <= 0) return [];

    const units = this.coordinator.getCachedUnits();
    const workers: Array<{ id: number; priority: number }> = [];

    for (const entity of units) {
      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');
      const health = entity.get<Health>('Health');

      if (!unit || !selectable || !health) continue;
      if (selectable.playerId !== playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;
      // Skip workers already building
      if (unit.constructingBuildingId !== null) continue;

      let priority = 0;
      if (unit.state === 'idle') {
        priority = 3;
      } else if (unit.state === 'gathering') {
        priority = 2;
      } else if (unit.state === 'moving') {
        priority = 1;
      }

      if (priority > 0) {
        workers.push({ id: entity.id, priority });
      }
    }

    // Sort by priority (highest first)
    workers.sort((a, b) => b.priority - a.priority);

    // Return up to `count` worker IDs
    return workers.slice(0, count).map(w => w.id);
  }

  /**
   * Find an available worker that's not already building.
   * Stricter than findAvailableWorker - excludes workers in 'building' state.
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
   * Returns buildings sorted by progress (highest first).
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

    // Sort by progress descending (prioritize nearly complete buildings)
    incomplete.sort((a, b) => b.progress - a.progress);

    return incomplete;
  }

  /**
   * Try to resume construction on incomplete buildings.
   * Returns true if a worker was assigned.
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
    // Find damaged buildings that need repair (below 90% health)
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

    // Find damaged mechanical units (below 90% health)
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

    // Sort by health (most damaged first)
    damagedBuildings.sort((a, b) => a.healthPercent - b.healthPercent);
    damagedUnits.sort((a, b) => a.healthPercent - b.healthPercent);

    // Find available workers for repair
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

    // Sort workers - idle first
    availableWorkers.sort((a, b) => (b.isIdle ? 1 : 0) - (a.isIdle ? 1 : 0));

    // Assign workers to repair targets
    let workerIndex = 0;

    // Repair critically damaged buildings first (below 50%)
    for (const building of damagedBuildings) {
      if (building.healthPercent < 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    // Then repair other damaged buildings
    for (const building of damagedBuildings) {
      if (building.healthPercent >= 0.5 && workerIndex < availableWorkers.length) {
        const worker = availableWorkers[workerIndex++];
        this.game.eventBus.emit('command:repair', {
          repairerId: worker.entityId,
          targetId: building.entityId,
        });
      }
    }

    // Finally repair damaged mechanical units
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

  // === Resource Gathering ===

  /**
   * Find idle workers and send them to gather minerals or vespene.
   * Uses optimal saturation targeting and considers all AI bases.
   */
  public assignIdleWorkersToGather(ai: AIPlayer): void {
    const config = ai.config!;
    const baseTypes = config.roles.baseTypes;

    // Find ALL AI base positions (main and expansions)
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

    if (basePositions.length === 0) {
      debugAI.log(`[AIEconomy] ${ai.playerId}: No base found for gathering!`);
      return;
    }

    // Find mineral patches near ANY base with their current saturation
    const resources = this.coordinator.getCachedResources();
    const nearbyMinerals: Array<{ entityId: number; x: number; y: number; distance: number; currentWorkers: number }> = [];

    for (const entity of resources) {
      const resource = entity.get<Resource>('Resource');
      const transform = entity.get<Transform>('Transform');

      if (!resource || !transform) continue;
      if (resource.resourceType !== 'minerals') continue;
      if (resource.isDepleted()) continue;

      // Check distance to ANY base
      let minDistance = Infinity;
      for (const basePos of basePositions) {
        const dx = transform.x - basePos.x;
        const dy = transform.y - basePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }

      if (minDistance < 30) {
        nearbyMinerals.push({
          entityId: entity.id,
          x: transform.x,
          y: transform.y,
          distance: minDistance,
          currentWorkers: resource.getCurrentGatherers()
        });
      }
    }

    // Find AI's completed refineries for vespene harvesting
    const refineries: Array<{ entityId: number; resourceEntityId: number; currentWorkers: number }> = [];
    const extractorBuildings = this.world.getEntitiesWith('Building', 'Selectable', 'Transform');

    // Build map of extractorEntityId -> resource for O(1) lookup
    const extractorToResource = new Map<number, { entity: Entity; resource: Resource }>();
    for (const resEntity of resources) {
      const resource = resEntity.get<Resource>('Resource');
      if (!resource) continue;
      if (resource.resourceType !== 'vespene') continue;
      if (resource.extractorEntityId !== null) {
        extractorToResource.set(resource.extractorEntityId, { entity: resEntity, resource });
      }
    }

    for (const entity of extractorBuildings) {
      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !selectable) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (building.buildingId !== config.roles.gasExtractor) continue;
      if (!building.isComplete()) continue;

      const vespeneData = extractorToResource.get(entity.id);
      if (vespeneData) {
        refineries.push({
          entityId: entity.id,
          resourceEntityId: vespeneData.entity.id,
          currentWorkers: vespeneData.resource.getCurrentGatherers()
        });
      }
    }

    // Find idle AI workers and count workers assigned to each resource
    const units = this.coordinator.getCachedUnits();
    const idleWorkers: number[] = [];
    const workerStates: Record<string, number> = {};
    const workersMovingToResource: Map<number, number> = new Map();

    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable');
      const unit = entity.get<Unit>('Unit');
      const health = entity.get<Health>('Health');

      if (!selectable || !unit || !health) continue;
      if (selectable.playerId !== ai.playerId) continue;
      if (!unit.isWorker) continue;
      if (health.isDead()) continue;

      workerStates[unit.state] = (workerStates[unit.state] || 0) + 1;

      if (unit.gatherTargetId !== null && (unit.state === 'moving' || unit.state === 'gathering')) {
        const count = workersMovingToResource.get(unit.gatherTargetId) || 0;
        workersMovingToResource.set(unit.gatherTargetId, count + 1);
      }

      const isIdle = unit.state === 'idle';
      const isMovingNoTarget = unit.state === 'moving' &&
                               unit.targetX === null &&
                               unit.targetY === null &&
                               unit.gatherTargetId === null;

      if (isIdle || isMovingNoTarget) {
        idleWorkers.push(entity.id);
      }
    }

    // Update worker counts with workers moving to each resource
    for (const refinery of refineries) {
      const movingCount = workersMovingToResource.get(refinery.resourceEntityId) || 0;
      refinery.currentWorkers = Math.max(refinery.currentWorkers, movingCount);
    }

    for (const mineral of nearbyMinerals) {
      const movingCount = workersMovingToResource.get(mineral.entityId) || 0;
      mineral.currentWorkers = Math.max(mineral.currentWorkers, movingCount);
    }

    if (nearbyMinerals.length === 0 && refineries.length === 0) return;

    // Debug log periodically
    if (this.game.getCurrentTick() % 200 === 0) {
      const statesStr = Object.entries(workerStates).map(([k, v]) => `${k}:${v}`).join(', ');
      const totalMineralWorkers = nearbyMinerals.reduce((sum, m) => sum + m.currentWorkers, 0);
      const totalGasWorkers = refineries.reduce((sum, r) => sum + r.currentWorkers, 0);
      debugAI.log(`[AIEconomy] ${ai.playerId}: workers=[${statesStr}], idle=${idleWorkers.length}, minerals=${totalMineralWorkers}/${nearbyMinerals.length * OPTIMAL_WORKERS_PER_MINERAL}, gas=${totalGasWorkers}/${refineries.length * OPTIMAL_WORKERS_PER_VESPENE}`);
    }

    // Sort minerals by workers first (fewest first), then distance
    nearbyMinerals.sort((a, b) => {
      if (a.currentWorkers !== b.currentWorkers) {
        return a.currentWorkers - b.currentWorkers;
      }
      return a.distance - b.distance;
    });

    // Pre-compute closest mineral for fallback case
    const closestMineral = nearbyMinerals.length > 0
      ? nearbyMinerals.reduce((closest, m) => m.distance < closest.distance ? m : closest)
      : null;

    // Sort refineries by current workers
    refineries.sort((a, b) => a.currentWorkers - b.currentWorkers);

    // Track indices into sorted arrays
    let gasIndex = 0;
    let mineralIndex = 0;
    let oversatIndex = 0;

    // Assign idle workers using optimal saturation
    for (const workerId of idleWorkers) {
      // Priority 1: Fill undersaturated gas (vespene is more valuable)
      while (gasIndex < refineries.length && refineries[gasIndex].currentWorkers >= OPTIMAL_WORKERS_PER_VESPENE) {
        gasIndex++;
      }
      if (gasIndex < refineries.length) {
        const undersaturatedGas = refineries[gasIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedGas.resourceEntityId,
        });
        undersaturatedGas.currentWorkers++;
        continue;
      }

      // Priority 2: Fill undersaturated minerals (patches with < 2 workers)
      while (mineralIndex < nearbyMinerals.length && nearbyMinerals[mineralIndex].currentWorkers >= OPTIMAL_WORKERS_PER_MINERAL) {
        mineralIndex++;
      }
      if (mineralIndex < nearbyMinerals.length) {
        const undersaturatedMineral = nearbyMinerals[mineralIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: undersaturatedMineral.entityId,
        });
        undersaturatedMineral.currentWorkers++;
        continue;
      }

      // Priority 3: If all minerals are at optimal, allow 3rd worker
      while (oversatIndex < nearbyMinerals.length && nearbyMinerals[oversatIndex].currentWorkers >= 3) {
        oversatIndex++;
      }
      if (oversatIndex < nearbyMinerals.length) {
        const mineralWithRoom = nearbyMinerals[oversatIndex];
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: mineralWithRoom.entityId,
        });
        mineralWithRoom.currentWorkers++;
        continue;
      }

      // Fallback: assign to closest mineral
      if (closestMineral) {
        this.game.eventBus.emit('command:gather', {
          entityIds: [workerId],
          targetEntityId: closestMineral.entityId,
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
