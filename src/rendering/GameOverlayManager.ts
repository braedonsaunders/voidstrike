import * as THREE from 'three';
import { MapData, MapCell, TERRAIN_FEATURE_CONFIG, TerrainFeature, elevationToZone } from '@/data/maps';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';
import { GameOverlayType } from '@/store/uiStore';
import { getLocalPlayerId } from '@/store/gameSetupStore';

/**
 * GameOverlayManager - Handles strategic information overlays
 *
 * Three overlay types:
 * 1. Terrain Overlay - Shows walkability, speed modifiers, and buildability
 * 2. Elevation Overlay - Shows elevation zones with high-ground advantage
 * 3. Threat Overlay - Shows enemy attack ranges and danger zones
 */
export class GameOverlayManager {
  private scene: THREE.Scene;
  private mapData: MapData;
  private world: World | null = null;
  private getTerrainHeight: (x: number, y: number) => number;

  // Overlay meshes
  private terrainOverlayMesh: THREE.Mesh | null = null;
  private elevationOverlayMesh: THREE.Mesh | null = null;
  private threatOverlayMesh: THREE.Mesh | null = null;

  // Overlay textures (for dynamic updates)
  private terrainTexture: THREE.DataTexture | null = null;
  private elevationTexture: THREE.DataTexture | null = null;
  private threatTexture: THREE.DataTexture | null = null;
  private threatTextureData: Uint8Array | null = null;

  // Current state
  private currentOverlay: GameOverlayType = 'none';
  private opacity: number = 0.7;

  // Threat overlay update throttling
  private lastThreatUpdate: number = 0;
  private threatUpdateInterval: number = 200; // Update every 200ms

  constructor(
    scene: THREE.Scene,
    mapData: MapData,
    getTerrainHeight: (x: number, y: number) => number
  ) {
    this.scene = scene;
    this.mapData = mapData;
    this.getTerrainHeight = getTerrainHeight;

    this.createTerrainOverlay();
    this.createElevationOverlay();
    this.createThreatOverlay();

    // Hide all overlays initially
    this.setActiveOverlay('none');
  }

  public setWorld(world: World): void {
    this.world = world;
  }

  /**
   * Create a geometry that follows the terrain height
   * Instead of a flat plane, this creates a mesh that conforms to terrain elevation
   *
   * IMPORTANT: Uses finer resolution (step=1) to match terrain mesh exactly
   * and adds sufficient height offset to prevent z-fighting
   *
   * CRITICAL FIX: Overlays must render ABOVE the terrain mesh at all points.
   * The terrain mesh has noise variations added during geometry creation that
   * are NOT reflected in the heightMap. To guarantee visibility:
   * 1. Use a large base offset (1.0 units minimum)
   * 2. Add additional per-vertex offset based on terrain type
   * 3. The offset must exceed the maximum possible terrain noise (~0.5 units)
   */
  private createTerrainFollowingGeometry(width: number, height: number, heightOffset: number): THREE.BufferGeometry {
    // Use 1:1 resolution to match terrain mesh exactly
    const step = 1;
    const segmentsX = Math.ceil(width / step);
    const segmentsY = Math.ceil(height / step);

    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Generate vertices with terrain-following heights
    // CRITICAL: Use a LARGE offset to guarantee overlays are always above terrain
    // The terrain has:
    // - Base elevation from heightMap
    // - Additional noise up to ~0.5 units for unwalkable terrain
    // - Smoothing that can create local variations
    // Total safe offset: 1.5 units above heightMap value
    const effectiveOffset = heightOffset + 1.5;

    for (let iy = 0; iy <= segmentsY; iy++) {
      for (let ix = 0; ix <= segmentsX; ix++) {
        const x = Math.min(ix * step, width);
        const z = Math.min(iy * step, height);

        // Get terrain height at this position (x = worldX, z = worldZ which maps to gridY)
        const terrainHeight = this.getTerrainHeight(x, z);
        const y = terrainHeight + effectiveOffset;

        vertices.push(x, y, z);
        uvs.push(x / width, z / height);
      }
    }

    // Generate indices for triangles
    for (let iy = 0; iy < segmentsY; iy++) {
      for (let ix = 0; ix < segmentsX; ix++) {
        const a = iy * (segmentsX + 1) + ix;
        const b = iy * (segmentsX + 1) + ix + 1;
        const c = (iy + 1) * (segmentsX + 1) + ix;
        const d = (iy + 1) * (segmentsX + 1) + ix + 1;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create the navigable terrain overlay
   * Colors:
   * - Green = normal walkable (1.0x speed)
   * - Cyan = road (1.25x speed, faster)
   * - Yellow = light forest (0.85x speed)
   * - Orange = shallow water/mud (0.4-0.6x speed)
   * - Dark orange = dense forest (0.5x speed)
   * - Red = impassable (cliffs, deep water, void)
   * - Gray striped = unbuildable
   */
  private createTerrainOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        const idx = (y * width + x) * 4;
        const color = this.getTerrainColor(cell);

        textureData[idx + 0] = color.r;
        textureData[idx + 1] = color.g;
        textureData[idx + 2] = color.b;
        textureData[idx + 3] = color.a;
      }
    }

    this.terrainTexture = new THREE.DataTexture(
      textureData ,
      width,
      height,
      THREE.RGBAFormat
    );
    this.terrainTexture.needsUpdate = true;
    this.terrainTexture.minFilter = THREE.NearestFilter;
    this.terrainTexture.magFilter = THREE.NearestFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        overlayTexture: { value: this.terrainTexture },
        opacity: { value: this.opacity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D overlayTexture;
        uniform float opacity;
        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D(overlayTexture, vUv);
          // Use the alpha from texture for striped unbuildable areas
          float finalAlpha = texColor.a * opacity;
          gl_FragColor = vec4(texColor.rgb, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true, // Keep depth test but use polygon offset
      side: THREE.DoubleSide,
      // CRITICAL: Use aggressive polygon offset to push overlay above terrain
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    // Create geometry that follows terrain height with large offset
    const geometry = this.createTerrainFollowingGeometry(width, height, 0.1);
    this.terrainOverlayMesh = new THREE.Mesh(geometry, material);
    // No rotation needed - geometry is already in world coordinates
    this.terrainOverlayMesh.renderOrder = 500; // High render order for overlay priority
    this.terrainOverlayMesh.visible = false;
    this.scene.add(this.terrainOverlayMesh);
  }

  private getTerrainColor(cell: MapCell): { r: number; g: number; b: number; a: number } {
    const feature = cell.feature || 'none';
    const config = TERRAIN_FEATURE_CONFIG[feature];

    // Impassable terrain - Red
    if (cell.terrain === 'unwalkable' || !config.walkable) {
      if (feature === 'water_deep') {
        return { r: 30, g: 80, b: 180, a: 200 }; // Deep blue for deep water
      }
      if (feature === 'void') {
        return { r: 40, g: 20, b: 60, a: 220 }; // Dark purple for void
      }
      return { r: 180, g: 50, b: 50, a: 200 }; // Red for cliffs/impassable
    }

    // Roads - Cyan (fast)
    if (feature === 'road') {
      return { r: 80, g: 200, b: 220, a: 180 };
    }

    // Shallow water - Light blue
    if (feature === 'water_shallow') {
      return { r: 100, g: 150, b: 220, a: 180 };
    }

    // Mud/swamp - Brown/orange
    if (feature === 'mud') {
      return { r: 180, g: 120, b: 60, a: 180 };
    }

    // Dense forest - Dark orange (slow + hides)
    if (feature === 'forest_dense') {
      return { r: 200, g: 130, b: 50, a: 180 };
    }

    // Light forest - Yellow-green
    if (feature === 'forest_light') {
      return { r: 180, g: 200, b: 80, a: 160 };
    }

    // Ramps - Yellow
    if (cell.terrain === 'ramp') {
      return { r: 220, g: 200, b: 80, a: 150 };
    }

    // Unbuildable but walkable - Gray with lower alpha (will show as striped in UI)
    if (cell.terrain === 'unbuildable' || !config.buildable) {
      return { r: 120, g: 120, b: 130, a: 140 };
    }

    // Normal walkable ground - Green
    return { r: 80, g: 180, b: 80, a: 150 };
  }

  /**
   * Create the elevation overlay
   * Shows three zones with color coding:
   * - Dark = Low ground (0-85)
   * - Medium = Mid ground (86-170)
   * - Bright = High ground (171-255)
   */
  private createElevationOverlay(): void {
    const { width, height, terrain } = this.mapData;
    const textureData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = terrain[y][x];
        const idx = (y * width + x) * 4;
        const zone = elevationToZone(cell.elevation);

        let r = 0, g = 0, b = 0, a = 160;

        switch (zone) {
          case 'low':
            // Dark blue-purple for low ground
            r = 60; g = 70; b = 140;
            break;
          case 'mid':
            // Yellow-green for mid ground
            r = 160; g = 180; b = 80;
            break;
          case 'high':
            // Bright cyan/white for high ground (advantage zone)
            r = 120; g = 220; b: 220;
            b = 220;
            break;
        }

        // Add gradient based on exact elevation within zone
        const elevationFactor = cell.elevation / 255;
        r = Math.min(255, Math.floor(r + elevationFactor * 30));
        g = Math.min(255, Math.floor(g + elevationFactor * 30));
        b = Math.min(255, Math.floor(b + elevationFactor * 20));

        // Mark impassable areas
        if (cell.terrain === 'unwalkable') {
          r = Math.floor(r * 0.5);
          g = Math.floor(g * 0.5);
          b = Math.floor(b * 0.5);
          a = 200;
        }

        textureData[idx + 0] = r;
        textureData[idx + 1] = g;
        textureData[idx + 2] = b;
        textureData[idx + 3] = a;
      }
    }

    this.elevationTexture = new THREE.DataTexture(
      textureData ,
      width,
      height,
      THREE.RGBAFormat
    );
    this.elevationTexture.needsUpdate = true;
    this.elevationTexture.minFilter = THREE.LinearFilter;
    this.elevationTexture.magFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        overlayTexture: { value: this.elevationTexture },
        opacity: { value: this.opacity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D overlayTexture;
        uniform float opacity;
        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D(overlayTexture, vUv);
          gl_FragColor = vec4(texColor.rgb, texColor.a * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      // CRITICAL: Use aggressive polygon offset to push overlay above terrain
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    // Create geometry that follows terrain height with large offset
    const geometry = this.createTerrainFollowingGeometry(width, height, 0.15);
    this.elevationOverlayMesh = new THREE.Mesh(geometry, material);
    // No rotation needed - geometry is already in world coordinates
    this.elevationOverlayMesh.renderOrder = 500; // High render order for overlay priority
    this.elevationOverlayMesh.visible = false;
    this.scene.add(this.elevationOverlayMesh);
  }

  /**
   * Create the threat range overlay
   * Shows enemy attack ranges as red-tinted zones
   * Darker = more overlapping threats
   * Updated dynamically based on enemy positions
   */
  private createThreatOverlay(): void {
    const { width, height } = this.mapData;
    this.threatTextureData = new Uint8Array(width * height * 4);

    // Initialize with transparent
    for (let i = 0; i < width * height * 4; i += 4) {
      this.threatTextureData[i + 0] = 0;
      this.threatTextureData[i + 1] = 0;
      this.threatTextureData[i + 2] = 0;
      this.threatTextureData[i + 3] = 0;
    }

    this.threatTexture = new THREE.DataTexture(
      this.threatTextureData ,
      width,
      height,
      THREE.RGBAFormat
    );
    this.threatTexture.needsUpdate = true;
    this.threatTexture.minFilter = THREE.LinearFilter;
    this.threatTexture.magFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        overlayTexture: { value: this.threatTexture },
        opacity: { value: this.opacity },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D overlayTexture;
        uniform float opacity;
        uniform float time;
        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D(overlayTexture, vUv);

          // Pulsing effect for threat zones
          float pulse = 0.85 + 0.15 * sin(time * 2.0 + vUv.x * 10.0 + vUv.y * 10.0);

          // Red tint with intensity based on threat level
          vec3 threatColor = vec3(0.9, 0.2, 0.1) * texColor.r * pulse;
          float alpha = texColor.a * opacity;

          gl_FragColor = vec4(threatColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      // CRITICAL: Use aggressive polygon offset to push overlay above terrain
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    // Create geometry that follows terrain height with large offset
    const geometry = this.createTerrainFollowingGeometry(width, height, 0.2);
    this.threatOverlayMesh = new THREE.Mesh(geometry, material);
    // No rotation needed - geometry is already in world coordinates
    this.threatOverlayMesh.renderOrder = 501; // Slightly higher than other overlays
    this.threatOverlayMesh.visible = false;
    this.scene.add(this.threatOverlayMesh);
  }

  /**
   * Update threat overlay based on current enemy positions
   */
  private updateThreatOverlay(): void {
    if (!this.world || !this.threatTextureData || !this.threatTexture) return;

    const { width, height } = this.mapData;
    const localPlayerId = getLocalPlayerId();

    // Clear threat data
    for (let i = 0; i < width * height * 4; i += 4) {
      this.threatTextureData[i + 0] = 0; // Threat intensity
      this.threatTextureData[i + 1] = 0;
      this.threatTextureData[i + 2] = 0;
      this.threatTextureData[i + 3] = 0; // Alpha
    }

    // Accumulate threat from enemy units
    const units = this.world.getEntitiesWith('Unit', 'Transform', 'Selectable', 'Health');
    for (const entity of units) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      // Only show enemy threats
      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;

      // Skip non-combat units (workers without attack)
      if (unit.attackDamage <= 0) continue;

      const range = unit.attackRange;
      this.addThreatCircle(transform.x, transform.y, range, 1.0);
    }

    // Accumulate threat from enemy buildings with attack capability
    const buildings = this.world.getEntitiesWith('Building', 'Transform', 'Selectable', 'Health');
    for (const entity of buildings) {
      const selectable = entity.get<Selectable>('Selectable')!;
      const health = entity.get<Health>('Health')!;

      if (selectable.playerId === localPlayerId || health.isDead()) continue;

      const transform = entity.get<Transform>('Transform')!;
      const building = entity.get<Building>('Building')!;

      // Only buildings that can attack (defensive structures)
      if (building.attackDamage > 0 && building.attackRange > 0) {
        this.addThreatCircle(transform.x, transform.y, building.attackRange, 1.2);
      }
    }

    this.threatTexture.needsUpdate = true;
  }

  /**
   * Add a circular threat zone to the texture
   */
  private addThreatCircle(centerX: number, centerY: number, radius: number, intensity: number): void {
    if (!this.threatTextureData) return;

    const { width, height } = this.mapData;
    const radiusSq = radius * radius;

    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distSq = dx * dx + dy * dy;

        if (distSq <= radiusSq) {
          const idx = (y * width + x) * 4;

          // Falloff from center
          const dist = Math.sqrt(distSq);
          const falloff = 1 - (dist / radius);
          const threatValue = Math.min(255, Math.floor(intensity * falloff * 200));

          // Accumulate threat (brighter = more dangerous)
          this.threatTextureData[idx + 0] = Math.min(255, this.threatTextureData[idx + 0] + threatValue);
          this.threatTextureData[idx + 3] = Math.min(200, this.threatTextureData[idx + 3] + Math.floor(threatValue * 0.7));
        }
      }
    }
  }

  /**
   * Set the active overlay type
   */
  public setActiveOverlay(overlay: GameOverlayType): void {
    this.currentOverlay = overlay;

    if (this.terrainOverlayMesh) {
      this.terrainOverlayMesh.visible = overlay === 'terrain';
    }
    if (this.elevationOverlayMesh) {
      this.elevationOverlayMesh.visible = overlay === 'elevation';
    }
    if (this.threatOverlayMesh) {
      this.threatOverlayMesh.visible = overlay === 'threat';
    }
  }

  /**
   * Set overlay opacity
   */
  public setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity));

    if (this.terrainOverlayMesh) {
      (this.terrainOverlayMesh.material as THREE.ShaderMaterial).uniforms.opacity.value = this.opacity;
    }
    if (this.elevationOverlayMesh) {
      (this.elevationOverlayMesh.material as THREE.ShaderMaterial).uniforms.opacity.value = this.opacity;
    }
    if (this.threatOverlayMesh) {
      (this.threatOverlayMesh.material as THREE.ShaderMaterial).uniforms.opacity.value = this.opacity;
    }
  }

  /**
   * Update overlays (call each frame)
   */
  public update(deltaTime: number): void {
    // Update threat overlay animation
    if (this.threatOverlayMesh && this.currentOverlay === 'threat') {
      const material = this.threatOverlayMesh.material as THREE.ShaderMaterial;
      material.uniforms.time.value += deltaTime / 1000;

      // Throttled threat position update
      const now = performance.now();
      if (now - this.lastThreatUpdate > this.threatUpdateInterval) {
        this.updateThreatOverlay();
        this.lastThreatUpdate = now;
      }
    }
  }

  /**
   * Get current overlay type
   */
  public getActiveOverlay(): GameOverlayType {
    return this.currentOverlay;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    if (this.terrainOverlayMesh) {
      this.scene.remove(this.terrainOverlayMesh);
      this.terrainOverlayMesh.geometry.dispose();
      (this.terrainOverlayMesh.material as THREE.Material).dispose();
    }
    if (this.elevationOverlayMesh) {
      this.scene.remove(this.elevationOverlayMesh);
      this.elevationOverlayMesh.geometry.dispose();
      (this.elevationOverlayMesh.material as THREE.Material).dispose();
    }
    if (this.threatOverlayMesh) {
      this.scene.remove(this.threatOverlayMesh);
      this.threatOverlayMesh.geometry.dispose();
      (this.threatOverlayMesh.material as THREE.Material).dispose();
    }

    this.terrainTexture?.dispose();
    this.elevationTexture?.dispose();
    this.threatTexture?.dispose();
  }
}
