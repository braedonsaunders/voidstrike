import * as THREE from 'three';
import { MapData, MapCell, TerrainType, ElevationLevel } from '@/data/maps';
import { BiomeConfig, BIOMES, blendBiomeColors, BiomeType, getBiomeShaderConfig } from './Biomes';
import { createTerrainShaderMaterial, updateTerrainShader } from './shaders/TerrainShader';
import { createSC2TerrainShaderMaterial, getSC2BiomeConfig, updateSC2TerrainShader } from './shaders/SC2TerrainShader';
import { createTextureTerrainMaterial, updateTextureTerrainShader, getDefaultTextureConfig } from './shaders/TextureTerrainShader';
import AssetManager from '@/assets/AssetManager';

// Shader mode for terrain rendering
type TerrainShaderMode = 'texture' | 'basic' | 'sc2';


// Terrain subdivision for smoother rendering
const SUBDIVISIONS = 2; // 2x2 subdivisions per cell for better quality

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
  public biome: BiomeConfig;

  private cellSize: number;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  // Store heightmap for queries
  private heightMap: Float32Array;
  private gridWidth: number;
  private gridHeight: number;

  // Shader mode selection:
  // - 'texture': Uses AI-generated textures (60+ FPS) - RECOMMENDED
  // - 'basic': Simple procedural shader (30-60 FPS)
  // - 'sc2': Full procedural (10 FPS - too slow)
  private static SHADER_MODE: TerrainShaderMode = 'texture';

  constructor(config: TerrainConfig) {
    this.mapData = config.mapData;
    this.cellSize = config.cellSize ?? 1;
    this.gridWidth = this.mapData.width + 1;
    this.gridHeight = this.mapData.height + 1;
    this.heightMap = new Float32Array(this.gridWidth * this.gridHeight);

    // Get biome configuration
    this.biome = BIOMES[this.mapData.biome || 'grassland'];

    this.geometry = this.createGeometry();

    // Create shader material based on mode
    switch (Terrain.SHADER_MODE) {
      case 'texture':
        console.log('[Terrain] Using TEXTURE-BASED terrain shader (60+ FPS)');
        const textureConfig = getDefaultTextureConfig();
        this.material = createTextureTerrainMaterial(textureConfig);
        break;
      case 'sc2':
        console.log('[Terrain] Using SC2 terrain shader for biome:', this.mapData.biome || 'grassland');
        const sc2Config = getSC2BiomeConfig(this.mapData.biome || 'grassland');
        this.material = createSC2TerrainShaderMaterial(sc2Config);
        break;
      case 'basic':
      default:
        console.log('[Terrain] Using basic terrain shader');
        const shaderConfig = getBiomeShaderConfig(this.biome);
        this.material = createTerrainShaderMaterial(shaderConfig);
        break;
    }

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.rotation.x = -Math.PI / 2;
  }

  // Update shader uniforms (call each frame for animated effects)
  public update(deltaTime: number, sunDirection?: THREE.Vector3): void {
    switch (Terrain.SHADER_MODE) {
      case 'texture':
        updateTextureTerrainShader(this.material, deltaTime, sunDirection);
        break;
      case 'sc2':
        updateSC2TerrainShader(this.material, deltaTime, sunDirection);
        break;
      case 'basic':
      default:
        updateTerrainShader(this.material, deltaTime, sunDirection);
        break;
    }
  }

  private createGeometry(): THREE.BufferGeometry {
    const { width, height, terrain } = this.mapData;
    const cellSize = this.cellSize;

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // Pre-calculate height map with smooth transitions and natural variation
    const vertexGrid: THREE.Vector3[][] = [];

    for (let y = 0; y <= height; y++) {
      vertexGrid[y] = [];
      for (let x = 0; x <= width; x++) {
        const cell = this.sampleTerrain(terrain, x, y, width, height);
        const baseHeight = ELEVATION_HEIGHTS[cell.elevation];

        // Calculate edge factor for cliff handling
        const edgeFactor = this.calculateElevationEdgeFactor(terrain, x, y, width, height);

        // SC2-style terrain: FLAT buildable areas, dramatic cliffs only on unwalkable
        let detailNoise = 0;

        if (cell.terrain === 'unwalkable') {
          // Cliffs and unwalkable areas get dramatic height variation
          detailNoise = fractalNoise(x, y, 5, 0.55, 42) * 0.8;
          detailNoise += smoothNoise(x, y, 4, 456) * 1.5;
          detailNoise += fractalNoise(x * 2, y * 2, 3, 0.6, 321) * 1.0;

          // Add cliff edge variation
          if (edgeFactor > 0) {
            detailNoise += edgeFactor * 1.5 * smoothNoise(x, y, 2, 999);
          }
        } else if (cell.terrain === 'ramp') {
          // Ramps get very subtle noise - mostly flat for smooth transition
          detailNoise = smoothNoise(x, y, 12, 555) * 0.08;
        } else {
          // Ground and unbuildable: PERFECTLY FLAT (SC2 style)
          // Only add tiny micro-variation for visual interest in textures
          detailNoise = 0;
        }

        const finalHeight = baseHeight + detailNoise;
        // Use negative Y so that after -π/2 rotation around X,
        // the terrain ends up at positive Z (0 to mapHeight)
        vertexGrid[y][x] = new THREE.Vector3(
          x * cellSize,
          -y * cellSize,  // Negative so world Z will be positive after rotation
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

        // Get biome-based color for this terrain type
        const terrainColorType = cell.terrain === 'unwalkable' ? 'cliff' :
                                  cell.terrain === 'ramp' ? 'ramp' : 'ground';
        const baseColor = blendBiomeColors(this.biome, x, y, terrainColorType);

        // Adjust color based on elevation
        const elevationBrightness = 1 + cell.elevation * 0.08;
        baseColor.multiplyScalar(elevationBrightness);

        // Get cell corners
        const v00 = vertexGrid[y][x];
        const v10 = vertexGrid[y][x + 1];
        const v01 = vertexGrid[y + 1][x];
        const v11 = vertexGrid[y + 1][x + 1];

        // Calculate colors with variation
        const colors6: THREE.Color[] = [];
        for (let i = 0; i < 6; i++) {
          const color = baseColor.clone();

          // Add texture variation based on position
          const noiseVal = noise2D(x + i * 0.1, y + i * 0.1, cell.textureId);

          // Blend with accent colors from biome
          const accents = this.biome.colors.accent;
          if (accents.length > 0 && noiseVal > 0.7) {
            const accentIndex = Math.floor(noiseVal * accents.length) % accents.length;
            color.lerp(accents[accentIndex], (noiseVal - 0.7) * 1.5);
          }

          // Add subtle brightness variation
          const brightVar = (noise2D(x * 2.5, y * 2.5, 789) - 0.5) * 0.12;
          color.r = Math.max(0, Math.min(1, color.r + brightVar));
          color.g = Math.max(0, Math.min(1, color.g + brightVar));
          color.b = Math.max(0, Math.min(1, color.b + brightVar));

          // Edge darkening for depth
          const edgeFactor = this.getEdgeFactor(terrain, x, y, width, height);
          if (edgeFactor > 0) {
            color.multiplyScalar(1 - edgeFactor * 0.25);
          }

          colors6.push(color);
        }

        // Triangle 1 (v00, v01, v10) - reversed winding for correct normals after rotation
        vertices.push(v00.x, v00.y, v00.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v10.x, v10.y, v10.z);

        uvs.push(x / width, y / height);
        uvs.push(x / width, (y + 1) / height);
        uvs.push((x + 1) / width, y / height);

        // Triangle 2 (v10, v01, v11) - reversed winding for correct normals after rotation
        vertices.push(v10.x, v10.y, v10.z);
        vertices.push(v01.x, v01.y, v01.z);
        vertices.push(v11.x, v11.y, v11.z);

        uvs.push((x + 1) / width, y / height);
        uvs.push(x / width, (y + 1) / height);
        uvs.push((x + 1) / width, (y + 1) / height);

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

  private calculateElevationEdgeFactor(
    terrain: MapCell[][],
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    // Check all 8 neighbors for elevation changes to create cliff edges
    const neighbors = [
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 },
    ];

    let maxElevationDiff = 0;
    const cell = this.sampleTerrain(terrain, x, y, width, height);

    for (const { dx, dy } of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx <= width && ny >= 0 && ny <= height) {
        const neighbor = this.sampleTerrain(terrain, nx, ny, width, height);
        const diff = Math.abs(neighbor.elevation - cell.elevation);
        maxElevationDiff = Math.max(maxElevationDiff, diff);
      }
    }

    return maxElevationDiff;
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
  private terrain: Terrain;

  constructor(mapData: MapData, terrain: Terrain) {
    this.group = new THREE.Group();
    this.terrain = terrain;
    this.createWatchTowers(mapData);
    this.createDestructibles(mapData);

    // Use explicit decorations from map data if available, otherwise use procedural
    if (mapData.decorations && mapData.decorations.length > 0) {
      this.createExplicitDecorations(mapData);
    } else {
      this.createTrees(mapData);
      this.createRocks(mapData);
    }
  }

  // Create explicit decorations from map data using GLB models
  private createExplicitDecorations(mapData: MapData): void {
    if (!mapData.decorations) return;

    for (const decoration of mapData.decorations) {
      const terrainHeight = this.terrain.getHeightAt(decoration.x, decoration.y);

      // Try to get the GLB model for this decoration type
      const model = AssetManager.getDecorationMesh(decoration.type);
      if (model) {
        model.position.set(decoration.x, terrainHeight, decoration.y);
        if (decoration.scale) {
          model.scale.setScalar(decoration.scale);
        }
        if (decoration.rotation !== undefined) {
          model.rotation.y = decoration.rotation;
        } else {
          model.rotation.y = Math.random() * Math.PI * 2;
        }
        this.group.add(model);
      } else {
        // Fallback to procedural mesh for unloaded decoration types
        this.createProceduralDecoration(decoration, terrainHeight);
      }
    }
  }

  // Fallback procedural decorations for when models aren't loaded
  private createProceduralDecoration(
    decoration: { type: string; x: number; y: number; scale?: number; rotation?: number },
    terrainHeight: number
  ): void {
    const scale = decoration.scale ?? 1;
    let mesh: THREE.Mesh | THREE.Group | null = null;

    if (decoration.type.includes('tree')) {
      // Create procedural tree
      const group = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2 * scale, 0.3 * scale, 2 * scale, 6),
        new THREE.MeshBasicMaterial({ color: 0x4a3520 })
      );
      trunk.position.y = scale;
      group.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(1.2 * scale, 2.5 * scale, 8),
        new THREE.MeshBasicMaterial({ color: 0x2d5a2d })
      );
      foliage.position.y = 2.5 * scale;
      group.add(foliage);
      mesh = group as unknown as THREE.Mesh;
    } else if (decoration.type.includes('rock')) {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.8 * scale),
        new THREE.MeshBasicMaterial({ color: 0x5a5a5a })
      );
    } else if (decoration.type === 'crystal_formation') {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6 * scale),
        new THREE.MeshBasicMaterial({ color: 0x80a0ff, transparent: true, opacity: 0.7 })
      );
    } else if (decoration.type === 'bush' || decoration.type === 'grass_clump') {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.4 * scale, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x3a6a3a })
      );
    } else if (decoration.type === 'debris') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 * scale, 0.2 * scale, 0.5 * scale),
        new THREE.MeshBasicMaterial({ color: 0x4a4a4a })
      );
    } else if (decoration.type === 'ruined_wall') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2 * scale, 1.5 * scale, 0.3 * scale),
        new THREE.MeshBasicMaterial({ color: 0x6a6a6a })
      );
    }

    if (mesh) {
      mesh.position.set(decoration.x, terrainHeight + (decoration.type.includes('rock') ? 0.3 : 0), decoration.y);
      if (decoration.rotation !== undefined) {
        mesh.rotation.y = decoration.rotation;
      }
      this.group.add(mesh);
    }
  }

  private createWatchTowers(mapData: MapData): void {
    for (const tower of mapData.watchTowers) {
      // Get terrain height at tower position
      const terrainHeight = this.terrain.getHeightAt(tower.x, tower.y);

      // Try to use custom xelnaga_tower model
      const customTower = AssetManager.getDecorationMesh('xelnaga_tower');
      if (customTower) {
        customTower.position.set(tower.x, terrainHeight, tower.y);
        this.group.add(customTower);
      } else {
        // Fall back to procedural tower
        // Tower base
        const baseGeometry = new THREE.CylinderGeometry(2, 2.5, 1, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: 0x606070,
          roughness: 0.6,
          metalness: 0.4,
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(tower.x, terrainHeight + 0.5, tower.y);
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
        pillar.position.set(tower.x, terrainHeight + 3.5, tower.y);
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
        top.position.set(tower.x, terrainHeight + 7, tower.y);
        top.castShadow = true;
        this.group.add(top);
      }

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
      ring.position.set(tower.x, terrainHeight + 0.15, tower.y);
      this.group.add(ring);
    }
  }

  private createDestructibles(mapData: MapData): void {
    for (const rock of mapData.destructibles) {
      // Get terrain height at rock position
      const terrainHeight = this.terrain.getHeightAt(rock.x, rock.y);

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

      rockGroup.position.set(rock.x, terrainHeight, rock.y);
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
      // Get terrain height at tree position
      const terrainHeight = this.terrain.getHeightAt(pos.x, pos.y);

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

      treeGroup.position.set(pos.x, terrainHeight, pos.y);
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
          // Get terrain height at rock position
          const terrainHeight = this.terrain.getHeightAt(x, y);

          const rockGeometry = new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.4);
          const rockMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.3 + Math.random() * 0.1, 0.28 + Math.random() * 0.1, 0.25 + Math.random() * 0.1),
            roughness: 0.9,
          });
          const rock = new THREE.Mesh(rockGeometry, rockMaterial);
          rock.position.set(x, terrainHeight + 0.15 + Math.random() * 0.1, y);
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
