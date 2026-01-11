import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { World } from '@/engine/ecs/World';
import { Unit, QueuedCommand } from '@/engine/components/Unit';
import { Transform } from '@/engine/components/Transform';
import { Selectable } from '@/engine/components/Selectable';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';

interface WaypointVisual {
  line: THREE.LineSegments;
  markers: THREE.Mesh[];
  // PERFORMANCE: Track max allocated size to avoid frequent buffer resizing
  maxPoints: number;
  // Track if line needs update
  lineNeedsUpdate: boolean;
}

/**
 * Renders command queue waypoints for selected units.
 * Shows green lines connecting current position -> current target -> queued waypoints
 * Similar to StarCraft 2's shift-click command visualization.
 */
export class CommandQueueRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private world: World;
  private playerId: string | null;
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;

  private waypointVisuals: Map<number, WaypointVisual> = new Map();
  private selectedUnitIds: Set<number> = new Set();

  // Shared materials
  private lineMaterial: THREE.LineBasicMaterial;
  private markerMaterial: THREE.MeshBasicMaterial;
  private markerGeometry: THREE.SphereGeometry;

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

    // Create shared resources - green color like SC2 waypoints
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.6,
      linewidth: 1,
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.7,
    });

    this.markerGeometry = new THREE.SphereGeometry(0.2, 8, 8);

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

      const existing = this.waypointVisuals.get(unitId);

      if (existing) {
        // Update existing visual
        this.updateVisual(existing, transform.x, transform.y, waypoints);
      } else {
        // Create new visual
        const visual = this.createVisual(transform.x, transform.y, waypoints);
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
    waypoints: Array<{ x: number; y: number; type: string }>
  ): WaypointVisual {
    // PERFORMANCE: Pre-allocate buffer with extra capacity to avoid frequent resizing
    // Each waypoint needs 2 vertices (start + end of line segment) * 3 components (x, y, z)
    const initialCapacity = Math.max(waypoints.length * 2, 10);
    const positions = new Float32Array(initialCapacity * 3);

    // Fill initial positions
    const linePoints = this.createLinePoints(startX, startY, waypoints);
    for (let i = 0; i < linePoints.length && i < initialCapacity; i++) {
      positions[i * 3] = linePoints[i].x;
      positions[i * 3 + 1] = linePoints[i].y;
      positions[i * 3 + 2] = linePoints[i].z;
    }

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    lineGeometry.setDrawRange(0, linePoints.length);

    const line = new THREE.LineSegments(lineGeometry, this.lineMaterial);
    this.scene.add(line);

    // Create markers at each waypoint
    const markers: THREE.Mesh[] = [];
    for (const wp of waypoints) {
      const height = this.getTerrainHeight ? this.getTerrainHeight(wp.x, wp.y) : 0;
      const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
      marker.position.set(wp.x, height + 0.3, wp.y);
      this.scene.add(marker);
      markers.push(marker);
    }

    return { line, markers, maxPoints: initialCapacity, lineNeedsUpdate: false };
  }

  private updateVisual(
    visual: WaypointVisual,
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>
  ): void {
    // PERFORMANCE: Update existing buffer instead of recreating geometry every frame
    const linePoints = this.createLinePoints(startX, startY, waypoints);
    const requiredPoints = linePoints.length;

    const positionAttr = visual.line.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Check if we need to resize the buffer (only when capacity is exceeded)
    if (requiredPoints > visual.maxPoints) {
      // Need larger buffer - dispose and recreate
      visual.line.geometry.dispose();
      const newCapacity = Math.max(requiredPoints * 2, visual.maxPoints * 2);
      const positions = new Float32Array(newCapacity * 3);

      for (let i = 0; i < linePoints.length; i++) {
        positions[i * 3] = linePoints[i].x;
        positions[i * 3 + 1] = linePoints[i].y;
        positions[i * 3 + 2] = linePoints[i].z;
      }

      const newGeometry = new THREE.BufferGeometry();
      newGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      newGeometry.setDrawRange(0, requiredPoints);
      visual.line.geometry = newGeometry;
      visual.maxPoints = newCapacity;
    } else {
      // PERFORMANCE: Reuse existing buffer - just update values in place
      const positions = positionAttr.array as Float32Array;
      for (let i = 0; i < linePoints.length; i++) {
        positions[i * 3] = linePoints[i].x;
        positions[i * 3 + 1] = linePoints[i].y;
        positions[i * 3 + 2] = linePoints[i].z;
      }
      positionAttr.needsUpdate = true;
      visual.line.geometry.setDrawRange(0, requiredPoints);
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

  private createLinePoints(
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const lineOffset = 0.15; // Height above terrain

    let prevX = startX;
    let prevY = startY;

    for (const wp of waypoints) {
      const startHeight = (this.getTerrainHeight ? this.getTerrainHeight(prevX, prevY) : 0) + lineOffset;
      const endHeight = (this.getTerrainHeight ? this.getTerrainHeight(wp.x, wp.y) : 0) + lineOffset;

      points.push(
        new THREE.Vector3(prevX, startHeight, prevY),
        new THREE.Vector3(wp.x, endHeight, wp.y)
      );

      prevX = wp.x;
      prevY = wp.y;
    }

    return points;
  }

  private removeVisual(visual: WaypointVisual): void {
    this.scene.remove(visual.line);
    visual.line.geometry.dispose();

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
  }
}
