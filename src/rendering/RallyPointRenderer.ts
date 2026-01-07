import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { World } from '@/engine/ecs/World';
import { Building } from '@/engine/components/Building';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';

interface RallyPoint {
  buildingId: number;
  line: THREE.Line;
  marker: THREE.Mesh;
}

export class RallyPointRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private world: World;
  private playerId: string;

  private rallyPoints: Map<number, RallyPoint> = new Map();
  private selectedBuildingIds: Set<number> = new Set();

  // Shared materials
  private lineMaterial: THREE.LineBasicMaterial;
  private markerMaterial: THREE.MeshBasicMaterial;
  private markerGeometry: THREE.ConeGeometry;

  constructor(
    scene: THREE.Scene,
    eventBus: EventBus,
    world: World,
    playerId: string = 'player1'
  ) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.world = world;
    this.playerId = playerId;

    // Create shared resources
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.7,
      linewidth: 2,
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
    });

    this.markerGeometry = new THREE.ConeGeometry(0.3, 0.6, 8);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('selection:changed', (data: { selectedIds: number[] }) => {
      this.updateSelectedBuildings(data.selectedIds);
    });

    this.eventBus.on('rally:set', (data: {
      buildingId: number;
      x: number;
      y: number;
      targetId?: number;
    }) => {
      const entity = this.world.getEntity(data.buildingId);
      if (!entity) return;

      const building = entity.get<Building>('Building');
      if (building) {
        building.setRallyPoint(data.x, data.y, data.targetId ?? null);
      }
    });
  }

  private updateSelectedBuildings(selectedIds: number[]): void {
    this.selectedBuildingIds.clear();

    for (const id of selectedIds) {
      const entity = this.world.getEntity(id);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      const selectable = entity.get<Selectable>('Selectable');

      if (building && selectable?.playerId === this.playerId) {
        this.selectedBuildingIds.add(id);
      }
    }
  }

  public update(): void {
    // Remove rally points for buildings no longer selected
    for (const [buildingId, rallyPoint] of this.rallyPoints.entries()) {
      if (!this.selectedBuildingIds.has(buildingId)) {
        this.scene.remove(rallyPoint.line);
        this.scene.remove(rallyPoint.marker);
        rallyPoint.line.geometry.dispose();
        this.rallyPoints.delete(buildingId);
      }
    }

    // Update or create rally points for selected buildings
    for (const buildingId of this.selectedBuildingIds) {
      const entity = this.world.getEntity(buildingId);
      if (!entity) continue;

      const building = entity.get<Building>('Building');
      const transform = entity.get<Transform>('Transform');

      if (!building || !transform) continue;
      if (building.rallyX === null || building.rallyY === null) continue;

      // Building position is already center-based
      const buildingCenterX = transform.x;
      const buildingCenterY = transform.y;

      const existing = this.rallyPoints.get(buildingId);

      if (existing) {
        // Update existing rally point
        this.updateRallyPointVisual(
          existing,
          buildingCenterX,
          buildingCenterY,
          building.rallyX,
          building.rallyY
        );
      } else {
        // Create new rally point visual
        const rallyPoint = this.createRallyPointVisual(
          buildingCenterX,
          buildingCenterY,
          building.rallyX,
          building.rallyY
        );
        this.rallyPoints.set(buildingId, rallyPoint);
        this.scene.add(rallyPoint.line);
        this.scene.add(rallyPoint.marker);
      }
    }
  }

  private createRallyPointVisual(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): RallyPoint {
    // Create dashed line from building to rally point
    const points = this.createDashedLinePoints(startX, startY, endX, endY);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, this.lineMaterial);

    // Create marker at rally point
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
    marker.position.set(endX, 0.5, endY);
    marker.rotation.x = Math.PI; // Point downward

    return { buildingId: 0, line, marker };
  }

  private updateRallyPointVisual(
    rallyPoint: RallyPoint,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): void {
    // Update line
    const points = this.createDashedLinePoints(startX, startY, endX, endY);
    rallyPoint.line.geometry.dispose();
    rallyPoint.line.geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Update marker position
    rallyPoint.marker.position.set(endX, 0.5, endY);

    // Add subtle animation to marker
    const time = Date.now() * 0.003;
    rallyPoint.marker.position.y = 0.5 + Math.sin(time) * 0.1;
    rallyPoint.marker.rotation.y = time;
  }

  private createDashedLinePoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const dashLength = 0.5;
    const gapLength = 0.3;

    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const segments = Math.floor(distance / (dashLength + gapLength));

    const dirX = dx / distance;
    const dirY = dy / distance;

    for (let i = 0; i < segments; i++) {
      const segmentStart = i * (dashLength + gapLength);
      const segmentEnd = segmentStart + dashLength;

      points.push(
        new THREE.Vector3(
          startX + dirX * segmentStart,
          0.2,
          startY + dirY * segmentStart
        ),
        new THREE.Vector3(
          startX + dirX * Math.min(segmentEnd, distance),
          0.2,
          startY + dirY * Math.min(segmentEnd, distance)
        )
      );
    }

    // Add final segment to reach the end point
    const lastSegmentEnd = segments * (dashLength + gapLength);
    if (lastSegmentEnd < distance) {
      points.push(
        new THREE.Vector3(startX + dirX * lastSegmentEnd, 0.2, startY + dirY * lastSegmentEnd),
        new THREE.Vector3(endX, 0.2, endY)
      );
    }

    return points;
  }

  public dispose(): void {
    for (const rallyPoint of this.rallyPoints.values()) {
      this.scene.remove(rallyPoint.line);
      this.scene.remove(rallyPoint.marker);
      rallyPoint.line.geometry.dispose();
    }
    this.rallyPoints.clear();

    this.lineMaterial.dispose();
    this.markerMaterial.dispose();
    this.markerGeometry.dispose();
  }
}
