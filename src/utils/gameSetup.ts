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
import { EnhancedAISystem } from '@/engine/systems/EnhancedAISystem';
import { MapData, Expansion } from '@/data/maps';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, STARTING_RESOURCES_VALUES, AIDifficulty } from '@/store/gameSetupStore';

export function spawnInitialEntities(game: Game, mapData: MapData): void {
  const world = game.world;

  // Apply starting resources from game setup
  const setupStore = useGameSetupStore.getState();
  const startingResources = STARTING_RESOURCES_VALUES[setupStore.startingResources];
  const gameStore = useGameStore.getState();
  // Reset to starting values (not additive)
  gameStore.addResources(startingResources.minerals - gameStore.minerals, startingResources.vespene - gameStore.vespene);

  // Get spawn points for each player
  const spawns = mapData.spawns;

  // Get active player slots (human or AI)
  const playerSlots = setupStore.playerSlots.filter(
    slot => slot.type === 'human' || slot.type === 'ai'
  );

  // Spawn bases for each active player
  // Track used spawns to prevent multiple players at same location
  const usedSpawnIndices = new Set<number>();

  playerSlots.forEach((slot) => {
    // Find the slot's player number (1-8) from the slot.id (e.g., "player1" -> 1)
    const playerNumber = parseInt(slot.id.replace('player', ''), 10);

    // First try to find the spawn matching this player's slot number
    let spawnIndex = spawns.findIndex(s => s.playerSlot === playerNumber);

    // If that spawn is taken or doesn't exist, find the next available spawn
    if (spawnIndex === -1 || usedSpawnIndices.has(spawnIndex)) {
      spawnIndex = spawns.findIndex((_, idx) => !usedSpawnIndices.has(idx));
    }

    if (spawnIndex === -1) {
      console.warn(`No available spawn point for ${slot.id}`);
      return;
    }

    const spawn = spawns[spawnIndex];
    usedSpawnIndices.add(spawnIndex);

    console.log(`Spawning ${slot.id} at spawn index ${spawnIndex} (${spawn.x}, ${spawn.y})`);

    spawnBase(game, slot.id, spawn.x, spawn.y, slot.id === 'player1');

    // Register AI players
    if (slot.type === 'ai') {
      registerAIPlayer(game, slot.id, slot.faction, slot.aiDifficulty);
    }
  });

  // Spawn resources at all expansion locations
  for (const expansion of mapData.expansions) {
    spawnExpansionResources(game, expansion);
  }
}

function registerAIPlayer(
  game: Game,
  playerId: string,
  faction: string,
  difficulty: AIDifficulty
): void {
  const world = game.world;

  // Try to find EnhancedAISystem first (default), then fall back to AISystem
  const enhancedAI = world.getSystem(EnhancedAISystem);
  if (enhancedAI) {
    enhancedAI.registerAI(playerId, faction, difficulty);
  } else {
    const basicAI = world.getSystem(AISystem);
    if (basicAI) {
      // Map 'insane' to 'hard' since basic AISystem only supports easy/medium/hard
      const aiDifficulty: 'easy' | 'medium' | 'hard' =
        difficulty === 'insane' ? 'hard' : difficulty;
      basicAI.registerAI(playerId, faction, aiDifficulty);
    }
  }
}

function spawnBase(game: Game, playerId: string, x: number, y: number, isHumanPlayer: boolean = false): void {
  const world = game.world;

  // Spawn Headquarters
  const ccDef = BUILDING_DEFINITIONS['headquarters'];
  const cc = world.createEntity();
  cc.add(new Transform(x, y, 0))
    .add(new Building({ ...ccDef, buildTime: 0 })) // Instant build
    .add(new Health(ccDef.maxHealth, ccDef.armor, 'structure'))
    .add(new Selectable(ccDef.width, 10, playerId));

  // Mark as complete
  const building = cc.get<Building>('Building')!;
  building.buildProgress = 1;
  building.state = 'complete';

  // Set default rally point for production buildings
  if (building.canProduce.length > 0) {
    building.setRallyPoint(x + ccDef.width / 2 + 3, y);
  }

  // Set up initial supply for human player
  if (isHumanPlayer) {
    const store = useGameStore.getState();
    // Set initial max supply from command center
    store.addMaxSupply(ccDef.supplyProvided || 11);
  }

  // Spawn initial workers around the headquarters
  // Headquarters is 5x5 (from -2.5 to +2.5), spawn workers outside at offset ~4
  const scvDef = UNIT_DEFINITIONS['fabricator'];
  const workerPositions = [
    { x: -4, y: -4 },
    { x: 0, y: -4 },
    { x: 4, y: -4 },
    { x: -4, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
  ];

  for (let i = 0; i < 6; i++) {
    const pos = workerPositions[i];
    spawnUnit(game, scvDef, x + pos.x, y + pos.y, playerId);

    // Track supply for human player units
    if (isHumanPlayer) {
      useGameStore.getState().addSupply(scvDef.supplyCost);
    }
  }
}

function spawnExpansionResources(game: Game, expansion: Expansion): void {
  console.log(`[gameSetup] Spawning resources for expansion: ${expansion.name}`);
  console.log(`[gameSetup]   Minerals: ${expansion.minerals?.length ?? 0} patches`);
  console.log(`[gameSetup]   Vespene: ${expansion.vespene?.length ?? 0} geysers`);

  // Spawn mineral patches
  if (expansion.minerals) {
    for (const mineral of expansion.minerals) {
      console.log(`[gameSetup]   Creating mineral at (${mineral.x.toFixed(1)}, ${mineral.y.toFixed(1)}) amount=${mineral.amount}`);
      spawnMineralPatch(game, mineral.x, mineral.y, mineral.amount);
    }
  } else {
    console.warn(`[gameSetup]   WARNING: expansion.minerals is undefined!`);
  }

  // Spawn vespene geysers
  if (expansion.vespene) {
    for (const geyser of expansion.vespene) {
      console.log(`[gameSetup]   Creating vespene at (${geyser.x.toFixed(1)}, ${geyser.y.toFixed(1)}) amount=${geyser.amount}`);
      spawnVespeneGeyser(game, geyser.x, geyser.y, geyser.amount);
    }
  } else {
    console.warn(`[gameSetup]   WARNING: expansion.vespene is undefined!`);
  }
}

function spawnMineralPatch(game: Game, x: number, y: number, amount: number): void {
  const world = game.world;
  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Resource('minerals', amount, 2, 5, 2))
    .add(new Selectable(1.5, 0, 'neutral')); // Selectable by anyone, priority 0 (lowest)
}

function spawnVespeneGeyser(game: Game, x: number, y: number, amount: number): void {
  const world = game.world;
  const entity = world.createEntity();
  entity
    .add(new Transform(x, y, 0))
    .add(new Resource('vespene', amount, 3, 4, 2))
    .add(new Selectable(2.0, 0, 'neutral')); // Selectable by anyone, priority 0 (lowest)
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
    .add(new Selectable(1.2, 5, playerId))
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
