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

export function spawnInitialEntities(game: Game): void {
  const world = game.world;

  // Spawn player base at bottom-left
  spawnBase(game, 'player1', 20, 20);

  // Spawn AI base at top-right
  spawnBase(game, 'ai', 108, 108);

  // Register AI player
  const aiSystem = world.getEntitiesWith('Building').length > 0
    ? (game.world as unknown as { systems: AISystem[] }).systems?.find(
        (s: unknown) => s instanceof AISystem
      ) as AISystem | undefined
    : undefined;

  if (aiSystem) {
    aiSystem.registerAI('ai', 'dominion', 'easy');
  }

  // Spawn resource patches
  spawnResourcePatch(game, 30, 20, 'minerals');
  spawnResourcePatch(game, 98, 108, 'minerals');

  // Additional resource patches in middle
  spawnResourcePatch(game, 64, 50, 'minerals');
  spawnResourcePatch(game, 64, 78, 'minerals');

  // Vespene geysers
  spawnVespeneGeyser(game, 15, 30);
  spawnVespeneGeyser(game, 113, 98);
  spawnVespeneGeyser(game, 55, 64);
  spawnVespeneGeyser(game, 73, 64);
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

  // Spawn initial SCVs
  const scvDef = UNIT_DEFINITIONS['scv'];
  for (let i = 0; i < 6; i++) {
    spawnUnit(game, scvDef, x + 3 + (i % 3), y + 3 + Math.floor(i / 3), playerId);
  }
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

function spawnResourcePatch(
  game: Game,
  centerX: number,
  centerY: number,
  type: 'minerals' | 'vespene'
): void {
  const world = game.world;

  // Spawn cluster of mineral patches
  const positions = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 4, y: 0 },
    { x: 1, y: 1.5 },
    { x: 3, y: 1.5 },
    { x: 0, y: 3 },
    { x: 2, y: 3 },
    { x: 4, y: 3 },
  ];

  for (const pos of positions) {
    const entity = world.createEntity();
    entity
      .add(new Transform(centerX + pos.x, centerY + pos.y, 0))
      .add(new Resource(type, 1500, 2, 5, 2));
  }
}

function spawnVespeneGeyser(game: Game, x: number, y: number): void {
  const world = game.world;

  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Resource('vespene', 2500, 3, 4, 2));
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
