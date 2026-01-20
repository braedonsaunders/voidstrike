/**
 * AI Systems Index
 *
 * Exports all AI-related systems for easy importing.
 */

// Core behavior tree system
export * from './BehaviorTree';
export * from './UnitBehaviors';

// AI worker manager
export * from './AIWorkerManager';

// Strategic AI systems
export { InfluenceMap, type ThreatAnalysis, type InfluenceConfig } from './InfluenceMap';
export { PositionalAnalysis, type StrategicPosition, type AttackPath, type PositionType } from './PositionalAnalysis';
export { ScoutingMemory, type EnemyIntel, type ScoutedBuilding, type StrategicInference, type InferredStrategy } from './ScoutingMemory';

// Tactical AI systems
export { FormationControl, type FormationType, type FormationSlot, type ArmyGroup, type UnitRole } from './FormationControl';
export { RetreatCoordination, type RetreatOrder, type RetreatState, type GroupRetreatStatus } from './RetreatCoordination';
export { AbilityAI, type AbilityDecision, executeAbilityDecision } from './AbilityAI';

// Economic AI systems
export { WorkerDistribution, type BaseSaturation, type WorkerTransfer } from './WorkerDistribution';
