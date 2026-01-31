/**
 * AnimationLayer
 *
 * Represents a single animation layer with its own state machine.
 * Layers can override or add to layers below them.
 */

import * as THREE from 'three';
import {
  LayerConfig,
  StateMachineConfig,
  ParameterMap,
  RuntimeStateInfo,
  BlendMode,
  AnimationEventCallback,
} from './AnimationTypes';
import { AnimationStateMachine } from './AnimationStateMachine';

export class AnimationLayer {
  public readonly name: string;
  public readonly blendMode: BlendMode;

  private weight: number;
  private stateMachine: AnimationStateMachine;
  private mask: string | undefined;

  constructor(
    config: LayerConfig,
    stateMachineConfig: StateMachineConfig
  ) {
    this.name = config.name;
    this.weight = config.weight;
    this.blendMode = config.blendMode;
    this.mask = config.mask;

    this.stateMachine = new AnimationStateMachine(
      config.name,
      stateMachineConfig
    );
  }

  /**
   * Initialize with Three.js components
   */
  public initialize(
    mixer: THREE.AnimationMixer,
    clipNameToAction: Map<string, THREE.AnimationAction>,
    clipMappings: Record<string, string[]>
  ): void {
    this.stateMachine.initialize(mixer, clipNameToAction, clipMappings);
  }

  /**
   * Set event callback
   */
  public setEventCallback(callback: AnimationEventCallback): void {
    this.stateMachine.setEventCallback(callback);
  }

  /**
   * Update layer
   */
  public update(deltaTime: number, parameters: ParameterMap): void {
    this.stateMachine.setParameterMapRef(parameters);
    this.stateMachine.update(deltaTime, parameters);
  }

  /**
   * Get layer weight
   */
  public getWeight(): number {
    return this.weight;
  }

  /**
   * Set layer weight
   */
  public setWeight(weight: number): void {
    this.weight = Math.max(0, Math.min(1, weight));
  }

  /**
   * Get bone mask name
   */
  public getMask(): string | undefined {
    return this.mask;
  }

  /**
   * Get current state info
   */
  public getStateInfo(): RuntimeStateInfo {
    return this.stateMachine.getStateInfo();
  }

  /**
   * Get current state name
   */
  public getCurrentStateName(): string {
    return this.stateMachine.getCurrentStateName();
  }

  /**
   * Check if layer is in transition
   */
  public isTransitioning(): boolean {
    return this.stateMachine.getIsTransitioning();
  }

  /**
   * Force a specific state
   */
  public forceState(stateName: string, blendTime?: number): void {
    this.stateMachine.forceState(stateName, blendTime);
  }
}
