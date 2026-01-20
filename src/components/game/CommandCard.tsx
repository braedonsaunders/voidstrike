'use client';

import { useGameStore } from '@/store/gameStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';
import { Game } from '@/engine/core/Game';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Ability } from '@/engine/components/Ability';
import { Selectable } from '@/engine/components/Selectable';
import { useEffect, useState, memo, useCallback, useMemo } from 'react';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS, RESEARCH_MODULE_UNITS } from '@/data/buildings/dominion';
import { WALL_DEFINITIONS } from '@/data/buildings/walls';
import { RESEARCH_DEFINITIONS } from '@/data/research/dominion';
import { Wall } from '@/engine/components/Wall';

// Icon mappings for commands and units
const COMMAND_ICONS: Record<string, string> = {
  // Basic commands
  move: '➤',
  stop: '■',
  hold: '⛊',
  attack: '⚔',
  patrol: '↻',
  gather: '⛏',
  repair: '🔧',
  rally: '⚑',
  build: '🔨',
  build_basic: '🏗',
  build_advanced: '🏭',
  cancel: '✕',
  demolish: '🗑',
  back: '◀',
  liftoff: '🚀',
  land: '🛬',
  // Units
  fabricator: '🔧',
  trooper: '🎖',
  breacher: '💪',
  vanguard: '💀',
  operative: '👻',
  scorcher: '🔥',
  devastator: '🎯',
  colossus: '⚡',
  lifter: '✚',
  valkyrie: '✈',
  specter: '🦇',
  dreadnought: '🚀',
  overseer: '🦅',
  // Buildings
  headquarters: '🏛',
  orbital_station: '🛰',
  bastion: '🏰',
  supply_cache: '📦',
  extractor: '⛽',
  infantry_bay: '🏠',
  tech_center: '🔬',
  garrison: '🏰',
  forge: '🏭',
  arsenal: '⚙',
  hangar: '🛫',
  power_core: '⚛',
  ops_center: '🎓',
  radar_array: '📡',
  defense_turret: '🗼',
  // Walls
  wall: '🧱',
  wall_segment: '🧱',
  wall_gate: '🚪',
  gate: '🚪',
  // Gate commands
  open: '📖',
  close: '📕',
  lock: '🔒',
  unlock: '🔓',
  auto: '🔄',
  // Upgrades
  stim: '💉',
  combat: '🛡',
  infantry: '⚔',
  vehicle: '💥',
  ship: '🚀',
  siege: '🎯',
  cloak: '👁',
  // Abilities
  mule: '🔧',
  scanner_sweep: '📡',
  supply_drop: '📦',
  scanner: '📡',
  power_cannon: '⚡',
  warp_jump: '🌀',
  // Transform modes
  transform_fighter: '✈',
  transform_assault: '⬇',
  fighter: '✈',
  assault: '⬇',
  default: '◆',
};

function getIcon(id: string): string {
  const lc = id.toLowerCase();
  if (COMMAND_ICONS[lc]) return COMMAND_ICONS[lc];
  for (const [key, icon] of Object.entries(COMMAND_ICONS)) {
    if (lc.includes(key)) return icon;
  }
  return COMMAND_ICONS.default;
}

/**
 * Get attack type indicator text for unit tooltips
 */
function getAttackTypeText(unitDef: typeof UNIT_DEFINITIONS[string]): string {
  if (!unitDef) return '';

  const canAttackGround = unitDef.canAttackGround ?? (unitDef.attackDamage > 0);
  const canAttackAir = unitDef.canAttackAir ?? false;

  if (!canAttackGround && !canAttackAir) {
    return '⊘ No attack';
  } else if (canAttackGround && canAttackAir) {
    return '⬡ Attacks: Ground & Air';
  } else if (canAttackGround) {
    return '⬢ Attacks: Ground only';
  } else {
    return '✈ Attacks: Air only';
  }
}

interface CommandButton {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
  isDisabled?: boolean;
  tooltip?: string;
  cost?: { minerals: number; vespene: number; supply?: number };
}

type MenuMode = 'main' | 'build_basic' | 'build_advanced' | 'build_walls';

// Basic structures (no tech requirements)
const BASIC_BUILDINGS = ['headquarters', 'supply_cache', 'extractor', 'infantry_bay', 'tech_center', 'garrison', 'defense_turret'];
// Advanced structures (tech requirements)
const ADVANCED_BUILDINGS = ['forge', 'arsenal', 'hangar', 'power_core', 'ops_center', 'radar_array'];
// Wall buildings
const WALL_BUILDINGS = ['wall_segment', 'wall_gate'];

/**
 * PERF: Memoized CommandCard component to prevent unnecessary re-renders
 * Only re-renders when selectedUnits, resources, or menu state changes
 */
function CommandCardInner() {
  // PERF: Use selector functions to minimize re-renders from Zustand
  const selectedUnits = useGameStore((state) => state.selectedUnits);
  const minerals = useGameStore((state) => state.minerals);
  const vespene = useGameStore((state) => state.vespene);
  const supply = useGameStore((state) => state.supply);
  const maxSupply = useGameStore((state) => state.maxSupply);
  const isBuilding = useGameStore((state) => state.isBuilding);

  const [commands, setCommands] = useState<CommandButton[]>([]);
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<MenuMode>('main');
  // Track building state changes to force re-render when buildings lift off/land
  const [buildingStateVersion, setBuildingStateVersion] = useState(0);

  // Subscribe to building state change events to update command menu immediately
  useEffect(() => {
    const game = Game.getInstance();
    if (!game) return;

    const handleBuildingStateChange = () => {
      setBuildingStateVersion((v) => v + 1);
    };

    // Listen to all building flight state change events
    // eventBus.on returns an unsubscribe function
    const unsub1 = game.eventBus.on('building:liftOffStart', handleBuildingStateChange);
    const unsub2 = game.eventBus.on('building:liftOffComplete', handleBuildingStateChange);
    const unsub3 = game.eventBus.on('building:landingStart', handleBuildingStateChange);
    const unsub4 = game.eventBus.on('building:landingComplete', handleBuildingStateChange);

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, []);

  // Reset menu when selection changes or building mode exits
  useEffect(() => {
    if (!isBuilding) {
      // Don't reset menu mode when exiting building mode - let user stay in build menu
    }
  }, [isBuilding]);

  useEffect(() => {
    // Reset to main menu when selection changes
    setMenuMode('main');
  }, [selectedUnits]);

  useEffect(() => {
    const game = Game.getInstance();
    if (!game || selectedUnits.length === 0) {
      setCommands([]);
      return;
    }

    const buttons: CommandButton[] = [];
    const entity = game.world.getEntity(selectedUnits[0]);
    if (!entity) {
      setCommands([]);
      return;
    }

    const unit = entity.get<Unit>('Unit');
    const building = entity.get<Building>('Building');

    if (unit) {
      if (menuMode === 'main') {
        // Basic unit commands
        buttons.push({
          id: 'move',
          label: 'Move',
          shortcut: 'M',
          action: () => {},
          tooltip: 'Move to location (right-click)',
        });

        buttons.push({
          id: 'stop',
          label: 'Stop',
          shortcut: 'S',
          action: () => {
            const localPlayer = getLocalPlayerId();
            if (localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'STOP',
                entityIds: selectedUnits,
              });
            }
          },
          tooltip: 'Stop current action',
        });

        buttons.push({
          id: 'hold',
          label: 'Hold',
          shortcut: 'H',
          action: () => {
            const localPlayer = getLocalPlayerId();
            if (localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'HOLD',
                entityIds: selectedUnits,
              });
            }
          },
          tooltip: 'Hold position - do not move to attack',
        });

        buttons.push({
          id: 'attack',
          label: 'Attack',
          shortcut: 'A',
          action: () => {},
          tooltip: 'Attack-move to location',
        });

        buttons.push({
          id: 'patrol',
          label: 'Patrol',
          shortcut: 'P',
          action: () => {},
          tooltip: 'Patrol between points',
        });

        // Transform commands for units that can transform (e.g., Valkyrie)
        if (unit.canTransform && unit.transformModes.length > 0) {
          const currentMode = unit.getCurrentMode();
          const isTransforming = unit.state === 'transforming';

          // Add a button for each available transform mode (except current mode)
          for (const mode of unit.transformModes) {
            if (mode.id === unit.currentMode) continue; // Skip current mode

            // Determine icon and shortcut based on mode
            const isAirMode = mode.isFlying === true;
            const icon = isAirMode ? '✈' : '⬇';
            const shortcut = isAirMode ? 'F' : 'E';

            // Build tooltip with mode stats
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
                const localPlayer = getLocalPlayerId();
                if (localPlayer) {
                  game.issueCommand({
                    tick: game.getCurrentTick(),
                    playerId: localPlayer,
                    type: 'TRANSFORM',
                    entityIds: selectedUnits,
                    targetMode: mode.id,
                  });
                }
              },
              isDisabled: isTransforming,
              tooltip: isTransforming
                ? `Transforming... (${Math.round(unit.transformProgress * 100)}%)`
                : tooltip,
            });
          }
        }

        // Unit abilities (e.g., Dreadnought Power Cannon, Warp Jump)
        const abilityComponent = entity.get<Ability>('Ability');
        if (abilityComponent) {
          const abilities = abilityComponent.getAbilityList();
          for (const abilityState of abilities) {
            const def = abilityState.definition;
            const canUse = abilityComponent.canUseAbility(def.id);
            const energyCost = def.energyCost;

            buttons.push({
              id: `ability_${def.id}`,
              label: def.name,
              shortcut: def.hotkey,
              action: () => {
                if (def.targetType === 'point') {
                  // Point-targeted ability (e.g., Warp Jump)
                  useGameStore.getState().setAbilityTargetMode(def.id);
                } else if (def.targetType === 'unit') {
                  // Unit-targeted ability (e.g., Power Cannon)
                  useGameStore.getState().setAbilityTargetMode(def.id);
                } else {
                  // Instant cast (e.g., self-buff)
                  game.eventBus.emit('command:ability', {
                    entityIds: selectedUnits,
                    abilityId: def.id,
                  });
                }
              },
              isDisabled: !canUse,
              tooltip: def.description + (abilityState.currentCooldown > 0 ? ` (CD: ${Math.ceil(abilityState.currentCooldown)}s)` : ''),
              cost: energyCost > 0 ? { minerals: 0, vespene: 0, supply: energyCost } : undefined,
            });
          }
        }

        // Worker-specific commands
        if (unit.isWorker) {
          buttons.push({
            id: 'gather',
            label: 'Gather',
            shortcut: 'G',
            action: () => {},
            tooltip: 'Gather resources (right-click on minerals/gas)',
          });

          // Repair command for workers
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

          // Build Basic submenu button
          buttons.push({
            id: 'build_basic',
            label: 'Build Basic',
            shortcut: 'B',
            action: () => setMenuMode('build_basic'),
            tooltip: 'Build basic structures',
          });

          // Build Advanced submenu button
          buttons.push({
            id: 'build_advanced',
            label: 'Build Adv.',
            shortcut: 'V',
            action: () => setMenuMode('build_advanced'),
            tooltip: 'Build advanced structures',
          });

          // Build Walls submenu button
          buttons.push({
            id: 'build_walls',
            label: 'Build Walls',
            shortcut: 'W',
            action: () => setMenuMode('build_walls'),
            tooltip: 'Build walls and gates (click+drag for lines)',
          });
        }
      } else if (menuMode === 'build_basic' || menuMode === 'build_advanced' || menuMode === 'build_walls') {
        // Back button
        buttons.push({
          id: 'back',
          label: 'Back',
          shortcut: 'ESC',
          action: () => setMenuMode('main'),
          tooltip: 'Return to main commands',
        });

        // Building buttons for the selected category
        const buildingList = menuMode === 'build_basic'
          ? BASIC_BUILDINGS
          : menuMode === 'build_advanced'
            ? ADVANCED_BUILDINGS
            : WALL_BUILDINGS;

        // Helper to check if player has completed required buildings
        const checkRequirementsMet = (requirements: string[] | undefined): { met: boolean; missing: string[] } => {
          if (!requirements || requirements.length === 0) {
            return { met: true, missing: [] };
          }

          const localPlayerId = getLocalPlayerId();
          if (!localPlayerId) return { met: false, missing: requirements };

          const playerBuildings = game.world.getEntitiesWith('Building', 'Selectable');
          const missing: string[] = [];

          for (const reqBuildingId of requirements) {
            let found = false;
            for (const buildingEntity of playerBuildings) {
              const b = buildingEntity.get<Building>('Building')!;
              const sel = buildingEntity.get<Selectable>('Selectable')!;
              if (sel.playerId === localPlayerId && b.buildingId === reqBuildingId && b.isComplete()) {
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
          // Check both building and wall definitions
          const def = BUILDING_DEFINITIONS[buildingId] || WALL_DEFINITIONS[buildingId];
          if (!def) return;

          // Check tech requirements against actual player buildings
          const reqCheck = checkRequirementsMet(def.requirements);
          const requirementsMet = reqCheck.met;
          const reqText = reqCheck.missing.length > 0 ? `Requires: ${reqCheck.missing.join(', ')}` : '';

          const canAfford = minerals >= def.mineralCost && vespene >= def.vespeneCost;

          // Build tooltip with description and requirements
          let tooltip = def.description || `Build ${def.name}`;
          if (reqText) {
            tooltip += ` (${reqText})`;
          }

          // Check if this is a wall building
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
                // Use wall placement mode for walls, regular mode for other buildings
                if (isWall) {
                  useGameStore.getState().setWallPlacementMode(true, buildingId);
                } else {
                  useGameStore.getState().setBuildingMode(buildingId);
                }
              }
            },
            isDisabled: !canAfford || !requirementsMet,
            tooltip,
            cost: { minerals: def.mineralCost, vespene: def.vespeneCost },
          });
        });
      }
    } else if (building && !building.isComplete() && building.state !== 'destroyed' && building.state !== 'flying' && building.state !== 'lifting' && building.state !== 'landing') {
      // Building under construction - show cancel/demolish button
      buttons.push({
        id: 'demolish',
        label: 'Cancel',
        shortcut: 'ESC',
        action: () => {
          const localPlayer = getLocalPlayerId();
          if (localPlayer) {
            game.issueCommand({
              tick: game.getCurrentTick(),
              playerId: localPlayer,
              type: 'DEMOLISH',
              entityIds: selectedUnits,
            });
          }
        },
        tooltip: 'Cancel construction (refunds 75% of resources spent)',
      });
    } else if (building && (building.isComplete() || building.state === 'flying' || building.state === 'lifting' || building.state === 'landing')) {
      // Show commands for complete OR flying buildings
      const isFlying = building.state === 'flying' || building.state === 'lifting' || building.state === 'landing';

      // Check if this is a wall or gate
      const wall = entity.get<Wall>('Wall');
      if (wall && !isFlying) {
        // Gate commands
        if (wall.isGate) {
          // Open/Close toggle
          buttons.push({
            id: 'gate_toggle',
            label: wall.gateOpenProgress > 0.5 ? 'Close' : 'Open',
            shortcut: 'O',
            action: () => {
              game.eventBus.emit('command:gate_toggle', {
                entityIds: selectedUnits,
              });
            },
            tooltip: wall.gateOpenProgress > 0.5 ? 'Close the gate' : 'Open the gate',
          });

          // Lock toggle
          buttons.push({
            id: 'gate_lock',
            label: wall.gateState === 'locked' ? 'Unlock' : 'Lock',
            shortcut: 'L',
            action: () => {
              game.eventBus.emit('command:gate_lock', {
                entityIds: selectedUnits,
              });
            },
            tooltip: wall.gateState === 'locked' ? 'Unlock the gate' : 'Lock the gate (prevents opening)',
          });

          // Auto mode
          if (wall.gateState !== 'auto') {
            buttons.push({
              id: 'gate_auto',
              label: 'Auto',
              shortcut: 'A',
              action: () => {
                game.eventBus.emit('command:gate_auto', {
                  entityIds: selectedUnits,
                });
              },
              tooltip: 'Set gate to auto-open for friendly units',
            });
          }
        }

        // Wall upgrade buttons (if upgrades are researched)
        const store = useGameStore.getState();
        const localPlayer = getLocalPlayerId() ?? 'player1';

        if (!wall.appliedUpgrade && wall.upgradeInProgress === null) {
          // Reinforced upgrade
          if (store.hasResearch(localPlayer, 'wall_reinforced')) {
            buttons.push({
              id: 'wall_upgrade_reinforced',
              label: 'Reinforce',
              shortcut: 'R',
              action: () => {
                game.eventBus.emit('command:wall_upgrade', {
                  entityIds: selectedUnits,
                  upgradeType: 'reinforced',
                });
              },
              tooltip: 'Reinforce wall: +400 HP, +2 armor',
              cost: { minerals: 25, vespene: 0 },
            });
          }

          // Shield upgrade
          if (store.hasResearch(localPlayer, 'wall_shielded')) {
            buttons.push({
              id: 'wall_upgrade_shielded',
              label: 'Shield',
              shortcut: 'S',
              action: () => {
                game.eventBus.emit('command:wall_upgrade', {
                  entityIds: selectedUnits,
                  upgradeType: 'shielded',
                });
              },
              tooltip: 'Add shield: +200 regenerating shield',
              cost: { minerals: 50, vespene: 25 },
            });
          }

          // Weapon upgrade (if no turret mounted)
          if (store.hasResearch(localPlayer, 'wall_weapon') && wall.mountedTurretId === null) {
            buttons.push({
              id: 'wall_upgrade_weapon',
              label: 'Weapon',
              shortcut: 'W',
              action: () => {
                game.eventBus.emit('command:wall_upgrade', {
                  entityIds: selectedUnits,
                  upgradeType: 'weapon',
                });
              },
              tooltip: 'Add auto-turret: 5 damage, 6 range',
              cost: { minerals: 40, vespene: 25 },
            });
          }
        }
      }

      // Get tech-gated units for this building
      const techUnits = RESEARCH_MODULE_UNITS[building.buildingId] || [];
      const hasTechLab = building.hasAddon() && building.hasTechLab();

      // Building commands - train units (basic units from canProduce)
      // Skip training when building is flying
      if (!isFlying) {
        building.canProduce.forEach((unitId) => {
          const unitDef = UNIT_DEFINITIONS[unitId];
          if (!unitDef) return;

          const canAfford = minerals >= unitDef.mineralCost && vespene >= unitDef.vespeneCost;
          const hasSupply = supply + unitDef.supplyCost <= maxSupply;
          const attackTypeText = getAttackTypeText(unitDef);

          buttons.push({
            id: `train_${unitId}`,
            label: unitDef.name,
            shortcut: unitDef.name.charAt(0).toUpperCase(),
            action: () => {
              // Play supply alert if queuing while supply blocked (unit will still queue)
              if (!hasSupply) {
                game.eventBus.emit('alert:supplyBlocked', {});
              }
              game.eventBus.emit('command:train', {
                entityIds: selectedUnits,
                unitType: unitId,
              });
            },
            isDisabled: !canAfford,
            tooltip: (unitDef.description || `Train ${unitDef.name}`) + ` [${attackTypeText}]` + (!hasSupply ? ' (Need more supply)' : ''),
            cost: { minerals: unitDef.mineralCost, vespene: unitDef.vespeneCost, supply: unitDef.supplyCost },
          });
        });
      }

      // Skip training, research, and upgrades when building is flying
      if (!isFlying) {
        // Tech-gated units (from Research Module)
        techUnits.forEach((unitId) => {
          const unitDef = UNIT_DEFINITIONS[unitId];
          if (!unitDef) return;

          const canAfford = minerals >= unitDef.mineralCost && vespene >= unitDef.vespeneCost;
          const hasSupply = supply + unitDef.supplyCost <= maxSupply;
          const canTrain = hasTechLab && canAfford;
          const attackTypeText = getAttackTypeText(unitDef);

          // Build tooltip with description and requirements info
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
                // Play supply alert if queuing while supply blocked (unit will still queue)
                if (!hasSupply) {
                  game.eventBus.emit('alert:supplyBlocked', {});
                }
                game.eventBus.emit('command:train', {
                  entityIds: selectedUnits,
                  unitType: unitId,
                });
              }
            },
            isDisabled: !canTrain,
            tooltip: tooltipText,
            cost: { minerals: unitDef.mineralCost, vespene: unitDef.vespeneCost, supply: unitDef.supplyCost },
          });
        });

        // Build Research Module addon button (if building supports addons and doesn't have one)
        if (building.canHaveAddon && !building.hasAddon()) {
          const moduleDef = BUILDING_DEFINITIONS['research_module'];
          if (moduleDef) {
            const canAffordModule = minerals >= moduleDef.mineralCost && vespene >= moduleDef.vespeneCost;
            const localPlayer = getLocalPlayerId();
            buttons.push({
              id: 'build_research_module',
              label: 'Tech Lab',
              shortcut: 'T',
              action: () => {
                // Get fresh game instance and selected units to avoid stale closure
                const currentGame = Game.getInstance();
                const currentSelectedUnits = useGameStore.getState().selectedUnits;
                if (currentGame && currentSelectedUnits.length > 0) {
                  currentGame.eventBus.emit('building:build_addon', {
                    buildingId: currentSelectedUnits[0],
                    addonType: 'research_module',
                    playerId: localPlayer,
                  });
                }
              },
              isDisabled: !canAffordModule,
              tooltip: moduleDef.description || 'Addon that unlocks advanced units and research.',
              cost: { minerals: moduleDef.mineralCost, vespene: moduleDef.vespeneCost },
            });
          }

          // Build Production Module (Reactor) addon button
          const reactorDef = BUILDING_DEFINITIONS['production_module'];
          if (reactorDef) {
            const canAffordReactor = minerals >= reactorDef.mineralCost && vespene >= reactorDef.vespeneCost;
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
              cost: { minerals: reactorDef.mineralCost, vespene: reactorDef.vespeneCost },
            });
          }
        }

        // Research commands
        const store = useGameStore.getState();
        const researchMap: Record<string, string[]> = {
          tech_center: ['infantry_weapons_1', 'infantry_armor_1'],
          arsenal: ['vehicle_weapons_1', 'vehicle_armor_1'],
          infantry_bay: ['combat_stim', 'combat_shield'],
          forge: ['bombardment_systems'],
          hangar: ['cloaking_field'],
        };

        const availableResearch = researchMap[building.buildingId] || [];
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

          const isResearching = building.productionQueue.some(
            (item) => item.type === 'upgrade' && item.id === upgradeId
          );

          buttons.push({
            id: `research_${upgradeId}`,
            label: upgrade.name,
            shortcut: upgrade.name.charAt(0).toUpperCase(),
            action: () => {
              game.eventBus.emit('command:research', {
                entityIds: selectedUnits,
                upgradeId,
              });
            },
            isDisabled: minerals < upgrade.mineralCost || vespene < upgrade.vespeneCost || !reqMet || isResearching,
            tooltip: upgrade.description + (isResearching ? ' (In progress)' : ''),
            cost: { minerals: upgrade.mineralCost, vespene: upgrade.vespeneCost },
          });
        });

        // Building upgrade buttons (e.g., CC -> Orbital/Planetary)
        if (building.canUpgradeTo && building.canUpgradeTo.length > 0) {
          const isUpgrading = building.productionQueue.some(
            (item) => item.type === 'upgrade' && building.canUpgradeTo.includes(item.id)
          );

          building.canUpgradeTo.forEach((upgradeBuildingId) => {
            const upgradeDef = BUILDING_DEFINITIONS[upgradeBuildingId];
            if (!upgradeDef) return;

            const canAfford = minerals >= upgradeDef.mineralCost && vespene >= upgradeDef.vespeneCost;

            // Create shortcut from first letter of last word (O for Orbital, P for Planetary)
            const words = upgradeDef.name.split(' ');
            const shortcut = words[words.length - 1].charAt(0).toUpperCase();

            buttons.push({
              id: `upgrade_${upgradeBuildingId}`,
              label: upgradeDef.name,
              shortcut,
              action: () => {
                game.eventBus.emit('command:upgrade_building', {
                  entityIds: selectedUnits,
                  upgradeTo: upgradeBuildingId,
                });
              },
              isDisabled: !canAfford || isUpgrading,
              tooltip: (upgradeDef.description || `Upgrade to ${upgradeDef.name}`) + (isUpgrading ? ' (Upgrading...)' : ''),
              cost: { minerals: upgradeDef.mineralCost, vespene: upgradeDef.vespeneCost },
            });
          });
        }

        // Rally point for production buildings
        if (building.canProduce.length > 0) {
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

        // Demolish button for complete buildings (salvage)
        buttons.push({
          id: 'demolish',
          label: 'Demolish',
          shortcut: 'DEL',
          action: () => {
            const localPlayer = getLocalPlayerId();
            if (localPlayer) {
              game.issueCommand({
                tick: game.getCurrentTick(),
                playerId: localPlayer,
                type: 'DEMOLISH',
                entityIds: selectedUnits,
              });
            }
          },
          tooltip: 'Demolish building (refunds 50% of resources)',
        });
      }

      // Lift-off button for buildings that can fly (and are complete, not flying)
      if (building.canLiftOff && building.state === 'complete' && !building.isFlying) {
        const hasQueue = building.productionQueue.length > 0;
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

      // Land button for flying buildings
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

      // Building abilities (e.g., Orbital Command abilities)
      const abilityComponent = entity.get<Ability>('Ability');
      if (abilityComponent) {
        const abilities = abilityComponent.getAbilityList();
        for (const abilityState of abilities) {
          const def = abilityState.definition;
          const canUse = abilityComponent.canUseAbility(def.id);
          const energyCost = def.energyCost;

          buttons.push({
            id: `ability_${def.id}`,
            label: def.name,
            shortcut: def.hotkey,
            action: () => {
              if (def.targetType === 'point') {
                // Need to enable targeting mode for point abilities
                useGameStore.getState().setAbilityTargetMode(def.id);
              } else if (def.targetType === 'unit') {
                // Need to enable unit targeting mode
                useGameStore.getState().setAbilityTargetMode(def.id);
              } else {
                // Instant cast
                game.eventBus.emit('command:ability', {
                  entityIds: selectedUnits,
                  abilityId: def.id,
                });
              }
            },
            isDisabled: !canUse,
            tooltip: def.description + (abilityState.currentCooldown > 0 ? ` (CD: ${Math.ceil(abilityState.currentCooldown)}s)` : ''),
            cost: energyCost > 0 ? { minerals: 0, vespene: 0, supply: energyCost } : undefined,
          });
        }
      }
    }

    setCommands(buttons.slice(0, 12)); // Max 4x3 grid
  }, [selectedUnits, minerals, vespene, supply, maxSupply, menuMode, buildingStateVersion]);

  // Handle ESC to go back in menus and building shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape' && menuMode !== 'main') {
        e.stopPropagation();
        setMenuMode('main');
        return;
      }
      // Hotkey B for Build Basic
      if (e.key.toLowerCase() === 'b' && menuMode === 'main') {
        const game = Game.getInstance();
        if (game && selectedUnits.length > 0) {
          const entity = game.world.getEntity(selectedUnits[0]);
          const unit = entity?.get<Unit>('Unit');
          if (unit?.isWorker) {
            setMenuMode('build_basic');
            return;
          }
        }
      }
      // Hotkey V for Build Advanced
      if (e.key.toLowerCase() === 'v' && menuMode === 'main') {
        const game = Game.getInstance();
        if (game && selectedUnits.length > 0) {
          const entity = game.world.getEntity(selectedUnits[0]);
          const unit = entity?.get<Unit>('Unit');
          if (unit?.isWorker) {
            setMenuMode('build_advanced');
            return;
          }
        }
      }
      // Hotkey W for Build Walls
      if (e.key.toLowerCase() === 'w' && menuMode === 'main') {
        const game = Game.getInstance();
        if (game && selectedUnits.length > 0) {
          const entity = game.world.getEntity(selectedUnits[0]);
          const unit = entity?.get<Unit>('Unit');
          if (unit?.isWorker) {
            setMenuMode('build_walls');
            return;
          }
        }
      }

      // Handle building shortcuts when in build submenus
      if (menuMode === 'build_basic' || menuMode === 'build_advanced' || menuMode === 'build_walls') {
        const pressedKey = e.key.toUpperCase();
        // Find a matching command by shortcut (skip the "back" button)
        const matchingCommand = commands.find(
          (cmd) => cmd.shortcut === pressedKey && cmd.id !== 'back' && !cmd.isDisabled
        );
        if (matchingCommand) {
          e.preventDefault();
          e.stopPropagation();
          matchingCommand.action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuMode, selectedUnits, commands]);

  if (commands.length === 0) {
    return (
      <div className="w-60 h-44 bg-black/80 border border-void-700/50 rounded-lg flex items-center justify-center backdrop-blur-sm">
        <span className="text-void-500 text-sm">Select units or buildings</span>
      </div>
    );
  }

  const hoveredCommand = commands.find((c) => c.id === hoveredCmd);

  return (
    <div className="relative">
      {/* Menu title when in submenu */}
      {menuMode !== 'main' && (
        <div className="absolute -top-6 left-0 text-xs text-void-400">
          {menuMode === 'build_basic' ? '🏗 Basic Structures' : menuMode === 'build_advanced' ? '🏭 Advanced Structures' : '🧱 Walls & Gates'}
        </div>
      )}

      {/* Command grid - 4 columns, 3 rows */}
      <div className="w-60 bg-black/80 border border-void-700/50 rounded-lg p-2 backdrop-blur-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {commands.map((cmd) => (
            <div
              key={cmd.id}
              className="relative"
              onMouseEnter={() => setHoveredCmd(cmd.id)}
              onMouseLeave={() => setHoveredCmd(null)}
            >
              <button
                className={`
                  relative w-[52px] h-[52px] flex flex-col items-center justify-center
                  bg-gradient-to-b from-void-800/80 to-void-900/80
                  border rounded
                  transition-all duration-100
                  ${cmd.isDisabled
                    ? 'opacity-40 cursor-not-allowed border-void-700/30'
                    : 'border-void-600/50 hover:from-void-700 hover:to-void-800 hover:border-blue-400/60 active:scale-95'
                  }
                  ${cmd.id === 'back' ? 'bg-gradient-to-b from-void-700/80 to-void-800/80' : ''}
                `}
                onClick={cmd.action}
                disabled={cmd.isDisabled}
              >
                {/* Icon */}
                <span className="text-lg leading-none mb-0.5">{getIcon(cmd.id)}</span>

                {/* Label */}
                <span className="text-[8px] text-void-300 truncate w-full text-center leading-tight px-0.5">
                  {cmd.label.length > 8 ? cmd.label.substring(0, 7) + '..' : cmd.label}
                </span>

                {/* Hotkey badge */}
                <span className="absolute bottom-0 right-0.5 text-[7px] text-void-500 font-mono">
                  {cmd.shortcut}
                </span>

                {/* Can't afford indicator */}
                {cmd.cost && cmd.isDisabled && (
                  <div className="absolute inset-0 border border-red-500/40 rounded pointer-events-none" />
                )}
              </button>
            </div>
          ))}

          {/* Empty slots */}
          {Array.from({ length: Math.max(0, 12 - commands.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="w-[52px] h-[52px] bg-void-900/30 border border-void-800/20 rounded"
            />
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredCommand && (
        <div className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none">
          <div className="bg-black/95 border border-void-600 rounded p-2 shadow-xl min-w-[200px] max-w-[280px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{getIcon(hoveredCommand.id)}</span>
              <span className="text-white font-medium text-sm">{hoveredCommand.label}</span>
              <span className="text-void-400 text-xs ml-auto">[ {hoveredCommand.shortcut} ]</span>
            </div>

            {/* Description */}
            {hoveredCommand.tooltip && (
              <p className="text-void-300 text-xs leading-relaxed">{hoveredCommand.tooltip}</p>
            )}

            {/* Cost */}
            {hoveredCommand.cost && (
              <div className="flex gap-4 text-xs mt-2 pt-2 border-t border-void-700/50">
                <span className={`flex items-center gap-1 ${minerals < hoveredCommand.cost.minerals ? 'text-red-400' : 'text-blue-300'}`}>
                  <span>💎</span>
                  {hoveredCommand.cost.minerals}
                </span>
                {hoveredCommand.cost.vespene > 0 && (
                  <span className={`flex items-center gap-1 ${vespene < hoveredCommand.cost.vespene ? 'text-red-400' : 'text-green-300'}`}>
                    <span>💚</span>
                    {hoveredCommand.cost.vespene}
                  </span>
                )}
                {hoveredCommand.cost.supply && hoveredCommand.cost.supply > 0 && (
                  <span className={`flex items-center gap-1 ${supply + hoveredCommand.cost.supply > maxSupply ? 'text-red-400' : 'text-yellow-300'}`}>
                    <span>👤</span>
                    {hoveredCommand.cost.supply}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// PERF: Export memoized component to prevent unnecessary re-renders
export const CommandCard = memo(CommandCardInner);
