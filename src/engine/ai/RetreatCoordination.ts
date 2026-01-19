/**
 * Retreat Coordination System for RTS AI
 *
 * Manages coordinated retreats:
 * - Group retreat to rally points
 * - Re-engagement when reinforced
 * - Kiting during retreat
 * - Avoiding cut-off/surrounded situations
 *
 * Key behaviors:
 * - Retreat toward reinforcements
 * - Re-engage when army strength recovers
 * - Cover low-health units
 */

import { Entity } from '../ecs/Entity';
import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { InfluenceMap } from './InfluenceMap';

/**
 * Retreat state for a unit
 */
export type RetreatState =
  | 'none' // Not retreating
  | 'retreating' // Moving to rally
  | 'regrouping' // At rally, waiting for others
  | 'covering' // Covering retreating allies
  | 're-engaging'; // Turning back to fight

/**
 * Retreat order for a unit
 */
export interface RetreatOrder {
  entityId: number;
  state: RetreatState;
  rallyPoint: { x: number; y: number };
  /** Tick when retreat started */
  startTick: number;
  /** Tick when we can consider re-engaging */
  reengageAfterTick: number;
  /** Original health when retreat started */
  startHealthPercent: number;
}

/**
 * Group retreat status
 */
export interface GroupRetreatStatus {
  isRetreating: boolean;
  unitsRetreating: number;
  unitsAtRally: number;
  totalUnits: number;
  rallyPoint: { x: number; y: number };
  averageHealth: number;
  canReengage: boolean;
}

/**
 * Configuration for retreat behavior
 */
export interface RetreatConfig {
  /** Health threshold to start retreating (0-1) */
  healthThreshold: number;
  /** Army strength ratio to trigger group retreat */
  strengthRetreatRatio: number;
  /** Strength ratio to re-engage */
  reengageRatio: number;
  /** Min ticks before considering re-engage */
  minRetreatTicks: number;
  /** Distance to consider "at rally point" */
  rallyTolerance: number;
  /** How far behind front line to set rally */
  rallyDistance: number;
  /** Health recovery to re-engage (0-1 added to current) */
  healthRecoveryThreshold: number;
}

const DEFAULT_CONFIG: RetreatConfig = {
  healthThreshold: 0.25,
  strengthRetreatRatio: 0.6, // Retreat if our strength < 60% of enemy
  reengageRatio: 0.9, // Re-engage when we have 90% of enemy strength
  minRetreatTicks: 60, // ~3 seconds minimum retreat
  rallyTolerance: 4,
  rallyDistance: 15,
  healthRecoveryThreshold: 0.2,
};

/**
 * Retreat Coordination - Manages coordinated army retreats
 */
export class RetreatCoordination {
  private config: RetreatConfig;

  // Per-player retreat state
  private retreatOrders: Map<string, Map<number, RetreatOrder>> = new Map();

  // Rally points per player
  private rallyPoints: Map<string, { x: number; y: number }> = new Map();

  // Group retreat flags
  private groupRetreatActive: Map<string, boolean> = new Map();

  constructor(config?: Partial<RetreatConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update retreat coordination for all units
   */
  public update(
    world: World,
    currentTick: number,
    playerId: string,
    influenceMap: InfluenceMap | null
  ): void {
    // Ensure player has order map
    if (!this.retreatOrders.has(playerId)) {
      this.retreatOrders.set(playerId, new Map());
    }
    const orders = this.retreatOrders.get(playerId)!;

    // Gather army units
    const armyUnits = this.getArmyUnits(world, playerId);
    if (armyUnits.length === 0) {
      this.groupRetreatActive.set(playerId, false);
      return;
    }

    // Calculate army center and health
    let centerX = 0;
    let centerY = 0;
    let totalHealth = 0;
    let totalMaxHealth = 0;

    for (const entity of armyUnits) {
      const transform = entity.get<Transform>('Transform')!;
      const health = entity.get<Health>('Health')!;

      centerX += transform.x;
      centerY += transform.y;
      totalHealth += health.current;
      totalMaxHealth += health.max;
    }

    centerX /= armyUnits.length;
    centerY /= armyUnits.length;

    const avgHealthPercent = totalMaxHealth > 0 ? totalHealth / totalMaxHealth : 1;

    // Determine rally point (toward home base, away from enemy)
    const rallyPoint = this.calculateRallyPoint(
      world,
      playerId,
      { x: centerX, y: centerY },
      influenceMap
    );
    this.rallyPoints.set(playerId, rallyPoint);

    // Check individual unit retreat conditions
    for (const entity of armyUnits) {
      const health = entity.get<Health>('Health')!;
      const healthPercent = health.current / health.max;

      const existingOrder = orders.get(entity.id);

      if (!existingOrder) {
        // Check if unit should start retreating
        if (healthPercent < this.config.healthThreshold) {
          orders.set(entity.id, this.createRetreatOrder(entity.id, rallyPoint, currentTick, healthPercent));
        }
      } else {
        // Update existing retreat order
        this.updateRetreatOrder(world, entity, existingOrder, rallyPoint, currentTick, healthPercent);
      }
    }

    // Check group retreat conditions
    this.checkGroupRetreat(world, playerId, armyUnits, avgHealthPercent, currentTick, rallyPoint);

    // Clean up orders for dead/removed units
    this.cleanupOrders(world, playerId);
  }

  /**
   * Create a new retreat order
   */
  private createRetreatOrder(
    entityId: number,
    rallyPoint: { x: number; y: number },
    currentTick: number,
    healthPercent: number
  ): RetreatOrder {
    return {
      entityId,
      state: 'retreating',
      rallyPoint,
      startTick: currentTick,
      reengageAfterTick: currentTick + this.config.minRetreatTicks,
      startHealthPercent: healthPercent,
    };
  }

  /**
   * Update an existing retreat order
   */
  private updateRetreatOrder(
    world: World,
    entity: Entity,
    order: RetreatOrder,
    rallyPoint: { x: number; y: number },
    currentTick: number,
    healthPercent: number
  ): void {
    const transform = entity.get<Transform>('Transform')!;

    // Update rally point
    order.rallyPoint = rallyPoint;

    // Check distance to rally
    const dx = transform.x - rallyPoint.x;
    const dy = transform.y - rallyPoint.y;
    const distToRally = Math.sqrt(dx * dx + dy * dy);

    // State transitions
    switch (order.state) {
      case 'retreating':
        if (distToRally < this.config.rallyTolerance) {
          order.state = 'regrouping';
        }
        break;

      case 'regrouping':
        // Check re-engage conditions
        if (currentTick >= order.reengageAfterTick) {
          const recovered = healthPercent >= order.startHealthPercent + this.config.healthRecoveryThreshold;
          if (recovered || healthPercent > 0.7) {
            order.state = 're-engaging';
          }
        }
        break;

      case 're-engaging':
        // Clear order when unit is back in fight
        if (distToRally > this.config.rallyDistance * 2) {
          const orders = this.retreatOrders.get(entity.get<Selectable>('Selectable')!.playerId);
          if (orders) {
            orders.delete(entity.id);
          }
        }
        break;
    }
  }

  /**
   * Check if group retreat should be triggered
   */
  private checkGroupRetreat(
    world: World,
    playerId: string,
    armyUnits: Entity[],
    avgHealth: number,
    currentTick: number,
    rallyPoint: { x: number; y: number }
  ): void {
    const orders = this.retreatOrders.get(playerId)!;
    const retreatingCount = Array.from(orders.values()).filter(o => o.state === 'retreating' || o.state === 'regrouping').length;
    const retreatRatio = armyUnits.length > 0 ? retreatingCount / armyUnits.length : 0;

    // Trigger group retreat if too many units are retreating or health is very low
    if (retreatRatio > 0.4 || avgHealth < 0.3) {
      this.groupRetreatActive.set(playerId, true);

      // Order all units to retreat
      for (const entity of armyUnits) {
        if (!orders.has(entity.id)) {
          const health = entity.get<Health>('Health')!;
          orders.set(entity.id, this.createRetreatOrder(
            entity.id,
            rallyPoint,
            currentTick,
            health.current / health.max
          ));
        }
      }
    } else if (retreatRatio < 0.1 && avgHealth > 0.6) {
      // End group retreat when most units are healthy
      this.groupRetreatActive.set(playerId, false);
    }
  }

  /**
   * Calculate rally point for retreat
   */
  private calculateRallyPoint(
    world: World,
    playerId: string,
    armyCenter: { x: number; y: number },
    influenceMap: InfluenceMap | null
  ): { x: number; y: number } {
    // Try to find home base
    const homeBase = this.findHomeBase(world, playerId);

    if (homeBase) {
      // Rally between army and home base
      const dx = homeBase.x - armyCenter.x;
      const dy = homeBase.y - armyCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        const retreatDist = Math.min(this.config.rallyDistance, dist * 0.5);
        return {
          x: armyCenter.x + (dx / dist) * retreatDist,
          y: armyCenter.y + (dy / dist) * retreatDist,
        };
      }
    }

    // Use influence map to find safe direction
    if (influenceMap) {
      const threat = influenceMap.getThreatAnalysis(armyCenter.x, armyCenter.y, playerId);
      if (threat.safeDirection.x !== 0 || threat.safeDirection.y !== 0) {
        return {
          x: armyCenter.x + threat.safeDirection.x * this.config.rallyDistance,
          y: armyCenter.y + threat.safeDirection.y * this.config.rallyDistance,
        };
      }
    }

    // Fallback: retreat toward map center (usually safe)
    return {
      x: armyCenter.x,
      y: armyCenter.y - this.config.rallyDistance, // Default: retreat "up"
    };
  }

  /**
   * Find the player's home base
   */
  private findHomeBase(world: World, playerId: string): { x: number; y: number } | null {
    const buildings = world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');

    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;
      const building = entity.get<import('../components/Building').Building>('Building')!;
      const transform = entity.get<Transform>('Transform')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;

      // Main base building types
      if (['headquarters', 'orbital_station', 'command_center', 'nexus', 'hatchery'].includes(building.buildingId)) {
        return { x: transform.x, y: transform.y };
      }
    }

    return null;
  }

  /**
   * Get army units for a player
   */
  private getArmyUnits(world: World, playerId: string): Entity[] {
    const units: Entity[] = [];
    const entities = world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');

    for (const entity of entities) {
      const unit = entity.get<Unit>('Unit')!;
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      units.push(entity);
    }

    return units;
  }

  /**
   * Clean up orders for dead units
   */
  private cleanupOrders(world: World, playerId: string): void {
    const orders = this.retreatOrders.get(playerId);
    if (!orders) return;

    for (const entityId of orders.keys()) {
      const entity = world.getEntity(entityId);
      if (!entity) {
        orders.delete(entityId);
        continue;
      }

      const health = entity.get<Health>('Health');
      if (!health || health.isDead()) {
        orders.delete(entityId);
      }
    }
  }

  // ==================== PUBLIC API ====================

  /**
   * Get retreat order for a unit
   */
  public getRetreatOrder(playerId: string, entityId: number): RetreatOrder | undefined {
    return this.retreatOrders.get(playerId)?.get(entityId);
  }

  /**
   * Check if unit should be retreating
   */
  public shouldRetreat(playerId: string, entityId: number): boolean {
    const order = this.getRetreatOrder(playerId, entityId);
    if (!order) return false;
    return order.state === 'retreating' || order.state === 'regrouping';
  }

  /**
   * Check if unit should re-engage
   */
  public shouldReengage(playerId: string, entityId: number): boolean {
    const order = this.getRetreatOrder(playerId, entityId);
    if (!order) return true; // Not retreating = can fight
    return order.state === 're-engaging';
  }

  /**
   * Get retreat target for a unit
   */
  public getRetreatTarget(playerId: string, entityId: number): { x: number; y: number } | null {
    const order = this.getRetreatOrder(playerId, entityId);
    if (!order || order.state === 'none' || order.state === 're-engaging') return null;
    return order.rallyPoint;
  }

  /**
   * Get group retreat status
   */
  public getGroupStatus(world: World, playerId: string): GroupRetreatStatus {
    const orders = this.retreatOrders.get(playerId) || new Map();
    const rallyPoint = this.rallyPoints.get(playerId) || { x: 0, y: 0 };
    const isRetreating = this.groupRetreatActive.get(playerId) || false;

    const armyUnits = this.getArmyUnits(world, playerId);
    let atRally = 0;
    let retreating = 0;
    let totalHealth = 0;
    let totalMaxHealth = 0;

    for (const entity of armyUnits) {
      const health = entity.get<Health>('Health')!;
      totalHealth += health.current;
      totalMaxHealth += health.max;

      const order = orders.get(entity.id);
      if (order) {
        if (order.state === 'regrouping') atRally++;
        if (order.state === 'retreating') retreating++;
      }
    }

    const avgHealth = totalMaxHealth > 0 ? totalHealth / totalMaxHealth : 1;

    // Can re-engage if most units are at rally and health is decent
    const canReengage = (atRally + retreating) > 0 &&
                       atRally >= (atRally + retreating) * 0.7 &&
                       avgHealth > 0.6;

    return {
      isRetreating,
      unitsRetreating: retreating,
      unitsAtRally: atRally,
      totalUnits: armyUnits.length,
      rallyPoint,
      averageHealth: avgHealth,
      canReengage,
    };
  }

  /**
   * Force unit to start retreating
   */
  public forceRetreat(playerId: string, entityId: number, rallyPoint: { x: number; y: number }, currentTick: number): void {
    if (!this.retreatOrders.has(playerId)) {
      this.retreatOrders.set(playerId, new Map());
    }

    this.retreatOrders.get(playerId)!.set(entityId, {
      entityId,
      state: 'retreating',
      rallyPoint,
      startTick: currentTick,
      reengageAfterTick: currentTick + this.config.minRetreatTicks,
      startHealthPercent: 1, // Will be updated on next tick
    });
  }

  /**
   * Force all units to re-engage
   */
  public forceReengage(playerId: string): void {
    const orders = this.retreatOrders.get(playerId);
    if (!orders) return;

    for (const order of orders.values()) {
      order.state = 're-engaging';
    }

    this.groupRetreatActive.set(playerId, false);
  }

  /**
   * Cancel retreat for a unit
   */
  public cancelRetreat(playerId: string, entityId: number): void {
    this.retreatOrders.get(playerId)?.delete(entityId);
  }

  /**
   * Get rally point for a player
   */
  public getRallyPoint(playerId: string): { x: number; y: number } | undefined {
    return this.rallyPoints.get(playerId);
  }

  /**
   * Set custom rally point
   */
  public setRallyPoint(playerId: string, point: { x: number; y: number }): void {
    this.rallyPoints.set(playerId, point);
  }

  /**
   * Clear all retreat state
   */
  public clear(): void {
    this.retreatOrders.clear();
    this.rallyPoints.clear();
    this.groupRetreatActive.clear();
  }
}
