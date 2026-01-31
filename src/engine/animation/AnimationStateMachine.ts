/**
 * AnimationStateMachine
 *
 * Manages animation states and transitions for a single layer.
 */

import * as THREE from 'three';
import {
  StateMachineConfig,
  ParameterMap,
  RuntimeStateInfo,
  AnimationEventCallback,
} from './AnimationTypes';
import { AnimationState } from './AnimationState';
import { AnimationTransition, evaluateTransitions } from './AnimationTransition';

export class AnimationStateMachine {
  public readonly name: string;
  private readonly config: StateMachineConfig;

  // States
  private states: Map<string, AnimationState> = new Map();
  private currentState: AnimationState | null = null;
  private previousState: AnimationState | null = null;

  // Transitions (cached per state)
  private stateTransitions: Map<string, AnimationTransition[]> = new Map();

  // Transition state
  private isTransitioning = false;
  private transitionProgress = 0;
  private transitionDuration = 0;
  private transitionTarget: AnimationState | null = null;

  // Event callback
  private eventCallback: AnimationEventCallback | null = null;

  constructor(name: string, config: StateMachineConfig) {
    this.name = name;
    this.config = config;

    // Create state objects
    for (const [stateName, stateConfig] of Object.entries(config.states)) {
      const state = new AnimationState(stateName, stateConfig);
      this.states.set(stateName, state);

      // Cache transitions for this state
      const transitions = (stateConfig.transitions ?? []).map(
        (t) => new AnimationTransition(t)
      );
      this.stateTransitions.set(stateName, transitions);
    }
  }

  /**
   * Initialize with Three.js components
   */
  public initialize(
    mixer: THREE.AnimationMixer,
    clipNameToAction: Map<string, THREE.AnimationAction>,
    clipMappings: Record<string, string[]>
  ): void {
    for (const state of this.states.values()) {
      state.initialize(mixer, clipNameToAction, clipMappings);
      state.setEventCallback((event, data) => {
        this.eventCallback?.(event, data);
      });
    }

    // Enter default state
    const defaultState = this.states.get(this.config.defaultState);
    if (defaultState) {
      this.currentState = defaultState;
      defaultState.enter(0); // No blend on initial enter
    }
  }

  /**
   * Set event callback
   */
  public setEventCallback(callback: AnimationEventCallback): void {
    this.eventCallback = callback;
    for (const state of this.states.values()) {
      state.setEventCallback(callback);
    }
  }

  /**
   * Update state machine
   */
  public update(deltaTime: number, parameters: ParameterMap): void {
    if (!this.currentState) return;

    // Update transition progress
    if (this.isTransitioning) {
      this.transitionProgress += deltaTime / this.transitionDuration;

      if (this.transitionProgress >= 1) {
        // Transition complete
        this.completeTransition();
      }
    }

    // Update current state
    this.currentState.update(deltaTime, parameters);

    // Check for transitions (only if not already transitioning)
    if (!this.isTransitioning) {
      this.evaluateTransitions(parameters);
    }
  }

  /**
   * Evaluate and potentially trigger transitions
   */
  private evaluateTransitions(parameters: ParameterMap): void {
    if (!this.currentState) return;

    const transitions = this.stateTransitions.get(this.currentState.name);
    if (!transitions || transitions.length === 0) return;

    // For bracket states, check if we need to wait for closing
    let normalizedTime = this.currentState.getNormalizedTime();
    if (this.currentState.isBracket()) {
      const phase = this.currentState.getBracketPhase();
      if (phase === 'closing' && !this.currentState.isClosingComplete()) {
        // Still in closing phase, don't allow most transitions
        normalizedTime = 0; // Prevent exit time transitions
      }
    }

    const transition = evaluateTransitions(
      transitions,
      parameters,
      normalizedTime,
      true // Always interruptible for now
    );

    if (transition) {
      this.startTransition(transition);
    }
  }

  /**
   * Start a transition to a new state
   */
  private startTransition(transition: AnimationTransition): void {
    const targetState = this.states.get(transition.targetState);
    if (!targetState || targetState === this.currentState) return;

    this.isTransitioning = true;
    this.transitionProgress = 0;
    this.transitionDuration = Math.max(transition.blendIn, transition.blendOut);
    this.transitionTarget = targetState;
    this.previousState = this.currentState;

    // Exit current state
    this.currentState?.exit(transition.blendOut);

    // Enter target state
    targetState.enter(transition.blendIn);

    // Consume any triggers that caused this transition
    this.consumeTriggers(transition, this.getParameterMap());
  }

  /**
   * Consume trigger parameters after transition
   */
  private consumeTriggers(
    transition: AnimationTransition,
    parameters: ParameterMap
  ): void {
    for (const condition of transition.config.conditions) {
      const param = parameters.get(condition.param);
      if (param?.type === 'trigger') {
        param.consumed = true;
      }
    }
  }

  /**
   * Get parameter map (for trigger consumption)
   * This is a hack - ideally parameters would be passed in
   */
  private parameterMapRef: ParameterMap | null = null;
  private getParameterMap(): ParameterMap {
    return this.parameterMapRef ?? new Map();
  }

  /**
   * Complete the current transition
   */
  private completeTransition(): void {
    if (this.transitionTarget) {
      this.previousState?.forceStop();
      this.currentState = this.transitionTarget;
    }

    this.isTransitioning = false;
    this.transitionProgress = 0;
    this.transitionDuration = 0;
    this.transitionTarget = null;
    this.previousState = null;
  }

  /**
   * Force transition to a specific state (for external control)
   */
  public forceState(stateName: string, blendTime: number = 0.2): void {
    const targetState = this.states.get(stateName);
    if (!targetState || targetState === this.currentState) return;

    // Cancel any in-progress transition
    if (this.isTransitioning) {
      this.completeTransition();
    }

    this.currentState?.exit(blendTime);
    this.currentState = targetState;
    targetState.enter(blendTime);
  }

  /**
   * Get current state info
   */
  public getStateInfo(): RuntimeStateInfo {
    if (!this.currentState) {
      return {
        name: 'none',
        normalizedTime: 0,
        isTransitioning: false,
      };
    }

    return {
      name: this.currentState.name,
      normalizedTime: this.currentState.getNormalizedTime(),
      bracketPhase: this.currentState.isBracket()
        ? this.currentState.getBracketPhase()
        : undefined,
      isTransitioning: this.isTransitioning,
      transitionTarget: this.transitionTarget?.name,
      transitionProgress: this.isTransitioning
        ? this.transitionProgress
        : undefined,
    };
  }

  /**
   * Get current state name
   */
  public getCurrentStateName(): string {
    return this.currentState?.name ?? 'none';
  }

  /**
   * Check if currently transitioning
   */
  public getIsTransitioning(): boolean {
    return this.isTransitioning;
  }

  /**
   * Store parameter map reference for trigger consumption
   */
  public setParameterMapRef(params: ParameterMap): void {
    this.parameterMapRef = params;
  }
}
