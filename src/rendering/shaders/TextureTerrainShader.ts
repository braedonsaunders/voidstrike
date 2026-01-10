import * as THREE from 'three';

/**
 * Texture-based terrain shader - HIGH PERFORMANCE with PBR
 * Uses texture lookups instead of procedural noise (100x faster)
 *
 * Required textures (place in /public/textures/terrain/):
 * - grass_diffuse.png (albedo)
 * - grass_normal.png
 * - grass_roughness.png (optional - defaults to 0.8)
 * - grass_displacement.png (optional - for parallax depth)
 * - dirt_diffuse.png, dirt_normal.png, dirt_roughness.png, dirt_displacement.png
 * - rock_diffuse.png, rock_normal.png, rock_roughness.png, rock_displacement.png
 * - cliff_diffuse.png, cliff_normal.png, cliff_roughness.png, cliff_displacement.png
 *
 * From Polycam AI:
 * - albedo → *_diffuse.png
 * - normal → *_normal.png
 * - roughness → *_roughness.png
 * - displacement/height → *_displacement.png
 */

export const textureTerrainVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSlope;
  varying float vElevation;
  varying vec3 vColor;

  void main() {
    vUv = uv * 8.0; // Tile textures 8x across terrain
    vColor = color;

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    // Transform normal to world space
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

    // Calculate slope (0 = flat, 1 = vertical)
    vSlope = 1.0 - abs(dot(vWorldNormal, vec3(0.0, 1.0, 0.0)));

    // Pass elevation for material blending
    vElevation = position.z;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const textureTerrainFragmentShader = /* glsl */ `
  uniform sampler2D uGrassTexture;
  uniform sampler2D uGrassNormal;
  uniform sampler2D uGrassRoughness;
  uniform sampler2D uGrassDisplacement;
  uniform sampler2D uDirtTexture;
  uniform sampler2D uDirtNormal;
  uniform sampler2D uDirtRoughness;
  uniform sampler2D uDirtDisplacement;
  uniform sampler2D uRockTexture;
  uniform sampler2D uRockNormal;
  uniform sampler2D uRockRoughness;
  uniform sampler2D uRockDisplacement;
  uniform sampler2D uCliffTexture;
  uniform sampler2D uCliffNormal;
  uniform sampler2D uCliffRoughness;
  uniform sampler2D uCliffDisplacement;

  uniform bool uUseRoughness;
  uniform bool uUseDisplacement;
  uniform float uParallaxScale;
  uniform vec3 uSunDirection;
  uniform float uSunIntensity;
  uniform vec3 uAmbientColor;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vSlope;
  varying float vElevation;
  varying vec3 vColor;

  // Unpack normal from texture
  vec3 unpackNormal(vec4 texel) {
    return texel.xyz * 2.0 - 1.0;
  }

  // GGX/Trowbridge-Reitz NDF
  float D_GGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH2 = NdotH * NdotH;
    float denom = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (3.14159 * denom * denom);
  }

  // Fresnel-Schlick
  vec3 F_Schlick(float VdotH, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
  }

  // Geometry function (Smith GGX)
  float G_Smith(float NdotV, float NdotL, float roughness) {
    float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    float ggx1 = NdotV / (NdotV * (1.0 - k) + k);
    float ggx2 = NdotL / (NdotL * (1.0 - k) + k);
    return ggx1 * ggx2;
  }

  // Parallax Occlusion Mapping - offset UV based on view angle and height
  vec2 parallaxMapping(vec2 uv, vec3 viewDir, sampler2D heightMap, float scale) {
    // Simple parallax with offset limiting (steep parallax is expensive)
    float height = texture2D(heightMap, uv).r;
    vec2 p = viewDir.xy / viewDir.z * (height * scale);
    return uv - p;
  }

  // Blend displacement heights for multi-texture terrain
  float blendedHeight(vec2 uv, float gW, float dW, float rW, float cW, vec3 blendWeights, vec2 uvX, vec2 uvY, vec2 uvZ) {
    float grassH = texture2D(uGrassDisplacement, uv).r * gW;
    float dirtH = texture2D(uDirtDisplacement, uv).r * dW;
    float rockH = texture2D(uRockDisplacement, uv).r * rW;

    // Triplanar for cliff displacement
    float cliffHX = texture2D(uCliffDisplacement, uvX).r;
    float cliffHY = texture2D(uCliffDisplacement, uvY).r;
    float cliffHZ = texture2D(uCliffDisplacement, uvZ).r;
    float cliffH = (cliffHX * blendWeights.x + cliffHY * blendWeights.y + cliffHZ * blendWeights.z) * cW;

    return grassH + dirtH + rockH + cliffH;
  }

  void main() {
    // Calculate view direction in tangent space for parallax
    vec3 V = normalize(cameraPosition - vWorldPosition);
    vec3 N = normalize(vWorldNormal);
    vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 B = cross(N, T);
    mat3 TBN = mat3(T, B, N);
    vec3 viewDirTangent = normalize(transpose(TBN) * V);

    // Apply parallax offset to UVs if displacement is enabled
    vec2 uv = vUv;
    if (uUseDisplacement) {
      // Sample average height to determine offset
      float avgHeight = (
        texture2D(uGrassDisplacement, vUv).r +
        texture2D(uDirtDisplacement, vUv).r +
        texture2D(uRockDisplacement, vUv).r
      ) / 3.0;
      vec2 p = viewDirTangent.xy / max(viewDirTangent.z, 0.1) * (avgHeight * uParallaxScale);
      uv = vUv - p;
    }

    // Sample all textures with parallax-adjusted UVs
    vec3 grassColor = texture2D(uGrassTexture, uv).rgb;
    vec3 grassNorm = unpackNormal(texture2D(uGrassNormal, uv));
    float grassRough = uUseRoughness ? texture2D(uGrassRoughness, uv).r : 0.85;

    vec3 dirtColor = texture2D(uDirtTexture, uv).rgb;
    vec3 dirtNorm = unpackNormal(texture2D(uDirtNormal, uv));
    float dirtRough = uUseRoughness ? texture2D(uDirtRoughness, uv).r : 0.9;

    vec3 rockColor = texture2D(uRockTexture, uv).rgb;
    vec3 rockNorm = unpackNormal(texture2D(uRockNormal, uv));
    float rockRough = uUseRoughness ? texture2D(uRockRoughness, uv).r : 0.7;

    // Triplanar for cliffs to avoid stretching
    vec3 blendWeights = abs(vWorldNormal);
    blendWeights = pow(blendWeights, vec3(4.0));
    blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);

    // Apply parallax offset to triplanar UVs as well
    vec2 uvX = vWorldPosition.zy * 0.5;
    vec2 uvY = vWorldPosition.xz * 0.5;
    vec2 uvZ = vWorldPosition.xy * 0.5;
    if (uUseDisplacement) {
      float cliffHeight = texture2D(uCliffDisplacement, uvY).r;
      vec2 offset = viewDirTangent.xy / max(viewDirTangent.z, 0.1) * (cliffHeight * uParallaxScale);
      uvX -= offset;
      uvY -= offset;
      uvZ -= offset;
    }

    vec3 cliffColorX = texture2D(uCliffTexture, uvX).rgb;
    vec3 cliffColorY = texture2D(uCliffTexture, uvY).rgb;
    vec3 cliffColorZ = texture2D(uCliffTexture, uvZ).rgb;
    vec3 cliffColor = cliffColorX * blendWeights.x + cliffColorY * blendWeights.y + cliffColorZ * blendWeights.z;

    vec3 cliffNormX = unpackNormal(texture2D(uCliffNormal, uvX));
    vec3 cliffNormY = unpackNormal(texture2D(uCliffNormal, uvY));
    vec3 cliffNormZ = unpackNormal(texture2D(uCliffNormal, uvZ));
    vec3 cliffNorm = normalize(cliffNormX * blendWeights.x + cliffNormY * blendWeights.y + cliffNormZ * blendWeights.z);

    float cliffRoughX = uUseRoughness ? texture2D(uCliffRoughness, uvX).r : 0.75;
    float cliffRoughY = uUseRoughness ? texture2D(uCliffRoughness, uvY).r : 0.75;
    float cliffRoughZ = uUseRoughness ? texture2D(uCliffRoughness, uvZ).r : 0.75;
    float cliffRough = cliffRoughX * blendWeights.x + cliffRoughY * blendWeights.y + cliffRoughZ * blendWeights.z;

    // Calculate blend weights based on slope and height
    float grassWeight = smoothstep(0.3, 0.15, vSlope) * smoothstep(-1.0, 1.0, vElevation);
    float rockWeight = smoothstep(0.15, 0.4, vSlope) * (1.0 - smoothstep(0.5, 0.7, vSlope));
    float cliffWeight = smoothstep(0.5, 0.7, vSlope);
    float dirtWeight = (1.0 - grassWeight) * (1.0 - rockWeight) * (1.0 - cliffWeight);

    // Add some variation using vertex color (from geometry)
    float variation = (vColor.r + vColor.g + vColor.b) / 3.0;
    grassWeight *= mix(0.8, 1.2, variation);
    dirtWeight *= mix(0.7, 1.3, 1.0 - variation);

    // Normalize weights
    float totalWeight = grassWeight + dirtWeight + rockWeight + cliffWeight;
    grassWeight /= totalWeight;
    dirtWeight /= totalWeight;
    rockWeight /= totalWeight;
    cliffWeight /= totalWeight;

    // Blend colors
    vec3 albedo = grassColor * grassWeight +
                  dirtColor * dirtWeight +
                  rockColor * rockWeight +
                  cliffColor * cliffWeight;

    // Blend normals
    vec3 detailNormal = grassNorm * grassWeight +
                        dirtNorm * dirtWeight +
                        rockNorm * rockWeight +
                        cliffNorm * cliffWeight;
    detailNormal = normalize(detailNormal);

    // Blend roughness
    float roughness = grassRough * grassWeight +
                      dirtRough * dirtWeight +
                      rockRough * rockWeight +
                      cliffRough * cliffWeight;

    // Apply detail normal using TBN matrix (already computed for parallax)
    vec3 worldNormal = normalize(TBN * detailNormal);

    // PBR Lighting (V already computed for parallax)
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(L + V);

    float NdotL = max(dot(worldNormal, L), 0.0);
    float NdotV = max(dot(worldNormal, V), 0.001);
    float NdotH = max(dot(worldNormal, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);

    // Diffuse
    vec3 diffuse = albedo * NdotL * uSunIntensity;

    // Specular (PBR)
    vec3 F0 = vec3(0.04); // Non-metallic
    float D = D_GGX(NdotH, roughness);
    vec3 F = F_Schlick(VdotH, F0);
    float G = G_Smith(NdotV, NdotL, roughness);

    vec3 specular = (D * F * G) / max(4.0 * NdotV * NdotL, 0.001);
    specular *= NdotL * uSunIntensity;

    // Ambient with AO from normal agreement
    float ao = 0.5 + 0.5 * dot(N, worldNormal);
    vec3 ambient = albedo * uAmbientColor * ao;

    // Rim lighting for depth
    float rim = 1.0 - NdotV;
    rim = pow(rim, 3.0) * 0.12;

    vec3 finalColor = diffuse + specular + ambient + vec3(rim);

    // Tone mapping (simple Reinhard)
    finalColor = finalColor / (finalColor + vec3(1.0));

    // Gamma correction
    finalColor = pow(finalColor, vec3(1.0 / 2.2));

    // Subtle warm tint
    finalColor = mix(finalColor, finalColor * vec3(1.02, 1.0, 0.98), 0.2);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export interface TextureTerrainConfig {
  grassTexture: string;
  grassNormal: string;
  grassRoughness?: string;
  grassDisplacement?: string;
  dirtTexture: string;
  dirtNormal: string;
  dirtRoughness?: string;
  dirtDisplacement?: string;
  rockTexture: string;
  rockNormal: string;
  rockRoughness?: string;
  rockDisplacement?: string;
  cliffTexture: string;
  cliffNormal: string;
  cliffRoughness?: string;
  cliffDisplacement?: string;
  parallaxScale?: number; // Default 0.05, higher = more depth
  sunDirection?: THREE.Vector3;
  sunIntensity?: number;
  ambientColor?: THREE.Color;
}

const textureLoader = new THREE.TextureLoader();

// Create a 1x1 white texture as fallback for missing roughness maps
function createDefaultRoughnessTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#cccccc'; // 0.8 roughness
  ctx.fillRect(0, 0, 1, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Create a 1x1 gray texture as fallback for missing displacement maps
function createDefaultDisplacementTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080'; // 0.5 = neutral height (no displacement)
  ctx.fillRect(0, 0, 1, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function loadTexture(path: string): THREE.Texture {
  const texture = textureLoader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4; // Better quality at angles
  return texture;
}

function loadTextureOrDefault(path: string | undefined, defaultTexture: THREE.Texture): THREE.Texture {
  if (!path) return defaultTexture;
  return loadTexture(path);
}

export function createTextureTerrainMaterial(config: TextureTerrainConfig): THREE.ShaderMaterial {
  console.log('[TextureTerrainShader] Loading textures...');

  const defaultRoughness = createDefaultRoughnessTexture();
  const defaultDisplacement = createDefaultDisplacementTexture();
  const hasRoughness = !!(config.grassRoughness || config.dirtRoughness || config.rockRoughness || config.cliffRoughness);
  const hasDisplacement = !!(config.grassDisplacement || config.dirtDisplacement || config.rockDisplacement || config.cliffDisplacement);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uGrassTexture: { value: loadTexture(config.grassTexture) },
      uGrassNormal: { value: loadTexture(config.grassNormal) },
      uGrassRoughness: { value: loadTextureOrDefault(config.grassRoughness, defaultRoughness) },
      uGrassDisplacement: { value: loadTextureOrDefault(config.grassDisplacement, defaultDisplacement) },
      uDirtTexture: { value: loadTexture(config.dirtTexture) },
      uDirtNormal: { value: loadTexture(config.dirtNormal) },
      uDirtRoughness: { value: loadTextureOrDefault(config.dirtRoughness, defaultRoughness) },
      uDirtDisplacement: { value: loadTextureOrDefault(config.dirtDisplacement, defaultDisplacement) },
      uRockTexture: { value: loadTexture(config.rockTexture) },
      uRockNormal: { value: loadTexture(config.rockNormal) },
      uRockRoughness: { value: loadTextureOrDefault(config.rockRoughness, defaultRoughness) },
      uRockDisplacement: { value: loadTextureOrDefault(config.rockDisplacement, defaultDisplacement) },
      uCliffTexture: { value: loadTexture(config.cliffTexture) },
      uCliffNormal: { value: loadTexture(config.cliffNormal) },
      uCliffRoughness: { value: loadTextureOrDefault(config.cliffRoughness, defaultRoughness) },
      uCliffDisplacement: { value: loadTextureOrDefault(config.cliffDisplacement, defaultDisplacement) },
      uUseRoughness: { value: hasRoughness },
      uUseDisplacement: { value: hasDisplacement },
      uParallaxScale: { value: config.parallaxScale ?? 0.05 },
      uSunDirection: { value: config.sunDirection ?? new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunIntensity: { value: config.sunIntensity ?? 1.2 },
      uAmbientColor: { value: config.ambientColor ?? new THREE.Color(0.3, 0.35, 0.4) },
      uTime: { value: 0 },
    },
    vertexShader: textureTerrainVertexShader,
    fragmentShader: textureTerrainFragmentShader,
    vertexColors: true,
  });

  const features = [];
  if (hasRoughness) features.push('roughness maps');
  if (hasDisplacement) features.push('parallax displacement');
  console.log('[TextureTerrainShader] Material created with PBR lighting' + (features.length ? ' + ' + features.join(' + ') : ''));
  return material;
}

export function updateTextureTerrainShader(
  material: THREE.ShaderMaterial,
  deltaTime: number,
  sunDirection?: THREE.Vector3
): void {
  material.uniforms.uTime.value += deltaTime;

  if (sunDirection) {
    material.uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }
}

// Default texture paths for easy setup (grassland biome)
export function getDefaultTextureConfig(): TextureTerrainConfig {
  return getBiomeTextureConfig('grassland');
}

// Biome-specific texture configurations
// Falls back to grassland textures if biome textures don't exist
export type BiomeTextureType = 'grassland' | 'desert' | 'frozen' | 'volcanic' | 'void' | 'jungle';

interface BiomeTextureMapping {
  ground: string;  // Flat buildable areas (grass, sand, snow, etc.)
  dirt: string;    // Paths, trampled areas
  rock: string;    // Rocky terrain, slopes
  cliff: string;   // Steep cliffs, walls
}

// Maps biome types to their texture prefixes
const BIOME_TEXTURE_PREFIXES: Record<BiomeTextureType, BiomeTextureMapping> = {
  grassland: {
    ground: 'grass',
    dirt: 'dirt',
    rock: 'rock',
    cliff: 'cliff',
  },
  desert: {
    ground: 'sand',
    dirt: 'desert_dirt',
    rock: 'sandstone',
    cliff: 'desert_cliff',
  },
  frozen: {
    ground: 'snow',
    dirt: 'permafrost',
    rock: 'ice_rock',
    cliff: 'ice_cliff',
  },
  volcanic: {
    ground: 'ash',
    dirt: 'scorched',
    rock: 'basalt',
    cliff: 'volcanic_cliff',
  },
  void: {
    ground: 'void_ground',
    dirt: 'void_dirt',
    rock: 'void_rock',
    cliff: 'void_cliff',
  },
  jungle: {
    ground: 'jungle_floor',
    dirt: 'mud',
    rock: 'mossy_rock',
    cliff: 'jungle_cliff',
  },
};

// All biome textures are now available
const AVAILABLE_BIOME_TEXTURES: Set<BiomeTextureType> = new Set([
  'grassland',
  'desert',
  'frozen',
  'volcanic',
  'void',
  'jungle',
]);

/**
 * Register a biome's textures as available.
 * Call this after confirming the texture files exist.
 */
export function registerBiomeTextures(biome: BiomeTextureType): void {
  AVAILABLE_BIOME_TEXTURES.add(biome);
}

/**
 * Check if a biome has its textures available.
 */
export function hasBiomeTextures(biome: BiomeTextureType): boolean {
  return AVAILABLE_BIOME_TEXTURES.has(biome);
}

/**
 * Get texture configuration for a specific biome.
 * Falls back to grassland if biome textures aren't available.
 */
export function getBiomeTextureConfig(biome: BiomeTextureType): TextureTerrainConfig {
  const basePath = '/textures/terrain/';

  // Use grassland as fallback if biome textures don't exist
  const effectiveBiome = AVAILABLE_BIOME_TEXTURES.has(biome) ? biome : 'grassland';
  const prefixes = BIOME_TEXTURE_PREFIXES[effectiveBiome];

  return {
    grassTexture: `${basePath}${prefixes.ground}_diffuse.png`,
    grassNormal: `${basePath}${prefixes.ground}_normal.png`,
    grassRoughness: `${basePath}${prefixes.ground}_roughness.png`,
    grassDisplacement: `${basePath}${prefixes.ground}_displacement.png`,
    dirtTexture: `${basePath}${prefixes.dirt}_diffuse.png`,
    dirtNormal: `${basePath}${prefixes.dirt}_normal.png`,
    dirtRoughness: `${basePath}${prefixes.dirt}_roughness.png`,
    dirtDisplacement: `${basePath}${prefixes.dirt}_displacement.png`,
    rockTexture: `${basePath}${prefixes.rock}_diffuse.png`,
    rockNormal: `${basePath}${prefixes.rock}_normal.png`,
    rockRoughness: `${basePath}${prefixes.rock}_roughness.png`,
    rockDisplacement: `${basePath}${prefixes.rock}_displacement.png`,
    cliffTexture: `${basePath}${prefixes.cliff}_diffuse.png`,
    cliffNormal: `${basePath}${prefixes.cliff}_normal.png`,
    cliffRoughness: `${basePath}${prefixes.cliff}_roughness.png`,
    cliffDisplacement: `${basePath}${prefixes.cliff}_displacement.png`,
    parallaxScale: 0.12, // Increased for more visible texture depth
  };
}

/**
 * Get the list of texture files needed for a biome.
 * Useful for preloading or checking availability.
 */
export function getBiomeTextureFiles(biome: BiomeTextureType): string[] {
  const basePath = '/textures/terrain/';
  const prefixes = BIOME_TEXTURE_PREFIXES[biome];
  const types = ['diffuse', 'normal', 'roughness', 'displacement'];
  const files: string[] = [];

  for (const material of [prefixes.ground, prefixes.dirt, prefixes.rock, prefixes.cliff]) {
    for (const type of types) {
      files.push(`${basePath}${material}_${type}.png`);
    }
  }

  return files;
}
