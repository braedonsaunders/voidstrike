import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { BIOMES, BiomeConfig } from './Biomes';
import { Terrain, MapDecorations } from './Terrain';
import { CrystalField } from './GroundDetail';
import { TSLMapBorderFog } from './tsl/MapBorderFog';
import { TSLWaterPlane } from './tsl/WaterPlane';
import { EnvironmentParticles } from './EnhancedDecorations';
// PERFORMANCE: Use instanced decorations instead of individual meshes
import { InstancedTrees, InstancedRocks, InstancedGrass, InstancedPebbles, updateDecorationFrustum } from './InstancedDecorations';
// AAA-quality decoration light pooling, frustum culling, and distance falloff
import { DecorationLightManager } from './DecorationLightManager';

// Shadow quality presets - radius only applies to PCFSoftShadowMap (we use BasicShadowMap for perf)
const SHADOW_QUALITY_PRESETS = {
  low: { mapSize: 256, radius: 1, bias: -0.001 },
  medium: { mapSize: 512, radius: 2, bias: -0.0005 },
  high: { mapSize: 1024, radius: 3, bias: -0.0003 },
  ultra: { mapSize: 2048, radius: 4, bias: -0.0002 },
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
  private mapBorderFog: TSLMapBorderFog | null = null;
  private particles: EnvironmentParticles | null = null;
  private legacyDecorations: MapDecorations | null = null;
  // AAA decoration light manager - pools 50 lights for hundreds of emissive decorations
  private decorationLightManager: DecorationLightManager | null = null;

  // Lighting
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private backLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  // Environment map for IBL
  private envMap: THREE.CubeTexture | null = null;

  // Cached vector for per-frame sun direction calculation (avoids allocation)
  private readonly _tempSunDirection = new THREE.Vector3();

  // Shadow update throttling - adaptive based on scene activity
  private shadowFrameCounter = 0;
  // Base intervals: active (units moving) vs static (empty scene)
  private static readonly SHADOW_UPDATE_INTERVAL_ACTIVE = 6; // ~10fps shadow updates during gameplay
  private static readonly SHADOW_UPDATE_INTERVAL_STATIC = 30; // ~2fps shadow updates for static scenes
  private shadowUpdateInterval = EnvironmentManager.SHADOW_UPDATE_INTERVAL_STATIC;
  private hasMovingEntities = false; // Hint from game about scene activity

  // Shadow state
  private shadowsEnabled = false;
  private shadowQuality: ShadowQuality = 'high';
  private lastShadowCameraX = 0;
  private lastShadowCameraZ = 0;
  private readonly SHADOW_CAMERA_UPDATE_THRESHOLD = 5; // Only update if camera moved more than 5 units

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
    // IMPORTANT: Always set castShadow = true to initialize shadow map depth texture
    // Control shadow rendering via renderer.shadowMap.enabled instead
    // This prevents WebGPU "depthTexture is null" errors when toggling shadows
    this.directionalLight.castShadow = true;
    // Pre-configure shadow properties - use 512 for balance of quality/performance
    this.directionalLight.shadow.mapSize.width = 512;
    this.directionalLight.shadow.mapSize.height = 512;
    this.directionalLight.shadow.camera.near = 1;
    this.directionalLight.shadow.camera.far = 200;
    this.directionalLight.shadow.camera.left = -100;
    this.directionalLight.shadow.camera.right = 100;
    this.directionalLight.shadow.camera.top = 100;
    this.directionalLight.shadow.camera.bottom = -100;
    this.directionalLight.shadow.bias = -0.0002;
    this.directionalLight.shadow.radius = 4;
    // PERF: Disable automatic shadow updates - we'll update manually every N frames
    // This is the KEY optimization - shadow map doesn't need to update every frame
    this.directionalLight.shadow.autoUpdate = false;
    this.directionalLight.shadow.needsUpdate = true; // Initial update
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

    // Map border fog - dark smoky effect around map edges (SC2-style)
    // Uses TSL for WebGPU/WebGL compatibility
    this.mapBorderFog = new TSLMapBorderFog(this.mapData);
    this.scene.add(this.mapBorderFog.mesh);

    // Particle effects
    if (this.biome.particleType !== 'none') {
      this.particles = new EnvironmentParticles(this.mapData, this.biome);
      this.scene.add(this.particles.points);
    }

    // AAA decoration light manager - pools lights for hundreds of emissive decorations
    // This enables maps like Crystal Caverns (295 crystals) to run at 60+ fps
    this.decorationLightManager = new DecorationLightManager(this.scene, 50);

    // Legacy decorations (watch towers, destructibles)
    // Pass scene and light manager to enable pooled lights for emissive decorations
    this.legacyDecorations = new MapDecorations(this.mapData, this.terrain, this.scene, this.decorationLightManager);
    this.scene.add(this.legacyDecorations.group);
  }

  /**
   * Update animated elements (water, particles, terrain shader) and decoration frustum culling
   * @param deltaTime Time since last frame
   * @param gameTime Total game time
   * @param camera Camera for frustum culling decorations (optional for backwards compatibility)
   */
  public update(deltaTime: number, gameTime: number, camera?: THREE.Camera): void {
    // Update terrain shader for procedural effects
    // PERF: Reuse cached vector to avoid per-frame allocation
    this._tempSunDirection.copy(this.directionalLight.position).normalize();
    this.terrain.update(deltaTime, this._tempSunDirection);

    if (this.water) {
      this.water.update(gameTime);
    }
    if (this.mapBorderFog) {
      this.mapBorderFog.update(gameTime);
    }
    if (this.particles) {
      this.particles.update(deltaTime);
    }

    // Update emissive decoration pulsing animation
    if (this.legacyDecorations) {
      this.legacyDecorations.update(deltaTime);
    }

    // PERF: Update AAA decoration light manager - frustum culled, distance-sorted, pooled lights
    if (this.decorationLightManager && camera) {
      this.decorationLightManager.update(camera, deltaTime);
    }

    // PERF: Update decoration frustum culling - only render visible instances
    if (camera) {
      updateDecorationFrustum(camera);
      this.trees?.update();
      this.rocks?.update();
      this.grass?.update();
      this.pebbles?.update();
    }
  }

  /**
   * Update shadow camera to follow the game camera position.
   * This ensures shadows are rendered for objects near the camera, not just near map center.
   * Should be called each frame with the camera's look-at target position.
   * PERFORMANCE: Only updates if camera has moved significantly to avoid per-frame overhead.
   */
  public updateShadowCameraPosition(targetX: number, targetZ: number): void {
    if (!this.shadowsEnabled) return;

    // PERFORMANCE: Only update if camera has moved significantly
    const dx = targetX - this.lastShadowCameraX;
    const dz = targetZ - this.lastShadowCameraZ;
    const distMoved = Math.sqrt(dx * dx + dz * dz);
    if (distMoved < this.SHADOW_CAMERA_UPDATE_THRESHOLD) {
      return; // Camera hasn't moved enough, skip update
    }

    this.lastShadowCameraX = targetX;
    this.lastShadowCameraZ = targetZ;

    // Position the light relative to the camera target, maintaining the same angle
    // Original offset is (50, 80, 50) from origin
    const lightOffset = new THREE.Vector3(50, 80, 50);
    this.directionalLight.position.set(
      targetX + lightOffset.x,
      lightOffset.y,
      targetZ + lightOffset.z
    );

    // Update the light target to follow camera
    this.directionalLight.target.position.set(targetX, 0, targetZ);
    this.directionalLight.target.updateMatrixWorld();
  }

  /**
   * Get height at world position
   */
  public getHeightAt(x: number, y: number): number {
    return this.terrain.getHeightAt(x, y);
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
   * Get decoration collision data for building placement validation and pathfinding
   * Returns array of { x, z, radius } for each blocking decoration (rocks AND trees)
   * from both instanced and legacy decorations
   * Note: Method name kept as getRockCollisions for backwards compatibility
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    const collisions: Array<{ x: number; z: number; radius: number }> = [];

    // Get from instanced rocks (if no explicit decorations)
    if (this.rocks) {
      collisions.push(...this.rocks.getRockCollisions());
    }

    // Get from instanced trees (if no explicit decorations)
    if (this.trees) {
      collisions.push(...this.trees.getTreeCollisions());
    }

    // Get from legacy/explicit decorations (includes rocks and trees from map data)
    if (this.legacyDecorations) {
      collisions.push(...this.legacyDecorations.getRockCollisions());
      collisions.push(...this.legacyDecorations.getTreeCollisions());
    }

    return collisions;
  }

  // ============================================
  // SHADOW CONFIGURATION
  // ============================================

  /**
   * Hint to the shadow system whether there are moving entities.
   * When true, shadows update more frequently (6 frames).
   * When false (empty/static scene), shadows update less frequently (30 frames).
   * This significantly reduces GPU work on empty maps.
   */
  public setHasMovingEntities(hasMoving: boolean): void {
    if (this.hasMovingEntities !== hasMoving) {
      this.hasMovingEntities = hasMoving;
      this.shadowUpdateInterval = hasMoving
        ? EnvironmentManager.SHADOW_UPDATE_INTERVAL_ACTIVE
        : EnvironmentManager.SHADOW_UPDATE_INTERVAL_STATIC;
    }
  }

  /**
   * IMPORTANT: Call this every frame to handle throttled shadow updates.
   * Shadow map update frequency is adaptive:
   * - Active scene (units moving): every 6 frames (~10fps shadow updates)
   * - Static scene (empty): every 30 frames (~2fps shadow updates)
   */
  public updateShadows(): void {
    if (!this.shadowsEnabled) return;

    this.shadowFrameCounter++;
    if (this.shadowFrameCounter >= this.shadowUpdateInterval) {
      this.shadowFrameCounter = 0;
      this.directionalLight.shadow.needsUpdate = true;
    }
  }

  /**
   * Enable or disable shadows
   * Note: directionalLight.castShadow is always true to keep shadow map initialized.
   * We control shadow visibility via renderer.shadowMap.enabled in the game canvas.
   */
  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // Don't toggle castShadow - it must stay true to keep shadow map depth texture valid
    // The renderer.shadowMap.enabled flag controls whether shadows are actually rendered

    // Toggle shadow receiving on terrain
    this.terrain.mesh.receiveShadow = enabled;

    // Mark shadow map for immediate update when enabling
    if (enabled) {
      this.shadowFrameCounter = 0;
      this.directionalLight.shadow.needsUpdate = true;
    }
  }

  /**
   * Set shadow quality preset
   * WARNING: In WebGPU, changing shadow map size at runtime causes texture destruction errors.
   * This only updates bias - map size is fixed at initialization (512x512).
   */
  public setShadowQuality(quality: ShadowQuality): void {
    this.shadowQuality = quality;
    const preset = SHADOW_QUALITY_PRESETS[quality];

    // DON'T change mapSize at runtime - causes WebGPU "Destroyed texture" errors
    // this.directionalLight.shadow.mapSize.width = preset.mapSize;
    // this.directionalLight.shadow.mapSize.height = preset.mapSize;
    this.directionalLight.shadow.radius = preset.radius;
    this.directionalLight.shadow.bias = preset.bias;

    // Mark shadow map for update
    // Three.js will handle this automatically on the next render
    this.directionalLight.shadow.needsUpdate = true;
  }

  /**
   * Set shadow draw distance
   * Lower distance = sharper, more detailed shadows (smaller frustum, higher resolution)
   * Higher distance = softer shadows covering more area (larger frustum, lower resolution)
   */
  public setShadowDistance(distance: number): void {
    // Use distance directly for the shadow camera frustum
    // Smaller distance = smaller frustum = sharper shadows on nearby objects
    const halfDist = distance / 2;
    this.directionalLight.shadow.camera.left = -halfDist;
    this.directionalLight.shadow.camera.right = halfDist;
    this.directionalLight.shadow.camera.top = halfDist;
    this.directionalLight.shadow.camera.bottom = -halfDist;
    this.directionalLight.shadow.camera.near = 1;
    this.directionalLight.shadow.camera.far = distance + 100;
    this.directionalLight.shadow.camera.updateProjectionMatrix();
    this.directionalLight.shadow.needsUpdate = true;
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

    // Create gradient textures for each face
    const faces: THREE.DataTexture[] = [];
    const skyColor = new THREE.Color(this.biome.colors.sky);
    const horizonColor = new THREE.Color(this.biome.colors.fog);
    const groundColor = new THREE.Color(this.biome.colors.ground?.[0] || 0x333333);

    // PERF: Reuse single Color instance to avoid per-pixel allocation
    const tempColor = new THREE.Color();

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
          if (t > 0.5) {
            tempColor.lerpColors(horizonColor, skyColor, (t - 0.5) * 2);
          } else {
            tempColor.lerpColors(groundColor, horizonColor, t * 2);
          }

          data[idx] = Math.floor(tempColor.r * 255);
          data[idx + 1] = Math.floor(tempColor.g * 255);
          data[idx + 2] = Math.floor(tempColor.b * 255);
          data[idx + 3] = 255;
        }
      }

      const texture = new THREE.DataTexture(data, size, size);
      texture.needsUpdate = true;
      faces.push(texture);
    }

    // Create cube texture from faces (extracts image data)
    this.envMap = new THREE.CubeTexture(faces.map((t) => t.image));
    this.envMap.needsUpdate = true;

    // Dispose DataTextures now that images are extracted (avoids memory leak)
    for (const texture of faces) {
      texture.dispose();
    }

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

  // ============================================
  // LIGHTING CONFIGURATION
  // ============================================

  /**
   * Set shadow fill intensity (ground bounce light)
   * @param intensity - Fill intensity from 0 to 1
   */
  public setShadowFill(intensity: number): void {
    // Adjust hemisphere light ground color brightness based on fill intensity
    // Higher fill = brighter ground color = more light in shadows
    const baseGroundColor = new THREE.Color(this.biome.colors.ground?.[0] || 0x444444);
    const boostedColor = baseGroundColor.clone().multiplyScalar(1.0 + intensity * 1.5);
    this.hemiLight.groundColor = boostedColor;

    // Also slightly boost hemisphere intensity for overall fill
    this.hemiLight.intensity = 0.5 + intensity * 0.3;
  }

  /**
   * Get the hemisphere light for external modification
   */
  public getHemisphereLight(): THREE.HemisphereLight {
    return this.hemiLight;
  }

  /**
   * Get the main directional light
   */
  public getDirectionalLight(): THREE.DirectionalLight {
    return this.directionalLight;
  }

  // ============================================
  // PARTICLE CONFIGURATION
  // ============================================

  /**
   * Enable or disable particles
   */
  public setParticlesEnabled(enabled: boolean): void {
    if (this.particles) {
      this.particles.points.visible = enabled;
    }
  }

  /**
   * Set particle density multiplier
   * @param density - Density multiplier where 5.0 = baseline (1x), 1-15 range
   */
  public setParticleDensity(density: number): void {
    if (this.particles && this.particles.points.geometry) {
      // Scale particle size based on density - more particles = smaller to avoid visual clutter
      // At baseline (5.0), size is normal. Higher density = slightly smaller particles
      const material = this.particles.points.material as THREE.PointsMaterial;
      if (material.size !== undefined) {
        const baseSize = material.size;
        // Subtle size reduction at high density (max 30% smaller at 3x density)
        const sizeMultiplier = Math.max(0.7, 1.0 - (density - 5.0) * 0.03);
        // Note: We can't easily change particle COUNT without recreating the geometry
        // For now, adjust opacity to simulate density perception
        const opacityMultiplier = Math.min(1.0, 0.6 + density * 0.08);
        material.opacity = Math.min(1.0, material.opacity * opacityMultiplier);
      }
    }
  }

  /**
   * Enable or disable emissive decorations (crystals, alien structures)
   */
  public setEmissiveDecorationsEnabled(enabled: boolean): void {
    if (this.crystals) {
      this.crystals.setEmissiveEnabled(enabled);
    }
  }

  /**
   * Set emissive intensity multiplier for decorations
   */
  public setEmissiveIntensityMultiplier(multiplier: number): void {
    if (this.crystals) {
      this.crystals.setEmissiveIntensityMultiplier(multiplier);
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
    this.mapBorderFog?.dispose();
    this.particles?.dispose();
    this.legacyDecorations?.dispose();
    this.decorationLightManager?.dispose();

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
    if (this.mapBorderFog) this.scene.remove(this.mapBorderFog.mesh);
    if (this.particles) this.scene.remove(this.particles.points);
    if (this.legacyDecorations) this.scene.remove(this.legacyDecorations.group);
  }
}
