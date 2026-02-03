import { useGameStore } from '@/store/gameStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { Game } from '@/engine/core/Game';
import { getWorkerBridge, getRenderStateAdapter } from '@/engine/workers';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS, RESEARCH_MODULE_UNITS } from '@/data/buildings/dominion';
import { RESEARCH_DEFINITIONS } from '@/data/research/dominion';
import { getAttackTypeText } from '@/utils/commandIcons';
import { CommandButtonData } from '../types';
import { BUILDING_RESEARCH_MAP } from '../constants';

interface UseBuildingCommandsParams {
  selectedUnits: number[];
  minerals: number;
  plasma: number;
  supply: number;
  maxSupply: number;
}

/**
 * Generate commands for selected buildings.
 */
export function useBuildingCommands({
  selectedUnits,
  minerals,
  plasma,
  supply,
  maxSupply,
}: UseBuildingCommandsParams): CommandButtonData[] {
  const bridge = getWorkerBridge();
  const worldAdapter = getRenderStateAdapter();
  const game = Game.getInstance();

  if (!bridge || selectedUnits.length === 0) return [];

  const entity = worldAdapter.getEntity(selectedUnits[0]);
  if (!entity) return [];

  const building = entity.get<{
    buildingId: string;
    playerId: string;
    state: string;
    buildProgress: number;
    width: number;
    height: number;
    isFlying?: boolean;
    canProduce?: string[];
    canLiftOff?: boolean;
    canUpgradeTo?: string[];
    canHaveAddon?: boolean;
    productionQueue?: {
      id: string;
      type: string;
      progress: number;
      buildTime: number;
      supplyAllocated: boolean;
      produceCount?: number;
    }[];
    isComplete?: () => boolean;
    hasAddon?: () => boolean;
    hasTechLab?: () => boolean;
  }>('Building');

  if (!building) return [];

  const buttons: CommandButtonData[] = [];
  const isComplete = building.isComplete?.() ?? building.state === 'complete';
  const isFlying =
    building.state === 'flying' || building.state === 'lifting' || building.state === 'landing';

  // Building under construction
  if (!isComplete && building.state !== 'destroyed' && !isFlying) {
    buttons.push({
      id: 'demolish',
      label: 'Cancel',
      shortcut: 'ESC',
      action: () => {
        const localPlayer = getLocalPlayerId();
        if (localPlayer && bridge) {
          bridge.issueCommand({
            tick: bridge.currentTick,
            playerId: localPlayer,
            type: 'DEMOLISH',
            entityIds: selectedUnits,
          });
        }
      },
      tooltip: 'Cancel construction (refunds 75% of resources spent)',
    });
    return buttons;
  }

  // Complete or flying buildings
  if (!isComplete && !isFlying) return [];

  // Wall/gate commands
  const wall = entity.get<{
    isWall?: boolean;
    isGate?: boolean;
    gateOpenProgress?: number;
    gateState?: string;
    appliedUpgrade?: string;
    upgradeInProgress?: boolean;
    mountedTurretId?: string;
  }>('Wall');

  if (wall && !isFlying) {
    if (wall.isGate) {
      buttons.push({
        id: 'gate_toggle',
        label: (wall.gateOpenProgress ?? 0) > 0.5 ? 'Close' : 'Open',
        shortcut: 'O',
        action: () => {
          bridge.eventBus.emit('command:gate_toggle', { entityIds: selectedUnits });
        },
        tooltip: (wall.gateOpenProgress ?? 0) > 0.5 ? 'Close the gate' : 'Open the gate',
      });

      buttons.push({
        id: 'gate_lock',
        label: wall.gateState === 'locked' ? 'Unlock' : 'Lock',
        shortcut: 'L',
        action: () => {
          bridge.eventBus.emit('command:gate_lock', { entityIds: selectedUnits });
        },
        tooltip: wall.gateState === 'locked' ? 'Unlock the gate' : 'Lock the gate (prevents opening)',
      });

      if (wall.gateState !== 'auto') {
        buttons.push({
          id: 'gate_auto',
          label: 'Auto',
          shortcut: 'A',
          action: () => {
            bridge.eventBus.emit('command:gate_auto', { entityIds: selectedUnits });
          },
          tooltip: 'Set gate to auto-open for friendly units',
        });
      }
    }

    // Wall upgrades
    const store = useGameStore.getState();
    const localPlayer = getLocalPlayerId() ?? 'player1';

    if (!wall.appliedUpgrade && wall.upgradeInProgress === null) {
      if (store.hasResearch(localPlayer, 'wall_reinforced')) {
        buttons.push({
          id: 'wall_upgrade_reinforced',
          label: 'Reinforce',
          shortcut: 'R',
          action: () => {
            bridge.eventBus.emit('command:wall_upgrade', {
              entityIds: selectedUnits,
              upgradeType: 'reinforced',
            });
          },
          tooltip: 'Reinforce wall: +400 HP, +2 armor',
          cost: { minerals: 25, plasma: 0 },
        });
      }

      if (store.hasResearch(localPlayer, 'wall_shielded')) {
        buttons.push({
          id: 'wall_upgrade_shielded',
          label: 'Shield',
          shortcut: 'S',
          action: () => {
            bridge.eventBus.emit('command:wall_upgrade', {
              entityIds: selectedUnits,
              upgradeType: 'shielded',
            });
          },
          tooltip: 'Add shield: +200 regenerating shield',
          cost: { minerals: 50, plasma: 25 },
        });
      }

      if (store.hasResearch(localPlayer, 'wall_weapon') && wall.mountedTurretId === null) {
        buttons.push({
          id: 'wall_upgrade_weapon',
          label: 'Weapon',
          shortcut: 'W',
          action: () => {
            bridge.eventBus.emit('command:wall_upgrade', {
              entityIds: selectedUnits,
              upgradeType: 'weapon',
            });
          },
          tooltip: 'Add auto-turret: 5 damage, 6 range',
          cost: { minerals: 40, plasma: 25 },
        });
      }
    }
  }

  // Tech-gated units
  const techUnits = RESEARCH_MODULE_UNITS[building.buildingId] || [];
  const hasTechLab = (building.hasAddon?.() ?? false) && (building.hasTechLab?.() ?? false);

  // Training commands (skip when flying)
  if (!isFlying && building.canProduce) {
    building.canProduce.forEach((unitId) => {
      const unitDef = UNIT_DEFINITIONS[unitId];
      if (!unitDef) return;

      const canAfford = minerals >= unitDef.mineralCost && plasma >= unitDef.plasmaCost;
      const hasSupply = supply + unitDef.supplyCost <= maxSupply;
      const attackTypeText = getAttackTypeText(unitDef);

      buttons.push({
        id: `train_${unitId}`,
        label: unitDef.name,
        shortcut: unitDef.name.charAt(0).toUpperCase(),
        action: () => {
          if (!hasSupply) {
            bridge.eventBus.emit('alert:supplyBlocked', {});
          }
          bridge.eventBus.emit('command:train', {
            entityIds: selectedUnits,
            unitType: unitId,
          });
        },
        isDisabled: !canAfford,
        tooltip:
          (unitDef.description || `Train ${unitDef.name}`) +
          ` [${attackTypeText}]` +
          (!hasSupply ? ' (Need more supply)' : ''),
        cost: { minerals: unitDef.mineralCost, plasma: unitDef.plasmaCost, supply: unitDef.supplyCost },
      });
    });
  }

  if (!isFlying) {
    // Tech-gated units from Research Module
    techUnits.forEach((unitId) => {
      const unitDef = UNIT_DEFINITIONS[unitId];
      if (!unitDef) return;

      const canAfford = minerals >= unitDef.mineralCost && plasma >= unitDef.plasmaCost;
      const hasSupply = supply + unitDef.supplyCost <= maxSupply;
      const canTrain = hasTechLab && canAfford;
      const attackTypeText = getAttackTypeText(unitDef);

      let tooltipText = (unitDef.description || `Train ${unitDef.name}`) + ` [${attackTypeText}]`;
      if (!hasTechLab) {
        tooltipText += ' - Requires Research Module';
      } else if (!hasSupply) {
        tooltipText += ' (Need more supply)';
      }

      buttons.push({
        id: `train_${unitId}`,
        label: unitDef.name,
        shortcut: unitDef.name.charAt(0).toUpperCase(),
        action: () => {
          if (hasTechLab) {
            if (!hasSupply) {
              bridge.eventBus.emit('alert:supplyBlocked', {});
            }
            bridge.eventBus.emit('command:train', {
              entityIds: selectedUnits,
              unitType: unitId,
            });
          }
        },
        isDisabled: !canTrain,
        tooltip: tooltipText,
        cost: { minerals: unitDef.mineralCost, plasma: unitDef.plasmaCost, supply: unitDef.supplyCost },
      });
    });

    // Addon buttons
    if (building.canHaveAddon && !(building.hasAddon?.() ?? false)) {
      const moduleDef = BUILDING_DEFINITIONS['research_module'];
      if (moduleDef) {
        const canAffordModule = minerals >= moduleDef.mineralCost && plasma >= moduleDef.plasmaCost;
        const localPlayer = getLocalPlayerId();
        buttons.push({
          id: 'build_research_module',
          label: 'Tech Lab',
          shortcut: 'T',
          action: () => {
            const currentBridge = getWorkerBridge();
            const currentSelectedUnits = useGameStore.getState().selectedUnits;
            if (currentBridge && currentSelectedUnits.length > 0) {
              currentBridge.eventBus.emit('building:build_addon', {
                buildingId: currentSelectedUnits[0],
                addonType: 'research_module',
                playerId: localPlayer,
              });
            }
          },
          isDisabled: !canAffordModule,
          tooltip: moduleDef.description || 'Addon that unlocks advanced units and research.',
          cost: { minerals: moduleDef.mineralCost, plasma: moduleDef.plasmaCost },
        });
      }

      const reactorDef = BUILDING_DEFINITIONS['production_module'];
      if (reactorDef) {
        const canAffordReactor = minerals >= reactorDef.mineralCost && plasma >= reactorDef.plasmaCost;
        const localPlayer = getLocalPlayerId();
        buttons.push({
          id: 'build_production_module',
          label: 'Reactor',
          shortcut: 'C',
          action: () => {
            const currentGame = Game.getInstance();
            const currentSelectedUnits = useGameStore.getState().selectedUnits;
            if (currentGame && currentSelectedUnits.length > 0) {
              currentGame.eventBus.emit('building:build_addon', {
                buildingId: currentSelectedUnits[0],
                addonType: 'production_module',
                playerId: localPlayer,
              });
            }
          },
          isDisabled: !canAffordReactor,
          tooltip: reactorDef.description || 'Addon that enables double production of basic units.',
          cost: { minerals: reactorDef.mineralCost, plasma: reactorDef.plasmaCost },
        });
      }
    }

    // Research commands
    const store = useGameStore.getState();
    const availableResearch = BUILDING_RESEARCH_MAP[building.buildingId] || [];
    const localPlayerForResearch = getLocalPlayerId() ?? 'player1';

    availableResearch.forEach((upgradeId) => {
      const upgrade = RESEARCH_DEFINITIONS[upgradeId];
      if (!upgrade) return;

      const isResearched = store.hasResearch(localPlayerForResearch, upgradeId);
      if (isResearched) return;

      let reqMet = true;
      if (upgrade.requirements) {
        for (const req of upgrade.requirements) {
          if (RESEARCH_DEFINITIONS[req] && !store.hasResearch(localPlayerForResearch, req)) {
            reqMet = false;
            break;
          }
        }
      }

      const isResearching = (building.productionQueue ?? []).some(
        (item) => item.type === 'upgrade' && item.id === upgradeId
      );

      buttons.push({
        id: `research_${upgradeId}`,
        label: upgrade.name,
        shortcut: upgrade.name.charAt(0).toUpperCase(),
        action: () => {
          bridge.eventBus.emit('command:research', {
            entityIds: selectedUnits,
            upgradeId,
          });
        },
        isDisabled: minerals < upgrade.mineralCost || plasma < upgrade.plasmaCost || !reqMet || isResearching,
        tooltip: upgrade.description + (isResearching ? ' (In progress)' : ''),
        cost: { minerals: upgrade.mineralCost, plasma: upgrade.plasmaCost },
      });
    });

    // Building upgrade buttons
    if (building.canUpgradeTo && building.canUpgradeTo.length > 0) {
      const isUpgrading = (building.productionQueue ?? []).some(
        (item) => item.type === 'upgrade' && (building.canUpgradeTo ?? []).includes(item.id)
      );

      building.canUpgradeTo.forEach((upgradeBuildingId) => {
        const upgradeDef = BUILDING_DEFINITIONS[upgradeBuildingId];
        if (!upgradeDef) return;

        const canAfford = minerals >= upgradeDef.mineralCost && plasma >= upgradeDef.plasmaCost;
        const words = upgradeDef.name.split(' ');
        const shortcut = words[words.length - 1].charAt(0).toUpperCase();

        buttons.push({
          id: `upgrade_${upgradeBuildingId}`,
          label: upgradeDef.name,
          shortcut,
          action: () => {
            bridge.eventBus.emit('command:upgrade_building', {
              entityIds: selectedUnits,
              upgradeTo: upgradeBuildingId,
            });
          },
          isDisabled: !canAfford || isUpgrading,
          tooltip:
            (upgradeDef.description || `Upgrade to ${upgradeDef.name}`) +
            (isUpgrading ? ' (Upgrading...)' : ''),
          cost: { minerals: upgradeDef.mineralCost, plasma: upgradeDef.plasmaCost },
        });
      });
    }

    // Rally point
    if ((building.canProduce ?? []).length > 0) {
      buttons.push({
        id: 'rally',
        label: 'Rally',
        shortcut: 'R',
        action: () => {
          useGameStore.getState().setRallyPointMode(true);
        },
        tooltip: 'Set rally point for new units',
      });
    }

    // Demolish button
    buttons.push({
      id: 'demolish',
      label: 'Demolish',
      shortcut: 'DEL',
      action: () => {
        const localPlayer = getLocalPlayerId();
        if (localPlayer) {
          bridge.issueCommand({
            tick: bridge.currentTick,
            playerId: localPlayer,
            type: 'DEMOLISH',
            entityIds: selectedUnits,
          });
        }
      },
      tooltip: 'Demolish building (refunds 50% of resources)',
    });
  }

  // Lift-off button
  if (building.canLiftOff && building.state === 'complete' && !building.isFlying) {
    const hasQueue = (building.productionQueue ?? []).length > 0;
    buttons.push({
      id: 'liftoff',
      label: 'Lift Off',
      shortcut: 'L',
      action: () => {
        if (!hasQueue) {
          const localPlayer = getLocalPlayerId();
          if (localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'LIFTOFF',
              entityIds: [selectedUnits[0]],
              buildingId: selectedUnits[0],
            });
          }
        }
      },
      isDisabled: hasQueue,
      tooltip: hasQueue ? 'Cannot lift off while producing' : 'Lift off to relocate building',
    });
  }

  // Land button
  if (building.canLiftOff && building.isFlying && building.state === 'flying') {
    buttons.push({
      id: 'land',
      label: 'Land',
      shortcut: 'L',
      action: () => {
        useGameStore.getState().setLandingMode(true, selectedUnits[0]);
      },
      tooltip: 'Click to choose landing location',
    });
  }

  // Building abilities
  const buildingAbilityComponent = entity.get<{
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

  if (buildingAbilityComponent && buildingAbilityComponent.getAbilityList) {
    const abilities = buildingAbilityComponent.getAbilityList();
    for (const abilityState of abilities) {
      const def = abilityState.definition;
      const canUse = buildingAbilityComponent.canUseAbility?.(def.id) ?? true;
      const energyCost = def.energyCost;

      buttons.push({
        id: `ability_${def.id}`,
        label: def.name,
        shortcut: def.hotkey,
        action: () => {
          if (def.targetType === 'point' || def.targetType === 'unit') {
            useGameStore.getState().setAbilityTargetMode(def.id);
          } else {
            bridge.eventBus.emit('command:ability', {
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
        cost: (energyCost ?? 0) > 0 ? { minerals: 0, plasma: 0, supply: energyCost ?? 0 } : undefined,
      });
    }
  }

  return buttons;
}
