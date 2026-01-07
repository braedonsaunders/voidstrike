# VOIDSTRIKE - StarCraft 2 Parity Roadmap (Single-Player)

> **Goal**: Achieve feature parity with StarCraft 2's single-player/skirmish experience.
> **Scope**: Excludes multiplayer networking features (will be addressed separately).

---

## Current State Summary

### Completed Features
- Core ECS engine (12 systems, 8 components)
- Dominion faction: 12 units, 11 buildings, 36 upgrades
- Combat system (damage types, armor, splash, priority targeting)
- A* pathfinding with Web Workers
- Fog of war with vision states
- Resource gathering (minerals, vespene, supply)
- Production queues and building construction
- 6 biomes with full visual polish
- 3 playable maps
- AI opponent (Easy/Medium/Hard)
- Audio system framework (awaiting assets)
- Ability system framework (partial implementations)
- SC2-like controls (control groups, shift-queuing, patrol, etc.)
- Complete HUD (minimap, command card, selection panel, tooltips)

---

## Phase 1: Complete Dominion Faction Mechanics

> **Priority**: CRITICAL
> **Goal**: Make the existing faction feel complete and polished

### 1.1 Transform Mechanics (HIGH)
- [ ] **Siege Tank Siege Mode** - Full implementation
  - Stationary mode with increased range (13) and splash damage (40+35 splash)
  - 2-second transform animation
  - Cannot attack while transforming
  - Siege mode attacks should have visible projectile arc
- [ ] **Hellion ↔ Hellbat Transform**
  - Hellbat: Slower (3.15 speed), more HP (135), melee splash attack
  - Requires Infernal Pre-Igniter research
- [ ] **Viking Fighter ↔ Assault Mode**
  - Fighter Mode: Air-to-air only
  - Assault Mode: Ground unit with ground attack

### 1.2 Cloak & Detection System (HIGH)
- [ ] **Cloak Implementation**
  - Ghost cloak (energy drain: 1/sec)
  - Banshee cloak (energy drain: 1/sec)
  - Cloaked units invisible without detection
  - Shimmer effect when cloaked (partial visibility to owner)
- [ ] **Detection**
  - Missile Turret detection radius (11)
  - Sensor Tower extended vision (30 radius)
  - Scanner Sweep reveal (temporary, from Command Center)
  - Orbital Command upgrade for Scanner Sweep

### 1.3 Transport & Bunker Mechanics (HIGH)
- [ ] **Medivac Load/Unload**
  - Load infantry units (capacity: 8 slots)
  - Unload at location
  - Quick unload hotkey
  - Boost ability (Afterburners)
- [ ] **Bunker System**
  - Load up to 4 infantry
  - Infantry fire from inside (reduced damage taken)
  - Salvage bunker (return 75% cost)
  - Attack range bonus while garrisoned

### 1.4 Healing & Repair (MEDIUM)
- [ ] **SCV Repair**
  - Repair buildings and mechanical units
  - Costs resources based on damage repaired
  - Auto-repair toggle
- [ ] **Medivac Heal**
  - Heal biological units
  - Energy-based (3 energy per 10 HP)
  - Auto-heal nearby injured allies
- [ ] **Building Auto-Repair** (optional research)

### 1.5 Building Addons (MEDIUM)
- [ ] **Tech Lab**
  - Attaches to Barracks/Factory/Starport
  - Unlocks advanced units (Marauder, Ghost, Siege Tank, Thor, etc.)
  - Enables unit-specific upgrades
- [ ] **Reactor**
  - Attaches to Barracks/Factory/Starport
  - Allows training 2 units simultaneously
  - Only basic units (Marines, Hellions, Vikings, Medivacs)
- [ ] **Addon Swap**
  - Buildings can lift off and swap addons
  - Strategic flexibility

### 1.6 Building Special Features (MEDIUM)
- [ ] **Terran Building Lift-Off/Landing**
  - Barracks, Factory, Starport, Command Center can lift
  - Fly to new locations
  - Floating buildings cannot produce
- [ ] **Supply Depot Lower/Raise**
  - Lower supply depot to let units pass through
  - Toggle ability
- [ ] **Orbital Command Upgrade**
  - Upgrade Command Center
  - Enables: MULE, Scanner Sweep, Extra Supplies
- [ ] **Planetary Fortress Upgrade**
  - Upgrade Command Center
  - Cannot lift off, gains powerful ground attack

### 1.7 Complete Ability Implementations (HIGH)
- [ ] **Stim Pack** - Full implementation with HP cost (10), speed/attack buff
- [ ] **Concussive Shells** - Slow effect on targets (50% for 1.07s)
- [ ] **Combat Shield** - Research for +10 Marine HP
- [ ] **Snipe** - Working against biological units only, 170 damage
- [ ] **EMP Round** - Drain shields and energy in AoE
- [ ] **Nuke** - Full implementation with Ghost channeling, warning indicator
- [ ] **Yamato Cannon** - 240 damage to single target, 3s channel
- [ ] **Tactical Jump** - Teleport Battlecruiser anywhere on map

---

## Phase 2: Enhanced AI System

> **Priority**: HIGH
> **Goal**: Make AI opponents challenging and fun at all difficulty levels

### 2.1 Strategic AI Improvements (HIGH)
- [ ] **Scouting Behavior**
  - Send early worker scout
  - React to enemy tech/composition
  - Maintain map awareness with patrol units
- [ ] **Build Order System**
  - Multiple build orders per difficulty
  - Adapt based on scouting information
  - Timing attacks at specific supply counts
- [ ] **Tech Progression**
  - Research upgrades appropriately
  - Tech switch based on enemy composition
  - Counter-unit production

### 2.2 Tactical AI (MEDIUM)
- [ ] **Multi-Pronged Attacks**
  - Harass expansions while main attack
  - Drops with Medivacs
  - Pincer movements
- [ ] **Micro Decisions**
  - Focus fire high-value targets
  - Retreat damaged units
  - Stutter-step with ranged units
  - Use abilities intelligently
- [ ] **Defensive Positioning**
  - Hold ramps and chokepoints
  - Bunker placement
  - Turret rings for defense

### 2.3 Economic AI (MEDIUM)
- [ ] **Expansion Timing**
  - Take natural expansion
  - Saturate bases properly (16-24 workers)
  - Recognize when to take third base
- [ ] **Worker Management**
  - Transfer workers between bases
  - Build appropriate number of refineries
  - Protect workers from harassment

### 2.4 Difficulty Scaling (HIGH)
- [ ] **Very Easy** - Slow reactions, no micro, simple builds
- [ ] **Easy** - Basic macro, simple attack patterns
- [ ] **Medium** - Decent macro, uses abilities, scouts
- [ ] **Hard** - Good macro/micro, multi-pronged attacks
- [ ] **Very Hard** - Optimal builds, strong micro, adaptation
- [ ] **Insane** - Cheating AI (faster resources, full vision) - optional

---

## Phase 3: Gameplay Systems

> **Priority**: HIGH
> **Goal**: Core gameplay mechanics matching SC2

### 3.1 Combat Enhancements (HIGH)
- [ ] **High Ground Advantage**
  - Units on low ground have 30% miss chance vs high ground
  - Losing vision of high ground units
- [ ] **Attack-Move Behavior**
  - Units stop to engage enemies encountered
  - Continue to destination after combat
- [ ] **Hold Position Enhancement**
  - Units don't chase, stay in place
  - Still return fire
- [ ] **Patrol Enhancement**
  - Attack enemies encountered during patrol
  - Continue patrol route after combat

### 3.2 Buff/Debuff System (HIGH)
- [ ] **Buff Framework**
  - Timed stat modifications
  - Visual indicators for active buffs
  - Stacking rules
- [ ] **Implemented Buffs**
  - Stim Pack (speed + attack speed)
  - Concussive Shell slow
  - Guardian Shield (Synthesis)
  - Fungal Growth (Swarm)
- [ ] **Status Effect Display**
  - Icons on unit health bars
  - Buff timers

### 3.3 Auto-Cast System (MEDIUM)
- [ ] **Toggle Auto-Cast**
  - Right-click ability to enable/disable
  - Visual indicator when enabled
- [ ] **Auto-Cast Abilities**
  - Medivac Heal
  - SCV Repair
  - Ghost Snipe (optional)
  - Infestor Fungal (optional)

### 3.4 Passive Abilities (MEDIUM)
- [ ] **Passive Framework**
  - Always-active effects
  - Conditional triggers
- [ ] **Examples**
  - Reaper HP regeneration (out of combat)
  - Shield regeneration (Synthesis)
  - Creep speed bonus (Swarm)
  - High ground vision (Sensor Tower)

### 3.5 Victory/Defeat Conditions (HIGH)
- [ ] **Victory Conditions**
  - Destroy all enemy structures
  - Enemy surrender
  - Custom conditions (map-specific)
- [ ] **Defeat Screen**
  - Show game statistics
  - Option to watch replay
  - Return to menu
- [ ] **Victory Screen**
  - Congratulations display
  - Statistics summary
  - Continue or quit options

### 3.6 Save/Load System (MEDIUM)
- [ ] **Save Game**
  - Serialize complete game state
  - Save to local storage or file
  - Multiple save slots
- [ ] **Load Game**
  - Restore game state exactly
  - Continue from any save point
- [ ] **Auto-Save**
  - Periodic auto-saves during gameplay
  - Recovery from crashes

---

## Phase 4: Second Faction - The Synthesis

> **Priority**: HIGH
> **Goal**: Add Protoss-equivalent faction with unique mechanics

### 4.1 Core Mechanics
- [ ] **Shield System**
  - All units have shields + health
  - Shields regenerate over time (2/sec)
  - Shields take full damage from all types
  - EMP drains shields completely
- [ ] **Pylon Power Fields**
  - Buildings require pylon power
  - 6.5 radius power field
  - Unpowered buildings inactive
  - Warping requires power field
- [ ] **Warp-In Mechanic**
  - Gateway units warp in at pylons
  - 5-second warp-in time
  - Vulnerable during warp (50% HP)
- [ ] **Chrono Boost**
  - Nexus ability
  - +50% production speed on target building
  - 20-second duration, 50 energy

### 4.2 Units (12 Total)
- [ ] **Probe** - Worker, builds then warps, energy-based
- [ ] **Zealot** - Fast melee, Charge ability
- [ ] **Stalker** - Ranged, Blink ability (teleport)
- [ ] **Sentry** - Support caster, Guardian Shield, Force Field, Hallucination
- [ ] **Adept** - Ranged, Psionic Transfer (shade)
- [ ] **High Templar** - Powerful caster, Psionic Storm, Feedback
- [ ] **Dark Templar** - Permanently cloaked melee assassin
- [ ] **Archon** - Merged from 2 Templar, massive damage
- [ ] **Immortal** - Anti-armor ground, Barrier ability
- [ ] **Colossus** - Tall siege walker, cliff walking
- [ ] **Phoenix** - Light air fighter, Graviton Beam
- [ ] **Carrier** - Capital ship with Interceptors
- [ ] **Void Ray** - Beam damage charges up over time
- [ ] **Oracle** - Air caster, Revelation, Stasis Ward

### 4.3 Buildings (10 Total)
- [ ] **Nexus** - Main building, Chrono Boost
- [ ] **Pylon** - Power supply, warp-in point
- [ ] **Gateway/Warp Gate** - Basic unit production, transforms
- [ ] **Forge** - Ground upgrades
- [ ] **Cybernetics Core** - Air/ability upgrades, unlocks tech
- [ ] **Robotics Facility** - Mechanical ground units
- [ ] **Robotics Bay** - Advanced mech upgrades
- [ ] **Stargate** - Air units
- [ ] **Fleet Beacon** - Capital ship upgrades
- [ ] **Twilight Council** - Advanced infantry tech
- [ ] **Templar Archives** - Templar tech
- [ ] **Dark Shrine** - Dark Templar tech
- [ ] **Photon Cannon** - Static defense

### 4.4 Research (30+ Upgrades)
- [ ] Ground Weapons/Armor (3 levels each)
- [ ] Air Weapons/Armor (3 levels each)
- [ ] Shield upgrades (3 levels)
- [ ] Charge (Zealot speed + damage)
- [ ] Blink (Stalker teleport)
- [ ] Resonating Glaives (Adept attack speed)
- [ ] Psionic Storm
- [ ] Shadow Stride (Dark Templar Blink)
- [ ] Extended Thermal Lance (Colossus range)
- [ ] Graviton Catapult (Carrier)
- [ ] Flux Vanes (Void Ray speed)

---

## Phase 5: Visual Polish

> **Priority**: MEDIUM
> **Goal**: Match SC2's visual feedback and clarity

### 5.1 Unit Animations (HIGH)
- [ ] **Attack Animations**
  - Per-unit attack visuals
  - Muzzle flashes, beam effects
  - Melee swing animations
- [ ] **Death Animations**
  - Ragdoll/collapse for infantry
  - Explosion for vehicles
  - Disintegration for energy-based
- [ ] **Idle Animations**
  - Subtle movement when stationary
  - Breathing, shifting weight

### 5.2 Ability Effects (HIGH)
- [ ] **Stim Pack** - Red tint on stimmed units
- [ ] **Siege Mode Transform** - Mechanical animation
- [ ] **Psionic Storm** - Lightning field effect
- [ ] **Nuke** - Laser target, mushroom cloud
- [ ] **Yamato Cannon** - Charging beam, massive blast
- [ ] **Warp-In** - Protoss energy shimmer
- [ ] **Blink** - Teleport particle effect
- [ ] **EMP** - Blue energy wave
- [ ] **Cloak** - Shimmer/invisibility shader

### 5.3 UI Enhancements (MEDIUM)
- [ ] **Unit Wireframes**
  - Damaged state visualization
  - Green → Yellow → Red coloring
  - In selection panel
- [ ] **Unit Portraits**
  - Animated unit face/icon
  - Voice sync (future)
- [ ] **Status Effects HUD**
  - Buff/debuff icons
  - Timers for temporary effects
- [ ] **Building Placement Preview**
  - Ghost building while placing
  - Red/green for valid/invalid
  - Power field visualization

### 5.4 Environmental Effects (LOW)
- [ ] **Day/Night Cycle** (optional)
- [ ] **Dynamic Weather**
  - Rain, snow, sandstorm
  - Visual only (no gameplay impact)
- [ ] **Destruction Debris**
  - Wreckage from destroyed units
  - Craters from explosions

---

## Phase 6: Audio Content

> **Priority**: MEDIUM
> **Goal**: Immersive audio matching SC2's production quality

### 6.1 Sound Effects (HIGH)
- [ ] **Generate Weapon Sounds**
  - Gauss rifle (Marine)
  - Siege cannon
  - Flamethrower
  - Laser weapons
  - Missile launchers
- [ ] **Impact Sounds**
  - Bullet impacts
  - Explosions (small/medium/large)
  - Shield impacts
- [ ] **Unit Sounds**
  - Footsteps (infantry vs mech)
  - Engine sounds (vehicles/aircraft)
  - Death screams/explosions

### 6.2 Voice Lines (MEDIUM)
- [ ] **Complete Dominion Voices**
  - 5+ acknowledgments per unit
  - Attack, move, special ability lines
  - Under attack warnings
- [ ] **Synthesis Voice Lines**
  - Robotic/ethereal voices
  - Unique personality per unit
- [ ] **Advisor Voice**
  - "Your base is under attack"
  - "Research complete"
  - "Not enough minerals"
  - "Spawn more overlords" equivalent

### 6.3 Music System (LOW)
- [ ] **Menu Music** - Atmospheric, building tension
- [ ] **Gameplay Music** - Dynamic based on combat intensity
- [ ] **Victory/Defeat Themes**
- [ ] **Faction-Specific Themes**

---

## Phase 7: Quality of Life

> **Priority**: MEDIUM
> **Goal**: Polish and accessibility features

### 7.1 Tutorial System (HIGH)
- [ ] **Basic Tutorial**
  - Camera controls
  - Unit selection
  - Movement commands
  - Attack commands
- [ ] **Economy Tutorial**
  - Worker gathering
  - Building construction
  - Supply management
- [ ] **Combat Tutorial**
  - Attack-move
  - Focus fire
  - Retreating
  - Using abilities
- [ ] **Advanced Tutorial**
  - Control groups
  - Hotkeys
  - Macro cycling
  - Micro techniques

### 7.2 Settings & Customization (MEDIUM)
- [ ] **Custom Hotkeys**
  - Rebindable keys
  - Profile saving
  - Import/export
- [ ] **Graphics Settings**
  - Quality presets (Low/Medium/High/Ultra)
  - Individual toggles (shadows, particles, etc.)
  - Resolution options
- [ ] **Audio Settings**
  - Master volume
  - Music/SFX/Voice sliders
  - Mute options
- [ ] **Gameplay Settings**
  - Game speed
  - Mouse scroll speed
  - Edge scroll toggle

### 7.3 Game Modes (MEDIUM)
- [ ] **Skirmish vs AI**
  - Multiple AI opponents
  - Team games (2v2, 3v3)
  - FFA (Free for All)
- [ ] **Custom Game Options**
  - Starting resources
  - Map reveal
  - AI difficulty per player
  - Disable fog of war
- [ ] **Challenge Modes**
  - Time trials
  - Puzzle scenarios
  - Economy challenges

### 7.4 Map Generator (LOW)
- [ ] **Procedural Generation**
  - Balanced spawn positions
  - Resource distribution
  - Terrain variation
- [ ] **Seed System**
  - Reproducible maps
  - Share map seeds

---

## Phase 8: Third Faction - The Swarm

> **Priority**: LOW (After Synthesis is complete)
> **Goal**: Add Zerg-equivalent faction with unique mechanics

### 8.1 Core Mechanics
- [ ] **Creep System**
  - Spreads from Hatcheries and Tumors
  - +30% movement speed for Swarm units on creep
  - Provides vision
  - Creep Tumors spread creep
- [ ] **Larva System**
  - Hatchery spawns larva (max 3)
  - Queen Inject increases larva (max +3)
  - All units morph from larva
- [ ] **Morph Mechanic**
  - Units transform into other units
  - Buildings morph from Drones
  - Drone is consumed
- [ ] **Burrow**
  - Most units can burrow
  - Invisible and untargetable
  - Cannot attack while burrowed (except Lurker)
- [ ] **Regeneration**
  - All Swarm units regenerate HP
  - Faster regeneration on creep

### 8.2 Units (14 Total)
- [ ] **Drone** - Worker, morphs into buildings
- [ ] **Zergling** - Fast, cheap melee (2 per larva)
- [ ] **Baneling** - Suicide bomber (morphs from Zergling)
- [ ] **Roach** - Armored, burrow movement, regen
- [ ] **Ravager** - Artillery (morphs from Roach)
- [ ] **Hydralisk** - Ranged DPS
- [ ] **Lurker** - Burrowed siege (morphs from Hydra)
- [ ] **Queen** - Base defender, Inject Larva, Creep Tumor, Transfuse
- [ ] **Mutalisk** - Fast air harasser, bouncing attack
- [ ] **Corruptor** - Anti-air, Corruption ability
- [ ] **Brood Lord** - Siege air (morphs from Corruptor)
- [ ] **Infestor** - Caster, Fungal Growth, Neural Parasite
- [ ] **Swarm Host** - Spawns Locusts
- [ ] **Ultralisk** - Massive melee tank
- [ ] **Viper** - Air caster, Abduct, Blinding Cloud

### 8.3 Buildings (9 Total)
- [ ] **Hatchery/Lair/Hive** - Main building, produces larva, upgrades
- [ ] **Spawning Pool** - Unlocks Zerglings, Queen
- [ ] **Baneling Nest** - Baneling morph
- [ ] **Roach Warren** - Roach production
- [ ] **Hydralisk Den** - Hydralisk production
- [ ] **Lurker Den** - Lurker morph
- [ ] **Spire/Greater Spire** - Air units
- [ ] **Infestation Pit** - Infestor, Swarm Host
- [ ] **Ultralisk Cavern** - Ultralisk
- [ ] **Evolution Chamber** - Ground upgrades
- [ ] **Extractor** - Vespene harvesting
- [ ] **Spine Crawler** - Anti-ground defense (can uproot)
- [ ] **Spore Crawler** - Anti-air defense (can uproot)
- [ ] **Nydus Network/Worm** - Instant unit transport

### 8.4 Research (25+ Upgrades)
- [ ] Melee/Ranged/Carapace (3 levels each)
- [ ] Flyer Attack/Carapace (3 levels each)
- [ ] Metabolic Boost (Zergling speed)
- [ ] Adrenal Glands (Zergling attack speed)
- [ ] Centrifugal Hooks (Baneling speed)
- [ ] Glial Reconstitution (Roach speed)
- [ ] Tunneling Claws (Roach burrow move)
- [ ] Muscular Augments (Hydra speed)
- [ ] Grooved Spines (Hydra range)
- [ ] Chitinous Plating (Ultralisk armor)

---

## Implementation Priority Matrix

| Phase | Priority | Estimated Effort | Dependencies |
|-------|----------|------------------|--------------|
| 1. Complete Dominion | CRITICAL | Large | None |
| 2. Enhanced AI | HIGH | Large | Phase 1 |
| 3. Gameplay Systems | HIGH | Medium | Phase 1 |
| 4. Synthesis Faction | HIGH | Very Large | Phase 1, 3 |
| 5. Visual Polish | MEDIUM | Medium | Phase 1 |
| 6. Audio Content | MEDIUM | Medium | Phase 1 |
| 7. Quality of Life | MEDIUM | Medium | Phase 3 |
| 8. Swarm Faction | LOW | Very Large | Phase 4 |

---

## Recommended Implementation Order

### Sprint 1: Dominion Core (Weeks 1-2)
1. Transform mechanics (Siege Tank, Viking)
2. Cloak & Detection system
3. High ground advantage
4. Complete ability implementations

### Sprint 2: Transport & Buildings (Weeks 3-4)
1. Medivac load/unload
2. Bunker system
3. Building addons (Tech Lab/Reactor)
4. Lift-off/Landing

### Sprint 3: AI Enhancement (Weeks 5-6)
1. Scouting behavior
2. Build order system
3. Difficulty scaling
4. Basic micro decisions

### Sprint 4: Gameplay Polish (Weeks 7-8)
1. Buff/Debuff system
2. Auto-cast
3. Victory/Defeat screens
4. Save/Load system

### Sprint 5: Synthesis Faction (Weeks 9-12)
1. Shield system & Pylon power
2. Core units (Zealot, Stalker, Immortal)
3. Warp-in mechanic
4. Complete unit roster

### Sprint 6: Content & Polish (Weeks 13-14)
1. Tutorial system
2. Settings menus
3. Visual effects
4. Audio assets

### Sprint 7: Swarm Faction (Weeks 15-18)
1. Creep system & Larva
2. Core units (Zergling, Roach, Hydra)
3. Morph mechanics
4. Complete unit roster

---

## Success Metrics

A successful SC2 parity implementation should achieve:

1. **Gameplay Feel**: Controls and responsiveness match SC2
2. **Strategic Depth**: Multiple viable strategies per faction
3. **AI Challenge**: Hard AI defeats average players
4. **Visual Clarity**: Easy to understand unit health, abilities, terrain
5. **Audio Feedback**: Every action has appropriate sound response
6. **Polish**: No major bugs, smooth performance at 60 FPS

---

## Notes

- This roadmap excludes multiplayer features (networking, matchmaking, ranked)
- Time estimates assume a solo developer; scale accordingly for teams
- Each phase can be shipped independently for early player feedback
- Audio assets can be generated using AI tools per AUDIO_PROMPTS.md
- Prioritize gameplay feel over visual polish initially
