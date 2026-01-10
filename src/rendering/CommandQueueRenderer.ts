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
    // Create line connecting all waypoints
    const linePoints = this.createLinePoints(startX, startY, waypoints);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
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

    return { line, markers };
  }

  private updateVisual(
    visual: WaypointVisual,
    startX: number,
    startY: number,
    waypoints: Array<{ x: number; y: number; type: string }>
  ): void {
    // Update line
    const linePoints = this.createLinePoints(startX, startY, waypoints);
    visual.line.geometry.dispose();
    visual.line.geometry = new THREE.BufferGeometry().setFromPoints(linePoints);

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
