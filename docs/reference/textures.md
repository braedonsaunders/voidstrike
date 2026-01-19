# VOIDSTRIKE Terrain Textures Guide

This document details all terrain textures required for VOIDSTRIKE's biome system, with AI generation prompts and technical specifications.

---

## Technical Requirements

### File Format & Location
- **Format:** PNG (24-bit RGB or 32-bit RGBA)
- **Location:** `/public/textures/terrain/`
- **Naming:** `{material}_{type}.png` (e.g., `sand_diffuse.png`)

### Texture Types (PBR Workflow)
| Type | Description | Format |
|------|-------------|--------|
| `*_diffuse.png` | Albedo/color map | RGB |
| `*_normal.png` | Normal map (OpenGL style, Y+ up) | RGB |
| `*_roughness.png` | Roughness map (white=rough, black=smooth) | Grayscale |
| `*_displacement.png` | Height/displacement map | Grayscale |

### Specifications
| Property | Requirement |
|----------|-------------|
| Resolution | 1024x1024 (preferred), 512x512 (acceptable) |
| Seamless | **Required** - must tile seamlessly |
| Format | PNG, 8-bit per channel |
| Color space | sRGB for diffuse, Linear for others |

---

## AI Generation Tool

**Recommended:** [Polycam AI Texture Generator](https://poly.cam/tools/ai-texture-generator)

### Polycam Output Mapping
| Polycam Output | Our Naming |
|----------------|------------|
| albedo | `*_diffuse.png` |
| normal | `*_normal.png` |
| roughness | `*_roughness.png` |
| displacement/height | `*_displacement.png` |

---

## Existing Textures (Grassland Base)

Location: `/public/textures/terrain/`

### ✅ Grass Textures
| File | Size | Status |
|------|------|--------|
| `grass_diffuse.png` | 2.2 MB | ✅ Complete |
| `grass_normal.png` | 2.5 MB | ✅ Complete |
| `grass_roughness.png` | 534 KB | ✅ Complete |
| `grass_displacement.png` | 430 KB | ✅ Complete |

### ✅ Dirt Textures
| File | Size | Status |
|------|------|--------|
| `dirt_diffuse.png` | 2.2 MB | ✅ Complete |
| `dirt_normal.png` | 2.2 MB | ✅ Complete |
| `dirt_roughness.png` | 572 KB | ✅ Complete |
| `dirt_displacement.png` | 198 KB | ✅ Complete |

### ✅ Rock Textures
| File | Size | Status |
|------|------|--------|
| `rock_diffuse.png` | 2.2 MB | ✅ Complete |
| `rock_normal.png` | 2.2 MB | ✅ Complete |
| `rock_roughness.png` | 549 KB | ✅ Complete |
| `rock_displacement.png` | 263 KB | ✅ Complete |

### ✅ Cliff Textures
| File | Size | Status |
|------|------|--------|
| `cliff_diffuse.png` | 2.2 MB | ✅ Complete |
| `cliff_normal.png` | 2.2 MB | ✅ Complete |
| `cliff_roughness.png` | 594 KB | ✅ Complete |
| `cliff_displacement.png` | 247 KB | ✅ Complete |

---

## Missing Biome Textures

The terrain shader uses 4 texture slots that blend based on slope and elevation:
- **Ground** (flat areas, buildable)
- **Dirt** (paths, trampled areas)
- **Rock** (rocky terrain, slopes)
- **Cliff** (steep cliffs, walls)

Each biome needs its own set of 4 materials × 4 texture types = **16 textures per biome**.

---

## Desert Biome Textures

### Sand Ground
**Files:** `sand_diffuse.png`, `sand_normal.png`, `sand_roughness.png`, `sand_displacement.png`

**AI Prompt:**
```
Seamless sandy desert ground texture, fine golden-tan sand with subtle
wind ripples, scattered small pebbles, arid wasteland floor, natural
sand dune surface, warm beige-yellow tones, realistic PBR material,
tileable 1024x1024, top-down view
```

### Desert Dirt
**Files:** `desert_dirt_diffuse.png`, `desert_dirt_normal.png`, `desert_dirt_roughness.png`, `desert_dirt_displacement.png`

**AI Prompt:**
```
Seamless cracked dry desert soil texture, parched earth with crack
patterns, dusty brown-tan color, dried mud surface, arid terrain floor,
subtle sand particles, realistic PBR material, tileable 1024x1024,
top-down view
```

### Sandstone Rock
**Files:** `sandstone_diffuse.png`, `sandstone_normal.png`, `sandstone_roughness.png`, `sandstone_displacement.png`

**AI Prompt:**
```
Seamless sandstone rock texture, layered sedimentary rock surface,
orange-tan striations, desert canyon wall material, weathered stone
with natural erosion patterns, warm earth tones, realistic PBR
material, tileable 1024x1024
```

### Desert Cliff
**Files:** `desert_cliff_diffuse.png`, `desert_cliff_normal.png`, `desert_cliff_roughness.png`, `desert_cliff_displacement.png`

**AI Prompt:**
```
Seamless desert cliff face texture, steep rocky canyon wall, layered
sandstone and limestone, dramatic erosion patterns, red-brown-tan
coloring, rugged terrain surface, realistic PBR material, tileable
1024x1024
```

---

## Frozen Biome Textures

### Snow Ground
**Files:** `snow_diffuse.png`, `snow_normal.png`, `snow_roughness.png`, `snow_displacement.png`

**AI Prompt:**
```
Seamless snow ground texture, fresh powder snow surface, white with
subtle blue shadows, crystalline sparkle texture, soft undulating
snow drifts, winter terrain floor, realistic PBR material, tileable
1024x1024, top-down view
```

### Frozen Dirt (Permafrost)
**Files:** `permafrost_diffuse.png`, `permafrost_normal.png`, `permafrost_roughness.png`, `permafrost_displacement.png`

**AI Prompt:**
```
Seamless frozen tundra ground texture, icy permafrost soil, patches
of ice and frozen dirt, gray-blue-brown tones, cracked frozen earth,
arctic terrain surface, realistic PBR material, tileable 1024x1024,
top-down view
```

### Ice Rock
**Files:** `ice_rock_diffuse.png`, `ice_rock_normal.png`, `ice_rock_roughness.png`, `ice_rock_displacement.png`

**AI Prompt:**
```
Seamless icy rock texture, frozen stone with ice crystals, blue-white
glacial ice patches on gray rock, frost-covered surface, arctic cliff
material, translucent ice elements, realistic PBR material, tileable
1024x1024
```

### Ice Cliff
**Files:** `ice_cliff_diffuse.png`, `ice_cliff_normal.png`, `ice_cliff_roughness.png`, `ice_cliff_displacement.png`

**AI Prompt:**
```
Seamless glacier cliff texture, sheer ice wall surface, blue-white
translucent ice, frozen waterfall elements, dramatic ice formations,
arctic cliff face, crystalline structure, realistic PBR material,
tileable 1024x1024
```

---

## Volcanic Biome Textures

### Ash Ground
**Files:** `ash_diffuse.png`, `ash_normal.png`, `ash_roughness.png`, `ash_displacement.png`

**AI Prompt:**
```
Seamless volcanic ash ground texture, dark charcoal-gray powdery ash,
scattered black volcanic rocks, burnt terrain surface, subtle ember
glow cracks, apocalyptic wasteland floor, realistic PBR material,
tileable 1024x1024, top-down view
```

### Scorched Earth
**Files:** `scorched_diffuse.png`, `scorched_normal.png`, `scorched_roughness.png`, `scorched_displacement.png`

**AI Prompt:**
```
Seamless scorched earth texture, burnt cracked ground, black and
dark red charred soil, heat-damaged terrain, cooling lava cracks
with orange glow, volcanic wasteland path, realistic PBR material,
tileable 1024x1024, top-down view
```

### Basalt Rock
**Files:** `basalt_diffuse.png`, `basalt_normal.png`, `basalt_roughness.png`, `basalt_displacement.png`

**AI Prompt:**
```
Seamless volcanic basalt rock texture, dark gray-black ignite rock,
hexagonal columnar jointing patterns, rough porous lava stone surface,
volcanic terrain material, realistic PBR material, tileable 1024x1024
```

### Volcanic Cliff
**Files:** `volcanic_cliff_diffuse.png`, `volcanic_cliff_normal.png`, `volcanic_cliff_roughness.png`, `volcanic_cliff_displacement.png`

**AI Prompt:**
```
Seamless volcanic cliff texture, jagged lava rock cliff face, black
basalt with orange lava veins, glowing magma cracks, hellish terrain
wall, dramatic volcanic formations, realistic PBR material, tileable
1024x1024
```

---

## Void Biome Textures

### Void Ground
**Files:** `void_ground_diffuse.png`, `void_ground_normal.png`, `void_ground_roughness.png`, `void_ground_displacement.png`

**AI Prompt:**
```
Seamless alien void ground texture, dark purple-black alien terrain,
glowing cyan energy veins, otherworldly crystalline surface, sci-fi
alien planet floor, bioluminescent patterns, ethereal cosmic material,
realistic PBR material, tileable 1024x1024, top-down view
```

### Void Dirt
**Files:** `void_dirt_diffuse.png`, `void_dirt_normal.png`, `void_dirt_roughness.png`, `void_dirt_displacement.png`

**AI Prompt:**
```
Seamless alien corrupted soil texture, dark purple organic matter,
strange alien growth patterns, glowing spore patches, void-touched
earth, cosmic corruption spreading, sci-fi terrain path, realistic
PBR material, tileable 1024x1024, top-down view
```

### Void Rock
**Files:** `void_rock_diffuse.png`, `void_rock_normal.png`, `void_rock_roughness.png`, `void_rock_displacement.png`

**AI Prompt:**
```
Seamless alien void crystal rock texture, dark purple crystalline
formations, glowing blue-cyan energy cores, otherworldly mineral
surface, sci-fi alien rock material, ethereal cosmic stone, realistic
PBR material, tileable 1024x1024
```

### Void Cliff
**Files:** `void_cliff_diffuse.png`, `void_cliff_normal.png`, `void_cliff_roughness.png`, `void_cliff_displacement.png`

**AI Prompt:**
```
Seamless alien void cliff texture, towering purple-black alien cliff
face, massive glowing crystal formations, energy conduits running
through rock, cosmic void architecture, otherworldly terrain wall,
realistic PBR material, tileable 1024x1024
```

---

## Jungle Biome Textures

### Jungle Floor
**Files:** `jungle_floor_diffuse.png`, `jungle_floor_normal.png`, `jungle_floor_roughness.png`, `jungle_floor_displacement.png`

**AI Prompt:**
```
Seamless jungle forest floor texture, dark rich soil with fallen
leaves, moss patches, small ferns and undergrowth, tropical rainforest
ground, humid forest floor, deep green-brown tones, realistic PBR
material, tileable 1024x1024, top-down view
```

### Mud
**Files:** `mud_diffuse.png`, `mud_normal.png`, `mud_roughness.png`, `mud_displacement.png`

**AI Prompt:**
```
Seamless wet jungle mud texture, dark brown muddy terrain, water
pooling in tracks, swamp-like wet soil, tropical rainforest path,
humid sticky mud surface, realistic PBR material, tileable 1024x1024,
top-down view
```

### Mossy Rock
**Files:** `mossy_rock_diffuse.png`, `mossy_rock_normal.png`, `mossy_rock_roughness.png`, `mossy_rock_displacement.png`

**AI Prompt:**
```
Seamless moss-covered rock texture, gray stone with thick green moss
growth, jungle boulder surface, humid rainforest rock, lichen and
moss patterns, weathered tropical stone, realistic PBR material,
tileable 1024x1024
```

### Jungle Cliff
**Files:** `jungle_cliff_diffuse.png`, `jungle_cliff_normal.png`, `jungle_cliff_roughness.png`, `jungle_cliff_displacement.png`

**AI Prompt:**
```
Seamless jungle cliff texture, steep tropical rock face, hanging
vines and moss, waterfall-worn stone, lush green growth on gray
rock, rainforest terrain wall, humid overgrown cliff, realistic
PBR material, tileable 1024x1024
```

---

## Texture Checklist

### Grassland (Base) - ✅ COMPLETE
- [x] grass_diffuse.png, grass_normal.png, grass_roughness.png, grass_displacement.png
- [x] dirt_diffuse.png, dirt_normal.png, dirt_roughness.png, dirt_displacement.png
- [x] rock_diffuse.png, rock_normal.png, rock_roughness.png, rock_displacement.png
- [x] cliff_diffuse.png, cliff_normal.png, cliff_roughness.png, cliff_displacement.png

### Desert - ✅ COMPLETE
- [x] sand_diffuse.png, sand_normal.png, sand_roughness.png, sand_displacement.png
- [x] desert_dirt_diffuse.png, desert_dirt_normal.png, desert_dirt_roughness.png, desert_dirt_displacement.png
- [x] sandstone_diffuse.png, sandstone_normal.png, sandstone_roughness.png, sandstone_displacement.png
- [x] desert_cliff_diffuse.png, desert_cliff_normal.png, desert_cliff_roughness.png, desert_cliff_displacement.png

### Frozen - ✅ COMPLETE
- [x] snow_diffuse.png, snow_normal.png, snow_roughness.png, snow_displacement.png
- [x] permafrost_diffuse.png, permafrost_normal.png, permafrost_roughness.png, permafrost_displacement.png
- [x] ice_rock_diffuse.png, ice_rock_normal.png, ice_rock_roughness.png, ice_rock_displacement.png
- [x] ice_cliff_diffuse.png, ice_cliff_normal.png, ice_cliff_roughness.png, ice_cliff_displacement.png

### Volcanic - ✅ COMPLETE
- [x] ash_diffuse.png, ash_normal.png, ash_roughness.png, ash_displacement.png
- [x] scorched_diffuse.png, scorched_normal.png, scorched_roughness.png, scorched_displacement.png
- [x] basalt_diffuse.png, basalt_normal.png, basalt_roughness.png, basalt_displacement.png
- [x] volcanic_cliff_diffuse.png, volcanic_cliff_normal.png, volcanic_cliff_roughness.png, volcanic_cliff_displacement.png

### Void - ✅ COMPLETE
- [x] void_ground_diffuse.png, void_ground_normal.png, void_ground_roughness.png, void_ground_displacement.png
- [x] void_dirt_diffuse.png, void_dirt_normal.png, void_dirt_roughness.png, void_dirt_displacement.png
- [x] void_rock_diffuse.png, void_rock_normal.png, void_rock_roughness.png, void_rock_displacement.png
- [x] void_cliff_diffuse.png, void_cliff_normal.png, void_cliff_roughness.png, void_cliff_displacement.png

### Jungle - ✅ COMPLETE
- [x] jungle_floor_diffuse.png, jungle_floor_normal.png, jungle_floor_roughness.png, jungle_floor_displacement.png
- [x] mud_diffuse.png, mud_normal.png, mud_roughness.png, mud_displacement.png
- [x] mossy_rock_diffuse.png, mossy_rock_normal.png, mossy_rock_roughness.png, mossy_rock_displacement.png
- [x] jungle_cliff_diffuse.png, jungle_cliff_normal.png, jungle_cliff_roughness.png, jungle_cliff_displacement.png

---

## Summary

| Biome | Complete | Total | Progress |
|-------|----------|-------|----------|
| Grassland | 16 | 16 | ✅ 100% |
| Desert | 16 | 16 | ✅ 100% |
| Frozen | 16 | 16 | ✅ 100% |
| Volcanic | 16 | 16 | ✅ 100% |
| Void | 16 | 16 | ✅ 100% |
| Jungle | 16 | 16 | ✅ 100% |
| **Total** | **96** | **96** | **✅ 100%** |

---

## Texture Generation Reference

The AI prompts above were used to generate all textures via [Polycam AI Texture Generator](https://poly.cam/tools/ai-texture-generator). They are preserved here for reference if textures need to be regenerated or improved.

---

## Code Integration

Textures are automatically loaded by `TSLTerrainMaterial` based on biome type. The material handles 4-texture blending (grass, dirt, rock, cliff) with slope-based weight calculation.

```typescript
// Example: Creating terrain material for a biome
import { TSLTerrainMaterial } from '@/rendering/tsl/TerrainMaterial';

const material = new TSLTerrainMaterial({
  biome: 'desert',  // Loads sand_*, desert_dirt_*, rock_*, desert_cliff_*
  mapWidth: 128,
  mapHeight: 128,
});
```
