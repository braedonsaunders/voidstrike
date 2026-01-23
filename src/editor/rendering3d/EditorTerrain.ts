/**
 * EditorTerrain - High-performance 3D terrain mesh for the map editor
 *
 * Performance optimizations:
 * - Pre-allocated typed arrays (no GC pressure)
 * - In-place buffer updates (no geometry recreation)
 * - Simplified material (MeshLambertMaterial)
 * - Chunked partial updates
 */

import * as THREE from 'three';
import type { EditorMapData, EditorCell } from '../config/EditorConfig';
import { CliffMesh } from './CliffMesh';
import { GuardrailMesh } from './GuardrailMesh';
import { WaterMesh } from '@/rendering/WaterMesh';
import { clamp } from '@/utils/math';

// Height scale factor (matches game terrain)
const HEIGHT_SCALE = 0.04;

// Editor biome colors (matches game biomes) - pre-computed RGB values
const BIOME_COLORS: Record<string, { ground: [number, number, number][]; cliff: [number, number, number] }> = {
  grassland: {
    ground: [[0.227, 0.420, 0.208], [0.290, 0.545, 0.271], [0.176, 0.353, 0.157]],
    cliff: [0.353, 0.353, 0.353],
  },
  desert: {
    ground: [[0.769, 0.639, 0.353], [0.831, 0.702, 0.416], [0.706, 0.576, 0.290]],
    cliff: [0.545, 0.420, 0.290],
  },
  frozen: {
    ground: [[0.784, 0.847, 0.910], [0.878, 0.941, 1.0], [0.627, 0.722, 0.784]],
    cliff: [0.471, 0.533, 0.627],
  },
  volcanic: {
    ground: [[0.165, 0.165, 0.165], [0.227, 0.227, 0.227], [0.102, 0.102, 0.102]],
    cliff: [0.227, 0.188, 0.188],
  },
  void: {
    ground: [[0.102, 0.063, 0.188], [0.165, 0.125, 0.251], [0.063, 0.031, 0.125]],
    cliff: [0.165, 0.125, 0.251],
  },
  jungle: {
    ground: [[0.165, 0.290, 0.145], [0.227, 0.353, 0.208], [0.102, 0.227, 0.082]],
    cliff: [0.290, 0.353, 0.290],
  },
};

// Feature color multipliers (RGB)
const FEATURE_COLORS: Record<string, [number, number, number]> = {
  none: [1, 1, 1],
  water_shallow: [0.4, 0.6, 0.9],
  water_deep: [0.2, 0.3, 0.7],
  forest_light: [0.5, 0.7, 0.4],
  forest_dense: [0.3, 0.5, 0.2],
  mud: [0.5, 0.4, 0.25],
  road: [0.7, 0.65, 0.55],
  void: [0.15, 0.1, 0.25],
  cliff: [0.45, 0.4, 0.35],
};

export interface EditorTerrainConfig {
  cellSize?: number;
}

export class EditorTerrain {
  public mesh: THREE.Mesh;
  public mapData: EditorMapData | null = null;

  // Platform terrain rendering
  private cliffMesh: CliffMesh;
  private guardrailMesh: GuardrailMesh;
  private waterMesh: WaterMesh;
  private showGuardrails: boolean = true;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshLambertMaterial;

  // Pre-allocated buffers
  private positions: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private normals: Float32Array | null = null;

  // Heightmap for raycasting (pre-allocated)
  private heightMap: Float32Array;
  private gridWidth: number = 0;
  private gridHeight: number = 0;

  // Current biome colors
  private currentBiome: string = 'grassland';

  // Dirty region tracking for partial updates
  private dirtyMinX: number = Infinity;
  private dirtyMaxX: number = -Infinity;
  private dirtyMinY: number = Infinity;
  private dirtyMaxY: number = -Infinity;
  private isDirty: boolean = false;

  constructor(config: EditorTerrainConfig = {}) {
    this.cellSize = config.cellSize ?? 1;
    this.heightMap = new Float32Array(0);

    // Create empty geometry
    this.geometry = new THREE.BufferGeometry();

    // Use Lambert material - faster than Standard
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false; // Always render (editor viewport)

    // Create platform terrain meshes (cliff faces and guardrails)
    this.cliffMesh = new CliffMesh({ cellSize: this.cellSize });
    this.guardrailMesh = new GuardrailMesh({ cellSize: this.cellSize });
    this.waterMesh = new WaterMesh();

    // Add as children (inherits rotation)
    this.mesh.add(this.cliffMesh.mesh);
    this.mesh.add(this.guardrailMesh.mesh);
    this.mesh.add(this.waterMesh.group);
  }

  /**
   * Load map data and build terrain
   */
  public loadMap(mapData: EditorMapData): void {
    this.mapData = mapData;
    this.currentBiome = mapData.biomeId;
    this.gridWidth = mapData.width + 1;
    this.gridHeight = mapData.height + 1;

    const vertexCount = this.gridWidth * this.gridHeight;

    // Allocate buffers
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.heightMap = new Float32Array(vertexCount);

    // Build indices (never changes)
    const indexCount = mapData.width * mapData.height * 6;
    const indices = new Uint32Array(indexCount);
    let idx = 0;

    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const tl = y * this.gridWidth + x;
        const tr = tl + 1;
        const bl = tl + this.gridWidth;
        const br = bl + 1;

        indices[idx++] = tl;
        indices[idx++] = bl;
        indices[idx++] = tr;
        indices[idx++] = tr;
        indices[idx++] = bl;
        indices[idx++] = br;
      }
    }

    // Set up geometry with buffers
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Build all vertices
    this.rebuildAllVertices();

    // Build platform terrain meshes (cliffs and guardrails)
    this.cliffMesh.buildFromMapData(mapData);
    this.guardrailMesh.buildFromMapData(mapData);
    this.guardrailMesh.setVisible(this.showGuardrails);

    // Build water meshes
    this.waterMesh.buildFromEditorData(mapData.terrain, mapData.width, mapData.height);
  }

  /**
   * Mark cells as dirty for partial updates
   */
  public markCellsDirty(cells: Array<{ x: number; y: number }>): void {
    for (const { x, y } of cells) {
      // Expand dirty region (include neighboring vertices)
      this.dirtyMinX = Math.min(this.dirtyMinX, clamp(x - 1, 0, this.gridWidth - 1));
      this.dirtyMaxX = Math.max(this.dirtyMaxX, clamp(x + 2, 0, this.gridWidth - 1));
      this.dirtyMinY = Math.min(this.dirtyMinY, clamp(y - 1, 0, this.gridHeight - 1));
      this.dirtyMaxY = Math.max(this.dirtyMaxY, clamp(y + 2, 0, this.gridHeight - 1));
    }
    this.isDirty = true;
  }

  /**
   * Apply cell updates directly to internal state.
   * This is called synchronously during painting to ensure the mesh
   * reflects updates immediately, before React state propagates.
   */
  public applyCellUpdates(updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>): void {
    if (!this.mapData) return;

    // Apply updates directly to mapData
    for (const { x, y, cell } of updates) {
      if (y >= 0 && y < this.mapData.height && x >= 0 && x < this.mapData.width) {
        const existingCell = this.mapData.terrain[y][x];
        this.mapData.terrain[y][x] = { ...existingCell, ...cell };
      }
    }
  }

  /**
   * Update dirty region (call after painting)
   */
  public updateDirtyChunks(): void {
    if (!this.isDirty || !this.mapData || !this.positions || !this.colors) return;

    const biome = BIOME_COLORS[this.currentBiome] || BIOME_COLORS.grassland;
    const { terrain, width, height } = this.mapData;

    // Update only dirty vertices
    for (let y = this.dirtyMinY; y <= this.dirtyMaxY; y++) {
      for (let x = this.dirtyMinX; x <= this.dirtyMaxX; x++) {
        this.updateVertex(x, y, terrain, width, height, biome);
      }
    }

    // Update normals for dirty region
    this.updateNormalsInRegion(this.dirtyMinX, this.dirtyMaxX, this.dirtyMinY, this.dirtyMaxY);

    // Mark buffers as needing update
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;

    // Update platform meshes in dirty region
    if (this.mapData) {
      this.cliffMesh.updateRegion(
        this.mapData,
        this.dirtyMinX,
        this.dirtyMinY,
        this.dirtyMaxX,
        this.dirtyMaxY
      );
      this.guardrailMesh.updateRegion(
        this.mapData,
        this.dirtyMinX,
        this.dirtyMinY,
        this.dirtyMaxX,
        this.dirtyMaxY
      );
      // Rebuild water meshes (water regions can span large areas, so full rebuild)
      this.waterMesh.buildFromEditorData(this.mapData.terrain, this.mapData.width, this.mapData.height);
    }

    // Reset dirty tracking
    this.dirtyMinX = Infinity;
    this.dirtyMaxX = -Infinity;
    this.dirtyMinY = Infinity;
    this.dirtyMaxY = -Infinity;
    this.isDirty = false;
  }

  /**
   * Force full terrain rebuild
   */
  public forceUpdate(): void {
    if (this.mapData) {
      this.rebuildAllVertices();
      this.cliffMesh.buildFromMapData(this.mapData);
      this.guardrailMesh.buildFromMapData(this.mapData);
      this.waterMesh.buildFromEditorData(this.mapData.terrain, this.mapData.width, this.mapData.height);
    }
  }

  /**
   * Update water animation
   */
  public update(deltaTime: number): void {
    this.waterMesh.update(deltaTime);
  }

  /**
   * Set guardrail visibility
   */
  public setGuardrailsVisible(visible: boolean): void {
    this.showGuardrails = visible;
    this.guardrailMesh.setVisible(visible);
  }

  /**
   * Get guardrail visibility
   */
  public getGuardrailsVisible(): boolean {
    return this.showGuardrails;
  }

  /**
   * Get terrain height at world position (bilinear interpolation)
   */
  public getHeightAt(x: number, z: number): number {
    if (!this.mapData || this.heightMap.length === 0) return 0;

    const gridX = x / this.cellSize;
    const gridZ = z / this.cellSize;

    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);

    if (x0 < 0 || x0 >= this.gridWidth - 1 || z0 < 0 || z0 >= this.gridHeight - 1) {
      return 0;
    }

    const fx = gridX - x0;
    const fz = gridZ - z0;

    const idx00 = z0 * this.gridWidth + x0;
    const h00 = this.heightMap[idx00];
    const h10 = this.heightMap[idx00 + 1];
    const h01 = this.heightMap[idx00 + this.gridWidth];
    const h11 = this.heightMap[idx00 + this.gridWidth + 1];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /**
   * Change biome and update colors
   */
  public setBiome(biomeId: string): void {
    if (this.currentBiome === biomeId) return;
    this.currentBiome = biomeId;
    if (this.mapData) {
      this.mapData.biomeId = biomeId;
      this.rebuildAllVertices();
    }
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.cliffMesh.dispose();
    this.guardrailMesh.dispose();
    this.waterMesh.dispose();
    this.positions = null;
    this.colors = null;
    this.normals = null;
  }

  /**
   * Rebuild all vertices (full update)
   */
  private rebuildAllVertices(): void {
    if (!this.mapData || !this.positions || !this.colors || !this.normals) return;

    const { terrain, width, height } = this.mapData;
    const biome = BIOME_COLORS[this.currentBiome] || BIOME_COLORS.grassland;

    // Update all vertices
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x <= width; x++) {
        this.updateVertex(x, y, terrain, width, height, biome);
      }
    }

    // Calculate all normals
    this.updateNormalsInRegion(0, this.gridWidth - 1, 0, this.gridHeight - 1);

    // Mark all buffers as needing update
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;

    if (posAttr) posAttr.needsUpdate = true;
    if (colorAttr) colorAttr.needsUpdate = true;
    if (normalAttr) normalAttr.needsUpdate = true;

    this.geometry.computeBoundingSphere();
  }

  /**
   * Update a single vertex
   */
  private updateVertex(
    x: number,
    y: number,
    terrain: EditorCell[][],
    width: number,
    height: number,
    biome: { ground: [number, number, number][]; cliff: [number, number, number] }
  ): void {
    if (!this.positions || !this.colors) return;

    const idx = y * this.gridWidth + x;
    const idx3 = idx * 3;

    // Sample terrain cell
    const cx = Math.min(Math.max(0, x), width - 1);
    const cy = Math.min(Math.max(0, y), height - 1);
    const cell = terrain[cy]?.[cx] || { elevation: 128, feature: 'none', walkable: true };

    // Calculate height
    const h = cell.elevation * HEIGHT_SCALE;
    this.heightMap[idx] = h;

    // Position
    this.positions[idx3] = x * this.cellSize;
    this.positions[idx3 + 1] = -y * this.cellSize;
    this.positions[idx3 + 2] = h;

    // Color
    const elevIdx = Math.min(
      Math.floor((cell.elevation / 255) * biome.ground.length),
      biome.ground.length - 1
    );
    let r = biome.ground[elevIdx][0];
    let g = biome.ground[elevIdx][1];
    let b = biome.ground[elevIdx][2];

    // Apply feature color
    const feature = FEATURE_COLORS[cell.feature] || FEATURE_COLORS.none;
    r *= feature[0];
    g *= feature[1];
    b *= feature[2];

    // Platform cells get a distinct gray concrete color
    if (cell.isPlatform) {
      // Override with concrete gray - very distinct from natural terrain
      r = 0.45;
      g = 0.45;
      b = 0.48;
    }

    // Darken unwalkable (but not platforms)
    if (!cell.walkable && !cell.isPlatform) {
      r = r * 0.3 + biome.cliff[0] * 0.7;
      g = g * 0.3 + biome.cliff[1] * 0.7;
      b = b * 0.3 + biome.cliff[2] * 0.7;
    }

    this.colors[idx3] = r;
    this.colors[idx3 + 1] = g;
    this.colors[idx3 + 2] = b;
  }

  /**
   * Update normals in a region
   */
  private updateNormalsInRegion(minX: number, maxX: number, minY: number, maxY: number): void {
    if (!this.normals || !this.positions) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.gridWidth + x;
        const idx3 = idx * 3;

        // Get neighboring heights
        const hL = x > 0 ? this.heightMap[idx - 1] : this.heightMap[idx];
        const hR = x < this.gridWidth - 1 ? this.heightMap[idx + 1] : this.heightMap[idx];
        const hU = y > 0 ? this.heightMap[idx - this.gridWidth] : this.heightMap[idx];
        const hD = y < this.gridHeight - 1 ? this.heightMap[idx + this.gridWidth] : this.heightMap[idx];

        // Calculate normal
        const nx = (hL - hR) * 0.5;
        const ny = (hU - hD) * 0.5;
        const nz = 1;

        // Normalize
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        this.normals[idx3] = nx / len;
        this.normals[idx3 + 1] = ny / len;
        this.normals[idx3 + 2] = nz / len;
      }
    }
  }
}

export default EditorTerrain;
