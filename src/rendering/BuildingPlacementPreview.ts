import * as THREE from 'three';
import { MapData } from '@/data/maps';
import { BUILDING_DEFINITIONS } from '@/data/buildings/dominion';
import { distance } from '@/utils/math';

// Interface for queued building placements
interface QueuedPlacement {
  buildingType: string;
  x: number;
  y: number;
}

/**
 * Building placement preview system - RTS style
 * Shows:
 * - Grid overlay when placing buildings
 * - Green/red tiles for valid/invalid placement
 * - Ghost preview of the building footprint
 * - Queued placement indicators with path lines (shift-click queue)
 */

export class BuildingPlacementPreview {
  public group: THREE.Group;

  private gridMesh: THREE.Mesh | null = null;
  private blueprintEffect: THREE.Group | null = null;
  private mapData: MapData;
  private currentBuildingType: string | null = null;
  private currentPosition: { x: number; y: number } = { x: 0, y: 0 };
  private isValid: boolean = false;
  private getTerrainHeight: ((x: number, y: number) => number) | null = null;
  private checkPlasmaGeyser: ((x: number, y: number) => boolean) | null = null;
  // Validator that checks collisions with buildings, units, resources, decorations
  private placementValidator: ((centerX: number, centerY: number, width: number, height: number) => boolean) | null = null;

  // Queued placement visualization
  private queuedPlacements: QueuedPlacement[] = [];
  private queueLine: THREE.LineSegments | null = null;
  private queueMarkers: THREE.Group[] = [];
  private queueLineMaterial: THREE.LineBasicMaterial;

  // Blueprint effect animation state
  private blueprintPulseTime: number = 0;
  private currentBuildingHeight: number = 3; // Default building height for effects

  // Blueprint effect materials (RTS-style holographic blue)
  private static readonly BLUEPRINT_COLOR = 0x00ccff;
  private static readonly BLUEPRINT_INVALID_COLOR = 0xff4444;

  // Grid visualization settings
  private static readonly GRID_OFFSET = 0.15; // Offset above terrain
  private static readonly VALID_COLOR = new THREE.Color(0x00ff00);
  private static readonly INVALID_COLOR = new THREE.Color(0xff0000);
  private static readonly GRID_OPACITY = 0.4;
  private static readonly QUEUE_LINE_COLOR = 0x00ff88; // Same as rally point green

  // PERF: Pool of reusable Vector3 for dashed line points to avoid per-frame allocation
  private static readonly DASH_POINTS_POOL_SIZE = 200;
  private dashPointsPool: THREE.Vector3[] = [];
  private dashPointsPoolIndex: number = 0;

  // Frame counter for quarantine timing
  private frameCount: number = 0;

  // Geometry disposal quarantine - prevents WebGPU "setIndexBuffer" crashes
  // by delaying geometry disposal until GPU has finished pending draw commands.
  // WebGPU typically has 2-3 frames in flight; 4 frames provides safety margin.
  private static readonly GEOMETRY_QUARANTINE_FRAMES = 4;
  private geometryQuarantine: Array<{
    geometry: THREE.BufferGeometry;
    materials: THREE.Material[];
    frameQueued: number;
  }> = [];

  constructor(mapData: MapData, getTerrainHeight?: (x: number, y: number) => number) {
    this.group = new THREE.Group();
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight ?? null;
    this.group.visible = false;

    // Initialize queue visualization materials (same style as rally points)
    this.queueLineMaterial = new THREE.LineBasicMaterial({
      color: BuildingPlacementPreview.QUEUE_LINE_COLOR,
      transparent: true,
      opacity: 0.7,
      linewidth: 2,
    });

    // PERF: Pre-create pool of Vector3 for dashed line points
    for (let i = 0; i < BuildingPlacementPreview.DASH_POINTS_POOL_SIZE; i++) {
      this.dashPointsPool.push(new THREE.Vector3());
    }
  }

  /**
   * Set callback to check if a position is on a plasma geyser
   */
  public setPlasmaGeyserChecker(fn: (x: number, y: number) => boolean): void {
    this.checkPlasmaGeyser = fn;
  }

  /**
   * Set callback to validate placement against buildings, units, resources, decorations
   * This enables full RTS-style placement validation
   */
  public setPlacementValidator(fn: (centerX: number, centerY: number, width: number, height: number) => boolean): void {
    this.placementValidator = fn;
  }

  /**
   * Set terrain height function (for elevation support)
   */
  public setTerrainHeightFunction(fn: (x: number, y: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Start showing placement preview for a building type
   */
  public startPlacement(buildingType: string): void {
    this.currentBuildingType = buildingType;
    this.group.visible = true;
    this.updatePreview(this.currentPosition.x, this.currentPosition.y);
  }

  /**
   * Stop showing placement preview
   */
  public stopPlacement(): void {
    this.currentBuildingType = null;
    this.group.visible = false;
    this.clearMeshes();
    this.clearQueueVisuals();
    this.queuedPlacements = [];
  }

  /**
   * Update queued placements for visual display (shift-click queue)
   */
  public setQueuedPlacements(placements: QueuedPlacement[]): void {
    this.queuedPlacements = placements;
    this.updateQueueVisuals();
  }

  /**
   * Queue geometry and materials for delayed disposal.
   * This prevents WebGPU "setIndexBuffer" crashes by ensuring the GPU
   * has finished all pending draw commands before buffers are freed.
   */
  private queueGeometryForDisposal(
    geometry: THREE.BufferGeometry,
    materials: THREE.Material | THREE.Material[]
  ): void {
    const materialArray = Array.isArray(materials) ? materials : [materials];
    this.geometryQuarantine.push({
      geometry,
      materials: materialArray,
      frameQueued: this.frameCount,
    });
  }

  /**
   * Process quarantined geometries and dispose those that are safe.
   * Call this once per frame.
   */
  private processGeometryQuarantine(): void {
    let writeIndex = 0;
    for (let i = 0; i < this.geometryQuarantine.length; i++) {
      const entry = this.geometryQuarantine[i];
      const framesInQuarantine = this.frameCount - entry.frameQueued;

      if (framesInQuarantine >= BuildingPlacementPreview.GEOMETRY_QUARANTINE_FRAMES) {
        // Safe to dispose - GPU has finished with these buffers
        entry.geometry.dispose();
        for (const material of entry.materials) {
          material.dispose();
        }
      } else {
        // Keep in quarantine
        this.geometryQuarantine[writeIndex++] = entry;
      }
    }
    this.geometryQuarantine.length = writeIndex;
  }

  /**
   * Clear queue visuals
   */
  private clearQueueVisuals(): void {
    if (this.queueLine) {
      this.group.remove(this.queueLine);
      // Queue for delayed disposal to prevent WebGPU crashes
      this.queueGeometryForDisposal(this.queueLine.geometry, []);
      this.queueLine = null;
    }

    for (const marker of this.queueMarkers) {
      this.group.remove(marker);
      this.disposeGroup(marker);
    }
    this.queueMarkers = [];
  }

  /**
   * Dispose all materials and geometries in a group via quarantine.
   * Uses quarantine to prevent WebGPU crashes from disposing while GPU still rendering.
   */
  private disposeGroup(group: THREE.Group | THREE.Object3D): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
        // Queue geometry and materials for delayed disposal
        const materials = child.material;
        this.queueGeometryForDisposal(child.geometry, materials);
      }
    });
  }

  /**
   * Update queue path lines and markers (RTS-style blueprint ghosts)
   */
  private updateQueueVisuals(): void {
    this.clearQueueVisuals();

    if (this.queuedPlacements.length === 0) return;

    // PERF: Reset pool index at start of each update cycle
    this.dashPointsPoolIndex = 0;

    // Create dashed line path connecting all queued placements
    const linePoints: THREE.Vector3[] = [];
    const lineOffset = 0.2;

    // Add line from current cursor position to first queued placement
    if (this.currentBuildingType && this.queuedPlacements.length > 0) {
      const firstPlacement = this.queuedPlacements[0];
      const cursorHeight = this.getTerrainHeight ? this.getTerrainHeight(this.currentPosition.x, this.currentPosition.y) : 0;
      const firstHeight = this.getTerrainHeight ? this.getTerrainHeight(firstPlacement.x, firstPlacement.y) : 0;
      const dashPoints = this.createDashedLinePoints(
        this.currentPosition.x, this.currentPosition.y, cursorHeight + lineOffset,
        firstPlacement.x, firstPlacement.y, firstHeight + lineOffset
      );
      linePoints.push(...dashPoints);
    }

    for (let i = 0; i < this.queuedPlacements.length; i++) {
      const placement = this.queuedPlacements[i];
      const nextPlacement = i < this.queuedPlacements.length - 1 ? this.queuedPlacements[i + 1] : null;

      // Get building dimensions from definition
      const definition = BUILDING_DEFINITIONS[placement.buildingType];
      const width = definition?.width ?? 2;
      const depth = definition?.height ?? 2;
      const buildingHeight = 3; // Standard preview height

      // Create blueprint-style ghost at this position (dimmer than main preview)
      const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(placement.x, placement.y) : 0;

      const queuedBlueprint = this.createBlueprintEffect(width, depth, buildingHeight, 0.5);
      queuedBlueprint.position.set(placement.x, terrainHeight, placement.y);
      this.group.add(queuedBlueprint);
      this.queueMarkers.push(queuedBlueprint);

      // Add line segment to next placement
      if (nextPlacement) {
        const nextHeight = this.getTerrainHeight ? this.getTerrainHeight(nextPlacement.x, nextPlacement.y) : 0;
        // Create dashed line segments
        const dashPoints = this.createDashedLinePoints(
          placement.x, placement.y, terrainHeight + lineOffset,
          nextPlacement.x, nextPlacement.y, nextHeight + lineOffset
        );
        linePoints.push(...dashPoints);
      }
    }

    // Create line geometry if we have points
    if (linePoints.length > 0) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      this.queueLine = new THREE.LineSegments(lineGeometry, this.queueLineMaterial);
      this.group.add(this.queueLine);
    }
  }

  /**
   * PERF: Acquire a Vector3 from the pool
   */
  private acquireDashPoint(x: number, y: number, z: number): THREE.Vector3 {
    const vec = this.dashPointsPool[this.dashPointsPoolIndex];
    this.dashPointsPoolIndex = (this.dashPointsPoolIndex + 1) % BuildingPlacementPreview.DASH_POINTS_POOL_SIZE;
    return vec.set(x, y, z);
  }

  /**
   * Create dashed line points between two positions (same style as rally points)
   */
  private createDashedLinePoints(
    startX: number, startY: number, startHeight: number,
    endX: number, endY: number, endHeight: number
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const dashLength = 0.5;
    const gapLength = 0.3;

    const dx = endX - startX;
    const dy = endY - startY;
    const dh = endHeight - startHeight;
    const dist = distance(startX, startY, endX, endY);
    const segments = Math.floor(dist / (dashLength + gapLength));

    if (dist < 0.1) return points;

    const dirX = dx / dist;
    const dirY = dy / dist;
    const dirH = dh / dist;

    for (let i = 0; i < segments; i++) {
      const segmentStart = i * (dashLength + gapLength);
      const segmentEnd = segmentStart + dashLength;

      const x1 = startX + dirX * segmentStart;
      const z1 = startY + dirY * segmentStart;
      const y1 = startHeight + dirH * segmentStart;

      const x2 = startX + dirX * Math.min(segmentEnd, dist);
      const z2 = startY + dirY * Math.min(segmentEnd, dist);
      const y2 = startHeight + dirH * Math.min(segmentEnd, dist);

      // PERF: Use pooled Vector3s instead of creating new ones
      points.push(
        this.acquireDashPoint(x1, y1, z1),
        this.acquireDashPoint(x2, y2, z2)
      );
    }

    // Add final segment to reach the end point
    const lastSegmentEnd = segments * (dashLength + gapLength);
    if (lastSegmentEnd < dist) {
      const x1 = startX + dirX * lastSegmentEnd;
      const z1 = startY + dirY * lastSegmentEnd;
      const y1 = startHeight + dirH * lastSegmentEnd;

      // PERF: Use pooled Vector3s
      points.push(
        this.acquireDashPoint(x1, y1, z1),
        this.acquireDashPoint(endX, endHeight, endY)
      );
    }

    return points;
  }

  /**
   * Update preview position (call on mouse move)
   */
  public updatePosition(worldX: number, worldY: number): void {
    // Snap to grid
    const snappedX = Math.round(worldX);
    const snappedY = Math.round(worldY);

    if (snappedX !== this.currentPosition.x || snappedY !== this.currentPosition.y) {
      this.currentPosition = { x: snappedX, y: snappedY };
      this.updatePreview(snappedX, snappedY);
      // Update queue visuals so line from cursor to first queued building follows cursor
      if (this.queuedPlacements.length > 0) {
        this.updateQueueVisuals();
      }
    }
  }

  /**
   * Check if current placement position is valid
   */
  public isPlacementValid(): boolean {
    return this.isValid;
  }

  /**
   * Get current snapped position
   */
  public getSnappedPosition(): { x: number; y: number } {
    return { ...this.currentPosition };
  }

  private updatePreview(x: number, y: number): void {
    if (!this.currentBuildingType) return;

    const definition = BUILDING_DEFINITIONS[this.currentBuildingType];
    if (!definition) return;

    const width = definition.width;
    const depth = definition.height;
    this.currentBuildingHeight = 3; // Standard building height for preview

    // Check validity of all tiles
    this.isValid = this.checkPlacementValidity(x, y, width, depth);

    // Update or create grid mesh
    this.updateGridMesh(x, y, width, depth);

    // Update or create blueprint effect (RTS-style holographic preview)
    this.updateBlueprintEffect(x, y, width, depth, this.currentBuildingHeight);
  }

  private checkPlacementValidity(centerX: number, centerY: number, width: number, height: number): boolean {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Special case: extractors MUST be placed on plasma geysers
    if (this.currentBuildingType === 'extractor') {
      if (!this.checkPlasmaGeyser || !this.checkPlasmaGeyser(centerX, centerY)) {
        return false;
      }
      // If on a geyser, it's valid (skip terrain checks for geysers)
      return true;
    }

    // Check all tiles the building would occupy for terrain validity
    // Use same tile calculation as updateGridMesh for consistency
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const tileOffsetX = tx - halfWidth + 0.5;
        const tileOffsetY = ty - halfHeight + 0.5;
        const tileX = Math.floor(centerX + tileOffsetX);
        const tileY = Math.floor(centerY + tileOffsetY);

        // Check bounds
        if (tileX < 0 || tileX >= this.mapData.width || tileY < 0 || tileY >= this.mapData.height) {
          return false;
        }

        // Check terrain type
        const cell = this.mapData.terrain[tileY][tileX];
        if (cell.terrain !== 'ground') {
          return false;
        }
      }
    }

    // Check for entity collisions (buildings, units, resources, decorations)
    // This is the RTS-style full validation
    if (this.placementValidator && !this.placementValidator(centerX, centerY, width, height)) {
      return false;
    }

    return true;
  }

  private updateGridMesh(centerX: number, centerY: number, width: number, height: number): void {
    // Remove old mesh - use quarantine to prevent WebGPU crashes
    if (this.gridMesh) {
      this.group.remove(this.gridMesh);
      this.queueGeometryForDisposal(this.gridMesh.geometry, this.gridMesh.material as THREE.Material);
    }

    // Create grid geometry with per-tile coloring
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    let vertexIndex = 0;

    // Iterate over tiles from 0 to width/height, positioning relative to building center
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        // Calculate tile center relative to building center
        const tileOffsetX = tx - halfWidth + 0.5;
        const tileOffsetY = ty - halfHeight + 0.5;

        // World position of this tile
        const tileX = Math.floor(centerX + tileOffsetX);
        const tileY = Math.floor(centerY + tileOffsetY);

        // Check if this tile is valid
        let tileValid = true;
        if (tileX < 0 || tileX >= this.mapData.width || tileY < 0 || tileY >= this.mapData.height) {
          tileValid = false;
        } else {
          const cell = this.mapData.terrain[tileY][tileX];
          if (cell.terrain !== 'ground') {
            tileValid = false;
          }
        }

        const color = tileValid ? BuildingPlacementPreview.VALID_COLOR : BuildingPlacementPreview.INVALID_COLOR;

        // Create quad for this tile, centered on the tile position
        const x0 = centerX + tileOffsetX - 0.5;
        const x1 = centerX + tileOffsetX + 0.5;
        const y0 = centerY + tileOffsetY - 0.5;
        const y1 = centerY + tileOffsetY + 0.5;

        // Get terrain height for this tile (use center point)
        const tileHeight = this.getTerrainHeight
          ? this.getTerrainHeight(centerX + tileOffsetX, centerY + tileOffsetY) + BuildingPlacementPreview.GRID_OFFSET
          : BuildingPlacementPreview.GRID_OFFSET;

        // Four vertices for quad
        vertices.push(x0, tileHeight, y0);
        vertices.push(x1, tileHeight, y0);
        vertices.push(x1, tileHeight, y1);
        vertices.push(x0, tileHeight, y1);

        // Colors for all four vertices
        for (let i = 0; i < 4; i++) {
          colors.push(color.r, color.g, color.b);
        }

        // Two triangles for quad
        indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
        indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 3);
        vertexIndex += 4;
      }
    }

    // Defensive check: ensure we have valid geometry data to prevent WebGPU errors
    if (vertices.length === 0 || indices.length === 0) {
      // Create minimal valid geometry (single invisible quad)
      vertices.push(0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1);
      colors.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      indices.push(0, 1, 2, 0, 2, 3);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: BuildingPlacementPreview.GRID_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.gridMesh = new THREE.Mesh(geometry, material);
    this.group.add(this.gridMesh);
  }

  /**
   * Update or create the blueprint effect (RTS-style holographic preview)
   */
  private updateBlueprintEffect(centerX: number, centerY: number, width: number, depth: number, buildingHeight: number): void {
    // Remove old effect
    if (this.blueprintEffect) {
      this.group.remove(this.blueprintEffect);
      this.disposeGroup(this.blueprintEffect);
      this.blueprintEffect = null;
    }

    // Get terrain height at center
    const terrainHeight = this.getTerrainHeight
      ? this.getTerrainHeight(centerX, centerY)
      : 0;

    // Create new blueprint effect
    this.blueprintEffect = this.createBlueprintEffect(width, depth, buildingHeight, 1.0);
    this.blueprintEffect.position.set(centerX, terrainHeight, centerY);

    // Store validity state for color updates
    this.blueprintEffect.userData.isValid = this.isValid;

    // Update colors based on validity
    this.updateBlueprintColors(this.blueprintEffect, this.isValid);

    this.group.add(this.blueprintEffect);
  }

  /**
   * Create RTS-style holographic blueprint effect
   * Shows wireframe outline, corner markers, scanning plane, and floating particles
   */
  private createBlueprintEffect(buildingWidth: number, buildingDepth: number, buildingHeight: number, opacityMultiplier: number = 1.0): THREE.Group {
    const effectGroup = new THREE.Group();
    const baseColor = BuildingPlacementPreview.BLUEPRINT_COLOR;

    // Create wireframe box outline (holographic blueprint edge lines)
    const boxGeometry = new THREE.BoxGeometry(buildingWidth * 0.95, buildingHeight, buildingDepth * 0.95);
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.7 * opacityMultiplier,
      linewidth: 2,
    });
    const wireframe = new THREE.LineSegments(edgesGeometry, wireframeMaterial);
    wireframe.position.y = buildingHeight / 2;
    wireframe.userData.isBlueprintWireframe = true;
    effectGroup.add(wireframe);
    boxGeometry.dispose();

    // Create corner accent points (holographic corner markers)
    const cornerCount = 8;
    const cornerPositions = new Float32Array(cornerCount * 3);
    const hw = buildingWidth * 0.48;
    const hh = buildingHeight;
    const hd = buildingDepth * 0.48;
    const corners = [
      [-hw, 0, -hd], [hw, 0, -hd], [-hw, 0, hd], [hw, 0, hd],
      [-hw, hh, -hd], [hw, hh, -hd], [-hw, hh, hd], [hw, hh, hd],
    ];
    for (let i = 0; i < cornerCount; i++) {
      cornerPositions[i * 3] = corners[i][0];
      cornerPositions[i * 3 + 1] = corners[i][1];
      cornerPositions[i * 3 + 2] = corners[i][2];
    }
    const cornerGeometry = new THREE.BufferGeometry();
    cornerGeometry.setAttribute('position', new THREE.BufferAttribute(cornerPositions, 3));
    const cornerMaterial = new THREE.PointsMaterial({
      color: baseColor,
      size: 4.0,
      transparent: true,
      opacity: 0.9 * opacityMultiplier,
      sizeAttenuation: true,
    });
    const cornerPoints = new THREE.Points(cornerGeometry, cornerMaterial);
    cornerPoints.userData.isBlueprintCorners = true;
    effectGroup.add(cornerPoints);

    // Create scanning plane effect (horizontal plane that moves up - the "2D blue plane")
    const scanGeometry = new THREE.PlaneGeometry(buildingWidth * 1.1, buildingDepth * 1.1);
    const scanMaterial = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.3 * opacityMultiplier,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanMesh = new THREE.Mesh(scanGeometry, scanMaterial);
    scanMesh.rotation.x = -Math.PI / 2;
    scanMesh.position.y = 0;
    scanMesh.userData.isBlueprintScan = true;
    scanMesh.userData.scanY = 0;
    scanMesh.userData.buildingHeight = buildingHeight;
    effectGroup.add(scanMesh);

    // Create floating holographic particles around the blueprint
    const particleCount = 30;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = Math.max(buildingWidth, buildingDepth) * 0.6;
      particlePositions[i * 3] = Math.cos(angle) * radius;
      particlePositions[i * 3 + 1] = Math.random() * buildingHeight;
      particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: baseColor,
      size: 2.0,
      transparent: true,
      opacity: 0.6 * opacityMultiplier,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.userData.isBlueprintParticles = true;
    particles.userData.buildingHeight = buildingHeight;
    particles.userData.basePositions = particlePositions.slice();
    effectGroup.add(particles);

    // Store building dimensions for animation
    effectGroup.userData.buildingHeight = buildingHeight;

    return effectGroup;
  }

  /**
   * Update blueprint effect colors based on placement validity
   */
  private updateBlueprintColors(effectGroup: THREE.Group, isValid: boolean): void {
    const color = isValid ? BuildingPlacementPreview.BLUEPRINT_COLOR : BuildingPlacementPreview.BLUEPRINT_INVALID_COLOR;

    effectGroup.traverse((child) => {
      if (child instanceof THREE.LineSegments && child.userData.isBlueprintWireframe) {
        (child.material as THREE.LineBasicMaterial).color.setHex(color);
      } else if (child instanceof THREE.Points) {
        (child.material as THREE.PointsMaterial).color.setHex(color);
      } else if (child instanceof THREE.Mesh && child.userData.isBlueprintScan) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(color);
      }
    });
  }

  /**
   * Update animation for blueprint effects (call each frame)
   */
  public update(dt: number): void {
    this.frameCount++;

    // Process quarantined geometries at the START of each frame
    // This ensures GPU has finished with disposed buffers before we free them
    this.processGeometryQuarantine();

    if (!this.group.visible) return;

    this.blueprintPulseTime += dt;

    // Animate main blueprint effect
    if (this.blueprintEffect) {
      this.animateBlueprintEffect(this.blueprintEffect, dt);
    }

    // Animate queued placement blueprints
    for (const marker of this.queueMarkers) {
      this.animateBlueprintEffect(marker, dt);
    }
  }

  /**
   * Animate a single blueprint effect group
   */
  private animateBlueprintEffect(effectGroup: THREE.Group, dt: number): void {
    const buildingHeight = effectGroup.userData.buildingHeight ?? 3;

    for (const child of effectGroup.children) {
      if (child instanceof THREE.LineSegments && child.userData.isBlueprintWireframe) {
        // Pulse wireframe opacity
        const mat = child.material as THREE.LineBasicMaterial;
        const baseOpacity = mat.userData.baseOpacity ?? 0.7;
        mat.opacity = baseOpacity * (0.7 + Math.sin(this.blueprintPulseTime * 4) * 0.3);
      } else if (child instanceof THREE.Mesh && child.userData.isBlueprintScan) {
        // Animate scanning plane moving up
        const scanY = child.userData.scanY ?? 0;
        const newY = (scanY + dt * 1.5) % buildingHeight;
        child.userData.scanY = newY;
        child.position.y = newY;

        // Pulse scan plane opacity
        const mat = child.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.2 + Math.sin(this.blueprintPulseTime * 6) * 0.15;
      } else if (child instanceof THREE.Points) {
        if (child.userData.isBlueprintParticles) {
          // Animate hologram particles - float and rotate around building
          const positions = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          const basePositions = child.userData.basePositions as Float32Array;
          const bh = child.userData.buildingHeight as number;

          for (let i = 0; i < positions.length / 3; i++) {
            // Rotate around Y axis
            const angle = this.blueprintPulseTime * 0.5 + (i / (positions.length / 3)) * Math.PI * 2;
            const baseX = basePositions[i * 3];
            const baseZ = basePositions[i * 3 + 2];
            const radius = distance(0, 0, baseX, baseZ);
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Float up and down
            const yOffset = Math.sin(this.blueprintPulseTime * 2 + i * 0.5) * 0.3;
            positions[i * 3 + 1] = (basePositions[i * 3 + 1] + yOffset + bh) % bh;
          }
          child.geometry.attributes.position.needsUpdate = true;

          // Pulse particle opacity
          const mat = child.material as THREE.PointsMaterial;
          mat.opacity = 0.4 + Math.sin(this.blueprintPulseTime * 5) * 0.2;
        } else if (child.userData.isBlueprintCorners) {
          // Corner points - pulse size
          const mat = child.material as THREE.PointsMaterial;
          mat.size = 3.0 + Math.sin(this.blueprintPulseTime * 4) * 1.0;
          mat.opacity = 0.7 + Math.sin(this.blueprintPulseTime * 3) * 0.3;
        }
      }
    }
  }

  private clearMeshes(): void {
    if (this.gridMesh) {
      this.group.remove(this.gridMesh);
      // Use quarantine to prevent WebGPU crashes
      this.queueGeometryForDisposal(this.gridMesh.geometry, this.gridMesh.material as THREE.Material);
      this.gridMesh = null;
    }

    if (this.blueprintEffect) {
      this.group.remove(this.blueprintEffect);
      this.disposeGroup(this.blueprintEffect);
      this.blueprintEffect = null;
    }
  }

  public dispose(): void {
    // Flush any pending quarantined geometries first
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;

    this.clearMeshes();
    this.clearQueueVisuals();
    this.queueLineMaterial.dispose();

    // Flush any geometries queued during dispose
    for (const entry of this.geometryQuarantine) {
      entry.geometry.dispose();
      for (const material of entry.materials) {
        material.dispose();
      }
    }
    this.geometryQuarantine.length = 0;
  }
}
