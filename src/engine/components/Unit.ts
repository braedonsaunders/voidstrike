/**
 * Unit Component - Facade
 *
 * This file re-exports the Unit class and all related types from the modular
 * implementation in ./unit/. This ensures backward compatibility with all
 * existing imports.
 *
 * The Unit class has been refactored from a 919-line god class into focused
 * mixins for better maintainability:
 *
 * - UnitCore: Base identity, movement, collision
 * - BuffMixin: Buff/debuff tracking and effects
 * - CloakMixin: Cloak and detection mechanics
 * - SubmarineMixin: Submarine submerge/surface
 * - TransportMixin: Unit transport/carrier
 * - WorkerMixin: Resource gathering and construction
 * - HealRepairMixin: Healing and repair capabilities
 * - CommandQueueMixin: Command queue and patrol
 * - CombatMixin: Combat targeting and attacks
 * - TransformMixin: Mode transformation
 */

export * from './unit/types';

// Use the explicit index path to avoid case-insensitive filesystem resolution
// confusing this facade (`Unit.ts`) with the `unit/` directory on macOS.
export { Unit } from './unit/index';
export type { UnitData, UnitInterface } from './unit/index';
