import * as THREE from 'three';
import { BiomeConfig, BiomeType, BIOMES } from './Biomes';
import { MapData } from '@/data/maps';

/**
 * Enhanced tree generation with biome-specific variants
 */
export class EnhancedTrees {
  public group: THREE.Group;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    if (biome.treeDensity <= 0) return;

    const treeCount = Math.floor(mapData.width * mapData.height * biome.treeDensity * 0.008);
    const maxTrees = Math.min(treeCount, 300);

    // Determine tree type based on biome
    const treeType = this.getTreeType(biome);

    for (let i = 0; i < maxTrees; i++) {
      // Prefer edges and unbuildable areas
      let x: number, y: number;

      if (Math.random() < 0.6) {
        // Edge placement
        const edge = Math.floor(Math.random() * 4);
        switch (edge) {
          case 0: x = 8 + Math.random() * 15; y = 10 + Math.random() * (mapData.height - 20); break;
          case 1: x = mapData.width - 23 + Math.random() * 15; y = 10 + Math.random() * (mapData.height - 20); break;
          case 2: x = 10 + Math.random() * (mapData.width - 20); y = 8 + Math.random() * 15; break;
          default: x = 10 + Math.random() * (mapData.width - 20); y = mapData.height - 23 + Math.random() * 15; break;
        }
      } else {
        // Random interior placement
        x = 15 + Math.random() * (mapData.width - 30);
        y = 15 + Math.random() * (mapData.height - 30);
      }

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain === 'ground' || cell.terrain === 'unbuildable') {
          const height = getHeightAt(x, y);
          const tree = this.createTree(treeType, biome);
          tree.position.set(x, height, y);
          tree.rotation.y = Math.random() * Math.PI * 2;
          tree.scale.setScalar(0.7 + Math.random() * 0.6);
          this.group.add(tree);
        }
      }
    }
  }

  private getTreeType(biome: BiomeConfig): 'pine' | 'oak' | 'palm' | 'dead' | 'cactus' | 'alien' {
    switch (biome.name) {
      case 'Frozen Wastes': return 'dead';
      case 'Desert': return 'cactus';
      case 'Volcanic': return 'dead';
      case 'Void': return 'alien';
      case 'Jungle': return 'oak';
      default: return Math.random() < 0.6 ? 'pine' : 'oak';
    }
  }

  private createTree(type: string, biome: BiomeConfig): THREE.Group {
    const tree = new THREE.Group();

    switch (type) {
      case 'pine':
        this.createPineTree(tree, biome);
        break;
      case 'oak':
        this.createOakTree(tree, biome);
        break;
      case 'dead':
        this.createDeadTree(tree, biome);
        break;
      case 'cactus':
        this.createCactus(tree, biome);
        break;
      case 'alien':
        this.createAlienTree(tree, biome);
        break;
      default:
        this.createPineTree(tree, biome);
    }

    return tree;
  }

  private createPineTree(tree: THREE.Group, biome: BiomeConfig): void {
    const height = 4 + Math.random() * 2;

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.25, height * 0.35, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3520,
      roughness: 0.9,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = height * 0.175;
    trunk.castShadow = true;
    tree.add(trunk);

    // Foliage layers
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: biome.colors.ground[1].clone().multiplyScalar(0.8),
      roughness: 0.85,
    });

    for (let layer = 0; layer < 4; layer++) {
      const layerHeight = height * 0.22;
      const layerRadius = 1.4 - layer * 0.25;
      const foliageGeometry = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
      foliage.position.y = height * 0.35 + layer * layerHeight * 0.6;
      foliage.castShadow = true;
      foliage.receiveShadow = true;
      tree.add(foliage);
    }
  }

  private createOakTree(tree: THREE.Group, biome: BiomeConfig): void {
    const height = 3 + Math.random() * 1.5;

    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.35, height * 0.5, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a4530,
      roughness: 0.9,
    });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = height * 0.25;
    trunk.castShadow = true;
    tree.add(trunk);

    // Foliage (spherical canopy)
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: biome.colors.ground[0].clone().lerp(new THREE.Color(0x2a5a2a), 0.3),
      roughness: 0.9,
    });

    // Main canopy
    const canopyGeometry = new THREE.SphereGeometry(1.5, 8, 6);
    const canopy = new THREE.Mesh(canopyGeometry, foliageMaterial);
    canopy.position.y = height * 0.6;
    canopy.scale.set(1, 0.7, 1);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    tree.add(canopy);

    // Secondary smaller spheres
    for (let i = 0; i < 3; i++) {
      const secondaryGeometry = new THREE.SphereGeometry(0.8, 6, 4);
      const secondary = new THREE.Mesh(secondaryGeometry, foliageMaterial);
      const angle = (i / 3) * Math.PI * 2;
      secondary.position.set(
        Math.cos(angle) * 0.8,
        height * 0.5 + Math.random() * 0.5,
        Math.sin(angle) * 0.8
      );
      secondary.castShadow = true;
      tree.add(secondary);
    }
  }

  private createDeadTree(tree: THREE.Group, biome: BiomeConfig): void {
    const height = 2 + Math.random() * 2;

    // Dead trunk (darker, weathered)
    const trunkMaterial = new THREE.MeshStandardMaterial({
      color: biome.name === 'Volcanic' ? 0x1a1a1a : 0x3a3535,
      roughness: 0.95,
    });

    // Main trunk
    const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.2, height, 6);
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = height / 2;
    trunk.rotation.z = (Math.random() - 0.5) * 0.2;
    trunk.castShadow = true;
    tree.add(trunk);

    // Dead branches
    for (let i = 0; i < 3; i++) {
      const branchGeometry = new THREE.CylinderGeometry(0.03, 0.06, 0.8, 4);
      const branch = new THREE.Mesh(branchGeometry, trunkMaterial);
      const branchHeight = height * 0.4 + Math.random() * height * 0.4;
      const angle = Math.random() * Math.PI * 2;
      branch.position.set(
        Math.cos(angle) * 0.15,
        branchHeight,
        Math.sin(angle) * 0.15
      );
      branch.rotation.x = Math.PI / 4 + Math.random() * 0.3;
      branch.rotation.y = angle;
      branch.castShadow = true;
      tree.add(branch);
    }
  }

  private createCactus(tree: THREE.Group, biome: BiomeConfig): void {
    const height = 1.5 + Math.random() * 1;

    const cactusMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a6a2a,
      roughness: 0.7,
    });

    // Main body
    const bodyGeometry = new THREE.CylinderGeometry(0.25, 0.3, height, 8);
    const body = new THREE.Mesh(bodyGeometry, cactusMaterial);
    body.position.y = height / 2;
    body.castShadow = true;
    tree.add(body);

    // Arms (50% chance)
    if (Math.random() > 0.5) {
      for (let i = 0; i < 2; i++) {
        const armHeight = 0.5;
        const armGeometry = new THREE.CylinderGeometry(0.12, 0.15, armHeight, 6);
        const arm = new THREE.Mesh(armGeometry, cactusMaterial);

        const side = i === 0 ? 1 : -1;
        arm.position.set(side * 0.35, height * 0.5, 0);
        arm.rotation.z = side * Math.PI / 3;
        arm.castShadow = true;
        tree.add(arm);
      }
    }
  }

  private createAlienTree(tree: THREE.Group, biome: BiomeConfig): void {
    const height = 2 + Math.random() * 1.5;

    // Alien stalk (glowing purple)
    const stalkMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a2060,
      emissive: 0x2a1040,
      emissiveIntensity: 0.3,
      roughness: 0.5,
    });

    // Twisted stalk
    const stalkGeometry = new THREE.CylinderGeometry(0.15, 0.25, height, 8, 4, false);
    const stalk = new THREE.Mesh(stalkGeometry, stalkMaterial);
    stalk.position.y = height / 2;
    stalk.castShadow = true;
    tree.add(stalk);

    // Glowing top
    const topMaterial = new THREE.MeshStandardMaterial({
      color: biome.colors.accent[0],
      emissive: biome.colors.accent[0],
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8,
    });

    const topGeometry = new THREE.SphereGeometry(0.4, 8, 6);
    const top = new THREE.Mesh(topGeometry, topMaterial);
    top.position.y = height + 0.2;
    tree.add(top);

    // Tendrils
    for (let i = 0; i < 4; i++) {
      const tendrilGeometry = new THREE.CylinderGeometry(0.02, 0.05, 0.6, 4);
      const tendril = new THREE.Mesh(tendrilGeometry, stalkMaterial);
      const angle = (i / 4) * Math.PI * 2;
      tendril.position.set(
        Math.cos(angle) * 0.15,
        height * 0.7,
        Math.sin(angle) * 0.15
      );
      tendril.rotation.x = Math.PI / 3;
      tendril.rotation.y = angle;
      tree.add(tendril);
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

/**
 * Enhanced rock formations
 */
export class EnhancedRocks {
  public group: THREE.Group;

  constructor(
    mapData: MapData,
    biome: BiomeConfig,
    getHeightAt: (x: number, y: number) => number
  ) {
    this.group = new THREE.Group();

    const rockCount = Math.floor(mapData.width * mapData.height * biome.rockDensity * 0.006);
    const maxRocks = Math.min(rockCount, 200);

    for (let i = 0; i < maxRocks; i++) {
      const x = 8 + Math.random() * (mapData.width - 16);
      const y = 8 + Math.random() * (mapData.height - 16);

      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      if (cellX >= 0 && cellX < mapData.width && cellY >= 0 && cellY < mapData.height) {
        const cell = mapData.terrain[cellY][cellX];
        if (cell.terrain !== 'ramp') {
          const height = getHeightAt(x, y);
          const rockFormation = this.createRockFormation(biome);
          rockFormation.position.set(x, height, y);
          rockFormation.rotation.y = Math.random() * Math.PI * 2;
          this.group.add(rockFormation);
        }
      }
    }
  }

  private createRockFormation(biome: BiomeConfig): THREE.Group {
    const formation = new THREE.Group();

    // Rock material varies by biome
    const rockColor = biome.colors.cliff[Math.floor(Math.random() * biome.colors.cliff.length)];
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: rockColor,
      roughness: 0.9,
      metalness: 0.05,
    });

    // Main rock
    const mainSize = 0.5 + Math.random() * 0.8;
    const mainGeometry = new THREE.DodecahedronGeometry(mainSize);
    const mainRock = new THREE.Mesh(mainGeometry, rockMaterial);
    mainRock.position.y = mainSize * 0.6;
    mainRock.scale.set(1, 0.6 + Math.random() * 0.4, 1 + Math.random() * 0.3);
    mainRock.rotation.set(
      Math.random() * 0.4,
      Math.random() * Math.PI,
      Math.random() * 0.3
    );
    mainRock.castShadow = true;
    mainRock.receiveShadow = true;
    formation.add(mainRock);

    // Smaller rocks around
    const smallCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < smallCount; i++) {
      const smallSize = 0.15 + Math.random() * 0.25;
      const smallGeometry = new THREE.DodecahedronGeometry(smallSize);
      const smallRock = new THREE.Mesh(smallGeometry, rockMaterial);

      const angle = Math.random() * Math.PI * 2;
      const dist = mainSize * 0.8 + Math.random() * 0.5;
      smallRock.position.set(
        Math.cos(angle) * dist,
        smallSize * 0.5,
        Math.sin(angle) * dist
      );
      smallRock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      smallRock.castShadow = true;
      smallRock.receiveShadow = true;
      formation.add(smallRock);
    }

    return formation;
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

/**
 * Particle system for environmental effects (dust, snow, ash, etc.)
 */
export class EnvironmentParticles {
  public points: THREE.Points;
  private velocities: Float32Array;
  private particleCount: number;
  private bounds: { width: number; height: number };
  private particleType: string;

  constructor(
    mapData: MapData,
    biome: BiomeConfig
  ) {
    this.bounds = { width: mapData.width, height: mapData.height };
    this.particleType = biome.particleType;

    if (biome.particleType === 'none') {
      // Create invisible placeholder
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const material = new THREE.PointsMaterial({ visible: false });
      this.points = new THREE.Points(geometry, material);
      this.velocities = new Float32Array(0);
      this.particleCount = 0;
      return;
    }

    this.particleCount = 1500; // 3x more particles for better atmosphere
    const positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);

    // Initialize particle positions
    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = Math.random() * mapData.width;
      positions[i * 3 + 1] = Math.random() * 30; // Height
      positions[i * 3 + 2] = Math.random() * mapData.height;

      // Initial velocities based on type
      switch (biome.particleType) {
        case 'snow':
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.5;
          this.velocities[i * 3 + 1] = -0.5 - Math.random() * 0.5;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
          break;
        case 'dust':
          this.velocities[i * 3] = (Math.random() - 0.3) * 2;
          this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
          break;
        case 'ash':
          this.velocities[i * 3] = (Math.random() - 0.5) * 1;
          this.velocities[i * 3 + 1] = 0.2 + Math.random() * 0.3;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1;
          break;
        case 'spores':
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.3;
          this.velocities[i * 3 + 1] = 0.1 + Math.random() * 0.2;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
          break;
        case 'fireflies':
          // Slow, meandering movement with random direction changes
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.4;
          this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
          // Lower initial height for fireflies (1-8 meters)
          positions[i * 3 + 1] = 1 + Math.random() * 7;
          break;
        case 'embers':
          // Rising embers with slight drift
          this.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
          this.velocities[i * 3 + 1] = 0.5 + Math.random() * 1.0; // Rising
          this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
          // Start lower for embers (ground level to 5m)
          positions[i * 3 + 1] = Math.random() * 5;
          break;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Particle appearance based on type
    let color: THREE.Color;
    let size: number;
    let opacity: number;

    switch (biome.particleType) {
      case 'snow':
        color = new THREE.Color(0xffffff);
        size = 0.15;
        opacity = 0.8;
        break;
      case 'dust':
        color = new THREE.Color(0xc4a060);
        size = 0.08;
        opacity = 0.4;
        break;
      case 'ash':
        color = new THREE.Color(0x404040);
        size = 0.1;
        opacity = 0.5;
        break;
      case 'spores':
        color = new THREE.Color(0x80ff80);
        size = 0.12;
        opacity = 0.6;
        break;
      case 'fireflies':
        color = new THREE.Color(0xffff40); // Warm yellow glow
        size = 0.2;
        opacity = 0.9;
        break;
      case 'embers':
        color = new THREE.Color(0xff6020); // Orange-red hot embers
        size = 0.15;
        opacity = 0.85;
        break;
      default:
        color = new THREE.Color(0xffffff);
        size = 0.1;
        opacity = 0.5;
    }

    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
  }

  public update(deltaTime: number): void {
    if (this.particleCount === 0) return;

    const positions = this.points.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < this.particleCount; i++) {
      // Update position
      positions[i * 3] += this.velocities[i * 3] * deltaTime;
      positions[i * 3 + 1] += this.velocities[i * 3 + 1] * deltaTime;
      positions[i * 3 + 2] += this.velocities[i * 3 + 2] * deltaTime;

      // Wrap around bounds
      if (positions[i * 3] < 0) positions[i * 3] = this.bounds.width;
      if (positions[i * 3] > this.bounds.width) positions[i * 3] = 0;
      if (positions[i * 3 + 2] < 0) positions[i * 3 + 2] = this.bounds.height;
      if (positions[i * 3 + 2] > this.bounds.height) positions[i * 3 + 2] = 0;

      // Reset if too high or too low based on particle type
      const minHeight = 0;
      let maxHeight = 35;
      let resetHeight = 0;

      switch (this.particleType) {
        case 'snow':
          resetHeight = 35;
          break;
        case 'fireflies':
          maxHeight = 10;
          // Fireflies stay in a range, randomly pick new position if out of bounds
          if (positions[i * 3 + 1] < 1 || positions[i * 3 + 1] > maxHeight) {
            positions[i * 3 + 1] = 1 + Math.random() * 7;
            // Also randomize velocity for more organic movement
            this.velocities[i * 3] = (Math.random() - 0.5) * 0.4;
            this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
            this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
          }
          // Occasionally change direction for organic movement
          if (Math.random() < 0.01) {
            this.velocities[i * 3] += (Math.random() - 0.5) * 0.2;
            this.velocities[i * 3 + 1] += (Math.random() - 0.5) * 0.1;
            this.velocities[i * 3 + 2] += (Math.random() - 0.5) * 0.2;
          }
          continue; // Skip the generic reset below
        case 'embers':
          maxHeight = 25;
          resetHeight = 0;
          break;
        default:
          resetHeight = 0;
      }

      if (positions[i * 3 + 1] < minHeight || positions[i * 3 + 1] > maxHeight) {
        positions[i * 3 + 1] = resetHeight;
        positions[i * 3] = Math.random() * this.bounds.width;
        positions[i * 3 + 2] = Math.random() * this.bounds.height;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
