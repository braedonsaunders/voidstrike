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

## Phase 1.5: SC2 Parity (CRITICAL - Current Focus)

> **Goal**: Make the game FEEL like StarCraft 2 - responsive, fast, precise.
> These features are what separate a good RTS from a clunky one.

### Unit Movement & Micro (High Priority)
- [ ] **Unit avoidance/steering** - Units shouldn't overlap or push through each other
- [ ] **Unit acceleration/deceleration** - Smooth speed ramp, not instant velocity
- [ ] **Shift-click command queuing** - Queue move/attack/ability commands
- [ ] **Patrol command** - Units move between waypoints, attack enemies in range

### Camera & Controls (High Priority)
- [ ] **Camera location hotkeys** - F5-F8 to save, Ctrl+F5-F8 to recall positions
- [ ] **Tab to cycle subgroups** - Cycle through unit types in current selection
- [ ] **Double-tap control group** - Center camera on group

### Alerts & Feedback (High Priority)
- [ ] **Under attack alerts** - Audio + visual notification when units/buildings take damage
- [ ] **Minimap ping on attack** - Flash attack location on minimap
- [ ] **Idle worker button** - Click to select idle workers

### Production & Macro (Medium Priority)
- [ ] **Warp-in/Select all of type** - Select all barracks, all factories, etc.
- [ ] **Shared production queue UI** - When multiple production buildings selected
- [ ] **Building dependencies** - Factory requires Barracks, etc.

### Combat Feel (Medium Priority)
- [ ] **Smart targeting** - Units auto-prioritize threats (workers < combat units)
- [ ] **Area of effect damage** - Splash damage for siege units
- [ ] **Focus fire indicator** - Visual cue when multiple units target same enemy

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

### Audio
- [x] Sound effect system
- [x] Spatial audio positioning
- [ ] Unit acknowledgment voices ("Yes sir", "Moving out")
- [ ] Combat sounds (weapon fire, impacts, deaths)
- [ ] Alert sounds (under attack, research complete)
- [ ] Ambient background sounds

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

**Batch 1: Movement Feel** (Do First)
1. Unit avoidance/steering - Prevents unit clumping
2. Unit acceleration/deceleration - Smooth movement
3. Shift-click command queuing - Essential for micro

**Batch 2: Macro Speed**
4. Camera location hotkeys - Fast base management
5. Tab cycle subgroups - Army control
6. Building dependencies - Tech tree completion

**Batch 3: Feedback Loop**
7. Under attack alerts - Awareness
8. Idle worker button - Economy management
9. Damage numbers - Combat feedback
