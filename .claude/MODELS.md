# VOIDSTRIKE 3D Model Asset Guide

This document lists all 3D models required for VOIDSTRIKE, with AI generation prompts, technical specifications, and requirements.

---

## Technical Requirements (All Models)

### File Format
- **Preferred:** GLB (binary GLTF 2.0)
- **Alternative:** GLTF with embedded textures
- **Max file size:** 5MB per model (optimize if larger)

### General Specifications
| Property | Requirement |
|----------|-------------|
| Polygon count | 500-5000 triangles (units), 1000-10000 (buildings) |
| Scale | 1 unit = 1 meter |
| Origin | Center-bottom (ground level) |
| Orientation | Face +X direction (forward) |
| Up axis | +Y |
| Materials | PBR (metallic-roughness workflow) |
| Textures | Max 1024x1024, prefer 512x512 |

### Color Guidelines
- **Primary:** Steel blue-gray (#6080a0)
- **Accent (player color):** Bright blue (#40a0ff) - will be tinted per-player
- **Lights/Glow:** Cyan (#80c0ff)
- Mark accent meshes for player color tinting in your 3D software

---

## UNITS

### 1. SCV (Space Construction Vehicle)
**File:** `/public/models/units/scv.glb`

**Dimensions:** 0.8m wide × 0.8m tall × 0.6m deep

**Description:** Small industrial mech/exosuit for construction and mining. Compact, utilitarian design.

**AI Prompt:**
```
Sci-fi industrial construction mech, compact humanoid exosuit,
yellow-orange hazard markings, mechanical arms with tools (drill, welder),
enclosed cockpit with small viewport, tank treads or stubby legs,
utilitarian industrial design, no weapons, PBR materials,
game-ready low poly, isometric view, white background
```

**Key Features:**
- Enclosed cockpit with small window
- Two mechanical arms (one with drill/mining tool)
- Compact body with utility equipment
- Tank treads or mechanical legs

---

### 2. Marine
**File:** `/public/models/units/marine.glb`

**Dimensions:** 0.5m wide × 1.2m tall × 0.4m deep

**Description:** Heavily armored infantry soldier in powered combat suit.

**AI Prompt:**
```
Futuristic space marine soldier, bulky powered armor suit,
enclosed helmet with blue visor, large shoulder pauldrons,
holding gauss rifle/assault rifle, military sci-fi aesthetic,
blue-gray metallic armor with glowing accents, combat stance,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Full enclosed helmet with visor
- Bulky powered armor
- Large shoulder pads (accent color)
- Gauss rifle weapon

---

### 3. Marauder
**File:** `/public/models/units/marauder.glb`

**Dimensions:** 0.7m wide × 1.4m tall × 0.6m deep

**Description:** Heavy assault infantry in massive powered armor with grenade launchers.

**AI Prompt:**
```
Heavy assault trooper in massive powered exoskeleton armor,
much bulkier than standard infantry, twin grenade launchers
mounted on shoulders, thick armored plating, small head/helmet
integrated into torso, heavy stomping legs, intimidating presence,
blue-gray military colors, game-ready low poly, white background
```

**Key Features:**
- Extra bulky armor (larger than Marine)
- Twin shoulder-mounted grenade launchers (accent color)
- Heavy armored legs
- Integrated helmet design

---

### 4. Reaper
**File:** `/public/models/units/reaper.glb`

**Dimensions:** 0.5m wide × 1.3m tall × 0.4m deep

**Description:** Light jetpack infantry unit, agile and fast.

**AI Prompt:**
```
Agile jetpack soldier, lightweight tactical armor,
twin jetpack thrusters on back, dual pistols in hands,
sleek aerodynamic helmet, athletic combat pose,
dark armor with blue accent lights, mobile raider aesthetic,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Prominent jetpack with dual thrusters
- Lightweight armor (slimmer than Marine)
- Dual pistol weapons
- Aerodynamic helmet

---

### 5. Ghost
**File:** `/public/models/units/ghost.glb`

**Dimensions:** 0.4m wide × 1.3m tall × 0.4m deep

**Description:** Elite stealth operative with sniper rifle and cloaking tech.

**AI Prompt:**
```
Elite stealth operative soldier, sleek form-fitting stealth suit,
high-tech visor/goggles, long sniper rifle, tactical gear,
dark matte armor with subtle blue tech lines, covert ops aesthetic,
hooded or helmeted, slim athletic build, game-ready low poly,
PBR materials, white background
```

**Key Features:**
- Slim, sleek armor design
- Long sniper rifle
- Tech goggles/visor with glow
- Stealthy dark coloring with subtle accents

---

### 6. Hellion
**File:** `/public/models/units/hellion.glb`

**Dimensions:** 1.2m wide × 0.8m tall × 2.0m long

**Description:** Fast attack buggy/quad with flamethrower.

**AI Prompt:**
```
Futuristic military attack buggy, four-wheeled fast vehicle,
front-mounted flamethrower weapon, exposed driver cockpit,
aggressive angular design, roll cage, large off-road wheels,
military blue-gray with orange flame decals, game-ready low poly,
PBR materials, white background
```

**Key Features:**
- Four large wheels
- Open cockpit with driver
- Front-mounted flamethrower (accent color)
- Fast attack vehicle aesthetic

---

### 7. Siege Tank
**File:** `/public/models/units/siege_tank.glb`

**Dimensions:** 1.6m wide × 1.0m tall × 2.2m long

**Description:** Heavy battle tank with large siege cannon.

**AI Prompt:**
```
Futuristic heavy battle tank, dual track treads, rotating turret,
massive siege cannon barrel, heavy armored hull, command antenna,
military sci-fi design, blue-gray armor plating, industrial details,
game-ready low poly, PBR materials, side view, white background
```

**Key Features:**
- Heavy tracked chassis
- Rotating turret with long cannon (accent color)
- Thick armored hull
- Military antenna/sensors

---

### 8. Thor
**File:** `/public/models/units/thor.glb`

**Dimensions:** 2.0m wide × 2.5m tall × 1.5m deep

**Description:** Massive bipedal assault mech with heavy weapons.

**AI Prompt:**
```
Giant bipedal assault mech, massive humanoid robot,
twin arm-mounted cannons, heavy armored legs, small cockpit head,
industrial military design, walking tank aesthetic,
blue-gray armor with bright accent panels, imposing stance,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Huge bipedal design (largest ground unit)
- Twin arm cannons (accent color)
- Small cockpit "head"
- Massive armored legs

---

### 9. Medivac
**File:** `/public/models/units/medivac.glb`

**Dimensions:** 2.0m wide × 1.2m tall × 3.0m long

**Description:** Medical dropship with healing capabilities.

**AI Prompt:**
```
Military medical dropship aircraft, twin rotor VTOL design,
red cross medical markings, troop bay with open doors,
search lights, rescue winch, white and blue medical colors,
futuristic helicopter aesthetic, game-ready low poly,
PBR materials, white background
```

**Key Features:**
- Twin rotors/engines for VTOL
- Medical markings (red cross optional)
- Troop bay doors
- White/blue color scheme

---

### 10. Viking
**File:** `/public/models/units/viking.glb`

**Dimensions:** 1.8m wide × 1.5m tall × 2.5m long (flight mode)

**Description:** Transforming fighter that switches between air and ground modes.

**AI Prompt:**
```
Transforming aerospace fighter jet, swept wings with weapons,
twin engine pods, cockpit canopy, landing struts that become legs,
sleek aggressive fighter design, blue-gray military colors,
futuristic jet fighter, game-ready low poly, PBR materials,
flight mode pose, white background
```

**Key Features:**
- Fighter jet body
- Swept wings
- Twin engines (accent color)
- Landing gear/transformation joints

---

### 11. Banshee
**File:** `/public/models/units/banshee.glb`

**Dimensions:** 1.5m wide × 0.8m tall × 2.5m long

**Description:** Stealth ground-attack aircraft with cloaking.

**AI Prompt:**
```
Stealth ground attack aircraft, sleek angular stealth design,
twin rocket pods under angled wings, bubble cockpit,
dark matte coating, aggressive predator aesthetic,
futuristic stealth bomber, game-ready low poly,
PBR materials, white background
```

**Key Features:**
- Angular stealth design
- Angled wings
- Rocket/missile pods (accent color)
- Dark stealth coloring

---

### 12. Battlecruiser
**File:** `/public/models/units/battlecruiser.glb`

**Dimensions:** 4.0m wide × 2.0m tall × 6.0m long

**Description:** Massive capital warship with heavy weaponry.

**AI Prompt:**
```
Massive sci-fi battleship spacecraft, elongated warship hull,
command bridge tower, multiple gun turrets along sides,
large main cannon at bow, engine array at stern,
imposing dreadnought design, blue-gray military colors,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Large elongated hull (biggest unit)
- Command bridge/tower
- Multiple weapon turrets
- Large main cannon (Yamato - accent color)
- Engine array at rear

---

### 13. Raven
**File:** `/public/models/units/raven.glb`

**Dimensions:** 1.5m wide × 0.8m tall × 2.0m long

**Description:** Support aircraft with deployable turrets and detection abilities.

**AI Prompt:**
```
Futuristic support drone aircraft, sleek unmanned aerial vehicle,
sensor dome on top, small turret launchers under wings,
detection equipment, radar array, surveillance craft design,
blue-gray with glowing sensor lights, autonomous drone aesthetic,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Sensor dome (accent color with glow)
- Small form factor drone
- Detection/radar equipment
- Turret deployment bays
- Unmanned/autonomous appearance

---

## BUILDINGS

### 1. Command Center
**File:** `/public/models/buildings/command_center.glb`

**Dimensions:** 5m × 5m footprint, 4m tall

**Description:** Main base headquarters and worker production facility. Can upgrade to Orbital Command or Planetary Fortress.

**AI Prompt:**
```
Futuristic military command center building, large fortified structure,
control tower with antenna array, landing pad on roof,
heavy armored walls, blue accent lights, industrial sci-fi base,
modular design, satellite dishes, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Large main structure (5x5 footprint)
- Control tower with antennas
- Landing pad area (accent color)
- Heavy industrial appearance

---

### 2. Orbital Command (Command Center Upgrade)
**File:** `/public/models/buildings/orbital_command.glb`

**Dimensions:** 5m × 5m footprint, 5m tall

**Description:** Upgraded Command Center with orbital satellite uplink capabilities. Provides MULEs, Scanner Sweep, and Supply Drops.

**AI Prompt:**
```
Futuristic orbital command center, upgraded military headquarters,
large satellite dish array pointing skyward, communication towers,
holographic displays, orbital uplink antenna, heavy fortified structure,
glowing blue communication dishes, advanced command facility,
blue-gray armor with cyan accent lights, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Large satellite dish array (accent color)
- Multiple communication antennas
- Orbital uplink equipment
- Upgraded from Command Center appearance
- Glowing holographic elements

---

### 3. Planetary Fortress (Command Center Upgrade)
**File:** `/public/models/buildings/planetary_fortress.glb`

**Dimensions:** 5m × 5m footprint, 4m tall

**Description:** Heavily fortified Command Center upgrade with twin Ibiks cannons. Cannot lift off. Massive defensive structure.

**AI Prompt:**
```
Heavily fortified planetary fortress, defensive military stronghold,
twin large turret cannons on top, thick armored bunker walls,
reinforced blast plating, firing slits, heavy defensive structure,
dark military armor with orange warning lights, imposing fortress,
game-ready low poly, PBR materials, isometric view, white background
```

**Key Features:**
- Twin Ibiks cannons on turret (accent color)
- Extra thick armored walls
- Bunker-like defensive appearance
- No visible landing pad (cannot lift off)
- More fortified than standard Command Center

---

### 4. Supply Depot
**File:** `/public/models/buildings/supply_depot.glb`

**Dimensions:** 2m × 2m footprint, 1.5m tall

**Description:** Supply storage container that provides population capacity.

**AI Prompt:**
```
Futuristic supply container building, compact storage depot,
reinforced shipping container design, vents and hatches,
industrial military storage, lowered underground capable,
blue-gray metal with accent panels, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Compact container design (2x2 footprint)
- Ventilation systems
- Industrial storage aesthetic
- Top accent panel

---

### 3. Refinery
**File:** `/public/models/buildings/refinery.glb`

**Dimensions:** 3m × 3m footprint, 3m tall

**Description:** Vespene gas extraction and processing facility.

**AI Prompt:**
```
Futuristic gas refinery building, industrial processing plant,
cylindrical tanks and pipes, extraction tower with green glow,
venting steam/gas effects, heavy industrial design,
metal and concrete materials, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Cylindrical main tank
- Processing tower
- Pipe network (accent color)
- Green gas venting effect

---

### 4. Barracks
**File:** `/public/models/buildings/barracks.glb`

**Dimensions:** 3m × 3m footprint, 2.5m tall

**Description:** Infantry training and deployment facility.

**AI Prompt:**
```
Futuristic military barracks building, troop training facility,
main entrance with blast doors, roof details and antenna,
flagpole or banner, reinforced military structure,
blue-gray armor plating, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Entrance door (accent color)
- Military appearance
- Roof communications array
- Flag/banner element

---

### 5. Engineering Bay
**File:** `/public/models/buildings/engineering_bay.glb`

**Dimensions:** 3m × 3m footprint, 3m tall

**Description:** Research facility for infantry upgrades.

**AI Prompt:**
```
Futuristic research laboratory building, tech research facility,
large satellite dish on roof, holographic displays visible,
scientific equipment, clean high-tech design,
blue accent lighting, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Large satellite dish (accent color)
- Research/tech aesthetic
- Clean design
- Glowing elements

---

### 6. Bunker
**File:** `/public/models/buildings/bunker.glb`

**Dimensions:** 3m × 3m footprint, 1.5m tall

**Description:** Defensive fortification that garrisons infantry.

**AI Prompt:**
```
Futuristic military bunker, low fortified defensive structure,
firing slits on all sides, heavy armored walls, sandbags,
partially underground design, dark military colors,
defensive emplacement, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Low profile fortification
- Firing slits on sides
- Heavy armor appearance
- Defensive design

---

### 7. Factory
**File:** `/public/models/buildings/factory.glb`

**Dimensions:** 3m × 3m footprint, 3m tall

**Description:** Vehicle production facility.

**AI Prompt:**
```
Futuristic vehicle factory building, industrial production plant,
large vehicle bay doors, smokestacks, crane arm on roof,
assembly line aesthetic, heavy industrial design,
blue-gray metal, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Large bay doors (accent color)
- Industrial smokestacks
- Crane/assembly arm
- Heavy industrial look

---

### 8. Armory
**File:** `/public/models/buildings/armory.glb`

**Dimensions:** 3m × 3m footprint, 2.5m tall

**Description:** Vehicle and ship upgrade research facility.

**AI Prompt:**
```
Futuristic military armory building, weapons research facility,
reinforced bunker design, weapon testing equipment,
heavy blast doors, ammunition storage aesthetic,
thick armored walls, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Heavily reinforced design
- Thick armored walls
- Weapons/ammunition aesthetic
- Blast door entrance

---

### 9. Starport
**File:** `/public/models/buildings/starport.glb`

**Dimensions:** 3m × 3m footprint, 2.5m tall

**Description:** Aircraft hangar and production facility.

**AI Prompt:**
```
Futuristic starport hangar building, aircraft production facility,
large hangar bay, control tower, radar dish, landing lights,
runway markings, aviation facility design, blue accent lights,
game-ready low poly, PBR materials, isometric view, white background
```

**Key Features:**
- Large hangar opening
- Control tower
- Radar dish (accent color)
- Landing lights/markers

---

### 10. Fusion Core
**File:** `/public/models/buildings/fusion_core.glb`

**Dimensions:** 3m × 3m footprint, 4m tall

**Description:** Advanced power and technology facility for capital ships.

**AI Prompt:**
```
Futuristic fusion reactor building, high-tech power facility,
glowing energy core visible, cooling towers, power conduits,
advanced technology aesthetic, blue energy glow effects,
game-ready low poly, PBR materials, isometric view, white background
```

**Key Features:**
- Visible glowing core (accent color with emissive)
- Tall tower design
- Energy conduits
- High-tech appearance

---

### 11. Sensor Tower
**File:** `/public/models/buildings/sensor_tower.glb`

**Dimensions:** 2m × 2m footprint, 4m tall

**Description:** Radar detection tower for map awareness.

**AI Prompt:**
```
Futuristic radar tower building, tall sensor array structure,
rotating radar dish on top, antenna arrays, detection equipment,
thin tower design, blue scanning lights, military surveillance,
game-ready low poly, PBR materials, isometric view, white background
```

**Key Features:**
- Tall thin tower
- Rotating radar dish (accent color)
- Antenna arrays
- Surveillance aesthetic

---

### 12. Missile Turret
**File:** `/public/models/buildings/missile_turret.glb`

**Dimensions:** 2m × 2m footprint, 2.5m tall

**Description:** Anti-air defense turret.

**AI Prompt:**
```
Futuristic anti-aircraft turret, missile defense emplacement,
rotating turret base, twin missile launcher pods,
targeting sensors, automated weapon system design,
blue-gray military colors, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Rotating turret base
- Twin missile pods (accent color)
- Targeting sensors
- Automated defense aesthetic

---

### 13. Ghost Academy
**File:** `/public/models/buildings/ghost_academy.glb`

**Dimensions:** 3m × 3m footprint, 3m tall

**Description:** Covert operations training facility for Ghost production.

**AI Prompt:**
```
Futuristic covert ops training facility, ghost academy building,
dark stealth architecture, holographic training displays,
psionic amplifier dome on roof, shadowy secure entrance,
dark matte materials with subtle blue tech accents,
secretive military facility, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Dark stealth aesthetic
- Psionic amplifier dome (accent color with glow)
- Secure entrance
- Training hologram elements
- Covert ops appearance

---

### 14. Tech Lab (Addon)
**File:** `/public/models/buildings/tech_lab.glb`

**Dimensions:** 2m × 2m footprint, 2m tall

**Description:** Research addon for Barracks/Factory/Starport that enables advanced unit production.

**AI Prompt:**
```
Futuristic research addon module, compact tech laboratory,
holographic displays, research equipment, data screens,
modular attachment design, blue glowing tech elements,
scientific military addon, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Compact modular design (2x2 footprint)
- Holographic displays (accent color with glow)
- Research equipment visible
- Attachment point on one side
- High-tech laboratory aesthetic

---

### 15. Reactor (Addon)
**File:** `/public/models/buildings/reactor.glb`

**Dimensions:** 2m × 2m footprint, 2m tall

**Description:** Power addon for Barracks/Factory/Starport that enables double unit production.

**AI Prompt:**
```
Futuristic power reactor addon module, compact energy generator,
glowing power core, cooling vents, energy conduits,
modular attachment design, orange/yellow energy glow,
industrial power module, game-ready low poly,
PBR materials, isometric view, white background
```

**Key Features:**
- Compact modular design (2x2 footprint)
- Glowing power core (accent color with strong emission)
- Cooling vents/radiators
- Attachment point on one side
- Industrial power plant aesthetic

---

## RESOURCES

### 1. Mineral Patch
**File:** `/public/models/resources/minerals.glb`

**Dimensions:** 1.5m × 2m cluster

**Description:** Blue crystal formation for mineral harvesting.

**AI Prompt:**
```
Blue crystal mineral formation, sci-fi resource crystals,
cluster of angular crystalline structures, glowing blue,
alien mineral deposit, translucent crystal material,
varying heights in cluster, game-ready low poly,
PBR materials with emission, white background
```

**Key Features:**
- Multiple crystal spires
- Blue translucent material
- Glowing/emissive effect
- Natural cluster arrangement

---

### 2. Vespene Geyser
**File:** `/public/models/resources/vespene.glb`

**Dimensions:** 3m × 3m footprint, 1.5m tall (without plume)

**Description:** Green gas geyser vent for vespene extraction.

**AI Prompt:**
```
Alien gas geyser vent, green glowing gas emission,
rocky crater formation, steam/gas plume effect,
industrial extraction point, volcanic vent aesthetic,
green glow effects, game-ready low poly,
PBR materials with emission, white background
```

**Key Features:**
- Rocky base/crater
- Green gas emission (could be particle effect)
- Glowing vent
- Natural formation look

---

## PROJECTILES

### 1. Bullet Trail
**File:** `/public/models/projectiles/bullet.glb`

**Dimensions:** 0.1m diameter

**Description:** Small yellow tracer round.

**AI Prompt:**
```
Simple bullet tracer, small glowing projectile,
yellow-orange hot round, simple elongated shape,
glowing emission material, game-ready low poly
```

---

### 2. Missile
**File:** `/public/models/projectiles/missile.glb`

**Dimensions:** 0.15m × 0.5m

**Description:** Guided missile with exhaust trail.

**AI Prompt:**
```
Small guided missile projectile, rocket with fins,
orange exhaust flame, sleek missile body,
military munition design, game-ready low poly
```

---

### 3. Laser Beam
**File:** `/public/models/projectiles/laser.glb`

**Dimensions:** 0.05m × 1m (cylinder)

**Description:** Red energy beam.

**AI Prompt:**
```
Red laser beam, energy projectile, glowing cylinder,
sci-fi weapon beam, bright red emission,
simple elongated shape, game-ready low poly
```

---

## MAP DECORATIONS

### 1. Xel'Naga Watch Tower
**File:** `/public/models/decorations/xelnaga_tower.glb`

**Dimensions:** 2m × 2m footprint, 7m tall

**Description:** Ancient alien watch tower that grants vision when a unit stands nearby. Iconic Xel'Naga design with glowing energy core.

**AI Prompt:**
```
Ancient alien Xel'Naga watch tower, tall ornate pillar structure,
golden-bronze metallic surface with intricate alien engravings,
glowing blue energy orb beacon at the top, crystalline elements,
mysterious protoss-style architecture, triangular geometric patterns,
hovering energy rings around the beacon, ancient artifact aesthetic,
weathered but advanced technology, game-ready low poly,
PBR materials with emissive glow, white background
```

**Key Features:**
- Tall ornate pillar (7m tall)
- Glowing blue energy beacon at top (emissive)
- Golden-bronze ancient metal material
- Alien geometric engravings
- Floating/hovering energy elements

---

### 2. Destructible Rocks (Large)
**File:** `/public/models/decorations/rocks_large.glb`

**Dimensions:** 4m × 4m cluster, 2m tall

**Description:** Large rock formation that blocks paths until destroyed.

**AI Prompt:**
```
Large destructible boulder formation, massive rocky barrier,
three to five large angular rocks clustered together,
dark gray volcanic stone with brown earth tones,
jagged broken edges, moss patches, cracked surfaces,
natural geological formation, imposing rock wall,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- 3-5 clustered boulders
- Dark gray/brown volcanic stone
- Cracked and weathered surfaces
- Blocks unit pathing

---

### 3. Destructible Rocks (Small)
**File:** `/public/models/decorations/rocks_small.glb`

**Dimensions:** 2m × 2m cluster, 1m tall

**Description:** Smaller rock formation for secondary paths.

**AI Prompt:**
```
Small destructible rock cluster, scattered boulder pile,
two to three medium rocks with several smaller stones,
gray-brown natural stone, mossy patches,
easily breakable appearance, pathway obstacle,
game-ready low poly, PBR materials, white background
```

---

### 4. Decorative Rock (Single)
**File:** `/public/models/decorations/rock_single.glb`

**Dimensions:** 1m × 1m, 0.5-1m tall

**Description:** Single decorative boulder for terrain detail.

**AI Prompt:**
```
Single decorative boulder, natural rock formation,
rounded weathered stone, gray-brown granite texture,
mossy patches on top, partially buried in ground,
terrain decoration element, game-ready low poly,
PBR materials, white background
```

---

## TREES

### 5. Pine Tree (Tall)
**File:** `/public/models/decorations/tree_pine_tall.glb`

**Dimensions:** 1m × 1m footprint, 5-6m tall

**Description:** Tall coniferous tree for forest areas and map edges.

**AI Prompt:**
```
Tall pine tree, sci-fi alien conifer evergreen,
triangular layered foliage in dark green-blue tones,
thin brown bark trunk, straight vertical growth,
slightly stylized alien vegetation, forest tree,
game-ready low poly, PBR materials, white background
```

**Key Features:**
- Tall triangular silhouette (5-6m)
- Layered branch tiers
- Dark green-blue foliage
- Straight trunk

---

### 6. Pine Tree (Medium)
**File:** `/public/models/decorations/tree_pine_medium.glb`

**Dimensions:** 0.8m × 0.8m footprint, 3-4m tall

**Description:** Medium pine tree for varied forest density.

**AI Prompt:**
```
Medium pine tree, stylized alien evergreen,
compact triangular shape, dense dark green foliage,
visible branch structure, brown textured bark,
decorative forest element, game-ready low poly,
PBR materials, white background
```

---

### 7. Dead Tree
**File:** `/public/models/decorations/tree_dead.glb`

**Dimensions:** 1m × 1m footprint, 3-4m tall

**Description:** Leafless dead tree for wasteland and corrupted areas.

**AI Prompt:**
```
Dead leafless tree, twisted barren branches,
gnarled gray-brown trunk, no foliage,
broken branch stumps, weathered bark texture,
haunting wasteland vegetation, slightly bent,
game-ready low poly, PBR materials, white background
```

---

### 8. Alien Tree (Bioluminescent)
**File:** `/public/models/decorations/tree_alien.glb`

**Dimensions:** 1.5m × 1.5m footprint, 4-5m tall

**Description:** Strange alien tree with glowing elements for exotic biomes.

**AI Prompt:**
```
Alien bioluminescent tree, strange organic growth,
twisted purple-blue trunk, glowing cyan leaf pods,
alien flora aesthetic, organic bulbous shapes,
luminescent fruit or flowers, otherworldly vegetation,
game-ready low poly, PBR materials with emission,
white background
```

**Key Features:**
- Purple-blue organic trunk
- Glowing cyan elements (emissive)
- Alien/otherworldly design
- Bioluminescent pods

---

### 9. Palm Tree
**File:** `/public/models/decorations/tree_palm.glb`

**Dimensions:** 1m × 1m footprint, 4-5m tall

**Description:** Tropical palm tree for beach and jungle biomes.

**AI Prompt:**
```
Tropical palm tree, curved brown trunk,
large fan-shaped green fronds at top,
sci-fi alien tropical vegetation, beach aesthetic,
slightly swaying appearance, coconut-like fruit,
game-ready low poly, PBR materials, white background
```

---

### 10. Mushroom Tree (Giant)
**File:** `/public/models/decorations/tree_mushroom.glb`

**Dimensions:** 2m × 2m footprint, 3-4m tall

**Description:** Giant alien mushroom for fungal/swamp biomes.

**AI Prompt:**
```
Giant alien mushroom, massive fungal growth,
wide spotted cap in purple-red colors,
thick pale stalk, bioluminescent spots on cap,
alien fungal forest element, organic textures,
game-ready low poly, PBR materials with emission,
white background
```

---

### 11. Crystal Formation
**File:** `/public/models/decorations/crystal_formation.glb`

**Dimensions:** 1m × 1m footprint, 1-2m tall

**Description:** Decorative crystal cluster (non-harvestable) for terrain detail.

**AI Prompt:**
```
Decorative crystal formation, small crystal cluster,
purple-pink translucent crystals, angular faceted shapes,
natural crystal growth pattern, glowing internal light,
terrain decoration element, alien mineral aesthetic,
game-ready low poly, PBR materials with emission,
white background
```

---

### 12. Bush/Shrub
**File:** `/public/models/decorations/bush.glb`

**Dimensions:** 0.5m × 0.5m footprint, 0.5m tall

**Description:** Small decorative bush for ground cover.

**AI Prompt:**
```
Small decorative bush, compact round shrub,
dense dark green foliage, slightly alien appearance,
ground cover vegetation, no visible trunk,
terrain filler decoration, game-ready low poly,
PBR materials, white background
```

---

### 13. Grass Clump
**File:** `/public/models/decorations/grass_clump.glb`

**Dimensions:** 0.3m × 0.3m footprint, 0.3m tall

**Description:** Decorative grass tuft for terrain detail.

**AI Prompt:**
```
Grass tuft decoration, tall grass clump,
multiple blade shapes, green-yellow coloring,
swaying appearance, ground detail element,
terrain grass decoration, game-ready low poly,
PBR materials, white background
```

---

### 14. Debris Pile
**File:** `/public/models/decorations/debris.glb`

**Dimensions:** 2m × 2m footprint, 0.5m tall

**Description:** Scattered mechanical debris for battlefield/industrial areas.

**AI Prompt:**
```
Mechanical debris pile, scattered metal wreckage,
broken machinery parts, damaged vehicle components,
rusty metal scraps, destroyed equipment aesthetic,
battlefield decoration, industrial waste,
game-ready low poly, PBR materials, white background
```

---

### 15. Crashed Escape Pod
**File:** `/public/models/decorations/escape_pod.glb`

**Dimensions:** 2m × 2m footprint, 1.5m tall

**Description:** Crashed/abandoned escape pod for story elements.

**AI Prompt:**
```
Crashed escape pod, damaged spacecraft capsule,
scorched entry burns, broken hatch door,
emergency beacon light (optional glow),
abandoned sci-fi wreckage, impact crater detail,
game-ready low poly, PBR materials, white background
```

---

### 16. Ruined Wall Section
**File:** `/public/models/decorations/ruined_wall.glb`

**Dimensions:** 3m × 1m footprint, 2m tall

**Description:** Destroyed building wall section for urban/ruined areas.

**AI Prompt:**
```
Ruined building wall section, destroyed concrete wall,
broken and crumbling edges, exposed rebar/metal,
blast damage marks, partially standing structure,
post-apocalyptic urban debris, war-torn aesthetic,
game-ready low poly, PBR materials, white background
```

---

## Loading Models in Code

```typescript
import { AssetManager } from '@/assets/AssetManager';

// During game initialization
async function loadCustomModels() {
  // Units
  await AssetManager.loadGLTF('/models/units/marine.glb', 'marine');
  await AssetManager.loadGLTF('/models/units/scv.glb', 'scv');

  // Buildings
  await AssetManager.loadGLTF('/models/buildings/command_center.glb', 'command_center');

  // Resources
  await AssetManager.loadGLTF('/models/resources/minerals.glb', 'minerals');
}
```

The AssetManager will automatically use custom models when available, falling back to procedural generation if not found.

---

## Checklist

### Units (13 total)
- [x] SCV *(optimized: 204KB)*
- [ ] Marine
- [ ] Marauder
- [ ] Reaper
- [ ] Ghost
- [ ] Hellion
- [ ] Siege Tank
- [ ] Thor
- [ ] Medivac
- [ ] Viking
- [ ] Banshee
- [ ] Battlecruiser
- [ ] Raven

### Buildings (15 total)
- [ ] Command Center
- [ ] Orbital Command *(CC upgrade)*
- [ ] Planetary Fortress *(CC upgrade)*
- [ ] Supply Depot
- [ ] Refinery
- [ ] Barracks
- [ ] Engineering Bay
- [ ] Bunker
- [ ] Factory
- [ ] Armory
- [ ] Starport
- [ ] Fusion Core
- [ ] Ghost Academy
- [ ] Sensor Tower
- [ ] Missile Turret
- [ ] Tech Lab *(addon)*
- [ ] Reactor *(addon)*

### Resources (2 total)
- [ ] Mineral Patch
- [ ] Vespene Geyser

### Projectiles (3 total)
- [ ] Bullet
- [ ] Missile
- [ ] Laser

### Decorations (16 total)
- [ ] Xel'Naga Watch Tower
- [ ] Destructible Rocks (Large)
- [ ] Destructible Rocks (Small)
- [ ] Decorative Rock (Single)
- [ ] Pine Tree (Tall)
- [ ] Pine Tree (Medium)
- [ ] Dead Tree
- [ ] Alien Tree (Bioluminescent)
- [ ] Palm Tree
- [ ] Mushroom Tree (Giant)
- [ ] Crystal Formation
- [ ] Bush/Shrub
- [ ] Grass Clump
- [ ] Debris Pile
- [ ] Crashed Escape Pod
- [ ] Ruined Wall Section
