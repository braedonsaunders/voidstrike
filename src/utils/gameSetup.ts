import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { Health } from '@/engine/components/Health';
import { Unit, UnitDefinition } from '@/engine/components/Unit';
import { Building, BuildingDefinition } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Velocity } from '@/engine/components/Velocity';
import { UNIT_DEFINITIONS } from '@/data/units/dominion';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { AISystem } from '@/engine/systems/AISystem';
import { MapData, Expansion } from '@/data/maps';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, AIDifficulty } from '@/store/gameSetupStore';

export function spawnInitialEntities(game: Game, mapData: MapData): void {
  const world = game.world;

  // Get spawn points for each player
  const spawns = mapData.spawns;
  const playerSpawn = spawns.find(s => s.playerSlot === 1) || spawns[0];
  const aiSpawn = spawns.find(s => s.playerSlot === 2) || spawns[1];

  // Spawn player base at designated spawn point
  spawnBase(game, 'player1', playerSpawn.x, playerSpawn.y);

  // Spawn AI base at their spawn point
  if (aiSpawn) {
    spawnBase(game, 'ai', aiSpawn.x, aiSpawn.y);

    // Register AI player with difficulty from game setup
    const aiSystem = world.getEntitiesWith('Building').length > 0
      ? (game.world as unknown as { systems: AISystem[] }).systems?.find(
          (s: unknown) => s instanceof AISystem
        ) as AISystem | undefined
      : undefined;

    if (aiSystem) {
      // Get difficulty from game setup store
      const difficulty = useGameSetupStore.getState().aiDifficulty;
      // Map 'insane' to 'hard' since AISystem only supports easy/medium/hard
      const aiDifficulty: 'easy' | 'medium' | 'hard' =
        difficulty === 'insane' ? 'hard' : difficulty;
      aiSystem.registerAI('ai', 'dominion', aiDifficulty);
    }
  }

  // Spawn resources at all expansion locations
  for (const expansion of mapData.expansions) {
    spawnExpansionResources(game, expansion);
  }
}

function spawnBase(game: Game, playerId: string, x: number, y: number): void {
  const world = game.world;

  // Spawn Command Center
  const ccDef = BUILDING_DEFINITIONS['command_center'];
  const cc = world.createEntity();
  cc.add(new Transform(x, y, 0))
    .add(new Building({ ...ccDef, buildTime: 0 })) // Instant build
    .add(new Health(ccDef.maxHealth, ccDef.armor, 'structure'))
    .add(new Selectable(ccDef.width, 10, playerId));

  // Mark as complete
  const building = cc.get<Building>('Building')!;
  building.buildProgress = 1;
  building.state = 'complete';

  // Set up initial supply for player
  if (playerId === 'player1') {
    const store = useGameStore.getState();
    // Set initial max supply from command center
    store.addMaxSupply(ccDef.supplyProvided || 11);
  }

  // Spawn initial workers around the command center
  const scvDef = UNIT_DEFINITIONS['scv'];
  const workerPositions = [
    { x: -2, y: -2 },
    { x: 0, y: -2 },
    { x: 2, y: -2 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 2 },
  ];

  for (let i = 0; i < 6; i++) {
    const pos = workerPositions[i];
    spawnUnit(game, scvDef, x + pos.x, y + pos.y, playerId);

    // Track supply for player units
    if (playerId === 'player1') {
      useGameStore.getState().addSupply(scvDef.supplyCost);
    }
  }
}

function spawnExpansionResources(game: Game, expansion: Expansion): void {
  // Spawn mineral patches
  for (const mineral of expansion.minerals) {
    spawnMineralPatch(game, mineral.x, mineral.y, mineral.amount);
  }

  // Spawn vespene geysers
  for (const geyser of expansion.vespene) {
    spawnVespeneGeyser(game, geyser.x, geyser.y, geyser.amount);
  }
}

function spawnMineralPatch(game: Game, x: number, y: number, amount: number): void {
  const world = game.world;
  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Resource('minerals', amount, 2, 5, 2));
}

function spawnVespeneGeyser(game: Game, x: number, y: number, amount: number): void {
  const world = game.world;
  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Resource('vespene', amount, 3, 4, 2));
}

function spawnUnit(
  game: Game,
  definition: UnitDefinition,
  x: number,
  y: number,
  playerId: string
): void {
  const world = game.world;

  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Unit(definition))
    .add(
      new Health(
        definition.maxHealth,
        definition.armor,
        'light'
      )
    )
    .add(new Selectable(0.5, 5, playerId))
    .add(new Velocity());
}

export function spawnBuildingAtPosition(
  game: Game,
  buildingId: string,
  x: number,
  y: number,
  playerId: string
): void {
  const world = game.world;
  const definition = BUILDING_DEFINITIONS[buildingId];

  if (!definition) {
    console.warn(`Unknown building type: ${buildingId}`);
    return;
  }

  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Building(definition))
    .add(new Health(definition.maxHealth * 0.1, definition.armor, 'structure'))
    .add(new Selectable(definition.width, 10, playerId));
}

export function spawnUnitAtPosition(
  game: Game,
  unitId: string,
  x: number,
  y: number,
  playerId: string
): void {
  const definition = UNIT_DEFINITIONS[unitId];

  if (!definition) {
    console.warn(`Unknown unit type: ${unitId}`);
    return;
  }

  spawnUnit(game, definition, x, y, playerId);
}
