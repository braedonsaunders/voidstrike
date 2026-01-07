import * as THREE from 'three';

/**
 * Modern procedural terrain shader with:
 * - Multi-octave noise for realistic detail
 * - Procedural normal maps for surface micro-detail
 * - Height and slope-based material blending
 * - Triplanar mapping for cliffs (no UV stretching)
 * - Atmospheric distance fog
 * - Ambient occlusion hints
 */

// Vertex shader - passes data to fragment shader
export const terrainVertexShader = /* glsl */ `
precision highp float;
precision highp int;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying float vElevation;
varying vec3 vColor;

void main() {
  vUv = uv;
  vColor = color;

  // Calculate world position and normal
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  // Pass elevation (z in local space before rotation)
  vElevation = position.z;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

// Fragment shader - creates the visual appearance
export const terrainFragmentShader = /* glsl */ `
precision highp float;
precision highp int;

uniform float uTime;
uniform vec3 uBiomeGroundColor;
uniform vec3 uBiomeRockColor;
uniform vec3 uBiomeAccentColor;
uniform float uBiomeSnowLine;
uniform float uBiomeFogDensity;
uniform vec3 uFogColor;
uniform vec3 uSunDirection;
uniform float uSunIntensity;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;
varying float vElevation;
varying vec3 vColor;

// ============================================
// NOISE FUNCTIONS (Simplex-like)
// ============================================

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// 3D Simplex noise
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

// Fractal Brownian Motion (multi-octave noise)
// Using fixed octave versions for better GPU compatibility
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

float fbm5(vec3 p) {
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
  amplitude *= 0.5; frequency *= 2.0;
  value += amplitude * snoise(p * frequency);

  return value;
}

// ============================================
// PROCEDURAL NORMAL MAP
// ============================================

vec3 calculateProceduralNormal(vec3 worldPos, float scale, float strength) {
  float eps = 0.05;

  float h0 = fbm4(worldPos * scale);
  float hx = fbm4((worldPos + vec3(eps, 0.0, 0.0)) * scale);
  float hz = fbm4((worldPos + vec3(0.0, 0.0, eps)) * scale);

  vec3 normal;
  normal.x = (h0 - hx) * strength;
  normal.z = (h0 - hz) * strength;
  normal.y = 1.0;

  return normalize(normal);
}

// ============================================
// TRIPLANAR MAPPING
// ============================================

vec3 triplanarNoise(vec3 worldPos, vec3 worldNormal, float scale) {
  vec3 blending = abs(worldNormal);
  blending = normalize(max(blending, 0.00001));
  float b = blending.x + blending.y + blending.z;
  blending /= b;

  float noiseX = fbm3(vec3(worldPos.zy * scale, 0.0));
  float noiseY = fbm3(vec3(worldPos.xz * scale, 0.0));
  float noiseZ = fbm3(vec3(worldPos.xy * scale, 0.0));

  return vec3(
    noiseX * blending.x + noiseY * blending.y + noiseZ * blending.z
  );
}

// ============================================
// MATERIAL BLENDING
// ============================================

// Get slope factor (0 = flat, 1 = vertical cliff)
float getSlopeFactor(vec3 normal) {
  return 1.0 - abs(dot(normal, vec3(0.0, 1.0, 0.0)));
}

// Blend between materials based on height, slope, and noise
vec3 blendTerrainMaterials(
  vec3 worldPos,
  vec3 worldNormal,
  float elevation,
  vec3 groundColor,
  vec3 rockColor,
  vec3 accentColor,
  float snowLine
) {
  float slope = getSlopeFactor(worldNormal);

  // Base noise for variation
  float largeNoise = fbm3(worldPos * 0.1) * 0.5 + 0.5;
  float mediumNoise = fbm4(worldPos * 0.3) * 0.5 + 0.5;
  float fineNoise = fbm5(worldPos * 1.2) * 0.5 + 0.5;

  // Ground color with variation
  vec3 groundVaried = groundColor;
  groundVaried = mix(groundVaried, groundColor * 0.7, mediumNoise * 0.3);
  groundVaried = mix(groundVaried, accentColor, smoothstep(0.6, 0.9, largeNoise) * 0.15);

  // Rock color with variation
  vec3 rockVaried = rockColor;
  rockVaried = mix(rockVaried, rockColor * 0.6, fineNoise * 0.4);
  rockVaried = mix(rockVaried, rockColor * 1.2, mediumNoise * 0.2);

  // Height-based blending
  float heightFactor = smoothstep(2.0, 5.0, elevation);

  // Slope-based blending (steep = rock)
  float slopeFactor = smoothstep(0.3, 0.7, slope);

  // Combine factors with noise for natural transitions
  float rockBlend = max(slopeFactor, heightFactor * 0.5);
  rockBlend += (fineNoise - 0.5) * 0.2; // Add noise to edges
  rockBlend = clamp(rockBlend, 0.0, 1.0);

  vec3 result = mix(groundVaried, rockVaried, rockBlend);

  // Snow on high areas (if snow line is set)
  if (snowLine > 0.0) {
    float snowFactor = smoothstep(snowLine - 1.0, snowLine + 1.0, elevation);
    snowFactor *= (1.0 - slope * 0.7); // Less snow on steep slopes
    snowFactor += (fineNoise - 0.5) * 0.15;
    snowFactor = clamp(snowFactor, 0.0, 1.0);

    vec3 snowColor = vec3(0.95, 0.97, 1.0);
    result = mix(result, snowColor, snowFactor);
  }

  return result;
}

// ============================================
// LIGHTING
// ============================================

vec3 calculateLighting(vec3 baseColor, vec3 worldNormal, vec3 proceduralNormal, vec3 viewDir) {
  // Combine geometry normal with procedural detail normal
  vec3 finalNormal = normalize(worldNormal + proceduralNormal * 0.3);

  // Diffuse lighting
  float NdotL = max(dot(finalNormal, uSunDirection), 0.0);
  float diffuse = NdotL * uSunIntensity;

  // Ambient with slight AO from procedural normal
  float ao = 0.5 + 0.5 * dot(worldNormal, proceduralNormal);
  float ambient = 0.4 * ao;

  // Rim lighting for depth
  float rim = 1.0 - max(dot(viewDir, finalNormal), 0.0);
  rim = pow(rim, 3.0) * 0.15;

  // Specular highlight (subtle)
  vec3 halfVec = normalize(uSunDirection + viewDir);
  float spec = pow(max(dot(finalNormal, halfVec), 0.0), 32.0) * 0.1;

  vec3 lit = baseColor * (ambient + diffuse) + vec3(spec) + vec3(rim * 0.5);

  return lit;
}

// ============================================
// MAIN
// ============================================

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // Calculate procedural normal for surface detail
  vec3 proceduralNormal = calculateProceduralNormal(vWorldPosition, 0.5, 0.8);

  // Get terrain base color from material blending
  vec3 baseColor = blendTerrainMaterials(
    vWorldPosition,
    vWorldNormal,
    vElevation,
    uBiomeGroundColor,
    uBiomeRockColor,
    uBiomeAccentColor,
    uBiomeSnowLine
  );

  // Mix with vertex colors for map-specific variation
  baseColor = mix(baseColor, vColor, 0.3);

  // Add fine detail noise for texture
  float detailNoise = fbm5(vWorldPosition * 3.0) * 0.5 + 0.5;
  baseColor *= 0.85 + detailNoise * 0.3;

  // Apply lighting
  vec3 litColor = calculateLighting(baseColor, vWorldNormal, proceduralNormal, viewDir);

  // Distance fog
  float dist = length(vWorldPosition - cameraPosition);
  float fogFactor = 1.0 - exp(-dist * uBiomeFogDensity * 0.01);
  fogFactor = clamp(fogFactor, 0.0, 0.6);
  litColor = mix(litColor, uFogColor, fogFactor);

  // Slight color grading for richness
  litColor = pow(litColor, vec3(0.95)); // Slight gamma
  litColor = mix(litColor, litColor * vec3(1.02, 1.0, 0.98), 0.3); // Warm tint

  gl_FragColor = vec4(litColor, 1.0);
}
`;

// Create the terrain shader material
export function createTerrainShaderMaterial(biomeConfig: {
  groundColor: THREE.Color;
  rockColor: THREE.Color;
  accentColor: THREE.Color;
  snowLine: number;
  fogDensity: number;
  fogColor: THREE.Color;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: terrainVertexShader,
    fragmentShader: terrainFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uBiomeGroundColor: { value: biomeConfig.groundColor },
      uBiomeRockColor: { value: biomeConfig.rockColor },
      uBiomeAccentColor: { value: biomeConfig.accentColor },
      uBiomeSnowLine: { value: biomeConfig.snowLine },
      uBiomeFogDensity: { value: biomeConfig.fogDensity },
      uFogColor: { value: biomeConfig.fogColor },
      uSunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunIntensity: { value: 1.0 },
    },
    vertexColors: true,
    side: THREE.FrontSide,
  });
}

// Update terrain shader uniforms per frame
export function updateTerrainShader(
  material: THREE.ShaderMaterial,
  deltaTime: number,
  sunDirection?: THREE.Vector3
): void {
  material.uniforms.uTime.value += deltaTime;

  if (sunDirection) {
    material.uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }
}
