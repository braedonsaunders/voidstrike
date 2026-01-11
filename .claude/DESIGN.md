# VOIDSTRIKE - Design Document

## Overview

VOIDSTRIKE is a browser-based real-time strategy game inspired by StarCraft 2, built with modern web technologies. It features 3D graphics, competitive multiplayer, and deep strategic gameplay.

## Core Vision

**"Zero-friction competitive RTS"** - Click and play from any browser, no downloads required.

## Technical Architecture

### Frontend Stack
- **Three.js / React Three Fiber** - 3D rendering engine
- **Next.js 14** - App Router, Server Components
- **TypeScript** - Full type safety
- **Zustand** - Game state management
- **Web Workers** - Pathfinding, AI, simulation offloading
- **WebGPU** (WebGL fallback) - Graphics performance
- **Howler.js** - Spatial audio

### Backend Stack (Supabase + Vercel)
- **Supabase Realtime** - WebSocket multiplayer
- **Supabase Database** - Player data, matches, rankings
- **Supabase Auth** - OAuth authentication
- **Supabase Edge Functions** - Game server logic
- **Vercel Edge Functions** - Matchmaking
- **Vercel KV** - Session state caching

## Game Architecture

### Entity Component System (ECS)
The game uses an ECS architecture for maximum performance and flexibility:

```
Entity: Unique ID
Components: Data containers (Position, Health, Selectable, etc.)
Systems: Logic processors (MovementSystem, CombatSystem, etc.)
```

### Game Loop
```
1. Process Inputs (player commands)
2. Run Systems (physics, AI, combat)
3. Update State (ECS world)
4. Render Frame (Three.js)
5. Sync Network (multiplayer only)
```

### Lockstep Simulation
For multiplayer, we use deterministic lockstep:
- All clients run identical simulations
- Only inputs are transmitted (not state)
- Periodic checksums detect desync
- Enables replay system for free

## Faction Design

### The Dominion (Humans)
- **Theme**: Military industrial complex
- **Playstyle**: Versatile, defensive, siege warfare
- **Unique Mechanics**:
  - Siege modes (units transform)
  - Bunkers and fortifications
  - Healing/repair units

### The Synthesis (Machine Consciousness)
- **Theme**: Transcendent AI collective
- **Playstyle**: Powerful but expensive, shield-based
- **Unique Mechanics**:
  - Warp-in (instant unit deployment)
  - Shield regeneration
  - Psionic abilities

### The Swarm (Organic Hive)
- **Theme**: Adaptive biological horror
- **Playstyle**: Cheap, fast, overwhelming
- **Unique Mechanics**:
  - Creep spread (terrain control)
  - Unit morphing/evolution
  - Passive regeneration

## Resource System

### Primary Resources
1. **Minerals** - Basic resource, abundant
2. **Vespene** - Advanced resource, limited

### Economy Flow
```
Workers -> Resource Nodes -> Storage -> Production
```

### Worker Saturation (SC2-style)
Each resource node displays worker assignment status with floating labels showing "X/Y" (current/optimal):

| Resource Type | Optimal Workers | Max Useful Workers | Label Color |
|--------------|-----------------|-------------------|-------------|
| **Minerals** | 2 per patch | 3 per patch | Green when saturated, Yellow when under |
| **Vespene** | 3 per geyser | 3 per geyser | Green when saturated, Yellow when under |

- **Green (X/Y)**: Optimal saturation reached - maximum efficiency
- **Yellow (X/Y)**: Undersaturated - workers needed for optimal income
- **Gray (0/Y)**: No workers assigned

AI prioritizes filling extractors to 3 workers first, then distributes workers evenly across mineral patches (2 per patch optimal, 3 maximum).

## Combat System

### Damage Types
- **Normal** - Standard damage
- **Explosive** - Bonus vs large, reduced vs small
- **Concussive** - Bonus vs small, reduced vs large
- **Psionic** - Ignores armor

### Armor Types
- **Light** - Infantry, workers
- **Armored** - Vehicles, heavy units
- **Massive** - Capital ships, structures
- **Shields** - Synthesis units (regenerates)

## UI/UX Design

### HUD Layout
```
┌─────────────────────────────────────────┐
│ Resources    │    Game Timer   │ Menu   │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│              GAME VIEWPORT              │
│                                         │
│                                         │
├──────────┬─────────────────┬────────────┤
│ Minimap  │ Selection Panel │ Command    │
│          │                 │ Card       │
└──────────┴─────────────────┴────────────┘
```

### Control Scheme
- **Left Click** - Select unit/building
- **Right Click** - Move/Attack/Interact
- **Shift+Right Click** - Queue command (chain commands like SC2)
- **Shift+A Click** - Queue attack-move
- **Box Drag** - Multi-select
- **Ctrl+#** - Create control group
- **#** - Select control group
- **A** - Attack move
- **S** - Stop
- **H** - Hold position
- **P** - Patrol

### Command Queuing (Shift-Click)
Hold **Shift** while issuing commands to queue them in sequence:
- Units execute commands in order, proceeding to next when current completes
- Works with: Move, Attack, Attack-Move, Patrol, Gather
- Green waypoint indicators show queued destinations for selected units
- Press **S** (Stop) to clear all queued commands

### Building Placement Queuing (Shift-Click)
Hold **Shift** while placing buildings to queue multiple placements:
- Each shift-click places a building and stays in placement mode
- Green dashed path lines connect queued building positions (rally point style)
- Workers are assigned to each building as they become available
- Release shift and click to place final building and exit placement mode

## Map Design

### Map Design Principles
All maps follow StarCraft 2-inspired design principles:

1. **Protected Main Bases** - Each main base is ~90% enclosed by cliffs with a single narrow ramp exit
2. **Defensive Natural Expansions** - Natural expansions have chokepoints for defensive play
3. **Contested Center** - Central area with watch towers for map control
4. **Multiple Expansion Tiers** - Main → Natural → Third → Fourth → Gold bases
5. **Narrow Ramps** - 6-10 tile wide ramps for wall-offs and defense
6. **256-Level Elevation System** - SC2-style 0-255 height levels for smooth terrain (gameplay zones: low 0-85, mid 86-170, high 171-255)

### Terrain Feature System

Maps now include diverse terrain features that affect gameplay:

| Feature | Walkable | Buildable | Speed | Vision | Notes |
|---------|----------|-----------|-------|--------|-------|
| **Water (shallow)** | Yes | No | 0.6x | Clear | Rivers, ponds |
| **Water (deep)** | No | No | - | Clear | Lakes, impassable |
| **Forest (light)** | Yes | No | 0.85x | Partial | Small trees, slight cover |
| **Forest (dense)** | Yes | No | 0.5x | Blocked | Hides units, ambush positions |
| **Mud/Swamp** | Yes | No | 0.4x | Clear | Significant slow zone |
| **Road** | Yes | No | 1.25x | Clear | Fast movement corridors |
| **Void** | No | No | - | Clear | Map edges, chasms |
| **Cliff** | No | No | - | Blocked | Sheer drops |

### Strategic Terrain Elements

Each map now includes:

- **Forest Corridors** - Paths with dense trees on sides, clear roads in center
- **River Crossings** - Water barriers with bridge chokepoints
- **Void Chasms** - Impassable areas at map edges/corners
- **Road Networks** - Fast movement highways connecting key areas
- **Ambush Forests** - Dense forest patches for hiding armies
- **Mud Zones** - Contested areas with movement penalties

### Available Maps

| Map | Players | Size | Biome | Terrain Features |
|-----|---------|------|-------|------------------|
| Crystal Caverns | 2 | 200×180 | Frozen | Frozen lakes, ice corridors, icy slow zones |
| Void Assault | 2 | 220×220 | Void | Void chasms, alien forests, energy pools |
| Scorched Basin | 4 | 280×280 | Desert | Lava lakes, scorched forests, sand slow zones |
| Contested Frontier | 6 | 360×320 | Jungle | Rivers with bridges, dense jungle, mud pits |
| Titan's Colosseum | 8 | 400×400 | Volcanic | Lava moats, volcanic pits, highway system |

### Expansion Types (Standard Resource Amounts)
- **Standard Bases** (Main/Natural/Third) - 8 mineral patches: 6× 1500 + 2× 900 (close patches) = 10,800 total minerals
- **Gold Bases** - 8 mineral patches: 8× 900 = 7,200 total minerals (higher mining rate per patch)
- **Gas Geysers** - All geysers contain 2,250 vespene gas

Base Protection Levels:
- **Main Base** - Starting location, protected by cliffs with single ramp
- **Natural** - Close to main, semi-protected chokepoint
- **Third** - Contested, requires army presence
- **Gold** - High-risk high-reward, exposed position
- **Center** - Highly contested map control position

### High Ground Advantage

The combat system uses the elevation system:
- Attacking from low → high ground: 30% miss chance
- Attacking from low → mid ground: 15% miss chance
- Attacking from mid → high ground: 15% miss chance
- Same or higher elevation: No penalty

### Spawn Point Rules
- Only main base locations are valid spawn points
- Each player slot (1-8) maps to a specific main base
- AI and human players are assigned to main bases only
- Expansion locations are never spawn points

## Building Construction System (SC2-Style)

### Dominion Construction Mechanics

The Dominion faction uses StarCraft 2 Terran-style construction where workers (Fabricators) physically construct buildings:

**Construction Flow:**
1. Player selects a worker and places a building blueprint
2. Worker is assigned and moves to the construction site
3. Worker is "locked" to construction - they stay there building unless explicitly commanded to move
4. Construction progresses only while a worker is actively present at the site
5. When complete, the worker is released and returns to idle state

**Paused Construction:**
- If a worker is moved away from a construction site (via move command, gather, attack, repair), construction pauses
- The building remains at its current progress and health, waiting for a worker
- Any worker can resume construction by right-clicking on the paused building
- Paused buildings are NOT cancelled automatically - they persist indefinitely

**Worker Assignment:**
- Multiple workers can be assigned to the same building for faster construction
- Workers are automatically released when construction completes
- If the building is destroyed, assigned workers are released

**Building States:**
| State | Description |
|-------|-------------|
| `waiting_for_worker` | Blueprint placed, worker assigned but not arrived |
| `constructing` | Worker actively building, health increasing |
| `paused` | Construction started but no worker present |
| `complete` | Building finished, fully operational |

**Right-Click on Buildings:**
- Right-clicking a friendly under-construction building with workers selected assigns them to resume construction
- This works for `waiting_for_worker`, `constructing`, and `paused` buildings
- Visual feedback: yellow flash on building when construction is resumed

**Blueprint Cancellation:**
- Only blueprints in `waiting_for_worker` state (never started) are cancelled if no worker is assigned
- Resources are fully refunded for cancelled blueprints
- Once construction starts (`constructing` or `paused`), the building persists

## Fortification System

### Wall Buildings

| Building | Size | Cost | HP | Armor | Description |
|----------|------|------|-----|-------|-------------|
| **Wall Segment** | 1×1 | 25 minerals | 400 | 1 | Basic wall, connects to neighbors, can mount turrets |
| **Wall Gate** | 2×1 | 75 minerals | 500 | 2 | Entrance gate, opens for friendly units |

### Wall Line Placement

Walls use a special **click+drag placement mode**:
1. Select a worker and choose "Build Walls" (W)
2. Select wall type (Wall Segment or Gate)
3. **Click** to start wall line
4. **Drag** to preview wall path (snaps to straight lines)
5. **Release** to place all wall segments
6. Workers are automatically assigned round-robin

**Path Snapping:**
- Walls draw in straight lines only (horizontal, vertical, or 45° diagonal)
- Real-time cost display during drag
- Invalid positions shown in red

### Gate Mechanics

| State | Behavior |
|-------|----------|
| **Open** | Allows all units to pass |
| **Closed** | Blocks all units |
| **Auto** (default) | Opens for friendly units, closes after 2 seconds |
| **Locked** | Permanently closed until unlocked |

**Gate Commands:**
- `O` - Toggle Open/Close
- `L` - Lock/Unlock
- `A` - Set to Auto mode

### Wall Connections

Walls automatically connect to adjacent walls:
- Single segment: `■`
- Horizontal: `═══`
- Vertical: `║`
- Corners: `╔ ╗ ╚ ╝`
- T-junctions: `╦ ╩ ╠ ╣`
- Cross: `╬`

### Wall Upgrades

Upgrades are researched at Arsenal/Tech Center, then applied per-segment:

| Upgrade | Research Cost | Apply Cost | Effect |
|---------|---------------|------------|--------|
| **Reinforced Plating** | 100/100 | 25/0 | +400 HP, +2 armor |
| **Shield Generator** | 150/150 | 50/25 | +200 regenerating shield |
| **Integrated Weapons** | 100/100 | 40/25 | Adds auto-turret (5 dmg, 6 range) |
| **Repair Drone** | 75/75 | 30/15 | Auto-heals adjacent walls |

### Turret Mounting

- Defense Turrets can be placed **on top of** wall segments
- Mounted turrets gain +1 range and high-ground advantage
- Wall with mounted turret cannot be upgraded to Weapon Wall
- If wall is destroyed, mounted turret is also destroyed

## Performance Targets

- 60 FPS with 200 units on screen
- < 100ms input latency (multiplayer)
- < 5 second initial load
- Support for 1v1, 2v2, 3v3, 4v4 game modes
