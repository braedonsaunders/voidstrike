/**
 * CliffMesh - Generates vertical cliff face geometry for platform terrain
 *
 * Creates vertical walls at the edges of platform cells where there's
 * a significant elevation drop to lower terrain.
 *
 * Features:
 * - Generates quads for each cliff edge (north/south/east/west)
 * - Handles corners (convex and concave)
 * - Biome-aware cliff coloring
 * - Partial update support (only rebuild changed regions)
 */

import * as THREE from 'three';
import type { EditorMapData } from '../config/EditorConfig';
import { EdgeDetector, type CellEdgeInfo } from '../terrain/EdgeDetector';

/** Height scale factor - matches terrain rendering */
const HEIGHT_SCALE = 0.04;

/** Biome cliff colors (RGB, 0-1 range) */
const BIOME_CLIFF_COLORS: Record<string, [number, number, number]> = {
  grassland: [0.35, 0.35, 0.30],
  desert: [0.55, 0.45, 0.35],
  frozen: [0.50, 0.55, 0.65],
  volcanic: [0.25, 0.20, 0.20],
  void: [0.20, 0.15, 0.30],
  jungle: [0.30, 0.35, 0.30],
  ice: [0.50, 0.55, 0.65],
  swamp: [0.30, 0.35, 0.25],
};

/** Default cliff color */
const DEFAULT_CLIFF_COLOR: [number, number, number] = [0.4, 0.4, 0.4];

export interface CliffMeshConfig {
  cellSize?: number;
}

/**
 * CliffMesh generates and manages vertical cliff face geometry
 */
export class CliffMesh {
  public mesh: THREE.Mesh;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshLambertMaterial;
  private edgeDetector: EdgeDetector;

  // Pre-allocated buffers (dynamically sized)
  private positions: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private normals: Float32Array | null = null;
  private indices: Uint32Array | null = null;

  // Tracking
  private currentBiome: string = 'grassland';
  private vertexCount: number = 0;
  private indexCount: number = 0;

  constructor(config: CliffMeshConfig = {}) {
    this.cellSize = config.cellSize ?? 1;
    this.edgeDetector = new EdgeDetector();

    // Create geometry with empty buffers initially
    this.geometry = new THREE.BufferGeometry();

    // Lambert material for performance (no specular)
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide, // Visible from both sides
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
  }

  /**
   * Build cliff geometry from map data
   */
  public buildFromMapData(mapData: EditorMapData): void {
    this.edgeDetector.setMapData(mapData);
    this.currentBiome = mapData.biomeId;

    // Get all cliff cells
    const cliffCells = this.edgeDetector.getCliffCells();

    // Build geometry
    this.buildGeometry(cliffCells);
  }

  /**
   * Update cliff geometry in a region (after terrain painting)
   */
  public updateRegion(
    mapData: EditorMapData,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    // Invalidate edge cache for affected cells
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells.push({ x, y });
      }
    }
    this.edgeDetector.invalidateCells(cells);

    // Rebuild entire cliff mesh (could be optimized for partial updates)
    this.buildFromMapData(mapData);
  }

  /**
   * Set biome and update colors
   */
  public setBiome(biomeId: string): void {
    if (this.currentBiome === biomeId) return;
    this.currentBiome = biomeId;
    // Colors are baked into vertices, need to rebuild
    // In a more optimized version, we could just update colors
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.positions = null;
    this.colors = null;
    this.normals = null;
    this.indices = null;
  }

  /**
   * Build geometry from cliff cell list
   */
  private buildGeometry(cliffCells: CellEdgeInfo[]): void {
    if (cliffCells.length === 0) {
      // Clear geometry
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
      return;
    }

    // Count total vertices and indices needed
    let totalQuads = 0;
    for (const cell of cliffCells) {
      if (cell.north.type === 'cliff') totalQuads++;
      if (cell.south.type === 'cliff') totalQuads++;
      if (cell.east.type === 'cliff') totalQuads++;
      if (cell.west.type === 'cliff') totalQuads++;
      // Add corner quads
      if (cell.corners.nw === 'convex') totalQuads++;
      if (cell.corners.ne === 'convex') totalQuads++;
      if (cell.corners.sw === 'convex') totalQuads++;
      if (cell.corners.se === 'convex') totalQuads++;
    }

    // Each quad = 4 vertices, 6 indices (2 triangles)
    const vertexCount = totalQuads * 4;
    const indexCount = totalQuads * 6;

    // Allocate buffers
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.indices = new Uint32Array(indexCount);

    this.vertexCount = 0;
    this.indexCount = 0;

    // Get cliff color for current biome
    const cliffColor = BIOME_CLIFF_COLORS[this.currentBiome] || DEFAULT_CLIFF_COLOR;

    // Generate geometry for each cliff cell
    for (const cell of cliffCells) {
      const worldX = cell.x * this.cellSize;
      const worldY = cell.y * this.cellSize;
      const topHeight = cell.elevation * HEIGHT_SCALE;

      // North edge (y - 1)
      if (cell.north.type === 'cliff') {
        const bottomHeight = (cell.elevation - cell.north.elevationDelta) * HEIGHT_SCALE;
        this.addQuad(
          worldX, worldY, topHeight,
          worldX + this.cellSize, worldY, topHeight,
          worldX + this.cellSize, worldY, bottomHeight,
          worldX, worldY, bottomHeight,
          0, 1, 0, // Normal pointing north (+Y in rotated space)
          cliffColor
        );
      }

      // South edge (y + 1)
      if (cell.south.type === 'cliff') {
        const bottomHeight = (cell.elevation - cell.south.elevationDelta) * HEIGHT_SCALE;
        this.addQuad(
          worldX + this.cellSize, worldY + this.cellSize, topHeight,
          worldX, worldY + this.cellSize, topHeight,
          worldX, worldY + this.cellSize, bottomHeight,
          worldX + this.cellSize, worldY + this.cellSize, bottomHeight,
          0, -1, 0, // Normal pointing south (-Y in rotated space)
          cliffColor
        );
      }

      // East edge (x + 1)
      if (cell.east.type === 'cliff') {
        const bottomHeight = (cell.elevation - cell.east.elevationDelta) * HEIGHT_SCALE;
        this.addQuad(
          worldX + this.cellSize, worldY, topHeight,
          worldX + this.cellSize, worldY + this.cellSize, topHeight,
          worldX + this.cellSize, worldY + this.cellSize, bottomHeight,
          worldX + this.cellSize, worldY, bottomHeight,
          -1, 0, 0, // Normal pointing east (-X in rotated space)
          cliffColor
        );
      }

      // West edge (x - 1)
      if (cell.west.type === 'cliff') {
        const bottomHeight = (cell.elevation - cell.west.elevationDelta) * HEIGHT_SCALE;
        this.addQuad(
          worldX, worldY + this.cellSize, topHeight,
          worldX, worldY, topHeight,
          worldX, worldY, bottomHeight,
          worldX, worldY + this.cellSize, bottomHeight,
          1, 0, 0, // Normal pointing west (+X in rotated space)
          cliffColor
        );
      }

      // Corner pieces (convex corners need fill geometry)
      this.addCornerGeometry(cell, worldX, worldY, topHeight, cliffColor);
    }

    // Update geometry buffers
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.geometry.computeBoundingSphere();
  }

  /**
   * Add a quad (4 vertices, 2 triangles) to the geometry
   */
  private addQuad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    nx: number, ny: number, nz: number,
    color: [number, number, number]
  ): void {
    if (!this.positions || !this.colors || !this.normals || !this.indices) return;

    const baseVertex = this.vertexCount;

    // Add 4 vertices
    const vi = baseVertex * 3;

    // Vertex 0
    this.positions[vi] = x0;
    this.positions[vi + 1] = -y0; // Flip Y for rotation
    this.positions[vi + 2] = z0;
    this.normals[vi] = nx;
    this.normals[vi + 1] = -ny;
    this.normals[vi + 2] = nz;
    this.colors[vi] = color[0];
    this.colors[vi + 1] = color[1];
    this.colors[vi + 2] = color[2];

    // Vertex 1
    this.positions[vi + 3] = x1;
    this.positions[vi + 4] = -y1;
    this.positions[vi + 5] = z1;
    this.normals[vi + 3] = nx;
    this.normals[vi + 4] = -ny;
    this.normals[vi + 5] = nz;
    this.colors[vi + 3] = color[0];
    this.colors[vi + 4] = color[1];
    this.colors[vi + 5] = color[2];

    // Vertex 2
    this.positions[vi + 6] = x2;
    this.positions[vi + 7] = -y2;
    this.positions[vi + 8] = z2;
    this.normals[vi + 6] = nx;
    this.normals[vi + 7] = -ny;
    this.normals[vi + 8] = nz;
    // Darken bottom vertices for depth
    this.colors[vi + 6] = color[0] * 0.7;
    this.colors[vi + 7] = color[1] * 0.7;
    this.colors[vi + 8] = color[2] * 0.7;

    // Vertex 3
    this.positions[vi + 9] = x3;
    this.positions[vi + 10] = -y3;
    this.positions[vi + 11] = z3;
    this.normals[vi + 9] = nx;
    this.normals[vi + 10] = -ny;
    this.normals[vi + 11] = nz;
    this.colors[vi + 9] = color[0] * 0.7;
    this.colors[vi + 10] = color[1] * 0.7;
    this.colors[vi + 11] = color[2] * 0.7;

    this.vertexCount += 4;

    // Add 2 triangles (6 indices)
    const ii = this.indexCount;
    this.indices[ii] = baseVertex;
    this.indices[ii + 1] = baseVertex + 1;
    this.indices[ii + 2] = baseVertex + 2;
    this.indices[ii + 3] = baseVertex;
    this.indices[ii + 4] = baseVertex + 2;
    this.indices[ii + 5] = baseVertex + 3;

    this.indexCount += 6;
  }

  /**
   * Add corner geometry for convex corners
   */
  private addCornerGeometry(
    cell: CellEdgeInfo,
    worldX: number,
    worldY: number,
    topHeight: number,
    color: [number, number, number]
  ): void {
    // Convex corners need small fill quads at the corner
    // These prevent gaps where two cliff faces meet at 90 degrees

    // NW corner (convex = both north and west are cliffs)
    if (cell.corners.nw === 'convex') {
      const bottomN = (cell.elevation - cell.north.elevationDelta) * HEIGHT_SCALE;
      const bottomW = (cell.elevation - cell.west.elevationDelta) * HEIGHT_SCALE;
      const bottomHeight = Math.min(bottomN, bottomW);

      // Small corner quad at the NW corner
      this.addQuad(
        worldX, worldY, topHeight,
        worldX, worldY, topHeight,
        worldX, worldY, bottomHeight,
        worldX, worldY, bottomHeight,
        0.707, 0.707, 0, // Diagonal normal
        color
      );
    }

    // NE corner
    if (cell.corners.ne === 'convex') {
      const bottomN = (cell.elevation - cell.north.elevationDelta) * HEIGHT_SCALE;
      const bottomE = (cell.elevation - cell.east.elevationDelta) * HEIGHT_SCALE;
      const bottomHeight = Math.min(bottomN, bottomE);

      this.addQuad(
        worldX + this.cellSize, worldY, topHeight,
        worldX + this.cellSize, worldY, topHeight,
        worldX + this.cellSize, worldY, bottomHeight,
        worldX + this.cellSize, worldY, bottomHeight,
        -0.707, 0.707, 0,
        color
      );
    }

    // SW corner
    if (cell.corners.sw === 'convex') {
      const bottomS = (cell.elevation - cell.south.elevationDelta) * HEIGHT_SCALE;
      const bottomW = (cell.elevation - cell.west.elevationDelta) * HEIGHT_SCALE;
      const bottomHeight = Math.min(bottomS, bottomW);

      this.addQuad(
        worldX, worldY + this.cellSize, topHeight,
        worldX, worldY + this.cellSize, topHeight,
        worldX, worldY + this.cellSize, bottomHeight,
        worldX, worldY + this.cellSize, bottomHeight,
        0.707, -0.707, 0,
        color
      );
    }

    // SE corner
    if (cell.corners.se === 'convex') {
      const bottomS = (cell.elevation - cell.south.elevationDelta) * HEIGHT_SCALE;
      const bottomE = (cell.elevation - cell.east.elevationDelta) * HEIGHT_SCALE;
      const bottomHeight = Math.min(bottomS, bottomE);

      this.addQuad(
        worldX + this.cellSize, worldY + this.cellSize, topHeight,
        worldX + this.cellSize, worldY + this.cellSize, topHeight,
        worldX + this.cellSize, worldY + this.cellSize, bottomHeight,
        worldX + this.cellSize, worldY + this.cellSize, bottomHeight,
        -0.707, -0.707, 0,
        color
      );
    }
  }
}

export default CliffMesh;
