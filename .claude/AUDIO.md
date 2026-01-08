# VOIDSTRIKE - Audio Assets & Generation Guide

This document contains all audio specifications, AI prompts for generation, and file naming conventions.

---

## Directory Structure

```
public/audio/
├── music/
│   ├── menu/              # Main menu, victory, defeat
│   ├── gameplay/          # Battle, ambient gameplay
│   └── events/            # Event stingers
├── sfx/
│   ├── units/
│   │   ├── dominion/      # Faction-specific unit sounds
│   │   └── shared/        # Shared combat sounds
│   ├── buildings/         # Building sounds
│   ├── combat/            # Weapon, impact, explosion sounds
│   ├── ui/                # Interface sounds
│   └── ambient/           # Environmental sounds
└── voice/
    └── dominion/          # Unit voice lines
```

---

## Audio Format Specifications

### File Format
- **Music**: MP3, 192kbps, stereo, normalized to -14 LUFS
- **SFX**: MP3, 128kbps, mono, normalized to -12 LUFS
- **Voice**: MP3, 128kbps, mono, normalized to -12 LUFS
- **Sample rate**: 44.1kHz

### Volume Levels (Target)
- UI sounds: -12dB
- Combat sounds: -6dB
- Voice lines: -3dB
- Music: -9dB
- Ambient: -15dB

### Looping
- Ambient and music files should have clean loop points
- Avoid fade-in/out for looping content

---

## Music Tracks

### Menu Music

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `music/menu/main_theme.mp3` | 2 min loop | "Epic orchestral sci-fi main menu theme, military drums, brass fanfares, electronic undertones, heroic and imposing, inspired by StarCraft 2 Terran theme, seamless loop" |
| `music/menu/loading.mp3` | 30s loop | "Ambient electronic sci-fi loading screen music, subtle pulsing synths, tension-building, minimal and clean" |
| `music/menu/victory.mp3` | 15-20s | "Triumphant orchestral victory fanfare, soaring brass, timpani rolls, heroic resolution, sci-fi military style" |
| `music/menu/defeat.mp3` | 15-20s | "Somber defeat music, minor key, fading brass, melancholic strings, military funeral tone" |

### Gameplay Music

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `music/gameplay/battle_01.mp3` | 3 min loop | "Intense sci-fi battle music, driving percussion, aggressive brass stabs, electronic elements, military theme, high energy, seamless loop" |
| `music/gameplay/battle_02.mp3` | 3 min loop | "Epic orchestral combat music, pounding drums, urgent strings, heroic brass motifs, electronic bass, seamless loop" |
| `music/gameplay/ambient_01.mp3` | 4 min loop | "Calm sci-fi strategy game ambient music, atmospheric synths, subtle military undertones, spacious and contemplative, seamless loop" |
| `music/gameplay/ambient_02.mp3` | 4 min loop | "Tense sci-fi ambient music, low drones, occasional distant percussion, building anticipation, strategic mood, seamless loop" |
| `music/gameplay/building.mp3` | 2 min loop | "Industrial construction music, mechanical rhythms, metallic sounds, progress feeling, sci-fi factory ambiance" |

### Event Stingers

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `music/events/under_attack.mp3` | 2-3s | "Urgent alert stinger, alarm-like brass hit, danger warning, immediate attention-grabbing" |
| `music/events/research_complete.mp3` | 2s | "Positive technology completion sound, rising electronic chime, achievement feeling, futuristic" |
| `music/events/building_complete.mp3` | 2s | "Construction complete notification, industrial clunk with positive resolution, mechanical satisfaction" |
| `music/events/upgrade_complete.mp3` | 2s | "Power-up notification, ascending electronic tones, enhancement feeling, sci-fi tech upgrade" |

---

## UI Sound Effects

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/ui/click.mp3` | 0.1s | "Clean UI click, interface button press, satisfying digital click" |
| `sfx/ui/hover.mp3` | 0.05s | "Subtle UI hover, soft interface highlight" |
| `sfx/ui/select_unit.mp3` | 0.15s | "Unit selection confirmation, positive click, selection made" |
| `sfx/ui/select_multiple.mp3` | 0.2s | "Multiple units selected, group selection, box selection complete" |
| `sfx/ui/command_issued.mp3` | 0.15s | "Command confirmation, order acknowledged, action queued" |
| `sfx/ui/error.mp3` | 0.3s | "Error buzzer, action denied, cannot perform, low negative tone" |
| `sfx/ui/not_enough_resources.mp3` | 0.3s | "Insufficient resources warning, failure beep, cannot afford" |
| `sfx/ui/research_start.mp3` | 0.4s | "Research initiated, technology processing" |
| `sfx/ui/production_start.mp3` | 0.3s | "Production started, unit queued, factory working" |
| `sfx/ui/minimap_ping.mp3` | 0.3s | "Minimap alert ping, attention notification, location marker" |
| `sfx/ui/control_group_assign.mp3` | 0.2s | "Control group created, units assigned" |
| `sfx/ui/control_group_select.mp3` | 0.15s | "Control group recalled, units selected" |

---

## Alert Sound Effects

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/ui/under_attack.mp3` | 0.8s | "Urgent siren, military alarm, base under attack warning" |
| `sfx/ui/unit_lost.mp3` | 0.5s | "Unit destroyed notification, somber brief tone" |
| `sfx/ui/building_lost.mp3` | 0.8s | "Building destroyed alert, heavy impactful sound" |
| `sfx/ui/minerals_depleted.mp3` | 0.5s | "Mineral patch empty, hollow empty sound" |
| `sfx/ui/supply_blocked.mp3` | 0.5s | "Supply limit reached warning tone" |

---

## Combat Sound Effects

### Weapons

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/combat/rifle.mp3` | 0.2s | "Marine rifle fire, rapid gunfire burst, Gauss rifle, sci-fi automatic weapon, rapid magnetic projectiles" |
| `sfx/combat/cannon.mp3` | 0.4s | "Heavy boom with echo, tank cannon fire, heavy artillery blast, explosive shell launch" |
| `sfx/combat/laser.mp3` | 0.3s | "Energy weapon, sci-fi zap, high-pitched laser beam" |
| `sfx/combat/missile.mp3` | 0.5s | "Missile launch, woosh plus ignition, rocket firing" |
| `sfx/combat/flamethrower.mp3` | 0.4s | "Fire whoosh, napalm spray, Hellion flame attack" |
| `sfx/combat/sniper.mp3` | 0.4s | "Silenced sniper rifle, suppressed shot, precision kill, Ghost weapon" |
| `sfx/combat/grenade_launcher.mp3` | 0.5s | "Concussive grenade launcher, heavy thump, explosive projectile launch, Marauder weapon" |
| `sfx/combat/gatling.mp3` | 0.7s | "Gatling cannon fire, dual autocannons, heavy machine gun barrage, Thor weapon" |
| `sfx/combat/laser_battery.mp3` | 0.7s | "Laser battery fire, multiple turrets, capital ship broadside, Battlecruiser weapon" |
| `sfx/combat/yamato.mp3` | 2s | "Massive energy weapon charging and firing, devastating beam cannon, overwhelming power" |

### Impacts

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/combat/hit.mp3` | 0.15s | "Generic hit impact, thud, meaty impact, bullet hitting target" |
| `sfx/combat/hit_armor.mp3` | 0.2s | "Armored target hit, metallic clang, bullet impact on metal" |
| `sfx/combat/hit_shield.mp3` | 0.2s | "Shield impact, energy crackle, forcefield hit" |
| `sfx/combat/energy_impact.mp3` | 0.3s | "Energy weapon hit, laser impact, sci-fi damage" |

### Explosions

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/combat/explosion_small.mp3` | 0.5s | "Small explosion, grenade blast, minor detonation" |
| `sfx/combat/explosion_medium.mp3` | 0.8s | "Medium explosion, vehicle destruction, significant blast" |
| `sfx/combat/explosion_large.mp3` | 1.2s | "Large explosion, building destruction, massive detonation with debris" |

### Deaths

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/combat/death.mp3` | 0.5s | "Generic unit death, brief grunt/cry" |
| `sfx/combat/death_mech.mp3` | 0.6s | "Mechanical unit death, metal crunch, sparks, suit shutdown" |
| `sfx/combat/death_bio.mp3` | 0.5s | "Biological unit death, organic splat" |

---

## Unit Sound Effects - Dominion

### SCV (Worker)

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/scv_select.mp3` | 0.5s | "Mechanical suit power-up, hydraulic hiss, radio click, industrial work machine" |
| `sfx/units/dominion/scv_move.mp3` | 0.3s | "Heavy mechanical footstep, industrial walker, hydraulic movement, metallic" |
| `sfx/units/dominion/scv_attack.mp3` | 0.4s | "Welding torch attack, electrical arc, industrial cutting" |
| `sfx/units/dominion/scv_mining.mp3` | 1s loop | "Mining laser drilling, rock breaking, mineral extraction, industrial operation" |
| `sfx/units/dominion/scv_build.mp3` | 1s loop | "Construction welding, metal on metal, power tools, building sounds" |

### Marine

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/marine_select.mp3` | 0.5s | "Combat suit power-up, rifle click, military readiness, power armor activation" |
| `sfx/units/dominion/marine_move.mp3` | 0.3s | "Heavy armored footstep, power armor walking, military march" |
| `sfx/units/dominion/marine_attack.mp3` | 0.5s | "Gauss rifle burst fire, sci-fi automatic weapon, rapid magnetic projectiles" |
| `sfx/units/dominion/marine_death.mp3` | 0.8s | "Power armor failure, suit shutdown, death grunt, mechanical collapse" |

### Marauder

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/marauder_select.mp3` | 0.6s | "Heavy assault suit activation, grenade launcher rack, intimidating mechanical power" |
| `sfx/units/dominion/marauder_move.mp3` | 0.4s | "Very heavy mechanical footstep, massive power armor, ground-shaking stomp" |
| `sfx/units/dominion/marauder_attack.mp3` | 0.5s | "Concussive grenade launcher, heavy thump, explosive projectile launch" |
| `sfx/units/dominion/marauder_death.mp3` | 1s | "Heavy armor destruction, explosive failure, massive suit collapse" |

### Siege Tank

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/siege_tank_select.mp3` | 0.6s | "Heavy tank engine idle, powerful diesel rumble, military vehicle ready" |
| `sfx/units/dominion/siege_tank_move.mp3` | 0.5s | "Tank treads movement, heavy machinery rolling, armored vehicle driving" |
| `sfx/units/dominion/siege_tank_attack.mp3` | 0.6s | "Tank cannon fire, heavy artillery blast, explosive shell launch" |
| `sfx/units/dominion/siege_tank_siege.mp3` | 1.5s | "Tank transformation, hydraulic deployment, siege mode activation, mechanical reconfiguration" |
| `sfx/units/dominion/siege_tank_siege_attack.mp3` | 0.8s | "Massive artillery bombardment, devastating explosion, siege cannon blast, screen-shaking power" |
| `sfx/units/dominion/siege_tank_unsiege.mp3` | 1.2s | "Tank transformation back, hydraulic retraction, mobile mode return" |

### Thor

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/thor_select.mp3` | 0.8s | "Massive mech activation, giant robot powering up, heavy industrial machinery" |
| `sfx/units/dominion/thor_move.mp3` | 0.5s | "Giant mechanical footstep, earthquake stomp, massive robot walking" |
| `sfx/units/dominion/thor_attack.mp3` | 0.7s | "Dual autocannons firing, heavy machine gun barrage, overwhelming firepower" |
| `sfx/units/dominion/thor_death.mp3` | 1.5s | "Giant mech destruction, massive explosion, catastrophic failure" |

### Medivac

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/medivac_select.mp3` | 0.5s | "Dropship engine hum, VTOL aircraft idle, medical transport ready" |
| `sfx/units/dominion/medivac_move.mp3` | 0.4s | "Dropship thrust, aircraft flying, engine roar" |
| `sfx/units/dominion/medivac_heal.mp3` | 0.5s loop | "Medical beam, healing energy, restoration sound, sci-fi treatment" |
| `sfx/units/dominion/medivac_load.mp3` | 0.6s | "Troops boarding, cargo bay opening, unit loading" |

### Viking

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/viking_select.mp3` | 0.5s | "Fighter jet engine, transforming aircraft, combat ready" |
| `sfx/units/dominion/viking_move.mp3` | 0.4s | "Jet engine thrust, fighter aircraft flying" |
| `sfx/units/dominion/viking_attack.mp3` | 0.5s | "Gatling cannon fire, air-to-air missiles, fighter weapons" |
| `sfx/units/dominion/viking_transform.mp3` | 1s | "Aircraft to mech transformation, mechanical reconfiguration, mode change" |

### Hellion

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/hellion_select.mp3` | 0.5s | "Fast attack vehicle engine, buggy motor, rapid response ready" |
| `sfx/units/dominion/hellion_move.mp3` | 0.4s | "Fast vehicle driving, wheeled buggy, quick movement" |
| `sfx/units/dominion/hellion_attack.mp3` | 0.6s | "Flamethrower burst, napalm spray, fire attack" |

### Ghost

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/ghost_select.mp3` | 0.5s | "Stealth suit activation, cloaking shimmer, covert ops ready" |
| `sfx/units/dominion/ghost_move.mp3` | 0.3s | "Silent footstep, stealth movement, barely audible" |
| `sfx/units/dominion/ghost_attack.mp3` | 0.4s | "Silenced sniper rifle, suppressed shot, precision kill" |
| `sfx/units/dominion/ghost_cloak.mp3` | 0.6s | "Cloaking device activation, phasing out, invisibility engage" |
| `sfx/units/dominion/ghost_snipe.mp3` | 0.5s | "Powerful sniper shot, high-powered rifle, devastating headshot" |
| `sfx/units/dominion/ghost_emp.mp3` | 0.7s | "Electromagnetic pulse, energy disruption, shield drain" |
| `sfx/units/dominion/ghost_nuke.mp3` | 3s | "Nuclear launch detected, missile descending, massive explosion" |

### Battlecruiser

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/units/dominion/battlecruiser_select.mp3` | 0.8s | "Massive capital ship engines, command bridge sounds, powerful warship" |
| `sfx/units/dominion/battlecruiser_move.mp3` | 0.6s | "Heavy ship engines, capital vessel movement, slow powerful thrust" |
| `sfx/units/dominion/battlecruiser_attack.mp3` | 0.7s | "Laser battery fire, multiple turrets, capital ship broadside" |
| `sfx/units/dominion/battlecruiser_yamato.mp3` | 2s | "Massive energy weapon charging and firing, devastating beam cannon, overwhelming power" |

---

## Building Sound Effects

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/buildings/place.mp3` | 0.4s | "Building placement, structural thunk, foundation drop" |
| `sfx/buildings/construction_start.mp3` | 0.8s | "Building foundation placement, construction begins, industrial start" |
| `sfx/buildings/construction_loop.mp3` | 2s loop | "Active construction, welding, hammering, industrial building sounds" |
| `sfx/buildings/construction_complete.mp3` | 1s | "Building finished, power online, structure operational" |
| `sfx/buildings/destroyed.mp3` | 1.5s | "Building explosion, structure collapse, massive destruction" |
| `sfx/buildings/powerup.mp3` | 0.5s | "Building power on, electrical hum plus click" |
| `sfx/buildings/powerdown.mp3` | 0.5s | "Building power off, power down whine" |
| `sfx/buildings/command_center.mp3` | 3s loop | "Command center ambient, computer terminals, military operations" |
| `sfx/buildings/barracks.mp3` | 3s loop | "Barracks training, soldiers drilling, military facility" |
| `sfx/buildings/factory.mp3` | 3s loop | "Factory production, heavy machinery, vehicle assembly" |
| `sfx/buildings/starport.mp3` | 3s loop | "Starport hangar, aircraft engines, flight operations" |
| `sfx/buildings/refinery.mp3` | 3s loop | "Refinery processing, gas extraction, industrial refining" |

---

## Ambient Sound Effects

All ambient sounds should be **loopable** and approximately **30-60 seconds** long.

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `sfx/ambient/battlefield.mp3` | 30s loop | "Distant battlefield ambiance, occasional explosions, military tension" |
| `sfx/ambient/base.mp3` | 30s loop | "Military base ambient, machinery hum, soldiers, industrial activity" |
| `sfx/ambient/wind.mp3` | 20s loop | "Alien planet wind, atmospheric, subtle" |
| `sfx/ambient/nature.mp3` | 30s loop | "Grassland biome, birds, crickets, rustling leaves" |
| `sfx/ambient/desert.mp3` | 30s loop | "Desert biome, hot wind, distant sandstorm" |
| `sfx/ambient/frozen.mp3` | 30s loop | "Frozen biome, howling wind, ice cracking" |
| `sfx/ambient/volcanic.mp3` | 30s loop | "Volcanic biome, lava bubbling, rumbles" |
| `sfx/ambient/void.mp3` | 30s loop | "Void biome, ethereal hum, alien whispers" |
| `sfx/ambient/jungle.mp3` | 30s loop | "Jungle biome, wildlife, dense foliage" |
| `sfx/ambient/mineral_field.mp3` | 10s loop | "Crystal resonance, mineral energy, resource field hum" |
| `sfx/ambient/vespene_geyser.mp3` | 10s loop | "Gas venting, geyser bubbling, resource extraction" |

---

## Voice Lines (Text-to-Speech)

### SCV

| Filename | Line | Style |
|----------|------|-------|
| `voice/dominion/scv_ready.mp3` | "SCV good to go, sir!" | Male blue-collar worker voice |
| `voice/dominion/scv_yes1.mp3` | "Affirmative!" | Male blue-collar worker voice |
| `voice/dominion/scv_yes2.mp3` | "Roger that!" | Male blue-collar worker voice |
| `voice/dominion/scv_annoyed.mp3` | "This is YOUR plan?" | Annoyed male worker voice |

### Marine

| Filename | Line | Style |
|----------|------|-------|
| `voice/dominion/marine_ready.mp3` | "You want a piece of me, boy?" | Gruff male soldier voice |
| `voice/dominion/marine_yes1.mp3` | "Go go go!" | Urgent soldier voice |
| `voice/dominion/marine_yes2.mp3` | "Outstanding!" | Military acknowledgment |
| `voice/dominion/marine_attack.mp3` | "Let's move!" | Battle-ready soldier |

### Siege Tank

| Filename | Line | Style |
|----------|------|-------|
| `voice/dominion/siege_tank_ready.mp3` | "Ready to roll out!" | Tank commander voice |
| `voice/dominion/siege_tank_siege.mp3` | "Siege mode engaged!" | Military command voice |
| `voice/dominion/siege_tank_unsiege.mp3` | "Returning to mobile configuration" | Calm tactical voice |

### Battlecruiser

| Filename | Line | Style |
|----------|------|-------|
| `voice/dominion/battlecruiser_ready.mp3` | "Battlecruiser operational" | Deep authoritative captain voice |
| `voice/dominion/battlecruiser_yamato.mp3` | "Yamato cannon... online" | Dramatic command voice |

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

---

## Recommended AI Tools

- **Suno AI** - Music generation
- **ElevenLabs** - Voice line generation (text-to-speech)
- **Stable Audio** - Sound effects
- **AIVA** - Orchestral music
- **Freesound.org** - Sound effects base
- **Audacity** - Audio editing and normalization
- **JSFXR/BFXR** - Retro-style sound effects

---

## Notes

The audio system includes graceful fallback:
- Missing files generate procedural beeps as placeholders
- Categories have different fallback tones:
  - UI: 800Hz sine wave
  - Combat: 200Hz sine wave
  - Other: 400Hz sine wave
- Fallback sounds are very quiet (10% volume) to not be disruptive

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
