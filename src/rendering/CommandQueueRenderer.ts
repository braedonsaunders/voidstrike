import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { World } from '@/engine/ecs/World';
import { Unit, QueuedCommand } from '@/engine/components/Unit';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { AssetManager } from '@/assets/AssetManager';

interface WaypointVisual {
  lineGroup: THREE.Group;
  lineMeshes: THREE.Mesh[];
  markers: THREE.Mesh[];
}

/**
 * Renders command queue waypoints for selected units.
 * Shows green lines connecting current position -> current target -> queued waypoints
 * Similar to classic RTS shift-click command visualization.
 */
export class CommandQueueRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private world: World;
  private playerId: string | null;
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;

  private waypointVisuals: Map<number, WaypointVisual> = new Map();
  private selectedUnitIds: Set<number> = new Set();

  // Shared materials and geometry
  private lineMaterial: THREE.MeshBasicMaterial;
  private markerMaterial: THREE.MeshBasicMaterial;
  private markerGeometry: THREE.SphereGeometry;
  private lineSegmentGeometry: THREE.BoxGeometry;
  private readonly LINE_WIDTH = 0.08;

  // PERFORMANCE: Throttle updates - waypoints don't need 60fps updates
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL_MS: number = 50; // Update at 20fps max

  constructor(
    scene: THREE.Scene,
    eventBus: EventBus,
    world: World,
    playerId: string | null = null,
    getTerrainHeight?: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.world = world;
    this.playerId = playerId ?? getLocalPlayerId();
    this.getTerrainHeight = getTerrainHeight ?? null;

    // Create shared resources - green color for waypoints
    // Using MeshBasicMaterial instead of LineBasicMaterial because linewidth doesn't work in WebGL/WebGPU
    this.lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.6,
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.7,
    });

    this.markerGeometry = new THREE.SphereGeometry(0.2, 8, 8);

    // Unit box geometry for line segments - will be scaled to segment length
    this.lineSegmentGeometry = new THREE.BoxGeometry(1, this.LINE_WIDTH, this.LINE_WIDTH);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('selection:changed', (data: { selectedIds: number[] }) => {
      this.updateSelectedUnits(data.selectedIds);
    });
  }

  private updateSelectedUnits(selectedIds: number[]): void {
    this.selectedUnitIds.clear();

    for (const id of selectedIds) {
      const entity = this.world.getEntity(id);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const selectable = entity.get<Selectable>('Selectable');

      // In spectator mode, show waypoints for all units; otherwise only for owned units
      const isSpectating = isSpectatorMode() || !this.playerId;
      if (unit && (isSpectating || selectable?.playerId === this.playerId)) {
        this.selectedUnitIds.add(id);
      }
    }
  }

  public update(): void {
    // PERFORMANCE: Throttle updates - waypoints don't need to update every frame
    const now = performance.now();
    if (now - this.lastUpdateTime < this.UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastUpdateTime = now;

    // Remove visuals for units no longer selected
    for (const [unitId, visual] of this.waypointVisuals.entries()) {
      if (!this.selectedUnitIds.has(unitId)) {
        this.removeVisual(visual);
        this.waypointVisuals.delete(unitId);
      }
    }

    // Update or create visuals for selected units with queued commands
    for (const unitId of this.selectedUnitIds) {
      const entity = this.world.getEntity(unitId);
      if (!entity) continue;

      const unit = entity.get<Unit>('Unit');
      const transform = entity.get<Transform>('Transform');

      if (!unit || !transform) continue;

      // Build waypoint list: current target + command queue
      const waypoints = this.buildWaypointList(unit, transform);

      if (waypoints.length === 0) {
        // No waypoints to show - remove existing visual
        const existing = this.waypointVisuals.get(unitId);
        if (existing) {
          this.removeVisual(existing);
          this.waypointVisuals.delete(unitId);
        }
        continue;
      }

      // Calculate flying height offset for air units (like SC2 behavior)
      const unitFlyingHeight = unit.isFlying ? AssetManager.getAirborneHeight(unit.unitId) : 0;

      const existing = this.waypointVisuals.get(unitId);

      if (existing) {
        // Update existing visual
        this.updateVisual(existing, transform.x, transform.y, waypoints, unitFlyingHeight);
      } else {
        // Create new visual
        const visual = this.createVisual(transform.x, transform.y, waypoints, unitFlyingHeight);
        this.waypointVisuals.set(unitId, visual);
      }
    }
  }

  private buildWaypointList(unit: Unit, transform: Transform): Array<{ x: number; y: number; type: string }> {
    const waypoints: Array<{ x: number; y: number; type: string }> = [];

    // Add current target if unit is moving/attacking somewhere
    if (unit.targetX !== null && unit.targetY !== null) {
      // Only show if unit isn't already at the target
      const dx = unit.targetX - transform.x;
      const dy = unit.targetY - transform.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.5) {
        waypoints.push({ x: unit.targetX, y: unit.targetY, type: unit.state });
      }
    }

    // Add queued commands
    for (const cmd of unit.commandQueue) {
      const pos = this.getCommandPosition(cmd);
      if (pos) {
        waypoints.push({ ...pos, type: cmd.type });
      }
    }

    return waypoints;
  }

  private getCommandPosition(cmd: QueuedCommand): { x: number; y: number } | null {
    if (cmd.targetX !== undefined && cmd.targetY !== undefined) {
      return { x: cmd.targetX, y: cmd.targetY };
    }

    // For entity-targeted commands, get the entity's position
    if (cmd.targetEntityId !== undefined) {
      const targetEntity = this.world.getEntity(cmd.targetEntityId);
      if (targetEntity) {
        const targetTransform = targetEntity.get<Transform>('Transform');
        if (targetTransform) {
          return { x: targetTransform.x, y: targetTransform.y };
        }
      }
    }

    return null;
  }

  private createVisual(
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>,
    unitFlyingHeight: number = 0
  ): WaypointVisual {
    const lineGroup = new THREE.Group();
    const lineMeshes: THREE.Mesh[] = [];

    // Create line segment meshes
    const segments = this.createLineSegments(startX, startY, waypoints, unitFlyingHeight);
    for (const seg of segments) {
      const mesh = new THREE.Mesh(this.lineSegmentGeometry, this.lineMaterial);
      this.positionLineSegmentMesh(mesh, seg.start, seg.end);
      lineGroup.add(mesh);
      lineMeshes.push(mesh);
    }

    this.scene.add(lineGroup);

    // Create markers at each waypoint
    const markers: THREE.Mesh[] = [];
    for (const wp of waypoints) {
      const height = this.getTerrainHeight ? this.getTerrainHeight(wp.x, wp.y) : 0;
      const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
      marker.position.set(wp.x, height + 0.3, wp.y);
      this.scene.add(marker);
      markers.push(marker);
    }

    return { lineGroup, lineMeshes, markers };
  }

  private updateVisual(
    visual: WaypointVisual,
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>,
    unitFlyingHeight: number = 0
  ): void {
    const segments = this.createLineSegments(startX, startY, waypoints, unitFlyingHeight);

    // Add or remove line meshes as needed
    while (visual.lineMeshes.length > segments.length) {
      const mesh = visual.lineMeshes.pop()!;
      visual.lineGroup.remove(mesh);
    }

    while (visual.lineMeshes.length < segments.length) {
      const mesh = new THREE.Mesh(this.lineSegmentGeometry, this.lineMaterial);
      visual.lineGroup.add(mesh);
      visual.lineMeshes.push(mesh);
    }

    // Update line mesh positions
    for (let i = 0; i < segments.length; i++) {
      this.positionLineSegmentMesh(visual.lineMeshes[i], segments[i].start, segments[i].end);
    }

    // Update markers - add or remove as needed
    while (visual.markers.length > waypoints.length) {
      const marker = visual.markers.pop()!;
      this.scene.remove(marker);
    }

    while (visual.markers.length < waypoints.length) {
      const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
      this.scene.add(marker);
      visual.markers.push(marker);
    }

    // Update marker positions
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const height = this.getTerrainHeight ? this.getTerrainHeight(wp.x, wp.y) : 0;
      visual.markers[i].position.set(wp.x, height + 0.3, wp.y);
    }
  }

  private createLineSegments(
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>,
    unitFlyingHeight: number = 0
  ): Array<{ start: THREE.Vector3; end: THREE.Vector3 }> {
    const segments: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = [];
    const groundLineOffset = 0.15; // Height above terrain for ground units

    let prevX = startX;
    let prevY = startY;
    let isFirstSegment = true;

    for (const wp of waypoints) {
      // First segment starts from unit's position (airborne height for flying units)
      // Subsequent segments and endpoints are at ground level
      const startOffset = isFirstSegment ? (unitFlyingHeight > 0 ? unitFlyingHeight : groundLineOffset) : groundLineOffset;
      const startHeight = (this.getTerrainHeight ? this.getTerrainHeight(prevX, prevY) : 0) + startOffset;
      const endHeight = (this.getTerrainHeight ? this.getTerrainHeight(wp.x, wp.y) : 0) + groundLineOffset;

      segments.push({
        start: new THREE.Vector3(prevX, startHeight, prevY),
        end: new THREE.Vector3(wp.x, endHeight, wp.y),
      });

      prevX = wp.x;
      prevY = wp.y;
      isFirstSegment = false;
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

  private removeVisual(visual: WaypointVisual): void {
    this.scene.remove(visual.lineGroup);

    for (const marker of visual.markers) {
      this.scene.remove(marker);
    }
  }

  public dispose(): void {
    for (const visual of this.waypointVisuals.values()) {
      this.removeVisual(visual);
    }
    this.waypointVisuals.clear();

    this.lineMaterial.dispose();
    this.markerMaterial.dispose();
    this.markerGeometry.dispose();
    this.lineSegmentGeometry.dispose();
  }
}
