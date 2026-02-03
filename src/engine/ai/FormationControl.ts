/**
 * Formation Control System for RTS AI
 *
 * Manages army positioning and formations:
 * - Concave formations when engaging (maximize DPS)
 * - Ranged units behind melee
 * - Spread to avoid splash damage
 * - Army grouping and cohesion
 */

import { World } from '../ecs/World';
import { Transform } from '../components/Transform';
import { Unit } from '../components/Unit';
import { Health } from '../components/Health';
import { Selectable } from '../components/Selectable';
import { distance } from '@/utils/math';
// UNIT_DEFINITIONS not needed - we use unit component data directly

/**
 * Formation types
 */
export type FormationType =
  | 'none' // No formation
  | 'line' // Simple line formation
  | 'concave' // Arc formation facing enemy
  | 'box' // Defensive box
  | 'spread' // Spread out (anti-splash)
  | 'column'; // Column for movement

/**
 * Unit role for positioning
 */
export type UnitRole = 'melee' | 'ranged' | 'siege' | 'support' | 'air';

/**
 * Formation assignment for a unit
 */
export interface FormationSlot {
  entityId: number;
  role: UnitRole;
  targetPosition: { x: number; y: number };
  priority: number; // Lower = closer to front
}

/**
 * Army group for coordinated movement
 */
export interface ArmyGroup {
  id: string;
  units: number[]; // Entity IDs
  center: { x: number; y: number };
  formation: FormationType;
  facing: { x: number; y: number };
  slots: FormationSlot[];
}

/**
 * Configuration for formations
 */
export interface FormationConfig {
  /** Spacing between units */
  unitSpacing: number;
  /** Max concave arc angle (radians) */
  maxConcaveAngle: number;
  /** Distance ranged should stay behind melee */
  rangedOffset: number;
  /** Extra spread for splash avoidance */
  splashSpread: number;
  /** Max formation width */
  maxWidth: number;
}

const DEFAULT_CONFIG: FormationConfig = {
  unitSpacing: 1.5,
  maxConcaveAngle: Math.PI * 0.6, // ~108 degrees
  rangedOffset: 3,
  splashSpread: 2.5,
  maxWidth: 30,
};

/**
 * Formation Control - Manages army positioning
 */
export class FormationControl {
  private config: FormationConfig;
  private groups: Map<string, ArmyGroup> = new Map();
  private groupIdCounter: number = 0;

  constructor(config?: Partial<FormationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new army group from units
   */
  public createGroup(world: World, unitIds: number[], playerId: string): string {
    const id = `group_${this.groupIdCounter++}`;

    // Validate and filter units
    const validUnits: number[] = [];
    let centerX = 0;
    let centerY = 0;

    for (const entityId of unitIds) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      if (!unit || !transform || !health || !selectable) continue;
      if (selectable.playerId !== playerId) continue;
      if (health.isDead()) continue;
      if (unit.isWorker) continue;

      validUnits.push(entityId);
      centerX += transform.x;
      centerY += transform.y;
    }

    if (validUnits.length === 0) return '';

    centerX /= validUnits.length;
    centerY /= validUnits.length;

    const group: ArmyGroup = {
      id,
      units: validUnits,
      center: { x: centerX, y: centerY },
      formation: 'none',
      facing: { x: 0, y: -1 }, // Default facing up
      slots: [],
    };

    this.groups.set(id, group);
    return id;
  }

  /**
   * Update group center and facing
   */
  public updateGroup(world: World, groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    // Remove dead units
    const aliveUnits: number[] = [];
    let centerX = 0;
    let centerY = 0;

    for (const entityId of group.units) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const health = entity.get<Health>('Health');
      const transform = entity.get<Transform>('Transform');
      if (!health || !transform || health.isDead()) continue;

      aliveUnits.push(entityId);
      centerX += transform.x;
      centerY += transform.y;
    }

    group.units = aliveUnits;

    if (aliveUnits.length > 0) {
      group.center = {
        x: centerX / aliveUnits.length,
        y: centerY / aliveUnits.length,
      };
    }
  }

  /**
   * Calculate concave formation facing enemy
   */
  public calculateConcaveFormation(
    world: World,
    groupId: string,
    enemyCenter: { x: number; y: number }
  ): FormationSlot[] {
    const group = this.groups.get(groupId);
    if (!group || group.units.length === 0) return [];

    // Calculate facing direction
    const dx = enemyCenter.x - group.center.x;
    const dy = enemyCenter.y - group.center.y;
    const dist = distance(group.center.x, group.center.y, enemyCenter.x, enemyCenter.y);
    const facing = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: -1 };
    group.facing = facing;

    // Classify units by role
    const unitsByRole: Map<UnitRole, Array<{ entityId: number; range: number; speed: number }>> = new Map();

    for (const entityId of group.units) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const role = this.getUnitRole(unit);
      if (!unitsByRole.has(role)) {
        unitsByRole.set(role, []);
      }
      unitsByRole.get(role)!.push({
        entityId,
        range: unit.attackRange,
        speed: unit.speed,
      });
    }

    const slots: FormationSlot[] = [];

    // Position melee units at front in arc
    const meleeUnits = unitsByRole.get('melee') || [];
    const arcSlots = this.calculateArcPositions(
      group.center,
      facing,
      meleeUnits.length,
      4 // Distance from center to front
    );

    for (let i = 0; i < meleeUnits.length; i++) {
      slots.push({
        entityId: meleeUnits[i].entityId,
        role: 'melee',
        targetPosition: arcSlots[i],
        priority: 1,
      });
    }

    // Position ranged units behind in wider arc
    const rangedUnits = unitsByRole.get('ranged') || [];
    const rangedArcSlots = this.calculateArcPositions(
      group.center,
      facing,
      rangedUnits.length,
      -this.config.rangedOffset // Behind center
    );

    for (let i = 0; i < rangedUnits.length; i++) {
      slots.push({
        entityId: rangedUnits[i].entityId,
        role: 'ranged',
        targetPosition: rangedArcSlots[i],
        priority: 2,
      });
    }

    // Position siege units further back
    const siegeUnits = unitsByRole.get('siege') || [];
    const siegeSlots = this.calculateArcPositions(
      group.center,
      facing,
      siegeUnits.length,
      -this.config.rangedOffset * 2
    );

    for (let i = 0; i < siegeUnits.length; i++) {
      slots.push({
        entityId: siegeUnits[i].entityId,
        role: 'siege',
        targetPosition: siegeSlots[i],
        priority: 3,
      });
    }

    // Air units hover above center
    const airUnits = unitsByRole.get('air') || [];
    const airSlots = this.calculateLinePositions(
      group.center,
      facing,
      airUnits.length,
      2 // Slightly behind
    );

    for (let i = 0; i < airUnits.length; i++) {
      slots.push({
        entityId: airUnits[i].entityId,
        role: 'air',
        targetPosition: airSlots[i],
        priority: 2,
      });
    }

    group.slots = slots;
    group.formation = 'concave';

    return slots;
  }

  /**
   * Calculate arc positions for concave formation
   */
  private calculateArcPositions(
    center: { x: number; y: number },
    facing: { x: number; y: number },
    count: number,
    distanceOffset: number
  ): Array<{ x: number; y: number }> {
    if (count === 0) return [];
    if (count === 1) {
      return [{
        x: center.x + facing.x * distanceOffset,
        y: center.y + facing.y * distanceOffset,
      }];
    }

    const positions: Array<{ x: number; y: number }> = [];

    // Calculate base angle from facing
    const baseAngle = Math.atan2(facing.y, facing.x);

    // Arc spans maxConcaveAngle
    const arcAngle = Math.min(this.config.maxConcaveAngle, count * 0.2);
    const startAngle = baseAngle - arcAngle / 2;
    const angleStep = arcAngle / (count - 1);

    // Distance from center
    const radius = Math.max(3, count * this.config.unitSpacing * 0.3) + distanceOffset;

    for (let i = 0; i < count; i++) {
      const angle = startAngle + angleStep * i;
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }

    return positions;
  }

  /**
   * Calculate line positions (perpendicular to facing)
   */
  private calculateLinePositions(
    center: { x: number; y: number },
    facing: { x: number; y: number },
    count: number,
    distanceOffset: number
  ): Array<{ x: number; y: number }> {
    if (count === 0) return [];

    const positions: Array<{ x: number; y: number }> = [];

    // Perpendicular direction
    const perpX = -facing.y;
    const perpY = facing.x;

    // Line center offset by distance
    const lineCenter = {
      x: center.x - facing.x * distanceOffset,
      y: center.y - facing.y * distanceOffset,
    };

    const totalWidth = (count - 1) * this.config.unitSpacing;
    const startOffset = -totalWidth / 2;

    for (let i = 0; i < count; i++) {
      const offset = startOffset + i * this.config.unitSpacing;
      positions.push({
        x: lineCenter.x + perpX * offset,
        y: lineCenter.y + perpY * offset,
      });
    }

    return positions;
  }

  /**
   * Calculate spread formation (anti-splash)
   */
  public calculateSpreadFormation(
    world: World,
    groupId: string
  ): FormationSlot[] {
    const group = this.groups.get(groupId);
    if (!group || group.units.length === 0) return [];

    const slots: FormationSlot[] = [];
    const count = group.units.length;

    // Arrange in a grid with extra spacing
    const gridSize = Math.ceil(Math.sqrt(count));
    const spacing = this.config.unitSpacing + this.config.splashSpread;

    const totalWidth = (gridSize - 1) * spacing;
    const startX = group.center.x - totalWidth / 2;
    const startY = group.center.y - totalWidth / 2;

    for (let i = 0; i < count; i++) {
      const entity = world.getEntity(group.units[i]);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const gridX = i % gridSize;
      const gridY = Math.floor(i / gridSize);

      slots.push({
        entityId: group.units[i],
        role: this.getUnitRole(unit),
        targetPosition: {
          x: startX + gridX * spacing,
          y: startY + gridY * spacing,
        },
        priority: 1,
      });
    }

    group.slots = slots;
    group.formation = 'spread';

    return slots;
  }

  /**
   * Calculate box formation (defensive)
   */
  public calculateBoxFormation(
    world: World,
    groupId: string
  ): FormationSlot[] {
    const group = this.groups.get(groupId);
    if (!group || group.units.length === 0) return [];

    // Classify units
    const meleeUnits: number[] = [];
    const rangedUnits: number[] = [];
    const otherUnits: number[] = [];

    for (const entityId of group.units) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const role = this.getUnitRole(unit);
      if (role === 'melee') {
        meleeUnits.push(entityId);
      } else if (role === 'ranged' || role === 'siege') {
        rangedUnits.push(entityId);
      } else {
        otherUnits.push(entityId);
      }
    }

    const slots: FormationSlot[] = [];

    // Melee units form the outer ring
    const outerRing = meleeUnits.length;
    const ringRadius = Math.max(3, outerRing * this.config.unitSpacing / (2 * Math.PI));

    for (let i = 0; i < outerRing; i++) {
      const angle = (i / outerRing) * 2 * Math.PI;
      slots.push({
        entityId: meleeUnits[i],
        role: 'melee',
        targetPosition: {
          x: group.center.x + Math.cos(angle) * ringRadius,
          y: group.center.y + Math.sin(angle) * ringRadius,
        },
        priority: 1,
      });
    }

    // Ranged units in center
    const innerCount = rangedUnits.length + otherUnits.length;
    const innerGridSize = Math.ceil(Math.sqrt(innerCount));
    const innerSpacing = this.config.unitSpacing;
    const innerWidth = (innerGridSize - 1) * innerSpacing;

    let innerIndex = 0;
    for (const entityId of [...rangedUnits, ...otherUnits]) {
      const entity = world.getEntity(entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      const gridX = innerIndex % innerGridSize;
      const gridY = Math.floor(innerIndex / innerGridSize);

      slots.push({
        entityId,
        role: this.getUnitRole(unit),
        targetPosition: {
          x: group.center.x - innerWidth / 2 + gridX * innerSpacing,
          y: group.center.y - innerWidth / 2 + gridY * innerSpacing,
        },
        priority: 2,
      });
      innerIndex++;
    }

    group.slots = slots;
    group.formation = 'box';

    return slots;
  }

  /**
   * Get unit role for positioning
   */
  private getUnitRole(unit: Unit): UnitRole {
    // Air units
    if (unit.isFlying) return 'air';

    // Check attack range
    const range = unit.attackRange;

    // Siege units (very long range, usually can't move and shoot)
    if (range >= 7) return 'siege';

    // Ranged units
    if (range >= 4) return 'ranged';

    // Support units (healers, no attack)
    if (unit.canHeal || unit.attackDamage === 0) return 'support';

    // Default to melee
    return 'melee';
  }

  /**
   * Apply formation positions to units
   */
  public applyFormation(world: World, groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    for (const slot of group.slots) {
      const entity = world.getEntity(slot.entityId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      if (!unit) continue;

      // Set move target to formation position
      unit.setMoveTarget(slot.targetPosition.x, slot.targetPosition.y, true);
    }
  }

  /**
   * Check if group is in formation
   */
  public isInFormation(world: World, groupId: string, tolerance: number = 2): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.slots.length === 0) return true;

    for (const slot of group.slots) {
      const entity = world.getEntity(slot.entityId);
      if (!entity) continue;

      const transform = entity.get<Transform>('Transform');
      if (!transform) continue;

      if (distance(transform.x, transform.y, slot.targetPosition.x, slot.targetPosition.y) > tolerance) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get group by ID
   */
  public getGroup(groupId: string): ArmyGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Delete a group
   */
  public deleteGroup(groupId: string): void {
    this.groups.delete(groupId);
  }

  /**
   * Get all groups for a player
   */
  public getPlayerGroups(world: World, playerId: string): ArmyGroup[] {
    const playerGroups: ArmyGroup[] = [];

    for (const group of this.groups.values()) {
      if (group.units.length === 0) continue;

      // Check first unit's owner
      const entity = world.getEntity(group.units[0]);
      if (!entity) continue;

      const selectable = entity.get<Selectable>('Selectable');
      if (selectable?.playerId === playerId) {
        playerGroups.push(group);
      }
    }

    return playerGroups;
  }

  /**
   * Calculate optimal engagement position for army
   */
  public calculateEngagementPosition(
    armyCenter: { x: number; y: number },
    enemyCenter: { x: number; y: number },
    preferredRange: number
  ): { x: number; y: number } {
    const dx = enemyCenter.x - armyCenter.x;
    const dy = enemyCenter.y - armyCenter.y;
    const dist = distance(armyCenter.x, armyCenter.y, enemyCenter.x, enemyCenter.y);

    if (dist <= preferredRange) {
      // Already in range
      return armyCenter;
    }

    // Move to preferred range
    const moveDistance = dist - preferredRange;
    const ux = dx / dist;
    const uy = dy / dist;

    return {
      x: armyCenter.x + ux * moveDistance,
      y: armyCenter.y + uy * moveDistance,
    };
  }

  /**
   * Clear all groups
   */
  public clear(): void {
    this.groups.clear();
  }
}
