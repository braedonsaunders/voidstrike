# VOIDSTRIKE - Development Roadmap

## Phase 1: Foundation (Nearly Complete)

### Core Engine
- [x] Project setup (Next.js 14, TypeScript, Three.js)
- [x] Game state management (Zustand)
- [x] Entity Component System architecture
- [x] Game loop with fixed timestep
- [ ] Save/Load game state

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

## Phase 1.5: SC2 Parity (CRITICAL - Mostly Complete)

> **Goal**: Make the game FEEL like StarCraft 2 - responsive, fast, precise.
> These features are what separate a good RTS from a clunky one.

### Unit Movement & Micro (High Priority)
- [x] **Unit avoidance/steering** - Boids-like separation prevents unit clumping
- [x] **Unit acceleration/deceleration** - Smooth speed ramp with configurable acceleration
- [x] **Shift-click command queuing** - Queue move/attack/patrol commands with Shift
- [x] **Patrol command** - P key to patrol between waypoints

### Camera & Controls (High Priority)
- [x] **Camera location hotkeys** - F5-F8 to recall, Ctrl+F5-F8 to save positions
- [x] **Tab to cycle subgroups** - Cycle through unit types in current selection
- [x] **Double-tap control group** - Center camera on group

### Alerts & Feedback (High Priority)
- [x] **Under attack alerts** - Console notification when units/buildings take damage
- [x] **Minimap ping on attack** - Attack location highlighted via CombatSystem
- [x] **Idle worker button** - HUD button + F1 to select idle workers

### Production & Macro (Medium Priority)
- [ ] **Warp-in/Select all of type** - Select all barracks, all factories, etc.
- [ ] **Shared production queue UI** - When multiple production buildings selected
- [x] **Building dependencies** - Tech requirements validated in BuildingPlacementSystem

### Combat Feel (Medium Priority)
- [x] **Smart targeting** - Units auto-prioritize threats (high-value > workers)
- [x] **Area of effect damage** - Splash damage for siege tank & hellion
- [ ] **Focus fire indicator** - Visual cue when multiple units target same enemy

---

## Phase 1.6: Maps & UX Polish (MOSTLY COMPLETE)

> **Goal**: High-quality maps with visual variety and improved game setup UX.

### Map Visual Quality (Complete)
- [x] **Biome system** - 6 distinct biomes (Grassland, Desert, Frozen, Volcanic, Void, Jungle)
- [x] **PBR terrain materials** - Roughness/metalness per biome for realistic look
- [x] **Instanced grass/ground detail** - Thousands of grass blades via GPU instancing
- [x] **Enhanced decorations** - Biome-specific trees (pine, oak, dead, cactus, alien)
- [x] **Rock formations** - Improved procedural rock clusters
- [x] **Crystal fields** - For frozen/void biomes with glow effects
- [x] **Water/lava planes** - Animated shader with waves
- [x] **Particle effects** - Snow, dust, ash, spores per biome
- [x] **Environment manager** - Unified system for all map visuals

### Pre-Game Setup (Complete)
- [x] **Game options menu** - Map selection, settings, faction choice
- [x] **Map preview** - Biome-colored preview with spawn indicators
- [x] **Game settings** - Starting resources, speed, AI difficulty, fog of war
- [ ] **Procedural map generator** - Generate balanced maps with seed

### UX Improvements (Complete)
- [x] **Keyboard shortcuts help** - Modal showing all hotkeys (? key)
- [x] **Controls hint** - Small "Press ? for controls" in HUD and setup page

---

## Phase 2: Combat Depth

### Combat System
- [x] Attack command implementation
- [x] Damage calculation (types/armor)
- [x] Unit death and cleanup
- [x] Attack animations
- [x] Projectile system

### Abilities
- [x] Ability system framework
- [x] Cooldown management
- [x] Active ability targeting
- [ ] Passive ability effects
- [ ] Ability auto-cast toggle

### Tech Tree
- [x] Research system
- [x] Upgrade effects
- [x] Tech requirements

### UI Polish
- [x] Command card (abilities/actions)
- [x] Production panel
- [x] Tech tree viewer
- [ ] Unit info tooltips (hover for stats)
- [ ] Damage numbers (floating combat text)
- [ ] Unit wireframes in selection panel

### Audio (Complete)
- [x] Sound effect system
- [x] Spatial audio positioning
- [x] Unit acknowledgment voices ("Yes sir", "Moving out")
- [x] Combat sounds (weapon fire, impacts, deaths)
- [x] Alert sounds (under attack, research complete)
- [x] Ambient background sounds (biome-specific)
- [x] Audio asset documentation (AUDIO_ASSETS.md)

---

## Phase 3: Multiplayer

### Authentication
- [ ] Supabase Auth integration
- [ ] OAuth providers (Google, Discord, GitHub)
- [ ] Player profiles
- [ ] Session management

### Lobby System
- [ ] Create game lobby
- [ ] Browse open lobbies
- [ ] Join/leave mechanics
- [ ] Ready check
- [ ] Map selection
- [ ] Faction selection

### Networking
- [ ] Lockstep synchronization
- [ ] Input broadcasting
- [ ] Checksum validation
- [ ] Desync detection/recovery
- [ ] Reconnection handling
- [ ] Latency compensation

### Competitive
- [ ] ELO rating system
- [ ] Matchmaking queue
- [ ] Ranked/unranked modes
- [ ] Match result recording
- [ ] Leaderboards

---

## Phase 4: Second Faction (Synthesis)

### Units
- [ ] Probe (worker)
- [ ] Sentinel (basic combat)
- [ ] Stalker (ranged, blink)
- [ ] Immortal (armored)
- [ ] Colossus (siege)
- [ ] Archon (heavy)
- [ ] Oracle (caster)
- [ ] Carrier (capital)

### Buildings
- [ ] Nexus (main)
- [ ] Pylon (power/supply)
- [ ] Gateway (unit production)
- [ ] Forge (upgrades)
- [ ] Stargate (air units)
- [ ] Robotics Facility

### Mechanics
- [ ] Shield system
- [ ] Warp-in mechanic
- [ ] Pylon power fields
- [ ] Chrono boost

---

## Phase 5: Polish & Meta

### Replay System
- [ ] Command recording
- [ ] Playback controls
- [ ] Speed adjustment
- [ ] Camera following
- [ ] Replay sharing

### Spectator Mode
- [ ] Observer camera
- [ ] Production tab
- [ ] Army value display
- [ ] Player vision toggle

### Statistics
- [ ] Match history
- [ ] Win/loss by matchup
- [ ] APM tracking
- [ ] Resource graphs
- [ ] Unit composition timeline

### Quality of Life
- [ ] Tutorial missions
- [ ] Practice mode vs AI
- [ ] Custom hotkeys
- [ ] Graphics settings
- [ ] Accessibility options

---

## Phase 6: Third Faction (Swarm)

### Units
- [ ] Drone (worker, morphs into buildings)
- [ ] Zergling (fast melee)
- [ ] Roach (armored)
- [ ] Hydralisk (ranged)
- [ ] Mutalisk (air harass)
- [ ] Ultralisk (heavy)
- [ ] Infestor (caster)
- [ ] Brood Lord (siege)

### Buildings
- [ ] Hatchery (main, larva)
- [ ] Spawning Pool
- [ ] Evolution Chamber
- [ ] Spire
- [ ] Nydus Network

### Mechanics
- [ ] Creep spread
- [ ] Larva inject
- [ ] Unit morphing
- [ ] Burrow
- [ ] Regeneration

---

## Future Considerations

### Visual Polish
- [ ] Day/night cycle
- [ ] Weather effects
- [ ] Particle systems for abilities
- [ ] Unit death animations

### Map Editor
- [ ] Terrain painting
- [ ] Resource placement
- [ ] Spawn point setting
- [ ] Decoration objects
- [ ] Map validation
- [ ] Publishing system

### Esports Features
- [ ] Tournament bracket system
- [ ] Match scheduling
- [ ] Stream integration
- [ ] Prize pool tracking
- [ ] Team support

### Mobile Support
- [ ] Touch controls
- [ ] Simplified UI
- [ ] Portrait mode (observer only)

---

## Implementation Priority (Next Sprint)

**Batch 1: Movement Feel** (COMPLETE)
1. [x] Unit avoidance/steering - Boids-like separation
2. [x] Unit acceleration/deceleration - Smooth movement
3. [x] Shift-click command queuing - Essential for micro

**Batch 2: Macro Speed** (COMPLETE)
4. [x] Camera location hotkeys - F5-F8 save/recall
5. [x] Tab cycle subgroups - Army control
6. [x] Building dependencies - Tech tree completion

**Batch 3: Feedback Loop** (MOSTLY COMPLETE)
7. [x] Under attack alerts - Awareness
8. [x] Idle worker button - Economy management
9. [ ] Damage numbers - Combat feedback

**Next Focus:**
- [ ] Focus fire indicator
- [ ] Select all of type (production buildings)
- [ ] Shared production queue UI
- [ ] Unit acknowledgment voices
- [ ] Combat sounds
