import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { BIOMES, BiomeConfig } from './Biomes';
import { Terrain, MapDecorations } from './Terrain';
import { InstancedGrass, GroundDebris, CrystalField, WaterPlane } from './GroundDetail';
import { EnhancedTrees, EnhancedRocks, EnvironmentParticles } from './EnhancedDecorations';

/**
 * Manages all environmental rendering for a map including:
 * - Terrain mesh
 * - Biome-specific decorations (trees, rocks, crystals)
 * - Ground detail (grass, debris)
 * - Water/lava planes
 * - Particle effects (snow, dust, ash)
 * - Lighting and fog
 */
export class EnvironmentManager {
  public terrain: Terrain;
  public biome: BiomeConfig;

  private scene: THREE.Scene;
  private mapData: MapData;

  // Enhanced decoration systems
  private trees: EnhancedTrees | null = null;
  private rocks: EnhancedRocks | null = null;
  private grass: InstancedGrass | null = null;
  private debris: GroundDebris | null = null;
  private crystals: CrystalField | null = null;
  private water: WaterPlane | null = null;
  private particles: EnvironmentParticles | null = null;
  private legacyDecorations: MapDecorations | null = null;

  // Lighting
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  constructor(scene: THREE.Scene, mapData: MapData) {
    this.scene = scene;
    this.mapData = mapData;
    this.biome = BIOMES[mapData.biome || 'grassland'];

    // Create terrain
    this.terrain = new Terrain({ mapData });
    scene.add(this.terrain.mesh);

    // Setup lighting based on biome
    this.ambientLight = new THREE.AmbientLight(this.biome.colors.ambient, 0.6);
    scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(this.biome.colors.sun, 1.2);
    this.directionalLight.position.set(50, 80, 50);
    // PERFORMANCE: Disable shadow casting - 2048x2048 shadow maps cause <1 FPS on M1 Macs
    // Shadow mapping is extremely expensive and not essential for RTS gameplay
    this.directionalLight.castShadow = false;
    scene.add(this.directionalLight);

    // Add a fill light to compensate for lack of shadows
    const fillLight = new THREE.DirectionalLight(this.biome.colors.sun, 0.3);
    fillLight.position.set(-30, 40, -30);
    scene.add(fillLight);

    // Setup fog based on biome
    const fogNear = mapData.fogNear ?? 60;
    const fogFar = mapData.fogFar ?? 180;
    scene.fog = new THREE.Fog(this.biome.colors.fog, fogNear, fogFar);
    scene.background = this.biome.colors.sky;

    // Create enhanced decorations
    this.createEnhancedDecorations();
  }

  private createEnhancedDecorations(): void {
    const getHeightAt = this.terrain.getHeightAt.bind(this.terrain);

    // Enhanced trees (biome-specific)
    if (this.biome.treeDensity > 0) {
      this.trees = new EnhancedTrees(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.trees.group);
    }

    // Enhanced rocks
    if (this.biome.rockDensity > 0) {
      this.rocks = new EnhancedRocks(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.rocks.group);
    }

    // Instanced grass
    if (this.biome.grassDensity > 0) {
      this.grass = new InstancedGrass(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.grass.mesh);
    }

    // Ground debris
    if (this.biome.grassDensity > 0 || this.biome.treeDensity > 0.1) {
      this.debris = new GroundDebris(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.debris.group);
    }

    // Crystals (for frozen/void biomes)
    if (this.biome.crystalDensity > 0) {
      this.crystals = new CrystalField(this.mapData, this.biome, getHeightAt);
      this.scene.add(this.crystals.group);
    }

    // Water/lava plane
    if (this.biome.hasWater) {
      this.water = new WaterPlane(this.mapData, this.biome);
      this.scene.add(this.water.mesh);
    }

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
   * Update animated elements (water, particles)
   */
  public update(deltaTime: number, gameTime: number): void {
    if (this.water) {
      this.water.update(gameTime);
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
   * Dispose all resources
   */
  public dispose(): void {
    this.terrain.dispose();
    this.trees?.dispose();
    this.rocks?.dispose();
    this.grass?.dispose();
    this.debris?.dispose();
    this.crystals?.dispose();
    this.water?.dispose();
    this.particles?.dispose();
    this.legacyDecorations?.dispose();

    this.scene.remove(this.terrain.mesh);
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.directionalLight);

    if (this.trees) this.scene.remove(this.trees.group);
    if (this.rocks) this.scene.remove(this.rocks.group);
    if (this.grass) this.scene.remove(this.grass.mesh);
    if (this.debris) this.scene.remove(this.debris.group);
    if (this.crystals) this.scene.remove(this.crystals.group);
    if (this.water) this.scene.remove(this.water.mesh);
    if (this.particles) this.scene.remove(this.particles.points);
    if (this.legacyDecorations) this.scene.remove(this.legacyDecorations.group);
  }
}
