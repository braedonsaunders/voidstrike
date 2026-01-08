# VOIDSTRIKE - Development Roadmap

## Current Priority: SC2 Parity (Single-Player)

> See **ROADMAP_SC2_PARITY.md** for comprehensive feature breakdown

---

## SC2-Level Visual Overhaul (January 2026) ✓

### Hybrid Architecture
- [x] **Three.js + Phaser 4 hybrid** - 3D world with 2D overlay system
- [x] **HybridGameCanvas** - Main component combining both engines
- [x] **OverlayScene** - Phaser 4 scene for tactical view and screen effects

### SC2-Level Rendering Systems
- [x] **SC2SelectionSystem** - Animated glowing selection rings with GLSL shaders
- [x] **SC2ParticleSystem** - GPU-instanced particles (muzzle flashes, explosions, debris)
- [x] **SC2PostProcessing** - Bloom, vignette, color grading, ACES tone mapping

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

### Pre-Game Setup
- [x] Game options menu
- [x] Map preview
- [x] Game settings (resources, speed, AI)
- [ ] Procedural map generator

### UX
- [x] Keyboard shortcuts help (?)
- [x] Controls hint in HUD

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
- [ ] Building placement ghost
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
- [ ] Audio settings (volume sliders)
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
