import * as THREE from 'three';

export interface TerrainConfig {
  width: number;
  height: number;
  segments: number;
  maxHeight: number;
  seed?: number;
}

export class Terrain {
  public mesh: THREE.Mesh;
  public heightData: Float32Array;

  private width: number;
  private height: number;
  private segments: number;
  private maxHeight: number;

  constructor(config: TerrainConfig) {
    this.width = config.width;
    this.height = config.height;
    this.segments = config.segments;
    this.maxHeight = config.maxHeight;

    this.heightData = this.generateHeightmap(config.seed ?? Math.random() * 10000);
    this.mesh = this.createMesh();
  }

  private generateHeightmap(seed: number): Float32Array {
    const size = (this.segments + 1) * (this.segments + 1);
    const data = new Float32Array(size);

    // Simple Perlin-like noise generation
    for (let i = 0; i <= this.segments; i++) {
      for (let j = 0; j <= this.segments; j++) {
        const index = i * (this.segments + 1) + j;

        // Multi-octave noise
        let height = 0;
        let amplitude = 1;
        let frequency = 0.02;

        for (let octave = 0; octave < 4; octave++) {
          const nx = j * frequency + seed;
          const ny = i * frequency + seed * 2;

          // Simple noise function
          height += this.noise2D(nx, ny) * amplitude;

          amplitude *= 0.5;
          frequency *= 2;
        }

        // Normalize and scale
        data[index] = ((height + 1) / 2) * this.maxHeight * 0.3;
      }
    }

    return data;
  }

  private noise2D(x: number, y: number): number {
    // Simple pseudo-random noise
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }

  private createMesh(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(
      this.width,
      this.height,
      this.segments,
      this.segments
    );

    // Apply heightmap to vertices
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setZ(i, this.heightData[i]);
    }

    geometry.computeVertexNormals();

    // Create material with vertex colors based on height
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const height = this.heightData[i] / this.maxHeight;

      // Color gradient: dark green -> light green -> brown -> gray
      let r, g, b;
      if (height < 0.3) {
        // Low ground - dark green
        r = 0.1 + height * 0.3;
        g = 0.3 + height * 0.4;
        b = 0.1;
      } else if (height < 0.6) {
        // Mid ground - light green to brown
        const t = (height - 0.3) / 0.3;
        r = 0.2 + t * 0.4;
        g = 0.5 - t * 0.2;
        b = 0.1 + t * 0.1;
      } else {
        // High ground - brown to gray
        const t = (height - 0.6) / 0.4;
        r = 0.5 + t * 0.2;
        g = 0.3 + t * 0.2;
        b = 0.2 + t * 0.3;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;

    return mesh;
  }

  public getHeightAt(x: number, y: number): number {
    // Convert world coordinates to heightmap indices
    const localX = (x + this.width / 2) / this.width;
    const localY = (y + this.height / 2) / this.height;

    const gridX = Math.floor(localX * this.segments);
    const gridY = Math.floor(localY * this.segments);

    if (gridX < 0 || gridX >= this.segments || gridY < 0 || gridY >= this.segments) {
      return 0;
    }

    const index = gridY * (this.segments + 1) + gridX;
    return this.heightData[index] || 0;
  }

  public isWalkable(x: number, y: number): boolean {
    const height = this.getHeightAt(x, y);
    // Consider unwalkable if height is above certain threshold (cliffs)
    return height < this.maxHeight * 0.7;
  }

  public getWidth(): number {
    return this.width;
  }

  public getHeight(): number {
    return this.height;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
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
    this.mesh.visible = false; // Hidden by default
  }

  private createMesh(): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];

    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;

    // Vertical lines
    for (let x = -halfWidth; x <= halfWidth; x += this.cellSize) {
      vertices.push(x, 0.1, -halfHeight);
      vertices.push(x, 0.1, halfHeight);
    }

    // Horizontal lines
    for (let z = -halfHeight; z <= halfHeight; z += this.cellSize) {
      vertices.push(-halfWidth, 0.1, z);
      vertices.push(halfWidth, 0.1, z);
    }

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    );

    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      opacity: 0.3,
      transparent: true,
    });

    return new THREE.LineSegments(geometry, material);
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
