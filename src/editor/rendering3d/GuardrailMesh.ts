/**
 * GuardrailMesh - Renders small decorative rails along platform cliff edges
 *
 * SC2-style guardrails are thin raised borders that run along the top
 * of cliff edges, providing visual definition to platform boundaries.
 *
 * Features:
 * - Instanced rendering for performance
 * - Configurable rail height and width
 * - Biome-aware coloring
 * - Corner handling
 */

import * as THREE from 'three';
import type { EditorMapData } from '../config/EditorConfig';
import { EdgeDetector, type CellEdgeInfo } from '../terrain/EdgeDetector';

/** Height scale factor - matches terrain rendering */
const HEIGHT_SCALE = 0.04;

/** Guardrail dimensions */
const RAIL_HEIGHT = 0.3;  // Height above platform surface
const RAIL_WIDTH = 0.15;  // Width of the rail
const RAIL_INSET = 0.05;  // How far from the edge

/** Biome guardrail colors (slightly lighter than cliff) */
const BIOME_RAIL_COLORS: Record<string, [number, number, number]> = {
  grassland: [0.45, 0.45, 0.40],
  desert: [0.65, 0.55, 0.45],
  frozen: [0.60, 0.65, 0.75],
  volcanic: [0.35, 0.25, 0.25],
  void: [0.35, 0.25, 0.45],
  jungle: [0.40, 0.45, 0.40],
  ice: [0.60, 0.65, 0.75],
  swamp: [0.40, 0.45, 0.35],
};

/** Default rail color */
const DEFAULT_RAIL_COLOR: [number, number, number] = [0.5, 0.5, 0.5];

export interface GuardrailMeshConfig {
  cellSize?: number;
  railHeight?: number;
  railWidth?: number;
}

/**
 * GuardrailMesh renders decorative rails along platform edges
 */
export class GuardrailMesh {
  public mesh: THREE.Mesh;
  public visible: boolean = true;

  private cellSize: number;
  private railHeight: number;
  private railWidth: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshLambertMaterial;
  private edgeDetector: EdgeDetector;

  // Pre-allocated buffers
  private positions: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private normals: Float32Array | null = null;
  private indices: Uint32Array | null = null;

  // Tracking
  private currentBiome: string = 'grassland';
  private vertexCount: number = 0;
  private indexCount: number = 0;

  constructor(config: GuardrailMeshConfig = {}) {
    this.cellSize = config.cellSize ?? 1;
    this.railHeight = config.railHeight ?? RAIL_HEIGHT;
    this.railWidth = config.railWidth ?? RAIL_WIDTH;
    this.edgeDetector = new EdgeDetector();

    this.geometry = new THREE.BufferGeometry();

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
  }

  /**
   * Build guardrail geometry from map data
   */
  public buildFromMapData(mapData: EditorMapData): void {
    this.edgeDetector.setMapData(mapData);
    this.currentBiome = mapData.biomeId;

    const cliffCells = this.edgeDetector.getCliffCells();
    this.buildGeometry(cliffCells);
  }

  /**
   * Update guardrails in a region
   */
  public updateRegion(
    mapData: EditorMapData,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells.push({ x, y });
      }
    }
    this.edgeDetector.invalidateCells(cells);
    this.buildFromMapData(mapData);
  }

  /**
   * Set visibility
   */
  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.mesh.visible = visible;
  }

  /**
   * Dispose resources
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
   * Build geometry from cliff cells
   */
  private buildGeometry(cliffCells: CellEdgeInfo[]): void {
    if (cliffCells.length === 0 || !this.visible) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
      return;
    }

    // Count rail segments needed
    // Each rail segment is a box (8 vertices, 12 triangles = 36 indices)
    // But we use quads for simplicity (5 faces visible = 5 quads = 20 vertices, 30 indices)
    let totalSegments = 0;
    for (const cell of cliffCells) {
      if (cell.north.type === 'cliff') totalSegments++;
      if (cell.south.type === 'cliff') totalSegments++;
      if (cell.east.type === 'cliff') totalSegments++;
      if (cell.west.type === 'cliff') totalSegments++;
    }

    // Each segment = 5 visible faces = 20 vertices, 30 indices
    const vertexCount = totalSegments * 20;
    const indexCount = totalSegments * 30;

    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.indices = new Uint32Array(indexCount);

    this.vertexCount = 0;
    this.indexCount = 0;

    const railColor = BIOME_RAIL_COLORS[this.currentBiome] || DEFAULT_RAIL_COLOR;

    for (const cell of cliffCells) {
      const worldX = cell.x * this.cellSize;
      const worldY = cell.y * this.cellSize;
      const topHeight = cell.elevation * HEIGHT_SCALE;

      // North rail
      if (cell.north.type === 'cliff') {
        this.addRailSegment(
          worldX + RAIL_INSET,
          worldY + RAIL_INSET,
          worldX + this.cellSize - RAIL_INSET,
          worldY + RAIL_INSET,
          topHeight,
          railColor
        );
      }

      // South rail
      if (cell.south.type === 'cliff') {
        this.addRailSegment(
          worldX + RAIL_INSET,
          worldY + this.cellSize - RAIL_INSET,
          worldX + this.cellSize - RAIL_INSET,
          worldY + this.cellSize - RAIL_INSET,
          topHeight,
          railColor
        );
      }

      // East rail
      if (cell.east.type === 'cliff') {
        this.addRailSegment(
          worldX + this.cellSize - RAIL_INSET,
          worldY + RAIL_INSET,
          worldX + this.cellSize - RAIL_INSET,
          worldY + this.cellSize - RAIL_INSET,
          topHeight,
          railColor
        );
      }

      // West rail
      if (cell.west.type === 'cliff') {
        this.addRailSegment(
          worldX + RAIL_INSET,
          worldY + RAIL_INSET,
          worldX + RAIL_INSET,
          worldY + this.cellSize - RAIL_INSET,
          topHeight,
          railColor
        );
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.geometry.computeBoundingSphere();
  }

  /**
   * Add a rail segment (thin box along an edge)
   */
  private addRailSegment(
    x1: number, y1: number,
    x2: number, y2: number,
    baseHeight: number,
    color: [number, number, number]
  ): void {
    if (!this.positions || !this.colors || !this.normals || !this.indices) return;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;

    // Perpendicular direction for width
    const perpX = -dy / len * this.railWidth / 2;
    const perpY = dx / len * this.railWidth / 2;

    const z0 = baseHeight;
    const z1 = baseHeight + this.railHeight;

    // 8 corners of the box
    const corners = [
      // Bottom face (z0)
      { x: x1 - perpX, y: y1 - perpY, z: z0 }, // 0: start, left
      { x: x1 + perpX, y: y1 + perpY, z: z0 }, // 1: start, right
      { x: x2 + perpX, y: y2 + perpY, z: z0 }, // 2: end, right
      { x: x2 - perpX, y: y2 - perpY, z: z0 }, // 3: end, left
      // Top face (z1)
      { x: x1 - perpX, y: y1 - perpY, z: z1 }, // 4: start, left
      { x: x1 + perpX, y: y1 + perpY, z: z1 }, // 5: start, right
      { x: x2 + perpX, y: y2 + perpY, z: z1 }, // 6: end, right
      { x: x2 - perpX, y: y2 - perpY, z: z1 }, // 7: end, left
    ];

    // Add 5 visible faces (bottom not visible)
    // Top face
    this.addQuad(
      corners[4].x, corners[4].y, corners[4].z,
      corners[5].x, corners[5].y, corners[5].z,
      corners[6].x, corners[6].y, corners[6].z,
      corners[7].x, corners[7].y, corners[7].z,
      0, 0, 1,
      color
    );

    // Front face (along length, perpendicular +)
    this.addQuad(
      corners[1].x, corners[1].y, corners[1].z,
      corners[5].x, corners[5].y, corners[5].z,
      corners[6].x, corners[6].y, corners[6].z,
      corners[2].x, corners[2].y, corners[2].z,
      perpX / (this.railWidth / 2), perpY / (this.railWidth / 2), 0,
      this.darken(color, 0.85)
    );

    // Back face (along length, perpendicular -)
    this.addQuad(
      corners[3].x, corners[3].y, corners[3].z,
      corners[7].x, corners[7].y, corners[7].z,
      corners[4].x, corners[4].y, corners[4].z,
      corners[0].x, corners[0].y, corners[0].z,
      -perpX / (this.railWidth / 2), -perpY / (this.railWidth / 2), 0,
      this.darken(color, 0.85)
    );

    // Start cap
    this.addQuad(
      corners[0].x, corners[0].y, corners[0].z,
      corners[4].x, corners[4].y, corners[4].z,
      corners[5].x, corners[5].y, corners[5].z,
      corners[1].x, corners[1].y, corners[1].z,
      -dx / len, -dy / len, 0,
      this.darken(color, 0.7)
    );

    // End cap
    this.addQuad(
      corners[2].x, corners[2].y, corners[2].z,
      corners[6].x, corners[6].y, corners[6].z,
      corners[7].x, corners[7].y, corners[7].z,
      corners[3].x, corners[3].y, corners[3].z,
      dx / len, dy / len, 0,
      this.darken(color, 0.7)
    );
  }

  /**
   * Add a quad to the geometry
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
    const vi = baseVertex * 3;

    // 4 vertices
    const verts = [
      [x0, y0, z0], [x1, y1, z1], [x2, y2, z2], [x3, y3, z3]
    ];

    for (let i = 0; i < 4; i++) {
      const idx = vi + i * 3;
      this.positions[idx] = verts[i][0];
      this.positions[idx + 1] = -verts[i][1]; // Flip Y
      this.positions[idx + 2] = verts[i][2];
      this.normals[idx] = nx;
      this.normals[idx + 1] = -ny;
      this.normals[idx + 2] = nz;
      this.colors[idx] = color[0];
      this.colors[idx + 1] = color[1];
      this.colors[idx + 2] = color[2];
    }

    this.vertexCount += 4;

    // 2 triangles
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
   * Darken a color
   */
  private darken(color: [number, number, number], factor: number): [number, number, number] {
    return [color[0] * factor, color[1] * factor, color[2] * factor];
  }
}

export default GuardrailMesh;
