/**
 * Animation System
 *
 * Data-driven animation state machine for VOIDSTRIKE.
 *
 * Architecture inspired by:
 * - StarCraft 2's bracket system (opening/content/closing phases)
 * - Unity's Animator Controller (layers, blend trees, parameters)
 *
 * Usage:
 * ```typescript
 * import { AnimationController, loadAnimationConfig, updateAnimationParameters } from '@/engine/animation';
 *
 * // Load config from assets.json
 * const config = loadAnimationConfig(assetConfig);
 *
 * // Create controller
 * const controller = new AnimationController(config, mixer, clips);
 *
 * // Each frame:
 * updateAnimationParameters(controller, unit, velocity);
 * controller.update(deltaTime);
 * ```
 */

// Core controller
export { AnimationController } from './AnimationController';

// State machine components
export { AnimationStateMachine } from './AnimationStateMachine';
export { AnimationState } from './AnimationState';
export { AnimationTransition, evaluateTransitions } from './AnimationTransition';
export { AnimationLayer } from './AnimationLayer';

// Config loading
export {
  loadAnimationConfig,
  createStaticConfig,
  mergeAnimationConfig,
} from './AnimationConfigLoader';

// Game state bridge
export {
  updateAnimationParameters,
  getLogicalAnimationState,
} from './AnimationParameterBridge';

// Types
export type {
  // Parameter types
  ParameterType,
  ParameterDefinition,
  ParameterValue,
  ParameterMap,
  // Condition types
  ComparisonOperator,
  TransitionCondition,
  // Event types
  AnimationEventDefinition,
  AnimationEventCallback,
  // Phase types
  AnimationPhaseConfig,
  // State types
  AnimationStateType,
  TransitionConfig,
  SimpleStateConfig,
  BracketStateConfig,
  BlendTreeStateConfig,
  AnimationStateConfig,
  // Machine types
  StateMachineConfig,
  // Layer types
  BlendMode,
  LayerConfig,
  // Config types
  AnimationConfig,
  // Runtime types
  BracketPhase,
  RuntimeStateInfo,
} from './AnimationTypes';
