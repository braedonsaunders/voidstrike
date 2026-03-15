import { beforeEach, describe, expect, it, vi } from 'vitest';

const testDefinitions = vi.hoisted(() => {
  const buildingDefinitions = {
    tech_center: {
      id: 'tech_center',
      name: 'Tech Center',
      faction: 'dominion',
      mineralCost: 150,
      plasmaCost: 50,
      buildTime: 10,
      width: 4,
      height: 4,
      maxHealth: 150,
      armor: 0,
      sightRange: 8,
      canResearch: ['infantry_weapons_1'],
    },
    barracks: {
      id: 'barracks',
      name: 'Barracks',
      faction: 'dominion',
      mineralCost: 150,
      plasmaCost: 0,
      buildTime: 10,
      width: 4,
      height: 4,
      maxHealth: 150,
      armor: 0,
      sightRange: 8,
      canProduce: ['trooper'],
    },
    supply_depot: {
      id: 'supply_depot',
      name: 'Supply Depot',
      faction: 'dominion',
      mineralCost: 100,
      plasmaCost: 0,
      buildTime: 8,
      width: 2,
      height: 2,
      maxHealth: 100,
      armor: 0,
      sightRange: 6,
      supplyProvided: 8,
    },
  };

  const unitDefinitions = {
    trooper: {
      id: 'trooper',
      name: 'Trooper',
      faction: 'dominion',
      mineralCost: 50,
      plasmaCost: 0,
      buildTime: 5,
      supplyCost: 1,
      speed: 2.25,
      sightRange: 6,
      attackRange: 4,
      attackDamage: 6,
      attackSpeed: 1,
      damageType: 'normal' as const,
      maxHealth: 45,
      armor: 0,
    },
    fabricator: {
      id: 'fabricator',
      name: 'Fabricator',
      faction: 'dominion',
      mineralCost: 50,
      plasmaCost: 0,
      buildTime: 5,
      supplyCost: 1,
      speed: 2.5,
      sightRange: 6,
      attackRange: 0,
      attackDamage: 0,
      attackSpeed: 0,
      damageType: 'normal' as const,
      maxHealth: 40,
      armor: 0,
      isWorker: true,
    },
  };

  const researchDefinitions = {
    infantry_weapons_1: {
      id: 'infantry_weapons_1',
      name: 'Infantry Weapons 1',
      description: 'Increase infantry damage.',
      faction: 'dominion',
      mineralCost: 100,
      plasmaCost: 25,
      researchTime: 30,
      effects: [],
      requirements: ['tech_center'],
    },
  };

  return {
    buildingDefinitions,
    unitDefinitions,
    researchDefinitions,
  };
});

vi.mock('@/data/buildings/dominion', () => ({
  BUILDING_DEFINITIONS: testDefinitions.buildingDefinitions,
  RESEARCH_MODULE_UNITS: {},
  PRODUCTION_MODULE_UNITS: {},
}));

vi.mock('@/data/buildings/walls', () => ({
  WALL_DEFINITIONS: {},
}));

vi.mock('@/data/units/dominion', () => ({
  UNIT_DEFINITIONS: testDefinitions.unitDefinitions,
}));

vi.mock('@/data/research/dominion', () => ({
  RESEARCH_DEFINITIONS: testDefinitions.researchDefinitions,
}));

vi.mock('@/store/gameSetupStore', () => ({
  getLocalPlayerId: vi.fn(() => 'player1'),
}));

import { EventBus } from '@/engine/core/EventBus';
import type { IGameInstance } from '@/engine/core/IGameInstance';
import { MockStatePort } from '@/engine/core/__mocks__/MockStatePort';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Building } from '@/engine/components/Building';
import { Unit } from '@/engine/components/Unit';
import { BuildingMechanicsSystem } from '@/engine/systems/BuildingMechanicsSystem';
import { BuildingPlacementSystem } from '@/engine/systems/BuildingPlacementSystem';
import { ProductionSystem } from '@/engine/systems/ProductionSystem';
import { ResearchSystem } from '@/engine/systems/ResearchSystem';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';

interface TestContext {
  eventBus: EventBus;
  game: IGameInstance;
  statePort: MockStatePort;
  world: World;
}

function createGameContext(): TestContext {
  const world = new World(128, 128);
  const eventBus = new EventBus();
  const statePort = new MockStatePort();

  const game = {
    world,
    eventBus,
    statePort,
    config: {
      mapWidth: 128,
      mapHeight: 128,
      tickRate: 20,
      isMultiplayer: true,
      playerId: 'player1',
      aiEnabled: false,
      aiDifficulty: 'medium',
      fogOfWar: true,
    },
    visionSystem: {} as IGameInstance['visionSystem'],
    pathfindingSystem: {} as IGameInstance['pathfindingSystem'],
    projectileSystem: {} as IGameInstance['projectileSystem'],
    gameStateSystem: {} as IGameInstance['gameStateSystem'],
    saveLoadSystem: {} as IGameInstance['saveLoadSystem'],
    aiMicroSystem: {} as IGameInstance['aiMicroSystem'],
    checksumSystem: null,
    audioSystem: null,
    getCurrentTick: () => 0,
    getGameTime: () => 0,
    isInMultiplayerMode: () => true,
    getPlayerTeam: () => 0,
    getTerrainAt: () => ({ terrain: 'ground' as const, elevation: 0 }),
    getTerrainHeightAt: () => 0,
    getTerrainGrid: () => null,
    getDecorationCollisions: () => [],
    isPositionClearOfDecorations: () => true,
    isValidTerrainForBuilding: () => true,
    isValidBuildingPlacement: () => true,
    issueAICommand: vi.fn(),
    processCommand: vi.fn(),
  } satisfies IGameInstance;

  return { world, eventBus, statePort, game };
}

function createCompleteBuilding(
  world: World,
  buildingType: keyof typeof BUILDING_DEFINITIONS,
  playerId: string
) {
  const building = new Building(BUILDING_DEFINITIONS[buildingType]);
  building.state = 'complete';
  building.buildProgress = 1;

  const entity = world.createEntity();
  entity
    .add(new Transform(16, 16, 0))
    .add(building)
    .add(new Health(BUILDING_DEFINITIONS[buildingType].maxHealth, 0, 'structure'))
    .add(new Selectable(1, 10, playerId, 1, 0, 0));

  return { entity, building };
}

describe('multiplayer economy ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deducts research costs from the owning remote human player', () => {
    const { game, statePort, world, eventBus } = createGameContext();
    statePort.setResources(50, 0, 'player1');
    statePort.setResources(200, 50, 'player2');

    const system = new ResearchSystem(game);
    system.init(world);

    const { entity, building } = createCompleteBuilding(world, 'tech_center', 'player2');

    eventBus.emit('command:research', {
      entityIds: [entity.id],
      upgradeId: 'infantry_weapons_1',
      playerId: 'player2',
    });

    expect(statePort.getMinerals('player1')).toBe(50);
    expect(statePort.getPlasma('player1')).toBe(0);
    expect(statePort.getMinerals('player2')).toBe(100);
    expect(statePort.getPlasma('player2')).toBe(25);
    expect(building.productionQueue).toHaveLength(1);
    expect(building.productionQueue[0].id).toBe('infantry_weapons_1');
  });

  it('charges unit production and allocates supply against the remote owner only', () => {
    const { game, statePort, world, eventBus } = createGameContext();
    statePort.setResources(50, 0, 'player1');
    statePort.setResources(200, 0, 'player2');
    statePort.setSupply(0, 10, 'player2');

    const system = new ProductionSystem(game);
    system.init(world);

    const { entity, building } = createCompleteBuilding(world, 'barracks', 'player2');

    eventBus.emit('command:train', {
      entityIds: [entity.id],
      unitType: 'trooper',
      playerId: 'player2',
    });

    expect(building.productionQueue).toHaveLength(1);
    expect(statePort.getMinerals('player1')).toBe(50);
    expect(statePort.getMinerals('player2')).toBe(150);

    system.update(0);

    expect(statePort.getSupply('player1')).toBe(0);
    expect(statePort.getSupply('player2')).toBe(1);
    expect(building.productionQueue[0].supplyAllocated).toBe(true);
  });

  it('charges remote human building placement and grants their supply on completion', () => {
    const { game, statePort, world, eventBus } = createGameContext();
    statePort.setResources(50, 0, 'player1');
    statePort.setResources(150, 0, 'player2');
    statePort.setSupply(0, 0, 'player2');

    const system = new BuildingPlacementSystem(game);
    system.init(world);

    const worker = world.createEntity();
    worker
      .add(new Transform(10, 10, 0))
      .add(new Unit(UNIT_DEFINITIONS.fabricator))
      .add(new Health(40, 0, 'light'))
      .add(new Selectable(1, 5, 'player2', 1, 0, 0));

    eventBus.emit('building:place', {
      workerId: worker.id,
      buildingType: 'supply_depot',
      position: { x: 20, y: 20 },
      playerId: 'player2',
    });

    const placedBuildings = Array.from(world.getEntitiesWith('Building', 'Selectable')).filter(
      (entity) => {
        const selectable = entity.get<Selectable>('Selectable');
        const building = entity.get<Building>('Building');
        return selectable?.playerId === 'player2' && building?.buildingId === 'supply_depot';
      }
    );

    expect(placedBuildings).toHaveLength(1);
    expect(statePort.getMinerals('player1')).toBe(50);
    expect(statePort.getMinerals('player2')).toBe(50);

    eventBus.emit('building:complete:instant', { entityId: placedBuildings[0].id });

    expect(statePort.getMaxSupply('player1')).toBe(0);
    expect(statePort.getMaxSupply('player2')).toBe(8);
  });

  it('refunds demolition proceeds and supply only to the building owner', () => {
    const { game, statePort, world, eventBus } = createGameContext();
    statePort.setResources(50, 0, 'player1');
    statePort.setResources(0, 0, 'player2');
    statePort.setSupply(4, 8, 'player2');

    const system = new BuildingMechanicsSystem(game);
    system.init(world);

    const { entity } = createCompleteBuilding(world, 'supply_depot', 'player2');

    eventBus.emit('command:demolish', {
      entityIds: [entity.id],
      playerId: 'player2',
    });

    expect(statePort.getMinerals('player1')).toBe(50);
    expect(statePort.getMinerals('player2')).toBe(50);
    expect(statePort.getMaxSupply('player1')).toBe(0);
    expect(statePort.getMaxSupply('player2')).toBe(0);
    expect(statePort.getSupply('player2')).toBe(0);
  });
});
