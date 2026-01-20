/**
 * SelectionRingRenderer - Shared instanced selection ring rendering
 *
 * Consolidates selection ring instancing logic used by both UnitRenderer and BuildingRenderer.
 * Provides efficient instanced rendering for selection rings with owned/enemy color distinction.
 */

import * as THREE from 'three';
import { createSelectionRingMaterial, updateSelectionRingTime, TEAM_COLORS } from '@/rendering/tsl/SelectionMaterial';
import { RENDER_ORDER } from '@/data/rendering.config';

/**
 * Configuration for selection ring appearance
 */
export interface SelectionRingConfig {
  innerRadius: number;
  outerRadius: number;
  segments: number;
  opacity: number;
  maxInstances: number;
}

/**
 * Data for a pending selection ring instance
 */
export interface SelectionRingInstance {
  entityId: number;
  position: THREE.Vector3;
  scale: number;
  isOwned: boolean;
}

/**
 * Internal instanced selection ring group
 */
interface InstancedSelectionRingGroup {
  mesh: THREE.InstancedMesh;
  isOwned: boolean;
  entityIds: number[];
  maxInstances: number;
}

/**
 * Shared selection ring renderer utility.
 * Manages instanced selection rings for both units and buildings.
 */
export class SelectionRingRenderer {
  private readonly scene: THREE.Scene;
  private readonly config: SelectionRingConfig;

  // Shared geometry
  private readonly ringGeometry: THREE.RingGeometry;

  // TSL animated materials (shared across all instances)
  private readonly ownedMaterial: THREE.Material;
  private readonly enemyMaterial: THREE.Material;

  // Instanced mesh groups: 'owned' or 'enemy'
  private readonly selectionRingGroups: Map<string, InstancedSelectionRingGroup> = new Map();

  // Pre-computed rotation for flat ground overlays (rings lie flat on XZ plane)
  private readonly groundOverlayRotation: THREE.Quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );

  // Reusable objects for matrix calculations
  private readonly tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private readonly tempPosition: THREE.Vector3 = new THREE.Vector3();
  private readonly tempScale: THREE.Vector3 = new THREE.Vector3();

  // Animation time tracking
  private animationTime: number = 0;

  constructor(scene: THREE.Scene, config: SelectionRingConfig) {
    this.scene = scene;
    this.config = config;

    // Create shared geometry
    this.ringGeometry = new THREE.RingGeometry(
      config.innerRadius,
      config.outerRadius,
      config.segments
    );

    // TSL animated selection ring materials with pulsing/shimmer effects
    this.ownedMaterial = createSelectionRingMaterial({
      color: TEAM_COLORS.player1, // Cyan for owned
      opacity: config.opacity,
    });
    this.enemyMaterial = createSelectionRingMaterial({
      color: TEAM_COLORS.player2, // Red for enemy
      opacity: config.opacity,
    });
  }

  /**
   * Get or create an instanced selection ring group
   */
  private getOrCreateGroup(isOwned: boolean): InstancedSelectionRingGroup {
    const key = isOwned ? 'owned' : 'enemy';
    let group = this.selectionRingGroups.get(key);

    if (!group) {
      // Use material directly (not cloned) so animation updates apply to all instances
      const material = isOwned ? this.ownedMaterial : this.enemyMaterial;
      const mesh = new THREE.InstancedMesh(this.ringGeometry, material, this.config.maxInstances);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // NOTE: Don't set mesh.rotation here - rotation is applied per-instance to avoid
      // coordinate transform issues with instanced meshes
      mesh.renderOrder = RENDER_ORDER.GROUND_EFFECT;
      this.scene.add(mesh);

      group = {
        mesh,
        isOwned,
        entityIds: [],
        maxInstances: this.config.maxInstances,
      };
      this.selectionRingGroups.set(key, group);
    }

    return group;
  }

  /**
   * Reset instance counts at the start of each frame.
   * Call this before adding instances for the current frame.
   */
  public resetInstances(): void {
    for (const group of this.selectionRingGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }
  }

  /**
   * Add a selection ring instance for the current frame.
   */
  public addInstance(instance: SelectionRingInstance): void {
    const group = this.getOrCreateGroup(instance.isOwned);

    if (group.mesh.count < group.maxInstances) {
      const idx = group.mesh.count;
      group.entityIds[idx] = instance.entityId;

      // Selection rings are flat on ground - apply rotation per-instance to lay flat
      this.tempPosition.copy(instance.position);
      this.tempScale.set(instance.scale, instance.scale, 1);
      this.tempMatrix.compose(this.tempPosition, this.groundOverlayRotation, this.tempScale);
      group.mesh.setMatrixAt(idx, this.tempMatrix);

      group.mesh.count++;
    }
  }

  /**
   * Finalize instance matrices after all instances have been added.
   * Call this after all addInstance() calls for the current frame.
   */
  public commitInstances(): void {
    // Mark matrices as needing update
    // FIX: Always mark needsUpdate even when count is 0, to ensure GPU clears stale instances
    for (const group of this.selectionRingGroups.values()) {
      group.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Update animation time for pulsing/shimmer effects.
   * Call this once per frame with the delta time.
   */
  public updateAnimation(deltaTime: number): void {
    this.animationTime += deltaTime;
    updateSelectionRingTime(this.animationTime);
  }

  /**
   * Get the current animation time (for external use if needed).
   */
  public getAnimationTime(): number {
    return this.animationTime;
  }

  /**
   * Get the ground overlay rotation quaternion (for external use if needed).
   */
  public getGroundOverlayRotation(): THREE.Quaternion {
    return this.groundOverlayRotation;
  }

  /**
   * Dispose all resources.
   */
  public dispose(): void {
    this.ringGeometry.dispose();
    this.ownedMaterial.dispose();
    this.enemyMaterial.dispose();

    for (const group of this.selectionRingGroups.values()) {
      this.scene.remove(group.mesh);
      // Materials are shared, already disposed above
    }
    this.selectionRingGroups.clear();
  }
}
