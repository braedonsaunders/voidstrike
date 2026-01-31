/**
 * AnimationConfigLoader
 *
 * Loads and validates animation configuration from JSON.
 */

import {
  AnimationConfig,
  ParameterDefinition,
  LayerConfig,
  StateMachineConfig,
  AnimationStateConfig,
  TransitionConfig,
  SimpleStateConfig,
  BracketStateConfig,
  BlendTreeStateConfig,
} from './AnimationTypes';

/**
 * Legacy animation config format (from current assets.json)
 */
interface LegacyAnimationConfig {
  idle?: string[];
  walk?: string[];
  attack?: string[];
  death?: string[];
}

/**
 * Asset config that may have either format
 */
interface AssetAnimationConfig {
  animations?: LegacyAnimationConfig;
  animation?: AnimationConfig;
  animationSpeed?: number;
}

/**
 * Default parameters for standard unit animations
 */
const DEFAULT_PARAMETERS: Record<string, ParameterDefinition> = {
  velocity: { type: 'float', default: 0 },
  isAttacking: { type: 'bool', default: false },
  isDead: { type: 'bool', default: false },
};

/**
 * Default velocity threshold for walk detection
 */
const VELOCITY_THRESHOLD = 0.01;

/**
 * Load animation config from asset configuration
 */
export function loadAnimationConfig(
  assetConfig: AssetAnimationConfig
): AnimationConfig | null {
  // Check for new format first
  if (assetConfig.animation) {
    return validateAndNormalizeConfig(assetConfig.animation);
  }

  // Convert legacy format
  if (assetConfig.animations) {
    return convertLegacyConfig(
      assetConfig.animations,
      assetConfig.animationSpeed
    );
  }

  return null;
}

/**
 * Convert legacy animation config to new format
 */
function convertLegacyConfig(
  legacy: LegacyAnimationConfig,
  animationSpeed?: number
): AnimationConfig {
  const speed = animationSpeed ?? 1.0;

  // Build clip mappings from legacy arrays
  const clipMappings: Record<string, string[]> = {};
  if (legacy.idle) clipMappings['idle'] = legacy.idle;
  if (legacy.walk) clipMappings['walk'] = legacy.walk;
  if (legacy.attack) clipMappings['attack'] = legacy.attack;
  if (legacy.death) clipMappings['death'] = legacy.death;

  // Create standard locomotion state machine
  const locomotionStates: Record<string, AnimationStateConfig> = {
    idle: {
      clip: 'idle',
      loop: true,
      speed,
      transitions: [
        {
          to: 'walk',
          conditions: [{ param: 'velocity', op: '>', value: VELOCITY_THRESHOLD }],
          blendIn: 0.15,
          blendOut: 0.15,
        },
        {
          to: 'attack',
          conditions: [
            { param: 'isAttacking', op: '==', value: true },
            { param: 'velocity', op: '<=', value: VELOCITY_THRESHOLD },
          ],
          blendIn: 0.1,
          blendOut: 0.1,
        },
        {
          to: 'death',
          conditions: [{ param: 'isDead', op: '==', value: true }],
          blendIn: 0.1,
          priority: 100, // Death takes priority
        },
      ],
    },
    walk: {
      clip: 'walk',
      loop: true,
      speed,
      transitions: [
        {
          to: 'idle',
          conditions: [{ param: 'velocity', op: '<=', value: VELOCITY_THRESHOLD }],
          blendIn: 0.15,
          blendOut: 0.15,
        },
        {
          to: 'death',
          conditions: [{ param: 'isDead', op: '==', value: true }],
          blendIn: 0.1,
          priority: 100,
        },
      ],
    },
    attack: {
      clip: 'attack',
      loop: true,
      speed,
      transitions: [
        {
          to: 'idle',
          conditions: [{ param: 'isAttacking', op: '==', value: false }],
          blendIn: 0.15,
          blendOut: 0.15,
        },
        {
          to: 'walk',
          conditions: [{ param: 'velocity', op: '>', value: VELOCITY_THRESHOLD }],
          blendIn: 0.1,
          blendOut: 0.1,
        },
        {
          to: 'death',
          conditions: [{ param: 'isDead', op: '==', value: true }],
          blendIn: 0.1,
          priority: 100,
        },
      ],
    },
    death: {
      clip: 'death',
      loop: false,
      speed,
      // No transitions out of death
      transitions: [],
    },
  };

  return {
    parameters: { ...DEFAULT_PARAMETERS },
    layers: [
      {
        name: 'base',
        weight: 1.0,
        blendMode: 'override',
        stateMachine: 'locomotion',
      },
    ],
    stateMachines: {
      locomotion: {
        defaultState: 'idle',
        states: locomotionStates,
      },
    },
    clipMappings,
  };
}

/**
 * Validate and normalize a full animation config
 */
function validateAndNormalizeConfig(config: AnimationConfig): AnimationConfig {
  // Ensure all required fields exist
  if (!config.parameters) {
    config.parameters = { ...DEFAULT_PARAMETERS };
  }

  if (!config.layers || config.layers.length === 0) {
    throw new Error('AnimationConfig must have at least one layer');
  }

  if (!config.stateMachines || Object.keys(config.stateMachines).length === 0) {
    throw new Error('AnimationConfig must have at least one state machine');
  }

  // Validate each layer references a valid state machine
  for (const layer of config.layers) {
    if (!config.stateMachines[layer.stateMachine]) {
      throw new Error(
        `Layer "${layer.name}" references unknown state machine "${layer.stateMachine}"`
      );
    }
  }

  // Validate each state machine
  for (const [name, sm] of Object.entries(config.stateMachines)) {
    if (!sm.states[sm.defaultState]) {
      throw new Error(
        `State machine "${name}" has invalid default state "${sm.defaultState}"`
      );
    }

    // Validate transitions reference valid states
    for (const [stateName, state] of Object.entries(sm.states)) {
      const transitions = state.transitions ?? [];
      for (const transition of transitions) {
        if (!sm.states[transition.to]) {
          throw new Error(
            `State "${stateName}" in "${name}" has transition to unknown state "${transition.to}"`
          );
        }
      }
    }
  }

  return config;
}

/**
 * Create a minimal config for non-animated assets
 */
export function createStaticConfig(): AnimationConfig {
  return {
    parameters: {},
    layers: [],
    stateMachines: {},
    clipMappings: {},
  };
}

/**
 * Merge animation config with overrides
 */
export function mergeAnimationConfig(
  base: AnimationConfig,
  overrides: Partial<AnimationConfig>
): AnimationConfig {
  return {
    parameters: { ...base.parameters, ...overrides.parameters },
    layers: overrides.layers ?? base.layers,
    stateMachines: { ...base.stateMachines, ...overrides.stateMachines },
    clipMappings: { ...base.clipMappings, ...overrides.clipMappings },
  };
}
