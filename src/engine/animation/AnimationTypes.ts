/**
 * Animation System Types
 *
 * Data-driven animation state machine inspired by StarCraft 2's bracket system
 * and Unity's Animator Controller architecture.
 */

// =============================================================================
// PARAMETER TYPES
// =============================================================================

export type ParameterType = 'float' | 'bool' | 'int' | 'trigger';

export interface ParameterDefinition {
  type: ParameterType;
  default: number | boolean;
}

export interface ParameterValue {
  type: ParameterType;
  value: number | boolean;
  // Triggers are consumed after being read
  consumed?: boolean;
}

export type ParameterMap = Map<string, ParameterValue>;

// =============================================================================
// CONDITION TYPES
// =============================================================================

export type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';

export interface TransitionCondition {
  param: string;
  op: ComparisonOperator;
  value: number | boolean;
}

// =============================================================================
// ANIMATION EVENT TYPES
// =============================================================================

export interface AnimationEventDefinition {
  /** Normalized time (0-1) within the clip when event fires */
  time: number;
  /** Event name dispatched to listeners */
  event: string;
  /** Optional payload data */
  data?: Record<string, unknown>;
}

// =============================================================================
// ANIMATION PHASE (for brackets)
// =============================================================================

export interface AnimationPhaseConfig {
  /** Clip name to play */
  clip: string;
  /** Blend time into this phase */
  blendIn?: number;
  /** Blend time out of this phase */
  blendOut?: number;
  /** Speed multiplier for this phase */
  speed?: number;
  /** Events during this phase */
  events?: AnimationEventDefinition[];
}

// =============================================================================
// STATE TYPES
// =============================================================================

export type AnimationStateType = 'simple' | 'bracket' | 'blendTree';

export interface TransitionConfig {
  /** Target state name */
  to: string;
  /** Conditions that must all be true for transition */
  conditions: TransitionCondition[];
  /** Blend time when entering target state (seconds) */
  blendIn?: number;
  /** Blend time when leaving current state (seconds) */
  blendOut?: number;
  /** Normalized exit time (0-1) - wait until this point in animation before allowing transition */
  exitTime?: number;
  /** Priority when multiple transitions are valid (higher = checked first) */
  priority?: number;
  /** If true, transition can interrupt the current state immediately */
  canInterrupt?: boolean;
}

export interface SimpleStateConfig {
  type?: 'simple';
  /** Animation clip name */
  clip: string;
  /** Whether animation loops */
  loop?: boolean;
  /** Speed multiplier (number or parameter name) */
  speed?: number | string;
  /** Events during playback */
  events?: AnimationEventDefinition[];
  /** Outgoing transitions */
  transitions?: TransitionConfig[];
}

export interface BracketStateConfig {
  type: 'bracket';
  /** Opening phase (plays once at start) */
  opening?: AnimationPhaseConfig;
  /** Content phase (loops during action) */
  content: AnimationPhaseConfig;
  /** Closing phase (plays once at end) */
  closing?: AnimationPhaseConfig;
  /** Outgoing transitions */
  transitions?: TransitionConfig[];
}

export interface BlendTreeNodeConfig {
  /** Clip name */
  clip: string;
  /** Parameter value at which this clip is fully weighted */
  threshold: number;
  /** Speed multiplier */
  speed?: number;
}

export interface BlendTreeStateConfig {
  type: 'blendTree';
  /** Parameter that drives blending */
  blendParameter: string;
  /** Blend tree nodes */
  nodes: BlendTreeNodeConfig[];
  /** Events (fired based on dominant clip) */
  events?: AnimationEventDefinition[];
  /** Outgoing transitions */
  transitions?: TransitionConfig[];
}

export type AnimationStateConfig =
  | SimpleStateConfig
  | BracketStateConfig
  | BlendTreeStateConfig;

// =============================================================================
// STATE MACHINE CONFIG
// =============================================================================

export interface StateMachineConfig {
  /** Default state to start in */
  defaultState: string;
  /** State definitions */
  states: Record<string, AnimationStateConfig>;
}

// =============================================================================
// LAYER CONFIG
// =============================================================================

export type BlendMode = 'override' | 'additive';

export interface LayerConfig {
  /** Layer name */
  name: string;
  /** Layer weight (0-1) */
  weight: number;
  /** How this layer combines with layers below */
  blendMode: BlendMode;
  /** State machine for this layer */
  stateMachine: string;
  /** Bone mask name (optional, for partial body animations) */
  mask?: string;
}

// =============================================================================
// FULL ANIMATION CONFIG
// =============================================================================

export interface AnimationConfig {
  /** Parameter definitions */
  parameters: Record<string, ParameterDefinition>;
  /** Animation layers (processed bottom to top) */
  layers: LayerConfig[];
  /** State machine definitions */
  stateMachines: Record<string, StateMachineConfig>;
  /** Clip name mappings for model compatibility */
  clipMappings: Record<string, string[]>;
}

// =============================================================================
// RUNTIME STATE
// =============================================================================

export type BracketPhase = 'opening' | 'content' | 'closing' | 'complete';

export interface RuntimeStateInfo {
  /** Current state name */
  name: string;
  /** Normalized time in current animation (0-1) */
  normalizedTime: number;
  /** For bracket states, which phase we're in */
  bracketPhase?: BracketPhase;
  /** Whether currently transitioning */
  isTransitioning: boolean;
  /** Target state if transitioning */
  transitionTarget?: string;
  /** Transition progress (0-1) */
  transitionProgress?: number;
}

// =============================================================================
// EVENT CALLBACK
// =============================================================================

export type AnimationEventCallback = (
  event: string,
  data?: Record<string, unknown>
) => void;
