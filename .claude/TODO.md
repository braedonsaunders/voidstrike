# VOIDSTRIKE - Development Roadmap

## Phase 1: Foundation (Current)

### Core Engine
- [x] Project setup (Next.js 14, TypeScript, Three.js)
- [x] Game state management (Zustand)
- [x] Entity Component System architecture
- [x] Game loop with fixed timestep
- [ ] Save/Load game state

### Rendering
- [x] Three.js scene setup
- [x] Terrain rendering with heightmap
- [x] Camera controls (pan, zoom, rotate, edge scroll)
- [x] Unit rendering with instancing
- [x] Building rendering
- [x] Selection indicators
- [ ] Fog of war shader
- [ ] Day/night cycle (stretch)

### Input & Selection
- [x] Mouse input handling
- [x] Box selection
- [x] Control groups (Ctrl+1-9)
- [x] Right-click commands
- [x] Keyboard shortcuts
- [ ] Minimap interaction

### Pathfinding
- [x] A* algorithm implementation
- [x] Web Worker offloading
- [x] Spatial grid for collision
- [ ] Flow field pathfinding (optimization)
- [ ] Unit avoidance/steering

### Units & Buildings
- [x] Unit data definitions
- [x] Building data definitions
- [x] Unit spawning system
- [x] Building placement with validation
- [x] Construction progress
- [ ] Rally points
- [ ] Production queues

### Resources
- [x] Resource node system
- [x] Worker gathering mechanics
- [x] Resource storage/tracking
- [ ] Supply/population system

## Phase 2: Combat Depth

### Combat System
- [ ] Attack command implementation
- [ ] Damage calculation (types/armor)
- [ ] Unit death and cleanup
- [ ] Attack animations
- [ ] Projectile system
- [ ] Area of effect damage

### Abilities
- [ ] Ability system framework
- [ ] Cooldown management
- [ ] Active ability targeting
- [ ] Passive ability effects

### Tech Tree
- [ ] Research system
- [ ] Upgrade effects
- [ ] Tech requirements
- [ ] Building dependencies

### UI Improvements
- [ ] Command card (abilities/actions)
- [ ] Production panel
- [ ] Tech tree viewer
- [ ] Unit info tooltips
- [ ] Damage numbers

### Audio
- [ ] Sound effect system
- [ ] Spatial audio positioning
- [ ] Unit voice lines
- [ ] Music system
- [ ] Ambient sounds

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

## Future Considerations

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
