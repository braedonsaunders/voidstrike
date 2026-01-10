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
│   │       └── music/         # Music discovery endpoint
│   ├── components/
│   │   ├── home/              # Homepage/menu components
│   │   │   └── HomeBackground.tsx  # Cinematic Three.js animated background
│   │   ├── game/              # Game-specific components
│   │   │   ├── GameCanvas.tsx
│   │   │   ├── HUD.tsx
│   │   │   ├── Minimap.tsx
│   │   │   ├── CommandCard.tsx
│   │   │   ├── SelectionPanel.tsx
│   │   │   ├── ProductionQueuePanel.tsx # Building production UI
│   │   │   ├── ResourcePanel.tsx
│   │   │   ├── GraphicsOptionsPanel.tsx # Graphics settings panel
│   │   │   ├── SoundOptionsPanel.tsx    # Audio settings panel with music controls
│   │   │   └── DebugMenuPanel.tsx       # Debug logging settings (disabled in multiplayer)
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
│   │   │   ├── PathfindingSystem.ts     # Dynamic pathfinding with obstacle detection
│   │   │   ├── MovementSystem.ts        # Unit movement & formations
│   │   │   ├── CombatSystem.ts          # Attack, damage, high ground
│   │   │   ├── SelectionSystem.ts       # Unit/building selection
│   │   │   ├── ProductionSystem.ts      # Building production queues
│   │   │   ├── ResourceSystem.ts        # Resource gathering
│   │   │   ├── VisionSystem.ts          # Fog of war visibility
│   │   │   ├── AbilitySystem.ts         # Unit abilities & cooldowns
│   │   │   ├── AISystem.ts              # Basic AI opponent
│   │   │   ├── EnhancedAISystem.ts      # Advanced AI with build orders & counter-building
│   │   │   ├── AIMicroSystem.ts         # AI unit micro (kiting, focus fire, positioning)
│   │   │   ├── UnitMechanicsSystem.ts   # Transform, cloak, transport, heal
│   │   │   ├── BuildingMechanicsSystem.ts # Lift-off, addons, lowering
│   │   │   ├── GameStateSystem.ts       # Victory/defeat conditions
│   │   │   └── SaveLoadSystem.ts        # Game save/load functionality
│   │   ├── ai/
│   │   │   └── BehaviorTree.ts          # Behavior tree for unit AI micro
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
│   ├── audio/
│   │   ├── AudioManager.ts    # Sound effects management
│   │   └── MusicPlayer.ts     # Dynamic music system with auto-discovery
│   ├── assets/
│   │   └── AssetManager.ts    # 3D asset generation & loading
│   ├── rendering/
│   │   ├── Scene.ts           # Three.js scene setup
│   │   ├── Camera.ts          # RTS camera controller
│   │   ├── Terrain.ts         # Terrain mesh with procedural details
│   │   ├── UnitRenderer.ts    # Unit rendering with player colors
│   │   ├── BuildingRenderer.ts # Building mesh rendering
│   │   ├── FogOfWar.ts        # Fog of war visibility system
│   │   ├── EffectsRenderer.ts # Combat effects (projectiles, hits)
│   │   ├── RallyPointRenderer.ts # Building rally point visuals
│   │   └── BuildingPlacementPreview.ts # SC2-style placement grid + ghost
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
│       ├── deterministic.ts   # Deterministic random
│       ├── gameSetup.ts       # Initial game entity spawning
│       └── debugLogger.ts     # Category-based debug logging utility
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

### Hybrid Architecture (Three.js + Phaser 4)

The game uses a unique hybrid rendering approach for world-class visuals:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASER 4 OVERLAY LAYER                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Stylized 2D Effect Overlays (ability splashes)       │   │
│  │  • "Tactical View" toggle (strategic info layer)        │   │
│  │  • Screen-space particles (combat intensity sparks)     │   │
│  │  • Alert system ("Nuclear launch detected" animations)  │   │
│  │  • Damage vignettes, screen shake effects               │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     REACT HUD LAYER                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Command Card    │  │   Minimap    │  │  Resources/Info  │   │
│  │ (React + CSS)   │  │  (Phaser 4)  │  │   (React)        │   │
│  └─────────────────┘  └──────────────┘  └──────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                   THREE.JS 3D WORLD                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Isometric 3D Camera (SC2 angle ~60°)                 │   │
│  │  • 3D Terrain with height maps                          │   │
│  │  • GLB Models (units, buildings) with animations        │   │
│  │  • Real-time shadows + lighting                         │   │
│  │  • 3D Particle systems (explosions, projectiles)        │   │
│  │  • Post-processing (bloom, ambient occlusion)           │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    ECS GAME ENGINE                              │
│               (Unchanged - drives both layers)                  │
└─────────────────────────────────────────────────────────────────┘
```

Key Components:
- `HybridGameCanvas.tsx` - Main component combining Three.js + Phaser
- `OverlayScene.ts` - Phaser 4 scene for 2D effects overlay

### SC2-Level Visual Systems

Located in `src/rendering/`:

1. **SC2SelectionSystem.ts** - Animated glowing selection rings
   - Custom GLSL shaders for pulsing glow effects
   - Team-colored rings with shimmer animation
   - Multiple concentric rings per selected unit
   - Hover highlight indicators

2. **SC2ParticleSystem.ts** - GPU-instanced particle effects
   - Muzzle flashes, projectile trails
   - Explosion particles with debris
   - Impact sparks and energy effects
   - Death explosions with smoke
   - Up to 5000 particles via instanced mesh

3. **SC2PostProcessing.ts** - Cinematic post-processing
   - HDR bloom for energy weapons and explosions
   - Subtle vignette for focus
   - Color grading and contrast
   - ACES tone mapping
   - Subtle film grain
   - Uses dedicated orthographic camera for fullscreen quad rendering

4. **shaders/SC2TerrainShader.ts** - Advanced terrain rendering
   - Multi-layer procedural texturing (grass, dirt, rock, cliff)
   - Voronoi-based rock cracks and pebble patterns
   - PBR-like lighting with Fresnel and GGX specular
   - Real-time normal map generation from FBM noise
   - Height and slope-based material blending
   - Triplanar mapping for cliffs (no UV stretching)
   - Subsurface scattering approximation for grass

5. **Terrain.ts** - Enhanced terrain geometry with THREE.Terrain-style algorithms
   - **256-level elevation system** (0-255, like StarCraft 2)
   - Proper Perlin noise with gradient interpolation
   - Fractal Brownian Motion (fBM) for multi-octave noise
   - Ridged multi-fractal noise for mountain ridges
   - Voronoi/Worley noise for cellular rock patterns
   - Turbulence noise for hard-edged features
   - Gaussian smoothing pass for natural transitions
   - Bilinear height interpolation for smooth unit movement
   - Per-biome configuration with distinct visual styles
   - **Terrain feature rendering** with color tints for water, forests, mud, roads
   - **Speed modifier queries** for movement system integration
   - **Vision blocking queries** for forest concealment

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

## Terrain Feature System

### MapTypes.ts - Terrain Data Structures

```typescript
// 256-level elevation (like SC2)
type Elevation = number; // 0-255

// Gameplay elevation zones
function elevationToZone(elevation: Elevation): 'low' | 'mid' | 'high';

// Terrain features overlay terrain types
type TerrainFeature =
  | 'none'           // Normal terrain
  | 'water_shallow'  // 0.6x speed, unbuildable
  | 'water_deep'     // Impassable
  | 'forest_light'   // 0.85x speed, partial vision
  | 'forest_dense'   // 0.5x speed, blocks vision
  | 'mud'            // 0.4x speed
  | 'road'           // 1.25x speed
  | 'void'           // Impassable
  | 'cliff';         // Impassable, blocks vision

// Feature configuration
interface TerrainFeatureConfig {
  walkable: boolean;
  buildable: boolean;
  speedModifier: number;
  blocksVision: boolean;
  partialVision: boolean;
  flyingIgnores: boolean;
}
```

### Map Helper Functions

```typescript
// Forest corridors with clear paths
createForestCorridor(grid, x1, y1, x2, y2, width, pathWidth, denseEdges);

// Rivers with optional bridge crossings
createRiver(grid, x1, y1, x2, y2, width, bridgePosition, bridgeWidth);

// Circular lakes with shallow edges
createLake(grid, centerX, centerY, radius, shallowEdgeWidth);

// Impassable void areas
createVoidChasm(grid, x, y, width, height, edgeWidth);

// Fast movement roads
createRoad(grid, x1, y1, x2, y2, width);

// Mud/swamp areas
createMudArea(grid, centerX, centerY, radius);

// Procedural forest scattering
scatterForests(grid, mapWidth, mapHeight, count, minRadius, maxRadius, exclusionZones, seed, denseChance);
```

### Pathfinding Integration (AStar.ts)

```typescript
// Movement costs per cell
interface PathNode {
  moveCost: number;  // 1.0 = normal, <1 = faster (road), >1 = slower (mud/forest)
}

// Cost calculation
const terrainCost = baseCost * neighbor.moveCost;
```

### Movement System Integration

```typescript
// Speed modifiers applied in MovementSystem
const terrainSpeedMod = getTerrainSpeedModifier(x, y, isFlying);
targetSpeed *= terrainSpeedMod;
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
- **MapBorderFog**: SC2-style dark smoky fog around map edges, animated shader with multi-octave simplex noise for organic smoke movement

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

### Building Placement System (`BuildingPlacementSystem.ts`)

Handles SC2-style Terran construction:

```typescript
// Building states
type BuildingState =
  | 'waiting_for_worker'  // Blueprint placed, worker en route
  | 'constructing'        // Worker present, construction progressing
  | 'paused'              // Started but no worker present
  | 'complete'            // Finished
  | 'destroyed';          // Destroyed

// Construction flow
handleBuildingPlace(buildingType, position, workerId);  // Place blueprint
handleResumeConstruction(workerId, buildingId);         // Resume paused building
updateBuildingConstruction(dt);                          // Progress/pause logic
cancelOrphanedBlueprints();                              // Only cancel waiting_for_worker

// Events emitted
'building:placed'              // Building blueprint created
'building:construction_started' // Worker arrived, construction begins
'building:construction_paused'  // Worker left, construction paused
'building:construction_resumed' // Worker resumed construction
'building:complete'             // Construction finished
'building:cancelled'            // Blueprint cancelled (refunded)
```

Key features:
- **Pause/Resume**: Construction pauses when worker leaves, resumes when assigned
- **Right-click Resume**: Workers can right-click paused buildings to resume
- **No Auto-Cancel**: Paused buildings persist until manually resumed or destroyed
- **Multiple Workers**: Multiple workers can speed up construction

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

## Dynamic Pathfinding System

### PathfindingSystem (`PathfindingSystem.ts`)

Manages dynamic path calculation with obstacle detection and automatic repathing:

```typescript
// Path invalidation on obstacle changes
eventBus.on('building:placed', (data) => {
  blockArea(data.position, data.width, data.height);
  invalidateAffectedPaths();
});

eventBus.on('building:destroyed', (data) => {
  unblockArea(data.position, data.width, data.height);
  invalidateAffectedPaths();
});

// Stuck detection configuration
const REPATH_INTERVAL_TICKS = 30;    // Check every 1.5 seconds
const MAX_STUCK_TICKS = 6;           // Repath if no movement for 0.3 seconds
const PATH_REQUEST_COOLDOWN = 10;    // Prevent repath spam
const MIN_MOVEMENT_THRESHOLD = 0.05; // Minimum distance to count as movement
```

Features:
- **Path Request Integration**: MovementSystem emits `pathfinding:request` events for all move commands
- **Path Invalidation**: When buildings are placed/destroyed, affected unit paths are recalculated
- **Stuck Detection**: Units that haven't moved are automatically repathed with cooldown
- **Destination Proximity Check**: Skip repathing when units are within 2 units of destination
- **Terrain Feature Support**: Uses TERRAIN_FEATURE_CONFIG for walkability and movement costs

### AStar Algorithm (`AStar.ts`)

Grid-based A* pathfinding with terrain cost support:

```typescript
// Line-of-sight validated path smoothing
private smoothPath(path) {
  // Uses Bresenham's line algorithm to verify direct paths are clear
  // Only removes waypoints when hasLineOfSight() confirms no obstacles
}

// Corner-cutting prevention
private hasLineOfSight(x1, y1, x2, y2) {
  // Checks all cells along line using Bresenham's algorithm
  // Also validates diagonal movement doesn't cut through corners
}
```

Features:
- **Terrain Movement Costs**: Roads (0.7x), forests (1.3-1.8x), mud (1.5x), water (2.0x)
- **Octile Distance Heuristic**: Accurate cost estimation for 8-directional movement
- **Line-of-Sight Path Smoothing**: Removes redundant waypoints only when clear path exists
- **Nearest Walkable Fallback**: Finds alternative destination if target is blocked

### HierarchicalAStar (`HierarchicalAStar.ts`)

Two-level hierarchical pathfinding for long-distance paths:

```typescript
// Sector-based pathfinding for distances > 20 units
const SECTOR_SIZE = 16;  // 16x16 cell sectors
const HIERARCHICAL_PATH_THRESHOLD = 20;

// Refine abstract path through sector entrances
private refineAbstractPath(startX, startY, endX, endY, abstractPath) {
  // Collect waypoints: start -> sector entrances -> end
  // Pathfind between consecutive waypoints
  // Concatenate segments into full path
}
```

Features:
- **Sector Graph**: Map divided into 16x16 sectors with entrance detection
- **Abstract Pathfinding**: A* on sector graph for long-distance routing
- **Waypoint Refinement**: Detailed A* between sector entrances
- **Path Caching**: LRU cache with 5-second TTL for frequently used paths
- **Automatic Fallback**: Uses regular A* for same/adjacent sector paths

## AI Micro System

### AIMicroSystem (`AIMicroSystem.ts`)

Handles tactical unit control for AI players:

```typescript
// Kiting for ranged units
if (shouldKite(unit, nearestMeleeEnemy)) {
  kiteAwayFrom(unit, enemy.position);
  reacquireTarget(unit);
}

// Focus fire on low-health targets
const FOCUS_FIRE_THRESHOLD = 0.7;
if (currentTarget.healthPercent > FOCUS_FIRE_THRESHOLD) {
  const betterTarget = findLowHealthTarget();
  if (betterTarget) switchTarget(unit, betterTarget);
}

// Threat assessment
interface ThreatInfo {
  entityId: number;
  threatScore: number;    // Based on DPS, priority, distance
  distance: number;
  healthPercent: number;
  dps: number;
}
```

Features:
- **Kiting Logic**: Ranged units maintain distance from melee threats
- **Focus Fire**: AI coordinates attacks on low-health or high-priority targets
- **Threat Assessment**: Ranks nearby enemies by threat score
- **Retreat Logic**: Damaged units retreat to base when overwhelmed

### Counter-Building System

Analyzes enemy composition and recommends unit production:

```typescript
interface EnemyComposition {
  infantry: number;
  vehicles: number;
  air: number;
  workers: number;
  total: number;
}

// Counter matrix
const COUNTER_MATRIX = {
  marine: ['hellion', 'hellbat', 'siege_tank'],
  siege_tank: ['viking', 'banshee', 'marine'],
  thor: ['marine', 'marauder', 'siege_tank'],
};

// AI adapts production to counter enemy
if (enemyComp.air > 0.3 * enemyComp.total) {
  prioritize(['viking', 'marine', 'thor']);
}
```

Enabled for 'hard', 'very_hard', and 'insane' difficulties.

## Behavior Tree System

### BehaviorTree (`ai/BehaviorTree.ts`)

Composable behavior tree for unit AI decision making:

```typescript
// Node types
type BehaviorStatus = 'success' | 'failure' | 'running';

// Composite nodes
selector(...children);   // OR - try until one succeeds
sequence(...children);   // AND - try until one fails
parallel(threshold, ...children);  // Run all, succeed if N succeed

// Decorator nodes
inverter(child);         // Invert result
condition(predicate, child);  // Only run if condition true
cooldown(ms, child);     // Rate limit execution

// Action nodes
action((ctx) => boolean);  // Execute and return success/failure
wait(ms);                  // Wait for duration
```

Example combat micro tree:

```typescript
const combatMicroTree = selector(
  // Priority 1: Kite from melee enemies
  sequence(
    action(ctx => shouldKite(ctx)),
    action(ctx => executeKite(ctx))
  ),
  // Priority 2: Retreat if in danger
  sequence(
    action(ctx => isInDanger(ctx)),
    action(ctx => retreat(ctx))
  ),
  // Priority 3: Optimal positioning
  action(ctx => positionForCombat(ctx))
);
```

Features:
- **Composable**: Build complex behaviors from simple nodes
- **Stateful**: Blackboard stores per-unit decision data
- **Reusable**: Same tree works for multiple units

## Audio System

### MusicPlayer (`src/audio/MusicPlayer.ts`)

Dynamic music system that discovers and plays MP3 files randomly:

```typescript
// Initialize and play menu music
await MusicPlayer.initialize();
await MusicPlayer.discoverTracks();
MusicPlayer.play('menu');

// Switch to gameplay music
MusicPlayer.play('gameplay');

// Playback controls
MusicPlayer.pause();
MusicPlayer.resume();
MusicPlayer.skip();

// Volume control
MusicPlayer.setVolume(0.5);
MusicPlayer.setMuted(false);
```

Features:
- **Auto-discovery**: Scans `/audio/music/menu/` and `/audio/music/gameplay/` for MP3 files
- **Shuffle playback**: Tracks play in random order, reshuffles when all played
- **Crossfading**: 2-second crossfade between tracks
- **Category switching**: Separate playlists for menu and gameplay

### API Route (`src/app/api/music/route.ts`)

Server-side endpoint for discovering music files:
- `GET /api/music` - Returns list of available tracks in menu and gameplay folders

### SoundOptionsPanel (`src/components/game/SoundOptionsPanel.tsx`)

In-game sound settings UI:
- Music volume slider
- Sound effects volume slider
- Music on/off toggle
- SFX on/off toggle
- Now playing display with track name
- Play/pause and skip buttons

### AudioManager Integration

The AudioManager handles all game sound effects with category-based volume:
- `music`: Background music (controlled separately by MusicPlayer)
- `combat`: Weapon sounds, explosions, impacts
- `ui`: Click, error, notification sounds
- `unit`: Movement, attack confirmations
- `building`: Construction, production sounds
- `ambient`: Biome-specific ambient loops
- `voice`: Unit voice lines
- `alert`: Under attack, supply blocked alerts

## Audio Asset Guidelines

See `.claude/AUDIO_PROMPTS.md` for comprehensive audio generation prompts including:
- Music tracks (menu, gameplay, events)
- Unit sound effects
- Building sounds
- UI feedback sounds
- Ambient sounds
- Voice lines

## Homescreen 3D Background System

### HomeBackground Component (`src/components/home/HomeBackground.tsx`)

A cinematic Three.js animated background that creates an immersive menu experience similar to StarCraft 2:

```typescript
// Key features:
- Procedural void nebula shader with flowing noise patterns
- 3000+ animated stars with twinkling effect
- Floating asteroid field with rotation and drift
- Energy stream particle systems flowing toward center
- Cinematic camera movement following mouse position
- Post-processing pipeline (bloom, chromatic aberration, vignette)
```

### Visual Systems

1. **Void Nebula Shader** - Custom GLSL fragment shader
   - 6-octave fractal Brownian motion (fBM) for organic noise
   - Multi-layer color gradient based on noise intensity
   - Energy stream highlights with power function
   - Mouse-reactive position offset
   - Pulsing intensity animation

2. **Star Field** - GPU-instanced points
   - 3000 stars distributed in a spherical shell
   - Color variation (white, blue, purple tints)
   - Size-based distance scaling
   - Twinkle animation via vertex shader

3. **Asteroid Field** - Deformed icosahedrons
   - 15 randomly deformed asteroids
   - Individual rotation speeds
   - Gentle floating motion (sinusoidal)
   - Dark purple emissive material

4. **Energy Streams** - Point particle systems
   - 5 streams with 200 particles each
   - Particles flow from outer edges toward center
   - Lifetime-based respawning
   - Additive blending for glow effect

5. **Post-Processing Stack**
   - UnrealBloomPass (strength: 0.8, radius: 0.4, threshold: 0.85)
   - ChromaticAberrationShader (subtle edge distortion)
   - VignetteShader (darker edges for focus)

### Camera System

```typescript
// Cinematic camera movement:
- Base position at (0, 0, 5) looking at (0, 0, -5)
- Mouse tracking with 0.02 interpolation factor
- Subtle "breathing" motion via sine waves
- Results in parallax effect as mouse moves
```

### Integration

The HomeBackground is dynamically imported in `page.tsx` to avoid SSR issues:

```typescript
const HomeBackground = dynamic(() => import('@/components/home/HomeBackground'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#050010]" />,
});
```

### UI Overlay

The homepage uses glassmorphism design with:
- Translucent faction cards with backdrop blur
- Animated number counters for stats
- Shimmer animation on title text
- Staggered fade-in animations on load
- Mouse parallax on hero content
