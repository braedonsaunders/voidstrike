import { System } from '../ecs/System';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import type { IGameInstance } from '../core/IGameInstance';
import { RESEARCH_DEFINITIONS, ResearchDefinition } from '@/data/research/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { debugProduction } from '@/utils/debugLogger';
import { validateEntityAlive } from '@/utils/EntityValidator';

export class ResearchSystem extends System {
  public readonly name = 'ResearchSystem';
  // Priority is set by SystemRegistry based on dependencies (runs after ProductionSystem)

  constructor(game: IGameInstance) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:research', this.handleResearchCommand.bind(this));
    this.game.eventBus.on('research:complete', this.handleResearchComplete.bind(this));
  }

  private handleResearchCommand(command: { entityIds: number[]; upgradeId: string }): void {
    const { entityIds, upgradeId } = command;
    const upgrade = RESEARCH_DEFINITIONS[upgradeId];

    if (!upgrade) {
      debugProduction.warn(`Unknown upgrade: ${upgradeId}`);
      return;
    }

    const playerId = this.game.config.playerId;

    // Check if already researched
    if (this.game.statePort.hasResearch(playerId, upgradeId)) {
      this.game.eventBus.emit('ui:error', { message: 'Already researched' });
      return;
    }

    // Check requirements
    if (!this.checkRequirements(upgrade, playerId)) {
      this.game.eventBus.emit('ui:error', { message: 'Requirements not met' });
      return;
    }

    // Check resources
    if (this.game.statePort.getMinerals() < upgrade.mineralCost) {
      this.game.eventBus.emit('alert:notEnoughMinerals', {});
      this.game.eventBus.emit('warning:lowMinerals', {});
      return;
    }
    if (this.game.statePort.getPlasma() < upgrade.plasmaCost) {
      this.game.eventBus.emit('alert:notEnoughPlasma', {});
      this.game.eventBus.emit('warning:lowPlasma', {});
      return;
    }

    // Find first valid building
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!validateEntityAlive(entity, entityId, 'ResearchSystem:handleResearchCommand')) continue;

      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !building.isComplete()) continue;
      if (selectable?.playerId !== playerId) continue;

      // Check if this building can research this upgrade
      if (!this.canBuildingResearch(building.buildingId, upgradeId)) continue;

      // Check if building is already researching
      const isResearching = building.productionQueue.some((item) => item.type === 'upgrade');
      if (isResearching) {
        this.game.eventBus.emit('ui:error', { message: 'Already researching' });
        continue;
      }

      // Deduct resources
      this.game.statePort.addResources(-upgrade.mineralCost, -upgrade.plasmaCost);

      // Add to production queue
      building.addToProductionQueue('upgrade', upgradeId, upgrade.researchTime);

      this.game.eventBus.emit('research:started', {
        buildingId: entityId,
        upgradeId,
      });

      return; // Only research from one building
    }
  }

  private handleResearchComplete(event: { buildingId: number; upgradeId: string }): void {
    const { buildingId, upgradeId } = event;
    const upgrade = RESEARCH_DEFINITIONS[upgradeId];

    if (!upgrade) return;

    // Get the building's owner
    const entity = this.world.getEntity(buildingId);
    if (!validateEntityAlive(entity, buildingId, 'ResearchSystem:handleResearchComplete')) return;

    const selectable = entity.get<Selectable>('Selectable');
    const playerId = selectable?.playerId ?? 'player1';

    // Register the upgrade
    this.game.statePort.addResearch(playerId, upgradeId, upgrade.effects, this.game.getGameTime());

    // Emit UI notification
    this.game.eventBus.emit('ui:notification', {
      type: 'research',
      message: `${upgrade.name} complete!`,
    });

    // Update building's available research (for tiered upgrades)
    if (upgrade.nextLevel) {
      this.updateBuildingResearch(buildingId, upgradeId, upgrade.nextLevel);
    }
  }

  private checkRequirements(upgrade: ResearchDefinition, playerId: string): boolean {
    if (!upgrade.requirements) return true;

    for (const req of upgrade.requirements) {
      // Check if requirement is a building
      if (BUILDING_DEFINITIONS[req]) {
        // Check if player has this building
        const buildings = this.world.getEntitiesWith('Building', 'Selectable');
        const hasBuilding = Array.from(buildings).some((entity) => {
          const building = entity.get<Building>('Building')!;
          const selectable = entity.get<Selectable>('Selectable')!;
          return (
            building.buildingId === req && building.isComplete() && selectable.playerId === playerId
          );
        });

        if (!hasBuilding) return false;
      } else {
        // Requirement is another upgrade
        if (!this.game.statePort.hasResearch(playerId, req)) return false;
      }
    }

    return true;
  }

  private canBuildingResearch(buildingId: string, upgradeId: string): boolean {
    // Map building types to what they can research
    const researchMap: Record<string, string[]> = {
      tech_center: [
        'infantry_weapons_1',
        'infantry_weapons_2',
        'infantry_weapons_3',
        'infantry_armor_1',
        'infantry_armor_2',
        'infantry_armor_3',
        'auto_tracking',
        'building_armor',
      ],
      arsenal: [
        'vehicle_weapons_1',
        'vehicle_weapons_2',
        'vehicle_weapons_3',
        'vehicle_armor_1',
        'vehicle_armor_2',
        'vehicle_armor_3',
        'ship_weapons_1',
        'ship_weapons_2',
        'ship_weapons_3',
        'ship_armor_1',
        'ship_armor_2',
        'ship_armor_3',
      ],
      power_core: ['nova_cannon', 'dreadnought_weapon_refit'],
      infantry_bay: ['combat_stim', 'combat_shield', 'concussive_shells'],
      forge: ['bombardment_systems', 'drilling_claws'],
      hangar: ['cloaking_field', 'medical_reactor'],
      ops_center: ['stealth_systems', 'enhanced_reactor'],
    };

    const available = researchMap[buildingId];
    return available ? available.includes(upgradeId) : false;
  }

  private updateBuildingResearch(
    _buildingId: number,
    _completedUpgrade: string,
    _nextLevel: string
  ): void {
    // When a tiered upgrade completes, update building's available research
    // This is handled automatically by checking requirements
  }

  public update(_deltaTime: number): void {
    // Research progress is handled by ProductionSystem via the production queue
    // This system only handles commands and completion events
  }

  // Helper to get available research for a building considering player progress
  public getAvailableResearch(buildingId: string, playerId: string): ResearchDefinition[] {
    const available: ResearchDefinition[] = [];

    // Get base available research for this building type
    const _baseResearch = this.canBuildingResearch(buildingId, '');

    // Check each research definition
    for (const [upgradeId, upgrade] of Object.entries(RESEARCH_DEFINITIONS)) {
      // Skip if already researched
      if (this.game.statePort.hasResearch(playerId, upgradeId)) continue;

      // Skip if can't be researched at this building
      if (!this.canBuildingResearch(buildingId, upgradeId)) continue;

      // Check requirements
      if (!this.checkRequirements(upgrade, playerId)) continue;

      available.push(upgrade);
    }

    return available;
  }
}
