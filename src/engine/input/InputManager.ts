/**
 * InputManager - Centralized Input Management Singleton
 *
 * AAA-style input management with:
 * - Single subscription at initialization (no listener churn)
 * - Context-based input routing
 * - Proper focus handling (no stuck keys)
 * - Input state tracking for systems that need it
 * - Selection state management (moved out of React)
 *
 * Usage:
 * ```typescript
 * // Initialize once when game starts
 * const inputManager = InputManager.getInstance();
 * inputManager.initialize(container, camera, game, worldProvider, eventBus);
 *
 * // Change context as needed
 * inputManager.setContext('building');
 *
 * // Dispose when game ends
 * inputManager.dispose();
 * ```
 */

import type { EventBus } from '../core/EventBus';
import type { Game } from '../core/Game';
import type { RTSCamera } from '@/rendering/Camera';
import type { IWorldProvider } from '../ecs/IWorldProvider';
import {
  type InputContext,
  type InputState,
  type SelectionState,
  type InputHandler,
  type InputHandlerDependencies,
  type KeyboardInputEvent,
  type MouseInputEvent,
  type WheelInputEvent,
  MouseButton,
} from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const DOUBLE_CLICK_TIME = 400;
const DOUBLE_CLICK_DISTANCE = 10;

// =============================================================================
// INPUT MANAGER SINGLETON
// =============================================================================

export class InputManager {
  // Singleton
  private static instance: InputManager | null = null;

  // Initialization state
  private initialized = false;
  private container: HTMLElement | null = null;

  // Dependencies (set during initialize, can be updated)
  private camera: RTSCamera | null = null;
  private game: Game | null = null;
  private worldProvider: IWorldProvider | null = null;
  private eventBus: EventBus | null = null;
  private getLocalPlayerIdFn: (() => string | null) | null = null;

  // Input context
  private currentContext: InputContext = 'gameplay';
  private handlers: Map<InputContext, InputHandler> = new Map();

  // Input state (mutable internally, exposed as readonly)
  private keysPressed: Set<string> = new Set();
  private mousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private mouseButtons: Set<MouseButton> = new Set();
  private mouseInBounds = false;
  private modifiers = { shift: false, ctrl: false, alt: false, meta: false };

  // Selection state
  private selectionState: SelectionState = {
    isSelecting: false,
    selectionStart: { x: 0, y: 0 },
    selectionEnd: { x: 0, y: 0 },
  };

  // Double-click detection
  private lastClick: { time: number; x: number; y: number } | null = null;

  // Drag state
  private isDragging = false;
  private dragStart: { x: number; y: number } | null = null;

  // Bound event handlers (stored for cleanup)
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundBlur: () => void;
  private boundVisibilityChange: () => void;

  // Subscribers for state changes
  private selectionSubscribers: Set<(state: SelectionState) => void> = new Set();
  private contextSubscribers: Set<(context: InputContext) => void> = new Set();

  // =============================================================================
  // SINGLETON PATTERN
  // =============================================================================

  private constructor() {
    // Bind all handlers once in constructor
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundWheel = this.handleWheel.bind(this);
    this.boundContextMenu = this.handleContextMenu.bind(this);
    this.boundBlur = this.handleBlur.bind(this);
    this.boundVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  /**
   * Get the singleton instance if it exists (returns null if not created)
   */
  public static getInstanceSync(): InputManager | null {
    return InputManager.instance;
  }

  /**
   * Reset the singleton (for testing or game restart)
   */
  public static resetInstance(): void {
    if (InputManager.instance) {
      InputManager.instance.dispose();
      InputManager.instance = null;
    }
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  /**
   * Initialize the input manager.
   * IMPORTANT: This subscribes to events ONCE. Call dispose() to clean up.
   */
  public initialize(
    container: HTMLElement,
    options: {
      camera?: RTSCamera | null;
      game?: Game | null;
      worldProvider?: IWorldProvider | null;
      eventBus?: EventBus | null;
      getLocalPlayerId?: () => string | null;
    } = {}
  ): void {
    if (this.initialized) {
      console.warn('[InputManager] Already initialized. Call dispose() first to reinitialize.');
      return;
    }

    this.container = container;
    this.camera = options.camera ?? null;
    this.game = options.game ?? null;
    this.worldProvider = options.worldProvider ?? null;
    this.eventBus = options.eventBus ?? null;
    this.getLocalPlayerIdFn = options.getLocalPlayerId ?? null;

    // Subscribe to window-level events (keyboard, blur)
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);

    // Subscribe to container events (mouse)
    container.addEventListener('mousedown', this.boundMouseDown);
    container.addEventListener('contextmenu', this.boundContextMenu);
    container.addEventListener('wheel', this.boundWheel, { passive: false });

    // Subscribe to document-level mouse events for drag continuation
    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);

    // Track mouse enter/leave
    container.addEventListener('mouseenter', () => { this.mouseInBounds = true; });
    container.addEventListener('mouseleave', () => { this.mouseInBounds = false; });

    this.initialized = true;
    console.log('[InputManager] Initialized');
  }

  /**
   * Update dependencies after initialization.
   * Useful when camera/game/etc are created after InputManager.
   */
  public updateDependencies(options: {
    camera?: RTSCamera | null;
    game?: Game | null;
    worldProvider?: IWorldProvider | null;
    eventBus?: EventBus | null;
    getLocalPlayerId?: () => string | null;
  }): void {
    if (options.camera !== undefined) this.camera = options.camera;
    if (options.game !== undefined) this.game = options.game;
    if (options.worldProvider !== undefined) this.worldProvider = options.worldProvider;
    if (options.eventBus !== undefined) this.eventBus = options.eventBus;
    if (options.getLocalPlayerId !== undefined) this.getLocalPlayerIdFn = options.getLocalPlayerId;
  }

  /**
   * Dispose of the input manager and remove all event listeners.
   */
  public dispose(): void {
    if (!this.initialized) return;

    // Remove window-level events
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('visibilitychange', this.boundVisibilityChange);

    // Remove document-level mouse events
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    // Remove container events
    if (this.container) {
      this.container.removeEventListener('mousedown', this.boundMouseDown);
      this.container.removeEventListener('contextmenu', this.boundContextMenu);
      this.container.removeEventListener('wheel', this.boundWheel);
    }

    // Clear state
    this.keysPressed.clear();
    this.mouseButtons.clear();
    this.selectionSubscribers.clear();
    this.contextSubscribers.clear();
    this.handlers.clear();

    this.container = null;
    this.camera = null;
    this.game = null;
    this.worldProvider = null;
    this.eventBus = null;
    this.initialized = false;

    console.log('[InputManager] Disposed');
  }

  // =============================================================================
  // CONTEXT MANAGEMENT
  // =============================================================================

  /**
   * Register a handler for an input context
   */
  public registerHandler(context: InputContext, handler: InputHandler): void {
    this.handlers.set(context, handler);
  }

  /**
   * Unregister a handler for an input context
   */
  public unregisterHandler(context: InputContext): void {
    this.handlers.delete(context);
  }

  /**
   * Get the current input context
   */
  public getContext(): InputContext {
    return this.currentContext;
  }

  /**
   * Set the current input context.
   * This changes how input events are interpreted.
   */
  public setContext(context: InputContext): void {
    if (context === this.currentContext) return;

    const previousHandler = this.handlers.get(this.currentContext);
    const newHandler = this.handlers.get(context);

    // Deactivate previous handler
    previousHandler?.onDeactivate?.();

    const previousContext = this.currentContext;
    this.currentContext = context;

    // Activate new handler
    newHandler?.onActivate?.(this.getDependencies());

    // Notify subscribers
    for (const subscriber of this.contextSubscribers) {
      subscriber(context);
    }

    console.log(`[InputManager] Context changed: ${previousContext} -> ${context}`);
  }

  /**
   * Subscribe to context changes
   * @returns Unsubscribe function
   */
  public subscribeContext(callback: (context: InputContext) => void): () => void {
    this.contextSubscribers.add(callback);
    return () => this.contextSubscribers.delete(callback);
  }

  // =============================================================================
  // STATE ACCESS
  // =============================================================================

  /**
   * Get the current input state (readonly)
   */
  public getInputState(): InputState {
    return {
      keysPressed: this.keysPressed,
      modifiers: { ...this.modifiers },
      mousePosition: { ...this.mousePosition },
      mouseButtons: this.mouseButtons,
      mouseInBounds: this.mouseInBounds,
      isDragging: this.isDragging,
      dragStart: this.dragStart ? { ...this.dragStart } : null,
    };
  }

  /**
   * Check if a specific key is currently pressed
   */
  public isKeyPressed(key: string): boolean {
    return this.keysPressed.has(key.toLowerCase());
  }

  /**
   * Check if a specific mouse button is currently pressed
   */
  public isMouseButtonPressed(button: MouseButton): boolean {
    return this.mouseButtons.has(button);
  }

  /**
   * Get the current mouse position (container-relative)
   */
  public getMousePosition(): { x: number; y: number } {
    return { ...this.mousePosition };
  }

  /**
   * Get the current selection state
   */
  public getSelectionState(): SelectionState {
    return { ...this.selectionState };
  }

  /**
   * Subscribe to selection state changes
   * @returns Unsubscribe function
   */
  public subscribeSelectionState(callback: (state: SelectionState) => void): () => void {
    this.selectionSubscribers.add(callback);
    return () => this.selectionSubscribers.delete(callback);
  }

  // =============================================================================
  // SELECTION STATE MANAGEMENT
  // =============================================================================

  /**
   * Start a selection box
   */
  public startSelection(x: number, y: number): void {
    this.selectionState = {
      isSelecting: true,
      selectionStart: { x, y },
      selectionEnd: { x, y },
    };
    this.notifySelectionSubscribers();
  }

  /**
   * Update the selection box end position
   */
  public updateSelection(x: number, y: number): void {
    if (!this.selectionState.isSelecting) return;
    this.selectionState.selectionEnd = { x, y };
    this.notifySelectionSubscribers();
  }

  /**
   * End the selection box and return the final state
   */
  public endSelection(): SelectionState {
    const finalState = { ...this.selectionState };
    this.selectionState = {
      isSelecting: false,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 0, y: 0 },
    };
    this.notifySelectionSubscribers();
    return finalState;
  }

  /**
   * Cancel the current selection
   */
  public cancelSelection(): void {
    this.selectionState = {
      isSelecting: false,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 0, y: 0 },
    };
    this.notifySelectionSubscribers();
  }

  private notifySelectionSubscribers(): void {
    const state = this.getSelectionState();
    for (const subscriber of this.selectionSubscribers) {
      subscriber(state);
    }
  }

  // =============================================================================
  // COORDINATE CONVERSION
  // =============================================================================

  /**
   * Convert client coordinates to container-relative coordinates
   */
  public clientToContainer(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.container) return { x: clientX, y: clientY };
    const rect = this.container.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  /**
   * Convert container coordinates to world coordinates
   */
  public containerToWorld(x: number, y: number): { x: number; z: number } | null {
    if (!this.camera) return null;
    const worldPos = this.camera.screenToWorld(x, y);
    if (!worldPos) return null;
    return { x: worldPos.x, z: worldPos.z };
  }

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  private handleKeyDown(e: KeyboardEvent): void {
    // Skip if typing in an input field
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key.toLowerCase();
    this.keysPressed.add(key);
    this.updateModifiers(e);

    const event = this.createKeyboardEvent('keydown', e);
    const handler = this.handlers.get(this.currentContext);

    if (handler?.onKeyDown?.(event, this.getInputState(), this.getDependencies())) {
      e.preventDefault();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    this.keysPressed.delete(key);
    this.updateModifiers(e);

    const event = this.createKeyboardEvent('keyup', e);
    const handler = this.handlers.get(this.currentContext);

    if (handler?.onKeyUp?.(event, this.getInputState(), this.getDependencies())) {
      e.preventDefault();
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    const containerPos = this.clientToContainer(e.clientX, e.clientY);
    this.mousePosition = containerPos;
    this.mouseButtons.add(e.button as MouseButton);
    this.updateModifiers(e);

    // Start drag tracking
    this.isDragging = true;
    this.dragStart = { ...containerPos };

    const event = this.createMouseEvent('mousedown', e);
    const handler = this.handlers.get(this.currentContext);

    if (handler?.onMouseDown?.(event, this.getInputState(), this.getDependencies())) {
      e.preventDefault();
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const containerPos = this.clientToContainer(e.clientX, e.clientY);
    this.mousePosition = containerPos;
    this.updateModifiers(e);

    const event = this.createMouseEvent('mousemove', e);
    const handler = this.handlers.get(this.currentContext);

    handler?.onMouseMove?.(event, this.getInputState(), this.getDependencies());
  }

  private handleMouseUp(e: MouseEvent): void {
    const containerPos = this.clientToContainer(e.clientX, e.clientY);
    this.mousePosition = containerPos;
    this.mouseButtons.delete(e.button as MouseButton);
    this.updateModifiers(e);

    // Check for click vs drag
    const wasDragging = this.isDragging;
    const dragDistance = this.dragStart
      ? Math.sqrt(
          Math.pow(containerPos.x - this.dragStart.x, 2) +
          Math.pow(containerPos.y - this.dragStart.y, 2)
        )
      : 0;

    this.isDragging = false;
    this.dragStart = null;

    const event = this.createMouseEvent('mouseup', e);
    const handler = this.handlers.get(this.currentContext);

    if (handler?.onMouseUp?.(event, this.getInputState(), this.getDependencies())) {
      e.preventDefault();
    }

    // Emit click if it was a short drag
    if (wasDragging && dragDistance < 10) {
      this.handleClick(e);
    }
  }

  private handleClick(e: MouseEvent): void {
    const now = Date.now();
    const containerPos = this.clientToContainer(e.clientX, e.clientY);

    // Check for double-click
    let isDoubleClick = false;
    if (this.lastClick) {
      const timeDiff = now - this.lastClick.time;
      const distX = Math.abs(containerPos.x - this.lastClick.x);
      const distY = Math.abs(containerPos.y - this.lastClick.y);

      isDoubleClick =
        timeDiff < DOUBLE_CLICK_TIME &&
        distX < DOUBLE_CLICK_DISTANCE &&
        distY < DOUBLE_CLICK_DISTANCE;
    }

    this.lastClick = { time: now, x: containerPos.x, y: containerPos.y };

    const handler = this.handlers.get(this.currentContext);

    if (isDoubleClick) {
      const event = this.createMouseEvent('dblclick', e);
      handler?.onDoubleClick?.(event, this.getInputState(), this.getDependencies());
    } else {
      const event = this.createMouseEvent('click', e);
      handler?.onClick?.(event, this.getInputState(), this.getDependencies());
    }
  }

  private handleWheel(e: WheelEvent): void {
    this.updateModifiers(e);

    const event = this.createWheelEvent(e);
    const handler = this.handlers.get(this.currentContext);

    if (handler?.onWheel?.(event, this.getInputState(), this.getDependencies())) {
      e.preventDefault();
    }
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();

    const event = this.createMouseEvent('contextmenu', e);
    const handler = this.handlers.get(this.currentContext);

    handler?.onContextMenu?.(event, this.getInputState(), this.getDependencies());
  }

  private handleBlur(): void {
    // Clear all pressed keys on focus loss (prevents stuck keys)
    this.keysPressed.clear();
    this.mouseButtons.clear();
    this.modifiers = { shift: false, ctrl: false, alt: false, meta: false };

    // Cancel any active drag/selection
    this.isDragging = false;
    this.dragStart = null;
    this.cancelSelection();

    // Notify handler
    const handler = this.handlers.get(this.currentContext);
    handler?.onBlur?.();
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      this.handleBlur();
    }
  }

  // =============================================================================
  // EVENT CREATION HELPERS
  // =============================================================================

  private createKeyboardEvent(type: 'keydown' | 'keyup', e: KeyboardEvent): KeyboardInputEvent {
    return {
      type,
      timestamp: Date.now(),
      context: this.currentContext,
      modifiers: { ...this.modifiers },
      key: e.key.toLowerCase(),
      code: e.code,
      repeat: e.repeat,
    };
  }

  private createMouseEvent(type: MouseInputEvent['type'], e: MouseEvent): MouseInputEvent {
    const containerPos = this.clientToContainer(e.clientX, e.clientY);
    const worldPos = this.containerToWorld(containerPos.x, containerPos.y);

    return {
      type,
      timestamp: Date.now(),
      context: this.currentContext,
      modifiers: { ...this.modifiers },
      button: e.button as MouseButton,
      position: containerPos,
      worldPosition: worldPos,
    };
  }

  private createWheelEvent(e: WheelEvent): WheelInputEvent {
    return {
      type: 'wheel',
      timestamp: Date.now(),
      context: this.currentContext,
      modifiers: { ...this.modifiers },
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
    };
  }

  private updateModifiers(e: KeyboardEvent | MouseEvent): void {
    this.modifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };
  }

  private getDependencies(): InputHandlerDependencies {
    return {
      game: this.game,
      world: this.worldProvider,
      eventBus: this.eventBus,
      camera: this.camera,
      getLocalPlayerId: () => this.getLocalPlayerIdFn?.() ?? null,
    };
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Get the InputManager singleton instance
 */
export function getInputManager(): InputManager {
  return InputManager.getInstance();
}

/**
 * Get the InputManager singleton if it exists (returns null otherwise)
 */
export function getInputManagerSync(): InputManager | null {
  return InputManager.getInstanceSync();
}
