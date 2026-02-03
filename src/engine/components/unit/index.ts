/**
 * Unit Component
 *
 * Composes the full Unit class from UnitCore and mixins.
 * This file exports the complete Unit class with all functionality.
 */

import { UnitCore } from './UnitCore';
import { BuffMixin } from './BuffMixin';
import { TransportMixin } from './TransportMixin';
import { CloakMixin } from './CloakMixin';
import { SubmarineMixin } from './SubmarineMixin';
import { TransformMixin } from './TransformMixin';
import { HealRepairMixin } from './HealRepairMixin';
import { WorkerMixin } from './WorkerMixin';
import { CommandQueueMixin } from './CommandQueueMixin';
import { CombatMixin } from './CombatMixin';
import type { UnitDefinition, UnitFields, UnitMethods } from './types';

// Re-export all types
export * from './types';

/**
 * Compose all mixins onto UnitCore to create the full Unit class.
 *
 * Mixin order matters for method resolution:
 * 1. UnitCore - Base identity, movement, collision
 * 2. BuffMixin - Buff tracking (needed by others for getEffectiveSpeed etc)
 * 3. CloakMixin - Cloak/detection (needed by SubmarineMixin)
 * 4. SubmarineMixin - Submarine mechanics (uses cloak, buff)
 * 5. TransportMixin - Transport/carrier mechanics
 * 6. WorkerMixin - Resource gathering and construction
 * 7. HealRepairMixin - Healing and repair (needs worker fields)
 * 8. CommandQueueMixin - Command queue and patrol
 * 9. CombatMixin - Combat and attack targeting
 * 10. TransformMixin - Mode transformation (modifies combat stats)
 */

// Build the composed class step by step
const WithBuff = BuffMixin(UnitCore);
const WithCloak = CloakMixin(WithBuff);
const WithSubmarine = SubmarineMixin(WithCloak);
const WithTransport = TransportMixin(WithSubmarine);
const WithWorker = WorkerMixin(WithTransport);
const WithHealRepair = HealRepairMixin(WithWorker);
const WithCommandQueue = CommandQueueMixin(WithHealRepair);
const WithCombat = CombatMixin(WithCommandQueue);
const WithTransform = TransformMixin(WithCombat);

/**
 * Complete Unit data type for type utilities like Partial<UnitData>.
 * This type includes all properties from UnitFields, enabling proper
 * inference for type operations.
 *
 * Use this for type annotations where you need partial unit data:
 *   const partialUnit: Partial<UnitData> = { isWorker: true };
 */
export type UnitData = UnitFields;

/**
 * Complete Unit interface combining all properties and methods.
 * This type includes all properties from UnitFields and all methods from
 * UnitMethods, providing a complete type for the Unit class.
 */
export type UnitInterface = UnitFields & UnitMethods;

/**
 * Internal interface for mixin initialization methods.
 * These are protected methods from the mixin chain that need to be callable
 * from the Unit constructor.
 */
interface MixinInitializers {
  initializeBuffFields(definition: UnitDefinition): void;
  initializeCloakFields(definition: UnitDefinition): void;
  initializeSubmarineFields(definition: UnitDefinition): void;
  initializeTransportFields(definition: UnitDefinition): void;
  initializeWorkerFields(definition: UnitDefinition): void;
  initializeHealRepairFields(definition: UnitDefinition): void;
  initializeCommandQueueFields(definition: UnitDefinition): void;
  initializeCombatFields(definition: UnitDefinition): void;
  initializeTransformFields(definition: UnitDefinition): void;
}

/**
 * Complete Unit class with all functionality composed from mixins.
 *
 * This class maintains full backward compatibility with the original Unit class.
 * All 43+ importing files continue to work without modification.
 *
 * The companion interface declaration above ensures all properties are properly
 * typed for TypeScript utilities like Partial<Unit>.
 */
export class Unit extends WithTransform {
  constructor(definition: UnitDefinition) {
    super(definition);

    // Initialize all mixin fields from definition
    // Order matches mixin application order
    // Use type assertion to access protected mixin initializers
    const self = this as unknown as MixinInitializers;
    self.initializeBuffFields(definition);
    self.initializeCloakFields(definition);
    self.initializeSubmarineFields(definition);
    self.initializeTransportFields(definition);
    self.initializeWorkerFields(definition);
    self.initializeHealRepairFields(definition);
    self.initializeCommandQueueFields(definition);
    self.initializeCombatFields(definition);
    self.initializeTransformFields(definition);
  }

  /**
   * Set move target with assault mode clearing
   */
  public setMoveTarget(x: number, y: number, preserveState: boolean = false): void {
    this.targetX = x;
    this.targetY = y;
    if (!preserveState) {
      this.state = 'moving';
    }
    this.targetEntityId = null;
    // RTS-style: Regular move clears assault mode (explicit move command overrides attack-move)
    this.assaultDestination = null;
    this.isInAssaultMode = false;
    this.assaultIdleTicks = 0;
  }

  /**
   * Clear all targets including attack target
   */
  public clearTarget(): void {
    this.targetX = null;
    this.targetY = null;
    this.targetEntityId = null;
    this.path = [];
    this.pathIndex = 0;
    this.state = 'idle';
    this.currentSpeed = 0;
  }

  /**
   * Stop the unit and clear all state including command queue
   */
  public stop(): void {
    this.clearTarget();
    this.commandQueue = [];
    this.patrolPoints = [];
    this.isHoldingPosition = false;
    this.currentSpeed = 0;
    // RTS-style: Explicit stop clears assault mode
    this.assaultDestination = null;
    this.isInAssaultMode = false;
    this.assaultIdleTicks = 0;
  }
}
