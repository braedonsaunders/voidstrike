import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager } from '@/assets/AssetManager';
import { Terrain } from './Terrain';

interface UnitMeshData {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  unitId: string;
  // Animation support
  mixer: THREE.AnimationMixer | null;
  currentAction: THREE.AnimationAction | null;
  animations: THREE.AnimationClip[];
}

// Player colors
const PLAYER_COLORS: Record<string, number> = {
  player1: 0x40a0ff, // Blue
  ai: 0xff4040, // Red
  player2: 0x40ff40, // Green
  player3: 0xffff40, // Yellow
  player4: 0xff40ff, // Purple
};

export class UnitRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string = 'player1';
  private unitMeshes: Map<number, UnitMeshData> = new Map();

  // Animation timing
  private clock: THREE.Clock = new THREE.Clock();

  // Shared resources
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private enemySelectionMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    this.selectionGeometry = new THREE.RingGeometry(0.6, 0.8, 32);
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.enemySelectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    // Preload common procedural assets
    AssetManager.preloadCommonAssets();

    // Register callback to refresh meshes when custom models finish loading
    AssetManager.onModelsLoaded(() => {
      this.refreshAllMeshes();
    });

    // Load custom GLB models (async, runs in background)
    // Animation names will be logged to console when models load
    AssetManager.loadCustomModels().catch(err => {
      console.warn('[UnitRenderer] Error loading custom models:', err);
    });
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public update(): void {
    const delta = this.clock.getDelta();
    const entities = this.world.getEntitiesWith('Transform', 'Unit');
    const currentIds = new Set<number>();

    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform')!;
      const unit = entity.get<Unit>('Unit')!;
      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isOwned = ownerId === this.playerId;
      const isEnemy = selectable && ownerId !== this.playerId;

      // Check visibility for enemy units
      let shouldShow = true;
      if (isEnemy && this.visionSystem) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      // Skip dead units
      if (health && health.isDead()) {
        shouldShow = false;
      }

      let meshData = this.unitMeshes.get(entity.id);

      if (!meshData) {
        // Create new mesh for this unit
        meshData = this.createUnitMesh(unit, ownerId);
        this.unitMeshes.set(entity.id, meshData);
        this.scene.add(meshData.group);
        this.scene.add(meshData.selectionRing);
        this.scene.add(meshData.healthBar);
      }

      // Update visibility
      meshData.group.visible = shouldShow;
      meshData.healthBar.visible = shouldShow && !!health && health.getHealthPercent() < 1;

      if (!shouldShow) {
        meshData.selectionRing.visible = false;
        continue;
      }

      // Get terrain height at this position
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Update position - place unit on top of terrain
      meshData.group.position.set(transform.x, terrainHeight, transform.y);
      meshData.group.rotation.y = -transform.rotation + Math.PI / 2;

      // Update selection ring
      meshData.selectionRing.position.set(transform.x, terrainHeight + 0.05, transform.y);
      meshData.selectionRing.visible = selectable?.isSelected ?? false;

      // Update selection ring color based on ownership
      if (meshData.selectionRing.visible) {
        (meshData.selectionRing.material as THREE.MeshBasicMaterial) =
          isOwned ? this.selectionMaterial : this.enemySelectionMaterial;
      }

      // Update health bar
      if (health) {
        meshData.healthBar.position.set(transform.x, terrainHeight + 1.5, transform.y);
        this.updateHealthBar(meshData.healthBar, health);
      }

      // Update animations
      if (meshData.mixer && meshData.animations.length > 0) {
        meshData.mixer.update(delta);

        // Determine desired animation state
        const isMoving = unit.state === 'moving' || unit.state === 'gathering' ||
                         unit.state === 'patrolling' || unit.state === 'building';
        const isAttacking = unit.state === 'attacking';

        // Find appropriate animation by name pattern
        const desiredAnim = this.findAnimationForState(meshData.animations, isMoving, isAttacking);

        // Switch animation if needed
        if (desiredAnim && meshData.currentAction?.getClip() !== desiredAnim) {
          // Fade out current animation
          if (meshData.currentAction) {
            meshData.currentAction.fadeOut(0.2);
          }
          // Start new animation
          meshData.currentAction = meshData.mixer.clipAction(desiredAnim);
          meshData.currentAction.reset().fadeIn(0.2).play();
        } else if (!meshData.currentAction && meshData.animations.length > 0) {
          // No animation playing yet - start the first one
          meshData.currentAction = meshData.mixer.clipAction(meshData.animations[0]);
          meshData.currentAction.play();
          console.log(`[UnitRenderer] Started animation for ${unit.unitId}: ${meshData.animations[0].name}`);
        }

        // For single-animation models, vary speed based on state
        if (meshData.animations.length === 1 && meshData.currentAction) {
          meshData.currentAction.timeScale = isMoving || isAttacking ? 1.0 : 0.3;
        }
      }
    }

    // Remove meshes for destroyed entities
    for (const [entityId, meshData] of this.unitMeshes) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(meshData.group);
        this.scene.remove(meshData.selectionRing);
        this.scene.remove(meshData.healthBar);
        this.disposeGroup(meshData.group);
        this.unitMeshes.delete(entityId);
      }
    }
  }

  private createUnitMesh(unit: Unit, playerId: string): UnitMeshData {
    // Get player color
    const playerColor = PLAYER_COLORS[playerId] ?? 0x808080;

    // Get unit mesh from AssetManager
    const group = AssetManager.getUnitMesh(unit.unitId, playerColor) as THREE.Group;

    // Ensure proper shadows
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Selection ring
    const selectionRing = new THREE.Mesh(this.selectionGeometry, this.selectionMaterial);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;

    // Health bar
    const healthBar = this.createHealthBar();

    // Set up animations if available
    let mixer: THREE.AnimationMixer | null = null;
    let currentAction: THREE.AnimationAction | null = null;
    const animations = AssetManager.getAnimations(unit.unitId);

    if (animations.length > 0) {
      // Create mixer for the inner model (not the wrapper group)
      const innerModel = group.children[0];
      if (innerModel) {
        mixer = new THREE.AnimationMixer(innerModel);
        console.log(`[UnitRenderer] Created AnimationMixer for ${unit.unitId} with ${animations.length} animations`);
      }
    }

    return { group, selectionRing, healthBar, unitId: unit.unitId, mixer, currentAction, animations };
  }

  private createHealthBar(): THREE.Group {
    const group = new THREE.Group();

    // Background
    const bgGeometry = new THREE.PlaneGeometry(1, 0.1);
    const bgMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
    });
    const bg = new THREE.Mesh(bgGeometry, bgMaterial);
    group.add(bg);

    // Health fill
    const fillGeometry = new THREE.PlaneGeometry(1, 0.1);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
    });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'healthFill';
    group.add(fill);

    // Shield bar (if applicable)
    const shieldGeometry = new THREE.PlaneGeometry(1, 0.05);
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.y = 0.08;
    shield.position.z = 0.01;
    shield.name = 'shieldFill';
    shield.visible = false;
    group.add(shield);

    // Make health bar always face camera
    group.lookAt(0, 100, 0);

    return group;
  }

  /**
   * Find the best animation for a given state by searching name patterns.
   * Falls back to first animation if no match found.
   */
  private findAnimationForState(
    animations: THREE.AnimationClip[],
    isMoving: boolean,
    isAttacking: boolean
  ): THREE.AnimationClip | null {
    if (animations.length === 0) return null;
    if (animations.length === 1) return animations[0]; // Only one animation, use it

    const lowerNames = animations.map(a => a.name.toLowerCase());

    if (isAttacking) {
      // Look for attack animation
      const attackIdx = lowerNames.findIndex(n =>
        n.includes('attack') || n.includes('fire') || n.includes('shoot')
      );
      if (attackIdx >= 0) return animations[attackIdx];
    }

    if (isMoving) {
      // Look for walk/run animation
      const moveIdx = lowerNames.findIndex(n =>
        n.includes('walk') || n.includes('run') || n.includes('move')
      );
      if (moveIdx >= 0) return animations[moveIdx];
    }

    // Look for idle animation
    const idleIdx = lowerNames.findIndex(n =>
      n.includes('idle') || n.includes('stand') || n.includes('rest')
    );
    if (idleIdx >= 0) return animations[idleIdx];

    // Fallback: return first animation
    return animations[0];
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;
    const shield = healthBar.getObjectByName('shieldFill') as THREE.Mesh;

    if (fill) {
      const percent = health.getHealthPercent();
      fill.scale.x = percent;
      fill.position.x = (percent - 1) / 2;

      // Color based on health
      const material = fill.material as THREE.MeshBasicMaterial;
      if (percent > 0.6) {
        material.color.setHex(0x00ff00);
      } else if (percent > 0.3) {
        material.color.setHex(0xffff00);
      } else {
        material.color.setHex(0xff0000);
      }
    }

    if (shield && health.maxShield > 0) {
      shield.visible = true;
      const shieldPercent = health.getShieldPercent();
      shield.scale.x = shieldPercent;
      shield.position.x = (shieldPercent - 1) / 2;
    }
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        } else if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        }
      }
    });
  }

  /**
   * Clear all cached meshes so they get recreated with updated assets on next update.
   * Called when custom models finish loading.
   */
  public refreshAllMeshes(): void {
    console.log('[UnitRenderer] Refreshing all unit meshes...');
    for (const [entityId, meshData] of this.unitMeshes) {
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
      this.disposeGroup(meshData.group);
    }
    this.unitMeshes.clear();
    // Meshes will be recreated on next update() call
  }

  public dispose(): void {
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
    this.enemySelectionMaterial.dispose();

    for (const meshData of this.unitMeshes.values()) {
      this.disposeGroup(meshData.group);
      this.scene.remove(meshData.group);
      this.scene.remove(meshData.selectionRing);
      this.scene.remove(meshData.healthBar);
    }

    this.unitMeshes.clear();
  }
}
