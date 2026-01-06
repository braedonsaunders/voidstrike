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
│   │   │   └── SelectionPanel.tsx
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
│   │   │   ├── MovementSystem.ts
│   │   │   ├── CombatSystem.ts
│   │   │   ├── SelectionSystem.ts
│   │   │   ├── ProductionSystem.ts
│   │   │   └── ResourceSystem.ts
│   │   ├── components/
│   │   │   ├── Transform.ts
│   │   │   ├── Health.ts
│   │   │   ├── Selectable.ts
│   │   │   ├── Unit.ts
│   │   │   ├── Building.ts
│   │   │   └── Resource.ts
│   │   └── pathfinding/
│   │       ├── AStar.ts
│   │       ├── Grid.ts
│   │       └── pathfinder.worker.ts
│   ├── rendering/
│   │   ├── Scene.ts           # Three.js scene setup
│   │   ├── Camera.ts          # RTS camera controller
│   │   ├── Terrain.ts         # Terrain mesh generation
│   │   ├── UnitRenderer.ts    # Instanced unit rendering
│   │   └── FogOfWar.ts        # Fog of war system
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

## Performance Considerations

1. **Instanced Rendering**: All units of same type use instanced meshes
2. **Spatial Hashing**: O(1) lookups for nearby entities
3. **Web Workers**: Pathfinding runs off main thread
4. **Object Pooling**: Reuse entities, projectiles, particles
5. **LOD System**: Reduce detail at distance
6. **Frustum Culling**: Don't render off-screen entities
7. **Delta Compression**: Only send changed state in multiplayer
