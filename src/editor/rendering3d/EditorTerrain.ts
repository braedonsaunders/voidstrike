/**
 * EditorTerrain - 3D terrain mesh for the map editor
 *
 * Renders EditorMapData as a 3D terrain mesh with real-time updates.
 * Supports chunked updates for efficient painting.
 */

import * as THREE from 'three';
import type { EditorMapData, EditorCell } from '../config/EditorConfig';
import type { BiomeConfig } from '../config/EditorConfig';

// Chunk size for efficient partial updates
const CHUNK_SIZE = 16;

// Height scale factor (matches game terrain)
const HEIGHT_SCALE = 0.04;

// Editor biome colors (matches game biomes)
const EDITOR_BIOME_COLORS: Record<string, { ground: THREE.Color[]; cliff: THREE.Color[] }> = {
  grassland: {
    ground: [
      new THREE.Color(0x3a6b35),
      new THREE.Color(0x4a8b45),
      new THREE.Color(0x2d5a28),
    ],
    cliff: [new THREE.Color(0x5a5a5a), new THREE.Color(0x4a4a4a)],
  },
  desert: {
    ground: [
      new THREE.Color(0xc4a35a),
      new THREE.Color(0xd4b36a),
      new THREE.Color(0xb4934a),
    ],
    cliff: [new THREE.Color(0x8b6b4a), new THREE.Color(0x7b5b3a)],
  },
  frozen: {
    ground: [
      new THREE.Color(0xc8d8e8),
      new THREE.Color(0xe0f0ff),
      new THREE.Color(0xa0b8c8),
    ],
    cliff: [new THREE.Color(0x7888a0), new THREE.Color(0x687890)],
  },
  volcanic: {
    ground: [
      new THREE.Color(0x2a2a2a),
      new THREE.Color(0x3a3a3a),
      new THREE.Color(0x1a1a1a),
    ],
    cliff: [new THREE.Color(0x3a3030), new THREE.Color(0x2a2020)],
  },
  void: {
    ground: [
      new THREE.Color(0x1a1030),
      new THREE.Color(0x2a2040),
      new THREE.Color(0x100820),
    ],
    cliff: [new THREE.Color(0x2a2040), new THREE.Color(0x1a1030)],
  },
  jungle: {
    ground: [
      new THREE.Color(0x2a4a25),
      new THREE.Color(0x3a5a35),
      new THREE.Color(0x1a3a15),
    ],
    cliff: [new THREE.Color(0x4a5a4a), new THREE.Color(0x3a4a3a)],
  },
};

// Feature colors for terrain features
const FEATURE_COLORS: Record<string, THREE.Color> = {
  none: new THREE.Color(1, 1, 1),
  water_shallow: new THREE.Color(0.4, 0.6, 0.9),
  water_deep: new THREE.Color(0.2, 0.3, 0.7),
  forest_light: new THREE.Color(0.5, 0.7, 0.4),
  forest_dense: new THREE.Color(0.3, 0.5, 0.2),
  mud: new THREE.Color(0.5, 0.4, 0.25),
  road: new THREE.Color(0.7, 0.65, 0.55),
  void: new THREE.Color(0.15, 0.1, 0.25),
  cliff: new THREE.Color(0.45, 0.4, 0.35),
};

export interface EditorTerrainConfig {
  cellSize?: number;
}

export class EditorTerrain {
  public mesh: THREE.Mesh;
  public mapData: EditorMapData | null = null;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;

  // Heightmap for raycasting
  private heightMap: Float32Array;
  private gridWidth: number = 0;
  private gridHeight: number = 0;

  // Dirty chunks for efficient updates
  private dirtyChunks: Set<string> = new Set();

  constructor(config: EditorTerrainConfig = {}) {
    this.cellSize = config.cellSize ?? 1;
    this.heightMap = new Float32Array(0);

    // Create initial empty geometry
    this.geometry = new THREE.BufferGeometry();

    // Create material with vertex colors
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.rotation.x = -Math.PI / 2;
  }

  /**
   * Load map data and rebuild the entire terrain
   */
  public loadMap(mapData: EditorMapData): void {
    this.mapData = mapData;
    this.gridWidth = mapData.width + 1;
    this.gridHeight = mapData.height + 1;
    this.heightMap = new Float32Array(this.gridWidth * this.gridHeight);

    this.rebuildGeometry();
  }

  /**
   * Mark cells as dirty for efficient partial updates
   */
  public markCellsDirty(cells: Array<{ x: number; y: number }>): void {
    for (const { x, y } of cells) {
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkY = Math.floor(y / CHUNK_SIZE);
      this.dirtyChunks.add(`${chunkX},${chunkY}`);
    }
  }

  /**
   * Update dirty chunks (call after painting)
   */
  public updateDirtyChunks(): void {
    if (this.dirtyChunks.size === 0 || !this.mapData) return;

    // For simplicity, rebuild entire geometry if chunks are dirty
    // Could be optimized to only update specific vertex ranges
    this.rebuildGeometry();
    this.dirtyChunks.clear();
  }

  /**
   * Force full terrain rebuild
   */
  public forceUpdate(): void {
    if (this.mapData) {
      this.rebuildGeometry();
    }
  }

  /**
   * Get terrain height at world position
   */
  public getHeightAt(x: number, z: number): number {
    if (!this.mapData) return 0;

    // Convert world to grid coordinates
    const gridX = Math.floor(x / this.cellSize);
    const gridZ = Math.floor(z / this.cellSize);

    if (gridX < 0 || gridX >= this.gridWidth - 1 || gridZ < 0 || gridZ >= this.gridHeight - 1) {
      return 0;
    }

    // Bilinear interpolation
    const fx = (x / this.cellSize) - gridX;
    const fz = (z / this.cellSize) - gridZ;

    const h00 = this.heightMap[gridZ * this.gridWidth + gridX];
    const h10 = this.heightMap[gridZ * this.gridWidth + gridX + 1];
    const h01 = this.heightMap[(gridZ + 1) * this.gridWidth + gridX];
    const h11 = this.heightMap[(gridZ + 1) * this.gridWidth + gridX + 1];

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;

    return h0 * (1 - fz) + h1 * fz;
  }

  /**
   * Convert world position to grid coordinates
   */
  public worldToGrid(x: number, z: number): { x: number; y: number } | null {
    if (!this.mapData) return null;

    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(z / this.cellSize);

    if (gridX < 0 || gridX >= this.mapData.width || gridY < 0 || gridY >= this.mapData.height) {
      return null;
    }

    return { x: gridX, y: gridY };
  }

  /**
   * Change biome and update colors
   */
  public setBiome(biomeId: string): void {
    if (this.mapData) {
      this.mapData.biomeId = biomeId;
      this.rebuildGeometry();
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * Rebuild the entire geometry from map data
   */
  private rebuildGeometry(): void {
    if (!this.mapData) return;

    const { width, height, terrain, biomeId } = this.mapData;
    const cellSize = this.cellSize;

    const biomeColors = EDITOR_BIOME_COLORS[biomeId] || EDITOR_BIOME_COLORS.grassland;

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // Build vertex grid with height values
    const vertexGrid: THREE.Vector3[][] = [];

    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const baseHeight = cell.elevation * HEIGHT_SCALE;

        // Add subtle noise for visual interest
        const noise = this.simpleNoise(x * 0.1, y * 0.1) * 0.02;
        const finalHeight = baseHeight + (cell.walkable ? noise : noise * 0.5);

        vertexGrid[y][x] = new THREE.Vector3(
          x * cellSize,
          -y * cellSize, // Negative Y for correct orientation after rotation
          finalHeight
        );

        // Store in heightmap
        this.heightMap[y * this.gridWidth + x] = finalHeight;
      }
    }

    // Generate vertices with smoothed normals
    let vertexIndex = 0;
    const vertexIndices: number[][] = [];

    for (let y = 0; y <= height; y++) {
      vertexIndices[y] = [];
      for (let x = 0; x <= width; x++) {
        const pos = vertexGrid[y][x];
        vertices.push(pos.x, pos.y, pos.z);

        // Calculate color based on cell properties
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const color = this.getCellColor(cell, biomeColors, x, y);
        colors.push(color.r, color.g, color.b);

        // UVs for potential texturing
        uvs.push(x / width, y / height);

        // Calculate normal from neighboring heights
        const normal = this.calculateNormal(vertexGrid, x, y, width, height);
        normals.push(normal.x, normal.y, normal.z);

        vertexIndices[y][x] = vertexIndex++;
      }
    }

    // Generate triangle indices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tl = vertexIndices[y][x];
        const tr = vertexIndices[y][x + 1];
        const bl = vertexIndices[y + 1][x];
        const br = vertexIndices[y + 1][x + 1];

        // Two triangles per quad
        indices.push(tl, bl, tr);
        indices.push(tr, bl, br);
      }
    }

    // Update geometry
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();

    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    this.mesh.geometry = this.geometry;
  }

  /**
   * Sample terrain cell with bounds checking and interpolation
   */
  private sampleTerrain(
    terrain: EditorCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): EditorCell {
    // Clamp to valid range
    const cx = Math.min(Math.max(0, x), width - 1);
    const cy = Math.min(Math.max(0, y), height - 1);

    return terrain[cy]?.[cx] || {
      elevation: 128,
      feature: 'none',
      walkable: true,
    };
  }

  /**
   * Get color for a cell based on elevation, feature, and biome
   */
  private getCellColor(
    cell: EditorCell,
    biomeColors: { ground: THREE.Color[]; cliff: THREE.Color[] },
    x: number,
    y: number
  ): THREE.Color {
    // Base color from elevation
    const normalizedElev = cell.elevation / 255;
    const colorIndex = Math.floor(normalizedElev * biomeColors.ground.length);
    const baseColor = biomeColors.ground[Math.min(colorIndex, biomeColors.ground.length - 1)].clone();

    // Apply feature color if present
    if (cell.feature && cell.feature !== 'none') {
      const featureColor = FEATURE_COLORS[cell.feature];
      if (featureColor) {
        baseColor.multiply(featureColor);
      }
    }

    // Darken unwalkable areas
    if (!cell.walkable) {
      const cliffColor = biomeColors.cliff[0];
      baseColor.lerp(cliffColor, 0.7);
    }

    // Add subtle variation
    const variation = this.simpleNoise(x * 0.3, y * 0.3) * 0.05;
    baseColor.r = Math.max(0, Math.min(1, baseColor.r + variation));
    baseColor.g = Math.max(0, Math.min(1, baseColor.g + variation));
    baseColor.b = Math.max(0, Math.min(1, baseColor.b + variation));

    return baseColor;
  }

  /**
   * Calculate normal vector for a vertex
   */
  private calculateNormal(
    grid: THREE.Vector3[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): THREE.Vector3 {
    const current = grid[y][x];

    // Get neighboring heights
    const left = x > 0 ? grid[y][x - 1] : current;
    const right = x < width ? grid[y][x + 1] : current;
    const up = y > 0 ? grid[y - 1][x] : current;
    const down = y < height ? grid[y + 1][x] : current;

    // Calculate normal from height differences
    const normal = new THREE.Vector3(
      (left.z - right.z) * 0.5,
      (up.z - down.z) * 0.5,
      1
    );

    return normal.normalize();
  }

  /**
   * Simple noise function for variation
   */
  private simpleNoise(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n) - 0.5;
  }
}

export default EditorTerrain;
