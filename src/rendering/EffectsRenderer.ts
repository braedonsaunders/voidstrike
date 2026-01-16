import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { AssetManager, DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';

interface AttackEffect {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  progress: number;
  duration: number;
  mesh: THREE.Mesh | THREE.Line;
  type: 'projectile' | 'laser' | 'melee';
}

interface HitEffect {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  mesh: THREE.Mesh;
}

interface DamageNumber {
  position: THREE.Vector3;
  damage: number;
  progress: number;
  duration: number;
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  targetId?: number; // PERF: Track which entity this damage number belongs to
}

interface FocusFireIndicator {
  targetId: number;
  attackerCount: number;
  mesh: THREE.Mesh;
  pulseTime: number;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  progress: number;
  duration: number;
  groundY: number; // Terrain height for ground collision
}

interface FireEffect {
  entityId: number;
  particles: THREE.Points;
  progress: number;
}

interface MoveIndicator {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  rings: THREE.Mesh[];
}

// PERFORMANCE: Object pools to avoid allocation/deallocation in hot loops
interface MeshPool {
  available: THREE.Mesh[];
  inUse: Set<THREE.Mesh>;
  maxSize: number;
}

// PERF: Increased from 50 to 100 for large battles with many simultaneous effects
const POOL_SIZE = 100;
// Note: Airborne height is now configured per-unit-type in assets.json
// Use AssetManager.getAirborneHeight(unitType) for the configured height
// DEFAULT_AIRBORNE_HEIGHT (8) is used when unit type is not available

// PERF: Reusable Vector3 objects to avoid allocation in hot paths
const tempVec3Start = new THREE.Vector3();
const tempVec3End = new THREE.Vector3();
const tempVec3Velocity = new THREE.Vector3();

// PERF: Pool of reusable Vector3 for effect storage (startPos, endPos, velocity)
const VECTOR3_POOL_SIZE = 200;
const vector3Pool: THREE.Vector3[] = [];
let vector3PoolIndex = 0;
for (let i = 0; i < VECTOR3_POOL_SIZE; i++) {
  vector3Pool.push(new THREE.Vector3());
}

function acquireVector3(x = 0, y = 0, z = 0): THREE.Vector3 {
  const vec = vector3Pool[vector3PoolIndex];
  vector3PoolIndex = (vector3PoolIndex + 1) % VECTOR3_POOL_SIZE;
  return vec.set(x, y, z);
}

export class EffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;
  private attackEffects: AttackEffect[] = [];
  private hitEffects: HitEffect[] = [];
  private damageNumbers: DamageNumber[] = [];
  private explosionParticles: ExplosionParticle[] = [];
  // PERF: Track active damage numbers per entity to consolidate multiple hits
  private activeDamageNumbers: Map<number, DamageNumber> = new Map();
  private focusFireIndicators: Map<number, FocusFireIndicator> = new Map();
  private targetAttackerCounts: Map<number, Set<number>> = new Map(); // targetId -> Set of attackerIds
  private moveIndicators: MoveIndicator[] = [];

  // PERFORMANCE: Object pools for reusable meshes
  private projectilePool: MeshPool;
  private hitEffectPool: MeshPool;
  private explosionPool: MeshPool;
  private deathEffectPool: MeshPool;

  // PERF: Pool for laser line effects
  private laserPool: {
    available: THREE.Line[];
    inUse: Set<THREE.Line>;
  };

  // PERF: Pool for building explosion shockwave rings
  private shockwavePool: MeshPool;

  // PERF: Pool for building explosion flash spheres
  private flashPool: MeshPool;

  // PERF: Pool for move indicator rings
  private moveRingPool: MeshPool;

  // Shared geometries and materials
  // Per threejs-builder skill: create geometries once, don't create in event handlers
  private projectileGeometry: THREE.SphereGeometry;
  private projectileMaterial: THREE.MeshBasicMaterial;
  private laserMaterial: THREE.LineBasicMaterial;
  private hitGeometry: THREE.RingGeometry;
  private hitMaterial: THREE.MeshBasicMaterial;
  private deathGeometry: THREE.RingGeometry;
  private deathMaterial: THREE.MeshBasicMaterial;
  private focusFireGeometry: THREE.RingGeometry;
  private focusFireMaterial: THREE.MeshBasicMaterial;
  private explosionGeometry: THREE.SphereGeometry;
  private explosionMaterial: THREE.MeshBasicMaterial;
  private damageCanvas: HTMLCanvasElement;
  private damageContext: CanvasRenderingContext2D;
  // PERF: Pool of pre-created damage number sprites to avoid texture allocation every hit
  private damageNumberPool: {
    available: Array<{ sprite: THREE.Sprite; material: THREE.SpriteMaterial; texture: THREE.CanvasTexture }>;
    inUse: Set<THREE.Sprite>;
  };
  private moveIndicatorGeometry: THREE.RingGeometry;
  private moveIndicatorMaterial: THREE.MeshBasicMaterial;

  // PERF: Shared geometries for building explosions (created once)
  private shockwaveGeometrySmall: THREE.RingGeometry;
  private shockwaveGeometryLarge: THREE.RingGeometry;
  private shockwaveMaterial: THREE.MeshBasicMaterial;
  private flashGeometrySmall: THREE.SphereGeometry;
  private flashGeometryLarge: THREE.SphereGeometry;
  private flashMaterial: THREE.MeshBasicMaterial;

  // PERF: Shared geometry for laser lines (positions updated per use)
  private laserGeometry: THREE.BufferGeometry;
  private laserPositionAttribute: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, eventBus: EventBus, getTerrainHeight?: (x: number, z: number) => number) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.getTerrainHeight = getTerrainHeight ?? null;

    // Create shared resources
    this.projectileGeometry = new THREE.SphereGeometry(0.15, 8, 8);
    this.projectileMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.9,
    });

    this.laserMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.8,
    });

    this.hitGeometry = new THREE.RingGeometry(0.2, 0.5, 16);
    this.hitMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Death effect geometry - created once, reused per threejs-builder skill
    this.deathGeometry = new THREE.RingGeometry(0.5, 1.0, 16);
    this.deathMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Focus fire indicator - pulsing ring around targets being attacked by multiple units
    this.focusFireGeometry = new THREE.RingGeometry(0.8, 1.2, 24);
    this.focusFireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Explosion debris particles
    this.explosionGeometry = new THREE.SphereGeometry(0.2, 6, 6);
    this.explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1,
    });

    // Canvas for damage numbers
    this.damageCanvas = document.createElement('canvas');
    this.damageCanvas.width = 128;
    this.damageCanvas.height = 64;
    this.damageContext = this.damageCanvas.getContext('2d')!;

    // PERF: Pre-create pool of damage number sprites to avoid allocation during combat
    this.damageNumberPool = { available: [], inUse: new Set() };
    const DAMAGE_NUMBER_POOL_SIZE = 20;
    for (let i = 0; i < DAMAGE_NUMBER_POOL_SIZE; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.5, 0.75, 1);
      sprite.renderOrder = 100;
      sprite.visible = false;
      this.scene.add(sprite);
      this.damageNumberPool.available.push({ sprite, material, texture });
    }

    // Move command indicator - green ring that shrinks
    this.moveIndicatorGeometry = new THREE.RingGeometry(0.3, 0.6, 16);
    this.moveIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    // Initialize object pools
    this.projectilePool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial.clone());
      mesh.visible = false;
      return mesh;
    });

    this.hitEffectPool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.hitGeometry, this.hitMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5; // Ground effects render BEFORE units (50) but after terrain
      return mesh;
    });

    this.explosionPool = this.createPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.explosionGeometry, this.explosionMaterial.clone());
      mesh.visible = false;
      return mesh;
    });

    // PERF: Death effect pool
    this.deathEffectPool = this.createPool(30, () => {
      const mesh = new THREE.Mesh(this.deathGeometry, this.deathMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5;
      return mesh;
    });

    // PERF: Laser line pool - pre-create Line objects with reusable geometry
    this.laserGeometry = new THREE.BufferGeometry();
    this.laserPositionAttribute = new THREE.BufferAttribute(new Float32Array(6), 3); // 2 points * 3 coords
    this.laserGeometry.setAttribute('position', this.laserPositionAttribute);

    this.laserPool = { available: [], inUse: new Set() };
    const LASER_POOL_SIZE = 50;
    for (let i = 0; i < LASER_POOL_SIZE; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(6);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, this.laserMaterial.clone());
      line.visible = false;
      this.scene.add(line);
      this.laserPool.available.push(line);
    }

    // PERF: Shockwave and flash geometries/materials for building explosions
    this.shockwaveGeometrySmall = new THREE.RingGeometry(0.5, 2.5, 24);
    this.shockwaveGeometryLarge = new THREE.RingGeometry(0.5, 4, 24);
    this.shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    this.flashGeometrySmall = new THREE.SphereGeometry(1.25, 12, 12);
    this.flashGeometryLarge = new THREE.SphereGeometry(2, 12, 12);
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff88,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });

    // PERF: Shockwave pool
    this.shockwavePool = this.createPool(20, () => {
      const mesh = new THREE.Mesh(this.shockwaveGeometrySmall, this.shockwaveMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5;
      return mesh;
    });

    // PERF: Flash pool
    this.flashPool = this.createPool(20, () => {
      const mesh = new THREE.Mesh(this.flashGeometrySmall, this.flashMaterial.clone());
      mesh.visible = false;
      mesh.renderOrder = 6;
      return mesh;
    });

    // PERF: Move indicator ring pool
    this.moveRingPool = this.createPool(30, () => {
      const mesh = new THREE.Mesh(this.moveIndicatorGeometry, this.moveIndicatorMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5;
      return mesh;
    });

    this.setupEventListeners();
  }

  /**
   * Set the terrain height function for proper effect positioning on elevated terrain
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Get terrain height at a position, with fallback to 0
   */
  private getHeightAt(x: number, z: number): number {
    return this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0;
  }

  /**
   * Create an object pool with pre-allocated meshes
   */
  private createPool(size: number, factory: () => THREE.Mesh): MeshPool {
    const pool: MeshPool = {
      available: [],
      inUse: new Set(),
      maxSize: size,
    };

    for (let i = 0; i < size; i++) {
      const mesh = factory();
      this.scene.add(mesh);
      pool.available.push(mesh);
    }

    return pool;
  }

  /**
   * Acquire a mesh from the pool
   */
  private acquireFromPool(pool: MeshPool, factory?: () => THREE.Mesh): THREE.Mesh | null {
    if (pool.available.length > 0) {
      const mesh = pool.available.pop()!;
      pool.inUse.add(mesh);
      mesh.visible = true;
      return mesh;
    }

    // Pool exhausted - create new if factory provided and under max
    if (factory && pool.inUse.size < pool.maxSize * 2) {
      const mesh = factory();
      this.scene.add(mesh);
      pool.inUse.add(mesh);
      mesh.visible = true;
      return mesh;
    }

    return null;
  }

  /**
   * Release a mesh back to the pool
   */
  private releaseToPool(pool: MeshPool, mesh: THREE.Mesh): void {
    if (pool.inUse.has(mesh)) {
      pool.inUse.delete(mesh);
      mesh.visible = false;
      mesh.scale.set(1, 1, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      if (pool.available.length < pool.maxSize) {
        pool.available.push(mesh);
      }
    }
  }

  /**
   * Dispose all meshes in a pool
   */
  private disposePool(pool: MeshPool): void {
    for (const mesh of pool.available) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    for (const mesh of pool.inUse) {
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    pool.available = [];
    pool.inUse.clear();
  }

  private setupEventListeners(): void {
    this.eventBus.on('combat:attack', (data: {
      attackerId?: string; // Unit type ID for attacker (e.g., "valkyrie") - for airborne height lookup
      attackerEntityId?: number; // Entity ID for focus fire tracking
      targetId?: number; // Entity ID for focus fire tracking
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      targetUnitType?: string; // Unit type ID for target - for airborne height lookup
      damage: number;
      damageType: string;
      targetHeight?: number;
      attackerIsFlying?: boolean;
      targetIsFlying?: boolean;
    }) => {
      if (data.attackerPos && data.targetPos) {
        // Get terrain height at attacker and target positions
        const attackerTerrainHeight = this.getHeightAt(data.attackerPos.x, data.attackerPos.y);
        const targetTerrainHeight = this.getHeightAt(data.targetPos.x, data.targetPos.y);

        // Add flying offset for air units (per-unit-type airborne height from assets.json)
        const attackerAirborneHeight = data.attackerId ? AssetManager.getAirborneHeight(data.attackerId) : DEFAULT_AIRBORNE_HEIGHT;
        const targetAirborneHeight = data.targetUnitType ? AssetManager.getAirborneHeight(data.targetUnitType) : DEFAULT_AIRBORNE_HEIGHT;
        const attackerFlyingOffset = data.attackerIsFlying ? attackerAirborneHeight : 0;
        const targetFlyingOffset = data.targetIsFlying ? targetAirborneHeight : 0;

        // PERF: Use temp vectors to avoid allocation, they get cloned in createAttackEffect
        tempVec3Start.set(data.attackerPos.x, attackerTerrainHeight + 0.5 + attackerFlyingOffset, data.attackerPos.y);
        tempVec3End.set(data.targetPos.x, targetTerrainHeight + 0.5 + targetFlyingOffset, data.targetPos.y);
        this.createAttackEffect(tempVec3Start, tempVec3End, data.damageType);

        // Create floating damage number ABOVE the target
        // Use targetHeight for buildings, default 2.5 for units (relative to terrain), add flying offset for air units
        const damageNumberY = targetTerrainHeight + targetFlyingOffset + ((data.targetHeight && data.targetHeight > 0) ? data.targetHeight + 1.5 : 2.5);
        // PERF: Pass targetId to consolidate multiple hits on same target into one number
        this.createDamageNumber(
          new THREE.Vector3(data.targetPos.x, damageNumberY, data.targetPos.y),
          data.damage,
          data.targetId
        );

        // Track focus fire - multiple attackers on same target (using entity IDs)
        if (data.attackerEntityId !== undefined && data.targetId !== undefined) {
          this.trackFocusFire(data.attackerEntityId, data.targetId, data.targetPos);
        }
      }
    });

    this.eventBus.on('unit:died', (data: {
      entityId?: number;
      position?: { x: number; y: number };
    }) => {
      if (data.position) {
        const terrainHeight = this.getHeightAt(data.position.x, data.position.y);
        this.createDeathEffect(new THREE.Vector3(data.position.x, terrainHeight + 0.1, data.position.y));
      }
      // Clear focus fire tracking for dead unit
      if (data.entityId !== undefined) {
        this.clearFocusFire(data.entityId);
      }
    });

    // Clear attacker from focus fire when they die or stop attacking
    this.eventBus.on('unit:stopAttack', (data: { attackerId?: number; targetId?: number }) => {
      if (data.attackerId !== undefined && data.targetId !== undefined) {
        this.removeAttackerFromTarget(data.attackerId, data.targetId);
      }
    });

    // Building destroyed - create big explosion
    this.eventBus.on('building:destroyed', (data: {
      entityId: number;
      playerId: string;
      buildingType: string;
      position: { x: number; y: number };
    }) => {
      const terrainHeight = this.getHeightAt(data.position.x, data.position.y);
      this.createBuildingExplosion(
        new THREE.Vector3(data.position.x, terrainHeight, data.position.y),
        data.buildingType
      );
      // Clear any focus fire on this building
      this.clearFocusFire(data.entityId);
    });

    // Move command - show indicator on ground (only for local player's commands)
    this.eventBus.on('command:move', (data: {
      entityIds: number[];
      targetPosition?: { x: number; y: number };
      playerId?: string;
    }) => {
      // Only show move indicator for local player (or all players if spectating)
      const localPlayerId = getLocalPlayerId();
      const spectating = isSpectatorMode();
      if (!spectating && data.playerId && data.playerId !== localPlayerId) {
        return; // Don't show indicator for other players' commands
      }

      if (data.entityIds.length > 0 && data.targetPosition) {
        const terrainHeight = this.getHeightAt(data.targetPosition.x, data.targetPosition.y);
        this.createMoveIndicator(
          new THREE.Vector3(data.targetPosition.x, terrainHeight + 0.15, data.targetPosition.y)
        );
      }
    });
  }

  public createAttackEffect(
    start: THREE.Vector3,
    end: THREE.Vector3,
    damageType: string
  ): void {
    if (damageType === 'psionic') {
      this.createLaserEffect(start, end);
    } else {
      this.createProjectileEffect(start, end);
    }
  }

  private createProjectileEffect(start: THREE.Vector3, end: THREE.Vector3): void {
    // PERFORMANCE: Use object pool instead of creating new mesh
    const mesh = this.acquireFromPool(this.projectilePool, () => {
      const m = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial.clone());
      return m;
    });

    if (!mesh) return; // Pool exhausted

    mesh.position.copy(start);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;

    // PERF: Use pooled Vector3 instead of clone()
    this.attackEffects.push({
      startPos: acquireVector3(start.x, start.y, start.z),
      endPos: acquireVector3(end.x, end.y, end.z),
      progress: 0,
      duration: 0.2, // 200ms travel time
      mesh,
      type: 'projectile',
    });
  }

  private createLaserEffect(start: THREE.Vector3, end: THREE.Vector3): void {
    // PERF: Use laser pool instead of creating new geometry/material
    let line: THREE.Line;
    if (this.laserPool.available.length > 0) {
      line = this.laserPool.available.pop()!;
      this.laserPool.inUse.add(line);
      // Update geometry positions
      const positions = (line.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
      positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
      (line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      line.geometry.computeBoundingSphere();
      (line.material as THREE.LineBasicMaterial).opacity = 0.8;
      line.visible = true;
    } else {
      // Pool exhausted - create new (should be rare)
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      line = new THREE.Line(geometry, this.laserMaterial.clone());
      this.scene.add(line);
      this.laserPool.inUse.add(line);
    }

    // PERF: Use pooled Vector3 instead of clone()
    this.attackEffects.push({
      startPos: acquireVector3(start.x, start.y, start.z),
      endPos: acquireVector3(end.x, end.y, end.z),
      progress: 0,
      duration: 0.1, // 100ms flash
      mesh: line,
      type: 'laser',
    });

    // Also create hit effect at end
    this.createHitEffect(end);
    // Emit combat:hit event for sound effects (laser hits instantly)
    this.eventBus.emit('combat:hit', {
      position: { x: end.x, y: end.z },
    });
  }

  private createHitEffect(position: THREE.Vector3): void {
    // PERFORMANCE: Use object pool instead of creating new mesh
    const mesh = this.acquireFromPool(this.hitEffectPool, () => {
      const m = new THREE.Mesh(this.hitGeometry, this.hitMaterial.clone());
      m.rotation.x = -Math.PI / 2;
      return m;
    });

    if (!mesh) return; // Pool exhausted

    mesh.position.copy(position);
    // Keep the Y position from the input (already includes terrain height + offset)
    // Just add small offset to prevent z-fighting with ground
    mesh.position.y = position.y + 0.1;
    mesh.scale.set(1, 1, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;

    // PERF: Use pooled Vector3 instead of clone()
    this.hitEffects.push({
      position: acquireVector3(position.x, position.y, position.z),
      progress: 0,
      duration: 0.3,
      mesh,
    });
  }

  private createDeathEffect(position: THREE.Vector3): void {
    // PERF: Use death effect pool instead of creating new mesh
    const mesh = this.acquireFromPool(this.deathEffectPool, () => {
      const m = new THREE.Mesh(this.deathGeometry, this.deathMaterial.clone());
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 5;
      return m;
    });

    if (!mesh) return; // Pool exhausted

    mesh.position.copy(position);
    mesh.scale.set(1, 1, 1);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 1;

    // PERF: Use pooled Vector3 instead of clone()
    this.hitEffects.push({
      position: acquireVector3(position.x, position.y, position.z),
      progress: 0,
      duration: 0.5,
      mesh,
    });
  }

  /**
   * Create a large explosion effect for building destruction
   * Multiple debris particles + expanding ring + flash
   */
  private createBuildingExplosion(position: THREE.Vector3, buildingType: string): void {
    // Determine explosion size based on building type
    const isLargeBuilding = ['headquarters', 'infantry_bay', 'forge', 'hangar'].includes(buildingType);
    const particleCount = isLargeBuilding ? 20 : 12;

    // Create debris particles flying outward - use pool when possible
    for (let i = 0; i < particleCount; i++) {
      // PERFORMANCE: Try to acquire from pool first
      let mesh = this.acquireFromPool(this.explosionPool);

      if (!mesh) {
        // Pool exhausted - create new
        const material = this.explosionMaterial.clone();
        mesh = new THREE.Mesh(this.explosionGeometry, material);
        this.scene.add(mesh);
      }

      // Vary colors between orange, red, and yellow
      const colorChoice = Math.random();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (colorChoice < 0.33) {
        mat.color.setHex(0xff6600); // Orange
      } else if (colorChoice < 0.66) {
        mat.color.setHex(0xff2200); // Red-orange
      } else {
        mat.color.setHex(0xffaa00); // Yellow-orange
      }
      mat.opacity = 1;

      mesh.position.copy(position);
      // Start debris at terrain height + random offset for natural look
      mesh.position.y = position.y + 0.5 + Math.random() * 1.5;
      mesh.scale.setScalar(0.3 + Math.random() * 0.5);

      // Random outward velocity
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      const upSpeed = 2 + Math.random() * 4;

      // PERF: Use pooled Vector3 for velocity
      this.explosionParticles.push({
        mesh,
        velocity: acquireVector3(
          Math.cos(angle) * speed,
          upSpeed,
          Math.sin(angle) * speed
        ),
        progress: 0,
        duration: 0.8 + Math.random() * 0.4,
        groundY: position.y, // Store terrain height for ground collision
      });
    }

    // PERF: Use shockwave pool instead of creating new geometry/material
    const ringMesh = this.acquireFromPool(this.shockwavePool, () => {
      const m = new THREE.Mesh(this.shockwaveGeometrySmall, this.shockwaveMaterial.clone());
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 5;
      return m;
    });

    if (ringMesh) {
      // Use appropriate geometry based on building size
      ringMesh.geometry = isLargeBuilding ? this.shockwaveGeometryLarge : this.shockwaveGeometrySmall;
      ringMesh.position.copy(position);
      ringMesh.position.y = position.y + 0.1;
      ringMesh.scale.set(1, 1, 1);
      (ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.8;

      // PERF: Use pooled Vector3
      this.hitEffects.push({
        position: acquireVector3(position.x, position.y, position.z),
        progress: 0,
        duration: 0.6,
        mesh: ringMesh,
      });
    }

    // PERF: Use flash pool instead of creating new geometry/material
    const flashMesh = this.acquireFromPool(this.flashPool, () => {
      const m = new THREE.Mesh(this.flashGeometrySmall, this.flashMaterial.clone());
      m.renderOrder = 6;
      return m;
    });

    if (flashMesh) {
      // Use appropriate geometry based on building size
      flashMesh.geometry = isLargeBuilding ? this.flashGeometryLarge : this.flashGeometrySmall;
      flashMesh.position.copy(position);
      flashMesh.position.y = position.y + 1;
      flashMesh.scale.set(1, 1, 1);
      (flashMesh.material as THREE.MeshBasicMaterial).opacity = 1;

      // PERF: Use pooled Vector3
      this.hitEffects.push({
        position: acquireVector3(position.x, position.y, position.z),
        progress: 0,
        duration: 0.3,
        mesh: flashMesh,
      });
    }
  }

  private createDamageNumber(position: THREE.Vector3, damage: number, targetId?: number): void {
    // PERF: If we have an active damage number for this target, update it instead of creating new one
    if (targetId !== undefined) {
      const existing = this.activeDamageNumbers.get(targetId);
      if (existing && existing.progress < 0.5) {
        // Update existing damage number - add to accumulated damage
        existing.damage += damage;
        existing.progress = 0; // Reset timer to keep it visible longer
        existing.position.copy(position); // Update position in case target moved
        existing.sprite.position.copy(position);

        // Update the sprite texture with new accumulated damage
        this.updateDamageNumberTexture(existing.sprite, existing.damage);

        // "Pop" effect - briefly scale up to indicate new damage added
        existing.sprite.scale.set(1.8, 0.9, 1);

        return;
      }
    }

    // PERF: Try to get sprite from pool instead of creating new texture
    let sprite: THREE.Sprite;
    let poolItem: { sprite: THREE.Sprite; material: THREE.SpriteMaterial; texture: THREE.CanvasTexture } | null = null;

    if (this.damageNumberPool.available.length > 0) {
      // Reuse pooled sprite
      poolItem = this.damageNumberPool.available.pop()!;
      sprite = poolItem.sprite;
      this.damageNumberPool.inUse.add(sprite);

      // Draw damage text to the pooled sprite's canvas
      const canvas = poolItem.texture.source.data as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 128, 64);
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeText(Math.round(damage).toString(), 64, 32);
      ctx.fillStyle = '#ffff00';
      ctx.fillText(Math.round(damage).toString(), 64, 32);
      poolItem.texture.needsUpdate = true;

      sprite.position.copy(position);
      sprite.visible = true;
      poolItem.material.opacity = 1;
    } else {
      // Pool exhausted - limit max active damage numbers
      const MAX_DAMAGE_NUMBERS = 15;
      if (this.damageNumbers.length >= MAX_DAMAGE_NUMBERS) {
        // Recycle oldest damage number
        const oldest = this.damageNumbers.shift();
        if (oldest) {
          // Return to pool if it was from pool, otherwise just hide
          oldest.sprite.visible = false;
          this.damageNumberPool.inUse.delete(oldest.sprite);
          // Clean up from active tracking
          if (oldest.targetId !== undefined) {
            this.activeDamageNumbers.delete(oldest.targetId);
          }
        }
        return; // Skip creating this damage number
      }

      // Fallback: create new sprite (should rarely happen with pool size 20)
      this.damageContext.clearRect(0, 0, 128, 64);
      this.damageContext.font = 'bold 32px Arial';
      this.damageContext.textAlign = 'center';
      this.damageContext.textBaseline = 'middle';
      this.damageContext.strokeStyle = '#000000';
      this.damageContext.lineWidth = 4;
      this.damageContext.strokeText(Math.round(damage).toString(), 64, 32);
      this.damageContext.fillStyle = '#ffff00';
      this.damageContext.fillText(Math.round(damage).toString(), 64, 32);

      const texture = new THREE.CanvasTexture(this.damageCanvas);
      texture.needsUpdate = true;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });

      sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.set(1.5, 0.75, 1);
      sprite.renderOrder = 100;
      this.scene.add(sprite);
    }

    // PERF: Use pooled Vector3s instead of clone/new
    const damageNumber: DamageNumber = {
      position: acquireVector3(position.x, position.y, position.z),
      damage,
      progress: 0,
      duration: 0.7,
      sprite,
      velocity: acquireVector3(
        (Math.random() - 0.5) * 0.5,
        2.0,
        (Math.random() - 0.5) * 0.5
      ),
      targetId,
    };

    this.damageNumbers.push(damageNumber);

    // Track active damage number for this target
    if (targetId !== undefined) {
      this.activeDamageNumbers.set(targetId, damageNumber);
    }
  }

  /**
   * PERF: Update damage number texture without creating new sprite
   */
  private updateDamageNumberTexture(sprite: THREE.Sprite, damage: number): void {
    const material = sprite.material as THREE.SpriteMaterial;
    const texture = material.map as THREE.CanvasTexture;
    if (!texture) return;

    const canvas = texture.source.data as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 128, 64);
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(Math.round(damage).toString(), 64, 32);
    // Use orange for accumulated damage to distinguish from single hits
    ctx.fillStyle = '#ff8800';
    ctx.fillText(Math.round(damage).toString(), 64, 32);
    texture.needsUpdate = true;
  }

  /**
   * Create an animated move indicator on the ground
   * Shows 3 concentric rings that shrink and fade
   */
  private createMoveIndicator(position: THREE.Vector3): void {
    const rings: THREE.Mesh[] = [];

    // PERF: Use ring pool instead of creating new geometry/material each time
    for (let i = 0; i < 3; i++) {
      const ring = this.acquireFromPool(this.moveRingPool, () => {
        const m = new THREE.Mesh(this.moveIndicatorGeometry, this.moveIndicatorMaterial.clone());
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 5;
        return m;
      });

      if (ring) {
        ring.position.copy(position);
        // Scale to create concentric rings effect
        const baseScale = 1 + i * 0.8;
        ring.scale.set(baseScale, baseScale, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 - i * 0.2;
        rings.push(ring);
      }
    }

    if (rings.length > 0) {
      // PERF: Use pooled Vector3
      this.moveIndicators.push({
        position: acquireVector3(position.x, position.y, position.z),
        progress: 0,
        duration: 0.5, // Fast animation
        rings,
      });
    }
  }

  private trackFocusFire(attackerId: number, targetId: number, targetPos: { x: number; y: number }): void {
    // Get or create the set of attackers for this target
    let attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) {
      attackers = new Set();
      this.targetAttackerCounts.set(targetId, attackers);
    }

    // Add this attacker
    attackers.add(attackerId);

    // Get terrain height at target position
    const terrainHeight = this.getHeightAt(targetPos.x, targetPos.y);

    // If 2+ attackers, show/update focus fire indicator
    if (attackers.size >= 2) {
      let indicator = this.focusFireIndicators.get(targetId);

      if (!indicator) {
        // Create new indicator
        const mesh = new THREE.Mesh(this.focusFireGeometry, this.focusFireMaterial.clone());
        mesh.position.set(targetPos.x, terrainHeight + 0.15, targetPos.y);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = 5; // Ground effects render BEFORE units
        this.scene.add(mesh);

        indicator = {
          targetId,
          attackerCount: attackers.size,
          mesh,
          pulseTime: 0,
        };
        this.focusFireIndicators.set(targetId, indicator);
      } else {
        // Update existing indicator position
        indicator.mesh.position.set(targetPos.x, terrainHeight + 0.15, targetPos.y);
        indicator.attackerCount = attackers.size;
      }
    }
  }

  private clearFocusFire(targetId: number): void {
    // Remove indicator
    const indicator = this.focusFireIndicators.get(targetId);
    if (indicator) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
      this.focusFireIndicators.delete(targetId);
    }

    // Clear attacker tracking
    this.targetAttackerCounts.delete(targetId);
  }

  private removeAttackerFromTarget(attackerId: number, targetId: number): void {
    const attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) return;

    attackers.delete(attackerId);

    // If less than 2 attackers, remove indicator
    if (attackers.size < 2) {
      const indicator = this.focusFireIndicators.get(targetId);
      if (indicator) {
        this.scene.remove(indicator.mesh);
        (indicator.mesh.material as THREE.Material).dispose();
        this.focusFireIndicators.delete(targetId);
      }
    }

    // Clean up empty sets
    if (attackers.size === 0) {
      this.targetAttackerCounts.delete(targetId);
    }
  }

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    // Update attack effects
    for (let i = this.attackEffects.length - 1; i >= 0; i--) {
      const effect = this.attackEffects[i];
      effect.progress += dt / effect.duration;

      if (effect.progress >= 1) {
        // Effect complete - return to pool or dispose
        if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
          this.releaseToPool(this.projectilePool, effect.mesh);
          // Create hit effect for projectiles
          this.createHitEffect(effect.endPos);
          // Emit combat:hit event for sound effects
          this.eventBus.emit('combat:hit', {
            position: { x: effect.endPos.x, y: effect.endPos.z },
          });
        } else if (effect.type === 'laser' && effect.mesh instanceof THREE.Line) {
          // PERF: Return laser to pool instead of disposing
          if (this.laserPool.inUse.has(effect.mesh)) {
            this.laserPool.inUse.delete(effect.mesh);
            effect.mesh.visible = false;
            this.laserPool.available.push(effect.mesh);
          } else {
            // Non-pooled laser - dispose
            this.scene.remove(effect.mesh);
            effect.mesh.geometry.dispose();
            (effect.mesh.material as THREE.Material).dispose();
          }
        }

        this.attackEffects.splice(i, 1);
      } else {
        // Update position for projectiles
        if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
          effect.mesh.position.lerpVectors(
            effect.startPos,
            effect.endPos,
            effect.progress
          );
        } else if (effect.type === 'laser' && effect.mesh instanceof THREE.Line) {
          // Fade out laser
          const material = effect.mesh.material as THREE.LineBasicMaterial;
          material.opacity = 1 - effect.progress;
        }
      }
    }

    // Update hit effects
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const effect = this.hitEffects[i];
      effect.progress += dt / effect.duration;

      if (effect.progress >= 1) {
        // Effect complete - return to pool if it's a pooled mesh
        // PERF: Check all the pools that hit effects can come from
        if (this.hitEffectPool.inUse.has(effect.mesh)) {
          this.releaseToPool(this.hitEffectPool, effect.mesh);
        } else if (this.deathEffectPool.inUse.has(effect.mesh)) {
          this.releaseToPool(this.deathEffectPool, effect.mesh);
        } else if (this.shockwavePool.inUse.has(effect.mesh)) {
          this.releaseToPool(this.shockwavePool, effect.mesh);
        } else if (this.flashPool.inUse.has(effect.mesh)) {
          this.releaseToPool(this.flashPool, effect.mesh);
        } else {
          // Non-pooled mesh - dispose
          this.scene.remove(effect.mesh);
          if (effect.mesh.geometry) effect.mesh.geometry.dispose();
          (effect.mesh.material as THREE.Material).dispose();
        }
        this.hitEffects.splice(i, 1);
      } else {
        // Expand and fade
        const scale = 1 + effect.progress * 2;
        effect.mesh.scale.set(scale, scale, 1);
        (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - effect.progress;
      }
    }

    // Update explosion particles (debris flying outward with gravity)
    const gravity = -15;
    for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
      const particle = this.explosionParticles[i];
      particle.progress += dt / particle.duration;

      if (particle.progress >= 1) {
        // Particle expired - return to pool if possible
        if (this.explosionPool.inUse.has(particle.mesh)) {
          this.releaseToPool(this.explosionPool, particle.mesh);
        } else {
          this.scene.remove(particle.mesh);
          (particle.mesh.material as THREE.Material).dispose();
        }
        this.explosionParticles.splice(i, 1);
      } else {
        // Apply velocity and gravity
        particle.velocity.y += gravity * dt;
        particle.mesh.position.x += particle.velocity.x * dt;
        particle.mesh.position.y += particle.velocity.y * dt;
        particle.mesh.position.z += particle.velocity.z * dt;

        // Don't let particles go below terrain ground level
        const groundLevel = particle.groundY + 0.1;
        if (particle.mesh.position.y < groundLevel) {
          particle.mesh.position.y = groundLevel;
          particle.velocity.y = 0;
          particle.velocity.x *= 0.5; // Friction
          particle.velocity.z *= 0.5;
        }

        // Fade out in second half and shrink
        if (particle.progress > 0.5) {
          const fadeProgress = (particle.progress - 0.5) * 2;
          (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
          const shrink = 1 - fadeProgress * 0.5;
          particle.mesh.scale.setScalar(shrink * (0.3 + Math.random() * 0.2));
        }
      }
    }

    // Update damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dmgNum = this.damageNumbers[i];
      dmgNum.progress += dt / dmgNum.duration;

      if (dmgNum.progress >= 1) {
        // PERF: Return sprite to pool instead of disposing
        dmgNum.sprite.visible = false;
        if (this.damageNumberPool.inUse.has(dmgNum.sprite)) {
          this.damageNumberPool.inUse.delete(dmgNum.sprite);
          // Find the pool item and return it
          const material = dmgNum.sprite.material as THREE.SpriteMaterial;
          const texture = material.map as THREE.CanvasTexture;
          this.damageNumberPool.available.push({ sprite: dmgNum.sprite, material, texture });
        } else {
          // Not from pool - dispose it
          this.scene.remove(dmgNum.sprite);
          (dmgNum.sprite.material as THREE.SpriteMaterial).map?.dispose();
          (dmgNum.sprite.material as THREE.SpriteMaterial).dispose();
        }
        // PERF: Clean up from active tracking
        if (dmgNum.targetId !== undefined) {
          this.activeDamageNumbers.delete(dmgNum.targetId);
        }
        this.damageNumbers.splice(i, 1);
      } else {
        // Float upward with deceleration and fade out
        const decel = 1 - dmgNum.progress * 0.8;
        dmgNum.sprite.position.x += dmgNum.velocity.x * dt * decel;
        dmgNum.sprite.position.y += dmgNum.velocity.y * dt * decel;
        dmgNum.sprite.position.z += dmgNum.velocity.z * dt * decel;

        // Fade out in second half
        if (dmgNum.progress > 0.5) {
          const fadeProgress = (dmgNum.progress - 0.5) * 2;
          (dmgNum.sprite.material as THREE.SpriteMaterial).opacity = 1 - fadeProgress;
        }

        // Scale up slightly as it rises (with smooth return from pop effect)
        const baseScale = 1 + dmgNum.progress * 0.3;
        const currentScale = dmgNum.sprite.scale.x / 1.5;
        const targetScale = baseScale;
        // Smoothly interpolate from pop scale back to normal
        const smoothScale = currentScale + (targetScale - currentScale) * Math.min(dt * 8, 1);
        dmgNum.sprite.scale.set(1.5 * smoothScale, 0.75 * smoothScale, 1);
      }
    }

    // Update focus fire indicators (pulsing effect)
    for (const indicator of this.focusFireIndicators.values()) {
      indicator.pulseTime += dt * 4; // Pulse speed
      const pulse = 0.8 + Math.sin(indicator.pulseTime) * 0.2;
      indicator.mesh.scale.set(pulse, pulse, 1);

      // Intensity based on attacker count (more attackers = more opaque)
      const baseOpacity = Math.min(0.4 + indicator.attackerCount * 0.15, 0.9);
      (indicator.mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity * pulse;
    }

    // Update move indicators (shrinking rings)
    for (let i = this.moveIndicators.length - 1; i >= 0; i--) {
      const indicator = this.moveIndicators[i];
      indicator.progress += dt / indicator.duration;

      if (indicator.progress >= 1) {
        // PERF: Return rings to pool instead of disposing
        for (const ring of indicator.rings) {
          if (this.moveRingPool.inUse.has(ring)) {
            this.releaseToPool(this.moveRingPool, ring);
          } else {
            // Non-pooled ring - dispose
            this.scene.remove(ring);
            ring.geometry.dispose();
            (ring.material as THREE.Material).dispose();
          }
        }
        this.moveIndicators.splice(i, 1);
      } else {
        // Shrink and fade rings
        for (let j = 0; j < indicator.rings.length; j++) {
          const ring = indicator.rings[j];
          const baseScale = 1 + j * 0.8; // Match the scale set in createMoveIndicator
          const shrink = 1 - indicator.progress * 0.5;
          ring.scale.set(baseScale * shrink, baseScale * shrink, 1);
          const baseOpacity = 0.9 - j * 0.2;
          (ring.material as THREE.MeshBasicMaterial).opacity = baseOpacity * (1 - indicator.progress);
        }
      }
    }
  }

  /**
   * PERF: Debug method to get effect counts for leak detection
   */
  public getDebugStats(): {
    attackEffects: number;
    hitEffects: number;
    damageNumbers: number;
    explosionParticles: number;
    moveIndicators: number;
    focusFireIndicators: number;
    poolStats: { projectile: { available: number; inUse: number }; hitEffect: { available: number; inUse: number }; explosion: { available: number; inUse: number } };
  } {
    return {
      attackEffects: this.attackEffects.length,
      hitEffects: this.hitEffects.length,
      damageNumbers: this.damageNumbers.length,
      explosionParticles: this.explosionParticles.length,
      moveIndicators: this.moveIndicators.length,
      focusFireIndicators: this.focusFireIndicators.size,
      poolStats: {
        projectile: { available: this.projectilePool.available.length, inUse: this.projectilePool.inUse.size },
        hitEffect: { available: this.hitEffectPool.available.length, inUse: this.hitEffectPool.inUse.size },
        explosion: { available: this.explosionPool.available.length, inUse: this.explosionPool.inUse.size },
      },
    };
  }

  public dispose(): void {
    // Clean up all effects - release pooled meshes first
    for (const effect of this.attackEffects) {
      if (effect.type === 'projectile' && effect.mesh instanceof THREE.Mesh) {
        this.releaseToPool(this.projectilePool, effect.mesh);
      } else if (effect.type === 'laser' && effect.mesh instanceof THREE.Line) {
        // PERF: Release laser to pool
        if (this.laserPool.inUse.has(effect.mesh)) {
          this.laserPool.inUse.delete(effect.mesh);
          effect.mesh.visible = false;
          this.laserPool.available.push(effect.mesh);
        }
      } else {
        this.scene.remove(effect.mesh);
        if (effect.mesh instanceof THREE.Mesh) {
          (effect.mesh.material as THREE.Material).dispose();
        }
      }
    }
    for (const effect of this.hitEffects) {
      // PERF: Check all pools
      if (this.hitEffectPool.inUse.has(effect.mesh)) {
        this.releaseToPool(this.hitEffectPool, effect.mesh);
      } else if (this.deathEffectPool.inUse.has(effect.mesh)) {
        this.releaseToPool(this.deathEffectPool, effect.mesh);
      } else if (this.shockwavePool.inUse.has(effect.mesh)) {
        this.releaseToPool(this.shockwavePool, effect.mesh);
      } else if (this.flashPool.inUse.has(effect.mesh)) {
        this.releaseToPool(this.flashPool, effect.mesh);
      } else {
        this.scene.remove(effect.mesh);
        if (effect.mesh.geometry) effect.mesh.geometry.dispose();
        (effect.mesh.material as THREE.Material).dispose();
      }
    }

    // Clean up explosion particles
    for (const particle of this.explosionParticles) {
      if (this.explosionPool.inUse.has(particle.mesh)) {
        this.releaseToPool(this.explosionPool, particle.mesh);
      } else {
        this.scene.remove(particle.mesh);
        (particle.mesh.material as THREE.Material).dispose();
      }
    }

    // Dispose all pooled meshes
    this.disposePool(this.projectilePool);
    this.disposePool(this.hitEffectPool);
    this.disposePool(this.explosionPool);
    this.disposePool(this.deathEffectPool);
    this.disposePool(this.shockwavePool);
    this.disposePool(this.flashPool);
    this.disposePool(this.moveRingPool);

    // Dispose laser pool
    for (const line of this.laserPool.available) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    for (const line of this.laserPool.inUse) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.laserPool.available = [];
    this.laserPool.inUse.clear();

    // Clean up damage numbers
    for (const dmgNum of this.damageNumbers) {
      this.scene.remove(dmgNum.sprite);
      (dmgNum.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (dmgNum.sprite.material as THREE.SpriteMaterial).dispose();
    }

    // Clean up focus fire indicators
    for (const indicator of this.focusFireIndicators.values()) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
    }

    // Clean up move indicators - release to pool
    for (const indicator of this.moveIndicators) {
      for (const ring of indicator.rings) {
        if (this.moveRingPool.inUse.has(ring)) {
          this.releaseToPool(this.moveRingPool, ring);
        } else {
          this.scene.remove(ring);
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
      }
    }

    // Dispose shared resources
    this.projectileGeometry.dispose();
    this.projectileMaterial.dispose();
    this.laserMaterial.dispose();
    this.laserGeometry.dispose();
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.deathGeometry.dispose();
    this.deathMaterial.dispose();
    this.focusFireGeometry.dispose();
    this.focusFireMaterial.dispose();
    this.explosionGeometry.dispose();
    this.explosionMaterial.dispose();
    this.moveIndicatorGeometry.dispose();
    this.moveIndicatorMaterial.dispose();
    // Dispose new shared geometries/materials
    this.shockwaveGeometrySmall.dispose();
    this.shockwaveGeometryLarge.dispose();
    this.shockwaveMaterial.dispose();
    this.flashGeometrySmall.dispose();
    this.flashGeometryLarge.dispose();
    this.flashMaterial.dispose();

    this.attackEffects = [];
    this.hitEffects = [];
    this.explosionParticles = [];
    this.damageNumbers = [];
    this.activeDamageNumbers.clear();
    this.focusFireIndicators.clear();
    this.targetAttackerCounts.clear();
    this.moveIndicators = [];
  }
}
