import { System } from '../ecs/System';
import { Building } from '../components/Building';
import { Selectable } from '../components/Selectable';
import { Game } from '../core/Game';
import { useGameStore } from '@/store/gameStore';
import { RESEARCH_DEFINITIONS, ResearchDefinition } from '@/data/research/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { debugProduction } from '@/utils/debugLogger';

export class ResearchSystem extends System {
  public readonly name = 'ResearchSystem';
  public priority = 32; // After ProductionSystem

  constructor(game: Game) {
    super(game);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.game.eventBus.on('command:research', this.handleResearchCommand.bind(this));
    this.game.eventBus.on('research:complete', this.handleResearchComplete.bind(this));
  }

  private handleResearchCommand(command: {
    entityIds: number[];
    upgradeId: string;
  }): void {
    const { entityIds, upgradeId } = command;
    const upgrade = RESEARCH_DEFINITIONS[upgradeId];

    if (!upgrade) {
      debugProduction.warn(`Unknown upgrade: ${upgradeId}`);
      return;
    }

    const store = useGameStore.getState();
    const playerId = store.playerId;

    // Check if already researched
    if (store.hasResearch(playerId, upgradeId)) {
      this.game.eventBus.emit('ui:error', { message: 'Already researched' });
      return;
    }

    // Check requirements
    if (!this.checkRequirements(upgrade, playerId)) {
      this.game.eventBus.emit('ui:error', { message: 'Requirements not met' });
      return;
    }

    // Check resources
    if (
      store.minerals < upgrade.mineralCost ||
      store.vespene < upgrade.vespeneCost
    ) {
      this.game.eventBus.emit('ui:error', { message: 'Not enough resources' });
      return;
    }

    // Find first valid building
    for (const entityId of entityIds) {
      const entity = this.world.getEntity(entityId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (!building || !building.isComplete()) continue;
      if (selectable?.playerId !== playerId) continue;

      // Check if this building can research this upgrade
      if (!this.canBuildingResearch(building.buildingId, upgradeId)) continue;

      // Check if building is already researching
      const isResearching = building.productionQueue.some(
        (item) => item.type === 'upgrade'
      );
      if (isResearching) {
        this.game.eventBus.emit('ui:error', { message: 'Already researching' });
        continue;
      }

      // Deduct resources
      store.addResources(-upgrade.mineralCost, -upgrade.vespeneCost);

      // Add to production queue
      building.addToProductionQueue('upgrade', upgradeId, upgrade.researchTime);

      this.game.eventBus.emit('research:started', {
        buildingId: entityId,
        upgradeId,
      });

      return; // Only research from one building
    }
  }

  private handleResearchComplete(event: {
    buildingId: number;
    upgradeId: string;
  }): void {
    const { buildingId, upgradeId } = event;
    const upgrade = RESEARCH_DEFINITIONS[upgradeId];

    if (!upgrade) return;

    // Get the building's owner
    const entity = this.world.getEntity(buildingId);
    if (!entity) return;

    const selectable = entity.get<Selectable>('Selectable');
    const playerId = selectable?.playerId ?? 'player1';

    const store = useGameStore.getState();

    // Register the upgrade
    store.addResearch(playerId, upgradeId, upgrade.effects, store.gameTime);

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
    const store = useGameStore.getState();

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
            building.buildingId === req &&
            building.isComplete() &&
            selectable.playerId === playerId
          );
        });

        if (!hasBuilding) return false;
      } else {
        // Requirement is another upgrade
        if (!store.hasResearch(playerId, req)) return false;
      }
    }

    return true;
  }

  private canBuildingResearch(buildingId: string, upgradeId: string): boolean {
    // Map building types to what they can research
    const researchMap: Record<string, string[]> = {
      tech_center: [
        'infantry_weapons_1', 'infantry_weapons_2', 'infantry_weapons_3',
        'infantry_armor_1', 'infantry_armor_2', 'infantry_armor_3',
        'hi_sec_auto_tracking', 'building_armor',
      ],
      arsenal: [
        'vehicle_weapons_1', 'vehicle_weapons_2', 'vehicle_weapons_3',
        'vehicle_armor_1', 'vehicle_armor_2', 'vehicle_armor_3',
        'ship_weapons_1', 'ship_weapons_2', 'ship_weapons_3',
        'ship_armor_1', 'ship_armor_2', 'ship_armor_3',
      ],
      power_core: ['nova_cannon', 'dreadnought_weapon_refit'],
      infantry_bay: ['combat_stim', 'combat_shield', 'concussive_shells'],
      forge: ['bombardment_systems', 'drilling_claws'],
      hangar: ['cloaking_field', 'medical_reactor'],
    };

    const available = researchMap[buildingId];
    return available ? available.includes(upgradeId) : false;
  }

  private updateBuildingResearch(
    buildingId: number,
    completedUpgrade: string,
    nextLevel: string
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
    const store = useGameStore.getState();
    const available: ResearchDefinition[] = [];

    // Get base available research for this building type
    const baseResearch = this.canBuildingResearch(buildingId, '');

    // Check each research definition
    for (const [upgradeId, upgrade] of Object.entries(RESEARCH_DEFINITIONS)) {
      // Skip if already researched
      if (store.hasResearch(playerId, upgradeId)) continue;

      // Skip if can't be researched at this building
      if (!this.canBuildingResearch(buildingId, upgradeId)) continue;

      // Check requirements
      if (!this.checkRequirements(upgrade, playerId)) continue;

      available.push(upgrade);
    }

    return available;
  }
}
