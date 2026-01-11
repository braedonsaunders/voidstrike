import * as THREE from 'three';
import { World } from '@/engine/ecs/World';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Velocity } from '@/engine/components/Velocity';
import { VisionSystem } from '@/engine/systems/VisionSystem';
import { AssetManager } from '@/assets/AssetManager';
import { Terrain } from './Terrain';
import { getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { debugAnimation, debugAssets, debugPerformance } from '@/utils/debugLogger';

// Instance data for a single unit type + player combo (non-animated units)
interface InstancedUnitGroup {
  mesh: THREE.InstancedMesh;
  unitType: string;
  playerId: string;
  maxInstances: number;
  entityIds: number[]; // Maps instance index to entity ID
  dummy: THREE.Object3D; // Reusable for matrix calculations
  yOffset: number; // Y offset to apply when positioning (accounts for model origin)
}

// Per-unit animated mesh data (for animated units)
interface AnimatedUnitMesh {
  mesh: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  animations: Map<string, THREE.AnimationAction>;
  currentAction: string;
}

// Per-unit overlay data (selection ring, health bar, team marker)
interface UnitOverlay {
  selectionRing: THREE.Mesh;
  healthBar: THREE.Group;
  teamMarker: THREE.Mesh;
  lastHealth: number;
}

const MAX_INSTANCES_PER_TYPE = 100; // Max units of same type per player

export class UnitRenderer {
  private scene: THREE.Scene;
  private world: World;
  private visionSystem: VisionSystem | null;
  private terrain: Terrain | null;
  private playerId: string | null = null;

  // Instanced mesh groups: key = "unitType_playerId" (for non-animated units)
  private instancedGroups: Map<string, InstancedUnitGroup> = new Map();

  // Animated unit meshes: key = entityId (for animated units)
  private animatedUnits: Map<number, AnimatedUnitMesh> = new Map();

  // Track which unit types are animated
  private animatedUnitTypes: Set<string> = new Set();

  // Per-unit overlays (selection rings, health bars)
  private unitOverlays: Map<number, UnitOverlay> = new Map();

  // Shared resources
  private selectionGeometry: THREE.RingGeometry;
  private selectionMaterial: THREE.MeshBasicMaterial;
  private enemySelectionMaterial: THREE.MeshBasicMaterial;
  private teamMarkerGeometry: THREE.CircleGeometry;

  // Reusable objects for matrix calculations
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private tempPosition: THREE.Vector3 = new THREE.Vector3();
  private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
  private tempScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  private tempEuler: THREE.Euler = new THREE.Euler();

  constructor(scene: THREE.Scene, world: World, visionSystem?: VisionSystem, terrain?: Terrain) {
    this.scene = scene;
    this.world = world;
    this.visionSystem = visionSystem ?? null;
    this.terrain = terrain ?? null;

    this.selectionGeometry = new THREE.RingGeometry(0.6, 0.8, 16); // Reduced segments for perf
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

    // Team marker geometry - small circle beneath each unit showing team color
    this.teamMarkerGeometry = new THREE.CircleGeometry(0.4, 12);

    // Preload common procedural assets
    AssetManager.preloadCommonAssets();

    // Register callback to refresh meshes when custom models finish loading
    AssetManager.onModelsLoaded(() => {
      this.refreshAllMeshes();
    });

    // Load custom GLB models (async, runs in background)
    AssetManager.loadCustomModels().catch(err => {
      debugAssets.warn('[UnitRenderer] Error loading custom models:', err);
    });
  }

  public setPlayerId(playerId: string | null): void {
    this.playerId = playerId;
  }

  /**
   * Check if a unit type should use animated rendering
   */
  private isAnimatedUnitType(unitType: string): boolean {
    // Check cached result first
    if (this.animatedUnitTypes.has(unitType)) {
      return true;
    }
    // Check if asset has animations
    if (AssetManager.hasAnimations(unitType)) {
      this.animatedUnitTypes.add(unitType);
      return true;
    }
    return false;
  }

  /**
   * Get or create an animated mesh for a specific unit entity
   */
  private getOrCreateAnimatedUnit(entityId: number, unitType: string, playerId: string): AnimatedUnitMesh {
    let animUnit = this.animatedUnits.get(entityId);

    if (!animUnit) {
      const playerColor = getPlayerColor(playerId);
      const mesh = AssetManager.getUnitMesh(unitType, playerColor);
      // Units render AFTER ground effects (5) but BEFORE damage numbers (100)
      mesh.renderOrder = 50;
      mesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.renderOrder = 50;
        }
      });
      this.scene.add(mesh);

      // Find the actual model inside the wrapper for proper animation binding
      // AssetManager wraps models in a Group, so get the first child (the actual model)
      const animationRoot = mesh.children.length > 0 ? mesh.children[0] : mesh;

      // Create animation mixer with the actual model (not the wrapper)
      const mixer = new THREE.AnimationMixer(animationRoot);
      const animations = new Map<string, THREE.AnimationAction>();

      // Get animations from asset manager and create actions
      const clips = AssetManager.getAnimations(unitType);

      // Track which canonical names have exact matches to prefer them over partial matches
      const exactMatches = { idle: false, walk: false, attack: false, death: false };

      for (const clip of clips) {
        const action = mixer.clipAction(clip);
        // Normalize name: lowercase and strip common prefixes like "Armature|"
        let name = clip.name.toLowerCase();
        // Handle Blender-style naming (e.g., "Armature|idle" -> "idle")
        if (name.includes('|')) {
          name = name.split('|').pop() || name;
        }

        animations.set(name, action);
        debugAnimation.log(`[UnitRenderer] ${unitType}: Found animation "${clip.name}" -> normalized "${name}"`);

        // Map to canonical animation names, preferring EXACT matches over partial matches
        // This prevents "idle_4" from overwriting "idle", or "running" from overwriting "walk"

        // Check for EXACT matches first (these always win)
        if (name === 'idle' || name === 'stand' || name === 'pose') {
          animations.set('idle', action);
          exactMatches.idle = true;
          debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'idle' (exact match)`);
        }
        if (name === 'walk' || name === 'run' || name === 'move') {
          animations.set('walk', action);
          exactMatches.walk = true;
          debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'walk' (exact match)`);
        }
        if (name === 'attack' || name === 'shoot' || name === 'fire' || name === 'combat') {
          animations.set('attack', action);
          exactMatches.attack = true;
          debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'attack' (exact match)`);
        }
        if (name === 'death' || name === 'die' || name === 'dead') {
          animations.set('death', action);
          exactMatches.death = true;
          debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'death' (exact match)`);
        }
      }

      // Second pass: fill in missing canonical names with partial matches (only if no exact match exists)
      for (const clip of clips) {
        let name = clip.name.toLowerCase();
        if (name.includes('|')) {
          name = name.split('|').pop() || name;
        }
        const action = animations.get(name)!;

        // Only use partial matches if we don't have an exact match
        if (!exactMatches.idle && !animations.has('idle')) {
          if (name.includes('idle') || name.includes('stand')) {
            animations.set('idle', action);
            debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'idle' (partial match)`);
          }
        }
        if (!exactMatches.walk && !animations.has('walk')) {
          if (name.includes('walk') || name.includes('run') || name.includes('move') || name.includes('locomotion')) {
            animations.set('walk', action);
            debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'walk' (partial match)`);
          }
        }
        if (!exactMatches.attack && !animations.has('attack')) {
          if (name.includes('attack') || name.includes('shoot') || name.includes('fire') || name.includes('combat')) {
            animations.set('attack', action);
            debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'attack' (partial match)`);
          }
        }
        if (!exactMatches.death && !animations.has('death')) {
          if (name.includes('death') || name.includes('die') || name.includes('dead')) {
            animations.set('death', action);
            debugAnimation.log(`[UnitRenderer] ${unitType}: Mapped "${name}" -> 'death' (partial match)`);
          }
        }
      }

      // Ensure we have fallbacks for missing animations
      if (!animations.has('walk') && animations.has('idle')) {
        animations.set('walk', animations.get('idle')!);
      }
      if (!animations.has('attack') && animations.has('idle')) {
        animations.set('attack', animations.get('idle')!);
      }

      // Log final animation mappings
      debugAnimation.log(`[UnitRenderer] ${unitType}: Final animation mappings:`);
      for (const [key, action] of animations) {
        const clipName = action.getClip().name;
        debugAnimation.log(`[UnitRenderer]   '${key}' -> clip "${clipName}"`);
      }

      // Start with idle animation if available
      const idleAction = animations.get('idle');
      if (idleAction) {
        debugAnimation.log(`[UnitRenderer] ${unitType}: Starting idle animation, clip name: "${idleAction.getClip().name}"`);
        idleAction.play();
      } else if (clips.length > 0) {
        // Fall back to first NON-DEATH animation to avoid playing death as idle
        let fallbackClip = clips[0];
        for (const clip of clips) {
          const lowerName = clip.name.toLowerCase();
          // Skip death animations as fallback
          if (!lowerName.includes('death') && !lowerName.includes('die') && !lowerName.includes('dead')) {
            fallbackClip = clip;
            break;
          }
        }
        const firstAction = mixer.clipAction(fallbackClip);
        firstAction.play();
        animations.set('idle', firstAction);
        debugAnimation.log(`[UnitRenderer] ${unitType}: No idle animation found, using fallback: ${fallbackClip.name}`);
      }

      animUnit = {
        mesh,
        mixer,
        animations,
        currentAction: 'idle',
      };

      this.animatedUnits.set(entityId, animUnit);
    }

    return animUnit;
  }

  /**
   * Remove root motion (position/translation tracks) from an animation clip.
   * This prevents animations from moving the model, which would conflict with
   * programmatic position updates and cause jolting/warping effects.
   *
   * ONLY removes position/translation tracks from the actual root bone, not child bones.
   */
  private removeRootMotion(clip: THREE.AnimationClip): void {
    // Filter out position/translation tracks that affect the root bone ONLY
    // Keep rotation and scale tracks, and keep position tracks for non-root bones
    const tracksToRemove: number[] = [];

    // Common root bone names in character rigs (case-insensitive matching)
    const rootBoneNames = ['root', 'rootbone', 'root_bone', 'armature', 'hips', 'mixamorig:hips', 'pelvis'];

    for (let i = 0; i < clip.tracks.length; i++) {
      const track = clip.tracks[i];
      const trackName = track.name.toLowerCase();

      // Check if this is a position/translation track (GLTF uses "translation", Three.js uses "position")
      const isPositionTrack = trackName.includes('.position') || trackName.includes('.translation');
      if (!isPositionTrack) continue;

      // Extract the bone name from the track (format: "BoneName.position" or "BoneName.translation")
      const boneName = trackName.split('.')[0].toLowerCase();

      // Only remove if it's explicitly a root bone
      const isRootBone = rootBoneNames.some(root => boneName === root || boneName === `mixamorig:${root}`);

      if (isRootBone) {
        tracksToRemove.push(i);
      }
    }

    // Remove tracks in reverse order to maintain correct indices
    for (let i = tracksToRemove.length - 1; i >= 0; i--) {
      const removedTrack = clip.tracks.splice(tracksToRemove[i], 1)[0];
      debugAnimation.log(`[UnitRenderer] Removed root motion track: ${removedTrack.name} from ${clip.name}`);
    }
  }

  /**
   * Update animation state based on unit state
   */
  private updateAnimationState(animUnit: AnimatedUnitMesh, isMoving: boolean, isAttacking: boolean): void {
    let targetAction = 'idle';
    if (isAttacking) {
      targetAction = 'attack';
    } else if (isMoving) {
      targetAction = 'walk';
    }

    if (animUnit.currentAction !== targetAction) {
      const currentActionObj = animUnit.animations.get(animUnit.currentAction);
      const targetActionObj = animUnit.animations.get(targetAction);

      debugAnimation.log(`[UnitRenderer] Animation switch: ${animUnit.currentAction} -> ${targetAction} (isMoving=${isMoving}, isAttacking=${isAttacking})`);
      debugAnimation.log(`[UnitRenderer] Available animations:`, Array.from(animUnit.animations.keys()));

      if (targetActionObj) {
        if (currentActionObj) {
          currentActionObj.fadeOut(0.2);
        }
        targetActionObj.reset().fadeIn(0.2).play();
        animUnit.currentAction = targetAction;
      } else {
        debugAnimation.warn(`[UnitRenderer] Target animation '${targetAction}' not found!`);
      }
    }
  }

  /**
   * Get or create an instanced mesh group for a unit type + player combo
   */
  private getOrCreateInstancedGroup(unitType: string, playerId: string): InstancedUnitGroup {
    const key = `${unitType}_${playerId}`;
    let group = this.instancedGroups.get(key);

    if (!group) {
      const playerColor = getPlayerColor(playerId);

      // Get the base mesh from AssetManager
      const baseMesh = AssetManager.getUnitMesh(unitType, playerColor);

      // Update world matrices to get accurate world positions
      baseMesh.updateMatrixWorld(true);

      // Find the actual mesh geometry and material from the group
      // Also track the mesh's world Y position to use as an offset
      let geometry: THREE.BufferGeometry | null = null;
      let material: THREE.Material | THREE.Material[] | null = null;
      let meshWorldY = 0;

      baseMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && !geometry) {
          geometry = child.geometry;
          material = child.material;
          // Get the mesh's world position Y - this is lost when extracting geometry
          const worldPos = new THREE.Vector3();
          child.getWorldPosition(worldPos);
          meshWorldY = worldPos.y;
        }
      });

      if (!geometry) {
        // Fallback: create a simple box
        geometry = new THREE.BoxGeometry(0.5, 1, 0.5);
        material = new THREE.MeshStandardMaterial({ color: playerColor });
      }

      // Create instanced mesh
      const instancedMesh = new THREE.InstancedMesh(
        geometry,
        material!,
        MAX_INSTANCES_PER_TYPE
      );
      instancedMesh.count = 0; // Start with no visible instances
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.frustumCulled = false; // We'll handle culling ourselves
      // Units render AFTER ground effects (5) but BEFORE damage numbers (100)
      instancedMesh.renderOrder = 50;

      this.scene.add(instancedMesh);

      group = {
        mesh: instancedMesh,
        unitType,
        playerId,
        maxInstances: MAX_INSTANCES_PER_TYPE,
        entityIds: [],
        dummy: new THREE.Object3D(),
        yOffset: meshWorldY,
      };

      debugAssets.log(`[UnitRenderer] Created instanced group for ${unitType}: yOffset=${meshWorldY.toFixed(3)}`);

      this.instancedGroups.set(key, group);
    }

    return group;
  }

  /**
   * Get or create overlay (selection ring, health bar, team marker) for a unit
   */
  private getOrCreateOverlay(entityId: number, playerId: string): UnitOverlay {
    let overlay = this.unitOverlays.get(entityId);

    if (!overlay) {
      // Selection ring
      const selectionRing = new THREE.Mesh(this.selectionGeometry, this.selectionMaterial);
      selectionRing.rotation.x = -Math.PI / 2;
      selectionRing.visible = false;
      this.scene.add(selectionRing);

      // Health bar
      const healthBar = this.createHealthBar();
      healthBar.visible = false;
      this.scene.add(healthBar);

      // Team marker - always visible colored circle showing team color
      const teamColor = getPlayerColor(playerId);
      const teamMarkerMaterial = new THREE.MeshBasicMaterial({
        color: teamColor,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      const teamMarker = new THREE.Mesh(this.teamMarkerGeometry, teamMarkerMaterial);
      teamMarker.rotation.x = -Math.PI / 2;
      teamMarker.visible = true;
      this.scene.add(teamMarker);

      overlay = {
        selectionRing,
        healthBar,
        teamMarker,
        lastHealth: 1,
      };

      this.unitOverlays.set(entityId, overlay);
    }

    return overlay;
  }

  public update(deltaTime: number = 1/60): void {
    const updateStart = performance.now();
    const entities = this.world.getEntitiesWith('Transform', 'Unit');
    const currentIds = new Set<number>();

    // Reset instance counts for all groups
    // PERF: Use .length = 0 instead of = [] to avoid GC pressure from allocating new arrays every frame
    for (const group of this.instancedGroups.values()) {
      group.mesh.count = 0;
      group.entityIds.length = 0;
    }

    // Hide animated units that may be hidden
    for (const animUnit of this.animatedUnits.values()) {
      animUnit.mesh.visible = false;
    }

    // Build instance data
    for (const entity of entities) {
      currentIds.add(entity.id);

      const transform = entity.get<Transform>('Transform');
      const unit = entity.get<Unit>('Unit');

      // Skip entities with missing required components (defensive check)
      if (!transform || !unit) continue;

      const health = entity.get<Health>('Health');
      const selectable = entity.get<Selectable>('Selectable');
      const velocity = entity.get<Velocity>('Velocity');

      const ownerId = selectable?.playerId ?? 'unknown';
      const isSpectating = isSpectatorMode() || !this.playerId;
      const isOwned = !isSpectating && ownerId === this.playerId;
      const isEnemy = !isSpectating && selectable && ownerId !== this.playerId;

      // Check visibility for enemy units (skip in spectator mode - show all)
      let shouldShow = true;
      if (isEnemy && this.visionSystem && this.playerId) {
        shouldShow = this.visionSystem.isVisible(this.playerId, transform.x, transform.y);
      }

      // Skip dead units
      if (health && health.isDead()) {
        shouldShow = false;
      }

      if (!shouldShow) {
        // Hide overlay if exists
        const overlay = this.unitOverlays.get(entity.id);
        if (overlay) {
          overlay.selectionRing.visible = false;
          overlay.healthBar.visible = false;
          overlay.teamMarker.visible = false;
        }
        continue;
      }

      // Get terrain height
      const terrainHeight = this.terrain?.getHeightAt(transform.x, transform.y) ?? 0;

      // Check if this is an animated unit type
      if (this.isAnimatedUnitType(unit.unitId)) {
        // Use individual animated mesh
        const animUnit = this.getOrCreateAnimatedUnit(entity.id, unit.unitId, ownerId);
        animUnit.mesh.visible = true;

        // Update position and rotation
        animUnit.mesh.position.set(transform.x, terrainHeight, transform.y);
        animUnit.mesh.rotation.y = -transform.rotation + Math.PI / 2;

        // Determine animation state
        // isMoving: unit has non-zero velocity
        const isMoving = velocity ? (Math.abs(velocity.x) > 0.01 || Math.abs(velocity.y) > 0.01) : false;
        // isActuallyAttacking: unit is in attacking state AND stationary (in range, performing attack)
        // When chasing a target (moving toward it), show walk animation, not attack
        const isActuallyAttacking = unit.state === 'attacking' && !isMoving;

        // Update animation
        this.updateAnimationState(animUnit, isMoving, isActuallyAttacking);

        // Update animation mixer
        animUnit.mixer.update(deltaTime);
      } else {
        // Use instanced rendering for non-animated units
        const group = this.getOrCreateInstancedGroup(unit.unitId, ownerId);

        // Add instance if we have room
        if (group.mesh.count < group.maxInstances) {
          const instanceIndex = group.mesh.count;
          group.entityIds[instanceIndex] = entity.id;

          // Set instance transform - apply yOffset to account for model origin position
          this.tempPosition.set(transform.x, terrainHeight + group.yOffset, transform.y);
          this.tempEuler.set(0, -transform.rotation + Math.PI / 2, 0);
          this.tempQuaternion.setFromEuler(this.tempEuler);
          this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
          group.mesh.setMatrixAt(instanceIndex, this.tempMatrix);

          group.mesh.count++;
        }
      }

      // Update overlay (selection ring, health bar, team marker) for all units
      const overlay = this.getOrCreateOverlay(entity.id, ownerId);

      // Team marker - always visible colored circle beneath unit
      overlay.teamMarker.position.set(transform.x, terrainHeight + 0.02, transform.y);
      overlay.teamMarker.visible = true;

      // Selection ring
      overlay.selectionRing.position.set(transform.x, terrainHeight + 0.05, transform.y);
      overlay.selectionRing.visible = selectable?.isSelected ?? false;
      if (overlay.selectionRing.visible) {
        (overlay.selectionRing.material as THREE.MeshBasicMaterial) =
          isOwned ? this.selectionMaterial : this.enemySelectionMaterial;
      }

      // Health bar - only show if damaged
      if (health) {
        const healthPercent = health.getHealthPercent();
        overlay.healthBar.visible = healthPercent < 1;
        if (overlay.healthBar.visible) {
          overlay.healthBar.position.set(transform.x, terrainHeight + 1.5, transform.y);
          // Only update health bar visuals if health changed
          if (Math.abs(overlay.lastHealth - healthPercent) > 0.01) {
            this.updateHealthBar(overlay.healthBar, health);
            overlay.lastHealth = healthPercent;
          }
        }
      }
    }

    // Mark instance matrices as needing update
    for (const group of this.instancedGroups.values()) {
      if (group.mesh.count > 0) {
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Clean up resources for destroyed entities
    for (const [entityId, overlay] of this.unitOverlays) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(overlay.selectionRing);
        this.scene.remove(overlay.healthBar);
        this.scene.remove(overlay.teamMarker);
        overlay.selectionRing.geometry.dispose();
        (overlay.teamMarker.material as THREE.Material).dispose();
        this.disposeGroup(overlay.healthBar);
        this.unitOverlays.delete(entityId);
      }
    }

    // Clean up animated units for destroyed entities
    for (const [entityId, animUnit] of this.animatedUnits) {
      if (!currentIds.has(entityId)) {
        this.scene.remove(animUnit.mesh);
        animUnit.mixer.stopAllAction();
        this.animatedUnits.delete(entityId);
      }
    }

    const updateElapsed = performance.now() - updateStart;
    if (updateElapsed > 16) {
      debugPerformance.warn(`[UnitRenderer] UPDATE: ${entities.length} entities took ${updateElapsed.toFixed(1)}ms`);
    }
  }

  private createHealthBar(): THREE.Group {
    const group = new THREE.Group();

    // Background - use simpler geometry
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

    // Make health bar always face camera
    group.lookAt(0, 100, 0);

    return group;
  }

  private updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;

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
   */
  public refreshAllMeshes(): void {
    debugAssets.log('[UnitRenderer] Refreshing all unit meshes...');

    // Clear instanced groups
    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
      if (group.mesh.material instanceof THREE.Material) {
        group.mesh.material.dispose();
      }
    }
    this.instancedGroups.clear();

    // Clear animated units
    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      animUnit.mixer.stopAllAction();
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    // Clear overlays
    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.selectionRing);
      this.scene.remove(overlay.healthBar);
      this.scene.remove(overlay.teamMarker);
      (overlay.teamMarker.material as THREE.Material).dispose();
    }
    this.unitOverlays.clear();
  }

  /**
   * Get Three.js meshes for a list of entity IDs (for outline pass)
   */
  public getMeshesForEntities(entityIds: number[]): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];

    for (const entityId of entityIds) {
      // Check animated units first (they have individual meshes)
      const animUnit = this.animatedUnits.get(entityId);
      if (animUnit) {
        meshes.push(animUnit.mesh);
        continue;
      }

      // For instanced units, we can't outline individual instances easily
      // But we can add the overlay meshes (selection rings, team markers)
      const overlay = this.unitOverlays.get(entityId);
      if (overlay) {
        // Add team marker as a fallback for outline
        meshes.push(overlay.teamMarker);
      }
    }

    return meshes;
  }

  public dispose(): void {
    this.selectionGeometry.dispose();
    this.selectionMaterial.dispose();
    this.enemySelectionMaterial.dispose();
    this.teamMarkerGeometry.dispose();

    for (const group of this.instancedGroups.values()) {
      this.scene.remove(group.mesh);
      group.mesh.geometry.dispose();
    }
    this.instancedGroups.clear();

    for (const animUnit of this.animatedUnits.values()) {
      this.scene.remove(animUnit.mesh);
      animUnit.mixer.stopAllAction();
    }
    this.animatedUnits.clear();
    this.animatedUnitTypes.clear();

    for (const overlay of this.unitOverlays.values()) {
      this.scene.remove(overlay.selectionRing);
      this.scene.remove(overlay.healthBar);
      this.scene.remove(overlay.teamMarker);
      (overlay.teamMarker.material as THREE.Material).dispose();
      this.disposeGroup(overlay.healthBar);
    }
    this.unitOverlays.clear();
  }
}
