# VOIDSTRIKE - Development Roadmap

## Current Priority: SC2 Parity (Single-Player)

> See **ROADMAP_SC2_PARITY.md** for comprehensive feature breakdown

---

## SC2-Level Visual Overhaul (January 2026) ✓

### Cinematic Homescreen (January 2026) ✓
- [x] **HomeBackground.tsx** - Cinematic Three.js animated background for homepage
- [x] **Void Nebula Shader** - Procedural shader with fBM noise, mouse reactivity
- [x] **Star Field System** - 3000+ animated stars with twinkling
- [x] **Asteroid Field** - Floating deformed asteroids with rotation
- [x] **Energy Stream Particles** - 5 particle streams flowing toward center
- [x] **Post-Processing** - Bloom, chromatic aberration, vignette
- [x] **Cinematic Camera** - Mouse-following with breathing motion parallax
- [x] **Glassmorphism UI** - Redesigned homepage with translucent cards, animated counters
- [x] **Faction Showcases** - Interactive faction cards with hover effects, stats display

### Hybrid Architecture
- [x] **Three.js + Phaser 4 hybrid** - 3D world with 2D overlay system
- [x] **HybridGameCanvas** - Main component combining both engines
- [x] **OverlayScene** - Phaser 4 scene for tactical view and screen effects

### SC2-Level Rendering Systems
- [x] **SC2SelectionSystem** - Animated glowing selection rings with GLSL shaders
- [x] **SC2ParticleSystem** - GPU-instanced particles (muzzle flashes, explosions, debris)
- [x] **SC2PostProcessing** - Bloom, vignette, color grading, ACES tone mapping (fixed black screen bug)
- [x] **SC2TerrainShader** - Multi-layer procedural texturing with PBR-like lighting

### Visual Features
- [x] Team-colored pulsing selection rings with shimmer animation
- [x] Tactical overlay mode (toggle with backtick key)
- [x] Combat intensity screen effects (border glow, damage vignette)
- [x] Alert system with animated banners
- [x] Off-screen attack warning indicators
- [x] Screen shake on damage

---

## Critical Performance Fixes (January 2026)

### Fixed Issues (Round 1)
- [x] **Shadow mapping disabled** - 2048x2048 PCFSoftShadowMap causing <1 FPS on M1
- [x] **FogOfWar throttled** - Reduced from 60 FPS to 10 FPS updates
- [x] **Minimap throttled** - Reduced from 60 FPS to 15 FPS rendering
- [x] **React re-renders reduced** - SelectionPanel/ProductionQueue from 10 FPS to 4-5 FPS
- [x] **Renderer optimized** - Disabled antialiasing, capped pixel ratio to 1.5

### Fixed Issues (Round 2 - Deep Dive)
- [x] **Resource PointLights removed** - CRITICAL: 20+ PointLights were killing the GPU
- [x] **BuildingRenderer traverse() optimized** - Only traverse() on state change, not every frame
- [x] **Damage number spam limited** - Max 15 active, reduced duration to 0.7s
- [x] **Resource rotation removed** - Static rotation instead of animating every frame

### Fixed Issues (Round 3 - January 2026)
- [x] **Post-processing disabled by default** - Heavy render passes causing FPS drops
- [x] **Zustand store updates throttled** - From 60Hz to 10Hz to reduce React re-renders
- [x] **Vibrant terrain colors** - Increased saturation and reduced vertex color influence
- [x] **Building terrain positioning** - Buildings sometimes rendered underground. Added fallback height calculation when terrain not initialized.
- [x] **Enhanced terrain generation** - Implemented proper Perlin/Simplex noise, fBM, ridged noise, and Voronoi patterns for natural-looking terrain with THREE.Terrain-style algorithms.

---

## Critical Bug Fixes (January 2026)

### Gameplay Bugs Fixed
- [x] **AI unit ownership bug** - Units from AI buildings were assigned to player1 (hardcoded)
- [x] **Orbital Command model not updating** - BuildingRenderer didn't detect buildingId changes
- [x] **Workers going to enemy base** - Drop-off didn't check ownership or include upgraded bases
- [x] **Duplicate start buttons** - Moved start button to bottom of setup page
- [x] **AI spending player minerals** - BuildingPlacementSystem was deducting from player store for AI buildings
- [x] **Minimap camera position not updating** - Fixed store subscription and dependency array
- [x] **SC2TerrainShader not compiling** - Replaced dynamic fbm loop with fixed-octave versions for WebGL
- [x] **AI workers stuck at CC** - Drop-off distance was 3 units but CC center is 2.5 from edge, increased to 5
- [x] **AI deposits to player store** - ResourceSystem now only credits player1 store, AI tracks internally
- [x] **SC2-style mineral arcs** - Minerals now form tight arcs facing CC, ~7 units away (was 15-20)
- [x] **Worker mineral splitting** - Workers auto-spread across mineral patches, prefer <2 gatherers
- [x] **SC2-style flat terrain** - Buildable areas now perfectly flat, only cliffs have height variation
- [x] **Building placement grid** - Green/red tile visualization when placing buildings
- [x] **Phaser overlay integration** - Fixed event mismatches, added production/research/building alerts
- [x] **Combat feedback** - Player damage vignette, unit death effects, enhanced combat border
- [x] **Resource warnings** - "NOT ENOUGH MINERALS/VESPENE", "SUPPLY BLOCKED" alerts
- [x] **Ability splashes** - Major ability notifications (Stim Pack, Yamato Cannon)
- [x] **Rally point visibility** - Rally points now properly show when production buildings are selected
- [x] **Rally point right-click** - Right-clicking with building selected sets rally point
- [x] **Building placement elevation** - Placement grid follows terrain height on elevated areas
- [x] **Minimap fog of war** - Enemy units/buildings no longer visible through fog of war
- [x] **3D model integration** - AssetManager wired to load decoration models (trees, rocks, Xel'Naga tower)

### Building System Fixes
- [x] **Building construction completion bug** - Buildings would stay translucent, construction particles wouldn't disappear, buildings could resize incorrectly. Fixed material array handling and construction effect cleanup when switching to instanced rendering.
- [x] **Instanced rendering scale bug** - Buildings using instanced rendering appeared extremely small because the geometry was used without the model's normalization scale. Fixed by tracking and applying modelScale to instance matrices.
- [x] **Layer-by-layer construction reveal** - Replaced opacity-only animation with clipping plane reveal. Buildings now reveal from bottom to top with construction particles at the build height.
- [x] **Supply depot/refinery heights** - Fixed target heights (supply_depot: 0.9→1.8, refinery: 2.0→2.5) to match procedural versions and prevent buildings from appearing half in the ground.
- [x] **Orphaned blueprint defeat bug** - Players could avoid defeat by having building blueprints (waiting_for_worker state) even with no complete buildings. Fixed by: (1) Victory condition now only counts complete buildings, not blueprints. (2) Blueprints are automatically cancelled and resources refunded when the assigned worker is reassigned to another task.
- [x] **Building completion health bug** - Buildings completed at low health and on fire because ProductionSystem was also calling updateConstruction() without updating health, racing with BuildingPlacementSystem. Fixed by removing duplicate construction handling from ProductionSystem.

### Resource Rendering Fixes (January 2026)
- [x] **Debug logging for resource rendering** - Added comprehensive logging to trace mineral/vespene spawning and instanced mesh creation
- [x] **Resource geometry validation** - Added safety check for models with < 3 vertices, fallback to procedural geometry
- [x] **yOffset/baseScale clamping** - Prevent resources from rendering underground or at invisible scales due to bad model transforms
- [x] **Natural expansion minerals not visible** - Fixed by clamping baseScale to >= 0.1. The minerals.glb model normalization was causing baseScale to be ~0.02, making minerals invisible.
- [x] **Watch tower vision ring artifacts** - Removed decorative vision range rings from MapDecorations that were causing "eye-shaped shadow" visual artifacts on maps with multiple watch towers.

### SCV Repair System Fixes (January 2026)
- [x] **Right-click repair on buildings** - SCVs can now right-click on friendly damaged buildings/mechanical units to repair them. Previously only move command was issued.
- [x] **Repair visual feedback** - Green pulsing selection ring flash appears on target when repair command is issued.
- [x] **Autocast repair toggle** - Added autocastRepair property to workers. When enabled, idle SCVs automatically repair nearby damaged buildings/mechanical units within 8 range.

### Pathfinding System Overhaul (January 2026)
- [x] **MovementSystem path requests** - Fixed critical bug where move commands didn't request paths from PathfindingSystem, causing units to walk directly into obstacles
- [x] **Path smoothing line-of-sight validation** - Replaced direction-based smoothing with Bresenham's line algorithm to verify waypoints don't skip through obstacles
- [x] **Stuck detection improvements** - Reduced stuck detection from 10 to 6 ticks, added cooldown to prevent path request spam, skip repath when near destination
- [x] **HierarchicalAStar waypoint pathing** - Fixed refineAbstractPath to actually use sector entrances instead of falling back to full A* for all long paths
- [x] **Terrain feature integration** - Updated loadTerrainData to use TERRAIN_FEATURE_CONFIG for proper walkability and movement cost calculations
- [x] **Proactive path fallback** - Units with targets but no paths now automatically request paths for distances > 3 units
- [x] **Patrol and queue path requests** - Added path requests for patrol commands and shift-click queued commands
- [x] **Path request spam prevention** - Added 500ms cooldown per unit to prevent flooding pathfinding system when no path can be found
- [x] **Alternate path fallback** - When path not found, now tries nearby walkable cells for both start and end positions to escape stuck situations

### Camera & Input Fixes (January 2026)
- [x] **WASD keys removed from camera** - WASD was conflicting with shortcuts (A=attack move, S=stop, etc.). Camera now uses arrow keys only for keyboard panning.

### UI Improvements
- [x] **Options menu** - Replaced Menu button with dropdown (Controls, Tech Tree, Exit to Menu)
- [x] **Increased building avoidance** - Units now properly avoid walking through buildings
- [x] **Enhanced loading screen** - Real loading progress with granular stages (models, renderer, terrain, engine, audio), stunning animated particle background with nebulas, geometric shapes, constellation effects, and progress-reactive energy beam

### AI & Combat Fixes
- [x] **VisionSystem multi-player support** - Changed from hardcoded ['player1', 'ai'] to dynamic player registration, enabling proper 4-AI spectator games.
- [x] **AI attack persistence** - AI now stays in attacking state until all enemies are eliminated, preventing premature retreat when taking losses.
- [x] **AI proximity-based targeting** - Fixed FFA games where all AI targeted the same enemy. Now each AI targets their CLOSEST enemy (with priority for nearly-defeated enemies with ≤2 buildings).
- [x] **Units clipping into buildings** - Fixed bug where attacking units would get stuck inside target buildings. Added escape logic to force movement out before stopping to attack.
- [x] **AI units clipping through enemy CC** - Fixed attack targeting to position units at building EDGE instead of center, preventing units from clipping through enemy command centers.
- [x] **AI expansion support** - AI now builds expansion command centers at resource clusters without nearby bases, enabling multi-base strategies.
- [x] **AI repair functionality** - Workers automatically repair damaged buildings (<90% health) and mechanical units. Prioritizes critically damaged buildings first.
- [x] **Building destruction bug** - Fixed buildings with 0 health (on fire) not being destroyed. Added floating-point safety check for death detection.
- [x] **SC2-style AI expansion timing** - AI now expands more aggressively based on difficulty: Easy (2 bases max), Medium (3), Hard (4), Very Hard (5), Insane (6). Expansion triggers based on worker saturation and cooldowns similar to SC2 AI.
- [x] **AI tech unit production** - AI now builds tech labs and produces advanced units (devastator, colossus, breacher, operative, specter, valkyrie). Build orders updated to include research modules. Tech unit production probability significantly increased.
- [x] **Player1 AI spectator fix** - Fixed bug where player1 as AI was treated as human player due to ID-based check instead of type-based check. This could cause AI player1 to not function correctly.
- [x] **Player status panel ordering** - Fixed player list ordering in spectator mode to sort by player ID (Player 1, Player 2, etc.) instead of array insertion order.
- [x] **AI units not attacking** - Fixed multiple bugs preventing AI units from attacking:
  - **Root cause**: AI was sending ATTACK commands with `targetPosition` (attack-move) instead of `targetEntityId` (direct attack), relying on broken auto-acquire
  - **Fix**: AI now uses `findNearestEnemyEntity()` to find specific targets and sends direct ATTACK commands with `targetEntityId`, same as player right-click attacks
  - Also fixed: EnhancedAISystem gives orders to 'moving' units, AIMicroSystem preserves targets during kiting, CombatSystem handles edge cases

### Future Optimizations
- [ ] Instanced decorations (trees, rocks, debris - 1000s of draw calls)
- [ ] Graphics settings UI (shadows optional)
- [ ] Web Worker for AI calculations
- [ ] Damage number texture atlas (pool instead of create)

---

## Phase 1: Foundation (COMPLETE ✓)

### Core Engine
- [x] Project setup (Next.js 14, TypeScript, Three.js)
- [x] Game state management (Zustand)
- [x] Entity Component System architecture
- [x] Game loop with fixed timestep
- [x] Save/Load game state

### Rendering
- [x] Three.js scene setup
- [x] Terrain rendering with heightmap + procedural details
- [x] Camera controls (pan, zoom, rotate, edge scroll)
- [x] Unit rendering with instancing
- [x] Building rendering
- [x] Selection indicators
- [x] Fog of war shader
- [x] Combat effects (projectiles, hits)
- [x] 3D Asset System (procedural + GLTF loader)

### Input & Selection
- [x] Mouse input handling
- [x] Box selection
- [x] Control groups (Ctrl+1-9)
- [x] Right-click commands
- [x] Keyboard shortcuts
- [x] Minimap interaction

### Pathfinding
- [x] A* algorithm implementation
- [x] Web Worker offloading
- [x] Spatial grid for collision

### Units & Buildings
- [x] Unit data definitions
- [x] Building data definitions
- [x] Unit spawning system
- [x] Building placement with validation
- [x] Construction progress
- [x] Production queues
- [x] Rally points

### Resources
- [x] Resource node system
- [x] Worker gathering mechanics
- [x] Resource storage/tracking
- [x] Supply/population system (UI + tracking)

---

## Phase 1.5: SC2 Feel (COMPLETE ✓)

### Unit Movement & Micro
- [x] Unit avoidance/steering (Boids-like)
- [x] Unit acceleration/deceleration
- [x] Shift-click command queuing
- [x] Patrol command (P key)

### Camera & Controls
- [x] Camera location hotkeys (F5-F8)
- [x] Tab to cycle subgroups
- [x] Double-tap control group to center camera

### Alerts & Feedback
- [x] Under attack alerts
- [x] Minimap ping on attack
- [x] Idle worker button (F1)

### Production & Macro
- [x] Select all of type (Ctrl+click)
- [x] Shared production queue UI
- [x] Building dependencies (tech requirements)

### Combat Feel
- [x] Smart targeting (priority system)
- [x] Area of effect damage (splash)
- [x] Focus fire indicator

---

## Phase 1.6: Maps & Environment (COMPLETE ✓)

### Map Visual Quality
- [x] Biome system (6 biomes)
- [x] PBR terrain materials
- [x] Instanced grass/ground detail
- [x] Enhanced decorations (trees, rocks, crystals)
- [x] Water/lava animated planes
- [x] Particle effects (snow, dust, ash, spores)
- [x] Environment manager
- [x] Map border fog (SC2-style smoky fog effect around map edges)

### Pre-Game Setup
- [x] Game options menu
- [x] Map preview
- [x] Game settings (resources, speed, AI)
- [ ] Procedural map generator

### UX
- [x] Keyboard shortcuts help (?)
- [x] Controls hint in HUD

---

## Phase 1.7: Enhanced Terrain System (COMPLETE ✓)

### 256-Level Elevation System (SC2 Parity)
- [x] Expanded elevation from 3 levels (0-2) to 256 levels (0-255)
- [x] Gameplay zones (low: 0-85, mid: 86-170, high: 171-255)
- [x] Smooth elevation gradients for natural terrain
- [x] High-ground advantage combat integration

### Terrain Features
- [x] TerrainFeature type system (water, forest, mud, road, void, cliff)
- [x] Feature configurations (walkable, buildable, speed modifier, vision blocking)
- [x] Terrain color tinting for feature rendering
- [x] Flying unit feature bypass

### Movement & Pathfinding Integration
- [x] Terrain speed modifiers in MovementSystem
- [x] Pathfinding cost modifiers in AStar.ts
- [x] Feature-aware walkability checks in Terrain.ts

### Map Helper Functions
- [x] createForestCorridor() - Forest paths with clear center
- [x] createRiver() - Water barriers with optional bridges
- [x] createLake() - Circular water bodies with shallow edges
- [x] createVoidChasm() - Impassable void areas
- [x] createRoad() - Fast movement corridors
- [x] createMudArea() - Slow movement zones
- [x] scatterForests() - Procedural forest placement
- [x] fillFeatureRect/Circle() - General feature painting

### All Maps Redesigned
- [x] Crystal Caverns - Frozen lakes, ice corridors, icy slow zones
- [x] Void Assault - Void chasms, alien forests, energy pools
- [x] Scorched Basin - Lava lakes, scorched forests, sand slow zones
- [x] Contested Frontier - Rivers with bridges, dense jungle, mud pits
- [x] Titan's Colosseum - Lava moats, volcanic pits, highway system

---

## Phase 2: Combat & Abilities (COMPLETE ✓)

### Combat System
- [x] Attack command implementation
- [x] Damage calculation (4 types, 4 armor types)
- [x] High ground advantage (30% miss)
- [x] Unit death and cleanup
- [x] Attack animations
- [x] Projectile system

### Abilities
- [x] Ability system framework
- [x] Cooldown management
- [x] Active ability targeting
- [x] Passive ability effects
- [x] Ability auto-cast toggle

### Tech Tree
- [x] Research system
- [x] Upgrade effects
- [x] Tech requirements

### UI
- [x] Command card (abilities/actions)
- [x] Production panel
- [x] Tech tree viewer
- [x] Unit info tooltips
- [x] Damage numbers
- [ ] Unit wireframes in selection panel

### Audio Framework
- [x] Sound effect system (Howler.js)
- [x] Spatial audio positioning
- [x] Audio asset documentation

---

## Phase 2.5: Advanced Unit Mechanics (COMPLETE ✓)

### Transform Mechanics
- [x] Siege Tank (Tank ↔ Siege mode)
- [x] Hellion ↔ Hellbat
- [x] Viking (Fighter ↔ Assault mode)

### Cloak & Detection
- [x] Cloak implementation (Ghost, Banshee)
- [x] Detection (Missile Turret, Sensor Tower, Raven, Scanner Sweep)

### Transport & Bunker
- [x] Medivac load/unload (8 capacity)
- [x] Bunker system (4 infantry, fire from inside)

### Healing & Repair
- [x] SCV repair (buildings, mechanical)
- [x] Medivac heal (biological)

### Building Features
- [x] Lift-off/Landing (CC, Barracks, Factory, Starport)
- [x] Addons (Tech Lab, Reactor)
- [x] Addon swap mechanics
- [x] Supply Depot lowering

---

## Phase 3: AI System (COMPLETE ✓)

### AI Behaviors
- [x] 5 difficulty levels (Easy → Insane)
- [x] Build order system
- [x] Scouting behavior
- [x] Multi-pronged attacks
- [x] Harassment tactics
- [x] Worker management
- [x] Defense coordination

### Game State
- [x] Victory/defeat conditions
- [x] Player statistics (units, resources, APM)

---

## Phase 4: Remaining Dominion Polish (IN PROGRESS)

### Missing Abilities
- [ ] Auto Turret (Raven)
- [ ] Interference Matrix (Raven)
- [ ] Anti-Armor Missile (Raven)
- [ ] Afterburners (Medivac)
- [ ] KD8 Charge (Reaper)
- [ ] High Impact Payload toggle (Thor)

### Missing Features
- [ ] Salvage bunker (return 75%)
- [ ] Cancel construction (return 75%)
- [ ] Building burning (low HP damage)
- [ ] Neosteel Frame research (+2 bunker)
- [ ] Building Auto-Repair research

### Visual Polish
- [ ] Unit wireframes (damage state)
- [x] Building placement ghost - SC2-style grid + ghost preview when placing
- [ ] Stim Pack visual effect (red tint)
- [ ] Siege Mode transform animation
- [ ] Cloak shimmer effect
- [ ] Nuke targeting laser
- [ ] Death animations

---

## Phase 5: Audio Content (TODO)

### Weapon Sounds
- [ ] Gauss rifle (Marine)
- [ ] Punisher grenades (Marauder)
- [ ] Flamethrower (Hellion)
- [ ] Arclite cannon (Siege Tank)
- [ ] Laser batteries (Battlecruiser)

### Voice Lines
- [ ] Unit acknowledgments (5+ per unit)
- [ ] Attack confirmations
- [ ] Advisor lines ("Under attack", "Research complete")

### Music
- [ ] Menu theme
- [ ] Gameplay ambient
- [ ] Victory/defeat themes

---

## Phase 6: Second Faction - Synthesis (TODO)

### Core Mechanics
- [ ] Shield system (regen, EMP interaction)
- [ ] Pylon power fields
- [ ] Warp-in mechanic
- [ ] Chrono Boost

### Units (14)
- [ ] Probe, Zealot, Stalker, Sentry, Adept
- [ ] High Templar, Dark Templar, Archon
- [ ] Immortal, Colossus
- [ ] Phoenix, Void Ray, Oracle, Carrier

### Buildings (13)
- [ ] Nexus, Pylon, Gateway/Warp Gate
- [ ] Forge, Cybernetics Core
- [ ] Twilight Council, Templar Archives, Dark Shrine
- [ ] Robotics Facility, Robotics Bay
- [ ] Stargate, Fleet Beacon
- [ ] Photon Cannon

### Research (30+)
- [ ] Weapons/Armor/Shields upgrades
- [ ] Unit-specific abilities (Charge, Blink, Storm, etc.)

---

## Phase 7: Quality of Life (TODO)

### Tutorial System
- [ ] Basic controls tutorial
- [ ] Economy tutorial
- [ ] Combat tutorial
- [ ] Advanced tutorial

### Settings
- [ ] Custom hotkeys
- [ ] Graphics settings (quality presets)
- [x] Audio settings (volume sliders, music player, SFX controls)
- [ ] Gameplay settings

### Skirmish Options
- [ ] Multiple AI opponents
- [ ] Team games (2v2, 3v3)
- [ ] Custom game options

### Map Generator
- [ ] Procedural generation
- [ ] Seed system

---

## Phase 8: Replay System (TODO)

- [ ] Command recording
- [ ] Playback controls
- [ ] Speed adjustment
- [ ] Analysis features (graphs, timeline)

---

## Phase 9: Third Faction - Swarm (TODO)

### Core Mechanics
- [ ] Creep system
- [ ] Larva/inject system
- [ ] Morph mechanics
- [ ] Burrow
- [ ] Regeneration

### Units (14)
- [ ] Drone, Zergling, Baneling, Roach, Ravager
- [ ] Hydralisk, Lurker, Queen
- [ ] Mutalisk, Corruptor, Brood Lord
- [ ] Infestor, Swarm Host, Ultralisk, Viper

### Buildings (17)
- [ ] Hatchery/Lair/Hive, Spawning Pool
- [ ] Baneling Nest, Roach Warren, Hydralisk Den, Lurker Den
- [ ] Infestation Pit, Ultralisk Cavern
- [ ] Spire, Greater Spire, Evolution Chamber
- [ ] Extractor, Spine/Spore Crawler, Nydus Network

---

## Future: Multiplayer (Not in SC2 Parity Scope)

- [ ] Authentication (Supabase)
- [ ] Lobby system
- [ ] Lockstep networking
- [ ] Matchmaking
- [ ] Ranked system
- [ ] Leaderboards

---

## Current Sprint Focus

**Sprint 1: Dominion Polish**
1. [ ] Implement remaining Raven abilities
2. [ ] Add unit wireframes to selection panel
3. [ ] Building placement ghost preview
4. [ ] Generate weapon sound effects

**Sprint 2: Visual Effects**
1. [ ] Ability visual effects (Siege, Cloak, Nuke)
2. [ ] Death animations
3. [ ] Muzzle flashes
4. [ ] Complete audio generation

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Core Engine | 100% | Production-ready |
| Dominion Units | 95% | Missing some abilities |
| Dominion Buildings | 100% | All 16 complete |
| Combat System | 100% | All damage/armor types |
| AI System | 100% | 5 difficulty levels |
| UI/HUD | 95% | Missing wireframes |
| Audio | Framework only | Needs actual assets |
| Synthesis Faction | 0% | Not started |
| Swarm Faction | 0% | Not started |
| Multiplayer | 0% | Excluded from scope |
