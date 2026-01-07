# VOIDSTRIKE - StarCraft 2 Parity Roadmap (Updated)

> **Last Updated**: January 2026
> **Goal**: Achieve feature parity with StarCraft 2's single-player/skirmish experience
> **Scope**: Excludes multiplayer networking features (will be addressed separately)

---

## Current State Assessment

### What's Complete (95% of Dominion Faction)

**Core Engine**
- [x] ECS architecture (17 systems, 19 components)
- [x] Fixed timestep game loop (20 ticks/sec)
- [x] Event bus for inter-system communication
- [x] Command system (17+ command types)
- [x] A* pathfinding with Web Worker offloading

**Dominion Faction - Units (13 total)**
- [x] SCV (worker, repair)
- [x] Marine (Stim Pack)
- [x] Marauder (Concussive Shells, Stim Pack)
- [x] Reaper (Jet Pack placeholder)
- [x] Ghost (Snipe, EMP, Cloak, Nuke)
- [x] Hellion/Hellbat (transform)
- [x] Siege Tank (Tank/Siege mode transform)
- [x] Thor (High Impact Payload)
- [x] Medivac (heal, transport, load/unload)
- [x] Viking (Fighter/Assault transform)
- [x] Banshee (cloak)
- [x] Battlecruiser (Yamato Cannon, Tactical Jump)
- [x] Raven (detector, abilities placeholder)

**Dominion Faction - Buildings (16 total)**
- [x] Command Center / Orbital Command / Planetary Fortress
- [x] Supply Depot (lowering mechanic)
- [x] Refinery
- [x] Barracks (lift-off, addon support)
- [x] Engineering Bay
- [x] Bunker (load/unload infantry, attack from inside)
- [x] Factory (lift-off, addon support)
- [x] Armory
- [x] Starport (lift-off, addon support)
- [x] Fusion Core
- [x] Ghost Academy
- [x] Sensor Tower (detection)
- [x] Missile Turret (detection, attack)
- [x] Tech Lab (addon)
- [x] Reactor (addon)

**Combat Systems**
- [x] 4 damage types (Normal, Explosive, Concussive, Psionic)
- [x] 4 armor types (Light, Armored, Massive, Structure)
- [x] Damage-armor multiplier matrix
- [x] High ground advantage (30% miss chance)
- [x] Splash damage (radius-based)
- [x] Priority targeting
- [x] Focus fire
- [x] Attack-move, Hold position, Patrol

**Advanced Unit Mechanics**
- [x] Transform system (Siege Tank, Hellion, Viking)
- [x] Cloak system (Ghost, Banshee)
- [x] Detection system (Missile Turret, Sensor Tower, Raven, Scanner Sweep)
- [x] Transport system (Medivac load/unload)
- [x] Bunker system (4-unit capacity, firing from inside)
- [x] Healing (Medivac → biological)
- [x] Repair (SCV → mechanical/buildings)
- [x] Building lift-off/landing
- [x] Addon system (Tech Lab, Reactor)
- [x] Buff/debuff system with duration tracking

**Abilities Implemented**
- [x] Stim Pack (HP cost, speed/attack buff)
- [x] Concussive Shells (slow effect)
- [x] Combat Shield (permanent +10 HP)
- [x] Snipe (anti-biological, 150 damage)
- [x] EMP Round (drain shields/energy in AoE)
- [x] Nuke (10s channel, massive AoE damage)
- [x] Yamato Cannon (3s channel, 240 single-target damage)
- [x] Tactical Jump (teleport Battlecruiser)
- [x] MULE (temporary mining unit)
- [x] Scanner Sweep (reveal area)
- [x] Supply Drop (instant supply depot)

**AI System**
- [x] 5 difficulty levels (Easy → Insane)
- [x] Build order system
- [x] Scouting behavior
- [x] Multi-pronged attacks
- [x] Harassment tactics
- [x] Worker management
- [x] Defense coordination

**UI/UX**
- [x] Full HUD (resources, minimap, selection, command card)
- [x] Control groups (1-9, Ctrl+# to set, double-tap to center)
- [x] Shift-click command queuing
- [x] Tab to cycle subgroups
- [x] Camera hotkeys (F5-F8)
- [x] Idle worker button (F1)
- [x] Under attack alerts
- [x] Minimap pings
- [x] Unit tooltips with stats
- [x] Production queue panel
- [x] Tech tree viewer
- [x] Keyboard shortcuts help (?)

**Rendering**
- [x] 6 biome system with distinct visuals
- [x] PBR terrain materials
- [x] Instanced grass/decorations
- [x] Fog of war (3 states: unexplored/explored/visible)
- [x] Particle effects (snow, dust, ash, spores)
- [x] Combat effects (projectiles, impacts, damage numbers)
- [x] Rally point visualization

**Infrastructure**
- [x] Save/Load system (multiple slots, auto-save, quick save/load)
- [x] Victory/Defeat conditions
- [x] Player statistics tracking
- [x] Audio system framework (Howler.js)
- [x] 3 playable maps

---

## Remaining Work for SC2 Parity

### Phase 1: Missing Dominion Features (Priority: HIGH)

**Estimated Effort**: Small

#### 1.1 Missing Abilities
- [ ] **Auto Turret** (Raven) - Deploy temporary turret
- [ ] **Interference Matrix** (Raven) - Disable mech unit
- [ ] **Anti-Armor Missile** (Raven) - AoE debuff
- [ ] **Afterburners** (Medivac) - Temporary speed boost
- [ ] **KD8 Charge** (Reaper) - Knockback grenade
- [ ] **High Impact Payload** (Thor) - Toggle anti-air mode

#### 1.2 Research Completeness
- [ ] Verify all 36+ upgrades are properly applying effects
- [ ] Building Auto-Repair (Engineering Bay research)
- [ ] Neosteel Frame (Bunker +2 capacity)

#### 1.3 Minor Mechanics
- [ ] Salvage bunker (return 75% minerals)
- [ ] Cancel construction (return 75% cost)
- [ ] Building burning (low HP buildings take damage over time)

---

### Phase 2: Visual Polish (Priority: HIGH)

**Estimated Effort**: Medium

#### 2.1 Unit Visual Feedback
- [ ] **Unit Wireframes** - Silhouette in selection panel showing damage state
- [ ] **Health bar colors** - Green → Yellow → Red gradient
- [ ] **Shield bars** - Blue bar above health for Synthesis units
- [ ] **Buff/debuff icons** - Small icons on unit health bars
- [ ] **Stim effect** - Red tint on stimmed Marines/Marauders

#### 2.2 Building Visuals
- [ ] **Construction animation** - Building rising from ground
- [ ] **Placement ghost** - Semi-transparent preview while placing
- [ ] **Power field visualization** - For future Synthesis pylons
- [ ] **Addon attachment preview** - Show where addon will attach

#### 2.3 Ability Effects
- [ ] **Siege Mode transform** - Mechanical unfolding animation
- [ ] **Cloak shimmer** - Visible shimmer to unit owner
- [ ] **Nuke targeting laser** - Red laser from Ghost to target
- [ ] **Nuke mushroom cloud** - Explosion effect
- [ ] **Yamato charging beam** - Energy gathering effect
- [ ] **Tactical Jump portal** - Warp effect at origin/destination
- [ ] **EMP wave** - Blue energy ripple
- [ ] **Scanner Sweep circle** - Rotating scan line effect

#### 2.4 Combat Effects
- [ ] **Muzzle flashes** - Per weapon type
- [ ] **Tracer rounds** - Visible bullet trails
- [ ] **Explosion variations** - Small/medium/large
- [ ] **Death animations** - Unit-specific (ragdoll infantry, explode vehicles)
- [ ] **Destruction debris** - Wreckage remaining after unit death
- [ ] **Impact decals** - Temporary ground marks from explosions

---

### Phase 3: Audio Content (Priority: HIGH)

**Estimated Effort**: Medium (can use AI generation)

> Reference: `.claude/AUDIO_PROMPTS.md` for generation prompts

#### 3.1 Weapon Sounds
- [ ] Gauss rifle (Marine)
- [ ] Punisher grenades (Marauder)
- [ ] Pistol (Reaper)
- [ ] C-10 Rifle (Ghost)
- [ ] Flamethrower (Hellion/Hellbat)
- [ ] Arclite cannon (Siege Tank)
- [ ] Thor cannons
- [ ] Lanzer torpedoes (Viking)
- [ ] Backlash rockets (Banshee)
- [ ] ATS/ATA laser batteries (Battlecruiser)
- [ ] Missile turret launch

#### 3.2 Impact/Explosion Sounds
- [ ] Bullet impact (flesh, armor, building)
- [ ] Small explosion
- [ ] Medium explosion
- [ ] Large explosion (nuke)
- [ ] Shield impact (for Synthesis)

#### 3.3 Unit Voice Lines (5+ per unit)
- [ ] SCV acknowledgments ("SCV ready", "Yes sir?", etc.)
- [ ] Marine acknowledgments
- [ ] Marauder acknowledgments
- [ ] Ghost acknowledgments
- [ ] Siege Tank acknowledgments
- [ ] Medivac acknowledgments
- [ ] Battlecruiser acknowledgments
- [ ] Attack confirmations
- [ ] Death sounds

#### 3.4 Advisor Voice Lines
- [ ] "Your base is under attack"
- [ ] "Our base is under attack"
- [ ] "Nuclear launch detected"
- [ ] "Research complete"
- [ ] "Upgrade complete"
- [ ] "Not enough minerals"
- [ ] "Not enough vespene gas"
- [ ] "Supply depot required"
- [ ] "Building complete"
- [ ] "Unit ready"
- [ ] "You are victorious"
- [ ] "You have been defeated"

#### 3.5 Ambient & Music
- [ ] Menu theme
- [ ] Gameplay ambient (per biome)
- [ ] Combat intensity music
- [ ] Victory fanfare
- [ ] Defeat theme

---

### Phase 4: Second Faction - The Synthesis (Priority: HIGH)

**Estimated Effort**: Very Large

#### 4.1 Core Mechanics

##### Shield System
- [ ] All Synthesis units have shields + health
- [ ] Shields regenerate (2/sec out of combat)
- [ ] Shields take full damage from all types
- [ ] EMP drains shields completely
- [ ] Shield bar UI (blue, above health)

##### Pylon Power Fields
- [ ] Buildings require pylon power (6.5 radius)
- [ ] Unpowered buildings become inactive
- [ ] Power field visualization (subtle grid/glow)
- [ ] Building placement checks for power
- [ ] Pylon destruction disables nearby buildings

##### Warp-In Mechanic
- [ ] Gateway transforms to Warp Gate (research)
- [ ] Warp Gate can warp units to any power field
- [ ] 5-second warp-in animation
- [ ] Units have 50% HP during warp-in
- [ ] Warp-in visual effect (energy shimmer)

##### Chrono Boost
- [ ] Nexus ability (50 energy)
- [ ] +50% production/research speed
- [ ] 20-second duration
- [ ] Visual indicator on boosted building

#### 4.2 Units (14 total)

| Unit | Role | Key Abilities |
|------|------|---------------|
| **Probe** | Worker | Warp-in buildings, energy-based |
| **Zealot** | Melee | Charge (dash to target) |
| **Stalker** | Ranged | Blink (teleport 8 range) |
| **Sentry** | Support | Guardian Shield, Force Field, Hallucination |
| **Adept** | Ranged | Psionic Transfer (shade scout) |
| **High Templar** | Caster | Psionic Storm, Feedback |
| **Dark Templar** | Assassin | Permanent cloak, high damage |
| **Archon** | AOE | Merge from 2 Templar |
| **Immortal** | Anti-Armor | Barrier (damage reduction) |
| **Colossus** | Siege | Cliff walking, beam attack |
| **Phoenix** | Air Fighter | Graviton Beam (lift unit) |
| **Void Ray** | Air | Prismatic Alignment (charge damage) |
| **Oracle** | Air Caster | Revelation, Stasis Ward |
| **Carrier** | Capital | Interceptors (8 max) |

#### 4.3 Buildings (13 total)

| Building | Function |
|----------|----------|
| **Nexus** | Main, Chrono Boost |
| **Pylon** | Power, Supply (8) |
| **Gateway** | Infantry production |
| **Warp Gate** | Upgraded Gateway |
| **Forge** | Ground upgrades |
| **Cybernetics Core** | Core tech unlock |
| **Twilight Council** | Advanced infantry tech |
| **Templar Archives** | Templar tech |
| **Dark Shrine** | Dark Templar tech |
| **Robotics Facility** | Ground mech |
| **Robotics Bay** | Mech upgrades |
| **Stargate** | Air units |
| **Fleet Beacon** | Capital ship tech |
| **Photon Cannon** | Static defense |

#### 4.4 Research (30+ upgrades)
- [ ] Ground Weapons/Armor (3 levels each)
- [ ] Air Weapons/Armor (3 levels each)
- [ ] Shields (3 levels)
- [ ] Charge (Zealot)
- [ ] Blink (Stalker)
- [ ] Resonating Glaives (Adept)
- [ ] Psionic Storm
- [ ] Shadow Stride (DT Blink)
- [ ] Extended Thermal Lance (Colossus +2 range)
- [ ] Graviton Catapult (Carrier Interceptor speed)
- [ ] Flux Vanes (Void Ray speed)

---

### Phase 5: Quality of Life (Priority: MEDIUM)

**Estimated Effort**: Medium

#### 5.1 Tutorial System
- [ ] **Basic Controls** - Camera, selection, movement
- [ ] **Economy** - Workers, gathering, supply
- [ ] **Production** - Buildings, units, queues
- [ ] **Combat** - Attack-move, abilities, micro
- [ ] **Advanced** - Control groups, hotkeys, macro cycling
- [ ] Tutorial mission framework with triggers
- [ ] Progress tracking

#### 5.2 Settings & Customization
- [ ] **Custom Hotkeys** - Rebindable keys
- [ ] Hotkey profiles (save/load)
- [ ] **Graphics Settings**
  - Quality presets (Low/Medium/High/Ultra)
  - Individual toggles (shadows, particles, grass)
  - Resolution options
  - FPS cap
- [ ] **Audio Settings**
  - Master/Music/SFX/Voice sliders
  - Mute toggles
- [ ] **Gameplay Settings**
  - Game speed slider
  - Mouse sensitivity
  - Edge scroll toggle/speed
  - Minimap settings

#### 5.3 Skirmish Enhancements
- [ ] **Multiple AI Opponents** - 2v2, 3v3, FFA
- [ ] **Team Games** - Allied AI vs enemy AI
- [ ] **Custom Game Options**
  - Starting resources (Low/Medium/High)
  - Map reveal (normal/explored/revealed)
  - Per-player AI difficulty
  - Disable fog of war
  - Starting units options
- [ ] **Challenge Modes**
  - Time trials (build X units in Y time)
  - Economy challenges
  - Micro challenges
  - Defense scenarios

#### 5.4 Procedural Map Generator
- [ ] Balanced spawn positions
- [ ] Resource distribution algorithm
- [ ] Terrain variation (ramps, cliffs)
- [ ] Seed system for reproducibility
- [ ] Map sharing via seed codes
- [ ] Biome selection

---

### Phase 6: Replay System (Priority: MEDIUM)

**Estimated Effort**: Medium

#### 6.1 Recording
- [ ] Record all commands with tick numbers
- [ ] Store initial game state
- [ ] Metadata (players, map, duration, winner)
- [ ] Compression for storage

#### 6.2 Playback
- [ ] Reconstruct game state from commands
- [ ] Playback controls (play, pause, speed)
- [ ] Speed adjustment (0.5x, 1x, 2x, 4x, 8x)
- [ ] Scrubbing (jump to any point)
- [ ] Player perspective toggle

#### 6.3 Analysis Features
- [ ] Production tab (what each player built)
- [ ] Army value graph over time
- [ ] Resource income graph
- [ ] APM graph
- [ ] Unit composition timeline
- [ ] Event markers (battles, expansions)

---

### Phase 7: Third Faction - The Swarm (Priority: LOW)

**Estimated Effort**: Very Large

#### 7.1 Core Mechanics

##### Creep System
- [ ] Spreads from Hatcheries and Creep Tumors
- [ ] +30% movement speed for Swarm units on creep
- [ ] Provides vision while on creep
- [ ] Creep Tumors spread creep (build from Queen)
- [ ] Creep recedes when source destroyed
- [ ] Visual: purple organic texture on terrain

##### Larva System
- [ ] Hatchery passively spawns larva (max 3)
- [ ] Queen Inject Larva ability (+3 larva)
- [ ] All units morph from larva
- [ ] Larva select all on Hatchery select

##### Morph Mechanic
- [ ] Units transform into other units (Zergling → Baneling)
- [ ] Drones morph into buildings (consumed)
- [ ] Building upgrades (Hatchery → Lair → Hive)

##### Burrow
- [ ] Most units can burrow (research)
- [ ] Burrowed units invisible
- [ ] Cannot attack while burrowed (except Lurker, Infestor)
- [ ] Detector reveals burrowed units

##### Regeneration
- [ ] All Swarm units passively regenerate HP
- [ ] +100% regen speed on creep

#### 7.2 Units (14 total)

| Unit | Role | Key Abilities |
|------|------|---------------|
| **Drone** | Worker | Morphs into buildings |
| **Zergling** | Swarm | Fast, cheap (2 per egg) |
| **Baneling** | Suicide | Morphs from Zergling, explodes |
| **Roach** | Armored | Burrow movement, high regen |
| **Ravager** | Artillery | Morphs from Roach, Corrosive Bile |
| **Hydralisk** | Ranged DPS | Versatile anti-air/ground |
| **Lurker** | Siege | Burrow attack, line splash |
| **Queen** | Support | Inject Larva, Creep Tumor, Transfuse |
| **Mutalisk** | Harass | Bouncing attack |
| **Corruptor** | Anti-Air | Corruption debuff |
| **Brood Lord** | Siege Air | Morphs from Corruptor, spawns Broodlings |
| **Infestor** | Caster | Fungal Growth, Neural Parasite |
| **Swarm Host** | Siege | Spawns Locusts |
| **Ultralisk** | Tank | Massive melee, Frenzied (cannot be CC'd) |
| **Viper** | Air Caster | Abduct, Blinding Cloud, Parasitic Bomb |

#### 7.3 Buildings (13 total)

| Building | Function |
|----------|----------|
| **Hatchery** | Main, Larva production |
| **Lair** | Upgrade from Hatchery |
| **Hive** | Upgrade from Lair |
| **Spawning Pool** | Zergling, Queen unlock |
| **Baneling Nest** | Baneling morph |
| **Roach Warren** | Roach production |
| **Hydralisk Den** | Hydralisk production |
| **Lurker Den** | Lurker morph |
| **Infestation Pit** | Infestor, Swarm Host |
| **Ultralisk Cavern** | Ultralisk |
| **Spire** | Air units |
| **Greater Spire** | Brood Lord morph |
| **Evolution Chamber** | Ground upgrades |
| **Extractor** | Vespene gathering |
| **Spine Crawler** | Ground defense (can uproot) |
| **Spore Crawler** | Air defense (can uproot) |
| **Nydus Network** | Unit teleport network |
| **Nydus Worm** | Exit point for Network |

#### 7.4 Research (25+ upgrades)
- [ ] Melee/Ranged/Carapace (3 levels each)
- [ ] Flyer Attack/Carapace (3 levels each)
- [ ] Metabolic Boost (Zergling speed)
- [ ] Adrenal Glands (Zergling attack speed)
- [ ] Centrifugal Hooks (Baneling speed)
- [ ] Glial Reconstitution (Roach speed)
- [ ] Tunneling Claws (Roach burrow move)
- [ ] Muscular Augments (Hydra speed)
- [ ] Grooved Spines (Hydra range)
- [ ] Chitinous Plating (Ultra armor)
- [ ] Burrow (all units)

---

## Implementation Priority Summary

| Phase | Priority | Effort | Dependencies | SC2 Value |
|-------|----------|--------|--------------|-----------|
| **1. Missing Dominion** | HIGH | Small | None | Low |
| **2. Visual Polish** | HIGH | Medium | None | High |
| **3. Audio Content** | HIGH | Medium | None | High |
| **4. Synthesis Faction** | HIGH | Very Large | None | Critical |
| **5. Quality of Life** | MEDIUM | Medium | None | Medium |
| **6. Replay System** | MEDIUM | Medium | Phase 1-3 | Medium |
| **7. Swarm Faction** | LOW | Very Large | Phase 4 | Critical |

---

## Recommended Implementation Order

### Sprint 1: Polish Existing (1-2 weeks)
1. Finish remaining Dominion abilities (Raven, Reaper)
2. Unit wireframes in selection panel
3. Building placement ghost preview
4. Generate weapon sound effects

### Sprint 2: Visual Effects (2-3 weeks)
1. Ability visual effects (Siege Mode, Cloak, Nuke)
2. Death animations and debris
3. Muzzle flashes and tracers
4. Complete audio generation

### Sprint 3: Quality of Life (2-3 weeks)
1. Basic tutorial (4 missions)
2. Settings menus (graphics, audio, hotkeys)
3. Skirmish options (multiple AI, teams)

### Sprint 4-6: Synthesis Faction (4-6 weeks)
1. Shield system and pylon power
2. Core units (Probe, Zealot, Stalker, Immortal)
3. Warp Gate mechanic
4. Air units (Phoenix, Void Ray, Carrier)
5. Caster units (Sentry, HT, DT, Archon)
6. Complete buildings and upgrades

### Sprint 7: Replay System (2 weeks)
1. Command recording
2. Playback with controls
3. Basic analysis features

### Sprint 8-10: Swarm Faction (4-6 weeks)
1. Creep and Larva systems
2. Core units (Zergling, Roach, Hydra, Queen)
3. Morph mechanics (Baneling, Lurker, Brood Lord)
4. Advanced units (Infestor, Ultra, Viper)
5. Buildings and upgrades

---

## Success Criteria

A successful SC2-parity implementation achieves:

1. **Gameplay Feel**: Controls match SC2 responsiveness (already achieved)
2. **Strategic Depth**: 3 asymmetric factions with unique mechanics
3. **AI Challenge**: Insane AI defeats most players
4. **Visual Clarity**: Unit state, abilities, and terrain instantly readable
5. **Audio Feedback**: Every action has appropriate sound
6. **Polish**: 60 FPS with 200+ units, no major bugs
7. **Accessibility**: Tutorial teaches new players, custom hotkeys for veterans

---

## What's NOT in Scope (Multiplayer Phase)

These features are excluded from this roadmap:
- Authentication (Supabase Auth)
- Lobby system
- Network synchronization (lockstep)
- Matchmaking
- Ranked/ELO system
- Leaderboards
- Anti-cheat
- Reconnection handling
- Spectator mode (live)

---

## Notes

- Time estimates assume a solo developer
- Each sprint can be shipped for player feedback
- Audio can be AI-generated per AUDIO_PROMPTS.md
- Prioritize gameplay feel over visual polish
- Test extensively with AI at each phase
