/**
 * Input System Module
 *
 * Centralized input management for the game.
 *
 * Usage:
 * ```typescript
 * import { InputManager, GameplayInputHandler } from '@/engine/input';
 *
 * // Initialize
 * const inputManager = InputManager.getInstance();
 * inputManager.registerHandler('gameplay', new GameplayInputHandler());
 * inputManager.initialize(container, { camera, game, eventBus });
 *
 * // Change context
 * inputManager.setContext('building');
 *
 * // Cleanup
 * inputManager.dispose();
 * ```
 */

// Core
export { InputManager, getInputManager, getInputManagerSync } from './InputManager';

// Types
export type {
  InputContext,
  InputState,
  SelectionState,
  InputHandler,
  InputHandlerDependencies,
  KeyboardInputEvent,
  MouseInputEvent,
  WheelInputEvent,
  InputManagerEvents,
  InputCommand,
  InputBuffer,
} from './types';
export { MouseButton } from './types';

// Handlers
export {
  GameplayInputHandler,
  CommandInputHandler,
  BuildingInputHandler,
} from './handlers';
