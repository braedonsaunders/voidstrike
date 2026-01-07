# VOIDSTRIKE - Required Audio Assets

This document lists all audio files that need to be generated for the game. The audio system gracefully handles missing files by generating procedural placeholder beeps.

## Directory Structure

```
public/audio/
├── ui/              # User interface sounds
├── alert/           # Alert and notification sounds
├── combat/          # Combat effects (weapons, impacts, explosions)
├── unit/            # Generic unit command sounds
├── voice/           # Unit voice lines
│   ├── scv/
│   ├── marine/
│   ├── marauder/
│   ├── hellion/
│   ├── tank/
│   └── medic/
├── building/        # Building sounds
├── ambient/         # Ambient/environmental sounds
└── music/           # Music tracks
```

---

## UI Sounds

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `ui/click.mp3` | Button click | 0.1s | Short, clean click |
| `ui/error.mp3` | Error/invalid action | 0.3s | Low buzzer, negative tone |
| `ui/select.mp3` | Unit/building selection | 0.2s | Soft blip |
| `ui/research.mp3` | Research complete | 0.5s | Ascending chime, positive |
| `ui/building_complete.mp3` | Building finished | 0.5s | Metallic completion ding |
| `ui/notification.mp3` | General notification | 0.3s | Neutral ping |

---

## Alert Sounds

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `alert/under_attack.mp3` | Base/units under attack | 0.8s | Urgent siren, military alarm |
| `alert/unit_lost.mp3` | Unit destroyed | 0.5s | Somber, brief |
| `alert/building_lost.mp3` | Building destroyed | 0.8s | Heavy, impactful |
| `alert/minerals_depleted.mp3` | Mineral patch empty | 0.5s | Hollow, empty sound |
| `alert/supply_blocked.mp3` | Supply limit reached | 0.5s | Warning tone |

---

## Combat Sounds - Weapons

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `combat/rifle.mp3` | Marine rifle fire | 0.2s | Rapid gunfire burst |
| `combat/cannon.mp3` | Tank/Marauder cannon | 0.4s | Heavy boom, echo |
| `combat/laser.mp3` | Energy weapon | 0.3s | Sci-fi zap, high-pitched |
| `combat/missile.mp3` | Missile launch | 0.5s | Woosh + ignition |
| `combat/flamethrower.mp3` | Hellion flame | 0.4s | Fire whoosh |

---

## Combat Sounds - Impacts

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `combat/hit.mp3` | Generic hit impact | 0.15s | Thud, meaty impact |
| `combat/hit_armor.mp3` | Armored target hit | 0.2s | Metallic clang |
| `combat/hit_shield.mp3` | Shield impact | 0.2s | Energy crackle |

---

## Combat Sounds - Explosions

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `combat/explosion_small.mp3` | Small explosion | 0.5s | Light boom |
| `combat/explosion_large.mp3` | Large explosion | 0.8s | Heavy, rumbling |
| `combat/explosion_building.mp3` | Building explosion | 1.2s | Massive, debris |

---

## Combat Sounds - Deaths

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `combat/death.mp3` | Generic unit death | 0.5s | Brief grunt/cry |
| `combat/death_mech.mp3` | Mechanical unit death | 0.6s | Metal crunch, sparks |
| `combat/death_bio.mp3` | Biological unit death | 0.5s | Organic splat |

---

## Unit Command Sounds

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `unit/move.mp3` | Move command acknowledged | 0.3s | Quick confirm blip |
| `unit/attack.mp3` | Attack command acknowledged | 0.3s | Aggressive confirm |
| `unit/ready.mp3` | Unit production complete | 0.5s | "Ready" notification |
| `unit/mining.mp3` | Worker mining loop | 2.0s | Drill/mining sounds, loopable |
| `unit/building.mp3` | Worker construction loop | 2.0s | Hammering/welding, loopable |

---

## Unit Voice Lines - SCV (Worker)

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/scv/select1.mp3` | Selection response 1 | "SCV ready." |
| `voice/scv/select2.mp3` | Selection response 2 | "Whaddya need?" |
| `voice/scv/select3.mp3` | Selection response 3 | "Orders?" |
| `voice/scv/move1.mp3` | Move response 1 | "Roger that." |
| `voice/scv/move2.mp3` | Move response 2 | "Moving out." |
| `voice/scv/attack1.mp3` | Attack response | "This is crazy!" |

---

## Unit Voice Lines - Marine

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/marine/select1.mp3` | Selection response 1 | "Ready to go!" |
| `voice/marine/select2.mp3` | Selection response 2 | "Waiting for orders." |
| `voice/marine/select3.mp3` | Selection response 3 | "What's the mission?" |
| `voice/marine/move1.mp3` | Move response 1 | "Moving out!" |
| `voice/marine/move2.mp3` | Move response 2 | "On my way." |
| `voice/marine/attack1.mp3` | Attack response 1 | "Let's do this!" |
| `voice/marine/attack2.mp3` | Attack response 2 | "Weapons hot!" |
| `voice/marine/ready.mp3` | Production complete | "Marine reporting!" |

---

## Unit Voice Lines - Marauder

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/marauder/select1.mp3` | Selection response 1 | "Armed and ready." |
| `voice/marauder/select2.mp3` | Selection response 2 | "What's the target?" |
| `voice/marauder/move1.mp3` | Move response 1 | "Rolling out." |
| `voice/marauder/move2.mp3` | Move response 2 | "On the move." |
| `voice/marauder/attack1.mp3` | Attack response | "Time to break something!" |
| `voice/marauder/ready.mp3` | Production complete | "Marauder online!" |

---

## Unit Voice Lines - Hellion

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/hellion/select1.mp3` | Selection response 1 | "Need a light?" |
| `voice/hellion/select2.mp3` | Selection response 2 | "Hellion standing by." |
| `voice/hellion/move1.mp3` | Move response | "Burning rubber!" |
| `voice/hellion/attack1.mp3` | Attack response | "Fire it up!" |
| `voice/hellion/ready.mp3` | Production complete | "Hellion ready to roll!" |

---

## Unit Voice Lines - Siege Tank

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/tank/select1.mp3` | Selection response 1 | "Tank reporting." |
| `voice/tank/select2.mp3` | Selection response 2 | "Ready for action." |
| `voice/tank/move1.mp3` | Move response | "Proceeding." |
| `voice/tank/attack1.mp3` | Attack response | "Locked and loaded!" |
| `voice/tank/ready.mp3` | Production complete | "Siege tank operational!" |

---

## Unit Voice Lines - Medic

| File | Description | Suggested Line |
|------|-------------|----------------|
| `voice/medic/select1.mp3` | Selection response 1 | "Medic here." |
| `voice/medic/select2.mp3` | Selection response 2 | "Need healing?" |
| `voice/medic/move1.mp3` | Move response | "On my way!" |
| `voice/medic/ready.mp3` | Production complete | "Medic ready!" |

---

## Building Sounds

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `building/place.mp3` | Building placement | 0.4s | Structural thunk |
| `building/construct.mp3` | Construction loop | 3.0s | Hammering, welding, loopable |
| `building/production.mp3` | Production started | 0.4s | Machine startup |
| `building/powerup.mp3` | Building power on | 0.5s | Electrical hum + click |
| `building/powerdown.mp3` | Building power off | 0.5s | Power down whine |

---

## Ambient Sounds (Biome-Specific)

All ambient sounds should be **loopable** and approximately **30-60 seconds** long.

| File | Description | Style |
|------|-------------|-------|
| `ambient/wind.mp3` | Generic wind | Soft breeze, subtle |
| `ambient/nature.mp3` | Grassland biome | Birds, crickets, rustling leaves |
| `ambient/desert.mp3` | Desert biome | Hot wind, distant sandstorm |
| `ambient/frozen.mp3` | Frozen biome | Howling wind, ice cracking |
| `ambient/volcanic.mp3` | Volcanic biome | Lava bubbling, rumbles |
| `ambient/void.mp3` | Void biome | Ethereal hum, alien whispers |
| `ambient/jungle.mp3` | Jungle biome | Wildlife, dense foliage |
| `ambient/battle.mp3` | Battle atmosphere | Distant gunfire, explosions |

---

## Music Tracks

All music should be **loopable** (except victory/defeat).

| File | Description | Duration | Style |
|------|-------------|----------|-------|
| `music/menu.mp3` | Main menu music | 2-3 min | Epic, orchestral |
| `music/peace.mp3` | Peacetime gameplay | 3-4 min | Calm, ambient, strategic |
| `music/battle.mp3` | Combat music | 2-3 min | Intense, driving |
| `music/victory.mp3` | Victory screen | 30s | Triumphant fanfare |
| `music/defeat.mp3` | Defeat screen | 30s | Somber, defeat theme |

---

## Audio Specifications

### Format
- **File format**: MP3 (for browser compatibility)
- **Sample rate**: 44.1kHz
- **Bit rate**: 128-192 kbps (balance quality vs size)
- **Channels**: Stereo for music/ambient, Mono for SFX/voice

### Volume Levels
- Sound effects are normalized in-code, but aim for:
  - UI sounds: -12dB
  - Combat sounds: -6dB
  - Voice lines: -3dB
  - Music: -9dB
  - Ambient: -15dB

### Looping
- Ambient and music files should have clean loop points
- Mark loop points in metadata if possible
- Avoid fade-in/out for looping content

---

## Priority for Generation

### High Priority (Core Experience)
1. Combat weapon sounds (rifle, cannon, flamethrower)
2. Hit impacts and explosions
3. Alert sounds (under attack, unit/building lost)
4. UI sounds (click, error, select)

### Medium Priority (Polish)
5. Unit voice lines (Marine, SCV first)
6. Ambient sounds (nature, battle)
7. Building sounds
8. Death sounds

### Low Priority (Enhancement)
9. Additional unit voice lines
10. Music tracks
11. Additional ambient biomes

---

## Generation Tools

Recommended tools for generating these audio assets:
- **ElevenLabs**: Voice lines (text-to-speech)
- **Suno AI**: Music generation
- **Freesound.org**: Sound effects base
- **Audacity**: Audio editing and normalization
- **JSFXR/BFXR**: Retro-style sound effects

---

## Notes

The audio system includes graceful fallback:
- Missing files generate procedural beeps as placeholders
- Categories have different fallback tones:
  - UI: 800Hz sine wave
  - Combat: 200Hz sine wave
  - Other: 400Hz sine wave
- Fallback sounds are very quiet (10% volume) to not be disruptive
