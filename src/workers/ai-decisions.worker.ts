/**
 * AI Decisions Web Worker
 *
 * Offloads AI micro decision-making to a separate thread.
 * Handles threat assessment, target prioritization, and micro actions.
 *
 * Messages:
 *   Input:  { type: 'init', config } - Initialize with AI configuration
 *   Input:  { type: 'evaluateMicro', aiUnits, enemyUnits, enemyBuildings, tick } - Compute micro decisions
 *   Output: { type: 'initialized', success }
 *   Output: { type: 'microResult', decisions, tick }
 */

import { distance } from '@/utils/math';

// Debug flag for worker logging (workers can't access UI store)
const _DEBUG = false;

// Unit priority for focus fire (higher = more important to kill)
const DEFAULT_UNIT_PRIORITY: Record<string, number> = {
  // High priority targets
  lifter: 100, // Healers must die first
  colossus: 90, // Heavy damage
  devastator: 85, // Anti-armor
  specter: 80, // Flying harassment
  valkyrie: 75, // Versatile air

  // Medium priority
  breacher: 70, // Good damage
  scorcher: 65, // Area damage
  inferno: 60, // Heavy siege
  trooper: 55, // Basic ranged

  // Low priority
  vanguard: 40, // Basic melee
  engineer: 20, // Worker
};

// Threat assessment weights
const THREAT_WEIGHTS = {
  distance: 1.5,
  damage: 1.0,
  priority: 0.8,
  health: 0.5,
};

// Message types
interface InitMessage {
  type: 'init';
  config: AIWorkerConfig;
}

interface AIWorkerConfig {
  unitPriorities?: Record<string, number>;
  threatWeights?: typeof THREAT_WEIGHTS;
  focusFireThreshold?: number;
  kiteDistanceMultiplier?: number;
}

interface UnitSnapshot {
  id: number;
  x: number;
  y: number;
  playerId: string;
  unitId: string;
  state: string;
  health: number;
  maxHealth: number;
  attackDamage: number;
  attackSpeed: number;
  attackRange: number;
  sightRange: number;
  moveSpeed: number;
  isFlying: boolean;
  isWorker: boolean;
  canAttackGround: boolean;
  canAttackAir: boolean;
  targetEntityId: number | null;
  canTransform?: boolean;
  currentModeIsFlying?: boolean;
}

interface BuildingSnapshot {
  id: number;
  x: number;
  y: number;
  playerId: string;
  buildingId: string;
  health: number;
  maxHealth: number;
  width: number;
  height: number;
}

interface EvaluateMicroMessage {
  type: 'evaluateMicro';
  aiPlayerId: string;
  aiUnits: UnitSnapshot[];
  enemyUnits: UnitSnapshot[];
  enemyBuildings: BuildingSnapshot[];
  friendlyBasePosition: { x: number; y: number } | null;
  mapWidth: number;
  mapHeight: number;
  tick: number;
}

type WorkerMessage = InitMessage | EvaluateMicroMessage;

// Decision types returned to main thread
interface MicroDecision {
  unitId: number;
  action: 'attack' | 'kite' | 'retreat' | 'transform' | 'none';
  targetId?: number;
  targetPosition?: { x: number; y: number };
  targetMode?: string;
  threatScore: number;
}

interface ThreatInfo {
  entityId: number;
  threatScore: number;
  distance: number;
  healthPercent: number;
  dps: number;
  unitType: string;
  isFlying: boolean;
}

// State
let config: AIWorkerConfig = {};
let unitPriorities: Record<string, number> = DEFAULT_UNIT_PRIORITY;
let threatWeights = THREAT_WEIGHTS;
let focusFireThreshold = 0.3;
let kiteDistanceMultiplier = 0.6;
let initialized = false;

/**
 * Initialize worker configuration
 */
function init(workerConfig: AIWorkerConfig): boolean {
  try {
    config = workerConfig;
    unitPriorities = workerConfig.unitPriorities || DEFAULT_UNIT_PRIORITY;
    threatWeights = workerConfig.threatWeights || THREAT_WEIGHTS;
    focusFireThreshold = workerConfig.focusFireThreshold ?? 0.3;
    kiteDistanceMultiplier = workerConfig.kiteDistanceMultiplier ?? 0.6;
    initialized = true;
    return true;
  } catch (error) {
    console.error('[AIWorker] Init failed:', error);
    return false;
  }
}

/**
 * Assess threats for a unit and find best target
 */
function assessThreats(
  unit: UnitSnapshot,
  enemies: UnitSnapshot[],
  enemyBuildings: BuildingSnapshot[]
): { threats: ThreatInfo[]; bestTarget: number | null; threatScore: number } {
  const threats: ThreatInfo[] = [];
  const threatRange = unit.sightRange * 1.2;

  let maxThreatScore = 0;
  let bestTargetId: number | null = null;

  for (const enemy of enemies) {
    // Skip dead enemies
    if (enemy.health <= 0) continue;

    // Skip targets this unit can't attack
    if (enemy.isFlying && !unit.canAttackAir) continue;
    if (!enemy.isFlying && !unit.canAttackGround) continue;

    const dist = distance(unit.x, unit.y, enemy.x, enemy.y);
    if (dist > threatRange) continue;

    const dps = enemy.attackDamage * enemy.attackSpeed;
    const priority = unitPriorities[enemy.unitId] || 50;
    const healthPercent = enemy.health / enemy.maxHealth;

    // Threat score calculation
    const distanceFactor = Math.max(0, 1 - dist / threatRange) * threatWeights.distance;
    const damageFactor = (dps / 20) * threatWeights.damage;
    const priorityFactor = (priority / 100) * threatWeights.priority;
    const healthFactor = (1 + (1 - healthPercent)) * threatWeights.health;

    const threatScore = (damageFactor + priorityFactor) * distanceFactor * healthFactor;

    threats.push({
      entityId: enemy.id,
      threatScore,
      distance: dist,
      healthPercent,
      dps,
      unitType: enemy.unitId,
      isFlying: enemy.isFlying,
    });

    // Track best target
    if (threatScore > maxThreatScore) {
      maxThreatScore = threatScore;
      bestTargetId = enemy.id;
    }
  }

  // Also consider buildings if no good unit targets
  if (!bestTargetId && unit.canAttackGround) {
    let closestBuildingDist = Infinity;
    for (const building of enemyBuildings) {
      if (building.health <= 0) continue;
      const dist = distance(unit.x, unit.y, building.x, building.y);
      if (dist < closestBuildingDist) {
        closestBuildingDist = dist;
        bestTargetId = building.id;
      }
    }
  }

  return { threats, bestTarget: bestTargetId, threatScore: maxThreatScore };
}

/**
 * Determine if unit should kite (ranged unit with close enemies)
 */
function shouldKite(
  unit: UnitSnapshot,
  enemies: UnitSnapshot[]
): { shouldKite: boolean; kiteFromX?: number; kiteFromY?: number } {
  // Only ranged units should kite
  if (unit.attackRange < 3) return { shouldKite: false };

  // Find closest enemy
  let closestEnemy: UnitSnapshot | null = null;
  let closestDist = Infinity;

  for (const enemy of enemies) {
    if (enemy.health <= 0) continue;
    // Skip targets this unit can't attack
    if (enemy.isFlying && !unit.canAttackAir) continue;
    if (!enemy.isFlying && !unit.canAttackGround) continue;

    const dist = distance(unit.x, unit.y, enemy.x, enemy.y);
    if (dist < closestDist) {
      closestDist = dist;
      closestEnemy = enemy;
    }
  }

  if (!closestEnemy) return { shouldKite: false };

  // Kite if enemy is within attack range (can be attacked but getting close)
  const kiteThreshold = unit.attackRange * 0.7;
  if (closestDist < kiteThreshold) {
    return {
      shouldKite: true,
      kiteFromX: closestEnemy.x,
      kiteFromY: closestEnemy.y,
    };
  }

  return { shouldKite: false };
}

/**
 * Calculate kite position (move away from threat)
 */
function calculateKitePosition(
  unit: UnitSnapshot,
  kiteFromX: number,
  kiteFromY: number,
  mapWidth: number,
  mapHeight: number
): { x: number; y: number } {
  const dx = unit.x - kiteFromX;
  const dy = unit.y - kiteFromY;
  const dist = distance(unit.x, unit.y, kiteFromX, kiteFromY);

  if (dist < 0.1) {
    // Random direction if too close
    const angle = Math.random() * Math.PI * 2;
    return {
      x: Math.max(2, Math.min(mapWidth - 2, unit.x + Math.cos(angle) * unit.attackRange * kiteDistanceMultiplier)),
      y: Math.max(2, Math.min(mapHeight - 2, unit.y + Math.sin(angle) * unit.attackRange * kiteDistanceMultiplier)),
    };
  }

  const kiteDistance = unit.attackRange * kiteDistanceMultiplier;
  return {
    x: Math.max(2, Math.min(mapWidth - 2, unit.x + (dx / dist) * kiteDistance)),
    y: Math.max(2, Math.min(mapHeight - 2, unit.y + (dy / dist) * kiteDistance)),
  };
}

/**
 * Determine if unit should retreat (low health, outnumbered)
 */
function shouldRetreat(
  unit: UnitSnapshot,
  threats: ThreatInfo[],
  friendlyBasePosition: { x: number; y: number } | null
): boolean {
  if (!friendlyBasePosition) return false;

  const healthPercent = unit.health / unit.maxHealth;

  // Retreat if low health and multiple threats
  if (healthPercent < 0.3 && threats.length >= 2) {
    return true;
  }

  // Retreat if very low health
  if (healthPercent < 0.15) {
    return true;
  }

  return false;
}

/**
 * Determine if transformable unit should transform (Valkyrie-like units)
 */
function shouldTransform(
  unit: UnitSnapshot,
  enemies: UnitSnapshot[]
): { shouldTransform: boolean; targetMode?: string } {
  if (!unit.canTransform) return { shouldTransform: false };

  const SCAN_RANGE = 15;
  let nearbyAirEnemies = 0;
  let nearbyGroundEnemies = 0;
  let airThreatScore = 0;
  let groundThreatScore = 0;

  for (const enemy of enemies) {
    if (enemy.health <= 0) continue;

    const dist = distance(unit.x, unit.y, enemy.x, enemy.y);
    if (dist > SCAN_RANGE) continue;

    const distanceWeight = Math.max(0, 1 - dist / SCAN_RANGE);
    const dps = enemy.attackDamage * enemy.attackSpeed;
    const threatScore = dps * distanceWeight;

    if (enemy.isFlying) {
      nearbyAirEnemies++;
      airThreatScore += threatScore;
    } else {
      nearbyGroundEnemies++;
      groundThreatScore += threatScore;
    }
  }

  const isInFighterMode = unit.currentModeIsFlying === true;

  if (isInFighterMode) {
    // Fighter mode (air-only attacks) -> Transform to Assault if ground enemies and no air
    if (nearbyGroundEnemies > 0 && nearbyAirEnemies === 0) {
      return { shouldTransform: true, targetMode: 'assault' };
    }
    if (nearbyGroundEnemies >= 3 && nearbyAirEnemies <= 1 && groundThreatScore > airThreatScore * 2) {
      return { shouldTransform: true, targetMode: 'assault' };
    }
  } else {
    // Assault mode (ground-only attacks) -> Transform to Fighter if air enemies and no ground
    if (nearbyAirEnemies > 0 && nearbyGroundEnemies === 0) {
      return { shouldTransform: true, targetMode: 'fighter' };
    }
    if (nearbyAirEnemies >= 2 && nearbyGroundEnemies <= 1 && airThreatScore > groundThreatScore * 2) {
      return { shouldTransform: true, targetMode: 'fighter' };
    }
  }

  return { shouldTransform: false };
}

/**
 * Check if current target is still good (for focus fire)
 */
function shouldSwitchTarget(
  unit: UnitSnapshot,
  bestTargetId: number | null,
  enemies: UnitSnapshot[]
): boolean {
  if (unit.targetEntityId === null) return true;
  if (bestTargetId === null) return false;
  if (unit.targetEntityId === bestTargetId) return false;

  // Find current target
  const currentTarget = enemies.find(e => e.id === unit.targetEntityId);
  if (!currentTarget || currentTarget.health <= 0) return true;

  const currentHealthPercent = currentTarget.health / currentTarget.maxHealth;

  // Keep focusing low health targets
  if (currentHealthPercent < focusFireThreshold) return false;

  // Find better target
  const betterTarget = enemies.find(e => e.id === bestTargetId);
  if (!betterTarget) return false;

  const betterHealthPercent = betterTarget.health / betterTarget.maxHealth;

  // Switch if better target is significantly lower health
  return betterHealthPercent < currentHealthPercent - 0.2;
}

/**
 * Evaluate micro decisions for all AI units
 */
function evaluateMicro(
  aiPlayerId: string,
  aiUnits: UnitSnapshot[],
  enemyUnits: UnitSnapshot[],
  enemyBuildings: BuildingSnapshot[],
  friendlyBasePosition: { x: number; y: number } | null,
  mapWidth: number,
  mapHeight: number
): MicroDecision[] {
  const decisions: MicroDecision[] = [];

  for (const unit of aiUnits) {
    // Skip workers
    if (unit.isWorker) continue;
    // Skip dead units
    if (unit.health <= 0) continue;
    // Skip units that aren't in combat-relevant states
    if (unit.state !== 'attacking' && unit.state !== 'moving' && unit.state !== 'idle') {
      // Exception: transformable units can be processed when idle
      if (!(unit.canTransform && unit.state === 'idle')) {
        continue;
      }
    }

    // Assess threats and find best target
    const { threats, bestTarget, threatScore } = assessThreats(unit, enemyUnits, enemyBuildings);

    // Check for transform decision first (Valkyrie-like units)
    if (unit.canTransform) {
      const transform = shouldTransform(unit, enemyUnits);
      if (transform.shouldTransform && transform.targetMode) {
        decisions.push({
          unitId: unit.id,
          action: 'transform',
          targetMode: transform.targetMode,
          threatScore,
        });
        continue;
      }
    }

    // Check if should retreat
    if (shouldRetreat(unit, threats, friendlyBasePosition) && friendlyBasePosition) {
      decisions.push({
        unitId: unit.id,
        action: 'retreat',
        targetPosition: friendlyBasePosition,
        threatScore,
      });
      continue;
    }

    // Check if should kite
    const kite = shouldKite(unit, enemyUnits);
    if (kite.shouldKite && kite.kiteFromX !== undefined && kite.kiteFromY !== undefined) {
      const kitePos = calculateKitePosition(unit, kite.kiteFromX, kite.kiteFromY, mapWidth, mapHeight);
      decisions.push({
        unitId: unit.id,
        action: 'kite',
        targetPosition: kitePos,
        targetId: bestTarget ?? undefined,
        threatScore,
      });
      continue;
    }

    // Check if should switch target (focus fire)
    if (bestTarget !== null && shouldSwitchTarget(unit, bestTarget, enemyUnits)) {
      decisions.push({
        unitId: unit.id,
        action: 'attack',
        targetId: bestTarget,
        threatScore,
      });
      continue;
    }

    // No action needed
    decisions.push({
      unitId: unit.id,
      action: 'none',
      threatScore,
    });
  }

  return decisions;
}

// Message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init': {
      const success = init(message.config);
      self.postMessage({ type: 'initialized', success });
      break;
    }

    case 'evaluateMicro': {
      if (!initialized) {
        // Initialize with defaults if not done
        init({});
      }

      const decisions = evaluateMicro(
        message.aiPlayerId,
        message.aiUnits,
        message.enemyUnits,
        message.enemyBuildings,
        message.friendlyBasePosition,
        message.mapWidth,
        message.mapHeight
      );

      self.postMessage({
        type: 'microResult',
        decisions,
        tick: message.tick,
        aiPlayerId: message.aiPlayerId,
      });
      break;
    }
  }
};

// Export for TypeScript module resolution
export {};
