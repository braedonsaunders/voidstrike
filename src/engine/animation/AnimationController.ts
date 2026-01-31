/**
 * AnimationController
 *
 * Main controller for the data-driven animation system.
 * Manages parameters, layers, and coordinates the animation state machines.
 *
 * Inspired by:
 * - StarCraft 2's bracket system (opening/content/closing phases)
 * - Unity's Animator Controller (layers, blend trees, parameters)
 */

import * as THREE from 'three';
import {
  AnimationConfig,
  ParameterMap,
  ParameterValue,
  RuntimeStateInfo,
  AnimationEventCallback,
} from './AnimationTypes';
import { AnimationLayer } from './AnimationLayer';

export class AnimationController {
  private readonly config: AnimationConfig;
  private readonly mixer: THREE.AnimationMixer;

  // Parameters drive animation transitions
  private parameters: ParameterMap = new Map();

  // Layers (processed bottom to top)
  private layers: AnimationLayer[] = [];

  // Clip name to action mapping
  private clipNameToAction: Map<string, THREE.AnimationAction> = new Map();

  // Event listeners
  private eventListeners: Map<string, Set<AnimationEventCallback>> = new Map();

  // Global event callback (fires for all events)
  private globalEventCallback: AnimationEventCallback | null = null;

  constructor(
    config: AnimationConfig,
    mixer: THREE.AnimationMixer,
    clips: THREE.AnimationClip[]
  ) {
    this.config = config;
    this.mixer = mixer;

    // Initialize parameters from config
    this.initializeParameters();

    // Build clip name to action mapping
    this.buildClipMapping(clips);

    // Create layers
    this.createLayers();
  }

  /**
   * Initialize parameters from config defaults
   */
  private initializeParameters(): void {
    for (const [name, def] of Object.entries(this.config.parameters)) {
      this.parameters.set(name, {
        type: def.type,
        value: def.default,
        consumed: false,
      });
    }
  }

  /**
   * Build mapping from clip names to Three.js actions
   */
  private buildClipMapping(clips: THREE.AnimationClip[]): void {
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);

      // Store with original name
      this.clipNameToAction.set(clip.name.toLowerCase(), action);

      // Handle Blender-style naming (e.g., "Armature|idle" -> "idle")
      let normalizedName = clip.name.toLowerCase();
      if (normalizedName.includes('|')) {
        normalizedName = normalizedName.split('|').pop() || normalizedName;
        this.clipNameToAction.set(normalizedName, action);
      }

      // Also store without common prefixes
      const prefixes = ['armature_', 'skeleton_', 'root_'];
      for (const prefix of prefixes) {
        if (normalizedName.startsWith(prefix)) {
          this.clipNameToAction.set(
            normalizedName.substring(prefix.length),
            action
          );
        }
      }
    }
  }

  /**
   * Create animation layers from config
   */
  private createLayers(): void {
    for (const layerConfig of this.config.layers) {
      const stateMachineConfig =
        this.config.stateMachines[layerConfig.stateMachine];

      if (!stateMachineConfig) {
        console.warn(
          `[AnimationController] State machine "${layerConfig.stateMachine}" not found for layer "${layerConfig.name}"`
        );
        continue;
      }

      const layer = new AnimationLayer(layerConfig, stateMachineConfig);
      layer.initialize(
        this.mixer,
        this.clipNameToAction,
        this.config.clipMappings
      );

      // Set up event forwarding
      layer.setEventCallback((event, data) => {
        this.dispatchEvent(event, data);
      });

      this.layers.push(layer);
    }
  }

  // ===========================================================================
  // PARAMETER API
  // ===========================================================================

  /**
   * Set a float parameter
   */
  public setFloat(name: string, value: number): void {
    const param = this.parameters.get(name);
    if (param && param.type === 'float') {
      param.value = value;
    } else if (!param) {
      // Auto-create parameter if it doesn't exist
      this.parameters.set(name, {
        type: 'float',
        value,
        consumed: false,
      });
    }
  }

  /**
   * Get a float parameter
   */
  public getFloat(name: string): number {
    const param = this.parameters.get(name);
    return typeof param?.value === 'number' ? param.value : 0;
  }

  /**
   * Set a boolean parameter
   */
  public setBool(name: string, value: boolean): void {
    const param = this.parameters.get(name);
    if (param && param.type === 'bool') {
      param.value = value;
    } else if (!param) {
      this.parameters.set(name, {
        type: 'bool',
        value,
        consumed: false,
      });
    }
  }

  /**
   * Get a boolean parameter
   */
  public getBool(name: string): boolean {
    const param = this.parameters.get(name);
    return typeof param?.value === 'boolean' ? param.value : false;
  }

  /**
   * Set an integer parameter
   */
  public setInt(name: string, value: number): void {
    const param = this.parameters.get(name);
    if (param && param.type === 'int') {
      param.value = Math.floor(value);
    } else if (!param) {
      this.parameters.set(name, {
        type: 'int',
        value: Math.floor(value),
        consumed: false,
      });
    }
  }

  /**
   * Get an integer parameter
   */
  public getInt(name: string): number {
    const param = this.parameters.get(name);
    return typeof param?.value === 'number' ? Math.floor(param.value) : 0;
  }

  /**
   * Set a trigger parameter (auto-resets after being consumed by a transition)
   */
  public setTrigger(name: string): void {
    const param = this.parameters.get(name);
    if (param && param.type === 'trigger') {
      param.value = true;
      param.consumed = false;
    } else if (!param) {
      this.parameters.set(name, {
        type: 'trigger',
        value: true,
        consumed: false,
      });
    }
  }

  /**
   * Reset a trigger parameter
   */
  public resetTrigger(name: string): void {
    const param = this.parameters.get(name);
    if (param && param.type === 'trigger') {
      param.value = false;
      param.consumed = false;
    }
  }

  // ===========================================================================
  // STATE QUERY API
  // ===========================================================================

  /**
   * Get current state name for a layer
   */
  public getCurrentState(layerName?: string): string {
    if (layerName) {
      const layer = this.layers.find((l) => l.name === layerName);
      return layer?.getCurrentStateName() ?? 'none';
    }
    // Default to first layer
    return this.layers[0]?.getCurrentStateName() ?? 'none';
  }

  /**
   * Check if a layer is transitioning
   */
  public isInTransition(layerName?: string): boolean {
    if (layerName) {
      const layer = this.layers.find((l) => l.name === layerName);
      return layer?.isTransitioning() ?? false;
    }
    // Check if any layer is transitioning
    return this.layers.some((l) => l.isTransitioning());
  }

  /**
   * Get full state info for a layer
   */
  public getStateInfo(layerName?: string): RuntimeStateInfo {
    if (layerName) {
      const layer = this.layers.find((l) => l.name === layerName);
      return (
        layer?.getStateInfo() ?? {
          name: 'none',
          normalizedTime: 0,
          isTransitioning: false,
        }
      );
    }
    return (
      this.layers[0]?.getStateInfo() ?? {
        name: 'none',
        normalizedTime: 0,
        isTransitioning: false,
      }
    );
  }

  /**
   * Get all layer names
   */
  public getLayerNames(): string[] {
    return this.layers.map((l) => l.name);
  }

  /**
   * Get layer weight
   */
  public getLayerWeight(layerName: string): number {
    const layer = this.layers.find((l) => l.name === layerName);
    return layer?.getWeight() ?? 0;
  }

  /**
   * Set layer weight
   */
  public setLayerWeight(layerName: string, weight: number): void {
    const layer = this.layers.find((l) => l.name === layerName);
    layer?.setWeight(weight);
  }

  // ===========================================================================
  // CONTROL API
  // ===========================================================================

  /**
   * Force a specific state on a layer
   */
  public forceState(
    stateName: string,
    layerName?: string,
    blendTime?: number
  ): void {
    if (layerName) {
      const layer = this.layers.find((l) => l.name === layerName);
      layer?.forceState(stateName, blendTime);
    } else {
      // Force on all layers that have this state
      for (const layer of this.layers) {
        layer.forceState(stateName, blendTime);
      }
    }
  }

  // ===========================================================================
  // EVENT API
  // ===========================================================================

  /**
   * Add event listener for a specific event
   */
  public on(event: string, callback: AnimationEventCallback): void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(callback);
  }

  /**
   * Remove event listener
   */
  public off(event: string, callback: AnimationEventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Set global event callback (receives all events)
   */
  public setGlobalEventCallback(callback: AnimationEventCallback | null): void {
    this.globalEventCallback = callback;
  }

  /**
   * Dispatch an animation event
   */
  private dispatchEvent(event: string, data?: Record<string, unknown>): void {
    // Fire global callback
    this.globalEventCallback?.(event, data);

    // Fire specific listeners
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        callback(event, data);
      }
    }
  }

  // ===========================================================================
  // UPDATE
  // ===========================================================================

  /**
   * Update animation controller each frame
   */
  public update(deltaTime: number): void {
    // Reset consumed triggers
    for (const [, param] of this.parameters) {
      if (param.type === 'trigger' && param.consumed) {
        param.value = false;
        param.consumed = false;
      }
    }

    // Update all layers
    for (const layer of this.layers) {
      layer.update(deltaTime, this.parameters);
    }

    // Update the mixer (actually advances animations)
    this.mixer.update(deltaTime);
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Stop all actions
    for (const [, action] of this.clipNameToAction) {
      action.stop();
    }

    // Clear event listeners
    this.eventListeners.clear();
    this.globalEventCallback = null;

    // Note: We don't dispose the mixer here as it may be shared
  }
}
