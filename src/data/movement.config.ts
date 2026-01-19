/**
 * MovementConfig - Centralized movement and steering configuration
 *
 * SINGLE SOURCE OF TRUTH for all unit movement parameters.
 * MovementSystem imports these values for RTS-style steering behaviors.
 *
 * IMPORTANT: If you change these values, all unit movement behavior
 * will update automatically.
 */

// =============================================================================
// SEPARATION - Prevents unit overlapping (strongest boid force)
// =============================================================================

/**
 * Radius within which separation forces apply between units.
 * Units of: world units
 */
export const SEPARATION_RADIUS = 1.5;

/**
 * Separation strength while units are moving.
 * Weak to allow natural clumping for faster group movement.
 */
export const SEPARATION_STRENGTH_MOVING = 1.2;

/**
 * Separation strength when units are idle.
 * Moderate to prevent jiggling while maintaining spacing.
 */
export const SEPARATION_STRENGTH_IDLE = 1.5;

/**
 * Separation strength when units arrive at destination.
 * Strong to create natural spreading at rally points.
 */
export const SEPARATION_STRENGTH_ARRIVING = 2.0;

/**
 * Separation strength while units are attacking in range.
 * Strong for unclumping during combat.
 */
export const SEPARATION_STRENGTH_COMBAT = 4.0;

/**
 * Maximum separation/avoidance force magnitude.
 * Prevents extreme forces from causing erratic movement.
 */
export const MAX_AVOIDANCE_FORCE = 2.5;

// =============================================================================
// COHESION - Keeps groups together (weak boid force)
// =============================================================================

/**
 * Radius within which cohesion forces apply.
 * Larger radius = units attracted to more distant neighbors.
 * Units of: world units
 */
export const COHESION_RADIUS = 8.0;

/**
 * Cohesion force strength.
 * Very weak - just prevents extreme spreading without causing bunching.
 */
export const COHESION_STRENGTH = 0.1;

// =============================================================================
// ALIGNMENT - Matches group heading (moderate boid force)
// =============================================================================

/**
 * Radius within which alignment forces apply.
 * Units of: world units
 */
export const ALIGNMENT_RADIUS = 4.0;

/**
 * Alignment force strength.
 * Moderate - helps groups move in coordinated directions.
 */
export const ALIGNMENT_STRENGTH = 0.3;

// =============================================================================
// ARRIVAL SPREADING - Units spread when reaching destination
// =============================================================================

/**
 * Distance from target where arrival spreading kicks in.
 * Units of: world units
 */
export const ARRIVAL_SPREAD_RADIUS = 2.0;

/**
 * Additional separation multiplier at arrival.
 * Boosts separation to prevent bunching at rally points.
 */
export const ARRIVAL_SPREAD_STRENGTH = 1.0;

// =============================================================================
// BUILDING AVOIDANCE - Runtime steering around structures
// =============================================================================

/**
 * Force strength when avoiding buildings.
 * Navmesh handles primary avoidance; this is for edge cases.
 */
export const BUILDING_AVOIDANCE_STRENGTH = 15.0;

/**
 * Hard collision margin around buildings.
 * Minimal since navmesh walkableRadius handles primary clearance.
 * Units of: world units
 */
export const BUILDING_AVOIDANCE_MARGIN = 0.1;

/**
 * Soft avoidance margin for early steering.
 * Units start steering before hitting hard collision zone.
 * Units of: world units
 */
export const BUILDING_AVOIDANCE_SOFT_MARGIN = 0.3;

/**
 * How far ahead to predict building collisions.
 * Units of: seconds of movement lookahead
 */
export const BUILDING_PREDICTION_LOOKAHEAD = 0.3;

// =============================================================================
// PATH REQUESTS - Pathfinding throttling
// =============================================================================

/**
 * Cooldown between path requests for the same unit.
 * 10 ticks @ 20 ticks/sec = 500ms
 * Units of: game ticks
 */
export const PATH_REQUEST_COOLDOWN_TICKS = 10;

/**
 * Whether to use Recast crowd for pathfinding direction.
 * When true, crowd handles local avoidance.
 */
export const USE_RECAST_CROWD = true;

// =============================================================================
// VELOCITY SMOOTHING - Prevents movement jitter
// =============================================================================

/**
 * Blend factor for velocity smoothing.
 * 0 = full history (smoothest), 1 = no smoothing (most responsive)
 */
export const VELOCITY_SMOOTHING_FACTOR = 0.25;

/**
 * Number of frames to average for velocity history.
 */
export const VELOCITY_HISTORY_FRAMES = 4;

/**
 * Dot product threshold for direction commitment.
 * Below this, unit resists sudden direction changes.
 */
export const DIRECTION_COMMIT_THRESHOLD = 0.6;

/**
 * How strongly to resist direction changes.
 * Higher = more committed to current direction.
 */
export const DIRECTION_COMMIT_STRENGTH = 0.6;

// =============================================================================
// PHYSICS PUSHING - Units push through each other
// =============================================================================

/**
 * Distance at which physics pushing starts.
 * Units of: world units
 */
export const PHYSICS_PUSH_RADIUS = 1.2;

/**
 * Base push force strength.
 */
export const PHYSICS_PUSH_STRENGTH = 6.0;

/**
 * How quickly push force falls off with distance.
 * Higher = faster falloff.
 */
export const PHYSICS_PUSH_FALLOFF = 0.6;

/**
 * Extra strong push force when units overlap.
 * Quickly resolves accidental overlaps.
 */
export const PHYSICS_OVERLAP_PUSH = 15.0;

// =============================================================================
// STUCK DETECTION - Handles units that can't move
// =============================================================================

/**
 * Frames of near-zero movement before unit is considered stuck.
 * Units of: frames
 */
export const STUCK_DETECTION_FRAMES = 20;

/**
 * Speed threshold below which unit is considered stuck.
 * Units of: world units per second
 */
export const STUCK_VELOCITY_THRESHOLD = 0.05;

/**
 * Random nudge force applied to stuck units.
 */
export const STUCK_NUDGE_STRENGTH = 1.5;

/**
 * Minimum distance to target for stuck detection to apply.
 * Prevents nudging units that are already at destination.
 * Units of: world units
 */
export const STUCK_MIN_DISTANCE_TO_TARGET = 2.0;

// =============================================================================
// STEERING FORCE THROTTLING - Performance optimization
// =============================================================================

/**
 * Ticks between separation force recalculations.
 * Separation is most important, updates frequently.
 */
export const SEPARATION_THROTTLE_TICKS = 5;

/**
 * Ticks between cohesion force recalculations.
 * Cohesion is subtle, can update less frequently.
 */
export const COHESION_THROTTLE_TICKS = 8;

/**
 * Ticks between alignment force recalculations.
 * Alignment is subtle, can update less frequently.
 */
export const ALIGNMENT_THROTTLE_TICKS = 8;

/**
 * Ticks between physics push recalculations.
 * Push needs to be responsive but can skip some frames.
 */
export const PHYSICS_PUSH_THROTTLE_TICKS = 3;

// =============================================================================
// COMBAT MOVEMENT - Attack behavior tuning
// =============================================================================

/**
 * Speed multiplier when units spread apart during combat.
 * Lower = units stay closer to targets while unclumping.
 */
export const COMBAT_SPREAD_SPEED_MULTIPLIER = 0.5;

/**
 * Minimum separation magnitude to trigger combat movement.
 * Below this threshold, units stay still while attacking.
 */
export const COMBAT_SEPARATION_THRESHOLD = 0.1;

/**
 * Multiplier for attack standoff distance from buildings.
 * Units position at attackRange * this value from building edge.
 */
export const ATTACK_STANDOFF_MULTIPLIER = 0.8;

// =============================================================================
// IDLE BEHAVIOR - Units at rest
// =============================================================================

/**
 * Ticks before a stationary unit is considered "truly idle".
 * Truly idle units process less frequently for performance.
 * Units of: game ticks
 */
export const TRULY_IDLE_THRESHOLD_TICKS = 20;

/**
 * How often to process truly idle units.
 * Units of: game ticks
 */
export const TRULY_IDLE_PROCESS_INTERVAL = 10;

/**
 * Minimum separation force magnitude to move an idle unit.
 * Higher threshold prevents micro-adjustments and oscillation.
 */
export const IDLE_SEPARATION_THRESHOLD = 0.25;

/**
 * Speed multiplier for idle unit repulsion movement.
 * Slower movement prevents jittery behavior.
 */
export const IDLE_REPEL_SPEED_MULTIPLIER = 0.3;

// =============================================================================
// MISCELLANEOUS
// =============================================================================

/**
 * Maximum units in a single move command for formation calculation.
 */
export const FORMATION_BUFFER_SIZE = 256;

/**
 * Turn rate for unit rotation.
 * Units of: radians per second (multiplied by dt)
 */
export const UNIT_TURN_RATE = 8;

/**
 * Magic box margin for formation vs clump detection.
 * Target must be this far inside bounding box to trigger formation mode.
 * Units of: world units
 */
export const MAGIC_BOX_MARGIN = 0.5;

// =============================================================================
// AGGREGATED CONFIG OBJECTS - For convenient importing
// =============================================================================

/**
 * All separation-related parameters grouped together.
 */
export const SEPARATION_CONFIG = {
  radius: SEPARATION_RADIUS,
  strengthMoving: SEPARATION_STRENGTH_MOVING,
  strengthIdle: SEPARATION_STRENGTH_IDLE,
  strengthArriving: SEPARATION_STRENGTH_ARRIVING,
  strengthCombat: SEPARATION_STRENGTH_COMBAT,
  maxForce: MAX_AVOIDANCE_FORCE,
} as const;

/**
 * All cohesion-related parameters grouped together.
 */
export const COHESION_CONFIG = {
  radius: COHESION_RADIUS,
  strength: COHESION_STRENGTH,
} as const;

/**
 * All alignment-related parameters grouped together.
 */
export const ALIGNMENT_CONFIG = {
  radius: ALIGNMENT_RADIUS,
  strength: ALIGNMENT_STRENGTH,
} as const;

/**
 * All building avoidance parameters grouped together.
 */
export const BUILDING_AVOIDANCE_CONFIG = {
  strength: BUILDING_AVOIDANCE_STRENGTH,
  margin: BUILDING_AVOIDANCE_MARGIN,
  softMargin: BUILDING_AVOIDANCE_SOFT_MARGIN,
  predictionLookahead: BUILDING_PREDICTION_LOOKAHEAD,
} as const;

/**
 * All velocity smoothing parameters grouped together.
 */
export const VELOCITY_SMOOTHING_CONFIG = {
  factor: VELOCITY_SMOOTHING_FACTOR,
  historyFrames: VELOCITY_HISTORY_FRAMES,
  directionCommitThreshold: DIRECTION_COMMIT_THRESHOLD,
  directionCommitStrength: DIRECTION_COMMIT_STRENGTH,
} as const;

/**
 * All physics push parameters grouped together.
 */
export const PHYSICS_PUSH_CONFIG = {
  radius: PHYSICS_PUSH_RADIUS,
  strength: PHYSICS_PUSH_STRENGTH,
  falloff: PHYSICS_PUSH_FALLOFF,
  overlapPush: PHYSICS_OVERLAP_PUSH,
} as const;

/**
 * All stuck detection parameters grouped together.
 */
export const STUCK_DETECTION_CONFIG = {
  frames: STUCK_DETECTION_FRAMES,
  velocityThreshold: STUCK_VELOCITY_THRESHOLD,
  nudgeStrength: STUCK_NUDGE_STRENGTH,
  minDistanceToTarget: STUCK_MIN_DISTANCE_TO_TARGET,
} as const;

/**
 * All throttling parameters grouped together.
 */
export const THROTTLE_CONFIG = {
  separation: SEPARATION_THROTTLE_TICKS,
  cohesion: COHESION_THROTTLE_TICKS,
  alignment: ALIGNMENT_THROTTLE_TICKS,
  physicsPush: PHYSICS_PUSH_THROTTLE_TICKS,
} as const;
