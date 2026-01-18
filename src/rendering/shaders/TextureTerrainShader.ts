import * as THREE from 'three';
import { debugShaders } from '@/utils/debugLogger';
import {
  TextureTerrainConfig,
  BiomeTextureType,
  getBiomeTextureConfig,
  getDefaultTextureConfig,
  getBiomeTextureFiles,
  hasBiomeTextures,
  registerBiomeTextures,
} from '../textureConfig';

// Re-export types from shared config
export type { TextureTerrainConfig, BiomeTextureType };
export {
  getBiomeTextureConfig,
  getDefaultTextureConfig,
  getBiomeTextureFiles,
  hasBiomeTextures,
  registerBiomeTextures,
};

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
    // Tile textures 64x across terrain - much smaller texture detail
    // This ensures leaves/pebbles are appropriately sized relative to buildings
    vUv = uv * 64.0;
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

    // Calculate distance from camera for parallax falloff
    float cameraDist = length(cameraPosition - vWorldPosition);
    // Parallax fades out between 20-60 units from camera
    float parallaxFade = 1.0 - smoothstep(20.0, 60.0, cameraDist);

    // Apply parallax offset to UVs if displacement is enabled
    vec2 uv = vUv;
    if (uUseDisplacement && parallaxFade > 0.01) {
      // Sample average height to determine offset
      float avgHeight = (
        texture2D(uGrassDisplacement, vUv).r +
        texture2D(uDirtDisplacement, vUv).r +
        texture2D(uRockDisplacement, vUv).r
      ) / 3.0;
      // Scale down effect and apply distance fade
      float effectiveScale = uParallaxScale * parallaxFade * 0.5;
      vec2 p = viewDirTangent.xy / max(viewDirTangent.z, 0.5) * (avgHeight * effectiveScale);
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
    // Scale by 4.0 for appropriately-sized cliff textures (smaller than ground)
    vec2 uvX = vWorldPosition.zy * 4.0;
    vec2 uvY = vWorldPosition.xz * 4.0;
    vec2 uvZ = vWorldPosition.xy * 4.0;
    if (uUseDisplacement && parallaxFade > 0.01) {
      float cliffHeight = texture2D(uCliffDisplacement, uvY).r;
      float effectiveScale = uParallaxScale * parallaxFade * 0.5;
      vec2 offset = viewDirTangent.xy / max(viewDirTangent.z, 0.5) * (cliffHeight * effectiveScale);
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

    // Calculate blend weights based on slope, elevation, and terrain type
    float colorBrightness = (vColor.r + vColor.g + vColor.b) / 3.0;
    float colorSaturation = max(max(vColor.r, vColor.g), vColor.b) - min(min(vColor.r, vColor.g), vColor.b);

    // Terrain type detection: cliffs tend to be more neutral (R≈G≈B)
    // Use chromatic intensity (saturation relative to brightness)
    float chromaticIntensity = colorSaturation / max(colorBrightness, 0.01);
    float isCliffTerrain = smoothstep(0.4, 0.15, chromaticIntensity);
    float isGroundTerrain = 1.0 - isCliffTerrain;

    // Base weights from slope - ALL 4 textures should appear
    float slopeGrassWeight = smoothstep(0.25, 0.1, vSlope);       // Grass on flat areas
    float slopeDirtWeight = smoothstep(0.08, 0.2, vSlope) * smoothstep(0.35, 0.2, vSlope); // Dirt on slight slopes
    float slopeRockWeight = smoothstep(0.2, 0.35, vSlope) * smoothstep(0.55, 0.4, vSlope); // Rock on medium slopes
    float slopeCliffWeight = smoothstep(0.4, 0.55, vSlope);       // Cliff on steep slopes

    // Add elevation-based variation (higher areas get more rock/cliff)
    float elevationFactor = smoothstep(1.5, 4.5, vElevation);
    slopeRockWeight += elevationFactor * 0.2;
    slopeCliffWeight += elevationFactor * 0.15;

    // Combine slope-based weights with terrain type hints
    float grassWeight = slopeGrassWeight * isGroundTerrain;
    float dirtWeight = slopeDirtWeight + (1.0 - isGroundTerrain) * 0.15; // Dirt near cliffs
    float rockWeight = slopeRockWeight + isCliffTerrain * 0.35;
    float cliffWeight = slopeCliffWeight + isCliffTerrain * 0.5;

    // Position-based variation for natural look (prevents uniform textures)
    float noiseX = fract(sin(vWorldPosition.x * 12.9898 + vWorldPosition.z * 78.233) * 43758.5453);
    float noiseZ = fract(sin(vWorldPosition.z * 12.9898 + vWorldPosition.x * 78.233) * 43758.5453);
    grassWeight *= mix(0.85, 1.15, noiseX);
    dirtWeight *= mix(0.8, 1.2, noiseZ);
    rockWeight *= mix(0.9, 1.1, fract(noiseX + noiseZ));

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

    // Note: No tone mapping or gamma correction here - OutputPass handles that
    // uniformly for the entire scene to avoid double correction

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

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
  debugShaders.log('[TextureTerrainShader] Loading textures...');

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
  debugShaders.log('[TextureTerrainShader] Material created with PBR lighting' + (features.length ? ' + ' + features.join(' + ') : ''));
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
