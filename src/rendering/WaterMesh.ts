/**
 * WaterMesh - Localized water surface rendering using Three.js WaterMesh addon
 *
 * Creates animated water surfaces at locations where water_shallow/water_deep
 * terrain features exist. Uses the official Three.js WaterMesh for realistic
 * reflections and proper water appearance.
 *
 * Features:
 * - Real scene reflections via Three.js WaterMesh
 * - Proper water normal map animation
 * - Physically-based fresnel and specular
 * - Flood-fill region detection for efficient mesh creation
 * - Frustum culling for performance
 * - Quality settings (low/medium/high/ultra)
 */

import * as THREE from 'three';
import { WaterMesh as ThreeWaterMesh } from 'three/addons/objects/WaterMesh.js';
import type { MapData, MapCell } from '@/data/maps/MapTypes';
import type { BiomeConfig } from './Biomes';

// Height scale factor (matches Terrain.ts)
const HEIGHT_SCALE = 0.04;

// Water surface offset above terrain
const WATER_SURFACE_OFFSET = 0.15;

// Water quality type
export type WaterQuality = 'low' | 'medium' | 'high' | 'ultra';

// Quality settings configuration
interface WaterQualityConfig {
  size: number; // Texture scale (larger = finer detail)
  distortionScale: number; // Wave distortion amount
  resolutionScale: number; // Reflection resolution multiplier
}

const WATER_QUALITY_CONFIGS: Record<WaterQuality, WaterQualityConfig> = {
  low: {
    size: 50.0, // Very fine pattern, appears calmer
    distortionScale: 0.5,
    resolutionScale: 0.25,
  },
  medium: {
    size: 40.0,
    distortionScale: 0.75,
    resolutionScale: 0.5,
  },
  high: {
    size: 30.0,
    distortionScale: 1.0,
    resolutionScale: 0.75,
  },
  ultra: {
    size: 25.0, // More visible waves
    distortionScale: 1.25,
    resolutionScale: 1.0,
  },
};

// Cached water normals texture (shared across all instances)
let waterNormalsTexture: THREE.Texture | null = null;
let textureLoading = false;

/**
 * Load the water normals texture from file
 * Called once at startup, texture is then cached
 */
function loadWaterNormalsTexture(): void {
  if (waterNormalsTexture || textureLoading) return;

  textureLoading = true;
  const loader = new THREE.TextureLoader();

  loader.load(
    '/textures/waternormals.jpg',
    (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      waterNormalsTexture = texture;
      console.log('Water normals texture loaded successfully');
    },
    undefined,
    (error) => {
      console.error('Failed to load water normals texture:', error);
    }
  );
}

// Start loading immediately when module is imported (browser only)
if (typeof window !== 'undefined') {
  loadWaterNormalsTexture();
}

/**
 * Get the water normals texture
 * Returns the loaded texture, or a generated fallback if not yet loaded
 */
function getWaterNormals(): THREE.Texture {
  if (waterNormalsTexture) {
    return waterNormalsTexture;
  }

  // Generate a proper fallback with wave patterns
  // This will only be used if texture hasn't loaded yet
  console.warn('Water normals texture not loaded yet, using generated fallback');
  return generateFallbackNormals();
}

/**
 * Generate fallback water normals with actual wave patterns
 */
function generateFallbackNormals(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;

      // Wave patterns
      let nx = Math.sin(u * 8 * Math.PI + v * 4 * Math.PI) * 0.3;
      nx += Math.sin(u * 16 * Math.PI - v * 12 * Math.PI) * 0.2;
      let ny = Math.cos(u * 6 * Math.PI + v * 8 * Math.PI) * 0.3;
      ny += Math.cos(u * 14 * Math.PI + v * 18 * Math.PI) * 0.2;

      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      data[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Preload water normals - call during app initialization
 */
export function preloadWaterNormals(): Promise<void> {
  return new Promise((resolve) => {
    if (waterNormalsTexture) {
      resolve();
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/waternormals.jpg',
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        waterNormalsTexture = texture;
        resolve();
      },
      undefined,
      () => resolve() // Resolve anyway on error
    );
  });
}

export interface WaterRegion {
  cells: Array<{ x: number; y: number; elevation: number; isDeep: boolean }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgElevation: number;
  isDeepRegion: boolean; // Whether this region is deep or shallow water
  hasAdjacentOppositeType: boolean; // Whether this region borders the opposite water type
}

export class WaterMesh {
  public group: THREE.Group;

  private waterMeshes: ThreeWaterMesh[] = [];
  private sunDirection: THREE.Vector3;
  private quality: WaterQuality = 'high';
  private reflectionsEnabled: boolean = true;
  private enabled: boolean = true;

  // Frustum culling helpers
  private frustum: THREE.Frustum = new THREE.Frustum();
  private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();

  constructor() {
    this.group = new THREE.Group();
    this.sunDirection = new THREE.Vector3(0.5, 0.8, 0.5).normalize();
  }

  /**
   * Set water enabled state
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  /**
   * Set water quality level
   */
  public setQuality(quality: WaterQuality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    // Quality changes require rebuilding water meshes
  }

  /**
   * Set whether reflections are enabled
   */
  public setReflectionsEnabled(enabled: boolean): void {
    this.reflectionsEnabled = enabled;
    // Update resolution scale on existing meshes
    const config = WATER_QUALITY_CONFIGS[this.quality];
    const resScale = enabled ? config.resolutionScale : 0;
    for (const mesh of this.waterMeshes) {
      // WaterMesh uses resolutionScale internally for reflections
      if ('resolutionScale' in mesh) {
        (mesh as unknown as { resolutionScale: number }).resolutionScale = resScale;
      }
    }
  }

  /**
   * Get current quality config
   */
  private getQualityConfig(): WaterQualityConfig {
    return WATER_QUALITY_CONFIGS[this.quality];
  }

  /**
   * Build full-map water plane for biomes with hasWater (Ocean, Grassland, Volcanic)
   */
  public buildFullMapWater(mapData: MapData, biome: BiomeConfig): void {
    if (!biome.hasWater || !this.enabled) return;

    const waterNormals = getWaterNormals();
    const config = this.getQualityConfig();

    // Create full-map water plane
    const geometry = new THREE.PlaneGeometry(mapData.width, mapData.height);

    // Determine color based on biome (lava for Volcanic)
    const isLava = biome.name === 'Volcanic';
    const waterColor = isLava ? 0x1a0500 : 0x0066aa; // Ocean blue
    const sunColor = isLava ? 0xff6600 : 0xffffff;

    const water = new ThreeWaterMesh(geometry, {
      waterNormals: waterNormals,
      sunDirection: this.sunDirection,
      sunColor: sunColor,
      waterColor: waterColor,
      distortionScale: config.distortionScale,
      size: config.size,
    });

    water.rotation.x = -Math.PI / 2;
    water.position.set(mapData.width / 2, biome.waterLevel, mapData.height / 2);
    water.renderOrder = 5;

    // Enable frustum culling with proper bounding sphere
    water.frustumCulled = true;
    geometry.computeBoundingSphere();

    this.waterMeshes.push(water);
    this.group.add(water);
  }

  /**
   * Build water meshes from map data
   */
  public buildFromMapData(mapData: MapData): void {
    this.clear();

    const { width, height, terrain } = mapData;

    const visited = new Set<string>();
    const regions: WaterRegion[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = terrain[y]?.[x];
        if (!cell) continue;

        const feature = cell.feature || 'none';
        if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

        const region = this.floodFillWaterRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    for (const region of regions) {
      this.createRegionMesh(region);
    }
  }

  /**
   * Build water meshes from editor map data format
   */
  public buildFromEditorData(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    width: number,
    height: number
  ): void {
    this.clear();

    const visited = new Set<string>();
    const regions: WaterRegion[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const cell = terrain[y]?.[x];
        if (!cell) continue;

        const feature = cell.feature || 'none';
        if (feature !== 'water_shallow' && feature !== 'water_deep') continue;

        const region = this.floodFillEditorRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    for (const region of regions) {
      this.createRegionMesh(region);
    }
  }

  private floodFillWaterRegion(
    terrain: MapCell[][],
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion {
    const cells: WaterRegion['cells'] = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX,
      maxX = startX,
      minY = startY,
      maxY = startY;
    let totalElevation = 0;
    let hasAdjacentOppositeType = false;

    // Determine the type of water we're flood filling (based on start cell)
    const startCell = terrain[startY]?.[startX];
    const startFeature = startCell?.feature || 'none';
    const isDeepRegion = startFeature === 'water_deep';
    const targetFeature = isDeepRegion ? 'water_deep' : 'water_shallow';
    const oppositeFeature = isDeepRegion ? 'water_shallow' : 'water_deep';

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const cell = terrain[y]?.[x];
      if (!cell) continue;

      const feature = cell.feature || 'none';

      // Only flood fill same type of water
      if (feature !== targetFeature) {
        // Check if this is the opposite water type (for boundary detection)
        if (feature === oppositeFeature) {
          hasAdjacentOppositeType = true;
        }
        continue;
      }

      visited.add(key);

      const isDeep = feature === 'water_deep';
      cells.push({ x, y, elevation: cell.elevation, isDeep });

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      totalElevation += cell.elevation;

      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    return {
      cells,
      minX,
      maxX,
      minY,
      maxY,
      avgElevation: cells.length > 0 ? totalElevation / cells.length : 0,
      isDeepRegion,
      hasAdjacentOppositeType,
    };
  }

  private floodFillEditorRegion(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion {
    const cells: WaterRegion['cells'] = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX,
      maxX = startX,
      minY = startY,
      maxY = startY;
    let totalElevation = 0;
    let hasAdjacentOppositeType = false;

    // Determine the type of water we're flood filling (based on start cell)
    const startCell = terrain[startY]?.[startX];
    const startFeature = startCell?.feature || 'none';
    const isDeepRegion = startFeature === 'water_deep';
    const targetFeature = isDeepRegion ? 'water_deep' : 'water_shallow';
    const oppositeFeature = isDeepRegion ? 'water_shallow' : 'water_deep';

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const cell = terrain[y]?.[x];
      if (!cell) continue;

      const feature = cell.feature || 'none';

      // Only flood fill same type of water
      if (feature !== targetFeature) {
        // Check if this is the opposite water type (for boundary detection)
        if (feature === oppositeFeature) {
          hasAdjacentOppositeType = true;
        }
        continue;
      }

      visited.add(key);

      const isDeep = feature === 'water_deep';
      cells.push({ x, y, elevation: cell.elevation, isDeep });

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      totalElevation += cell.elevation;

      queue.push({ x: x - 1, y });
      queue.push({ x: x + 1, y });
      queue.push({ x, y: y - 1 });
      queue.push({ x, y: y + 1 });
    }

    return {
      cells,
      minX,
      maxX,
      minY,
      maxY,
      avgElevation: cells.length > 0 ? totalElevation / cells.length : 0,
      isDeepRegion,
      hasAdjacentOppositeType,
    };
  }

  private createRegionMesh(region: WaterRegion): void {
    if (region.cells.length === 0 || !this.enabled) return;

    const waterNormals = getWaterNormals();
    const config = this.getQualityConfig();

    // Calculate region dimensions
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    // Shallow water config: lighter, calmer, more translucent
    const isShallow = !region.isDeepRegion;

    // For shallow water at boundaries, extend slightly for blending
    const blendExtend = isShallow && region.hasAdjacentOppositeType ? 0.3 : 0;
    const meshWidth = regionWidth + blendExtend * 2;
    const meshHeight = regionHeight + blendExtend * 2;

    // Create plane geometry for this region
    const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);

    // Water visual properties differ by type
    // Deep: darker blue, more distortion, opaque
    // Shallow: lighter cyan/turquoise, calmer, semi-transparent
    const waterColor = isShallow ? 0x40a0c0 : 0x004488;
    const distortionScale = isShallow
      ? config.distortionScale * 0.4 // Calmer waves for shallow
      : config.distortionScale;
    const textureSize = isShallow
      ? config.size * 1.5 // Finer pattern for shallow (larger = finer)
      : config.size;

    // Create Three.js WaterMesh
    const water = new ThreeWaterMesh(geometry, {
      waterNormals: waterNormals,
      sunDirection: this.sunDirection,
      sunColor: 0xffffff,
      waterColor: waterColor,
      distortionScale: distortionScale,
      size: textureSize,
    });

    // Make shallow water semi-transparent for terrain visibility and blending
    if (isShallow) {
      water.material.transparent = true;
      water.material.opacity = 0.75;
      water.material.depthWrite = false; // Prevents z-fighting with deep water
    }

    // Calculate center position and height
    const centerX = region.minX + regionWidth / 2;
    const centerZ = region.minY + regionHeight / 2;
    const avgHeight = region.avgElevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

    // Shallow water renders slightly higher for visual blending at boundaries
    const heightOffset = isShallow ? 0.02 : 0;

    // Position the water mesh
    water.rotation.x = -Math.PI / 2;
    water.position.set(centerX, avgHeight + heightOffset, centerZ);

    // Render order: deep water first (1), shallow water on top (2) for proper blending
    water.renderOrder = isShallow ? 2 : 1;

    // Enable frustum culling with proper bounding sphere
    water.frustumCulled = true;
    geometry.computeBoundingSphere();

    this.waterMeshes.push(water);
    this.group.add(water);
  }

  /**
   * Update water meshes - handles frustum culling
   * Call once per frame with current camera
   */
  public update(_deltaTime: number, camera?: THREE.Camera): void {
    // WaterMesh animates automatically via TSL's built-in time uniform
    // Frustum culling is handled automatically by Three.js when frustumCulled = true
    // But we can do manual culling for performance if needed
    if (!this.enabled || !camera) return;

    // Update frustum for manual visibility checks if needed
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  /**
   * Check if a water mesh is visible in the current frustum
   */
  public isVisible(mesh: THREE.Mesh): boolean {
    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere();
    }
    const sphere = mesh.geometry.boundingSphere!.clone();
    sphere.applyMatrix4(mesh.matrixWorld);
    return this.frustum.intersectsSphere(sphere);
  }

  /**
   * Get visible water mesh count (for debugging)
   */
  public getVisibleCount(): number {
    return this.waterMeshes.filter((m) => m.visible).length;
  }

  /**
   * Get total water mesh count
   */
  public getTotalCount(): number {
    return this.waterMeshes.length;
  }

  /**
   * Set sun direction for all water meshes
   */
  public setSunDirection(x: number, y: number, z: number): void {
    this.sunDirection.set(x, y, z).normalize();
  }

  /**
   * Clear all water meshes
   */
  public clear(): void {
    for (const mesh of this.waterMeshes) {
      mesh.geometry.dispose();
      if (mesh.material) {
        (mesh.material as THREE.Material).dispose();
      }
      this.group.remove(mesh);
    }
    this.waterMeshes = [];
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.clear();
  }
}
