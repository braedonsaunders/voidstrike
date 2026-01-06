import * as THREE from 'three';
import { MapData, MapCell, TerrainType, ElevationLevel } from '@/data/maps';

// Much brighter, more vibrant terrain colors
const TERRAIN_COLORS: Record<TerrainType, Record<ElevationLevel, THREE.Color>> = {
  ground: {
    0: new THREE.Color(0x3d5a3e), // Low ground - grass green
    1: new THREE.Color(0x4d6a4e), // Medium ground - lighter grass
    2: new THREE.Color(0x5d7a5e), // High ground - bright grass
  },
  unwalkable: {
    0: new THREE.Color(0x4a4a4a), // Dark rock
    1: new THREE.Color(0x5a5a5a), // Medium rock
    2: new THREE.Color(0x6a6a6a), // Light rock
  },
  ramp: {
    0: new THREE.Color(0x7a7060), // Tan/dirt ramp
    1: new THREE.Color(0x8a8070),
    2: new THREE.Color(0x9a9080),
  },
  unbuildable: {
    0: new THREE.Color(0x3a5040), // Darker grass
    1: new THREE.Color(0x4a6050),
    2: new THREE.Color(0x5a7060),
  },
  creep: {
    0: new THREE.Color(0x5d3060), // Purple creep
    1: new THREE.Color(0x6d4070),
    2: new THREE.Color(0x7d5080),
  },
};

// Accent colors for detail variation
const ACCENT_COLORS: Record<TerrainType, THREE.Color[]> = {
  ground: [
    new THREE.Color(0x4a6848), // Darker grass patch
    new THREE.Color(0x6a8868), // Lighter grass patch
    new THREE.Color(0x5a7858), // Medium grass
    new THREE.Color(0x456040), // Forest green patch
  ],
  unwalkable: [
    new THREE.Color(0x555555),
    new THREE.Color(0x606060),
    new THREE.Color(0x4a4a50),
  ],
  ramp: [
    new THREE.Color(0x8a7a6a),
    new THREE.Color(0x9a8a7a),
  ],
  unbuildable: [
    new THREE.Color(0x4a5848),
    new THREE.Color(0x3a4838),
  ],
  creep: [
    new THREE.Color(0x6a4070),
    new THREE.Color(0x5a3060),
  ],
};

// Height for each elevation level
const ELEVATION_HEIGHTS: Record<ElevationLevel, number> = {
  0: 0,
  1: 2.5,
  2: 5,
};

export interface TerrainConfig {
  mapData: MapData;
  cellSize?: number;
}

// Simplex-like noise function for terrain variation
function noise2D(x: number, y: number, seed: number = 0): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, scale: number, seed: number = 0): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;

  const n00 = noise2D(x0, y0, seed);
  const n10 = noise2D(x0 + 1, y0, seed);
  const n01 = noise2D(x0, y0 + 1, seed);
  const n11 = noise2D(x0 + 1, y0 + 1, seed);

  const fx2 = fx * fx * (3 - 2 * fx);
  const fy2 = fy * fy * (3 - 2 * fy);

  return n00 * (1 - fx2) * (1 - fy2) +
         n10 * fx2 * (1 - fy2) +
         n01 * (1 - fx2) * fy2 +
         n11 * fx2 * fy2;
}

function fractalNoise(x: number, y: number, octaves: number, persistence: number, seed: number = 0): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += smoothNoise(x * frequency, y * frequency, 1, seed + i * 100) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }

  return total / maxValue;
}

export class Terrain {
  public mesh: THREE.Mesh;
  public mapData: MapData;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;

  // Store heightmap for queries
  private heightMap: Float32Array;
  private gridWidth: number;
  private gridHeight: number;

  constructor(config: TerrainConfig) {
    this.mapData = config.mapData;
    this.cellSize = config.cellSize ?? 1;
    this.gridWidth = this.mapData.width + 1;
    this.gridHeight = this.mapData.height + 1;
    this.heightMap = new Float32Array(this.gridWidth * this.gridHeight);

    this.geometry = this.createGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.05,
      flatShading: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.rotation.x = -Math.PI / 2;
  }

  private createGeometry(): THREE.BufferGeometry {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // Pre-calculate height map with smooth transitions
    const vertexGrid: THREE.Vector3[][] = [];

    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const baseHeight = ELEVATION_HEIGHTS[cell.elevation];

        // Add procedural detail noise
        let detailNoise = 0;
        if (cell.terrain !== 'ramp') {
          // Multi-octave noise for natural terrain look
          detailNoise = fractalNoise(x, y, 4, 0.5, 42) * 0.4;

          // Add larger scale hills
          detailNoise += smoothNoise(x, y, 20, 123) * 0.3;

          // Cliff edges get extra noise
          if (cell.terrain === 'unwalkable') {
            detailNoise += smoothNoise(x, y, 3, 456) * 1.0;
          }
        }

        const finalHeight = baseHeight + detailNoise;
        vertexGrid[y][x] = new THREE.Vector3(
          x * cellSize,
          y * cellSize,
          finalHeight
        );

        // Store in heightmap
        this.heightMap[y * this.gridWidth + x] = finalHeight;
      }
    }

    // Create triangles with vertex colors
    let vertexIndex = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        const baseColor = TERRAIN_COLORS[cell.terrain][cell.elevation];
        const accents = ACCENT_COLORS[cell.terrain];

        // Get cell corners
        const v00 = vertexGrid[y][x];
        const v10 = vertexGrid[y][x + 1];
        const v01 = vertexGrid[y + 1][x];
        const v11 = vertexGrid[y + 1][x + 1];

        // Calculate colors with variation
        const colors6: THREE.Color[] = [];
        for (let i = 0; i < 6; i++) {
          const color = new THREE.Color(baseColor);

          // Add texture variation based on position
          const noiseVal = noise2D(x + i * 0.1, y + i * 0.1, cell.textureId);

          // Blend with accent colors
          if (accents.length > 0 && noiseVal > 0.6) {
            const accentIndex = Math.floor(noiseVal * accents.length) % accents.length;
            color.lerp(accents[accentIndex], (noiseVal - 0.6) * 2);
          }

          // Add subtle brightness variation
          const brightVar = (noise2D(x * 2.5, y * 2.5, 789) - 0.5) * 0.15;
          color.r = Math.max(0, Math.min(1, color.r + brightVar));
          color.g = Math.max(0, Math.min(1, color.g + brightVar));
          color.b = Math.max(0, Math.min(1, color.b + brightVar));

          // Edge darkening for depth
          const edgeFactor = this.getEdgeFactor(terrain, x, y, width, height);
          if (edgeFactor > 0) {
            color.multiplyScalar(1 - edgeFactor * 0.2);
          }

          colors6.push(color);
        }

        // Triangle 1 (v00, v10, v01)
        vertices.push(v00.x, v00.y, v00.z);
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v01.x, v01.y, v01.z);

        uvs.push(x / width, y / height);
        uvs.push((x + 1) / width, y / height);
        uvs.push(x / width, (y + 1) / height);

        // Triangle 2 (v10, v11, v01)
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v11.x, v11.y, v11.z);
        vertices.push(v01.x, v01.y, v01.z);

        uvs.push((x + 1) / width, y / height);
        uvs.push((x + 1) / width, (y + 1) / height);
        uvs.push(x / width, (y + 1) / height);

        // Add colors
        for (let i = 0; i < 6; i++) {
          colors.push(colors6[i].r, colors6[i].g, colors6[i].b);
        }

        // Add indices
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex + 3, vertexIndex + 4, vertexIndex + 5);
        vertexIndex += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  private getEdgeFactor(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    const cell = terrain[y][x];
    let edgeFactor = 0;

    // Check neighbors for elevation changes
    const neighbors = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    for (const { dx, dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighbor = terrain[ny][nx];
        if (neighbor.elevation !== cell.elevation) {
          edgeFactor = Math.max(edgeFactor, Math.abs(neighbor.elevation - cell.elevation) * 0.5);
        }
        if (neighbor.terrain === 'unwalkable' && cell.terrain !== 'unwalkable') {
          edgeFactor = Math.max(edgeFactor, 0.3);
        }
      }
    }

    return edgeFactor;
  }

  private sampleTerrain(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): MapCell {
    const samples: MapCell[] = [];

    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        samples.push(terrain[sy][sx]);
      }
    }

    // Prioritize certain terrain types for smooth blending
    let maxElevation: ElevationLevel = 0;
    let dominantTerrain: TerrainType = 'ground';
    let hasRamp = false;

    for (const sample of samples) {
      if (sample.terrain === 'ramp') hasRamp = true;
      if (sample.elevation > maxElevation) {
        maxElevation = sample.elevation;
        dominantTerrain = sample.terrain;
      }
    }

    // Ramps should smooth between elevations
    if (hasRamp) {
      dominantTerrain = 'ramp';
      // Average elevation for smooth ramp
      const avgElevation = samples.reduce((sum, s) => sum + s.elevation, 0) / samples.length;
      maxElevation = Math.round(avgElevation) as ElevationLevel;
    }

    return {
      terrain: dominantTerrain,
      elevation: maxElevation,
      textureId: samples[0].textureId,
    };
  }

  public getHeightAt(worldX: number, worldY: number): number {
    const x = worldX / this.cellSize;
    const y = worldY / this.cellSize;

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return 0;
    }

    // Bilinear interpolation for smooth height
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, this.mapData.width);
    const y1 = Math.min(y0 + 1, this.mapData.height);

    const fx = x - x0;
    const fy = y - y0;

    const h00 = this.heightMap[y0 * this.gridWidth + x0];
    const h10 = this.heightMap[y0 * this.gridWidth + x1];
    const h01 = this.heightMap[y1 * this.gridWidth + x0];
    const h11 = this.heightMap[y1 * this.gridWidth + x1];

    return h00 * (1 - fx) * (1 - fy) +
           h10 * fx * (1 - fy) +
           h01 * (1 - fx) * fy +
           h11 * fx * fy;
  }

  public getTerrainAt(worldX: number, worldY: number): MapCell | null {
    const x = Math.floor(worldX / this.cellSize);
    const y = Math.floor(worldY / this.cellSize);

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return null;
    }

    return this.mapData.terrain[y][x];
  }

  public isWalkable(worldX: number, worldY: number): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;
    return cell.terrain !== 'unwalkable';
  }

  public isBuildable(worldX: number, worldY: number): boolean {
    const cell = this.getTerrainAt(worldX, worldY);
    if (!cell) return false;
    return cell.terrain === 'ground';
  }

  public getWidth(): number {
    return this.mapData.width * this.cellSize;
  }

  public getHeight(): number {
    return this.mapData.height * this.cellSize;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// Grid overlay for building placement
export class TerrainGrid {
  public mesh: THREE.LineSegments;

  private width: number;
  private height: number;
  private cellSize: number;

  constructor(width: number, height: number, cellSize = 1) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.mesh = this.createMesh();
    this.mesh.visible = false;
  }

  private createMesh(): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];

    for (let x = 0; x <= this.width; x += this.cellSize) {
      vertices.push(x, 0, 0.1);
      vertices.push(x, this.height, 0.1);
    }

    for (let y = 0; y <= this.height; y += this.cellSize) {
      vertices.push(0, y, 0.1);
      vertices.push(this.width, y, 0.1);
    }

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      opacity: 0.2,
      transparent: true,
    });

    const mesh = new THREE.LineSegments(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  public show(): void {
    this.mesh.visible = true;
  }

  public hide(): void {
    this.mesh.visible = false;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// Decorative elements (watch towers, destructible rocks, trees, etc.)
export class MapDecorations {
  public group: THREE.Group;

  constructor(mapData: MapData) {
    this.group = new THREE.Group();
    this.createWatchTowers(mapData);
    this.createDestructibles(mapData);
    this.createTrees(mapData);
    this.createRocks(mapData);
  }

  private createWatchTowers(mapData: MapData): void {
    for (const tower of mapData.watchTowers) {
      // Tower base
      const baseGeometry = new THREE.CylinderGeometry(2, 2.5, 1, 8);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x606070,
        roughness: 0.6,
        metalness: 0.4,
      });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.set(tower.x, 0.5, tower.y);
      base.castShadow = true;
      base.receiveShadow = true;
      this.group.add(base);

      // Tower pillar
      const pillarGeometry = new THREE.CylinderGeometry(1, 1.5, 5, 8);
      const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0x8080a0,
        roughness: 0.5,
        metalness: 0.6,
      });
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(tower.x, 3.5, tower.y);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.group.add(pillar);

      // Tower top/beacon
      const topGeometry = new THREE.ConeGeometry(1.5, 2, 8);
      const topMaterial = new THREE.MeshStandardMaterial({
        color: 0xa0a0c0,
        roughness: 0.3,
        metalness: 0.7,
      });
      const top = new THREE.Mesh(topGeometry, topMaterial);
      top.position.set(tower.x, 7, tower.y);
      top.castShadow = true;
      this.group.add(top);

      // Vision range ring
      const ringGeometry = new THREE.RingGeometry(tower.radius - 0.5, tower.radius, 64);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x4080ff,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tower.x, 0.15, tower.y);
      this.group.add(ring);
    }
  }

  private createDestructibles(mapData: MapData): void {
    for (const rock of mapData.destructibles) {
      // Create more detailed rock formation
      const rockGroup = new THREE.Group();

      // Main rock
      const mainGeometry = new THREE.DodecahedronGeometry(2);
      const mainMaterial = new THREE.MeshStandardMaterial({
        color: 0x7a6a5a,
        roughness: 0.9,
        metalness: 0.05,
      });
      const mainRock = new THREE.Mesh(mainGeometry, mainMaterial);
      mainRock.position.y = 1.5;
      mainRock.rotation.set(
        Math.random() * 0.5,
        Math.random() * Math.PI * 2,
        Math.random() * 0.3
      );
      mainRock.scale.set(1, 0.8, 1.2);
      mainRock.castShadow = true;
      mainRock.receiveShadow = true;
      rockGroup.add(mainRock);

      // Smaller rocks around
      for (let i = 0; i < 3; i++) {
        const smallGeometry = new THREE.DodecahedronGeometry(0.8);
        const smallRock = new THREE.Mesh(smallGeometry, mainMaterial);
        const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
        smallRock.position.set(
          Math.cos(angle) * 2,
          0.5,
          Math.sin(angle) * 2
        );
        smallRock.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );
        smallRock.scale.setScalar(0.5 + Math.random() * 0.5);
        smallRock.castShadow = true;
        smallRock.receiveShadow = true;
        rockGroup.add(smallRock);
      }

      rockGroup.position.set(rock.x, 0, rock.y);
      this.group.add(rockGroup);
    }
  }

  private createTrees(mapData: MapData): void {
    // Scatter trees around the map edges and unbuildable areas
    const treePositions: Array<{ x: number; y: number }> = [];

    // Add trees along map edges (inside the playable area)
    for (let i = 0; i < 50; i++) {
      const edge = Math.floor(Math.random() * 4);
      let x: number, y: number;

      switch (edge) {
        case 0: // Left
          x = 10 + Math.random() * 8;
          y = 15 + Math.random() * (mapData.height - 30);
          break;
        case 1: // Right
          x = mapData.width - 18 + Math.random() * 8;
          y = 15 + Math.random() * (mapData.height - 30);
          break;
        case 2: // Top
          x = 15 + Math.random() * (mapData.width - 30);
          y = 10 + Math.random() * 8;
          break;
        default: // Bottom
          x = 15 + Math.random() * (mapData.width - 30);
          y = mapData.height - 18 + Math.random() * 8;
          break;
      }

      // Check terrain is suitable
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          treePositions.push({ x, y });
        }
      }
    }

    // Create trees
    for (const pos of treePositions) {
      const treeGroup = new THREE.Group();
      const height = 3 + Math.random() * 2;

      // Trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, height * 0.4, 6);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3520,
        roughness: 0.9,
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = height * 0.2;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      // Foliage (multiple cones for pine tree look)
      const foliageMaterial = new THREE.MeshStandardMaterial({
        color: 0x2d5a2d,
        roughness: 0.8,
      });

      for (let layer = 0; layer < 3; layer++) {
        const layerHeight = height * 0.25;
        const layerRadius = 1.2 - layer * 0.3;
        const foliageGeometry = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.y = height * 0.4 + layer * layerHeight * 0.7;
        foliage.castShadow = true;
        foliage.receiveShadow = true;
        treeGroup.add(foliage);
      }

      treeGroup.position.set(pos.x, 0, pos.y);
      treeGroup.rotation.y = Math.random() * Math.PI * 2;
      treeGroup.scale.setScalar(0.8 + Math.random() * 0.4);
      this.group.add(treeGroup);
    }
  }

  private createRocks(mapData: MapData): void {
    // Scatter small rocks around the map
    for (let i = 0; i < 80; i++) {
      const x = 12 + Math.random() * (mapData.width - 24);
      const y = 12 + Math.random() * (mapData.height - 24);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const rockGeometry = new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.4);
          const rockMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.3 + Math.random() * 0.1, 0.28 + Math.random() * 0.1, 0.25 + Math.random() * 0.1),
            roughness: 0.9,
          });
          const rock = new THREE.Mesh(rockGeometry, rockMaterial);
          rock.position.set(x, 0.15 + Math.random() * 0.1, y);
          rock.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );
          rock.castShadow = true;
          rock.receiveShadow = true;
          this.group.add(rock);
        }
      }
    }
  }

  public dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
