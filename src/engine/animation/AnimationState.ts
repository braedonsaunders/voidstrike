/**
 * AnimationState
 *
 * Represents a single state in the animation state machine.
 * Handles simple clips, SC2-style brackets, and blend trees.
 */

import * as THREE from 'three';
import {
  AnimationStateConfig,
  SimpleStateConfig,
  BracketStateConfig,
  BlendTreeStateConfig,
  TransitionConfig,
  BracketPhase,
  ParameterMap,
  AnimationEventDefinition,
  AnimationEventCallback,
} from './AnimationTypes';

export class AnimationState {
  public readonly name: string;
  public readonly config: AnimationStateConfig;

  // Three.js animation actions
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private mixer: THREE.AnimationMixer | null = null;

  // Runtime state
  private currentTime = 0;
  private bracketPhase: BracketPhase = 'content';
  private phaseComplete = false;

  // Event tracking
  private firedEvents: Set<string> = new Set();
  private eventCallback: AnimationEventCallback | null = null;

  constructor(name: string, config: AnimationStateConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * Initialize with Three.js mixer and clip-to-action mapping
   */
  public initialize(
    mixer: THREE.AnimationMixer,
    clipNameToAction: Map<string, THREE.AnimationAction>,
    clipMappings: Record<string, string[]>
  ): void {
    this.mixer = mixer;

    // Resolve clips for this state
    if (this.isSimple()) {
      const action = this.resolveClip(
        (this.config as SimpleStateConfig).clip,
        clipNameToAction,
        clipMappings
      );
      if (action) {
        this.actions.set('main', action);
      }
    } else if (this.isBracket()) {
      const bracket = this.config as BracketStateConfig;
      if (bracket.opening) {
        const action = this.resolveClip(
          bracket.opening.clip,
          clipNameToAction,
          clipMappings
        );
        if (action) this.actions.set('opening', action);
      }
      if (bracket.content) {
        const action = this.resolveClip(
          bracket.content.clip,
          clipNameToAction,
          clipMappings
        );
        if (action) this.actions.set('content', action);
      }
      if (bracket.closing) {
        const action = this.resolveClip(
          bracket.closing.clip,
          clipNameToAction,
          clipMappings
        );
        if (action) this.actions.set('closing', action);
      }
    } else if (this.isBlendTree()) {
      const blendTree = this.config as BlendTreeStateConfig;
      for (let i = 0; i < blendTree.nodes.length; i++) {
        const node = blendTree.nodes[i];
        const action = this.resolveClip(
          node.clip,
          clipNameToAction,
          clipMappings
        );
        if (action) {
          this.actions.set(`node_${i}`, action);
        }
      }
    }
  }

  /**
   * Resolve a clip name to an action using mappings
   */
  private resolveClip(
    clipName: string,
    clipNameToAction: Map<string, THREE.AnimationAction>,
    clipMappings: Record<string, string[]>
  ): THREE.AnimationAction | null {
    // Try direct match first
    const direct = clipNameToAction.get(clipName.toLowerCase());
    if (direct) return direct;

    // Try mappings
    const mappings = clipMappings[clipName];
    if (mappings) {
      for (const mapping of mappings) {
        const action = clipNameToAction.get(mapping.toLowerCase());
        if (action) return action;
      }
    }

    // Try partial match
    for (const [name, action] of clipNameToAction) {
      if (name.includes(clipName.toLowerCase())) {
        return action;
      }
    }

    return null;
  }

  /**
   * Set event callback
   */
  public setEventCallback(callback: AnimationEventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Enter this state
   */
  public enter(blendTime: number): void {
    this.currentTime = 0;
    this.firedEvents.clear();
    this.phaseComplete = false;

    if (this.isSimple()) {
      const action = this.actions.get('main');
      if (action) {
        const simple = this.config as SimpleStateConfig;
        action.reset();
        action.setLoop(
          simple.loop !== false ? THREE.LoopRepeat : THREE.LoopOnce,
          simple.loop !== false ? Infinity : 1
        );
        action.clampWhenFinished = !simple.loop;
        action.fadeIn(blendTime).play();
      }
    } else if (this.isBracket()) {
      this.bracketPhase = 'opening';
      const bracket = this.config as BracketStateConfig;

      // Start with opening if it exists, otherwise content
      if (bracket.opening && this.actions.has('opening')) {
        const action = this.actions.get('opening')!;
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.fadeIn(bracket.opening.blendIn ?? blendTime).play();
      } else {
        this.bracketPhase = 'content';
        this.enterContentPhase(blendTime);
      }
    } else if (this.isBlendTree()) {
      // Start all blend tree actions at weight 0
      for (const [, action] of this.actions) {
        action.reset();
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.setEffectiveWeight(0);
        action.play();
      }
    }
  }

  /**
   * Enter bracket content phase
   */
  private enterContentPhase(blendTime: number): void {
    const bracket = this.config as BracketStateConfig;
    const action = this.actions.get('content');
    if (action) {
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.fadeIn(bracket.content.blendIn ?? blendTime).play();
    }
  }

  /**
   * Exit this state
   */
  public exit(blendTime: number): void {
    if (this.isSimple()) {
      const action = this.actions.get('main');
      if (action) {
        action.fadeOut(blendTime);
      }
    } else if (this.isBracket()) {
      // If we have a closing phase and not already in it, transition to closing
      const bracket = this.config as BracketStateConfig;
      if (
        bracket.closing &&
        this.actions.has('closing') &&
        this.bracketPhase !== 'closing'
      ) {
        // Fade out current phase before transitioning
        const previousPhase = this.bracketPhase;
        this.bracketPhase = 'closing';
        if (previousPhase === 'opening') {
          this.actions.get('opening')?.fadeOut(blendTime);
        } else {
          this.actions.get('content')?.fadeOut(blendTime);
        }
        // Fade in closing
        const closingAction = this.actions.get('closing')!;
        closingAction.reset();
        closingAction.setLoop(THREE.LoopOnce, 1);
        closingAction.clampWhenFinished = true;
        closingAction.fadeIn(bracket.closing.blendIn ?? blendTime).play();
      } else {
        // No closing phase, just fade out
        for (const [, action] of this.actions) {
          action.fadeOut(blendTime);
        }
        this.bracketPhase = 'complete';
      }
    } else if (this.isBlendTree()) {
      for (const [, action] of this.actions) {
        action.fadeOut(blendTime);
      }
    }
  }

  /**
   * Force immediate stop (for interrupts)
   */
  public forceStop(): void {
    for (const [, action] of this.actions) {
      action.stop();
    }
    this.bracketPhase = 'complete';
  }

  /**
   * Update state each frame
   */
  public update(deltaTime: number, parameters: ParameterMap): void {
    // Calculate speed multiplier
    const speed = this.getSpeedMultiplier(parameters);
    const scaledDelta = deltaTime * speed;
    this.currentTime += scaledDelta;

    // Handle bracket phase transitions
    if (this.isBracket()) {
      this.updateBracket();
    }

    // Handle blend tree weights
    if (this.isBlendTree()) {
      this.updateBlendTree(parameters);
    }

    // Fire events
    this.checkEvents();
  }

  /**
   * Update bracket state phases
   */
  private updateBracket(): void {
    const bracket = this.config as BracketStateConfig;

    if (this.bracketPhase === 'opening') {
      const action = this.actions.get('opening');
      if (action && action.time >= action.getClip().duration) {
        // Opening complete, transition to content
        this.bracketPhase = 'content';
        action.fadeOut(bracket.content.blendIn ?? 0.1);
        this.enterContentPhase(bracket.content.blendIn ?? 0.1);
        this.firedEvents.clear();
      }
    } else if (this.bracketPhase === 'closing') {
      const action = this.actions.get('closing');
      if (action && action.time >= action.getClip().duration) {
        this.bracketPhase = 'complete';
        this.phaseComplete = true;
      }
    }
  }

  /**
   * Update blend tree weights based on parameter
   */
  private updateBlendTree(parameters: ParameterMap): void {
    const blendTree = this.config as BlendTreeStateConfig;
    const param = parameters.get(blendTree.blendParameter);
    const value = typeof param?.value === 'number' ? param.value : 0;

    const nodes = blendTree.nodes;
    if (nodes.length === 0) return;

    // Sort nodes by threshold
    const sortedNodes = [...nodes].sort((a, b) => a.threshold - b.threshold);

    // Calculate weights using linear interpolation between nodes
    const weights: number[] = new Array(nodes.length).fill(0);

    if (value <= sortedNodes[0].threshold) {
      // Below first threshold - full weight to first node
      const originalIndex = nodes.indexOf(sortedNodes[0]);
      weights[originalIndex] = 1;
    } else if (value >= sortedNodes[sortedNodes.length - 1].threshold) {
      // Above last threshold - full weight to last node
      const originalIndex = nodes.indexOf(sortedNodes[sortedNodes.length - 1]);
      weights[originalIndex] = 1;
    } else {
      // Find the two nodes we're between
      for (let i = 0; i < sortedNodes.length - 1; i++) {
        const lower = sortedNodes[i];
        const upper = sortedNodes[i + 1];

        if (value >= lower.threshold && value <= upper.threshold) {
          const range = upper.threshold - lower.threshold;
          const t = range > 0 ? (value - lower.threshold) / range : 0;

          const lowerIndex = nodes.indexOf(lower);
          const upperIndex = nodes.indexOf(upper);

          weights[lowerIndex] = 1 - t;
          weights[upperIndex] = t;
          break;
        }
      }
    }

    // Apply weights to actions
    for (let i = 0; i < nodes.length; i++) {
      const action = this.actions.get(`node_${i}`);
      if (action) {
        action.setEffectiveWeight(weights[i]);
        // Apply node-specific speed
        if (nodes[i].speed !== undefined) {
          action.setEffectiveTimeScale(nodes[i].speed!);
        }
      }
    }
  }

  /**
   * Get speed multiplier from config
   */
  private getSpeedMultiplier(parameters: ParameterMap): number {
    if (this.isSimple()) {
      const simple = this.config as SimpleStateConfig;
      if (typeof simple.speed === 'number') {
        return simple.speed;
      } else if (typeof simple.speed === 'string') {
        const param = parameters.get(simple.speed);
        return typeof param?.value === 'number' ? Math.max(0.1, param.value) : 1;
      }
    }
    return 1;
  }

  /**
   * Check and fire animation events
   */
  private checkEvents(): void {
    const events = this.getCurrentEvents();
    if (!events || !this.eventCallback) return;

    const duration = this.getCurrentDuration();
    if (duration <= 0) return;

    const normalizedTime = (this.currentTime % duration) / duration;

    for (const event of events) {
      const eventKey = `${event.event}_${event.time}`;
      if (!this.firedEvents.has(eventKey) && normalizedTime >= event.time) {
        this.firedEvents.add(eventKey);
        this.eventCallback(event.event, event.data);
      }
    }

    // Reset fired events when animation loops
    if (normalizedTime < 0.1 && this.firedEvents.size > 0) {
      // Check if we've looped
      const loopCount = Math.floor(this.currentTime / duration);
      if (loopCount > 0) {
        this.firedEvents.clear();
      }
    }
  }

  /**
   * Get events for current phase
   */
  private getCurrentEvents(): AnimationEventDefinition[] | undefined {
    if (this.isSimple()) {
      return (this.config as SimpleStateConfig).events;
    } else if (this.isBracket()) {
      const bracket = this.config as BracketStateConfig;
      switch (this.bracketPhase) {
        case 'opening':
          return bracket.opening?.events;
        case 'content':
          return bracket.content.events;
        case 'closing':
          return bracket.closing?.events;
      }
    } else if (this.isBlendTree()) {
      return (this.config as BlendTreeStateConfig).events;
    }
    return undefined;
  }

  /**
   * Get duration of current animation
   */
  private getCurrentDuration(): number {
    if (this.isSimple()) {
      const action = this.actions.get('main');
      return action?.getClip().duration ?? 1;
    } else if (this.isBracket()) {
      let actionKey: string;
      switch (this.bracketPhase) {
        case 'opening':
          actionKey = 'opening';
          break;
        case 'closing':
          actionKey = 'closing';
          break;
        default:
          actionKey = 'content';
      }
      const action = this.actions.get(actionKey);
      return action?.getClip().duration ?? 1;
    } else if (this.isBlendTree()) {
      // Use first node's duration
      const action = this.actions.get('node_0');
      return action?.getClip().duration ?? 1;
    }
    return 1;
  }

  /**
   * Get normalized time (0-1) in current animation
   */
  public getNormalizedTime(): number {
    const duration = this.getCurrentDuration();
    if (duration <= 0) return 0;

    if (this.isSimple() && (this.config as SimpleStateConfig).loop === false) {
      return Math.min(1, this.currentTime / duration);
    }

    return (this.currentTime % duration) / duration;
  }

  /**
   * Get current bracket phase
   */
  public getBracketPhase(): BracketPhase {
    return this.bracketPhase;
  }

  /**
   * Check if bracket closing phase is complete
   */
  public isClosingComplete(): boolean {
    return this.bracketPhase === 'complete' && this.phaseComplete;
  }

  /**
   * Get transitions from this state
   */
  public getTransitions(): TransitionConfig[] {
    return this.config.transitions ?? [];
  }

  // Type guards
  public isSimple(): boolean {
    return !this.config.type || this.config.type === 'simple';
  }

  public isBracket(): boolean {
    return this.config.type === 'bracket';
  }

  public isBlendTree(): boolean {
    return this.config.type === 'blendTree';
  }
}
