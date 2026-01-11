import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { BIOMES, BiomeConfig } from './Biomes';
import { Terrain, MapDecorations } from './Terrain';
import { CrystalField, GroundFog } from './GroundDetail';
import { TSLMapBorderFog } from './tsl/MapBorderFog';
import { TSLWaterPlane } from './tsl/WaterPlane';
import { EnvironmentParticles } from './EnhancedDecorations';
// PERFORMANCE: Use instanced decorations instead of individual meshes
import { InstancedTrees, InstancedRocks, InstancedGrass, InstancedPebbles } from './InstancedDecorations';

// Shadow quality presets
const SHADOW_QUALITY_PRESETS = {
  low: { mapSize: 512, radius: 2, bias: -0.0005 },
  medium: { mapSize: 1024, radius: 3, bias: -0.0003 },
  high: { mapSize: 2048, radius: 4, bias: -0.0002 },
  ultra: { mapSize: 4096, radius: 5, bias: -0.0001 },
} as const;

export type ShadowQuality = keyof typeof SHADOW_QUALITY_PRESETS;

/**
 * Manages all environmental rendering for a map including:
 * - Terrain mesh
 * - Biome-specific decorations (trees, rocks, crystals)
 * - Ground detail (grass, debris)
 * - Water/lava planes
 * - Particle effects (snow, dust, ash)
 * - Lighting, shadows, and fog
 * - Environment map for IBL reflections
 */
export class EnvironmentManager {
  public terrain: Terrain;
  public biome: BiomeConfig;

  private scene: THREE.Scene;
  private mapData: MapData;

  // PERFORMANCE: Instanced decoration systems (single draw call per type)
  private trees: InstancedTrees | null = null;
  private rocks: InstancedRocks | null = null;
  private grass: InstancedGrass | null = null;
  private pebbles: InstancedPebbles | null = null;
  private crystals: CrystalField | null = null;
  private water: TSLWaterPlane | null = null;
  private groundFog: GroundFog | null = null;
  private mapBorderFog: TSLMapBorderFog | null = null;
  private particles: EnvironmentParticles | null = null;
  private legacyDecorations: MapDecorations | null = null;

  // Lighting
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private backLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  // Environment map for IBL
  private envMap: THREE.CubeTexture | null = null;

  // Shadow state
  private shadowsEnabled = false;
  private shadowQuality: ShadowQuality = 'high';

  constructor(scene: THREE.Scene, mapData: MapData) {
    this.scene = scene;
    this.mapData = mapData;
    this.biome = BIOMES[mapData.biome || 'grassland'];

    // Create terrain
    this.terrain = new Terrain({ mapData });
    scene.add(this.terrain.mesh);

    // Setup bright SC2-quality lighting based on biome
    // Main ambient light - bright base illumination
    this.ambientLight = new THREE.AmbientLight(this.biome.colors.ambient, 0.8);
    scene.add(this.ambientLight);

    // Key light (main sun) - strong directional light with shadow support
    this.directionalLight = new THREE.DirectionalLight(this.biome.colors.sun, 1.8);
    this.directionalLight.position.set(50, 80, 50);
    this.directionalLight.castShadow = false; // Disabled by default, enabled via setShadowsEnabled()
    // Pre-configure shadow properties (applied when shadows enabled)
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.directionalLight.shadow.camera.near = 1;
    this.directionalLight.shadow.camera.far = 200;
    this.directionalLight.shadow.camera.left = -100;
    this.directionalLight.shadow.camera.right = 100;
    this.directionalLight.shadow.camera.top = 100;
    this.directionalLight.shadow.camera.bottom = -100;
    this.directionalLight.shadow.bias = -0.0002;
    this.directionalLight.shadow.radius = 4; // Soft shadows
    scene.add(this.directionalLight);

    // Fill light - bright cool tint to fill shadows
    this.fillLight = new THREE.DirectionalLight(0x8090b0, 0.7);
    this.fillLight.position.set(-40, 50, -40);
    scene.add(this.fillLight);

    // Back/rim light - adds definition to objects
    this.backLight = new THREE.DirectionalLight(this.biome.colors.sun, 0.4);
    this.backLight.position.set(-20, 30, 60);
    scene.add(this.backLight);

    // Hemisphere light for realistic sky/ground bounce - brighter
    this.hemiLight = new THREE.HemisphereLight(
      this.biome.colors.sky, // Sky color
      new THREE.Color(this.biome.colors.ground?.[0] || 0x444444), // Ground color
      0.5
    );
    scene.add(this.hemiLight);

    // Create environment map for IBL reflections
    this.createEnvironmentMap();

    // Setup biome-specific fog (density affects near/far)
    // Lower fogNear = denser fog closer to camera
    const biomeType = mapData.biome || 'grassland';
    let fogNear: number;
    let fogFar: number;

    switch (biomeType) {
      case 'jungle':
        // Thick, humid fog - visibility reduced
        fogNear = mapData.fogNear ?? 30;
        fogFar = mapData.fogFar ?? 120;
        break;
      case 'volcanic':
        // Dense smoke and ash - heavy atmosphere
        fogNear = mapData.fogNear ?? 25;
        fogFar = mapData.fogFar ?? 100;
        break;
      case 'void':
        // Thick, ethereal mist - mysterious atmosphere
        fogNear = mapData.fogNear ?? 20;
        fogFar = mapData.fogFar ?? 90;
        break;
      case 'frozen':
        // Light snow haze - moderate visibility
        fogNear = mapData.fogNear ?? 50;
        fogFar = mapData.fogFar ?? 160;
        break;
      case 'desert':
        // Thin heat haze - clear visibility
        fogNear = mapData.fogNear ?? 80;
        fogFar = mapData.fogFar ?? 250;
        break;
      case 'grassland':
      default:
        // Light atmospheric haze - good visibility
        fogNear = mapData.fogNear ?? 60;
        fogFar = mapData.fogFar ?? 180;
        break;
    }

    scene.fog = new THREE.Fog(this.biome.colors.fog, fogNear, fogFar);
    // Use dark background - the MapBorderFog creates a smoky transition at map edges
    scene.background = new THREE.Color(0x000000);

    // Create enhanced decorations
    this.createEnhancedDecorations();
  }

  private createEnhancedDecorations(): void {
    const getHeightAt = this.terrain.getHeightAt.bind(this.terrain);

    // Check if map has explicit decorations defined
    const hasExplicitDecorations = this.mapData.decorations && this.mapData.decorations.length > 0;

    // Only use instanced random decorations if no explicit decorations defined
    if (!hasExplicitDecorations) {
      // PERFORMANCE: Instanced trees - single draw call for all trees
      if (this.biome.treeDensity > 0) {
        this.trees = new InstancedTrees(this.mapData, this.biome, getHeightAt);
        this.scene.add(this.trees.group);
      }

      // PERFORMANCE: Instanced rocks - single draw call for all rocks
      if (this.biome.rockDensity > 0) {
        this.rocks = new InstancedRocks(this.mapData, this.biome, getHeightAt);
        this.scene.add(this.rocks.group);
      }
    }

    // PERFORMANCE: Instanced grass - thousands of grass blades in one draw call
    if (this.biome.grassDensity > 0) {
      this.grass = new InstancedGrass(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.grass.group);
    }

    // PERFORMANCE: Instanced pebbles - replaces old GroundDebris
    if (this.biome.grassDensity > 0 || this.biome.rockDensity > 0.1) {
      this.pebbles = new InstancedPebbles(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.pebbles.group);
    }

    // Crystals (for frozen/void biomes)
    if (this.biome.crystalDensity > 0) {
      this.crystals = new CrystalField(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.crystals.group);
    }

    // Water/lava plane - TSL WebGPU compatible
    if (this.biome.hasWater) {
      this.water = new TSLWaterPlane(this.mapData, this.biome);
      this.scene.add(this.water.mesh);
    }

    // Ground fog/mist layer for atmospheric effect
    // Note: GroundFog uses ShaderMaterial which may not render correctly with WebGPU
    // TODO: Convert to TSL material for WebGPU compatibility
    // this.groundFog = new GroundFog(this.mapData, this.biome);
    // this.scene.add(this.groundFog.mesh);

    // Map border fog - dark smoky effect around map edges (SC2-style)
    // Uses TSL for WebGPU/WebGL compatibility
    this.mapBorderFog = new TSLMapBorderFog(this.mapData);
    this.scene.add(this.mapBorderFog.mesh);

    // Particle effects
    if (this.biome.particleType !== 'none') {
      this.particles = new EnvironmentParticles(this.mapData, this.biome);
      this.scene.add(this.particles.points);
    }

    // Legacy decorations (watch towers, destructibles)
    this.legacyDecorations = new MapDecorations(this.mapData, this.terrain);
    this.scene.add(this.legacyDecorations.group);
  }

  /**
   * Update animated elements (water, particles, terrain shader)
   */
  public update(deltaTime: number, gameTime: number): void {
    // Update terrain shader for procedural effects
    const sunDirection = this.directionalLight.position.clone().normalize();
    this.terrain.update(deltaTime, sunDirection);

    if (this.water) {
      this.water.update(gameTime);
    }
    if (this.groundFog) {
      this.groundFog.update(gameTime);
    }
    if (this.mapBorderFog) {
      this.mapBorderFog.update(gameTime);
    }
    if (this.particles) {
      this.particles.update(deltaTime);
    }
  }

  /**
   * Get height at world position
   */
  public getHeightAt(x: number, y: number): number {
    return this.terrain.getHeightAt(x, y);
  }

  /**
   * Get ground fog mesh for visibility toggling
   */
  public getGroundFog(): GroundFog | null {
    return this.groundFog;
  }

  /**
   * Get particles system for visibility toggling
   */
  public getParticles(): EnvironmentParticles | null {
    return this.particles;
  }

  /**
   * Check if position is walkable
   */
  public isWalkable(x: number, y: number): boolean {
    return this.terrain.isWalkable(x, y);
  }

  /**
   * Check if position is buildable
   */
  public isBuildable(x: number, y: number): boolean {
    return this.terrain.isBuildable(x, y);
  }

  /**
   * Get rock collision data for building placement validation
   * Returns array of { x, z, radius } for each rock
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    return this.rocks?.getRockCollisions() || [];
  }

  // ============================================
  // SHADOW CONFIGURATION
  // ============================================

  /**
   * Enable or disable shadows
   */
  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    this.directionalLight.castShadow = enabled;

    // Enable shadow receiving on terrain
    this.terrain.mesh.receiveShadow = enabled;

    // Update renderer shadow map if needed
    // Note: The renderer's shadowMap.enabled should be set in the game canvas
  }

  /**
   * Set shadow quality preset
   */
  public setShadowQuality(quality: ShadowQuality): void {
    this.shadowQuality = quality;
    const preset = SHADOW_QUALITY_PRESETS[quality];

    this.directionalLight.shadow.mapSize.width = preset.mapSize;
    this.directionalLight.shadow.mapSize.height = preset.mapSize;
    this.directionalLight.shadow.radius = preset.radius;
    this.directionalLight.shadow.bias = preset.bias;

    // Force shadow map regeneration
    if (this.directionalLight.shadow.map) {
      this.directionalLight.shadow.map.dispose();
      this.directionalLight.shadow.map = null as any;
    }
  }

  /**
   * Set shadow draw distance
   */
  public setShadowDistance(distance: number): void {
    const halfDist = distance / 2;
    this.directionalLight.shadow.camera.left = -halfDist;
    this.directionalLight.shadow.camera.right = halfDist;
    this.directionalLight.shadow.camera.top = halfDist;
    this.directionalLight.shadow.camera.bottom = -halfDist;
    this.directionalLight.shadow.camera.far = distance * 2;
    this.directionalLight.shadow.camera.updateProjectionMatrix();
  }

  /**
   * Get current shadow state
   */
  public getShadowsEnabled(): boolean {
    return this.shadowsEnabled;
  }

  // ============================================
  // ENVIRONMENT MAP / IBL
  // ============================================

  /**
   * Create procedural environment map for IBL based on biome
   */
  private createEnvironmentMap(): void {
    const size = 64;
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(size);

    // Create gradient textures for each face
    const faces: THREE.DataTexture[] = [];
    const skyColor = new THREE.Color(this.biome.colors.sky);
    const horizonColor = new THREE.Color(this.biome.colors.fog);
    const groundColor = new THREE.Color(this.biome.colors.ground?.[0] || 0x333333);

    // Generate 6 cube faces with gradient
    for (let face = 0; face < 6; face++) {
      const data = new Uint8Array(size * size * 4);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;

          // Vertical gradient based on face
          let t: number;
          if (face === 2) {
            // Top face - sky color
            t = 1.0;
          } else if (face === 3) {
            // Bottom face - ground color
            t = 0.0;
          } else {
            // Side faces - gradient from ground to sky
            t = y / size;
          }

          // Interpolate colors
          const color = new THREE.Color();
          if (t > 0.5) {
            color.lerpColors(horizonColor, skyColor, (t - 0.5) * 2);
          } else {
            color.lerpColors(groundColor, horizonColor, t * 2);
          }

          data[idx] = Math.floor(color.r * 255);
          data[idx + 1] = Math.floor(color.g * 255);
          data[idx + 2] = Math.floor(color.b * 255);
          data[idx + 3] = 255;
        }
      }

      const texture = new THREE.DataTexture(data, size, size);
      texture.needsUpdate = true;
      faces.push(texture);
    }

    // Create cube texture from faces
    this.envMap = new THREE.CubeTexture(faces.map((t) => t.image));
    this.envMap.needsUpdate = true;

    // Apply to scene
    this.scene.environment = this.envMap;
  }

  /**
   * Enable or disable environment map
   */
  public setEnvironmentMapEnabled(enabled: boolean): void {
    this.scene.environment = enabled ? this.envMap : null;
  }

  // ============================================
  // FOG CONFIGURATION
  // ============================================

  /**
   * Enable or disable fog
   */
  public setFogEnabled(enabled: boolean): void {
    if (enabled) {
      // Restore fog with current biome settings
      const biomeType = this.mapData.biome || 'grassland';
      let fogNear: number;
      let fogFar: number;

      switch (biomeType) {
        case 'jungle': fogNear = 30; fogFar = 120; break;
        case 'volcanic': fogNear = 25; fogFar = 100; break;
        case 'void': fogNear = 20; fogFar = 90; break;
        case 'frozen': fogNear = 50; fogFar = 160; break;
        case 'desert': fogNear = 80; fogFar = 250; break;
        default: fogNear = 60; fogFar = 180; break;
      }

      this.scene.fog = new THREE.Fog(this.biome.colors.fog, fogNear, fogFar);
    } else {
      this.scene.fog = null;
    }
  }

  /**
   * Set fog density (multiplier for near/far distances)
   */
  public setFogDensity(density: number): void {
    if (this.scene.fog && this.scene.fog instanceof THREE.Fog) {
      const biomeType = this.mapData.biome || 'grassland';
      let baseFogNear: number;
      let baseFogFar: number;

      switch (biomeType) {
        case 'jungle': baseFogNear = 30; baseFogFar = 120; break;
        case 'volcanic': baseFogNear = 25; baseFogFar = 100; break;
        case 'void': baseFogNear = 20; baseFogFar = 90; break;
        case 'frozen': baseFogNear = 50; baseFogFar = 160; break;
        case 'desert': baseFogNear = 80; baseFogFar = 250; break;
        default: baseFogNear = 60; baseFogFar = 180; break;
      }

      // Inverse density - higher density = closer fog
      const invDensity = 1 / Math.max(0.1, density);
      this.scene.fog.near = baseFogNear * invDensity;
      this.scene.fog.far = baseFogFar * invDensity;
    }
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.terrain.dispose();
    this.trees?.dispose();
    this.rocks?.dispose();
    this.grass?.dispose();
    this.pebbles?.dispose();
    this.crystals?.dispose();
    this.water?.dispose();
    this.groundFog?.dispose();
    this.mapBorderFog?.dispose();
    this.particles?.dispose();
    this.legacyDecorations?.dispose();

    this.scene.remove(this.terrain.mesh);
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.directionalLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.backLight);
    this.scene.remove(this.hemiLight);

    // Dispose environment map
    if (this.envMap) {
      this.envMap.dispose();
      this.scene.environment = null;
    }

    if (this.trees) this.scene.remove(this.trees.group);
    if (this.rocks) this.scene.remove(this.rocks.group);
    if (this.grass) this.scene.remove(this.grass.group);
    if (this.pebbles) this.scene.remove(this.pebbles.group);
    if (this.crystals) this.scene.remove(this.crystals.group);
    if (this.water) this.scene.remove(this.water.mesh);
    if (this.groundFog) this.scene.remove(this.groundFog.mesh);
    if (this.mapBorderFog) this.scene.remove(this.mapBorderFog.mesh);
    if (this.particles) this.scene.remove(this.particles.points);
    if (this.legacyDecorations) this.scene.remove(this.legacyDecorations.group);
  }
}
