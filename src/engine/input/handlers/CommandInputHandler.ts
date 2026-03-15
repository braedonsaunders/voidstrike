/**
 * CommandInputHandler - Handles targeted command modes.
 *
 * Each instance is bound to a specific targeting context so mode cleanup
 * only resets the state it owns.
 */

import type {
  InputHandler,
  InputHandlerDependencies,
  InputState,
  KeyboardInputEvent,
  MouseInputEvent,
} from '../types';
import { MouseButton } from '../types';
import { InputManager } from '../InputManager';
import { Resource } from '@/engine/components/Resource';
import { findEntityAtScreenPosition } from './findEntityAtScreenPosition';
import { useGameStore } from '@/store/gameStore';

type CommandHandlerMode = 'command' | 'ability' | 'rally' | 'repair';
type AbilityTargetType = 'none' | 'point' | 'unit' | 'ally' | 'self';

export class CommandInputHandler implements InputHandler {
  constructor(private readonly mode: CommandHandlerMode) {}

  onActivate(): void {}

  onDeactivate(): void {
    const store = useGameStore.getState();

    switch (this.mode) {
      case 'command':
        if (store.commandTargetMode) {
          store.setCommandTargetMode(null);
        }
        break;
      case 'ability':
        if (store.abilityTargetMode) {
          store.setAbilityTargetMode(null);
        }
        break;
      case 'rally':
        if (store.isSettingRallyPoint) {
          store.setRallyPointMode(false);
        }
        break;
      case 'repair':
        if (store.isRepairMode) {
          store.setRepairMode(false);
        }
        break;
    }
  }

  onKeyDown(
    event: KeyboardInputEvent,
    _state: InputState,
    _deps: InputHandlerDependencies
  ): boolean {
    if (event.key === 'escape') {
      this.clearMode();
      InputManager.getInstance().setContext('gameplay');
      return true;
    }
    return false;
  }

  onMouseDown(event: MouseInputEvent, state: InputState, deps: InputHandlerDependencies): boolean {
    const { game, eventBus, world, camera, getLocalPlayerId } = deps;
    const store = useGameStore.getState();
    const localPlayer = getLocalPlayerId();
    const selectedUnits = store.selectedUnits;

    if (this.mode === 'command') {
      const commandMode = store.commandTargetMode;

      if (event.button === MouseButton.Right) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
        return true;
      }

      if (event.button !== MouseButton.Left || !event.worldPosition || !game) {
        return false;
      }

      if (selectedUnits.length === 0 || !localPlayer) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
        return true;
      }

      const targetPos = { x: event.worldPosition.x, y: event.worldPosition.z };

      switch (commandMode) {
        case 'attack':
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

      if (!state.modifiers.shift) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    if (selectedUnits.length === 0 || !localPlayer || !game) {
      this.clearMode();
      InputManager.getInstance().setContext('gameplay');
      return true;
    }

    if (this.mode === 'ability') {
      if (event.button === MouseButton.Right) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
        return true;
      }

      if (event.button !== MouseButton.Left || !event.worldPosition) {
        return false;
      }

      const abilityId = store.abilityTargetMode;
      const targetType = this.getAbilityTargetType(world, selectedUnits[0], abilityId);
      if (!abilityId || !targetType) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
        return true;
      }

      if (targetType === 'point') {
        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'ABILITY',
          entityIds: selectedUnits,
          abilityId,
          targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
          queue: state.modifiers.shift,
        });
      } else {
        const clickedEntity = findEntityAtScreenPosition(
          world,
          event.position.x,
          event.position.y,
          camera
        );
        if (!clickedEntity) {
          return true;
        }

        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'ABILITY',
          entityIds: selectedUnits,
          abilityId,
          targetEntityId: clickedEntity.id,
          queue: state.modifiers.shift,
        });
      }

      if (!state.modifiers.shift) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    if (!event.worldPosition) {
      return false;
    }

    if (
      this.mode === 'repair' &&
      (event.button === MouseButton.Left || event.button === MouseButton.Right)
    ) {
      const clickedEntity = findEntityAtScreenPosition(
        world,
        event.position.x,
        event.position.y,
        camera
      );
      if (!clickedEntity) {
        return true;
      }

      for (const repairerId of selectedUnits) {
        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'REPAIR',
          entityIds: [repairerId],
          targetEntityId: clickedEntity.id,
          queue: state.modifiers.shift,
        });
      }

      if (!state.modifiers.shift) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    if (
      this.mode === 'rally' &&
      (event.button === MouseButton.Left || event.button === MouseButton.Right)
    ) {
      const clickedEntity = findEntityAtScreenPosition(
        world,
        event.position.x,
        event.position.y,
        camera
      );
      const resource = clickedEntity?.get<Resource>('Resource');

      for (const buildingId of selectedUnits) {
        game.issueCommand({
          tick: game.getCurrentTick(),
          playerId: localPlayer,
          type: 'RALLY',
          entityIds: [buildingId],
          buildingId,
          targetPosition: { x: event.worldPosition.x, y: event.worldPosition.z },
          targetEntityId: resource ? clickedEntity!.id : undefined,
          queue: state.modifiers.shift,
        });
      }

      if (!state.modifiers.shift) {
        this.clearMode();
        InputManager.getInstance().setContext('gameplay');
      }

      return true;
    }

    return false;
  }

  onBlur(): void {
    this.clearMode();
    InputManager.getInstance().setContext('gameplay');
  }

  private clearMode(): void {
    switch (this.mode) {
      case 'command':
        useGameStore.getState().setCommandTargetMode(null);
        break;
      case 'ability':
        useGameStore.getState().setAbilityTargetMode(null);
        break;
      case 'rally':
        useGameStore.getState().setRallyPointMode(false);
        break;
      case 'repair':
        useGameStore.getState().setRepairMode(false);
        break;
    }
  }

  private getAbilityTargetType(
    world: InputHandlerDependencies['world'],
    entityId: number,
    abilityId: string | null
  ): AbilityTargetType | null {
    if (!world || !abilityId) return null;

    const entity = world.getEntity(entityId);
    const abilityComponent = entity?.get<{
      getAbility?: (id: string) =>
        | {
            definition: { targetType: AbilityTargetType };
          }
        | undefined;
    }>('Ability');

    return abilityComponent?.getAbility?.(abilityId)?.definition.targetType ?? null;
  }
}
