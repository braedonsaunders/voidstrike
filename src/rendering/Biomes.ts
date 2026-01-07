import * as THREE from 'three';

export type BiomeType = 'grassland' | 'desert' | 'frozen' | 'volcanic' | 'void' | 'jungle';

export interface BiomeColors {
  ground: THREE.Color[];      // Multiple ground colors for variation
  cliff: THREE.Color[];       // Cliff/unwalkable colors
  ramp: THREE.Color[];        // Ramp colors
  accent: THREE.Color[];      // Detail accent colors
  water: THREE.Color;         // Water/liquid color
  fog: THREE.Color;           // Fog color
  ambient: THREE.Color;       // Ambient light color
  sun: THREE.Color;           // Sun light color
  sky: THREE.Color;           // Skybox color
}

export interface BiomeConfig {
  name: string;
  colors: BiomeColors;
  grassDensity: number;       // 0-1, grass blades per unit
  treeDensity: number;        // 0-1, trees per area
  rockDensity: number;        // 0-1, rocks per area
  crystalDensity: number;     // 0-1, crystals per area
  hasWater: boolean;          // Whether to render water bodies
  waterLevel: number;         // Height of water surface
  particleType: 'none' | 'dust' | 'snow' | 'ash' | 'spores';
  groundRoughness: number;    // Material roughness
  groundMetalness: number;    // Material metalness
}

export const BIOMES: Record<BiomeType, BiomeConfig> = {
  grassland: {
    name: 'Grassland',
    colors: {
      ground: [
        new THREE.Color(0x3a6b35), // Base grass
        new THREE.Color(0x4a8b45), // Light grass
        new THREE.Color(0x2d5a28), // Dark grass
        new THREE.Color(0x5a9a55), // Highlight
        new THREE.Color(0x456b3a), // Mid tone
      ],
      cliff: [
        new THREE.Color(0x5a5a5a),
        new THREE.Color(0x6a6a6a),
        new THREE.Color(0x4a4a4a),
      ],
      ramp: [
        new THREE.Color(0x8b7355),
        new THREE.Color(0x7a6245),
        new THREE.Color(0x9b8365),
      ],
      accent: [
        new THREE.Color(0x6aaa60), // Bright grass
        new THREE.Color(0x3a5530), // Shadow
        new THREE.Color(0x7bc070), // Yellow-green
      ],
      water: new THREE.Color(0x3080c0),
      fog: new THREE.Color(0xc0d8e8),
      ambient: new THREE.Color(0x404860),
      sun: new THREE.Color(0xfff8e0),
      sky: new THREE.Color(0x87ceeb),
    },
    grassDensity: 0.8,
    treeDensity: 0.4,
    rockDensity: 0.3,
    crystalDensity: 0,
    hasWater: true,
    waterLevel: -0.5,
    particleType: 'none',
    groundRoughness: 0.85,
    groundMetalness: 0.02,
  },

  desert: {
    name: 'Desert',
    colors: {
      ground: [
        new THREE.Color(0xc4a35a), // Base sand
        new THREE.Color(0xd4b36a), // Light sand
        new THREE.Color(0xb4934a), // Dark sand
        new THREE.Color(0xe4c37a), // Highlight
        new THREE.Color(0xa48340), // Shadow
      ],
      cliff: [
        new THREE.Color(0x8b6b4a),
        new THREE.Color(0x9b7b5a),
        new THREE.Color(0x7b5b3a),
      ],
      ramp: [
        new THREE.Color(0xb09060),
        new THREE.Color(0xa08050),
        new THREE.Color(0xc0a070),
      ],
      accent: [
        new THREE.Color(0xd4c080),
        new THREE.Color(0xa08040),
        new THREE.Color(0xe8d090),
      ],
      water: new THREE.Color(0x80c0a0), // Oasis green
      fog: new THREE.Color(0xe8d8c0),
      ambient: new THREE.Color(0x806040),
      sun: new THREE.Color(0xfff0c0),
      sky: new THREE.Color(0xd0c8b0),
    },
    grassDensity: 0.05,
    treeDensity: 0.02, // Cacti only
    rockDensity: 0.4,
    crystalDensity: 0.1,
    hasWater: false, // Rare oasis only
    waterLevel: -1,
    particleType: 'dust',
    groundRoughness: 0.95,
    groundMetalness: 0.0,
  },

  frozen: {
    name: 'Frozen Wastes',
    colors: {
      ground: [
        new THREE.Color(0xc8d8e8), // Base snow
        new THREE.Color(0xe0f0ff), // Fresh snow
        new THREE.Color(0xa0b8c8), // Packed snow
        new THREE.Color(0xd8e8f8), // Light
        new THREE.Color(0x8898a8), // Ice shadow
      ],
      cliff: [
        new THREE.Color(0x7888a0),
        new THREE.Color(0x8898b0),
        new THREE.Color(0x687890),
      ],
      ramp: [
        new THREE.Color(0xa0b0c0),
        new THREE.Color(0x90a0b0),
        new THREE.Color(0xb0c0d0),
      ],
      accent: [
        new THREE.Color(0xd0e8ff), // Ice blue
        new THREE.Color(0x90a8c0), // Deep ice
        new THREE.Color(0xf0f8ff), // Bright snow
      ],
      water: new THREE.Color(0x4080a0), // Frozen water
      fog: new THREE.Color(0xd0e0f0),
      ambient: new THREE.Color(0x6080a0),
      sun: new THREE.Color(0xf0f8ff),
      sky: new THREE.Color(0xa0c0e0),
    },
    grassDensity: 0,
    treeDensity: 0.15, // Sparse dead trees
    rockDensity: 0.2,
    crystalDensity: 0.3, // Ice crystals
    hasWater: true, // Frozen lakes
    waterLevel: 0.2,
    particleType: 'snow',
    groundRoughness: 0.3, // Icy smooth
    groundMetalness: 0.1,
  },

  volcanic: {
    name: 'Volcanic',
    colors: {
      ground: [
        new THREE.Color(0x2a2a2a), // Base ash
        new THREE.Color(0x3a3a3a), // Light ash
        new THREE.Color(0x1a1a1a), // Dark ash
        new THREE.Color(0x4a4040), // Reddish ash
        new THREE.Color(0x202020), // Charred
      ],
      cliff: [
        new THREE.Color(0x3a3030),
        new THREE.Color(0x4a4040),
        new THREE.Color(0x2a2020),
      ],
      ramp: [
        new THREE.Color(0x4a4040),
        new THREE.Color(0x3a3030),
        new THREE.Color(0x5a5050),
      ],
      accent: [
        new THREE.Color(0xff6020), // Lava glow
        new THREE.Color(0xff8040), // Hot spot
        new THREE.Color(0x804020), // Cooled lava
      ],
      water: new THREE.Color(0xff4010), // Lava
      fog: new THREE.Color(0x402020),
      ambient: new THREE.Color(0x804040),
      sun: new THREE.Color(0xffc080),
      sky: new THREE.Color(0x301010),
    },
    grassDensity: 0,
    treeDensity: 0.05, // Charred stumps
    rockDensity: 0.5,
    crystalDensity: 0.05,
    hasWater: true, // Lava rivers
    waterLevel: -0.3,
    particleType: 'ash',
    groundRoughness: 0.9,
    groundMetalness: 0.1,
  },

  void: {
    name: 'Void',
    colors: {
      ground: [
        new THREE.Color(0x1a1030), // Deep purple
        new THREE.Color(0x2a2040), // Light purple
        new THREE.Color(0x100820), // Dark void
        new THREE.Color(0x3a3050), // Highlight
        new THREE.Color(0x201028), // Mid
      ],
      cliff: [
        new THREE.Color(0x2a2040),
        new THREE.Color(0x3a3050),
        new THREE.Color(0x1a1030),
      ],
      ramp: [
        new THREE.Color(0x302848),
        new THREE.Color(0x201838),
        new THREE.Color(0x403858),
      ],
      accent: [
        new THREE.Color(0x8040ff), // Void energy
        new THREE.Color(0x6020c0), // Dark energy
        new THREE.Color(0xa060ff), // Bright energy
      ],
      water: new THREE.Color(0x4020a0), // Void energy pools
      fog: new THREE.Color(0x100820),
      ambient: new THREE.Color(0x402080),
      sun: new THREE.Color(0xc0a0ff),
      sky: new THREE.Color(0x080010),
    },
    grassDensity: 0,
    treeDensity: 0,
    rockDensity: 0.3,
    crystalDensity: 0.6, // Many crystals
    hasWater: true, // Energy pools
    waterLevel: 0,
    particleType: 'spores',
    groundRoughness: 0.6,
    groundMetalness: 0.3,
  },

  jungle: {
    name: 'Jungle',
    colors: {
      ground: [
        new THREE.Color(0x2a4a25), // Dark jungle floor
        new THREE.Color(0x3a5a35), // Moss
        new THREE.Color(0x1a3a15), // Deep shadow
        new THREE.Color(0x4a6a45), // Light patch
        new THREE.Color(0x2a3a20), // Mud
      ],
      cliff: [
        new THREE.Color(0x4a5a4a),
        new THREE.Color(0x5a6a5a),
        new THREE.Color(0x3a4a3a),
      ],
      ramp: [
        new THREE.Color(0x5a4a3a),
        new THREE.Color(0x4a3a2a),
        new THREE.Color(0x6a5a4a),
      ],
      accent: [
        new THREE.Color(0x5a8a50), // Bright moss
        new THREE.Color(0x3a5a30), // Dark foliage
        new THREE.Color(0x7aaa70), // Sunlit
      ],
      water: new THREE.Color(0x406050), // Murky water
      fog: new THREE.Color(0x405040),
      ambient: new THREE.Color(0x405040),
      sun: new THREE.Color(0xf0e0c0),
      sky: new THREE.Color(0x506050),
    },
    grassDensity: 0.9,
    treeDensity: 0.7,
    rockDensity: 0.2,
    crystalDensity: 0.05,
    hasWater: true,
    waterLevel: 0.1,
    particleType: 'spores',
    groundRoughness: 0.8,
    groundMetalness: 0.0,
  },
};

export function getBiome(type: BiomeType): BiomeConfig {
  return BIOMES[type];
}

// Get shader configuration for a biome
export interface BiomeShaderConfig {
  groundColor: THREE.Color;
  rockColor: THREE.Color;
  accentColor: THREE.Color;
  snowLine: number;
  fogDensity: number;
  fogColor: THREE.Color;
}

export function getBiomeShaderConfig(biome: BiomeConfig): BiomeShaderConfig {
  // Calculate average ground color
  const groundColor = biome.colors.ground[0].clone();
  for (let i = 1; i < Math.min(3, biome.colors.ground.length); i++) {
    groundColor.lerp(biome.colors.ground[i], 0.3);
  }

  // Calculate average rock/cliff color
  const rockColor = biome.colors.cliff[0].clone();
  if (biome.colors.cliff.length > 1) {
    rockColor.lerp(biome.colors.cliff[1], 0.3);
  }

  // Get accent color
  const accentColor = biome.colors.accent[0].clone();

  // Snow line based on biome
  let snowLine = -1; // Disabled by default
  if (biome.name === 'Frozen Wastes') {
    snowLine = 3.0; // Snow above elevation 3
  }

  // Fog density based on biome
  let fogDensity = 0.8;
  if (biome.name === 'Jungle') fogDensity = 1.5;
  if (biome.name === 'Desert') fogDensity = 0.5;
  if (biome.name === 'Void') fogDensity = 2.0;
  if (biome.name === 'Volcanic') fogDensity = 1.8;

  return {
    groundColor,
    rockColor,
    accentColor,
    snowLine,
    fogDensity,
    fogColor: biome.colors.fog.clone(),
  };
}

export function getRandomGroundColor(biome: BiomeConfig, x: number, y: number): THREE.Color {
  const colors = biome.colors.ground;
  const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  const t = noise - Math.floor(noise);
  const index = Math.floor(t * colors.length);
  return colors[index % colors.length].clone();
}

export function blendBiomeColors(
  biome: BiomeConfig,
  x: number,
  y: number,
  terrainType: 'ground' | 'cliff' | 'ramp'
): THREE.Color {
  const colors = terrainType === 'ground' ? biome.colors.ground :
                 terrainType === 'cliff' ? biome.colors.cliff :
                 biome.colors.ramp;

  // Multi-octave noise for natural blending
  const noise1 = Math.sin(x * 0.5 + y * 0.3) * 0.5 + 0.5;
  const noise2 = Math.sin(x * 1.7 + y * 2.1) * 0.5 + 0.5;
  const noise3 = Math.sin(x * 0.1 + y * 0.15) * 0.5 + 0.5;

  const blend = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2);
  const index1 = Math.floor(blend * colors.length) % colors.length;
  const index2 = (index1 + 1) % colors.length;
  const t = (blend * colors.length) % 1;

  const result = colors[index1].clone();
  result.lerp(colors[index2], t);

  // Add subtle accent
  if (Math.random() < 0.1) {
    const accentIndex = Math.floor(Math.random() * biome.colors.accent.length);
    result.lerp(biome.colors.accent[accentIndex], 0.2);
  }

  return result;
}
