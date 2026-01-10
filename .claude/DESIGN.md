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
- **Box Drag** - Multi-select
- **Ctrl+#** - Create control group
- **#** - Select control group
- **A** - Attack move
- **S** - Stop
- **H** - Hold position
- **P** - Patrol

## Map Design

### Map Design Principles
All maps follow StarCraft 2-inspired design principles:

1. **Protected Main Bases** - Each main base is ~90% enclosed by cliffs with a single narrow ramp exit
2. **Defensive Natural Expansions** - Natural expansions have chokepoints for defensive play
3. **Contested Center** - Central area with watch towers for map control
4. **Multiple Expansion Tiers** - Main → Natural → Third → Fourth → Gold bases
5. **Narrow Ramps** - 6-10 tile wide ramps for wall-offs and defense
6. **Elevation Variety** - Multiple elevation levels (0, 1, 2) for strategic positioning

### Available Maps

| Map | Players | Size | Biome | Description |
|-----|---------|------|-------|-------------|
| Crystal Caverns | 2 | 200×180 | Frozen | Horizontal 1v1 with protected bases and center gold |
| Void Assault | 2 | 220×220 | Void | Diagonal 1v1 with multiple attack paths |
| Scorched Basin | 4 | 280×280 | Desert | 4-player corner spawns with shared expansions |
| Contested Frontier | 6 | 360×320 | Jungle | 3v3 team map with two rows facing off |
| Titan's Colosseum | 8 | 400×400 | Volcanic | 8-player FFA/4v4 with central arena |

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

### Spawn Point Rules
- Only main base locations are valid spawn points
- Each player slot (1-8) maps to a specific main base
- AI and human players are assigned to main bases only
- Expansion locations are never spawn points

## Performance Targets

- 60 FPS with 200 units on screen
- < 100ms input latency (multiplayer)
- < 5 second initial load
- Support for 1v1, 2v2, 3v3, 4v4 game modes
