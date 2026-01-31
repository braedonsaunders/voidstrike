/**
 * AnimationTransition
 *
 * Evaluates transition conditions and manages transition state.
 */

import {
  TransitionConfig,
  TransitionCondition,
  ParameterMap,
  ComparisonOperator,
} from './AnimationTypes';

export class AnimationTransition {
  public readonly config: TransitionConfig;
  public readonly targetState: string;

  constructor(config: TransitionConfig) {
    this.config = config;
    this.targetState = config.to;
  }

  /**
   * Get blend in time for this transition
   */
  public get blendIn(): number {
    return this.config.blendIn ?? 0.2;
  }

  /**
   * Get blend out time for this transition
   */
  public get blendOut(): number {
    return this.config.blendOut ?? 0.2;
  }

  /**
   * Get priority (higher = checked first)
   */
  public get priority(): number {
    return this.config.priority ?? 0;
  }

  /**
   * Check if transition can interrupt current state
   */
  public get canInterrupt(): boolean {
    return this.config.canInterrupt ?? false;
  }

  /**
   * Get exit time requirement (normalized 0-1)
   */
  public get exitTime(): number | undefined {
    return this.config.exitTime;
  }

  /**
   * Evaluate if this transition should fire
   */
  public evaluate(
    parameters: ParameterMap,
    currentNormalizedTime: number
  ): boolean {
    // Check exit time requirement
    if (
      this.config.exitTime !== undefined &&
      currentNormalizedTime < this.config.exitTime
    ) {
      return false;
    }

    // Check all conditions (AND logic)
    for (const condition of this.config.conditions) {
      if (!this.evaluateCondition(condition, parameters)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: TransitionCondition,
    parameters: ParameterMap
  ): boolean {
    const param = parameters.get(condition.param);
    if (!param) {
      // Parameter doesn't exist - condition fails
      return false;
    }

    // Handle trigger type specially
    if (param.type === 'trigger') {
      if (condition.op === '==' && condition.value === true) {
        // Trigger is set and not consumed
        return param.value === true && !param.consumed;
      }
      return false;
    }

    return this.compare(param.value, condition.op, condition.value);
  }

  /**
   * Compare values using operator
   */
  private compare(
    left: number | boolean,
    op: ComparisonOperator,
    right: number | boolean
  ): boolean {
    // Convert booleans to numbers for comparison
    const l = typeof left === 'boolean' ? (left ? 1 : 0) : left;
    const r = typeof right === 'boolean' ? (right ? 1 : 0) : right;

    switch (op) {
      case '==':
        return l === r;
      case '!=':
        return l !== r;
      case '>':
        return l > r;
      case '<':
        return l < r;
      case '>=':
        return l >= r;
      case '<=':
        return l <= r;
      default:
        return false;
    }
  }
}

/**
 * Evaluate multiple transitions and return the highest priority valid one
 */
export function evaluateTransitions(
  transitions: AnimationTransition[],
  parameters: ParameterMap,
  currentNormalizedTime: number,
  isInterruptible: boolean
): AnimationTransition | null {
  // Sort by priority (higher first)
  const sorted = [...transitions].sort((a, b) => b.priority - a.priority);

  for (const transition of sorted) {
    // Skip non-interruptible transitions if we can't interrupt
    if (!isInterruptible && !transition.canInterrupt) {
      continue;
    }

    if (transition.evaluate(parameters, currentNormalizedTime)) {
      return transition;
    }
  }

  return null;
}
