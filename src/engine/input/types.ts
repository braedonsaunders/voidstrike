/**
 * Input System Types
 *
 * Type definitions for the centralized input management system.
 * Follows AAA game input patterns with context-based routing.
 */

import type { EventBus } from '../core/EventBus';
import type { Game } from '../core/Game';
import type { RTSCamera } from '@/rendering/Camera';
import type { IWorldProvider } from '../ecs/IWorldProvider';

// =============================================================================
// INPUT CONTEXTS
// =============================================================================

/**
 * Input contexts determine how input events are interpreted.
 * Only one context is active at a time.
 */
export type InputContext =
  | 'gameplay'       // Normal gameplay - selection, movement, commands
  | 'building'       // Building placement mode
  | 'wall'           // Wall placement mode
  | 'ability'        // Ability targeting mode
  | 'command'        // Command targeting (attack-move, patrol, etc.)
  | 'rally'          // Rally point setting mode
  | 'repair'         // Repair mode
  | 'landing'        // Flying building landing mode
  | 'menu'           // Menu/UI interaction (input mostly disabled)
  | 'spectator';     // Spectator mode (limited commands)

// =============================================================================
// INPUT STATE
// =============================================================================

/**
 * Mouse button identifiers
 */
export const enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2,
}

/**
 * Current state of all input devices
 */
export interface InputState {
  // Keyboard
  readonly keysPressed: ReadonlySet<string>;
  readonly modifiers: {
    readonly shift: boolean;
    readonly ctrl: boolean;
    readonly alt: boolean;
    readonly meta: boolean;
  };

  // Mouse
  readonly mousePosition: { readonly x: number; readonly y: number };
  readonly mouseButtons: ReadonlySet<MouseButton>;
  readonly mouseInBounds: boolean;

  // Derived
  readonly isDragging: boolean;
  readonly dragStart: { readonly x: number; readonly y: number } | null;
}

/**
 * Selection box state for drag selection
 */
export interface SelectionState {
  isSelecting: boolean;
  selectionStart: { x: number; y: number };
  selectionEnd: { x: number; y: number };
}

// =============================================================================
// INPUT EVENTS (Internal)
// =============================================================================

/**
 * Normalized input event with common properties
 */
export interface InputEvent {
  readonly timestamp: number;
  readonly context: InputContext;
  readonly modifiers: InputState['modifiers'];
}

/**
 * Keyboard input event
 */
export interface KeyboardInputEvent extends InputEvent {
  readonly type: 'keydown' | 'keyup';
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
}

/**
 * Mouse input event
 */
export interface MouseInputEvent extends InputEvent {
  readonly type: 'mousedown' | 'mouseup' | 'mousemove' | 'click' | 'dblclick' | 'contextmenu';
  readonly button: MouseButton;
  readonly position: { readonly x: number; readonly y: number };
  readonly worldPosition: { readonly x: number; readonly z: number } | null;
}

/**
 * Wheel input event
 */
export interface WheelInputEvent extends InputEvent {
  readonly type: 'wheel';
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
}

// =============================================================================
// INPUT HANDLER INTERFACE
// =============================================================================

/**
 * Dependencies provided to input handlers
 */
export interface InputHandlerDependencies {
  readonly game: Game | null;
  readonly world: IWorldProvider | null;
  readonly eventBus: EventBus | null;
  readonly camera: RTSCamera | null;
  readonly getLocalPlayerId: () => string | null;
}

/**
 * Interface for context-specific input handlers.
 * Each handler processes input for its specific context.
 */
export interface InputHandler {
  /**
   * Called when this handler becomes active
   */
  onActivate?(deps: InputHandlerDependencies): void;

  /**
   * Called when this handler becomes inactive
   */
  onDeactivate?(): void;

  /**
   * Handle keyboard events
   * @returns true if the event was consumed and should not propagate
   */
  onKeyDown?(event: KeyboardInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onKeyUp?(event: KeyboardInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;

  /**
   * Handle mouse events
   * @returns true if the event was consumed and should not propagate
   */
  onMouseDown?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onMouseUp?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onMouseMove?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onClick?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onDoubleClick?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;
  onContextMenu?(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;

  /**
   * Handle wheel events
   * @returns true if the event was consumed
   */
  onWheel?(event: WheelInputEvent, state: InputState, deps: InputHandlerDependencies): boolean;

  /**
   * Called when window loses focus - opportunity to cancel operations
   */
  onBlur?(): void;

  /**
   * Called every frame for handlers that need continuous updates
   */
  onUpdate?(deltaTime: number, state: InputState, deps: InputHandlerDependencies): void;
}

// =============================================================================
// INPUT MANAGER EVENTS
// =============================================================================

/**
 * Events emitted by the InputManager for external observation
 */
export interface InputManagerEvents {
  'input:contextChanged': { previous: InputContext; current: InputContext };
  'input:selectionChanged': SelectionState;
}

// =============================================================================
// COMMAND TYPES FOR MULTIPLAYER BUFFERING
// =============================================================================

/**
 * Input command for multiplayer synchronization.
 * All game-affecting inputs are buffered as commands.
 */
export interface InputCommand {
  readonly tick: number;
  readonly playerId: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

/**
 * Input buffer for deterministic multiplayer
 */
export interface InputBuffer {
  readonly commands: InputCommand[];
  readonly currentTick: number;
  add(command: InputCommand): void;
  getCommandsForTick(tick: number): InputCommand[];
  clear(): void;
}
