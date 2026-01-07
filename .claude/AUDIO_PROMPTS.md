# VOIDSTRIKE Audio Asset Generation Guide

This document describes AI prompts for generating all music and sound effects needed for the game, along with file naming conventions and directory structure.

---

## Directory Structure

```
public/audio/
├── music/
│   ├── menu/
│   ├── gameplay/
│   └── events/
├── sfx/
│   ├── units/
│   │   ├── dominion/
│   │   └── shared/
│   ├── buildings/
│   ├── combat/
│   ├── ui/
│   └── ambient/
└── voice/
    └── dominion/
```

---

## Music Tracks

### Menu Music

| Filename | Prompt |
|----------|--------|
| `menu/main_theme.mp3` | "Epic orchestral sci-fi main menu theme, military drums, brass fanfares, electronic undertones, heroic and imposing, 2 minute loop, inspired by StarCraft 2 Terran theme" |
| `menu/loading.mp3` | "Ambient electronic sci-fi loading screen music, subtle pulsing synths, tension-building, minimal and clean, 30 second loop" |
| `menu/victory.mp3` | "Triumphant orchestral victory fanfare, soaring brass, timpani rolls, heroic resolution, 15-20 seconds, sci-fi military style" |
| `menu/defeat.mp3` | "Somber defeat music, minor key, fading brass, melancholic strings, military funeral tone, 15-20 seconds" |

### Gameplay Music

| Filename | Prompt |
|----------|--------|
| `gameplay/battle_01.mp3` | "Intense sci-fi battle music, driving percussion, aggressive brass stabs, electronic elements, military theme, high energy, 3 minute seamless loop" |
| `gameplay/battle_02.mp3` | "Epic orchestral combat music, pounding drums, urgent strings, heroic brass motifs, electronic bass, 3 minute seamless loop" |
| `gameplay/ambient_01.mp3` | "Calm sci-fi strategy game ambient music, atmospheric synths, subtle military undertones, spacious and contemplative, 4 minute seamless loop" |
| `gameplay/ambient_02.mp3` | "Tense sci-fi ambient music, low drones, occasional distant percussion, building anticipation, strategic mood, 4 minute seamless loop" |
| `gameplay/building.mp3` | "Industrial construction music, mechanical rhythms, metallic sounds, progress feeling, sci-fi factory ambiance, 2 minute loop" |

### Event Stingers

| Filename | Prompt |
|----------|--------|
| `events/under_attack.mp3` | "Urgent alert stinger, alarm-like brass hit, danger warning, 2-3 seconds, immediate attention-grabbing" |
| `events/research_complete.mp3` | "Positive technology completion sound, rising electronic chime, achievement feeling, futuristic, 2 seconds" |
| `events/building_complete.mp3` | "Construction complete notification, industrial clunk with positive resolution, mechanical satisfaction, 2 seconds" |
| `events/upgrade_complete.mp3` | "Power-up notification, ascending electronic tones, enhancement feeling, sci-fi tech upgrade, 2 seconds" |

---

## Unit Sound Effects

### Dominion Units

#### SCV (Worker)
| Filename | Prompt |
|----------|--------|
| `units/dominion/scv_select.mp3` | "Mechanical suit power-up, hydraulic hiss, radio click, industrial work machine, 0.5 seconds" |
| `units/dominion/scv_move.mp3` | "Heavy mechanical footstep, industrial walker, hydraulic movement, metallic, 0.3 seconds" |
| `units/dominion/scv_attack.mp3` | "Welding torch attack, electrical arc, industrial cutting, 0.4 seconds" |
| `units/dominion/scv_mining.mp3` | "Mining laser drilling, rock breaking, mineral extraction, industrial operation, 1 second loop" |
| `units/dominion/scv_build.mp3` | "Construction welding, metal on metal, power tools, building sounds, 1 second loop" |

#### Marine
| Filename | Prompt |
|----------|--------|
| `units/dominion/marine_select.mp3` | "Combat suit power-up, rifle click, military readiness, power armor activation, 0.5 seconds" |
| `units/dominion/marine_move.mp3` | "Heavy armored footstep, power armor walking, military march, 0.3 seconds" |
| `units/dominion/marine_attack.mp3` | "Gauss rifle burst fire, sci-fi automatic weapon, rapid magnetic projectiles, 0.5 seconds" |
| `units/dominion/marine_death.mp3` | "Power armor failure, suit shutdown, death grunt, mechanical collapse, 0.8 seconds" |

#### Marauder
| Filename | Prompt |
|----------|--------|
| `units/dominion/marauder_select.mp3` | "Heavy assault suit activation, grenade launcher rack, intimidating mechanical power, 0.6 seconds" |
| `units/dominion/marauder_move.mp3` | "Very heavy mechanical footstep, massive power armor, ground-shaking stomp, 0.4 seconds" |
| `units/dominion/marauder_attack.mp3` | "Concussive grenade launcher, heavy thump, explosive projectile launch, 0.5 seconds" |
| `units/dominion/marauder_death.mp3` | "Heavy armor destruction, explosive failure, massive suit collapse, 1 second" |

#### Siege Tank
| Filename | Prompt |
|----------|--------|
| `units/dominion/siege_tank_select.mp3` | "Heavy tank engine idle, powerful diesel rumble, military vehicle ready, 0.6 seconds" |
| `units/dominion/siege_tank_move.mp3` | "Tank treads movement, heavy machinery rolling, armored vehicle driving, 0.5 seconds" |
| `units/dominion/siege_tank_attack.mp3` | "Tank cannon fire, heavy artillery blast, explosive shell launch, 0.6 seconds" |
| `units/dominion/siege_tank_siege.mp3` | "Tank transformation, hydraulic deployment, siege mode activation, mechanical reconfiguration, 1.5 seconds" |
| `units/dominion/siege_tank_siege_attack.mp3` | "Massive artillery bombardment, devastating explosion, siege cannon blast, screen-shaking power, 0.8 seconds" |
| `units/dominion/siege_tank_unsiege.mp3` | "Tank transformation back, hydraulic retraction, mobile mode return, 1.2 seconds" |

#### Thor
| Filename | Prompt |
|----------|--------|
| `units/dominion/thor_select.mp3` | "Massive mech activation, giant robot powering up, heavy industrial machinery, 0.8 seconds" |
| `units/dominion/thor_move.mp3` | "Giant mechanical footstep, earthquake stomp, massive robot walking, 0.5 seconds" |
| `units/dominion/thor_attack.mp3` | "Dual autocannons firing, heavy machine gun barrage, overwhelming firepower, 0.7 seconds" |
| `units/dominion/thor_death.mp3` | "Giant mech destruction, massive explosion, catastrophic failure, 1.5 seconds" |

#### Medivac
| Filename | Prompt |
|----------|--------|
| `units/dominion/medivac_select.mp3` | "Dropship engine hum, VTOL aircraft idle, medical transport ready, 0.5 seconds" |
| `units/dominion/medivac_move.mp3` | "Dropship thrust, aircraft flying, engine roar, 0.4 seconds" |
| `units/dominion/medivac_heal.mp3` | "Medical beam, healing energy, restoration sound, sci-fi treatment, 0.5 second loop" |
| `units/dominion/medivac_load.mp3` | "Troops boarding, cargo bay opening, unit loading, 0.6 seconds" |

#### Viking
| Filename | Prompt |
|----------|--------|
| `units/dominion/viking_select.mp3` | "Fighter jet engine, transforming aircraft, combat ready, 0.5 seconds" |
| `units/dominion/viking_move.mp3` | "Jet engine thrust, fighter aircraft flying, 0.4 seconds" |
| `units/dominion/viking_attack.mp3` | "Gatling cannon fire, air-to-air missiles, fighter weapons, 0.5 seconds" |
| `units/dominion/viking_transform.mp3` | "Aircraft to mech transformation, mechanical reconfiguration, mode change, 1 second" |

#### Battlecruiser
| Filename | Prompt |
|----------|--------|
| `units/dominion/battlecruiser_select.mp3` | "Massive capital ship engines, command bridge sounds, powerful warship, 0.8 seconds" |
| `units/dominion/battlecruiser_move.mp3` | "Heavy ship engines, capital vessel movement, slow powerful thrust, 0.6 seconds" |
| `units/dominion/battlecruiser_attack.mp3` | "Laser battery fire, multiple turrets, capital ship broadside, 0.7 seconds" |
| `units/dominion/battlecruiser_yamato.mp3` | "Massive energy weapon charging and firing, devastating beam cannon, overwhelming power, 2 seconds" |

#### Ghost
| Filename | Prompt |
|----------|--------|
| `units/dominion/ghost_select.mp3` | "Stealth suit activation, cloaking shimmer, covert ops ready, 0.5 seconds" |
| `units/dominion/ghost_move.mp3` | "Silent footstep, stealth movement, barely audible, 0.3 seconds" |
| `units/dominion/ghost_attack.mp3` | "Silenced sniper rifle, suppressed shot, precision kill, 0.4 seconds" |
| `units/dominion/ghost_cloak.mp3` | "Cloaking device activation, phasing out, invisibility engage, 0.6 seconds" |
| `units/dominion/ghost_snipe.mp3` | "Powerful sniper shot, high-powered rifle, devastating headshot, 0.5 seconds" |
| `units/dominion/ghost_emp.mp3` | "Electromagnetic pulse, energy disruption, shield drain, 0.7 seconds" |
| `units/dominion/ghost_nuke.mp3` | "Nuclear launch detected, missile descending, massive explosion, 3 seconds" |

#### Hellion
| Filename | Prompt |
|----------|--------|
| `units/dominion/hellion_select.mp3` | "Fast attack vehicle engine, buggy motor, rapid response ready, 0.5 seconds" |
| `units/dominion/hellion_move.mp3` | "Fast vehicle driving, wheeled buggy, quick movement, 0.4 seconds" |
| `units/dominion/hellion_attack.mp3` | "Flamethrower burst, napalm spray, fire attack, 0.6 seconds" |

### Shared Combat Sounds

| Filename | Prompt |
|----------|--------|
| `units/shared/explosion_small.mp3` | "Small explosion, grenade blast, minor detonation, 0.5 seconds" |
| `units/shared/explosion_medium.mp3` | "Medium explosion, vehicle destruction, significant blast, 0.8 seconds" |
| `units/shared/explosion_large.mp3` | "Large explosion, building destruction, massive detonation, 1.2 seconds" |
| `units/shared/bullet_impact.mp3` | "Bullet hitting armor, metal ping, projectile impact, 0.2 seconds" |
| `units/shared/energy_impact.mp3` | "Energy weapon hit, laser impact, sci-fi damage, 0.3 seconds" |

---

## Building Sound Effects

| Filename | Prompt |
|----------|--------|
| `buildings/construction_start.mp3` | "Building foundation placement, construction begins, industrial start, 0.8 seconds" |
| `buildings/construction_loop.mp3` | "Active construction, welding, hammering, industrial building, 2 second loop" |
| `buildings/construction_complete.mp3` | "Building finished, power online, structure operational, 1 second" |
| `buildings/building_destroyed.mp3` | "Building explosion, structure collapse, massive destruction, 1.5 seconds" |
| `buildings/command_center.mp3` | "Command center ambient, computer terminals, military operations, 3 second loop" |
| `buildings/barracks.mp3` | "Barracks training, soldiers drilling, military facility, 3 second loop" |
| `buildings/factory.mp3` | "Factory production, heavy machinery, vehicle assembly, 3 second loop" |
| `buildings/starport.mp3` | "Starport hangar, aircraft engines, flight operations, 3 second loop" |
| `buildings/refinery.mp3` | "Refinery processing, gas extraction, industrial refining, 3 second loop" |

---

## UI Sound Effects

| Filename | Prompt |
|----------|--------|
| `ui/click.mp3` | "Clean UI click, interface button press, satisfying digital click, 0.1 seconds" |
| `ui/hover.mp3` | "Subtle UI hover, soft interface highlight, 0.05 seconds" |
| `ui/select_unit.mp3` | "Unit selection confirmation, positive click, selection made, 0.15 seconds" |
| `ui/select_multiple.mp3` | "Multiple units selected, group selection, box selection complete, 0.2 seconds" |
| `ui/command_issued.mp3` | "Command confirmation, order acknowledged, action queued, 0.15 seconds" |
| `ui/error.mp3` | "Error buzzer, action denied, cannot perform, 0.3 seconds" |
| `ui/not_enough_resources.mp3` | "Insufficient resources warning, failure beep, cannot afford, 0.3 seconds" |
| `ui/research_start.mp3` | "Research initiated, technology processing, 0.4 seconds" |
| `ui/production_start.mp3` | "Production started, unit queued, factory working, 0.3 seconds" |
| `ui/minimap_ping.mp3` | "Minimap alert ping, attention notification, location marker, 0.3 seconds" |
| `ui/chat_message.mp3` | "Chat notification, message received, 0.2 seconds" |
| `ui/control_group_assign.mp3` | "Control group created, units assigned, 0.2 seconds" |
| `ui/control_group_select.mp3` | "Control group recalled, units selected, 0.15 seconds" |

---

## Ambient Sound Effects

| Filename | Prompt |
|----------|--------|
| `ambient/battlefield.mp3` | "Distant battlefield ambiance, occasional explosions, military tension, 30 second loop" |
| `ambient/base.mp3` | "Military base ambient, machinery hum, soldiers, industrial activity, 30 second loop" |
| `ambient/wind.mp3` | "Alien planet wind, atmospheric, subtle, 20 second loop" |
| `ambient/mineral_field.mp3` | "Crystal resonance, mineral energy, resource field hum, 10 second loop" |
| `ambient/vespene_geyser.mp3` | "Gas venting, geyser bubbling, resource extraction, 10 second loop" |

---

## Voice Lines (Optional - Text-to-Speech)

### SCV
| Filename | Prompt |
|----------|--------|
| `voice/dominion/scv_ready.mp3` | "SCV good to go, sir!" - male blue-collar worker voice |
| `voice/dominion/scv_yes1.mp3` | "Affirmative!" - male blue-collar worker voice |
| `voice/dominion/scv_yes2.mp3` | "Roger that!" - male blue-collar worker voice |
| `voice/dominion/scv_annoyed.mp3` | "This is YOUR plan?" - annoyed male worker voice |

### Marine
| Filename | Prompt |
|----------|--------|
| `voice/dominion/marine_ready.mp3` | "You want a piece of me, boy?" - gruff male soldier voice |
| `voice/dominion/marine_yes1.mp3` | "Go go go!" - urgent soldier voice |
| `voice/dominion/marine_yes2.mp3` | "Outstanding!" - military acknowledgment |
| `voice/dominion/marine_attack.mp3` | "Let's move!" - battle-ready soldier |

### Siege Tank
| Filename | Prompt |
|----------|--------|
| `voice/dominion/siege_tank_ready.mp3` | "Ready to roll out!" - tank commander voice |
| `voice/dominion/siege_tank_siege.mp3` | "Siege mode engaged!" - military command voice |
| `voice/dominion/siege_tank_unsiege.mp3` | "Returning to mobile configuration" - calm tactical voice |

### Battlecruiser
| Filename | Prompt |
|----------|--------|
| `voice/dominion/battlecruiser_ready.mp3` | "Battlecruiser operational" - deep authoritative captain voice |
| `voice/dominion/battlecruiser_yamato.mp3` | "Yamato cannon... online" - dramatic command voice |

---

## Generation Notes

### Audio Format Specifications
- **Music**: MP3, 192kbps, stereo, normalized to -14 LUFS
- **SFX**: MP3, 128kbps, mono, normalized to -12 LUFS
- **Voice**: MP3, 128kbps, mono, normalized to -12 LUFS

### AI Generation Tips

1. **For Music Tracks**:
   - Request seamless loops explicitly
   - Specify "no fade out" for looping tracks
   - Use "inspired by StarCraft 2" for style reference
   - Request "game-ready, normalized audio"

2. **For Sound Effects**:
   - Keep durations short and punchy
   - Request "no reverb tail" for clean loops
   - Specify exact duration needed
   - Ask for "game-ready, clipping-free audio"

3. **For Voice Lines**:
   - Describe the character personality
   - Reference StarCraft for style
   - Request "clean recording, no background noise"
   - Specify emotion and intensity

### Recommended AI Tools
- **Suno AI** - Music generation
- **ElevenLabs** - Voice line generation
- **Stable Audio** - Sound effects
- **AIVA** - Orchestral music

---

## Implementation Priority

### Phase 1 (Critical)
1. UI sounds (click, error, command)
2. Basic unit sounds (select, move, attack)
3. Combat sounds (explosions, impacts)
4. Under attack alert

### Phase 2 (Important)
1. Building sounds
2. Ambient sounds
3. Menu music
4. Gameplay music (1 track each)

### Phase 3 (Polish)
1. Additional music tracks
2. Voice lines
3. Advanced unit abilities
4. Event stingers
