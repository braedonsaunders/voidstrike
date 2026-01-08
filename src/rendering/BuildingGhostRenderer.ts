import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { Terrain } from './Terrain';
import { World } from '@/engine/ecs/World';
import { Building } from '@/engine/components/Building';
import { Transform } from '@/engine/components/Transform';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { BuildingDefinition } from '@/engine/components/Building';

/**
 * Building Placement Ghost Renderer
 * Shows a preview of where a building will be placed with:
 * - Semi-transparent building shape
 * - Grid overlay showing valid/invalid cells
 * - Green (valid) / Red (invalid) coloring
 */

interface GridCell {
  mesh: THREE.Mesh;
  x: number;
  z: number;
}

export class BuildingGhostRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private terrain: Terrain | null;
  private world: World;

  private ghostGroup: THREE.Group | null = null;
  private ghostMesh: THREE.Mesh | null = null;
  private gridCells: GridCell[] = [];
  private outlineMesh: THREE.LineSegments | null = null;

  private currentBuildingType: string | null = null;
  private currentPosition: THREE.Vector3 = new THREE.Vector3();
  private isVisible: boolean = false;

  // Colors
  private validColor = new THREE.Color(0x00ff00);
  private invalidColor = new THREE.Color(0xff0000);
  private validCellOpacity = 0.3;
  private invalidCellOpacity = 0.5;

  constructor(scene: THREE.Scene, eventBus: EventBus, world: World, terrain?: Terrain) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.world = world;
    this.terrain = terrain ?? null;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for building mode changes
    this.eventBus.on('ui:buildingMode', (data: { buildingType: string | null }) => {
      if (data.buildingType) {
        this.showGhost(data.buildingType);
      } else {
        this.hideGhost();
      }
    });
  }

  public showGhost(buildingType: string): void {
    // Clean up existing ghost
    this.hideGhost();

    this.currentBuildingType = buildingType;
    this.isVisible = true;

    // Get building definition
    const def = BUILDING_DEFINITIONS[buildingType];
    if (!def) {
      console.warn(`[BuildingGhostRenderer] Unknown building type: ${buildingType}`);
      return;
    }

    this.createGhost(def);
  }

  public hideGhost(): void {
    if (this.ghostGroup) {
      this.scene.remove(this.ghostGroup);
      this.disposeGhost();
    }
    this.ghostGroup = null;
    this.ghostMesh = null;
    this.gridCells = [];
    this.outlineMesh = null;
    this.currentBuildingType = null;
    this.isVisible = false;
  }

  private createGhost(def: BuildingDefinition): void {
    this.ghostGroup = new THREE.Group();

    const width = def.width;
    const height = def.height;
    const buildingHeight = 2.5; // Visual height

    // Main building ghost mesh
    const geometry = new THREE.BoxGeometry(width, buildingHeight, height);
    const material = new THREE.MeshBasicMaterial({
      color: this.validColor,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ghostMesh = new THREE.Mesh(geometry, material);
    this.ghostMesh.position.y = buildingHeight / 2;
    this.ghostGroup.add(this.ghostMesh);

    // Outline
    const outlineGeometry = new THREE.EdgesGeometry(geometry);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: this.validColor,
      transparent: true,
      opacity: 0.8,
    });
    this.outlineMesh = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.outlineMesh.position.y = buildingHeight / 2;
    this.ghostGroup.add(this.outlineMesh);

    // Grid cells for each tile
    const cellGeometry = new THREE.PlaneGeometry(0.9, 0.9);

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const cellMaterial = new THREE.MeshBasicMaterial({
          color: this.validColor,
          transparent: true,
          opacity: this.validCellOpacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const cell = new THREE.Mesh(cellGeometry, cellMaterial);
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(
          x - width / 2 + 0.5,
          0.08,
          z - height / 2 + 0.5
        );

        this.gridCells.push({ mesh: cell, x, z });
        this.ghostGroup.add(cell);
      }
    }

    // Ground outline ring
    const groundRingGeometry = new THREE.RingGeometry(
      Math.max(width, height) / 2 + 0.2,
      Math.max(width, height) / 2 + 0.4,
      32
    );
    const groundRingMaterial = new THREE.MeshBasicMaterial({
      color: this.validColor,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const groundRing = new THREE.Mesh(groundRingGeometry, groundRingMaterial);
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = 0.05;
    groundRing.name = 'groundRing';
    this.ghostGroup.add(groundRing);

    this.scene.add(this.ghostGroup);
  }

  public updatePosition(worldX: number, worldZ: number): void {
    if (!this.ghostGroup || !this.currentBuildingType) return;

    // Snap to grid
    const snappedX = Math.round(worldX);
    const snappedZ = Math.round(worldZ);

    this.currentPosition.set(snappedX, 0, snappedZ);

    // Get terrain height
    const terrainHeight = this.terrain?.getHeightAt(snappedX, snappedZ) ?? 0;

    this.ghostGroup.position.set(snappedX, terrainHeight, snappedZ);

    // Check placement validity
    this.updateValidity(snappedX, snappedZ);
  }

  private updateValidity(centerX: number, centerZ: number): void {
    if (!this.ghostGroup || !this.currentBuildingType) return;

    const def = BUILDING_DEFINITIONS[this.currentBuildingType];
    if (!def) return;

    const width = def.width;
    const height = def.height;

    // Check each cell
    let allValid = true;

    for (const cell of this.gridCells) {
      const worldX = centerX + cell.x - Math.floor(width / 2);
      const worldZ = centerZ + cell.z - Math.floor(height / 2);

      const isValid = this.isCellValid(worldX, worldZ);

      const material = cell.mesh.material as THREE.MeshBasicMaterial;
      if (isValid) {
        material.color.copy(this.validColor);
        material.opacity = this.validCellOpacity;
      } else {
        material.color.copy(this.invalidColor);
        material.opacity = this.invalidCellOpacity;
        allValid = false;
      }
    }

    // Update main ghost color
    if (this.ghostMesh) {
      const mat = this.ghostMesh.material as THREE.MeshBasicMaterial;
      mat.color.copy(allValid ? this.validColor : this.invalidColor);
    }

    if (this.outlineMesh) {
      const mat = this.outlineMesh.material as THREE.LineBasicMaterial;
      mat.color.copy(allValid ? this.validColor : this.invalidColor);
    }

    // Update ground ring
    const groundRing = this.ghostGroup.getObjectByName('groundRing') as THREE.Mesh;
    if (groundRing) {
      const mat = groundRing.material as THREE.MeshBasicMaterial;
      mat.color.copy(allValid ? this.validColor : this.invalidColor);
    }
  }

  private isCellValid(x: number, z: number): boolean {
    // Check terrain walkability and buildability
    if (this.terrain) {
      if (!this.terrain.isBuildable(x, z)) {
        return false;
      }
    }

    // Check map bounds (use terrain if available)
    if (this.terrain) {
      const width = this.terrain.getWidth();
      const height = this.terrain.getHeight();
      if (x < 0 || x >= width || z < 0 || z >= height) {
        return false;
      }
    }

    // Check collision with existing buildings
    const buildings = this.world.getEntitiesWith('Building', 'Transform');
    for (const entity of buildings) {
      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      const halfW = building.width / 2;
      const halfH = building.height / 2;

      // Check if this cell overlaps with the building's footprint
      if (
        x >= transform.x - halfW - 0.5 &&
        x <= transform.x + halfW + 0.5 &&
        z >= transform.y - halfH - 0.5 &&
        z <= transform.y + halfH + 0.5
      ) {
        return false;
      }
    }

    // Check collision with resources
    const resources = this.world.getEntitiesWith('Resource', 'Transform');
    for (const entity of resources) {
      const transform = entity.get<Transform>('Transform')!;
      const dx = x - transform.x;
      const dz = z - transform.y;
      if (dx * dx + dz * dz < 4) {
        return false;
      }
    }

    return true;
  }

  public isPlacementValid(): boolean {
    if (!this.currentBuildingType) return false;

    const def = BUILDING_DEFINITIONS[this.currentBuildingType];
    if (!def) return false;

    const width = def.width;
    const height = def.height;
    const centerX = this.currentPosition.x;
    const centerZ = this.currentPosition.z;

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const worldX = centerX + x - Math.floor(width / 2);
        const worldZ = centerZ + z - Math.floor(height / 2);

        if (!this.isCellValid(worldX, worldZ)) {
          return false;
        }
      }
    }

    return true;
  }

  public getPlacementPosition(): { x: number; z: number } {
    return { x: this.currentPosition.x, z: this.currentPosition.z };
  }

  public isActive(): boolean {
    return this.isVisible && this.currentBuildingType !== null;
  }

  private disposeGhost(): void {
    if (this.ghostGroup) {
      this.ghostGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
  }

  public dispose(): void {
    this.hideGhost();
  }
}
