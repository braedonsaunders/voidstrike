/**
 * UnifiedWaterMesh - Single-draw-call water rendering system
 *
 * Merges all flood-filled water regions into a single BufferGeometry for
 * minimal GPU memory usage and maximum rendering performance. Replaces the
 * previous WaterMesh implementation that created separate ThreeWaterMesh
 * instances per region (which caused 3GB+ VRAM usage on large maps).
 *
 * Features:
 * - Single BufferGeometry containing all water cells
 * - Single material / single draw call for all water
 * - Vertex attributes encode: regionId, isDeep, elevation
 * - Quality tiers control cell merging (1x1, 2x2, 4x4)
 * - Shore transitions included with alpha gradient
 * - Proper bounding sphere for frustum culling
 * - Memory-efficient buffer reuse on rebuild
 */

import * as THREE from 'three';
import { ELEVATION_TO_HEIGHT_FACTOR } from '@/data/pathfinding.config';

// Height scale factor from terrain system
const HEIGHT_SCALE = ELEVATION_TO_HEIGHT_FACTOR;

// Water surface offset above terrain (same as original WaterMesh)
const WATER_SURFACE_OFFSET = 0.15;

// Shore gradient width in world units
const SHORE_WIDTH = 3.0;

// Shore color (light teal/cyan for beach water look)
const SHORE_COLOR = new THREE.Color(0x70d0e0);

/** Water quality tier - controls cell merging for performance vs detail */
export type WaterQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Quality configuration for cell merging and detail level */
interface QualityConfig {
  /** Cell merge factor (1 = no merge, 2 = 2x2, 4 = 4x4) */
  cellMerge: number;
  /** Shore transition detail (lower = fewer shore quads) */
  shoreDetail: number;
}

const QUALITY_CONFIGS: Record<WaterQuality, QualityConfig> = {
  low: { cellMerge: 4, shoreDetail: 0.5 },
  medium: { cellMerge: 2, shoreDetail: 0.75 },
  high: { cellMerge: 1, shoreDetail: 1.0 },
  ultra: { cellMerge: 1, shoreDetail: 1.0 },
};

/**
 * Water cell data from flood-fill algorithm
 */
export interface WaterCell {
  x: number;
  y: number;
  elevation: number;
  isDeep: boolean;
}

/**
 * Water region from flood-fill algorithm
 * Compatible with existing WaterMesh.ts region format
 */
export interface WaterRegion {
  cells: WaterCell[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgElevation: number;
  isDeepRegion: boolean;
  hasAdjacentOppositeType: boolean;
}

/**
 * Shore edge cell with direction info
 */
interface ShoreEdgeCell {
  x: number;
  y: number;
  elevation: number;
  /** Cardinal directions where land borders (0=N, 1=E, 2=S, 3=W) */
  edgeDirections: number[];
}

/**
 * Configuration for UnifiedWaterMesh
 */
export interface UnifiedWaterConfig {
  /** Water quality tier */
  quality: WaterQuality;
  /** TSL material to use for water rendering */
  material: THREE.Material;
}

/**
 * Unified water mesh that merges all regions into a single geometry
 */
export class UnifiedWaterMesh {
  /** Main water mesh (single draw call for all water) */
  public mesh: THREE.Mesh;
  /** Shore transition group (gradient overlays at water-land boundaries) */
  public shoreGroup: THREE.Group;

  private geometry: THREE.BufferGeometry;
  private shoreGeometry: THREE.BufferGeometry | null = null;
  private shoreMesh: THREE.Mesh | null = null;
  private material: THREE.Material;
  private quality: WaterQuality;
  private enabled: boolean = true;

  // Reusable buffer arrays for memory efficiency
  private positionBuffer: Float32Array | null = null;
  private normalBuffer: Float32Array | null = null;
  private uvBuffer: Float32Array | null = null;
  private waterDataBuffer: Float32Array | null = null;
  private indexBuffer: Uint32Array | null = null;

  // Shore buffers
  private shorePositionBuffer: Float32Array | null = null;
  private shoreColorBuffer: Float32Array | null = null;
  private shoreIndexBuffer: Uint32Array | null = null;

  // Statistics
  private totalCells: number = 0;
  private totalVertices: number = 0;
  private totalIndices: number = 0;

  constructor(config: UnifiedWaterConfig) {
    this.quality = config.quality;
    this.material = config.material;

    // Create initial empty geometry
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = true;
    this.mesh.renderOrder = 5; // Water renders after terrain

    // Shore group for transitions
    this.shoreGroup = new THREE.Group();
    this.shoreGroup.renderOrder = 10; // Shore renders on top of water
  }

  /**
   * Build unified water mesh from flood-filled regions
   *
   * @param regions - Array of water regions from flood-fill algorithm
   * @param terrainData - Optional terrain data for shore detection (y-indexed array)
   * @param mapWidth - Map width for shore detection
   * @param mapHeight - Map height for shore detection
   */
  public buildFromRegions(
    regions: WaterRegion[],
    terrainData?: Array<Array<{ elevation: number; feature: string }>>,
    mapWidth?: number,
    mapHeight?: number
  ): void {
    this.clear();

    if (regions.length === 0) {
      return;
    }

    const config = QUALITY_CONFIGS[this.quality];

    // Collect all cells with region metadata
    const allCells = this.collectAndMergeCells(regions, config.cellMerge);

    if (allCells.length === 0) {
      return;
    }

    // Build main water geometry
    this.buildWaterGeometry(allCells);

    // Build shore transitions if terrain data provided
    if (terrainData && mapWidth !== undefined && mapHeight !== undefined) {
      const edgeCells = this.findShoreEdgeCells(regions, terrainData, mapWidth, mapHeight);
      if (edgeCells.length > 0) {
        this.buildShoreGeometry(edgeCells, config.shoreDetail);
      }
    }

    this.totalCells = allCells.length;
  }

  /**
   * Build from raw terrain data (flood-fills internally)
   * Convenience method that performs flood-fill and builds in one call
   */
  public buildFromTerrainData(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    width: number,
    height: number
  ): void {
    const regions = this.floodFillAllRegions(terrain, width, height);
    this.buildFromRegions(regions, terrain, width, height);
  }

  /**
   * Update water mesh state (called per frame)
   * Water animation is handled by the TSL material's time uniform
   */
  public update(_deltaTime: number, _camera?: THREE.Camera): void {
    // TSL materials handle animation internally via time uniform
    // Frustum culling is automatic via Three.js when frustumCulled = true
  }

  /**
   * Set enabled state
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mesh.visible = enabled;
    this.shoreGroup.visible = enabled;
  }

  /**
   * Set quality tier (requires rebuild to take effect)
   */
  public setQuality(quality: WaterQuality): void {
    this.quality = quality;
  }

  /**
   * Get statistics about the current water mesh
   */
  public getStats(): { cells: number; vertices: number; indices: number; drawCalls: number } {
    return {
      cells: this.totalCells,
      vertices: this.totalVertices,
      indices: this.totalIndices,
      drawCalls: this.totalCells > 0 ? 1 : 0,
    };
  }

  /**
   * Clear all geometry without disposing materials
   */
  public clear(): void {
    // Clear main water geometry
    if (this.geometry) {
      this.geometry.deleteAttribute('position');
      this.geometry.deleteAttribute('normal');
      this.geometry.deleteAttribute('uv');
      this.geometry.deleteAttribute('aWaterData');
      this.geometry.setIndex(null);
      this.geometry.boundingSphere = null;
      this.geometry.boundingBox = null;
    }

    // Clear shore geometry
    if (this.shoreMesh) {
      this.shoreGroup.remove(this.shoreMesh);
      if (this.shoreGeometry) {
        this.shoreGeometry.dispose();
        this.shoreGeometry = null;
      }
      if (this.shoreMesh.material && this.shoreMesh.material !== this.material) {
        (this.shoreMesh.material as THREE.Material).dispose();
      }
      this.shoreMesh = null;
    }

    this.totalCells = 0;
    this.totalVertices = 0;
    this.totalIndices = 0;
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.clear();

    if (this.geometry) {
      this.geometry.dispose();
    }

    // Note: material is passed in, so we don't dispose it here

    // Clear buffer references
    this.positionBuffer = null;
    this.normalBuffer = null;
    this.uvBuffer = null;
    this.waterDataBuffer = null;
    this.indexBuffer = null;
    this.shorePositionBuffer = null;
    this.shoreColorBuffer = null;
    this.shoreIndexBuffer = null;
  }

  // ==========================================
  // Private Methods
  // ==========================================

  /**
   * Collect cells from all regions and apply cell merging for quality
   */
  private collectAndMergeCells(
    regions: WaterRegion[],
    mergeFactor: number
  ): Array<{
    x: number;
    y: number;
    elevation: number;
    isDeep: boolean;
    regionId: number;
    size: number;
  }> {
    if (mergeFactor <= 1) {
      // No merging - return all cells directly
      const result: Array<{
        x: number;
        y: number;
        elevation: number;
        isDeep: boolean;
        regionId: number;
        size: number;
      }> = [];

      for (let regionId = 0; regionId < regions.length; regionId++) {
        const region = regions[regionId];
        for (const cell of region.cells) {
          result.push({
            x: cell.x,
            y: cell.y,
            elevation: cell.elevation,
            isDeep: cell.isDeep,
            regionId,
            size: 1,
          });
        }
      }

      return result;
    }

    // Cell merging for lower quality settings
    // Group cells into mergeFactor x mergeFactor blocks
    const result: Array<{
      x: number;
      y: number;
      elevation: number;
      isDeep: boolean;
      regionId: number;
      size: number;
    }> = [];

    for (let regionId = 0; regionId < regions.length; regionId++) {
      const region = regions[regionId];

      // Create a sparse map of cells in this region
      const cellMap = new Map<string, WaterCell>();
      for (const cell of region.cells) {
        cellMap.set(`${cell.x},${cell.y}`, cell);
      }

      // Track which cells have been merged
      const processed = new Set<string>();

      for (const cell of region.cells) {
        const key = `${cell.x},${cell.y}`;
        if (processed.has(key)) continue;

        // Find the block origin (aligned to mergeFactor grid)
        const blockX = Math.floor(cell.x / mergeFactor) * mergeFactor;
        const blockY = Math.floor(cell.y / mergeFactor) * mergeFactor;

        // Count cells in this block and compute average elevation
        let cellCount = 0;
        let totalElevation = 0;
        let hasDeep = false;

        for (let dy = 0; dy < mergeFactor; dy++) {
          for (let dx = 0; dx < mergeFactor; dx++) {
            const checkKey = `${blockX + dx},${blockY + dy}`;
            const blockCell = cellMap.get(checkKey);
            if (blockCell) {
              cellCount++;
              totalElevation += blockCell.elevation;
              if (blockCell.isDeep) hasDeep = true;
              processed.add(checkKey);
            }
          }
        }

        // Only create merged cell if we have enough cells (at least half the block)
        if (cellCount >= (mergeFactor * mergeFactor) / 2) {
          result.push({
            x: blockX + mergeFactor / 2 - 0.5,
            y: blockY + mergeFactor / 2 - 0.5,
            elevation: totalElevation / cellCount,
            isDeep: hasDeep,
            regionId,
            size: mergeFactor,
          });
        } else {
          // Not enough cells to merge - add individually
          for (let dy = 0; dy < mergeFactor; dy++) {
            for (let dx = 0; dx < mergeFactor; dx++) {
              const checkKey = `${blockX + dx},${blockY + dy}`;
              const blockCell = cellMap.get(checkKey);
              if (blockCell && !processed.has(checkKey)) {
                result.push({
                  x: blockCell.x,
                  y: blockCell.y,
                  elevation: blockCell.elevation,
                  isDeep: blockCell.isDeep,
                  regionId,
                  size: 1,
                });
                processed.add(checkKey);
              }
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Build the main water BufferGeometry from collected cells
   */
  private buildWaterGeometry(
    cells: Array<{
      x: number;
      y: number;
      elevation: number;
      isDeep: boolean;
      regionId: number;
      size: number;
    }>
  ): void {
    const cellCount = cells.length;

    // Each cell is a quad: 4 vertices, 6 indices (2 triangles)
    const vertexCount = cellCount * 4;
    const indexCount = cellCount * 6;

    // Allocate or reuse buffers
    this.positionBuffer = this.ensureBuffer(this.positionBuffer, vertexCount * 3);
    this.normalBuffer = this.ensureBuffer(this.normalBuffer, vertexCount * 3);
    this.uvBuffer = this.ensureBuffer(this.uvBuffer, vertexCount * 2);
    this.waterDataBuffer = this.ensureBuffer(this.waterDataBuffer, vertexCount * 3);
    this.indexBuffer = this.ensureIndexBuffer(this.indexBuffer, indexCount);

    const positions = this.positionBuffer;
    const normals = this.normalBuffer;
    const uvs = this.uvBuffer;
    const waterData = this.waterDataBuffer;
    const indices = this.indexBuffer;

    // UV scale - use world coordinates directly (1:1 mapping)
    // The shader handles texture tiling based on quality settings
    const uvScale = 1.0;

    let vertexOffset = 0;
    let indexOffset = 0;

    for (const cell of cells) {
      const { x, y, elevation, isDeep, regionId, size } = cell;

      // Calculate world-space height
      // In Three.js: Y is up, ground plane is X-Z
      const height = elevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET;

      // Shallow water renders slightly higher for visual blending
      const heightOffset = isDeep ? 0 : 0.02;
      const finalHeight = height + heightOffset;

      // Cell size (usually 1, but may be larger if merged)
      const halfSize = size / 2;

      // Quad corners (in X-Z plane, Y is height)
      // Cell position is at center, so offset by halfSize
      const x0 = x + 0.5 - halfSize;
      const x1 = x + 0.5 + halfSize;
      const z0 = y + 0.5 - halfSize; // Map Y -> World Z
      const z1 = y + 0.5 + halfSize;

      // Vertex positions (4 corners of quad)
      const vIdx = vertexOffset * 3;
      positions[vIdx + 0] = x0;
      positions[vIdx + 1] = finalHeight;
      positions[vIdx + 2] = z0;

      positions[vIdx + 3] = x1;
      positions[vIdx + 4] = finalHeight;
      positions[vIdx + 5] = z0;

      positions[vIdx + 6] = x1;
      positions[vIdx + 7] = finalHeight;
      positions[vIdx + 8] = z1;

      positions[vIdx + 9] = x0;
      positions[vIdx + 10] = finalHeight;
      positions[vIdx + 11] = z1;

      // Normals (all pointing up for flat water)
      for (let i = 0; i < 4; i++) {
        const nIdx = (vertexOffset + i) * 3;
        normals[nIdx + 0] = 0;
        normals[nIdx + 1] = 1;
        normals[nIdx + 2] = 0;
      }

      // UVs (world-space scaled for proper normal map tiling)
      const uIdx = vertexOffset * 2;
      uvs[uIdx + 0] = x0 * uvScale;
      uvs[uIdx + 1] = z0 * uvScale;

      uvs[uIdx + 2] = x1 * uvScale;
      uvs[uIdx + 3] = z0 * uvScale;

      uvs[uIdx + 4] = x1 * uvScale;
      uvs[uIdx + 5] = z1 * uvScale;

      uvs[uIdx + 6] = x0 * uvScale;
      uvs[uIdx + 7] = z1 * uvScale;

      // Custom water data: vec3(regionId, isDeep, elevation)
      for (let i = 0; i < 4; i++) {
        const wIdx = (vertexOffset + i) * 3;
        waterData[wIdx + 0] = regionId;
        waterData[wIdx + 1] = isDeep ? 1.0 : 0.0;
        waterData[wIdx + 2] = elevation;
      }

      // Indices (2 triangles per quad)
      const baseVertex = vertexOffset;
      indices[indexOffset + 0] = baseVertex + 0;
      indices[indexOffset + 1] = baseVertex + 1;
      indices[indexOffset + 2] = baseVertex + 2;

      indices[indexOffset + 3] = baseVertex + 0;
      indices[indexOffset + 4] = baseVertex + 2;
      indices[indexOffset + 5] = baseVertex + 3;

      vertexOffset += 4;
      indexOffset += 6;
    }

    // Set geometry attributes
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions.subarray(0, vertexOffset * 3), 3)
    );
    this.geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(normals.subarray(0, vertexOffset * 3), 3)
    );
    this.geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(uvs.subarray(0, vertexOffset * 2), 2)
    );
    this.geometry.setAttribute(
      'aWaterData',
      new THREE.BufferAttribute(waterData.subarray(0, vertexOffset * 3), 3)
    );
    this.geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexOffset), 1));

    // Compute bounding sphere for frustum culling
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();

    this.totalVertices = vertexOffset;
    this.totalIndices = indexOffset;
  }

  /**
   * Find water cells that border land for shore transitions
   */
  private findShoreEdgeCells(
    regions: WaterRegion[],
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    width: number,
    height: number
  ): ShoreEdgeCell[] {
    const edgeCells: ShoreEdgeCell[] = [];

    // Create a set of all water cells for quick lookup
    const waterCells = new Set<string>();
    for (const region of regions) {
      for (const cell of region.cells) {
        waterCells.add(`${cell.x},${cell.y}`);
      }
    }

    // Check each water cell for land neighbors
    for (const region of regions) {
      for (const cell of region.cells) {
        const directions: number[] = [];

        // Cardinal neighbor offsets
        const neighbors = [
          { dx: 0, dy: -1, dir: 0 }, // North
          { dx: 1, dy: 0, dir: 1 }, // East
          { dx: 0, dy: 1, dir: 2 }, // South
          { dx: -1, dy: 0, dir: 3 }, // West
        ];

        for (const { dx, dy, dir } of neighbors) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;

          // Skip map edges - only actual terrain boundaries
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }

          const neighborCell = terrain[ny]?.[nx];
          if (!neighborCell) continue;

          const neighborFeature = neighborCell.feature || 'none';

          // Non-water neighbor = land boundary
          if (neighborFeature !== 'water_shallow' && neighborFeature !== 'water_deep') {
            directions.push(dir);
          }
        }

        if (directions.length > 0) {
          edgeCells.push({
            x: cell.x,
            y: cell.y,
            elevation: cell.elevation,
            edgeDirections: directions,
          });
        }
      }
    }

    return edgeCells;
  }

  /**
   * Build shore transition geometry with alpha gradient
   */
  private buildShoreGeometry(edgeCells: ShoreEdgeCell[], shoreDetail: number): void {
    // Estimate vertex/index count (4 verts, 6 indices per edge direction)
    let totalEdges = 0;
    for (const cell of edgeCells) {
      totalEdges += cell.edgeDirections.length;
    }

    // Apply detail factor (skip some edges on lower quality)
    const skipFactor = Math.max(1, Math.round(1 / shoreDetail));
    const effectiveEdges = Math.ceil(totalEdges / skipFactor);

    if (effectiveEdges === 0) return;

    const vertexCount = effectiveEdges * 4;
    const indexCount = effectiveEdges * 6;

    // Allocate buffers
    this.shorePositionBuffer = this.ensureBuffer(this.shorePositionBuffer, vertexCount * 3);
    this.shoreColorBuffer = this.ensureBuffer(this.shoreColorBuffer, vertexCount * 4);
    this.shoreIndexBuffer = this.ensureIndexBuffer(this.shoreIndexBuffer, indexCount);

    const positions = this.shorePositionBuffer;
    const colors = this.shoreColorBuffer;
    const indices = this.shoreIndexBuffer;

    let vertexOffset = 0;
    let indexOffset = 0;
    let edgeCount = 0;

    for (const cell of edgeCells) {
      const baseHeight = cell.elevation * HEIGHT_SCALE + WATER_SURFACE_OFFSET + 0.02;

      for (const dir of cell.edgeDirections) {
        // Skip some edges for lower quality
        edgeCount++;
        if (edgeCount % skipFactor !== 0) continue;

        // Direction vectors - extend INTO water from shore
        let dx = 0;
        let dz = 0;
        let perpX = 0;
        let perpZ = 0;

        switch (dir) {
          case 0: // North edge (land is north) - shore extends SOUTH into water
            dx = 0;
            dz = 1;
            perpX = 1;
            perpZ = 0;
            break;
          case 1: // East edge (land is east) - shore extends WEST into water
            dx = -1;
            dz = 0;
            perpX = 0;
            perpZ = 1;
            break;
          case 2: // South edge (land is south) - shore extends NORTH into water
            dx = 0;
            dz = -1;
            perpX = 1;
            perpZ = 0;
            break;
          case 3: // West edge (land is west) - shore extends EAST into water
            dx = 1;
            dz = 0;
            perpX = 0;
            perpZ = 1;
            break;
        }

        // Start at the edge of the water cell where it meets land
        let edgeX = cell.x + 0.5;
        let edgeZ = cell.y + 0.5;

        switch (dir) {
          case 0:
            edgeZ = cell.y;
            break;
          case 1:
            edgeX = cell.x + 1;
            break;
          case 2:
            edgeZ = cell.y + 1;
            break;
          case 3:
            edgeX = cell.x;
            break;
        }

        // Create quad from shore edge into water
        const v0x = edgeX - perpX * 0.5;
        const v0z = edgeZ - perpZ * 0.5;
        const v1x = edgeX + perpX * 0.5;
        const v1z = edgeZ + perpZ * 0.5;
        const v2x = edgeX + dx * SHORE_WIDTH + perpX * 0.5;
        const v2z = edgeZ + dz * SHORE_WIDTH + perpZ * 0.5;
        const v3x = edgeX + dx * SHORE_WIDTH - perpX * 0.5;
        const v3z = edgeZ + dz * SHORE_WIDTH - perpZ * 0.5;

        // Vertex positions
        const pIdx = vertexOffset * 3;
        positions[pIdx + 0] = v0x;
        positions[pIdx + 1] = baseHeight;
        positions[pIdx + 2] = v0z;

        positions[pIdx + 3] = v1x;
        positions[pIdx + 4] = baseHeight;
        positions[pIdx + 5] = v1z;

        positions[pIdx + 6] = v2x;
        positions[pIdx + 7] = baseHeight;
        positions[pIdx + 8] = v2z;

        positions[pIdx + 9] = v3x;
        positions[pIdx + 10] = baseHeight;
        positions[pIdx + 11] = v3z;

        // Colors with alpha gradient (0.35 at shore, 0 at deep end)
        const cIdx = vertexOffset * 4;
        colors[cIdx + 0] = SHORE_COLOR.r;
        colors[cIdx + 1] = SHORE_COLOR.g;
        colors[cIdx + 2] = SHORE_COLOR.b;
        colors[cIdx + 3] = 0.35;

        colors[cIdx + 4] = SHORE_COLOR.r;
        colors[cIdx + 5] = SHORE_COLOR.g;
        colors[cIdx + 6] = SHORE_COLOR.b;
        colors[cIdx + 7] = 0.35;

        colors[cIdx + 8] = SHORE_COLOR.r;
        colors[cIdx + 9] = SHORE_COLOR.g;
        colors[cIdx + 10] = SHORE_COLOR.b;
        colors[cIdx + 11] = 0.0;

        colors[cIdx + 12] = SHORE_COLOR.r;
        colors[cIdx + 13] = SHORE_COLOR.g;
        colors[cIdx + 14] = SHORE_COLOR.b;
        colors[cIdx + 15] = 0.0;

        // Indices
        const baseVertex = vertexOffset;
        indices[indexOffset + 0] = baseVertex + 0;
        indices[indexOffset + 1] = baseVertex + 1;
        indices[indexOffset + 2] = baseVertex + 2;

        indices[indexOffset + 3] = baseVertex + 0;
        indices[indexOffset + 4] = baseVertex + 2;
        indices[indexOffset + 5] = baseVertex + 3;

        vertexOffset += 4;
        indexOffset += 6;
      }
    }

    if (vertexOffset === 0) return;

    // Create shore geometry
    this.shoreGeometry = new THREE.BufferGeometry();
    this.shoreGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions.subarray(0, vertexOffset * 3), 3)
    );
    this.shoreGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors.subarray(0, vertexOffset * 4), 4)
    );
    this.shoreGeometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexOffset), 1));
    this.shoreGeometry.computeVertexNormals();

    // Shore material (basic blending with vertex colors)
    const shoreMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.shoreMesh = new THREE.Mesh(this.shoreGeometry, shoreMaterial);
    this.shoreMesh.renderOrder = 10;
    this.shoreMesh.frustumCulled = true;

    this.shoreGroup.add(this.shoreMesh);
  }

  /**
   * Flood-fill all water regions in terrain data
   * Reuses the algorithm from WaterMesh.ts for compatibility
   */
  private floodFillAllRegions(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    width: number,
    height: number
  ): WaterRegion[] {
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

        const region = this.floodFillRegion(terrain, x, y, width, height, visited);
        if (region.cells.length > 0) {
          regions.push(region);
        }
      }
    }

    return regions;
  }

  /**
   * Flood-fill a single water region starting from a cell
   */
  private floodFillRegion(
    terrain: Array<Array<{ elevation: number; feature: string }>>,
    startX: number,
    startY: number,
    width: number,
    height: number,
    visited: Set<string>
  ): WaterRegion {
    const cells: WaterCell[] = [];
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;
    let totalElevation = 0;
    let hasAdjacentOppositeType = false;

    // Determine the type of water we're flood filling
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

      // Add cardinal neighbors to queue
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

  /**
   * Ensure a Float32Array buffer has sufficient capacity
   */
  private ensureBuffer(buffer: Float32Array | null, minSize: number): Float32Array {
    if (buffer && buffer.length >= minSize) {
      return buffer;
    }
    // Allocate with 25% extra capacity for future growth
    const newSize = Math.ceil(minSize * 1.25);
    return new Float32Array(newSize);
  }

  /**
   * Ensure an index buffer has sufficient capacity
   */
  private ensureIndexBuffer(buffer: Uint32Array | null, minSize: number): Uint32Array {
    if (buffer && buffer.length >= minSize) {
      return buffer;
    }
    const newSize = Math.ceil(minSize * 1.25);
    return new Uint32Array(newSize);
  }
}

/**
 * Create a basic water material for use with UnifiedWaterMesh
 * This is a simple fallback - ideally use a TSL water material
 */
export function createBasicWaterMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: 0x0066aa,
    metalness: 0.1,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
}
