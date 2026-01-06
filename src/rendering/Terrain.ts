import * as THREE from 'three';
import { MapData, MapCell, TerrainType, ElevationLevel } from '@/data/maps';

// Colors for different terrain types and elevations
const TERRAIN_COLORS: Record<TerrainType, Record<ElevationLevel, THREE.Color>> = {
  ground: {
    0: new THREE.Color(0x2d3a2e), // Low ground - dark green
    1: new THREE.Color(0x3d4a3e), // Medium ground - medium green
    2: new THREE.Color(0x4d5a4e), // High ground - lighter green
  },
  unwalkable: {
    0: new THREE.Color(0x1a1a1a), // Dark cliff
    1: new THREE.Color(0x252525),
    2: new THREE.Color(0x303030),
  },
  ramp: {
    0: new THREE.Color(0x4a4535), // Ramp color - tan
    1: new THREE.Color(0x5a5545),
    2: new THREE.Color(0x6a6555),
  },
  unbuildable: {
    0: new THREE.Color(0x2a3530), // Slightly different from ground
    1: new THREE.Color(0x3a4540),
    2: new THREE.Color(0x4a5550),
  },
  creep: {
    0: new THREE.Color(0x3d2040), // Purple creep
    1: new THREE.Color(0x4d3050),
    2: new THREE.Color(0x5d4060),
  },
};

// Height for each elevation level
const ELEVATION_HEIGHTS: Record<ElevationLevel, number> = {
  0: 0,
  1: 1.5,
  2: 3,
};

export interface TerrainConfig {
  mapData: MapData;
  cellSize?: number;
}

export class Terrain {
  public mesh: THREE.Mesh;
  public mapData: MapData;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;

  constructor(config: TerrainConfig) {
    this.mapData = config.mapData;
    this.cellSize = config.cellSize ?? 1;

    this.geometry = this.createGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.rotation.x = -Math.PI / 2;
  }

  private createGeometry(): THREE.BufferGeometry {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // Generate vertex grid with heights based on terrain
    const vertexGrid: THREE.Vector3[][] = [];

    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const heightValue = ELEVATION_HEIGHTS[cell.elevation];
        const noise = this.getTerrainNoise(x, y, cell.terrain);

        vertexGrid[y][x] = new THREE.Vector3(
          x * cellSize,
          y * cellSize,
          heightValue + noise
        );
      }
    }

    // Create triangles and colors
    let vertexIndex = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        const color = TERRAIN_COLORS[cell.terrain][cell.elevation];

        const colorVariation = (cell.textureId - 2) * 0.02;
        const r = Math.max(0, Math.min(1, color.r + colorVariation));
        const g = Math.max(0, Math.min(1, color.g + colorVariation));
        const b = Math.max(0, Math.min(1, color.b + colorVariation));

        const v00 = vertexGrid[y][x];
        const v10 = vertexGrid[y][x + 1];
        const v01 = vertexGrid[y + 1][x];
        const v11 = vertexGrid[y + 1][x + 1];

        // Triangle 1
        vertices.push(v00.x, v00.y, v00.z);
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v01.x, v01.y, v01.z);

        // Triangle 2
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v11.x, v11.y, v11.z);
        vertices.push(v01.x, v01.y, v01.z);

        for (let i = 0; i < 6; i++) {
          colors.push(r, g, b);
        }

        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex + 3, vertexIndex + 4, vertexIndex + 5);
        vertexIndex += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
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

    let maxElevation: ElevationLevel = 0;
    let dominantTerrain: TerrainType = 'ground';

    for (const sample of samples) {
      if (sample.elevation > maxElevation) {
        maxElevation = sample.elevation;
        dominantTerrain = sample.terrain;
      }
    }

    return {
      terrain: dominantTerrain,
      elevation: maxElevation,
      textureId: samples[0].textureId,
    };
  }

  private getTerrainNoise(x: number, y: number, terrain: TerrainType): number {
    if (terrain === 'unwalkable') {
      return Math.sin(x * 0.5) * Math.cos(y * 0.5) * 0.5 + 0.5;
    }
    if (terrain === 'ramp') {
      return 0;
    }
    const noise1 = Math.sin(x * 0.3 + y * 0.2) * 0.1;
    const noise2 = Math.cos(x * 0.5 - y * 0.3) * 0.05;
    return noise1 + noise2;
  }

  public getHeightAt(worldX: number, worldY: number): number {
    const x = Math.floor(worldX / this.cellSize);
    const y = Math.floor(worldY / this.cellSize);

    if (x < 0 || x >= this.mapData.width || y < 0 || y >= this.mapData.height) {
      return 0;
    }

    const cell = this.mapData.terrain[y][x];
    return ELEVATION_HEIGHTS[cell.elevation];
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

// Decorative elements (watch towers, destructible rocks, etc.)
export class MapDecorations {
  public group: THREE.Group;

  constructor(mapData: MapData) {
    this.group = new THREE.Group();
    this.createWatchTowers(mapData);
    this.createDestructibles(mapData);
  }

  private createWatchTowers(mapData: MapData): void {
    const towerGeometry = new THREE.CylinderGeometry(1, 1.5, 4, 8);
    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x8080a0,
      roughness: 0.5,
      metalness: 0.7,
    });

    for (const tower of mapData.watchTowers) {
      const mesh = new THREE.Mesh(towerGeometry, towerMaterial);
      mesh.position.set(tower.x, 2, tower.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      const ringGeometry = new THREE.RingGeometry(tower.radius - 0.5, tower.radius, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x4080ff,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tower.x, 0.1, tower.y);
      this.group.add(ring);
    }

    towerGeometry.dispose();
    towerMaterial.dispose();
  }

  private createDestructibles(mapData: MapData): void {
    const rockGeometry = new THREE.DodecahedronGeometry(1.5);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a5a4a,
      roughness: 0.9,
      metalness: 0.1,
    });

    for (const rock of mapData.destructibles) {
      const mesh = new THREE.Mesh(rockGeometry, rockMaterial);
      mesh.position.set(rock.x, 1, rock.y);
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      mesh.scale.setScalar(0.8 + Math.random() * 0.4);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    rockGeometry.dispose();
    rockMaterial.dispose();
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
