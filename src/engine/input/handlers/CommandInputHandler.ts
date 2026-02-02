/**
 * CommandInputHandler - Handles command targeting modes
 *
 * Processes input for command contexts (attack-move, patrol, move)
 * where the player is selecting a target position.
 */

import type {
  InputHandler,
  InputState,
  InputHandlerDependencies,
  KeyboardInputEvent,
  MouseInputEvent,
} from '../types';
import { MouseButton } from '../types';
import { InputManager } from '../InputManager';
import { useGameStore } from '@/store/gameStore';

export class CommandInputHandler implements InputHandler {
  onActivate(): void {
    // Command mode activated
  }

  onDeactivate(): void {
    // Clear command mode when leaving
    useGameStore.getState().setCommandTargetMode(null);
  }

  onKeyDown(
    event: KeyboardInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    if (event.key === 'escape') {
      useGameStore.getState().setCommandTargetMode(null);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }
    return false;
  }

  onMouseDown(
    event: MouseInputEvent,
    state: InputState,
    deps: InputHandlerDependencies
  ): boolean {
    const { game, eventBus, getLocalPlayerId } = deps;
    const commandMode = useGameStore.getState().commandTargetMode;

    // Right-click cancels command mode
    if (event.button === MouseButton.Right) {
      useGameStore.getState().setCommandTargetMode(null);
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    // Left-click executes command
    if (event.button === MouseButton.Left && event.worldPosition && game) {
      const selectedUnits = useGameStore.getState().selectedUnits;
      const localPlayer = getLocalPlayerId();

      if (selectedUnits.length === 0 || !localPlayer) {
        useGameStore.getState().setCommandTargetMode(null);
        InputManager.getInstance().setContext('gameplay');
        return true;
      }

      const targetPos = { x: event.worldPosition.x, y: event.worldPosition.z };

      switch (commandMode) {
        case 'attack':
          // Use ATTACK_MOVE when clicking ground (no target entity)
          // This ensures MovementOrchestrator handles pathfinding
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'ATTACK_MOVE',
            entityIds: selectedUnits,
            targetPosition: targetPos,
            queue: state.modifiers.shift,
          });
          eventBus?.emit('command:attackGround', {
            targetPosition: targetPos,
            playerId: localPlayer,
          });
          break;

        case 'patrol':
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'PATROL',
            entityIds: selectedUnits,
            targetPosition: targetPos,
            queue: state.modifiers.shift,
          });
          break;

        case 'move':
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayer,
            type: 'MOVE',
            entityIds: selectedUnits,
            targetPosition: targetPos,
            queue: state.modifiers.shift,
          });
          eventBus?.emit('command:moveGround', {
            targetPosition: targetPos,
            playerId: localPlayer,
          });
          break;
      }

      // Stay in command mode if shift is held
      if (!state.modifiers.shift) {
        useGameStore.getState().setCommandTargetMode(null);
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    return false;
  }

  onBlur(): void {
    useGameStore.getState().setCommandTargetMode(null);
    InputManager.getInstance().setContext('gameplay');
  }
}
