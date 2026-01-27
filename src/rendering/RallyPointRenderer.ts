import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import { Building } from '@/engine/components/Building';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { distance } from '@/utils/math';

interface RallyPoint {
  buildingId: number;
  lineGroup: THREE.Group;
  lineMeshes: THREE.Mesh[];
  marker: THREE.Mesh;
}

export class RallyPointRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private world: IWorldProvider;
  private playerId: string | null;
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;

  private rallyPoints: Map<number, RallyPoint> = new Map();
  private selectedBuildingIds: Set<number> = new Set();

  // Shared materials and geometry
  private lineMaterial: THREE.MeshBasicMaterial;
  private markerMaterial: THREE.MeshBasicMaterial;
  private markerGeometry: THREE.ConeGeometry;
  private lineSegmentGeometry: THREE.BoxGeometry;
  private readonly LINE_WIDTH = 0.06;
  private readonly DASH_LENGTH = 0.5;
  private readonly GAP_LENGTH = 0.3;

  constructor(
    scene: THREE.Scene,
    eventBus: EventBus,
    world: IWorldProvider,
    playerId: string | null = null,
    getTerrainHeight?: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.world = world;
    this.playerId = playerId ?? getLocalPlayerId();
    this.getTerrainHeight = getTerrainHeight ?? null;

    // Create shared resources
    // Using MeshBasicMaterial instead of LineBasicMaterial because linewidth doesn't work in WebGL/WebGPU
    this.lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.7,
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
    });

    this.markerGeometry = new THREE.ConeGeometry(0.3, 0.6, 8);

    // Unit box geometry for line segments - will be scaled to dash length
    this.lineSegmentGeometry = new THREE.BoxGeometry(1, this.LINE_WIDTH, this.LINE_WIDTH);

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

      // In spectator mode, show rally points for all buildings; otherwise only for owned buildings
      const isSpectating = isSpectatorMode() || !this.playerId;
      if (building && (isSpectating || selectable?.playerId === this.playerId)) {
        this.selectedBuildingIds.add(id);
      }
    }
  }

  public update(): void {
    // Remove rally points for buildings no longer selected
    for (const [buildingId, rallyPoint] of this.rallyPoints.entries()) {
      if (!this.selectedBuildingIds.has(buildingId)) {
        this.scene.remove(rallyPoint.lineGroup);
        this.scene.remove(rallyPoint.marker);
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
        this.scene.add(rallyPoint.lineGroup);
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
    const lineGroup = new THREE.Group();
    const lineMeshes: THREE.Mesh[] = [];

    // Create dashed line segment meshes
    const segments = this.createDashedLineSegments(startX, startY, endX, endY);
    for (const seg of segments) {
      const mesh = new THREE.Mesh(this.lineSegmentGeometry, this.lineMaterial);
      this.positionLineSegmentMesh(mesh, seg.start, seg.end);
      lineGroup.add(mesh);
      lineMeshes.push(mesh);
    }

    // Create marker at rally point - account for terrain height
    const endHeight = this.getTerrainHeight ? this.getTerrainHeight(endX, endY) : 0;
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
    marker.position.set(endX, endHeight + 0.5, endY);
    marker.rotation.x = Math.PI; // Point downward

    return { buildingId: 0, lineGroup, lineMeshes, marker };
  }

  private updateRallyPointVisual(
    rallyPoint: RallyPoint,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): void {
    const segments = this.createDashedLineSegments(startX, startY, endX, endY);

    // Add or remove line meshes as needed
    while (rallyPoint.lineMeshes.length > segments.length) {
      const mesh = rallyPoint.lineMeshes.pop()!;
      rallyPoint.lineGroup.remove(mesh);
    }

    while (rallyPoint.lineMeshes.length < segments.length) {
      const mesh = new THREE.Mesh(this.lineSegmentGeometry, this.lineMaterial);
      rallyPoint.lineGroup.add(mesh);
      rallyPoint.lineMeshes.push(mesh);
    }

    // Update line mesh positions
    for (let i = 0; i < segments.length; i++) {
      this.positionLineSegmentMesh(rallyPoint.lineMeshes[i], segments[i].start, segments[i].end);
    }

    // Update marker position - account for terrain height
    const endHeight = this.getTerrainHeight ? this.getTerrainHeight(endX, endY) : 0;

    // Add subtle animation to marker
    const time = Date.now() * 0.003;
    rallyPoint.marker.position.set(endX, endHeight + 0.5 + Math.sin(time) * 0.1, endY);
    rallyPoint.marker.rotation.y = time;
  }

  private createDashedLineSegments(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Array<{ start: THREE.Vector3; end: THREE.Vector3 }> {
    const segments: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = [];
    const lineOffset = 0.2; // Height above terrain

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = distance(startX, startY, endX, endY);
    if (dist < 0.01) return segments;

    const dashPlusGap = this.DASH_LENGTH + this.GAP_LENGTH;
    const numDashes = Math.floor(dist / dashPlusGap);
    const dirX = dx / dist;
    const dirY = dy / dist;

    for (let i = 0; i < numDashes; i++) {
      const segmentStart = i * dashPlusGap;
      const segmentEnd = segmentStart + this.DASH_LENGTH;

      const x1 = startX + dirX * segmentStart;
      const z1 = startY + dirY * segmentStart;
      const x2 = startX + dirX * Math.min(segmentEnd, dist);
      const z2 = startY + dirY * Math.min(segmentEnd, dist);

      const y1 = (this.getTerrainHeight ? this.getTerrainHeight(x1, z1) : 0) + lineOffset;
      const y2 = (this.getTerrainHeight ? this.getTerrainHeight(x2, z2) : 0) + lineOffset;

      segments.push({
        start: new THREE.Vector3(x1, y1, z1),
        end: new THREE.Vector3(x2, y2, z2),
      });
    }

    // Add final segment to reach the end point if needed
    const lastSegmentEnd = numDashes * dashPlusGap;
    if (lastSegmentEnd < dist) {
      const x1 = startX + dirX * lastSegmentEnd;
      const z1 = startY + dirY * lastSegmentEnd;
      const y1 = (this.getTerrainHeight ? this.getTerrainHeight(x1, z1) : 0) + lineOffset;
      const yEnd = (this.getTerrainHeight ? this.getTerrainHeight(endX, endY) : 0) + lineOffset;

      segments.push({
        start: new THREE.Vector3(x1, y1, z1),
        end: new THREE.Vector3(endX, yEnd, endY),
      });
    }

    return segments;
  }

  private positionLineSegmentMesh(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    // Calculate segment length and midpoint
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Position at midpoint
    mesh.position.set(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2
    );

    // Scale to segment length
    mesh.scale.set(length, 1, 1);

    // Rotate to align with segment direction
    mesh.lookAt(end);
    mesh.rotateY(Math.PI / 2);
  }

  public dispose(): void {
    for (const rallyPoint of this.rallyPoints.values()) {
      this.scene.remove(rallyPoint.lineGroup);
      this.scene.remove(rallyPoint.marker);
    }
    this.rallyPoints.clear();

    this.lineMaterial.dispose();
    this.markerMaterial.dispose();
    this.markerGeometry.dispose();
    this.lineSegmentGeometry.dispose();
  }
}
