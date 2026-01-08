import * as THREE from 'three';

/**
 * Texture-based terrain shader - HIGH PERFORMANCE
 * Uses texture lookups instead of procedural noise (100x faster)
 *
 * Required textures (place in /public/textures/terrain/):
 * - grass_diffuse.jpg
 * - grass_normal.jpg
 * - dirt_diffuse.jpg
 * - dirt_normal.jpg
 * - rock_diffuse.jpg
 * - rock_normal.jpg
 * - cliff_diffuse.jpg
 * - cliff_normal.jpg
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
  uniform sampler2D uDirtTexture;
  uniform sampler2D uDirtNormal;
  uniform sampler2D uRockTexture;
  uniform sampler2D uRockNormal;
  uniform sampler2D uCliffTexture;
  uniform sampler2D uCliffNormal;

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

  // Blend normals using Reoriented Normal Mapping
  vec3 blendNormals(vec3 n1, vec3 n2) {
    n1 += vec3(0.0, 0.0, 1.0);
    n2 *= vec3(-1.0, -1.0, 1.0);
    return normalize(n1 * dot(n1, n2) - n2 * n1.z);
  }

  // Unpack normal from texture
  vec3 unpackNormal(vec4 texel) {
    return texel.xyz * 2.0 - 1.0;
  }

  void main() {
    // Sample all textures
    vec3 grassColor = texture2D(uGrassTexture, vUv).rgb;
    vec3 grassNorm = unpackNormal(texture2D(uGrassNormal, vUv));

    vec3 dirtColor = texture2D(uDirtTexture, vUv).rgb;
    vec3 dirtNorm = unpackNormal(texture2D(uDirtNormal, vUv));

    vec3 rockColor = texture2D(uRockTexture, vUv).rgb;
    vec3 rockNorm = unpackNormal(texture2D(uRockNormal, vUv));

    // Triplanar for cliffs to avoid stretching
    vec3 blendWeights = abs(vWorldNormal);
    blendWeights = pow(blendWeights, vec3(4.0));
    blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);

    vec2 uvX = vWorldPosition.zy * 0.5;
    vec2 uvY = vWorldPosition.xz * 0.5;
    vec2 uvZ = vWorldPosition.xy * 0.5;

    vec3 cliffColorX = texture2D(uCliffTexture, uvX).rgb;
    vec3 cliffColorY = texture2D(uCliffTexture, uvY).rgb;
    vec3 cliffColorZ = texture2D(uCliffTexture, uvZ).rgb;
    vec3 cliffColor = cliffColorX * blendWeights.x + cliffColorY * blendWeights.y + cliffColorZ * blendWeights.z;

    vec3 cliffNormX = unpackNormal(texture2D(uCliffNormal, uvX));
    vec3 cliffNormY = unpackNormal(texture2D(uCliffNormal, uvY));
    vec3 cliffNormZ = unpackNormal(texture2D(uCliffNormal, uvZ));
    vec3 cliffNorm = normalize(cliffNormX * blendWeights.x + cliffNormY * blendWeights.y + cliffNormZ * blendWeights.z);

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

    // Construct TBN matrix for normal mapping
    vec3 N = normalize(vWorldNormal);
    vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 B = cross(N, T);
    mat3 TBN = mat3(T, B, N);

    vec3 worldNormal = normalize(TBN * detailNormal);

    // Simple but effective lighting
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(worldNormal, L), 0.0);

    // Diffuse lighting
    vec3 diffuse = albedo * NdotL * uSunIntensity;

    // Ambient with slight AO from normal
    float ao = 0.5 + 0.5 * dot(N, worldNormal);
    vec3 ambient = albedo * uAmbientColor * ao;

    // Slight rim lighting for depth
    vec3 V = normalize(cameraPosition - vWorldPosition);
    float rim = 1.0 - max(dot(worldNormal, V), 0.0);
    rim = pow(rim, 3.0) * 0.15;

    vec3 finalColor = diffuse + ambient + vec3(rim);

    // Subtle color grading
    finalColor = pow(finalColor, vec3(0.95)); // Slight gamma
    finalColor = mix(finalColor, finalColor * vec3(1.02, 1.0, 0.98), 0.3); // Warm tint

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export interface TextureTerrainConfig {
  grassTexture: string;
  grassNormal: string;
  dirtTexture: string;
  dirtNormal: string;
  rockTexture: string;
  rockNormal: string;
  cliffTexture: string;
  cliffNormal: string;
  sunDirection?: THREE.Vector3;
  sunIntensity?: number;
  ambientColor?: THREE.Color;
}

const textureLoader = new THREE.TextureLoader();

function loadTexture(path: string): THREE.Texture {
  const texture = textureLoader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4; // Better quality at angles
  return texture;
}

export function createTextureTerrainMaterial(config: TextureTerrainConfig): THREE.ShaderMaterial {
  console.log('[TextureTerrainShader] Loading textures...');

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uGrassTexture: { value: loadTexture(config.grassTexture) },
      uGrassNormal: { value: loadTexture(config.grassNormal) },
      uDirtTexture: { value: loadTexture(config.dirtTexture) },
      uDirtNormal: { value: loadTexture(config.dirtNormal) },
      uRockTexture: { value: loadTexture(config.rockTexture) },
      uRockNormal: { value: loadTexture(config.rockNormal) },
      uCliffTexture: { value: loadTexture(config.cliffTexture) },
      uCliffNormal: { value: loadTexture(config.cliffNormal) },
      uSunDirection: { value: config.sunDirection ?? new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunIntensity: { value: config.sunIntensity ?? 1.2 },
      uAmbientColor: { value: config.ambientColor ?? new THREE.Color(0.3, 0.35, 0.4) },
      uTime: { value: 0 },
    },
    vertexShader: textureTerrainVertexShader,
    fragmentShader: textureTerrainFragmentShader,
    vertexColors: true,
  });

  console.log('[TextureTerrainShader] Material created successfully');
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

// Default texture paths for easy setup
export function getDefaultTextureConfig(): TextureTerrainConfig {
  const basePath = '/textures/terrain/';
  return {
    grassTexture: `${basePath}grass_diffuse.jpg`,
    grassNormal: `${basePath}grass_normal.jpg`,
    dirtTexture: `${basePath}dirt_diffuse.jpg`,
    dirtNormal: `${basePath}dirt_normal.jpg`,
    rockTexture: `${basePath}rock_diffuse.jpg`,
    rockNormal: `${basePath}rock_normal.jpg`,
    cliffTexture: `${basePath}cliff_diffuse.jpg`,
    cliffNormal: `${basePath}cliff_normal.jpg`,
  };
}
