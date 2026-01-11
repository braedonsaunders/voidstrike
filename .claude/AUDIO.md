# VOIDSTRIKE - Audio Assets & Generation Guide

This document contains all audio specifications, AI prompts for generation, and file naming conventions.

---

## Directory Structure

```
public/audio/
├── music/
│   ├── menu/              # Main menu music
│   ├── gameplay/          # Battle, ambient gameplay music
│   ├── victory/           # Victory music
│   └── defeat/            # Defeat music
├── alert/                 # Voice announcement alerts (under attack, unit lost, etc.)
├── combat/                # Weapon, impact, explosion sounds
├── unit/                  # Unit command sounds (move, attack, ready)
├── building/              # Building sounds (place, construct, complete)
├── ambient/               # Environmental/biome sounds
├── ui/                    # Interface sounds (click, error, select)
└── voice/
    ├── scv/               # SCV voice lines
    ├── marine/            # Marine voice lines
    ├── marauder/          # Marauder voice lines
    ├── hellion/           # Hellion voice lines
    ├── tank/              # Siege Tank voice lines
    ├── medic/             # Medic voice lines
    ├── ghost/             # Ghost voice lines
    ├── thor/              # Thor voice lines
    ├── viking/            # Viking voice lines
    ├── banshee/           # Banshee voice lines
    ├── battlecruiser/     # Battlecruiser voice lines
    ├── reaper/            # Reaper voice lines
    └── raven/             # Raven voice lines
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

### Voice Announcements (Alerts)

These are spoken voice announcements that play to notify the player of important events. Generate using text-to-speech with a professional military/command voice style.

| Filename | Duration | Voice Line | Style |
|----------|----------|------------|-------|
| `alert/under_attack.mp3` | 2-3s | "Your base is under attack!" or "You're under attack!" | Urgent female command voice, military alert tone |
| `alert/additional_population_required.mp3` | 2s | "Additional supply depots required." or "You require more supply." | Female command voice, slight urgency |
| `alert/not_enough_minerals.mp3` | 1-2s | "Not enough minerals." or "Insufficient minerals." | Neutral female command voice |
| `alert/not_enough_vespene.mp3` | 1-2s | "Not enough vespene gas." or "Insufficient vespene." | Neutral female command voice |
| `alert/minerals_depleted.mp3` | 1-2s | "Mineral field depleted." | Neutral female command voice |
| `alert/building_complete.mp3` | 1-2s | "Construction complete." | Positive female command voice |
| `alert/research_complete.mp3` | 1-2s | "Research complete." | Positive female command voice |
| `alert/upgrade_complete.mp3` | 1-2s | "Upgrade complete." | Positive female command voice |

---

## UI Sound Effects

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `ui/click.mp3` | 0.1s | "Clean UI click, interface button press, satisfying digital click" |
| `ui/error.mp3` | 0.3s | "Error buzzer, action denied, cannot perform, low negative tone" |
| `ui/select.mp3` | 0.15s | "Unit selection confirmation, positive click, selection made" |
| `ui/notification.mp3` | 0.3s | "General notification sound, attention chime, neutral alert" |

---

## Combat Sound Effects

### Weapons

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `combat/rifle.mp3` | 0.2s | "Marine rifle fire, rapid gunfire burst, Gauss rifle, sci-fi automatic weapon, rapid magnetic projectiles" |
| `combat/cannon.mp3` | 0.4s | "Heavy boom with echo, tank cannon fire, heavy artillery blast, explosive shell launch" |
| `combat/laser.mp3` | 0.3s | "Energy weapon, sci-fi zap, high-pitched laser beam" |
| `combat/missile.mp3` | 0.5s | "Missile launch, woosh plus ignition, rocket firing" |
| `combat/flamethrower.mp3` | 0.4s | "Fire whoosh, napalm spray, Hellion flame attack" |
| `combat/sniper.mp3` | 0.4s | "Silenced sniper rifle, suppressed shot, precision kill, Ghost weapon" |
| `combat/grenade_launcher.mp3` | 0.5s | "Concussive grenade launcher, heavy thump, explosive projectile launch, Marauder weapon" |
| `combat/gatling.mp3` | 0.7s | "Gatling cannon fire, dual autocannons, heavy machine gun barrage, Thor weapon" |
| `combat/laser_battery.mp3` | 0.7s | "Laser battery fire, multiple turrets, capital ship broadside, Battlecruiser weapon" |
| `combat/yamato.mp3` | 2s | "Massive energy weapon charging and firing, devastating beam cannon, overwhelming power" |

### Impacts

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `combat/hit.mp3` | 0.15s | "Generic hit impact, thud, meaty impact, bullet hitting target" |
| `combat/hit_armor.mp3` | 0.2s | "Armored target hit, metallic clang, bullet impact on metal" |
| `combat/hit_shield.mp3` | 0.2s | "Shield impact, energy crackle, forcefield hit" |
| `combat/energy_impact.mp3` | 0.3s | "Energy weapon hit, laser impact, sci-fi damage" |

### Explosions

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `combat/explosion_small.mp3` | 0.5s | "Small explosion, grenade blast, minor detonation" |
| `combat/explosion_medium.mp3` | 0.8s | "Medium explosion, vehicle destruction, significant blast" |
| `combat/explosion_large.mp3` | 1.2s | "Large explosion, building destruction, massive detonation with debris" |

### Deaths

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `combat/death.mp3` | 0.5s | "Generic unit death, brief grunt/cry" |
| `combat/death_mech.mp3` | 0.6s | "Mechanical unit death, metal crunch, sparks, suit shutdown" |
| `combat/death_bio.mp3` | 0.5s | "Biological unit death, organic splat" |

---

## Unit Command Sounds

These are generic unit command sounds that play for all units. Unit-specific voice lines are in the Voice Lines section.

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `unit/move.mp3` | 0.3s | "Unit move command acknowledgment, brief confirmation, military action" |
| `unit/attack.mp3` | 0.3s | "Unit attack command acknowledgment, aggressive confirmation, combat action" |
| `unit/ready.mp3` | 0.5s | "Unit production complete, unit ready, positive military acknowledgment" |
| `unit/mining.mp3` | 1s loop | "Mining laser drilling, rock breaking, mineral extraction, industrial operation" |
| `unit/building.mp3` | 1s loop | "Construction welding, metal on metal, power tools, building sounds" |

---

## Building Sound Effects

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `building/place.mp3` | 0.4s | "Building placement, structural thunk, foundation drop" |
| `building/construct.mp3` | 2s loop | "Active construction, welding, hammering, industrial building sounds" |
| `building/production.mp3` | 0.4s | "Production started, unit queued, factory working sound" |
| `building/powerup.mp3` | 0.5s | "Building power on, electrical hum plus click" |
| `building/powerdown.mp3` | 0.5s | "Building power off, power down whine" |

---

## Ambient Sound Effects

All ambient sounds should be **loopable** and approximately **30-60 seconds** long. Each biome has its own ambient track.

| Filename | Duration | AI Prompt |
|----------|----------|-----------|
| `ambient/wind.mp3` | 20s loop | "Alien planet wind, atmospheric, subtle" |
| `ambient/nature.mp3` | 30s loop | "Grassland biome, birds, crickets, rustling leaves" |
| `ambient/desert.mp3` | 30s loop | "Desert biome, hot wind, distant sandstorm" |
| `ambient/frozen.mp3` | 30s loop | "Frozen biome, howling wind, ice cracking" |
| `ambient/volcanic.mp3` | 30s loop | "Volcanic biome, lava bubbling, rumbles" |
| `ambient/void.mp3` | 30s loop | "Void biome, ethereal hum, alien whispers" |
| `ambient/jungle.mp3` | 30s loop | "Jungle biome, wildlife, dense foliage" |
| `ambient/battle.mp3` | 30s loop | "Distant battlefield ambiance, occasional explosions, military tension" |

---

## Voice Lines (Text-to-Speech)

Each unit type has a subdirectory containing voice files for select, move, attack, and ready actions.

### SCV (Worker)

| Filename | Line | Style |
|----------|------|-------|
| `voice/scv/select1.mp3` | "SCV good to go, sir!" | Male blue-collar worker voice |
| `voice/scv/select2.mp3` | "Whaddya want?" | Casual male worker voice |
| `voice/scv/select3.mp3` | "I'm goin'!" | Eager male worker voice |
| `voice/scv/move1.mp3` | "Affirmative!" | Male blue-collar worker voice |
| `voice/scv/move2.mp3` | "Roger that!" | Male blue-collar worker voice |
| `voice/scv/attack1.mp3` | "This is YOUR plan?" | Annoyed male worker voice |

### Marine

| Filename | Line | Style |
|----------|------|-------|
| `voice/marine/select1.mp3` | "You want a piece of me, boy?" | Gruff male soldier voice |
| `voice/marine/select2.mp3` | "Jacked up and good to go!" | Eager soldier voice |
| `voice/marine/select3.mp3` | "Bring it!" | Aggressive soldier voice |
| `voice/marine/move1.mp3` | "Go go go!" | Urgent soldier voice |
| `voice/marine/move2.mp3` | "Outstanding!" | Military acknowledgment |
| `voice/marine/attack1.mp3` | "Let's move!" | Battle-ready soldier |
| `voice/marine/attack2.mp3` | "Git some!" | Aggressive soldier voice |
| `voice/marine/ready.mp3` | "Marine ready for duty!" | Military acknowledgment |

### Marauder

| Filename | Line | Style |
|----------|------|-------|
| `voice/marauder/select1.mp3` | "Got something for me?" | Deep intimidating voice |
| `voice/marauder/select2.mp3` | "What's the job?" | Gruff professional voice |
| `voice/marauder/move1.mp3` | "Movin' out!" | Deep commanding voice |
| `voice/marauder/move2.mp3` | "On my way!" | Professional military voice |
| `voice/marauder/attack1.mp3` | "Time to die!" | Aggressive deep voice |
| `voice/marauder/ready.mp3` | "Marauder online!" | Military announcement |

### Hellion

| Filename | Line | Style |
|----------|------|-------|
| `voice/hellion/select1.mp3` | "Need a light?" | Mischievous voice |
| `voice/hellion/select2.mp3` | "Fire it up!" | Excited voice |
| `voice/hellion/move1.mp3` | "Let's burn!" | Eager voice |
| `voice/hellion/attack1.mp3` | "Burn baby burn!" | Maniacal voice |
| `voice/hellion/ready.mp3` | "Hellion armed and ready!" | Military announcement |

### Siege Tank

| Filename | Line | Style |
|----------|------|-------|
| `voice/tank/select1.mp3` | "Ready to roll out!" | Tank commander voice |
| `voice/tank/select2.mp3` | "Tank standing by!" | Professional military voice |
| `voice/tank/move1.mp3` | "Rollin' out!" | Tank commander voice |
| `voice/tank/attack1.mp3` | "Lockdown confirmed!" | Tactical military voice |
| `voice/tank/ready.mp3` | "Siege tank ready!" | Military announcement |

### Medic

| Filename | Line | Style |
|----------|------|-------|
| `voice/medic/select1.mp3` | "Need a prescription?" | Friendly female medic voice |
| `voice/medic/select2.mp3` | "Ready to operate!" | Professional female voice |
| `voice/medic/move1.mp3` | "On my way!" | Caring female voice |
| `voice/medic/ready.mp3` | "Medic reporting!" | Military announcement |

---

## Implementation Priority

### Phase 1 (Critical)
1. UI sounds (click, error, select)
2. Voice announcements (under attack, unit lost, supply blocked)
3. Combat sounds (explosions, impacts)
4. Basic unit command sounds (move, attack, ready)

### Phase 2 (Important)
1. Building sounds
2. Ambient sounds (biome-specific)
3. Menu music
4. Gameplay music (1-2 tracks)

### Phase 3 (Polish)
1. Additional music tracks (8 gameplay tracks ✓)
2. Unit voice lines (select, move, attack, ready)
3. Advanced ability sounds
4. Victory/defeat music

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
