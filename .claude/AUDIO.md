# VOIDSTRIKE - Audio Assets & Generation Guide

This document contains all audio specifications, AI prompts for generation, and file naming conventions.

---

## Audio Assets Checklist

### Music ✅ Complete
- [x] `music/menu/main_theme.mp3`
- [x] `music/menu/menu_01.mp3`
- [x] `music/gameplay/gameplay_01.mp3`
- [x] `music/gameplay/gameplay_02.mp3`
- [x] `music/gameplay/gameplay_03.mp3`
- [x] `music/gameplay/gameplay_04.mp3`
- [x] `music/gameplay/gameplay_05.mp3`
- [x] `music/gameplay/gameplay_06.mp3`
- [x] `music/gameplay/gameplay_07.mp3`
- [x] `music/gameplay/gameplay_08.mp3`
- [x] `music/victory/victory.mp3`
- [x] `music/defeat/defeat.mp3`

### Voice Announcements (Alerts) ✅ Complete
- [x] `alert/under_attack.mp3`
- [x] `alert/additional_population_required.mp3`
- [x] `alert/not_enough_minerals.mp3`
- [x] `alert/not_enough_vespene.mp3`
- [x] `alert/minerals_depleted.mp3`
- [x] `alert/building_complete.mp3`
- [x] `alert/research_complete.mp3`
- [x] `alert/upgrade_complete.mp3`

### UI Sounds ✅ Complete
- [x] `ui/click.mp3`
- [x] `ui/error.mp3`
- [x] `ui/select.mp3`
- [x] `ui/notification.mp3`

### Combat - Weapons ✅ Complete
- [x] `combat/rifle.mp3`
- [x] `combat/cannon.mp3`
- [x] `combat/laser.mp3`
- [x] `combat/missile.mp3`
- [x] `combat/flamethrower.mp3`
- [x] `combat/sniper.mp3`
- [x] `combat/grenade_launcher.mp3`
- [x] `combat/gatling_gun.mp3`
- [x] `combat/laser_battery.mp3`
- [x] `combat/yamato.mp3`

### Combat - Impacts ✅ Complete
- [x] `combat/hit.mp3`
- [x] `combat/hit_armor.mp3`
- [x] `combat/hit_shield.mp3`
- [x] `combat/energy_impact.mp3`

### Combat - Explosions ✅ Complete
- [x] `combat/small_explosion.mp3`
- [x] `combat/medium_explosion.mp3`
- [x] `combat/large_explosion.mp3`

### Combat - Deaths ⏳ Needs Generation
- [ ] `combat/death.mp3`
- [ ] `combat/death_mech.mp3`
- [ ] `combat/death_bio.mp3`

### Unit Commands ⏳ Needs Generation
- [ ] `unit/move.mp3`
- [ ] `unit/attack.mp3`
- [ ] `unit/ready.mp3`
- [ ] `unit/mining.mp3`
- [ ] `unit/building.mp3`

### Building Sounds ⏳ Needs Generation
- [ ] `building/place.mp3`
- [ ] `building/construct.mp3`
- [ ] `building/production.mp3`
- [ ] `building/powerup.mp3`
- [ ] `building/powerdown.mp3`

### Ambient Sounds ⏳ Needs Generation
- [ ] `ambient/wind.mp3`
- [ ] `ambient/nature.mp3`
- [ ] `ambient/desert.mp3`
- [ ] `ambient/frozen.mp3`
- [ ] `ambient/volcanic.mp3`
- [ ] `ambient/void.mp3`
- [ ] `ambient/jungle.mp3`
- [ ] `ambient/battle.mp3`

### Voice Lines - Fabricator (Worker) ⏳ Needs Generation
- [ ] `voice/fabricator/select1.mp3`
- [ ] `voice/fabricator/select2.mp3`
- [ ] `voice/fabricator/select3.mp3`
- [ ] `voice/fabricator/move1.mp3`
- [ ] `voice/fabricator/move2.mp3`
- [ ] `voice/fabricator/attack1.mp3`
- [ ] `voice/fabricator/ready.mp3`

### Voice Lines - Trooper (Basic Infantry) ⏳ Needs Generation
- [ ] `voice/trooper/select1.mp3`
- [ ] `voice/trooper/select2.mp3`
- [ ] `voice/trooper/select3.mp3`
- [ ] `voice/trooper/move1.mp3`
- [ ] `voice/trooper/move2.mp3`
- [ ] `voice/trooper/attack1.mp3`
- [ ] `voice/trooper/attack2.mp3`
- [ ] `voice/trooper/ready.mp3`

### Voice Lines - Breacher (Heavy Infantry) ⏳ Needs Generation
- [ ] `voice/breacher/select1.mp3`
- [ ] `voice/breacher/select2.mp3`
- [ ] `voice/breacher/move1.mp3`
- [ ] `voice/breacher/move2.mp3`
- [ ] `voice/breacher/attack1.mp3`
- [ ] `voice/breacher/ready.mp3`

### Voice Lines - Vanguard (Fast Assault Infantry) ⏳ Needs Generation
- [ ] `voice/vanguard/select1.mp3`
- [ ] `voice/vanguard/select2.mp3`
- [ ] `voice/vanguard/move1.mp3`
- [ ] `voice/vanguard/attack1.mp3`
- [ ] `voice/vanguard/ready.mp3`

### Voice Lines - Operative (Elite Stealth) ⏳ Needs Generation
- [ ] `voice/operative/select1.mp3`
- [ ] `voice/operative/select2.mp3`
- [ ] `voice/operative/move1.mp3`
- [ ] `voice/operative/attack1.mp3`
- [ ] `voice/operative/ready.mp3`

### Voice Lines - Scorcher (Fast Attack Vehicle) ⏳ Needs Generation
- [ ] `voice/scorcher/select1.mp3`
- [ ] `voice/scorcher/select2.mp3`
- [ ] `voice/scorcher/move1.mp3`
- [ ] `voice/scorcher/attack1.mp3`
- [ ] `voice/scorcher/ready.mp3`

### Voice Lines - Devastator (Heavy Siege Tank) ⏳ Needs Generation
- [ ] `voice/devastator/select1.mp3`
- [ ] `voice/devastator/select2.mp3`
- [ ] `voice/devastator/move1.mp3`
- [ ] `voice/devastator/attack1.mp3`
- [ ] `voice/devastator/ready.mp3`

### Voice Lines - Colossus (Massive Walker Mech) ⏳ Needs Generation
- [ ] `voice/colossus/select1.mp3`
- [ ] `voice/colossus/select2.mp3`
- [ ] `voice/colossus/move1.mp3`
- [ ] `voice/colossus/attack1.mp3`
- [ ] `voice/colossus/ready.mp3`

### Voice Lines - Lifter (Flying Transport/Medic) ⏳ Needs Generation
- [ ] `voice/lifter/select1.mp3`
- [ ] `voice/lifter/select2.mp3`
- [ ] `voice/lifter/move1.mp3`
- [ ] `voice/lifter/ready.mp3`

### Voice Lines - Valkyrie (Transforming Fighter) ⏳ Needs Generation
- [ ] `voice/valkyrie/select1.mp3`
- [ ] `voice/valkyrie/select2.mp3`
- [ ] `voice/valkyrie/move1.mp3`
- [ ] `voice/valkyrie/attack1.mp3`
- [ ] `voice/valkyrie/ready.mp3`

### Voice Lines - Specter (Cloakable Strike Fighter) ⏳ Needs Generation
- [ ] `voice/specter/select1.mp3`
- [ ] `voice/specter/select2.mp3`
- [ ] `voice/specter/move1.mp3`
- [ ] `voice/specter/attack1.mp3`
- [ ] `voice/specter/ready.mp3`

### Voice Lines - Dreadnought (Capital Ship) ⏳ Needs Generation
- [ ] `voice/dreadnought/select1.mp3`
- [ ] `voice/dreadnought/select2.mp3`
- [ ] `voice/dreadnought/move1.mp3`
- [ ] `voice/dreadnought/attack1.mp3`
- [ ] `voice/dreadnought/ready.mp3`

### Voice Lines - Overseer (Support/Detector) ⏳ Needs Generation
- [ ] `voice/overseer/select1.mp3`
- [ ] `voice/overseer/select2.mp3`
- [ ] `voice/overseer/move1.mp3`
- [ ] `voice/overseer/ready.mp3`

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
└── voice/                 # DOMINION faction voice lines
    ├── fabricator/        # Fabricator (Worker) voice lines
    ├── trooper/           # Trooper (Basic Infantry) voice lines
    ├── breacher/          # Breacher (Heavy Infantry) voice lines
    ├── vanguard/          # Vanguard (Fast Assault) voice lines
    ├── operative/         # Operative (Elite Stealth) voice lines
    ├── scorcher/          # Scorcher (Fast Vehicle) voice lines
    ├── devastator/        # Devastator (Siege Tank) voice lines
    ├── colossus/          # Colossus (Walker Mech) voice lines
    ├── lifter/            # Lifter (Transport/Medic) voice lines
    ├── valkyrie/          # Valkyrie (Transforming Fighter) voice lines
    ├── specter/           # Specter (Stealth Fighter) voice lines
    ├── dreadnought/       # Dreadnought (Capital Ship) voice lines
    └── overseer/          # Overseer (Support/Detector) voice lines
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

### Fabricator (Worker)

| Filename | Line | Style |
|----------|------|-------|
| `voice/fabricator/select1.mp3` | "Fabricator online." | Male technician voice, slight robotic filter |
| `voice/fabricator/select2.mp3` | "Ready to construct." | Professional worker voice |
| `voice/fabricator/select3.mp3` | "What needs building?" | Eager technician voice |
| `voice/fabricator/move1.mp3` | "Relocating." | Efficient worker voice |
| `voice/fabricator/move2.mp3` | "On my way." | Professional acknowledgment |
| `voice/fabricator/attack1.mp3` | "This isn't in my contract..." | Reluctant worker voice |
| `voice/fabricator/ready.mp3` | "Fabricator assembled." | Military announcement |

### Trooper (Basic Infantry)

| Filename | Line | Style |
|----------|------|-------|
| `voice/trooper/select1.mp3` | "Ready for duty." | Professional male soldier |
| `voice/trooper/select2.mp3` | "Trooper standing by." | Military acknowledgment |
| `voice/trooper/select3.mp3` | "What's the mission?" | Eager soldier voice |
| `voice/trooper/move1.mp3` | "Moving out!" | Urgent soldier voice |
| `voice/trooper/move2.mp3` | "On it." | Quick acknowledgment |
| `voice/trooper/attack1.mp3` | "Opening fire!" | Battle-ready voice |
| `voice/trooper/attack2.mp3` | "Engaging hostiles!" | Aggressive soldier |
| `voice/trooper/ready.mp3` | "Trooper reporting for duty." | Military announcement |

### Breacher (Heavy Infantry)

| Filename | Line | Style |
|----------|------|-------|
| `voice/breacher/select1.mp3` | "Breacher ready." | Deep, intimidating voice |
| `voice/breacher/select2.mp3` | "Armor's solid." | Confident heavy trooper |
| `voice/breacher/move1.mp3` | "Moving heavy." | Slow, methodical voice |
| `voice/breacher/move2.mp3` | "Pushing forward." | Deep commanding voice |
| `voice/breacher/attack1.mp3` | "Cracking them open!" | Aggressive deep voice |
| `voice/breacher/ready.mp3` | "Breacher locked and loaded." | Military announcement |

### Vanguard (Fast Assault Infantry)

| Filename | Line | Style |
|----------|------|-------|
| `voice/vanguard/select1.mp3` | "Vanguard here!" | Energetic male voice |
| `voice/vanguard/select2.mp3` | "Ready to rock!" | Eager, aggressive |
| `voice/vanguard/move1.mp3` | "Boosters engaged." | Quick, mobile |
| `voice/vanguard/attack1.mp3` | "Going in hot!" | Aggressive, excited |
| `voice/vanguard/ready.mp3` | "Vanguard ready to deploy." | Military announcement |

### Operative (Elite Stealth)

| Filename | Line | Style |
|----------|------|-------|
| `voice/operative/select1.mp3` | "Operative standing by." | Cold, professional voice |
| `voice/operative/select2.mp3` | "In the shadows." | Mysterious, quiet |
| `voice/operative/move1.mp3` | "Moving silently." | Whispered, stealthy |
| `voice/operative/attack1.mp3` | "Target acquired." | Cold, precise |
| `voice/operative/ready.mp3` | "Operative ready for insertion." | Military announcement |

### Scorcher (Fast Attack Vehicle)

| Filename | Line | Style |
|----------|------|-------|
| `voice/scorcher/select1.mp3` | "Fire it up!" | Excited, pyromanic |
| `voice/scorcher/select2.mp3` | "Scorcher online." | Eager driver voice |
| `voice/scorcher/move1.mp3` | "Burning rubber!" | Fast, energetic |
| `voice/scorcher/attack1.mp3` | "Time to burn!" | Maniacal, excited |
| `voice/scorcher/ready.mp3` | "Scorcher fueled and ready." | Military announcement |

### Devastator (Heavy Siege Tank)

| Filename | Line | Style |
|----------|------|-------|
| `voice/devastator/select1.mp3` | "Devastator standing by." | Calm, methodical commander |
| `voice/devastator/select2.mp3` | "Tank primed." | Professional, patient |
| `voice/devastator/move1.mp3` | "Rolling out." | Steady tank commander |
| `voice/devastator/attack1.mp3` | "Bombardment commencing." | Cold, tactical |
| `voice/devastator/ready.mp3` | "Devastator battle-ready." | Military announcement |

### Colossus (Massive Walker Mech)

| Filename | Line | Style |
|----------|------|-------|
| `voice/colossus/select1.mp3` | "Colossus awakened." | Deep, powerful, ominous |
| `voice/colossus/select2.mp3` | "Systems nominal." | Mechanical, imposing |
| `voice/colossus/move1.mp3` | "Advancing." | Heavy, deliberate |
| `voice/colossus/attack1.mp3` | "Annihilation protocol engaged." | Deep, terrifying |
| `voice/colossus/ready.mp3` | "Colossus operational." | Military announcement |

### Lifter (Flying Transport/Medic)

| Filename | Line | Style |
|----------|------|-------|
| `voice/lifter/select1.mp3` | "Lifter ready." | Calm female pilot voice |
| `voice/lifter/select2.mp3` | "Medical support here." | Caring, professional |
| `voice/lifter/move1.mp3` | "Airborne." | Quick pilot acknowledgment |
| `voice/lifter/ready.mp3` | "Lifter standing by for evacuation." | Military announcement |

### Valkyrie (Transforming Fighter)

| Filename | Line | Style |
|----------|------|-------|
| `voice/valkyrie/select1.mp3` | "Valkyrie online." | Confident female pilot |
| `voice/valkyrie/select2.mp3` | "Ready to transform." | Eager, skilled |
| `voice/valkyrie/move1.mp3` | "Adjusting vector." | Technical pilot speak |
| `voice/valkyrie/attack1.mp3` | "Weapons hot!" | Aggressive fighter pilot |
| `voice/valkyrie/ready.mp3` | "Valkyrie cleared for launch." | Military announcement |

### Specter (Cloakable Strike Fighter)

| Filename | Line | Style |
|----------|------|-------|
| `voice/specter/select1.mp3` | "Specter active." | Ghost-like, whispered |
| `voice/specter/select2.mp3` | "You can't see me." | Mysterious, confident |
| `voice/specter/move1.mp3` | "Gliding in." | Silent, stealthy |
| `voice/specter/attack1.mp3` | "From the shadows." | Cold, deadly |
| `voice/specter/ready.mp3` | "Specter cloaked and ready." | Military announcement |

### Dreadnought (Capital Ship)

| Filename | Line | Style |
|----------|------|-------|
| `voice/dreadnought/select1.mp3` | "Dreadnought reporting." | Deep, commanding captain |
| `voice/dreadnought/select2.mp3` | "All guns ready." | Imposing, authoritative |
| `voice/dreadnought/move1.mp3` | "Setting course." | Naval command voice |
| `voice/dreadnought/attack1.mp3` | "Nova Cannon charged." | Terrifying, powerful |
| `voice/dreadnought/ready.mp3` | "Dreadnought commissioned." | Military announcement |

### Overseer (Support/Detector)

| Filename | Line | Style |
|----------|------|-------|
| `voice/overseer/select1.mp3` | "Overseer online." | Analytical, robotic |
| `voice/overseer/select2.mp3` | "Scanning area." | Technical, vigilant |
| `voice/overseer/move1.mp3` | "Repositioning sensors." | Calm, methodical |
| `voice/overseer/ready.mp3` | "Overseer deployed." | Military announcement |

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
