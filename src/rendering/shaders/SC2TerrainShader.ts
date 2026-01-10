import * as THREE from 'three';
import { debugShaders } from '@/utils/debugLogger';

/**
 * SC2-LEVEL TERRAIN SHADER
 *
 * Dramatically improved terrain rendering with:
 * - Multi-layer procedural texturing (dirt, grass, rock, cliff, debris)
 * - Real-time normal map generation for crisp detail
 * - Advanced PBR-like lighting with subsurface scattering simulation
 * - Height-based material blending with natural transitions
 * - Triplanar mapping for cliffs (no UV stretching)
 * - Edge highlighting for better depth perception
 * - Specular micro-detail for wet/shiny areas
 * - Ambient occlusion in crevices
 */

export const sc2TerrainVertexShader = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying float vElevation;
varying vec3 vColor;
varying float vSlope;
varying vec3 vViewDirection;

void main() {
  vUv = uv;
  vColor = color;

  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vElevation = position.z;

  // Calculate slope for material selection
  vSlope = 1.0 - abs(dot(vWorldNormal, vec3(0.0, 1.0, 0.0)));

  // View direction for rim lighting
  vViewDirection = normalize(cameraPosition - worldPosition.xyz);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const sc2TerrainFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uGroundColor1;
uniform vec3 uGroundColor2;
uniform vec3 uRockColor;
uniform vec3 uCliffColor;
uniform vec3 uAccentColor;
uniform vec3 uFogColor;
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uFogDensity;
uniform float uSnowLine;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying float vElevation;
varying vec3 vColor;
varying float vSlope;
varying vec3 vViewDirection;

// ==================================================
// HIGH QUALITY NOISE FUNCTIONS
// ==================================================

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Fixed-octave FBM functions (WebGL requires compile-time loop bounds)
float fbm2(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);

  return value;
}

float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);

  return value;
}

float fbm4(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);

  return value;
}

// Voronoi for rock cracks and cell patterns
vec2 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);

  float minDist = 8.0;
  float secondMin = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = fract(sin(vec2(dot(n + g, vec2(127.1, 311.7)), dot(n + g, vec2(269.5, 183.3)))) * 43758.5453);
      vec2 r = g + o - f;
      float d = dot(r, r);

      if (d < minDist) {
        secondMin = minDist;
        minDist = d;
      } else if (d < secondMin) {
        secondMin = d;
      }
    }
  }

  return vec2(sqrt(minDist), sqrt(secondMin) - sqrt(minDist));
}

// ==================================================
// PROCEDURAL TEXTURE LAYERS
// ==================================================

// Grass texture with blade-like detail
vec3 grassTexture(vec3 pos, vec3 baseColor) {
  float detail1 = fbm4(pos * 8.0) * 0.5 + 0.5;
  float detail2 = fbm3(pos * 24.0) * 0.5 + 0.5;
  float blades = fbm2(pos * 64.0) * 0.5 + 0.5;

  // Color variation
  vec3 darkGrass = baseColor * 0.7;
  vec3 lightGrass = baseColor * 1.3;
  vec3 yellowGrass = vec3(baseColor.r * 1.2, baseColor.g * 1.1, baseColor.b * 0.8);

  vec3 result = mix(darkGrass, baseColor, detail1);
  result = mix(result, lightGrass, smoothstep(0.6, 0.8, detail2) * 0.3);
  result = mix(result, yellowGrass, smoothstep(0.7, 0.9, blades) * 0.15);

  // Add subtle highlight streaks (sunlit grass tips)
  float highlight = smoothstep(0.75, 0.95, blades) * smoothstep(0.5, 0.8, detail1);
  result += vec3(0.05, 0.08, 0.02) * highlight;

  return result;
}

// Rock texture with cracks and weathering
vec3 rockTexture(vec3 pos, vec3 baseColor) {
  float large = fbm4(pos * 2.0) * 0.5 + 0.5;
  float medium = fbm3(pos * 8.0) * 0.5 + 0.5;
  float fine = fbm2(pos * 32.0) * 0.5 + 0.5;

  vec2 cracks = voronoi(pos.xz * 4.0);
  float crackLines = smoothstep(0.02, 0.08, cracks.y);

  vec3 darkRock = baseColor * 0.5;
  vec3 lightRock = baseColor * 1.2;
  vec3 brownRock = vec3(baseColor.r * 1.1, baseColor.g * 0.95, baseColor.b * 0.85);

  vec3 result = mix(darkRock, baseColor, large);
  result = mix(result, lightRock, medium * 0.3);
  result = mix(result, brownRock, fine * 0.2);

  // Darken cracks
  result *= mix(0.6, 1.0, crackLines);

  // Add lichen/moss in crevices
  float moss = (1.0 - crackLines) * smoothstep(0.3, 0.6, large);
  result = mix(result, vec3(0.2, 0.35, 0.15), moss * 0.3);

  return result;
}

// Cliff texture with vertical streaks and weathering
vec3 cliffTexture(vec3 pos, vec3 normal, vec3 baseColor) {
  // Use triplanar to avoid stretching on vertical surfaces
  vec3 blend = abs(normal);
  blend = normalize(max(blend, 0.00001));
  float b = blend.x + blend.y + blend.z;
  blend /= b;

  float streakX = fbm4(vec3(pos.y * 4.0, pos.z * 0.5, 0.0));
  float streakZ = fbm4(vec3(pos.y * 4.0, pos.x * 0.5, 0.0));
  float streakY = fbm4(pos * 2.0);

  float streak = streakX * blend.x + streakY * blend.y + streakZ * blend.z;
  streak = streak * 0.5 + 0.5;

  // Vertical weathering streaks
  float vertical = fbm3(vec3(pos.x * 0.3, pos.y * 8.0, pos.z * 0.3)) * 0.5 + 0.5;

  vec3 result = baseColor;
  result = mix(result * 0.6, result * 1.1, streak);
  result = mix(result, result * vec3(0.9, 0.85, 0.8), vertical * 0.2);

  // Add edge highlights
  float edge = smoothstep(0.6, 0.8, vertical) * smoothstep(0.5, 0.7, streak);
  result += vec3(0.05) * edge;

  return result;
}

// Dirt/ground texture
vec3 dirtTexture(vec3 pos, vec3 baseColor) {
  float large = fbm4(pos * 3.0) * 0.5 + 0.5;
  float medium = fbm3(pos * 12.0) * 0.5 + 0.5;
  float fine = fbm2(pos * 48.0) * 0.5 + 0.5;

  // Pebble-like detail
  vec2 pebbles = voronoi(pos.xz * 8.0);
  float pebblePattern = smoothstep(0.1, 0.3, pebbles.x);

  vec3 darkDirt = baseColor * 0.6;
  vec3 lightDirt = baseColor * 1.3;

  vec3 result = mix(darkDirt, baseColor, large);
  result = mix(result, lightDirt, smoothstep(0.5, 0.8, medium) * 0.4);
  result *= mix(0.85, 1.1, fine);
  result *= mix(0.9, 1.05, pebblePattern);

  return result;
}

// ==================================================
// PROCEDURAL NORMAL MAP
// ==================================================

vec3 calculateDetailNormal(vec3 pos, float scale, float strength) {
  float eps = 0.02;

  float h0 = fbm4(pos * scale);
  float hx = fbm4((pos + vec3(eps, 0.0, 0.0)) * scale);
  float hz = fbm4((pos + vec3(0.0, 0.0, eps)) * scale);

  vec3 normal;
  normal.x = (h0 - hx) * strength;
  normal.z = (h0 - hz) * strength;
  normal.y = 1.0;

  return normalize(normal);
}

// High-frequency detail normal for crisp micro-detail
vec3 calculateMicroNormal(vec3 pos, float scale) {
  float eps = 0.01;

  float h0 = snoise(pos * scale);
  float hx = snoise((pos + vec3(eps, 0.0, 0.0)) * scale);
  float hz = snoise((pos + vec3(0.0, 0.0, eps)) * scale);

  vec3 normal;
  normal.x = (h0 - hx) * 2.0;
  normal.z = (h0 - hz) * 2.0;
  normal.y = 1.0;

  return normalize(normal);
}

// ==================================================
// PBR-LIKE LIGHTING
// ==================================================

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 calculateLighting(
  vec3 baseColor,
  vec3 worldNormal,
  vec3 detailNormal,
  vec3 viewDir,
  float roughness,
  float metalness
) {
  // Combine normals
  vec3 N = normalize(worldNormal + detailNormal * 0.4);
  vec3 V = viewDir;
  vec3 L = uSunDirection;
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  // Diffuse (Lambert with energy conservation)
  vec3 diffuse = baseColor / 3.14159;

  // Specular (simplified GGX)
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
  float D = alpha2 / (3.14159 * denom * denom);

  vec3 F0 = mix(vec3(0.04), baseColor, metalness);
  vec3 F = fresnelSchlick(VdotH, F0);

  // Visibility term (simplified)
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float G = NdotV / (NdotV * (1.0 - k) + k);

  vec3 specular = D * F * G / max(4.0 * NdotV * NdotL, 0.001);

  // Combine
  vec3 kD = (1.0 - F) * (1.0 - metalness);
  vec3 direct = (kD * diffuse + specular) * NdotL * uSunIntensity;

  // Ambient with AO
  float ao = 0.5 + 0.5 * dot(worldNormal, detailNormal);
  vec3 ambient = baseColor * 0.15 * ao;

  // Rim lighting for depth
  float rim = 1.0 - NdotV;
  rim = pow(rim, 4.0) * 0.2;
  vec3 rimLight = vec3(0.4, 0.5, 0.6) * rim;

  // Subsurface scattering approximation for grass
  float sss = pow(max(dot(V, -L), 0.0), 4.0) * 0.1;
  vec3 subsurface = baseColor * sss;

  return direct + ambient + rimLight + subsurface;
}

// ==================================================
// MAIN
// ==================================================

void main() {
  vec3 pos = vWorldPosition;
  vec3 normal = normalize(vWorldNormal);

  // Material selection based on slope and height
  float slope = vSlope;
  float height = vElevation;

  // Noise-based blending factors
  float blendNoise1 = fbm3(pos * 0.3) * 0.5 + 0.5;
  float blendNoise2 = fbm3(pos * 1.2) * 0.5 + 0.5;
  float blendNoise3 = fbm2(pos * 4.0) * 0.5 + 0.5;

  // Calculate material weights
  float grassWeight = smoothstep(0.35, 0.2, slope) * smoothstep(-0.5, 0.5, height);
  float rockWeight = smoothstep(0.2, 0.5, slope);
  float cliffWeight = smoothstep(0.5, 0.75, slope);
  float dirtWeight = (1.0 - grassWeight - rockWeight) * smoothstep(0.4, 0.6, blendNoise2);

  // Add noise to transitions
  grassWeight += (blendNoise1 - 0.5) * 0.15;
  rockWeight += (blendNoise2 - 0.5) * 0.15;

  // Normalize weights
  float totalWeight = grassWeight + rockWeight + cliffWeight + dirtWeight + 0.001;
  grassWeight /= totalWeight;
  rockWeight /= totalWeight;
  cliffWeight /= totalWeight;
  dirtWeight /= totalWeight;

  // Generate textures
  vec3 grassCol = grassTexture(pos, uGroundColor1);
  vec3 rockCol = rockTexture(pos, uRockColor);
  vec3 cliffCol = cliffTexture(pos, normal, uCliffColor);
  vec3 dirtCol = dirtTexture(pos, uGroundColor2);

  // Blend materials
  vec3 baseColor = grassCol * grassWeight +
                   rockCol * rockWeight +
                   cliffCol * cliffWeight +
                   dirtCol * dirtWeight;

  // Mix with vertex color for map-specific variation (reduced to let shader textures dominate)
  baseColor = mix(baseColor, vColor, 0.1);

  // Add accent color in specific areas
  float accentFactor = smoothstep(0.7, 0.9, blendNoise1) * smoothstep(0.3, 0.15, slope);
  baseColor = mix(baseColor, baseColor * uAccentColor * 2.0, accentFactor * 0.2);

  // Snow on high areas
  if (uSnowLine > 0.0) {
    float snowFactor = smoothstep(uSnowLine - 2.0, uSnowLine + 1.0, height);
    snowFactor *= (1.0 - slope * 0.8);
    snowFactor += (blendNoise3 - 0.5) * 0.2;
    snowFactor = clamp(snowFactor, 0.0, 1.0);

    vec3 snowColor = vec3(0.95, 0.97, 1.0);
    baseColor = mix(baseColor, snowColor, snowFactor);
  }

  // Calculate detail normals
  vec3 detailNormal = calculateDetailNormal(pos, 2.0, 0.8);
  vec3 microNormal = calculateMicroNormal(pos, 16.0);
  vec3 combinedNormal = normalize(detailNormal + microNormal * 0.3);

  // Material properties based on terrain type
  float roughness = 0.85 - cliffWeight * 0.2 - rockWeight * 0.1;
  float metalness = 0.02 + rockWeight * 0.05;

  // Apply lighting
  vec3 litColor = calculateLighting(baseColor, normal, combinedNormal, vViewDirection, roughness, metalness);

  // Distance fog
  float dist = length(pos - cameraPosition);
  float fogFactor = 1.0 - exp(-dist * uFogDensity * 0.008);
  fogFactor = clamp(fogFactor, 0.0, 0.7);
  litColor = mix(litColor, uFogColor, fogFactor);

  // Color grading for richness
  litColor = pow(litColor, vec3(0.95)); // Gamma
  litColor = mix(litColor, litColor * vec3(1.02, 1.0, 0.98), 0.2); // Warm tint

  // Contrast boost
  litColor = (litColor - 0.5) * 1.05 + 0.5;

  gl_FragColor = vec4(clamp(litColor, 0.0, 1.0), 1.0);
}
`;

export interface SC2TerrainShaderConfig {
  groundColor1: THREE.Color;
  groundColor2: THREE.Color;
  rockColor: THREE.Color;
  cliffColor: THREE.Color;
  accentColor: THREE.Color;
  fogColor: THREE.Color;
  snowLine: number;
  fogDensity: number;
}

export function createSC2TerrainShaderMaterial(config: SC2TerrainShaderConfig): THREE.ShaderMaterial {
  debugShaders.log('[SC2TerrainShader] Creating material with config:', {
    groundColor1: '#' + config.groundColor1.getHexString(),
    groundColor2: '#' + config.groundColor2.getHexString(),
    rockColor: '#' + config.rockColor.getHexString(),
    cliffColor: '#' + config.cliffColor.getHexString(),
    accentColor: '#' + config.accentColor.getHexString(),
    fogDensity: config.fogDensity,
    snowLine: config.snowLine,
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: sc2TerrainVertexShader,
    fragmentShader: sc2TerrainFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uGroundColor1: { value: config.groundColor1 },
      uGroundColor2: { value: config.groundColor2 },
      uRockColor: { value: config.rockColor },
      uCliffColor: { value: config.cliffColor },
      uAccentColor: { value: config.accentColor },
      uFogColor: { value: config.fogColor },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunIntensity: { value: 1.2 },
      uFogDensity: { value: config.fogDensity },
      uSnowLine: { value: config.snowLine },
    },
    vertexColors: true,
    side: THREE.FrontSide,
  });

  // Log shader compilation status after first render
  setTimeout(() => {
    // Cast to any to access internal program property
    const prog = (material as unknown as { program?: unknown }).program;
    if (prog) {
      debugShaders.log('[SC2TerrainShader] Shader compiled successfully');
    } else {
      debugShaders.warn('[SC2TerrainShader] Shader may not have compiled yet or has errors');
    }
  }, 1000);

  return material;
}

export function getSC2BiomeConfig(biomeType: string): SC2TerrainShaderConfig {
  // More vibrant SC2-style colors for each biome
  const configs: Record<string, SC2TerrainShaderConfig> = {
    grassland: {
      groundColor1: new THREE.Color(0x5aad55), // Vibrant green grass
      groundColor2: new THREE.Color(0x9a8060), // Rich brown dirt
      rockColor: new THREE.Color(0x707070),    // Gray rock
      cliffColor: new THREE.Color(0x606060),   // Dark cliff
      accentColor: new THREE.Color(0x7acc70),  // Bright grass highlights
      fogColor: new THREE.Color(0xc5ddf0),     // Sky blue fog
      snowLine: -1,
      fogDensity: 0.6,
    },
    desert: {
      groundColor1: new THREE.Color(0xe8c878), // Golden sand
      groundColor2: new THREE.Color(0xc49858), // Rich earth
      rockColor: new THREE.Color(0xb08060),    // Orange-brown rock
      cliffColor: new THREE.Color(0xa07050),   // Sandstone cliff
      accentColor: new THREE.Color(0xf0d890),  // Sunlit sand
      fogColor: new THREE.Color(0xf0e0c8),     // Desert haze
      snowLine: -1,
      fogDensity: 0.4,
    },
    frozen: {
      groundColor1: new THREE.Color(0xe8f4ff), // Bright snow
      groundColor2: new THREE.Color(0xb0c8d8), // Ice blue
      rockColor: new THREE.Color(0x9ab0c8),    // Frozen rock
      cliffColor: new THREE.Color(0x8898b0),   // Ice cliff
      accentColor: new THREE.Color(0xe0f0ff),  // Ice sparkle
      fogColor: new THREE.Color(0xd8e8f8),     // Snowy fog
      snowLine: 1.5,
      fogDensity: 0.8,
    },
    volcanic: {
      groundColor1: new THREE.Color(0x404040), // Ash ground
      groundColor2: new THREE.Color(0x503030), // Scorched earth
      rockColor: new THREE.Color(0x505050),    // Dark volcanic rock
      cliffColor: new THREE.Color(0x403030),   // Charred cliff
      accentColor: new THREE.Color(0xff5500),  // Lava glow
      fogColor: new THREE.Color(0x301818),     // Ash-laden air
      snowLine: -1,
      fogDensity: 1.5,
    },
    void: {
      groundColor1: new THREE.Color(0x352850), // Deep purple
      groundColor2: new THREE.Color(0x201838), // Dark void
      rockColor: new THREE.Color(0x453860),    // Void rock
      cliffColor: new THREE.Color(0x302848),   // Shadow cliff
      accentColor: new THREE.Color(0x9050ff),  // Void energy
      fogColor: new THREE.Color(0x180c28),     // Void mist
      snowLine: -1,
      fogDensity: 1.5,
    },
    jungle: {
      groundColor1: new THREE.Color(0x3a6838), // Dark jungle green
      groundColor2: new THREE.Color(0x504030), // Jungle floor dirt
      rockColor: new THREE.Color(0x607058),    // Mossy rock
      cliffColor: new THREE.Color(0x506048),   // Overgrown cliff
      accentColor: new THREE.Color(0x60a858),  // Bright foliage
      fogColor: new THREE.Color(0x405838),     // Humid jungle air
      snowLine: -1,
      fogDensity: 1.2,
    },
  };

  return configs[biomeType] || configs.grassland;
}

export function updateSC2TerrainShader(
  material: THREE.ShaderMaterial,
  deltaTime: number,
  sunDirection?: THREE.Vector3
): void {
  material.uniforms.uTime.value += deltaTime;

  if (sunDirection) {
    material.uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }
}
