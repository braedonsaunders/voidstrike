# VOIDSTRIKE - Architecture Overview

## Directory Structure

```
voidstrike/
├── .claude/                    # Project documentation
│   ├── DESIGN.md              # Game design document
│   ├── SCHEMA.md              # Database schema
│   ├── TODO.md                # Development roadmap
│   └── ARCHITECTURE.md        # This file
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Landing page
│   │   ├── game/
│   │   │   └── page.tsx       # Main game view
│   │   ├── lobby/
│   │   │   └── page.tsx       # Multiplayer lobby
│   │   └── api/               # API routes
│   ├── components/
│   │   ├── game/              # Game-specific components
│   │   │   ├── GameCanvas.tsx
│   │   │   ├── HUD.tsx
│   │   │   ├── Minimap.tsx
│   │   │   ├── CommandCard.tsx
│   │   │   ├── SelectionPanel.tsx
│   │   │   ├── ProductionQueuePanel.tsx # Building production UI
│   │   │   └── ResourcePanel.tsx
│   │   └── ui/                # Reusable UI components
│   ├── engine/
│   │   ├── core/
│   │   │   ├── Game.ts        # Main game class
│   │   │   ├── GameLoop.ts    # Fixed timestep loop
│   │   │   └── EventBus.ts    # Event system
│   │   ├── ecs/
│   │   │   ├── World.ts       # ECS world container
│   │   │   ├── Entity.ts      # Entity class
│   │   │   ├── Component.ts   # Component base
│   │   │   └── System.ts      # System base
│   │   ├── systems/
│   │   │   ├── SpawnSystem.ts           # Unit spawning from production
│   │   │   ├── BuildingPlacementSystem.ts # Building construction
│   │   │   ├── MovementSystem.ts        # Unit movement & formations
│   │   │   ├── CombatSystem.ts          # Attack, damage, high ground
│   │   │   ├── SelectionSystem.ts       # Unit/building selection
│   │   │   ├── ProductionSystem.ts      # Building production queues
│   │   │   ├── ResourceSystem.ts        # Resource gathering
│   │   │   ├── VisionSystem.ts          # Fog of war visibility
│   │   │   ├── AbilitySystem.ts         # Unit abilities & cooldowns
│   │   │   ├── AISystem.ts              # Basic AI opponent
│   │   │   ├── EnhancedAISystem.ts      # Advanced AI with build orders
│   │   │   ├── UnitMechanicsSystem.ts   # Transform, cloak, transport, heal
│   │   │   ├── BuildingMechanicsSystem.ts # Lift-off, addons, lowering
│   │   │   ├── GameStateSystem.ts       # Victory/defeat conditions
│   │   │   └── SaveLoadSystem.ts        # Game save/load functionality
│   │   ├── components/
│   │   │   ├── Transform.ts
│   │   │   ├── Health.ts
│   │   │   ├── Selectable.ts
│   │   │   ├── Unit.ts
│   │   │   ├── Building.ts
│   │   │   ├── Resource.ts
│   │   │   └── Ability.ts          # Unit abilities component
│   │   └── pathfinding/
│   │       ├── AStar.ts
│   │       ├── Grid.ts
│   │       └── pathfinder.worker.ts
│   ├── assets/
│   │   └── AssetManager.ts    # 3D asset generation & loading
│   ├── rendering/
│   │   ├── Scene.ts           # Three.js scene setup
│   │   ├── Camera.ts          # RTS camera controller
│   │   ├── Terrain.ts         # Terrain mesh with procedural details
│   │   ├── UnitRenderer.ts    # Unit rendering with player colors, SC2-style selection
│   │   ├── BuildingRenderer.ts # Building mesh rendering
│   │   ├── FogOfWar.ts        # Fog of war visibility system
│   │   ├── EffectsRenderer.ts # Combat effects (projectiles, hits)
│   │   ├── RallyPointRenderer.ts # Building rally point visuals
│   │   ├── SC2SelectionRenderer.ts # SC2-style selection circles with team colors
│   │   ├── SC2EffectsRenderer.ts # Enhanced combat effects (screen shake, projectiles)
│   │   └── BuildingGhostRenderer.ts # Building placement preview with validation
│   ├── input/
│   │   ├── InputManager.ts    # Input abstraction
│   │   ├── Selection.ts       # Box selection
│   │   └── Hotkeys.ts         # Keyboard shortcuts
│   ├── data/
│   │   ├── units/             # Unit definitions
│   │   ├── buildings/         # Building definitions
│   │   ├── factions/          # Faction configs
│   │   └── maps/              # Map data
│   ├── store/
│   │   ├── gameStore.ts       # Zustand game state
│   │   └── uiStore.ts         # UI state
│   ├── network/
│   │   ├── client.ts          # Supabase client
│   │   ├── multiplayer.ts     # Lockstep sync
│   │   └── lobby.ts           # Lobby management
│   └── utils/
│       ├── math.ts            # Math utilities
│       ├── spatial.ts         # Spatial hashing
│       └── deterministic.ts   # Deterministic random
├── public/
│   ├── models/                # 3D models (GLTF)
│   ├── textures/              # Terrain, unit textures
│   └── audio/                 # Sound effects, music
├── workers/
│   └── pathfinder.worker.ts   # Web Worker for pathfinding
└── tests/
    └── ...                    # Test files
```

## Core Systems

### Entity Component System (ECS)

The game uses a custom ECS for performance and flexibility:

```typescript
// Entity: Just an ID
type EntityId = number;

// Components: Pure data
interface TransformComponent {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

// Systems: Logic that operates on components
class MovementSystem extends System {
  requiredComponents = ['Transform', 'Velocity'];

  update(entities: Entity[], deltaTime: number) {
    for (const entity of entities) {
      const transform = entity.get('Transform');
      const velocity = entity.get('Velocity');
      transform.x += velocity.x * deltaTime;
      transform.y += velocity.y * deltaTime;
    }
  }
}
```

### Game Loop

Fixed timestep with interpolation for smooth rendering:

```typescript
const TICK_RATE = 20; // 20 ticks per second
const TICK_MS = 1000 / TICK_RATE;

class GameLoop {
  private accumulator = 0;
  private lastTime = 0;

  tick(currentTime: number) {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    this.accumulator += deltaTime;

    // Fixed update (deterministic)
    while (this.accumulator >= TICK_MS) {
      this.game.fixedUpdate(TICK_MS);
      this.accumulator -= TICK_MS;
    }

    // Render with interpolation
    const alpha = this.accumulator / TICK_MS;
    this.game.render(alpha);

    requestAnimationFrame(this.tick.bind(this));
  }
}
```

### State Management

Zustand store for reactive game state:

```typescript
interface GameState {
  // Resources
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;

  // Selection
  selectedUnits: EntityId[];
  controlGroups: Map<number, EntityId[]>;

  // Game
  gameTime: number;
  isPaused: boolean;

  // Actions
  selectUnits: (ids: EntityId[]) => void;
  setControlGroup: (key: number, ids: EntityId[]) => void;
  addResources: (minerals: number, vespene: number) => void;
}
```

### Pathfinding Architecture

Web Worker for non-blocking pathfinding:

```typescript
// Main thread
const pathfinder = new Worker('pathfinder.worker.ts');

function requestPath(unitId: EntityId, target: Vector2) {
  pathfinder.postMessage({
    type: 'REQUEST_PATH',
    unitId,
    start: getUnitPosition(unitId),
    target,
    grid: getNavigationGrid(),
  });
}

pathfinder.onmessage = (e) => {
  if (e.data.type === 'PATH_RESULT') {
    applyPathToUnit(e.data.unitId, e.data.path);
  }
};
```

### Multiplayer Sync

Lockstep deterministic simulation:

```typescript
// All clients run same simulation
// Only inputs are transmitted

interface GameInput {
  tick: number;
  playerId: string;
  type: 'MOVE' | 'ATTACK' | 'BUILD' | 'ABILITY';
  data: any;
}

// Every N ticks, broadcast checksum
interface StateChecksum {
  tick: number;
  hash: string; // Hash of game state
}

// On checksum mismatch = desync detected
```

## Rendering Pipeline

### Three.js Scene Graph

```
Scene
├── Terrain (mesh)
├── Units (instanced meshes)
│   ├── DominionMarines
│   ├── DominionTanks
│   └── ...
├── Buildings (individual meshes)
├── Effects (particles, projectiles)
├── Fog of War (shader overlay)
└── UI Elements (sprites, billboards)
```

### Camera System

RTS-style camera with constraints:

```typescript
class RTSCamera {
  // Position constraints
  minX, maxX: number;
  minZ, maxZ: number;

  // Zoom constraints
  minZoom = 10;
  maxZoom = 50;

  // Movement
  panSpeed = 20;
  edgeScrollSpeed = 15;
  edgeScrollThreshold = 20; // pixels from edge

  // Rotation
  rotationEnabled = true;
  rotationSpeed = 0.5;
}
```

## Data Flow

```
User Input
    ↓
InputManager (normalize input)
    ↓
Command Generator (create game commands)
    ↓
[Multiplayer: Broadcast to all clients]
    ↓
Command Processor (validate & queue)
    ↓
Game Loop (process commands at tick boundary)
    ↓
ECS Systems (update game state)
    ↓
Renderer (draw current state)
    ↓
HUD Update (React state sync)
```

## Asset System

### AssetManager

Centralized 3D asset management with procedural generation and GLTF loading:

```typescript
// Get procedural mesh for a unit
const mesh = AssetManager.getUnitMesh('marine', playerColor);

// Get procedural mesh for a building
const buildingMesh = AssetManager.getBuildingMesh('barracks', playerColor);

// Load custom GLTF model
await AssetManager.loadGLTF('/models/custom_unit.glb', 'custom_unit');

// Register custom asset override
AssetManager.registerCustomAsset('marine', customMarineMesh);
```

### Procedural Generator

Built-in procedural mesh generation for all unit types:

- **Units**: SCV, Marine, Marauder, Siege Tank, Medivac, etc.
- **Buildings**: Command Center, Barracks, Factory, Starport, etc.
- **Resources**: Mineral patches, Vespene geysers
- **Decorations**: Trees, rocks, grass

Each procedural mesh:
- Applies player team colors dynamically
- Casts and receives shadows
- Uses optimized geometry

### Custom Asset Pipeline

To add custom 3D models:

1. Export from Blender/Maya as GLTF/GLB
2. Place in `public/models/`
3. Load via `AssetManager.loadGLTF(url, assetId)`
4. Register as override: `AssetManager.registerCustomAsset(unitId, mesh)`

## Performance Considerations

1. **Instanced Rendering**: All units of same type use instanced meshes
2. **Spatial Hashing**: O(1) lookups for nearby entities
3. **Web Workers**: Pathfinding runs off main thread
4. **Object Pooling**: Reuse entities, projectiles, particles
5. **LOD System**: Reduce detail at distance
6. **Frustum Culling**: Don't render off-screen entities
7. **Delta Compression**: Only send changed state in multiplayer
8. **Asset Caching**: Meshes cached and cloned for reuse

## SC2 Parity Features

### Unit Movement System

Enhanced movement with StarCraft 2-like responsiveness:

```typescript
// Unit acceleration/deceleration
unit.maxSpeed = definition.speed;
unit.currentSpeed = 0; // Starts at 0
unit.acceleration = 15; // Units/sec²

// Boids-like separation for unit avoidance
const SEPARATION_RADIUS = 2.0;
const SEPARATION_STRENGTH = 8.0;
calculateSeparationForce(self, others);
```

Features:
- **Smooth acceleration**: Units ramp up to max speed naturally
- **Separation steering**: Units avoid overlapping via boids algorithm
- **Command queuing**: Shift-click to queue move/attack/patrol commands
- **Patrol**: P key sets patrol between current position and target

### Camera Hotkey System

```typescript
// Save camera location (Ctrl+F5-F8)
camera.saveLocation('F5');

// Recall camera location (F5-F8)
camera.recallLocation('F5');

// Double-tap control group to center camera
if (doubleTapDetected) {
  camera.setPosition(avgX, avgY);
}
```

### Smart Combat System

Priority-based target selection:

```typescript
const TARGET_PRIORITY = {
  siege_tank: 100,    // High-value targets first
  battlecruiser: 95,
  marine: 50,
  scv: 10,            // Workers last
};

// Area of effect damage
if (unit.splashRadius > 0) {
  applySplashDamage(target, damage, splashRadius);
}
```

### Idle Worker Button

UI component + F1 hotkey for fast worker management:

```typescript
// IdleWorkerButton.tsx
const idleWorkers = workers.filter(
  w => w.unit.isWorker && w.unit.state === 'idle'
);

// On click: select and center camera on idle worker
selectUnits([worker.id]);
camera.setPosition(worker.x, worker.y);
```

### Building Dependencies

Tech tree validation in BuildingPlacementSystem:

```typescript
// Check all required buildings exist and are complete
private checkBuildingDependencies(requirements: string[], playerId: string) {
  for (const reqBuildingId of requirements) {
    const found = playerBuildings.some(b =>
      b.buildingId === reqBuildingId && b.isComplete()
    );
    if (!found) return def?.name; // Return missing requirement
  }
  return null; // All requirements met
}
```

## Biome & Environment System

### Biome Configuration (`src/rendering/Biomes.ts`)

6 distinct biomes with unique visual characteristics:

| Biome | Colors | Features | Particles |
|-------|--------|----------|-----------|
| Grassland | Greens, browns | Trees, grass, water | None |
| Desert | Tans, oranges | Cacti, rocks, oases | Dust |
| Frozen | Whites, blues | Dead trees, ice crystals, frozen lakes | Snow |
| Volcanic | Blacks, reds | Charred stumps, lava rivers | Ash |
| Void | Purples, blacks | Alien trees, crystals, energy pools | Spores |
| Jungle | Dark greens | Dense trees, grass, murky water | Spores |

Each biome defines:
- Ground/cliff/ramp color palettes
- PBR material properties (roughness, metalness)
- Decoration densities (trees, rocks, grass, crystals)
- Water/lava settings
- Fog and lighting colors

### Environment Manager (`src/rendering/EnvironmentManager.ts`)

Unified system that creates and manages:

```typescript
const environment = new EnvironmentManager(scene, mapData);

// Creates:
// - Terrain mesh with biome colors
// - Lighting (ambient, directional, fill)
// - Sky and fog
// - Enhanced trees (biome-specific types)
// - Rock formations
// - Instanced grass (GPU instancing)
// - Ground debris
// - Crystal fields
// - Water/lava planes
// - Particle systems

// Update animated elements
environment.update(deltaTime, gameTime);
```

### Ground Detail (`src/rendering/GroundDetail.ts`)

- **InstancedGrass**: Up to 50,000 grass blades via THREE.InstancedMesh
- **GroundDebris**: Pebbles and sticks scattered on terrain
- **CrystalField**: Glowing crystal clusters for frozen/void biomes
- **WaterPlane**: Animated shader with wave simulation

### Enhanced Decorations (`src/rendering/EnhancedDecorations.ts`)

- **EnhancedTrees**: 6 tree types (pine, oak, dead, cactus, palm, alien)
- **EnhancedRocks**: Procedural rock formations with surrounding debris
- **EnvironmentParticles**: Snow, dust, ash, spores with physics

## Phase 1-3 Systems

### Unit Mechanics System (`UnitMechanicsSystem.ts`)

Handles advanced unit behaviors:

```typescript
// Transform system (Siege Tank, Hellion, Viking)
handleTransformCommand(entityIds, targetMode);
updateTransforming(entity, unit, deltaTime);

// Cloak system (Ghost, Banshee)
handleCloakCommand(entityIds);
updateCloakedUnits(deltaTime); // Energy drain

// Transport system (Medivac)
handleLoadCommand(transportId, unitIds);
handleUnloadCommand(transportId, position, unitId);

// Bunker system
handleBunkerLoad(bunkerId, unitIds);
handleBunkerUnload(bunkerId, unitId);
processBunkerAttacks(bunker, deltaTime);

// Healing & Repair
handleHealCommand(healerId, targetId); // Medivac
handleRepairCommand(repairerId, targetId); // SCV
```

### Building Mechanics System (`BuildingMechanicsSystem.ts`)

Handles building-specific behaviors:

```typescript
// Lift-off/Landing (Barracks, Factory, Starport, CC)
handleLiftOffCommand(entityIds);
handleLandCommand(entityIds, positions);

// Addon management (Tech Lab, Reactor)
handleBuildAddonCommand(buildingId, addonType);
canProduceUnit(building, unitType); // Tech Lab check
canDoubleProduceUnit(building, unitType); // Reactor check

// Supply Depot lowering
handleLowerCommand(entityIds);

// Building attacks (Turrets, Planetary Fortress)
processBuildingAttacks(building, deltaTime);
```

### Enhanced AI System (`EnhancedAISystem.ts`)

5-tier difficulty system with strategic behaviors:

```typescript
type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';

interface AIConfig {
  buildOrderSpeed: number;      // 0.5 (easy) to 2.0 (insane)
  attackTiming: number;         // Time between attacks
  scoutingEnabled: boolean;
  multiProngEnabled: boolean;
  harassmentEnabled: boolean;
  microLevel: number;           // 0-3
  resourceBonus: number;        // Cheating for insane
  macroEfficiency: number;      // 0.6-1.0
}

// State machine
type AIState = 'building' | 'expanding' | 'attacking' |
               'defending' | 'scouting' | 'harassing';

// Build order system
const BUILD_ORDERS = {
  easy: ['supply_depot', 'barracks', 'marine'],
  hard: ['supply_depot', 'refinery', 'barracks', 'tech_lab', ...],
  insane: ['supply_depot', 'barracks', 'marine', 'expansion', ...]
};
```

### Game State System (`GameStateSystem.ts`)

Tracks game statistics and victory conditions:

```typescript
interface PlayerStats {
  unitsProduced: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsConstructed: number;
  buildingsLost: number;
  buildingsDestroyed: number;
  resourcesGathered: { minerals: number; vespene: number };
  resourcesSpent: { minerals: number; vespene: number };
  totalDamageDealt: number;
  totalDamageTaken: number;
  apm: number;
}

interface GameResult {
  winner: string | null;
  loser: string | null;
  reason: 'elimination' | 'surrender' | 'disconnect' | 'timeout';
  duration: number;
  stats: Map<string, PlayerStats>;
}

// Victory conditions
checkVictoryConditions(); // Destroy all enemy buildings
handleSurrender(playerId);
```

### Save/Load System (`SaveLoadSystem.ts`)

Complete game state serialization:

```typescript
interface SavedGameState {
  version: string;
  timestamp: number;
  gameTime: number;
  currentTick: number;
  mapWidth: number;
  mapHeight: number;
  players: SavedPlayerState[];
  entities: SavedEntity[];
  fogOfWar: Record<string, number[][]>;
}

// Save operations
saveGame(slot, name); // Manual save
quickSave();          // F5 style
autoSave();           // Every 60 seconds

// Load operations
loadGame(slot);
quickLoad();          // F9 style

// Management
getSaveSlots(): SaveSlotInfo[];
deleteSave(slot);
setAutoSaveEnabled(enabled);
```

### Combat Enhancements

High ground advantage in CombatSystem:

```typescript
// 30% miss chance when attacking uphill
const HIGH_GROUND_MISS_CHANCE = 0.3;
const HIGH_GROUND_THRESHOLD = 1.5; // Height difference

// In performAttack()
const heightDifference = targetTransform.z - attackerTransform.z;
if (heightDifference > HIGH_GROUND_THRESHOLD) {
  if (missRoll < HIGH_GROUND_MISS_CHANCE) {
    emit('combat:miss', { reason: 'high_ground' });
    return;
  }
}
```

### Buff/Debuff System

Integrated into Unit component:

```typescript
// Unit.ts
activeBuffs: Map<string, {
  duration: number;
  effects: Record<string, number>;
}>;

applyBuff(buffId, duration, effects);
getEffectiveSpeed(); // Base speed * buff modifiers
getEffectiveDamage(); // Base damage * buff modifiers

// Example buffs
- stim_pack: +50% speed, +50% attack speed
- concussive_shells: -50% speed for 1.07s
- combat_shield: +10 max HP (permanent)
```

## SC2-Style Visual Systems

### Selection Renderer (`SC2SelectionRenderer.ts`)

StarCraft 2-inspired selection circles with team colors:

```typescript
// Team color definitions with primary, secondary, and glow colors
const TEAM_COLORS = {
  player1: { primary: 0x00aaff, secondary: 0x0066cc, glow: 0x00ccff },
  ai: { primary: 0xff4444, secondary: 0xcc2222, glow: 0xff6666 },
  // ...
};

// Creates animated selection circle with:
// - Inner solid ring (primary color)
// - Outer glow ring (soft glow color)
// - Pulse ring (expands periodically)
createSC2SelectionCircle({ radius, isBuilding, teamColors });

// Unit shadows for grounding
createUnitShadow(radius);

// Building placement ghost
createBuildingGhost(width, height, buildingHeight);
```

### Effects Renderer (`SC2EffectsRenderer.ts`)

Enhanced combat feedback system:

```typescript
enum WeaponType {
  GAUSS_RIFLE,    // Small yellow tracers
  GRENADE,        // Blue concussive grenades
  HELLFIRE,       // Orange flames
  SIEGE_CANNON,   // Large explosive shells
  MISSILE,        // Tracking missiles with smoke trails
  LASER,          // Continuous beams
  YAMATO,         // Massive energy blasts
}

// Features:
// - Screen shake on explosions and impacts
// - Weapon-specific projectiles with unique visuals
// - Muzzle flash effects
// - Death explosions (mechanical vs biological)
// - Shield hit effects (blue ripple)
```

### Building Ghost Renderer (`BuildingGhostRenderer.ts`)

Real-time building placement validation:

```typescript
// Shows preview of building placement with:
// - Semi-transparent building shape
// - Grid cells showing valid/invalid tiles
// - Color coding: green (valid) / red (invalid)

// Validates against:
// - Terrain walkability/buildability
// - Map bounds
// - Existing building collisions
// - Resource proximity
```

### SC2 HUD Components

New UI components in `src/components/game/`:

- `SC2Minimap.tsx` - Minimap with unit dots, camera viewport, alert pings
- `SC2HUD.tsx` - Full HUD layout with resources, selection panel, command card

## Audio Asset Guidelines

See `.claude/AUDIO_PROMPTS.md` for comprehensive audio generation prompts including:
- Music tracks (menu, gameplay, events)
- Unit sound effects
- Building sounds
- UI feedback sounds
- Ambient sounds
- Voice lines
