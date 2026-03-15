import { useGameStore } from '@/store/gameStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { getWorkerBridge, getRenderStateAdapter } from '@/engine/workers';
import type { GameCommand } from '@/engine/core/GameCommand';
import { InputManager } from '@/engine/input/InputManager';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { WALL_DEFINITIONS } from '@/data/buildings/walls';
import { CommandButtonData, MenuMode } from '../types';
import { BASIC_BUILDINGS, ADVANCED_BUILDINGS, WALL_BUILDINGS } from '../constants';

interface UseUnitCommandsParams {
  selectedUnits: number[];
  minerals: number;
  plasma: number;
  menuMode: MenuMode;
  setMenuMode: (mode: MenuMode) => void;
}

/**
 * Generate commands for selected units.
 */
export function useUnitCommands({
  selectedUnits,
  minerals,
  plasma,
  menuMode,
  setMenuMode,
}: UseUnitCommandsParams): CommandButtonData[] {
  const bridge = getWorkerBridge();
  const worldAdapter = getRenderStateAdapter();

  if (!bridge || selectedUnits.length === 0) return [];

  const entity = worldAdapter.getEntity(selectedUnits[0]);
  if (!entity) return [];

  const unit = entity.get<{
    unitId: string;
    playerId: string;
    state: string;
    isWorker: boolean;
    canRepair?: boolean;
    canTransform?: boolean;
    transformModes?: { id: string; name: string; isFlying?: boolean; transformTime?: number }[];
    currentMode?: string;
    transformProgress?: number;
    getCurrentMode?: () => { id: string; name: string };
  }>('Unit');

  if (!unit) return [];

  const buttons: CommandButtonData[] = [];
  const issueCommand = (command: Omit<GameCommand, 'tick' | 'playerId'>): void => {
    const localPlayer = getLocalPlayerId();
    if (!localPlayer) return;

    bridge.issueCommand({
      ...command,
      tick: bridge.currentTick,
      playerId: localPlayer,
    });
  };

  if (menuMode === 'main') {
    // Basic unit commands
    buttons.push({
      id: 'move',
      label: 'Move',
      shortcut: 'M',
      action: () => {
        useGameStore.getState().setCommandTargetMode('move');
      },
      tooltip: 'Click a destination for a move order',
    });

    buttons.push({
      id: 'stop',
      label: 'Stop',
      shortcut: 'S',
      action: () => {
        issueCommand({
          type: 'STOP',
          entityIds: selectedUnits,
        });
      },
      tooltip: 'Stop current action',
    });

    buttons.push({
      id: 'hold',
      label: 'Hold',
      shortcut: 'H',
      action: () => {
        issueCommand({
          type: 'HOLD',
          entityIds: selectedUnits,
        });
      },
      tooltip: 'Hold position - do not move to attack',
    });

    buttons.push({
      id: 'attack',
      label: 'Attack',
      shortcut: 'A',
      action: () => {
        useGameStore.getState().setCommandTargetMode('attack');
      },
      tooltip: 'Click a destination for an attack-move order',
    });

    buttons.push({
      id: 'patrol',
      label: 'Patrol',
      shortcut: 'P',
      action: () => {
        useGameStore.getState().setCommandTargetMode('patrol');
      },
      tooltip: 'Click a patrol destination',
    });

    // Transform commands for units that can transform (e.g., Valkyrie)
    if (unit.canTransform && unit.transformModes && unit.transformModes.length > 0) {
      const isTransforming = unit.state === 'transforming';

      for (const mode of unit.transformModes) {
        if (mode.id === unit.currentMode) continue;

        const isAirMode = mode.isFlying === true;
        const shortcut = isAirMode ? 'F' : 'E';

        let tooltip = `Transform to ${mode.name}`;
        if (isAirMode) {
          tooltip += ' - Flying, attacks air units only';
        } else {
          tooltip += ' - Ground, attacks ground units only';
        }
        tooltip += ` (${mode.transformTime}s)`;

        buttons.push({
          id: `transform_${mode.id}`,
          label: mode.name.replace(' Mode', ''),
          shortcut,
          action: () => {
            issueCommand({
              type: 'TRANSFORM',
              entityIds: selectedUnits,
              targetMode: mode.id,
            });
          },
          isDisabled: isTransforming,
          tooltip: isTransforming
            ? `Transforming... (${Math.round((unit.transformProgress ?? 0) * 100)}%)`
            : tooltip,
        });
      }
    }

    // Unit abilities
    const abilityComponent = entity.get<{
      getAbilityList?: () => Array<{
        definition: {
          id: string;
          name: string;
          hotkey: string;
          targetType: string;
          energyCost?: number;
          description?: string;
        };
        cooldownRemaining?: number;
        currentCooldown?: number;
      }>;
      canUseAbility?: (id: string) => boolean;
    }>('Ability');

    if (abilityComponent && abilityComponent.getAbilityList) {
      const abilities = abilityComponent.getAbilityList();
      for (const abilityState of abilities) {
        const def = abilityState.definition;
        const canUse = abilityComponent.canUseAbility?.(def.id) ?? true;
        const energyCost = def.energyCost;

        buttons.push({
          id: `ability_${def.id}`,
          label: def.name,
          shortcut: def.hotkey,
          action: () => {
            if (
              def.targetType === 'point' ||
              def.targetType === 'unit' ||
              def.targetType === 'ally'
            ) {
              useGameStore.getState().setAbilityTargetMode(def.id);
            } else {
              issueCommand({
                type: 'ABILITY',
                entityIds: selectedUnits,
                abilityId: def.id,
              });
            }
          },
          isDisabled: !canUse,
          tooltip:
            (def.description ?? def.name) +
            ((abilityState.currentCooldown ?? 0) > 0
              ? ` (CD: ${Math.ceil(abilityState.currentCooldown ?? 0)}s)`
              : ''),
          cost:
            (energyCost ?? 0) > 0 ? { minerals: 0, plasma: 0, supply: energyCost ?? 0 } : undefined,
        });
      }
    }

    // Worker-specific commands
    if (unit.isWorker) {
      if (unit.canRepair) {
        buttons.push({
          id: 'repair',
          label: 'Repair',
          shortcut: 'R',
          action: () => {
            useGameStore.getState().setRepairMode(true);
          },
          tooltip: 'Repair buildings and mechanical units (right-click on damaged target)',
        });
      }

      buttons.push({
        id: 'build_basic',
        label: 'Build Basic',
        shortcut: 'B',
        action: () => setMenuMode('build_basic'),
        tooltip: 'Build basic structures',
      });

      buttons.push({
        id: 'build_advanced',
        label: 'Advanced',
        shortcut: 'V',
        action: () => setMenuMode('build_advanced'),
        tooltip: 'Build advanced structures',
      });

      buttons.push({
        id: 'build_walls',
        label: 'Build Walls',
        shortcut: 'W',
        action: () => setMenuMode('build_walls'),
        tooltip: 'Build walls and gates (click+drag for lines)',
      });
    }
  } else if (
    menuMode === 'build_basic' ||
    menuMode === 'build_advanced' ||
    menuMode === 'build_walls'
  ) {
    // Back button
    buttons.push({
      id: 'back',
      label: 'Back',
      shortcut: 'ESC',
      action: () => setMenuMode('main'),
      tooltip: 'Return to main commands',
    });

    // Building buttons for the selected category
    const buildingList =
      menuMode === 'build_basic'
        ? BASIC_BUILDINGS
        : menuMode === 'build_advanced'
          ? ADVANCED_BUILDINGS
          : WALL_BUILDINGS;

    const checkRequirementsMet = (
      requirements: string[] | undefined
    ): { met: boolean; missing: string[] } => {
      if (!requirements || requirements.length === 0) {
        return { met: true, missing: [] };
      }

      const localPlayerId = getLocalPlayerId();
      if (!localPlayerId) return { met: false, missing: requirements };

      const playerBuildings = worldAdapter.getEntitiesWith('Building', 'Selectable');
      const missing: string[] = [];

      for (const reqBuildingId of requirements) {
        let found = false;
        for (const buildingEntity of playerBuildings) {
          const b = buildingEntity.get<{
            buildingId: string;
            state: string;
            isComplete?: () => boolean;
          }>('Building');
          const sel = buildingEntity.get<{ playerId: string }>('Selectable');
          const isComplete = b?.isComplete?.() ?? b?.state === 'complete';
          if (sel?.playerId === localPlayerId && b?.buildingId === reqBuildingId && isComplete) {
            found = true;
            break;
          }
        }
        if (!found) {
          missing.push(BUILDING_DEFINITIONS[reqBuildingId]?.name || reqBuildingId);
        }
      }

      return { met: missing.length === 0, missing };
    };

    buildingList.forEach((buildingId) => {
      const def = BUILDING_DEFINITIONS[buildingId] || WALL_DEFINITIONS[buildingId];
      if (!def) return;

      const reqCheck = checkRequirementsMet(def.requirements);
      const requirementsMet = reqCheck.met;
      const reqText = reqCheck.missing.length > 0 ? `Requires: ${reqCheck.missing.join(', ')}` : '';

      const canAfford = minerals >= def.mineralCost && plasma >= def.plasmaCost;

      let tooltip = def.description || `Build ${def.name}`;
      if (reqText) {
        tooltip += ` (${reqText})`;
      }

      const isWall = 'isWall' in def && def.isWall;
      if (isWall) {
        tooltip += ' (Click+drag to draw wall line)';
      }

      buttons.push({
        id: `build_${buildingId}`,
        label: def.name,
        shortcut: def.name.charAt(0).toUpperCase(),
        action: () => {
          if (requirementsMet) {
            const inputManager = InputManager.getInstanceSync();
            if (isWall) {
              useGameStore.getState().setWallPlacementMode(true, buildingId);
              inputManager?.setContext('wall');
            } else {
              useGameStore.getState().setBuildingMode(buildingId);
              inputManager?.setContext('building');
            }
          }
        },
        isDisabled: !canAfford || !requirementsMet,
        tooltip,
        cost: { minerals: def.mineralCost, plasma: def.plasmaCost },
      });
    });
  }

  return buttons;
}
