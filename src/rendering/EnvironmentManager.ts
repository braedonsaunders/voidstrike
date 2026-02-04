import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { MapData } from '@/data/maps';
import { BIOMES, BiomeConfig } from './Biomes';
import { Terrain, MapDecorations } from './Terrain';
import { TSLMapBorderFog } from './tsl/MapBorderFog';
import { EnvironmentParticles } from './EnhancedDecorations';
import { InstancedTrees, InstancedRocks, InstancedGrass, InstancedPebbles, InstancedCrystals, updateDecorationFrustum } from './InstancedDecorations';
import { DecorationLightManager } from './DecorationLightManager';
import { EmissiveDecorationManager } from './EmissiveDecorationManager';
import { LightPool } from './LightPool';
import {
  SHADOW_QUALITY_PRESETS,
  ENVIRONMENT,
  type ShadowQuality,
} from '@/data/rendering.config';

// New unified water system imports
import {
  UnifiedWaterMesh,
  WaterMemoryManager,
  PlanarReflection,
  createPlanarReflectionForQuality,
  type WaterQuality,
} from './water';
import {
  createWaterMaterial,
  loadWaterNormalsTexture,
  getWaterNormalsTextureSync,
  type TSLWaterMaterial,
} from './tsl/WaterMaterial';

export type { ShadowQuality };
export type { WaterQuality };

/**
 * Water statistics for debugging and monitoring
 */
export interface WaterStats {
  cells: number;
  vertices: number;
  drawCalls: number;
  memoryMB: number;
  quality: WaterQuality;
  hasPlanarReflection: boolean;
}

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

  // Instanced decoration systems (single draw call per type, frustum culled)
  private trees: InstancedTrees | null = null;
  private rocks: InstancedRocks | null = null;
  private grass: InstancedGrass | null = null;
  private pebbles: InstancedPebbles | null = null;
  private crystals: InstancedCrystals | null = null;

  // New unified water system
  private unifiedWaterMesh: UnifiedWaterMesh | null = null;
  private waterMaterial: TSLWaterMaterial | null = null;
  private planarReflection: PlanarReflection | null = null;
  private waterQuality: WaterQuality = 'high';
  private waterReflectionsEnabled: boolean = true;
  private waterEnabled: boolean = true;
  private waterCellCount: number = 0;

  private mapBorderFog: TSLMapBorderFog | null = null;
  private particles: EnvironmentParticles | null = null;
  private mapDecorations: MapDecorations | null = null;
  // AAA decoration light manager - pools 50 lights for hundreds of emissive decorations
  private decorationLightManager: DecorationLightManager | null = null;
  // Centralized emissive decoration manager with animation and light attachment
  private emissiveDecorationManager: EmissiveDecorationManager | null = null;
  private emissiveLightPool: LightPool | null = null;

  // Renderer reference for planar reflections
  private renderer: THREE.WebGLRenderer | WebGPURenderer | null = null;

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
  private static readonly SHADOW_UPDATE_INTERVAL_ACTIVE: number = ENVIRONMENT.SHADOW_UPDATE_INTERVAL_ACTIVE;
  private static readonly SHADOW_UPDATE_INTERVAL_STATIC: number = ENVIRONMENT.SHADOW_UPDATE_INTERVAL_STATIC;
  private shadowUpdateInterval: number = EnvironmentManager.SHADOW_UPDATE_INTERVAL_STATIC;
  private hasMovingEntities = false; // Hint from game about scene activity

  // Shadow state
  private shadowsEnabled = false;
  private shadowQuality: ShadowQuality = 'high';
  private lastShadowCameraX = 0;
  private lastShadowCameraZ = 0;
  private readonly SHADOW_CAMERA_UPDATE_THRESHOLD = ENVIRONMENT.SHADOW_CAMERA_UPDATE_THRESHOLD;

  constructor(scene: THREE.Scene, mapData: MapData) {
    this.scene = scene;
    this.mapData = mapData;
    this.biome = BIOMES[mapData.biome || 'grassland'];

    // Create terrain
    this.terrain = new Terrain({ mapData });
    scene.add(this.terrain.mesh);

    // Setup bright lighting based on biome
    // Main ambient light - bright base illumination
    this.ambientLight = new THREE.AmbientLight(this.biome.colors.ambient, 0.8);
    scene.add(this.ambientLight);

    // Key light (main sun) - strong directional light with shadow support
    this.directionalLight = new THREE.DirectionalLight(this.biome.colors.sun, 1.8);
    this.directionalLight.position.set(50, 80, 50);
    // IMPORTANT: Always set castShadow = true to initialize shadow map depth texture
    // NEVER toggle renderer.shadowMap.enabled - it must stay true to keep textures valid
    // Shadow visibility is controlled via receiveShadow on meshes + internal shadowsEnabled flag
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
      case 'ocean':
        // Coastal mist - good visibility
        fogNear = mapData.fogNear ?? 70;
        fogFar = mapData.fogFar ?? 220;
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

  /**
   * Set the renderer reference for planar reflections
   * Must be called after construction if ultra quality water is desired
   */
  public setRenderer(renderer: THREE.WebGLRenderer | WebGPURenderer): void {
    this.renderer = renderer;

    // If we're at ultra quality and reflections are enabled, create planar reflection
    if (this.waterQuality === 'ultra' && this.waterReflectionsEnabled && !this.planarReflection) {
      this.createPlanarReflectionIfNeeded();
    }
  }

  private createEnhancedDecorations(): void {
    const getHeightAt = this.terrain.getHeightAt.bind(this.terrain);

    // Instanced trees from explicit map data (frustum culled, single draw call per model)
    this.trees = new InstancedTrees(this.mapData, this.biome, getHeightAt);
    this.scene.add(this.trees.group);

    // Instanced rocks from explicit map data (frustum culled, single draw call per model)
    this.rocks = new InstancedRocks(this.mapData, this.biome, getHeightAt);
    this.scene.add(this.rocks.group);

    // Instanced crystals from explicit map data (frustum culled, emissive)
    this.crystals = new InstancedCrystals(this.mapData, this.biome, getHeightAt);
    this.scene.add(this.crystals.group);

    // Environmental ground detail (procedural - these are not map decorations)
    if (this.biome.grassDensity > 0) {
      this.grass = new InstancedGrass(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.grass.group);
    }
    if (this.biome.grassDensity > 0 || this.biome.rockDensity > 0.1) {
      this.pebbles = new InstancedPebbles(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.pebbles.group);
    }

    // Unified water system - handles both full-map water and localized features
    this.createUnifiedWater();

    // Map border fog - dark smoky effect around map edges
    this.mapBorderFog = new TSLMapBorderFog(this.mapData);
    this.scene.add(this.mapBorderFog.mesh);

    // Particle effects
    if (this.biome.particleType !== 'none') {
      this.particles = new EnvironmentParticles(this.mapData, this.biome);
      this.scene.add(this.particles.points);
    }

    // AAA decoration light manager - pools lights for hundreds of emissive decorations
    this.decorationLightManager = new DecorationLightManager(this.scene, 50);

    // Emissive decoration manager with optional light attachment
    this.emissiveLightPool = new LightPool(this.scene, 16);
    this.emissiveDecorationManager = new EmissiveDecorationManager(this.scene, this.emissiveLightPool);

    // Register crystals with emissive decoration manager for pulsing animation
    if (this.crystals) {
      const crystalMesh = this.crystals.getInstancedMesh();
      if (crystalMesh) {
        let emissiveHex = '#204060';
        let pulseSpeed = 0.3;
        let pulseAmplitude = 0.15;

        if (this.biome.name === 'Void') {
          emissiveHex = '#4020a0';
          pulseSpeed = 0.5;
          pulseAmplitude = 0.25;
        } else if (this.biome.name === 'Volcanic') {
          emissiveHex = '#802010';
          pulseSpeed = 0.8;
          pulseAmplitude = 0.3;
        }

        this.emissiveDecorationManager.registerInstancedDecoration(crystalMesh, {
          emissive: emissiveHex,
          emissiveIntensity: 0.5,
          pulseSpeed,
          pulseAmplitude,
        });
      }
    }

    // MapDecorations handles watch towers and destructibles (non-instanced objects)
    this.mapDecorations = new MapDecorations(this.mapData, this.terrain, this.scene, this.decorationLightManager);
    this.scene.add(this.mapDecorations.group);
  }

  /**
   * Create the unified water system with optimal quality selection
   */
  private createUnifiedWater(): void {
    // Count water cells to determine optimal quality
    this.waterCellCount = this.countWaterCells();

    if (this.waterCellCount === 0 && !this.biome.hasWater) {
      // No water on this map
      return;
    }

    // Use memory manager to select optimal quality
    const memoryManager = WaterMemoryManager;
    const optimalQuality = memoryManager.selectOptimalQuality(this.waterCellCount);
    this.waterQuality = optimalQuality;
    memoryManager.setCurrentQuality(optimalQuality);

    // Get water normals texture (may be null if not yet loaded)
    const normalMap = getWaterNormalsTextureSync();

    // Start loading water normals texture in background if not cached
    if (!normalMap) {
      loadWaterNormalsTexture().then((texture) => {
        // Texture loaded - could update material if needed
        // For now, the procedural normals work fine
        void texture;
      });
    }

    // Determine water colors based on biome
    // Shallow color is darker and closer to deep to create more subtle transitions
    const isLava = this.biome.name === 'Volcanic';
    const shallowColor = isLava ? new THREE.Color(0x802000) : new THREE.Color(0x1a6080);
    const deepColor = isLava ? new THREE.Color(0x400800) : new THREE.Color(0x0a3050);

    // Calculate sun direction from directional light
    this._tempSunDirection.copy(this.directionalLight.position).normalize();

    // Create TSL water material
    this.waterMaterial = createWaterMaterial({
      quality: optimalQuality,
      sunDirection: this._tempSunDirection,
      shallowColor,
      deepColor,
      normalMap,
      envMap: this.envMap,
    });

    // Create unified water mesh
    this.unifiedWaterMesh = new UnifiedWaterMesh({
      quality: optimalQuality,
      material: this.waterMaterial.getMaterial(),
    });

    // Build water from terrain data
    if (this.mapData.terrain) {
      this.unifiedWaterMesh.buildFromTerrainData(
        this.mapData.terrain,
        this.mapData.width,
        this.mapData.height
      );
    }

    // Add to scene
    this.scene.add(this.unifiedWaterMesh.mesh);
    this.scene.add(this.unifiedWaterMesh.shoreGroup);

    // Update memory usage tracking
    const estimate = memoryManager.estimateMemoryUsage(this.waterCellCount, optimalQuality);
    memoryManager.updateCurrentUsage(estimate.totalMB);

    // Create planar reflection if ultra quality and renderer is available
    this.createPlanarReflectionIfNeeded();
  }

  /**
   * Create planar reflection system for ultra quality water
   */
  private createPlanarReflectionIfNeeded(): void {
    if (
      this.waterQuality !== 'ultra' ||
      !this.waterReflectionsEnabled ||
      !this.renderer ||
      this.planarReflection
    ) {
      return;
    }

    // Calculate average water height for reflection plane
    const waterHeight = this.biome.waterLevel ?? 0.15;

    this.planarReflection = createPlanarReflectionForQuality(
      this.renderer,
      'ultra',
      waterHeight
    );
  }

  /**
   * Count water cells in the map data
   */
  private countWaterCells(): number {
    if (!this.mapData.terrain) return 0;

    let count = 0;
    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        const cell = this.mapData.terrain[y]?.[x];
        if (cell) {
          const feature = cell.feature || 'none';
          if (feature === 'water_shallow' || feature === 'water_deep') {
            count++;
          }
        }
      }
    }
    return count;
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

    // Update water material animation
    if (this.waterMaterial) {
      this.waterMaterial.update(deltaTime);
      this.waterMaterial.setSunDirection(this._tempSunDirection);
    }

    // Update water mesh (frustum culling handled by Three.js)
    if (this.unifiedWaterMesh) {
      this.unifiedWaterMesh.update(deltaTime, camera);
    }

    // Update planar reflection for ultra quality
    if (this.planarReflection && camera) {
      this.planarReflection.update(this.scene, camera);
    }

    if (this.mapBorderFog) {
      this.mapBorderFog.update(gameTime);
    }
    if (this.particles) {
      this.particles.update(deltaTime);
    }

    // Update emissive decoration pulsing animation
    if (this.mapDecorations) {
      this.mapDecorations.update(deltaTime);
    }

    // Update emissive decoration manager (crystal pulsing, etc.)
    if (this.emissiveDecorationManager) {
      this.emissiveDecorationManager.update(deltaTime);
    }

    // PERF: Update AAA decoration light manager - frustum culled, distance-sorted, pooled lights
    if (this.decorationLightManager && camera) {
      this.decorationLightManager.update(camera, deltaTime);
    }

    // PERF: Update instanced decoration frustum culling - only render visible instances
    if (camera) {
      updateDecorationFrustum(camera);
      this.trees?.update();
      this.rocks?.update();
      this.crystals?.update();
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
   */
  public getRockCollisions(): Array<{ x: number; z: number; radius: number }> {
    const collisions: Array<{ x: number; z: number; radius: number }> = [];

    // Get from instanced decorations
    if (this.rocks) {
      collisions.push(...this.rocks.getRockCollisions());
    }
    if (this.trees) {
      collisions.push(...this.trees.getTreeCollisions());
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

      // When entities first appear, force immediate shadow update.
      // This fixes initial unit shadows being stuck at wrong positions -
      // the shadow map may have rendered before entities existed.
      if (hasMoving && this.shadowsEnabled) {
        this.shadowFrameCounter = 0;
        this.directionalLight.shadow.needsUpdate = true;
      }
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
   * Note: Both directionalLight.castShadow and renderer.shadowMap.enabled stay true.
   * We control shadow visibility via receiveShadow on meshes + skipping shadow updates.
   */
  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    // Don't toggle castShadow or renderer.shadowMap.enabled - they must stay true
    // to keep shadow map depth texture valid and prevent TSL texture errors

    // Toggle shadow receiving on terrain chunks (mesh is a Group containing chunk meshes)
    this.terrain.mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.receiveShadow = enabled;
      }
    });

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
        case 'ocean': fogNear = 70; fogFar = 220; break;
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
        case 'ocean': baseFogNear = 70; baseFogFar = 220; break;
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
        const _baseSize = material.size;
        // Subtle size reduction at high density (max 30% smaller at 3x density)
        const _sizeMultiplier = Math.max(0.7, 1.0 - (density - 5.0) * 0.03);
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
    if (this.emissiveDecorationManager) {
      this.emissiveDecorationManager.setEnabled(enabled);
    }
  }

  /**
   * Set emissive intensity multiplier for decorations
   */
  public setEmissiveIntensityMultiplier(multiplier: number): void {
    if (this.emissiveDecorationManager) {
      this.emissiveDecorationManager.setIntensityMultiplier(multiplier);
    }
  }

  // ============================================
  // WATER CONFIGURATION
  // ============================================

  /**
   * Set water enabled state
   */
  public setWaterEnabled(enabled: boolean): void {
    this.waterEnabled = enabled;
    if (this.unifiedWaterMesh) {
      this.unifiedWaterMesh.setEnabled(enabled);
    }
    if (this.planarReflection) {
      this.planarReflection.setEnabled(enabled);
    }
  }

  /**
   * Set water quality level
   * Note: Changing quality requires rebuilding the water mesh
   */
  public setWaterQuality(quality: WaterQuality): void {
    if (this.waterQuality === quality) return;

    const previousQuality = this.waterQuality;
    this.waterQuality = quality;

    // Update material quality settings
    if (this.waterMaterial) {
      this.waterMaterial.setQuality(quality);
    }

    // Update mesh quality (may trigger rebuild on next buildFromTerrainData call)
    if (this.unifiedWaterMesh) {
      this.unifiedWaterMesh.setQuality(quality);
    }

    // Handle planar reflection based on quality
    if (quality === 'ultra' && !this.planarReflection && this.waterReflectionsEnabled) {
      // Upgrade to ultra - create planar reflection
      this.createPlanarReflectionIfNeeded();
    } else if (previousQuality === 'ultra' && quality !== 'ultra' && this.planarReflection) {
      // Downgrade from ultra - dispose planar reflection
      this.planarReflection.dispose();
      this.planarReflection = null;
    }

    // Update memory manager
    WaterMemoryManager.setCurrentQuality(quality);
    const estimate = WaterMemoryManager.estimateMemoryUsage(this.waterCellCount, quality);
    WaterMemoryManager.updateCurrentUsage(estimate.totalMB);
  }

  /**
   * Set water reflections enabled
   */
  public setWaterReflectionsEnabled(enabled: boolean): void {
    this.waterReflectionsEnabled = enabled;

    if (enabled && this.waterQuality === 'ultra' && !this.planarReflection) {
      // Enable reflections at ultra quality - create planar reflection
      this.createPlanarReflectionIfNeeded();
    } else if (!enabled && this.planarReflection) {
      // Disable reflections - dispose planar reflection
      this.planarReflection.dispose();
      this.planarReflection = null;
    }
  }

  /**
   * Get water statistics for debugging and monitoring
   */
  public getWaterStats(): WaterStats {
    const meshStats = this.unifiedWaterMesh?.getStats() ?? {
      cells: 0,
      vertices: 0,
      indices: 0,
      drawCalls: 0,
    };

    // Estimate memory usage
    const estimate = WaterMemoryManager.estimateMemoryUsage(
      meshStats.cells || this.waterCellCount,
      this.waterQuality
    );

    // Add planar reflection memory if present
    const reflectionMemoryMB = this.planarReflection?.getMemoryUsageMB() ?? 0;

    return {
      cells: meshStats.cells || this.waterCellCount,
      vertices: meshStats.vertices,
      drawCalls: meshStats.drawCalls,
      memoryMB: estimate.totalMB + reflectionMemoryMB,
      quality: this.waterQuality,
      hasPlanarReflection: this.planarReflection !== null,
    };
  }

  /**
   * Dispose all resources
   * CRITICAL: Remove from scene FIRST, then delay disposal to prevent WebGPU crashes.
   * Even after scene.remove(), WebGPU may still have in-flight commands using these buffers.
   * We delay disposal by ~100ms to ensure the GPU has finished all pending operations.
   */
  public dispose(): void {
    // STEP 1: Remove all objects from scene FIRST (stops new render commands)
    this.scene.remove(this.terrain.mesh);
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.directionalLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.backLight);
    this.scene.remove(this.hemiLight);

    if (this.trees) this.scene.remove(this.trees.group);
    if (this.rocks) this.scene.remove(this.rocks.group);
    if (this.crystals) this.scene.remove(this.crystals.group);
    if (this.grass) this.scene.remove(this.grass.group);
    if (this.pebbles) this.scene.remove(this.pebbles.group);

    // Remove unified water mesh
    if (this.unifiedWaterMesh) {
      this.scene.remove(this.unifiedWaterMesh.mesh);
      this.scene.remove(this.unifiedWaterMesh.shoreGroup);
    }

    if (this.mapBorderFog) this.scene.remove(this.mapBorderFog.mesh);
    if (this.particles) this.scene.remove(this.particles.points);
    if (this.mapDecorations) this.scene.remove(this.mapDecorations.group);

    // STEP 2: Dispose non-geometry resources immediately (CPU-side only)
    this.decorationLightManager?.dispose();
    this.emissiveDecorationManager?.dispose();
    this.emissiveLightPool?.dispose();

    // Dispose planar reflection
    if (this.planarReflection) {
      this.planarReflection.dispose();
      this.planarReflection = null;
    }

    // Clear environment map reference
    if (this.envMap) {
      this.scene.environment = null;
    }

    // STEP 3: Delay geometry disposal to prevent WebGPU crashes.
    // WebGPU may still have 2-3 frames of commands in flight after scene.remove().
    // Waiting ~100ms (~6 frames at 60fps) ensures GPU has finished.
    const trees = this.trees;
    const rocks = this.rocks;
    const crystals = this.crystals;
    const grass = this.grass;
    const pebbles = this.pebbles;
    const terrain = this.terrain;
    const unifiedWaterMesh = this.unifiedWaterMesh;
    const waterMaterial = this.waterMaterial;
    const mapBorderFog = this.mapBorderFog;
    const particles = this.particles;
    const mapDecorations = this.mapDecorations;
    const envMap = this.envMap;

    setTimeout(() => {
      trees?.dispose();
      rocks?.dispose();
      crystals?.dispose();
      grass?.dispose();
      pebbles?.dispose();
      terrain.dispose();
      unifiedWaterMesh?.dispose();
      waterMaterial?.dispose();
      mapBorderFog?.dispose();
      particles?.dispose();
      mapDecorations?.dispose();
      envMap?.dispose();
    }, 100);

    // Clear references
    this.trees = null;
    this.rocks = null;
    this.crystals = null;
    this.grass = null;
    this.pebbles = null;
    this.unifiedWaterMesh = null;
    this.waterMaterial = null;
    this.mapBorderFog = null;
    this.particles = null;
    this.mapDecorations = null;
    this.envMap = null;
    this.renderer = null;
  }
}
