/**
 * BattleEffectsRenderer - Combat Visual Effects
 *
 * Combat effects system featuring:
 * - Proper depth-tested ground effects (occluded by units correctly)
 * - Flying unit effect positioning at correct heights
 * - Projectile trails with faction-specific styles
 * - Multi-layer explosion system
 * - Impact decals and persistent scorch marks
 * - Advanced particle integration
 *
 * RENDER ORDER ARCHITECTURE:
 * ========================
 * 0-9:     Terrain
 * 10-19:   Ground decals (scorch marks, impact craters)
 * 20-29:   Ground effects (hit rings, shockwaves) - depthTest:true
 * 30-39:   Ground unit shadows
 * 40-59:   Ground units
 * 60-69:   Projectiles and trails
 * 70-79:   Air units
 * 80-89:   Air unit effects
 * 90-99:   Additive glow effects
 * 100+:    UI elements (intentionally on top)
 */

import * as THREE from 'three';
import { EventBus } from '@/engine/core/EventBus';
import { getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { AssetManager, DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';
import { AdvancedParticleSystem } from './AdvancedParticleSystem';
import {
  BATTLE_EFFECTS,
  RENDER_ORDER,
  FACTION_COLORS,
  BATTLE_GEOMETRIES,
  BATTLE_MATERIALS,
} from '@/data/rendering.config';

// ============================================
// CONSTANTS
// ============================================

// Note: Airborne height is configured per-unit-type in assets.json
const GROUND_EFFECT_OFFSET = BATTLE_EFFECTS.GROUND_EFFECT_OFFSET;
const POOL_SIZE = BATTLE_EFFECTS.POOL_SIZE;

// ============================================
// INTERFACES
// ============================================

interface ProjectileEffect {
  id: number;
  entityId?: number; // ECS entity ID for entity-synced projectiles
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  progress: number;
  duration: number;
  damageType: string;
  faction: keyof typeof FACTION_COLORS;
  isAirTarget: boolean;
  isEntitySynced: boolean; // True if linked to ECS projectile entity
  // Visual components
  headMesh: THREE.Mesh;
  trailGeometry: THREE.BufferGeometry;
  trailMesh: THREE.Mesh;
  trailPositions: THREE.Vector3[];
  glowSprite: THREE.Sprite;
}

interface GroundEffect {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  mesh: THREE.Mesh;
  type: 'hit' | 'death' | 'shockwave' | 'move';
  startScale: number;
  endScale: number;
  heightOffset: number; // For air unit effects
}

interface ImpactDecal {
  mesh: THREE.Mesh;
  progress: number;
  duration: number;
  fadeStart: number; // When to start fading (0-1)
}

interface ExplosionEffect {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  intensity: number;
  // Components
  coreFlash: THREE.Mesh | null;
  fireballSprite: THREE.Sprite | null;
  shockwaveRing: THREE.Mesh | null;
  debrisParticles: DebrisParticle[];
  sparkParticles: SparkParticle[];
  smokeStarted: boolean;
}

interface DebrisParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  groundY: number;
  bounced: boolean;
}

interface SparkParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface FocusFireIndicator {
  targetId: number;
  attackerCount: number;
  mesh: THREE.Mesh;
  pulseTime: number;
  heightOffset: number;
}

interface MoveIndicator {
  position: THREE.Vector3;
  progress: number;
  duration: number;
  rings: THREE.Mesh[];
}

interface LaserEffect {
  beam: THREE.Mesh;
  glow: THREE.Mesh;
  beamGeometry: THREE.BufferGeometry;
  beamMaterial: THREE.Material;
  glowGeometry: THREE.BufferGeometry;
  glowMaterial: THREE.Material;
  startGlow: THREE.Sprite | null;
  endGlow: THREE.Sprite | null;
  animationFrameId: number;
}

// ============================================
// MESH POOL
// ============================================

interface MeshPool<T extends THREE.Object3D = THREE.Mesh> {
  available: T[];
  inUse: Set<T>;
  maxSize: number;
}

// Temp vectors for calculations (reused to avoid GC pressure)
const _tempVec1 = new THREE.Vector3();
const _tempVec2 = new THREE.Vector3();
const _tempVec3 = new THREE.Vector3();

// ============================================
// MAIN CLASS
// ============================================

export class BattleEffectsRenderer {
  private scene: THREE.Scene;
  private eventBus: EventBus;
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;
  private particleSystem: AdvancedParticleSystem | null = null;

  // Effect tracking
  private projectileIdCounter = 0;
  private projectileEffects: Map<number, ProjectileEffect> = new Map();
  private entityToProjectile: Map<number, number> = new Map(); // entityId -> effectId
  private groundEffects: GroundEffect[] = [];
  private impactDecals: ImpactDecal[] = [];
  private explosionEffects: ExplosionEffect[] = [];
  private focusFireIndicators: Map<number, FocusFireIndicator> = new Map();
  private targetAttackerCounts: Map<number, Set<number>> = new Map();
  private moveIndicators: MoveIndicator[] = [];
  private laserEffects: Set<LaserEffect> = new Set();

  // ECS sync callback for entity-synced projectiles
  private getProjectilePosition: ((entityId: number) => { x: number; y: number; z: number } | null) | null = null;

  // Event listener cleanup
  private eventUnsubscribers: (() => void)[] = [];

  // Spark particle system (instanced)
  private sparkGeometry: THREE.BufferGeometry;
  private sparkMaterial: THREE.PointsMaterial;
  private sparkMesh: THREE.Points;
  private sparkParticles: SparkParticle[] = [];
  private sparkPositions: Float32Array;
  private sparkColors: Float32Array;
  private sparkSizes: Float32Array;
  private maxSparks = BATTLE_EFFECTS.MAX_SPARKS;

  // Object pools
  private projectileHeadPool: MeshPool;
  private projectileGlowPool: MeshPool<THREE.Sprite>;
  private groundEffectPool: MeshPool;
  private decalPool: MeshPool;
  private debrisPool: MeshPool;
  private explosionCorePool: MeshPool;
  private shockwavePool: MeshPool;
  private moveRingPool: MeshPool;

  // Shared geometries
  private projectileHeadGeometry: THREE.SphereGeometry;
  private groundRingGeometry: THREE.RingGeometry;
  private largeRingGeometry: THREE.RingGeometry;
  private shockwaveGeometry: THREE.RingGeometry;
  private decalGeometry: THREE.PlaneGeometry;
  private debrisGeometry: THREE.BoxGeometry;
  private explosionCoreGeometry: THREE.SphereGeometry;
  private moveRingGeometry: THREE.RingGeometry;

  // Shared materials (cloned per instance for independent opacity)
  private projectileHeadMaterial: THREE.MeshBasicMaterial;
  private trailMaterial: THREE.MeshBasicMaterial;
  private groundEffectMaterial: THREE.MeshBasicMaterial;
  private deathEffectMaterial: THREE.MeshBasicMaterial;
  private shockwaveMaterial: THREE.MeshBasicMaterial;
  private decalMaterial: THREE.MeshBasicMaterial;
  private debrisMaterial: THREE.MeshBasicMaterial;
  private explosionCoreMaterial: THREE.MeshBasicMaterial;
  private focusFireMaterial: THREE.MeshBasicMaterial;
  private moveIndicatorMaterial: THREE.MeshBasicMaterial;
  private glowSpriteMaterial: THREE.SpriteMaterial;

  // Glow texture
  private glowTexture: THREE.Texture;

  // Decal textures
  private scorchTexture: THREE.Texture;

  constructor(scene: THREE.Scene, eventBus: EventBus, getTerrainHeight?: (x: number, z: number) => number) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.getTerrainHeight = getTerrainHeight ?? null;

    // Create textures
    this.glowTexture = this.createGlowTexture();
    this.scorchTexture = this.createScorchTexture();

    // Create shared geometries
    this.projectileHeadGeometry = new THREE.SphereGeometry(0.2, 12, 12);
    this.groundRingGeometry = new THREE.RingGeometry(0.2, 0.6, 24);
    this.largeRingGeometry = new THREE.RingGeometry(0.5, 1.2, 24);
    this.shockwaveGeometry = new THREE.RingGeometry(0.3, 3.0, 32);
    this.decalGeometry = new THREE.PlaneGeometry(2, 2);
    this.debrisGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    this.explosionCoreGeometry = new THREE.SphereGeometry(0.8, 16, 16);
    this.moveRingGeometry = new THREE.RingGeometry(0.3, 0.6, 16);

    // Create shared materials with PROPER depth testing
    this.projectileHeadMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 1.0,
    });

    this.trailMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    // Ground effects: depthTest TRUE, depthWrite FALSE, with polygon offset
    this.groundEffectMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: true,      // FIXED: Now properly occluded by units
      depthWrite: false,    // Don't write to depth (allows stacking)
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.deathEffectMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    this.decalMaterial = new THREE.MeshBasicMaterial({
      map: this.scorchTexture,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    });

    this.debrisMaterial = new THREE.MeshBasicMaterial({
      color: 0x664422,
      transparent: true,
      opacity: 1.0,
    });

    this.explosionCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
    });

    this.focusFireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.moveIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.glowSpriteMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    });

    // Initialize object pools
    this.projectileHeadPool = this.createMeshPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.projectileHeadGeometry, this.projectileHeadMaterial.clone());
      mesh.visible = false;
      mesh.renderOrder = RENDER_ORDER.PROJECTILE;
      return mesh;
    });

    this.projectileGlowPool = this.createSpritePool(POOL_SIZE, () => {
      const sprite = new THREE.Sprite(this.glowSpriteMaterial.clone());
      sprite.visible = false;
      sprite.scale.set(1.5, 1.5, 1);
      sprite.renderOrder = RENDER_ORDER.GLOW;
      return sprite;
    });

    this.groundEffectPool = this.createMeshPool(POOL_SIZE, () => {
      const mesh = new THREE.Mesh(this.groundRingGeometry, this.groundEffectMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = RENDER_ORDER.GROUND_EFFECT;
      return mesh;
    });

    this.decalPool = this.createMeshPool(50, () => {
      const mesh = new THREE.Mesh(this.decalGeometry, this.decalMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = RENDER_ORDER.GROUND_DECAL;
      return mesh;
    });

    this.debrisPool = this.createMeshPool(200, () => {
      const mesh = new THREE.Mesh(this.debrisGeometry, this.debrisMaterial.clone());
      mesh.visible = false;
      mesh.renderOrder = RENDER_ORDER.EXPLOSION;
      return mesh;
    });

    this.explosionCorePool = this.createMeshPool(30, () => {
      const mesh = new THREE.Mesh(this.explosionCoreGeometry, this.explosionCoreMaterial.clone());
      mesh.visible = false;
      mesh.renderOrder = RENDER_ORDER.EXPLOSION;
      return mesh;
    });

    this.shockwavePool = this.createMeshPool(30, () => {
      const mesh = new THREE.Mesh(this.shockwaveGeometry, this.shockwaveMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = RENDER_ORDER.EXPLOSION;
      return mesh;
    });

    this.moveRingPool = this.createMeshPool(50, () => {
      const mesh = new THREE.Mesh(this.moveRingGeometry, this.moveIndicatorMaterial.clone());
      mesh.visible = false;
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = RENDER_ORDER.GROUND_EFFECT;
      return mesh;
    });

    // Initialize spark particle system
    this.sparkPositions = new Float32Array(this.maxSparks * 3);
    this.sparkColors = new Float32Array(this.maxSparks * 4);
    this.sparkSizes = new Float32Array(this.maxSparks);

    this.sparkGeometry = new THREE.BufferGeometry();
    this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeometry.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 4));
    this.sparkGeometry.setAttribute('size', new THREE.BufferAttribute(this.sparkSizes, 1));

    this.sparkMaterial = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.sparkMesh = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.renderOrder = RENDER_ORDER.GLOW;
    this.scene.add(this.sparkMesh);

    // Initialize spark particle pool
    for (let i = 0; i < this.maxSparks; i++) {
      this.sparkParticles.push({
        position: new THREE.Vector3(0, -1000, 0),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0,
      });
    }

    this.setupEventListeners();
  }

  /**
   * Create a radial glow texture for sprites
   */
  private createGlowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 220, 150, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 180, 100, 0.3)');
    gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Create a scorch mark texture for impact decals
   */
  private createScorchTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Create radial gradient with irregular edges
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(20, 15, 10, 0.9)');
    gradient.addColorStop(0.3, 'rgba(40, 30, 20, 0.7)');
    gradient.addColorStop(0.6, 'rgba(60, 45, 30, 0.4)');
    gradient.addColorStop(0.8, 'rgba(80, 60, 40, 0.2)');
    gradient.addColorStop(1, 'rgba(100, 80, 50, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    // Add some noise/irregularity
    const imageData = ctx.getImageData(0, 0, 128, 128);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 30;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Set the terrain height function
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Set callback to get projectile positions from ECS world.
   * This enables entity-synced projectile visuals to follow actual ECS positions
   * instead of just interpolating between start and end.
   *
   * @param fn Callback that returns {x, y, z} for an entity ID, or null if entity doesn't exist
   */
  public setProjectilePositionCallback(fn: (entityId: number) => { x: number; y: number; z: number } | null): void {
    this.getProjectilePosition = fn;
  }

  private getHeightAt(x: number, z: number): number {
    return this.getTerrainHeight ? this.getTerrainHeight(x, z) : 0;
  }

  // ============================================
  // POOL MANAGEMENT
  // ============================================

  // PERF: Pools now use lazy scene addition - meshes are only added to scene when acquired
  // This saves ~810 unnecessary objects in the scene graph at init time
  private meshFactories: Map<MeshPool<THREE.Object3D>, () => THREE.Object3D> = new Map();

  private createMeshPool(size: number, factory: () => THREE.Mesh): MeshPool {
    const pool: MeshPool = { available: [], inUse: new Set(), maxSize: size };
    // PERF: Don't create meshes upfront - create on demand
    // Store factory for lazy creation
    this.meshFactories.set(pool as MeshPool<THREE.Object3D>, factory);
    return pool;
  }

  private createSpritePool(size: number, factory: () => THREE.Sprite): MeshPool<THREE.Sprite> {
    const pool: MeshPool<THREE.Sprite> = { available: [], inUse: new Set(), maxSize: size };
    // PERF: Don't create sprites upfront - create on demand
    // Store factory for lazy creation
    this.meshFactories.set(pool as MeshPool<THREE.Object3D>, factory);
    return pool;
  }

  private acquireFromPool<T extends THREE.Object3D>(pool: MeshPool<T>): T | null {
    let mesh: T;
    if (pool.available.length > 0) {
      mesh = pool.available.pop()!;
    } else if (pool.inUse.size < pool.maxSize) {
      // PERF: Lazy creation - create mesh on first use
      const factory = this.meshFactories.get(pool as MeshPool<THREE.Object3D>);
      if (!factory) return null;
      mesh = factory() as T;
    } else {
      return null; // Pool exhausted
    }
    pool.inUse.add(mesh);
    mesh.visible = true;
    // PERF: Only add to scene when acquired (lazy scene addition)
    if (!mesh.parent) {
      this.scene.add(mesh);
    }
    return mesh;
  }

  private releaseToPool<T extends THREE.Object3D>(pool: MeshPool<T>, mesh: T): void {
    if (pool.inUse.has(mesh)) {
      pool.inUse.delete(mesh);
      mesh.visible = false;
      // Reset mesh properties if it has scale (Mesh or Sprite)
      if ('scale' in mesh && mesh.scale) {
        mesh.scale.set(1, 1, 1);
      }
      // Reset material opacity if applicable
      if ('material' in mesh) {
        const mat = (mesh as unknown as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (mat && mat.opacity !== undefined) mat.opacity = 1;
      }
      // PERF: Remove from scene when released to reduce scene graph traversal
      if (mesh.parent) {
        this.scene.remove(mesh);
      }
      if (pool.available.length < pool.maxSize) {
        pool.available.push(mesh);
      }
    }
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  private setupEventListeners(): void {
    // Combat attack - create muzzle flash and instant weapon effects
    // For projectile-based attacks (damage === 0), visuals are handled by projectile:spawned
    this.eventUnsubscribers.push(this.eventBus.on('combat:attack', (data: {
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
      attackerFaction?: string;
    }) => {
      if (data.attackerPos && data.targetPos) {
        const attackerTerrainHeight = this.getHeightAt(data.attackerPos.x, data.attackerPos.y);
        const targetTerrainHeight = this.getHeightAt(data.targetPos.x, data.targetPos.y);

        // Per-unit-type airborne height from assets.json
        const attackerAirborneHeight = data.attackerId ? AssetManager.getAirborneHeight(data.attackerId) : DEFAULT_AIRBORNE_HEIGHT;
        const targetAirborneHeight = data.targetUnitType ? AssetManager.getAirborneHeight(data.targetUnitType) : DEFAULT_AIRBORNE_HEIGHT;
        const attackerFlyingOffset = data.attackerIsFlying ? attackerAirborneHeight : 0;
        const targetFlyingOffset = data.targetIsFlying ? targetAirborneHeight : 0;

        const startPos = new THREE.Vector3(
          data.attackerPos.x,
          attackerTerrainHeight + 0.5 + attackerFlyingOffset,
          data.attackerPos.y
        );

        const endPos = new THREE.Vector3(
          data.targetPos.x,
          targetTerrainHeight + 0.5 + targetFlyingOffset,
          data.targetPos.y
        );

        const faction = (data.attackerFaction as keyof typeof FACTION_COLORS) || 'terran';

        // Only create instant weapon visuals (lasers, melee) when damage > 0
        // Projectile-based attacks (damage === 0) are handled by projectile:spawned event
        if (data.damage > 0) {
          this.createProjectileEffect(startPos, endPos, data.damageType, faction, !!data.targetIsFlying);
        }

        // Track focus fire using entity IDs (pass airborne height for correct positioning)
        if (data.attackerEntityId !== undefined && data.targetId !== undefined) {
          this.trackFocusFire(data.attackerEntityId, data.targetId, data.targetPos, !!data.targetIsFlying, targetAirborneHeight);
        }
      }
    }));

    // Projectile spawned - create visual for entity-synced projectile
    this.eventUnsubscribers.push(this.eventBus.on('projectile:spawned', (data: {
      entityId: number;
      startPos: { x: number; y: number; z: number };
      targetPos: { x: number; y: number; z: number };
      projectileType: string;
      faction: string;
      trailType?: string;
      visualScale?: number;
    }) => {
      const startTerrainHeight = this.getHeightAt(data.startPos.x, data.startPos.y);
      const targetTerrainHeight = this.getHeightAt(data.targetPos.x, data.targetPos.y);

      const startPos = new THREE.Vector3(
        data.startPos.x,
        startTerrainHeight + data.startPos.z,
        data.startPos.y
      );

      const endPos = new THREE.Vector3(
        data.targetPos.x,
        targetTerrainHeight + data.targetPos.z,
        data.targetPos.y
      );

      const faction = (data.faction as keyof typeof FACTION_COLORS) || 'terran';

      // Calculate duration based on distance and a base speed
      const distance = startPos.distanceTo(endPos);
      const duration = Math.max(0.15, distance / 40); // ~40 units/sec visual speed

      this.createEntityProjectileEffect(
        data.entityId,
        startPos,
        endPos,
        data.trailType || 'bullet',
        faction,
        duration
      );
    }));

    // Projectile impact - create hit effect
    this.eventUnsubscribers.push(this.eventBus.on('projectile:impact', (data: {
      entityId: number;
      position: { x: number; y: number; z: number };
      damageType: string;
      splashRadius: number;
      faction: string;
      projectileId: string;
    }) => {
      const terrainHeight = this.getHeightAt(data.position.x, data.position.y);
      const impactPos = new THREE.Vector3(
        data.position.x,
        terrainHeight + data.position.z,
        data.position.y
      );

      // Create hit effect
      this.createHitEffect(impactPos, data.position.z > 1);

      // Create splash effect if applicable
      if (data.splashRadius > 0) {
        this.createSplashEffect(impactPos, data.splashRadius);
      }

      // Cleanup visual if it still exists
      const effectId = this.entityToProjectile.get(data.entityId);
      if (effectId !== undefined) {
        this.cleanupProjectileEffect(effectId);
      }
    }));

    // Unit died - create death effect
    this.eventUnsubscribers.push(this.eventBus.on('unit:died', (data: {
      entityId?: number;
      position?: { x: number; y: number };
      isFlying?: boolean;
      unitType?: string; // Unit type ID for airborne height lookup
    }) => {
      if (data.position) {
        const terrainHeight = this.getHeightAt(data.position.x, data.position.y);
        // Per-unit-type airborne height from assets.json
        const airborneHeight = data.unitType ? AssetManager.getAirborneHeight(data.unitType) : DEFAULT_AIRBORNE_HEIGHT;
        const heightOffset = data.isFlying ? airborneHeight : 0;
        this.createDeathEffect(
          new THREE.Vector3(data.position.x, terrainHeight, data.position.y),
          heightOffset
        );
      }
      if (data.entityId !== undefined) {
        this.clearFocusFire(data.entityId);
      }
    }));

    // Building destroyed - big explosion
    this.eventUnsubscribers.push(this.eventBus.on('building:destroyed', (data: {
      entityId: number;
      playerId: string;
      buildingType: string;
      position: { x: number; y: number };
    }) => {
      const terrainHeight = this.getHeightAt(data.position.x, data.position.y);
      const isLarge = ['headquarters', 'infantry_bay', 'forge', 'hangar'].includes(data.buildingType);
      this.createExplosion(
        new THREE.Vector3(data.position.x, terrainHeight, data.position.y),
        isLarge ? 2.0 : 1.0
      );
      this.clearFocusFire(data.entityId);
    }));

    // Move command
    this.eventUnsubscribers.push(this.eventBus.on('command:move', (data: {
      entityIds: number[];
      targetPosition?: { x: number; y: number };
      playerId?: string;
    }) => {
      const localPlayerId = getLocalPlayerId();
      const spectating = isSpectatorMode();
      if (!spectating && data.playerId && data.playerId !== localPlayerId) {
        return;
      }

      if (data.entityIds.length > 0 && data.targetPosition) {
        const terrainHeight = this.getHeightAt(data.targetPosition.x, data.targetPosition.y);
        this.createMoveIndicator(
          new THREE.Vector3(data.targetPosition.x, terrainHeight + GROUND_EFFECT_OFFSET, data.targetPosition.y)
        );
      }
    }));

    // Stop attack tracking
    this.eventUnsubscribers.push(this.eventBus.on('unit:stopAttack', (data: { attackerId?: number; targetId?: number }) => {
      if (data.attackerId !== undefined && data.targetId !== undefined) {
        this.removeAttackerFromTarget(data.attackerId, data.targetId);
      }
    }));
  }

  // ============================================
  // PROJECTILE SYSTEM
  // ============================================

  private createProjectileEffect(
    start: THREE.Vector3,
    end: THREE.Vector3,
    damageType: string,
    faction: keyof typeof FACTION_COLORS,
    isAirTarget: boolean
  ): void {
    if (damageType === 'psionic') {
      this.createLaserEffect(start, end, faction);
      return;
    }

    const headMesh = this.acquireFromPool(this.projectileHeadPool);
    const glowSprite = this.acquireFromPool(this.projectileGlowPool);

    if (!headMesh || !glowSprite) return;

    // Set faction colors
    const colors = FACTION_COLORS[faction];
    (headMesh.material as THREE.MeshBasicMaterial).color.setHex(colors.primary);
    (glowSprite.material as THREE.SpriteMaterial).color.setHex(colors.glow);

    headMesh.position.copy(start);
    glowSprite.position.copy(start);

    // Create trail geometry (ribbon)
    const trailLength = 8;
    const trailPositions: THREE.Vector3[] = [];
    for (let i = 0; i < trailLength; i++) {
      trailPositions.push(start.clone());
    }

    const trailGeometry = new THREE.BufferGeometry();
    const trailVertices = new Float32Array(trailLength * 2 * 3); // 2 vertices per segment for ribbon
    const trailIndices: number[] = [];

    // Create triangle strip indices
    for (let i = 0; i < trailLength - 1; i++) {
      const base = i * 2;
      trailIndices.push(base, base + 1, base + 2);
      trailIndices.push(base + 1, base + 3, base + 2);
    }

    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailVertices, 3));
    trailGeometry.setIndex(trailIndices);

    const trailMaterial = this.trailMaterial.clone();
    trailMaterial.color.setHex(colors.secondary);

    const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
    trailMesh.renderOrder = RENDER_ORDER.PROJECTILE - 1;
    this.scene.add(trailMesh);

    const id = this.projectileIdCounter++;
    const effect: ProjectileEffect = {
      id,
      startPos: start.clone(),
      endPos: end.clone(),
      currentPos: start.clone(),
      progress: 0,
      duration: 0.25, // 250ms travel time
      damageType,
      faction,
      isAirTarget,
      isEntitySynced: false, // Not linked to ECS entity
      headMesh,
      trailGeometry,
      trailMesh,
      trailPositions,
      glowSprite,
    };

    this.projectileEffects.set(id, effect);
  }

  /**
   * Create a projectile effect linked to an ECS entity
   * Unlike createProjectileEffect, these don't emit combat:hit on completion
   * as the ProjectileSystem handles that
   */
  private createEntityProjectileEffect(
    entityId: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
    trailType: string,
    faction: keyof typeof FACTION_COLORS,
    duration: number
  ): void {
    // Use laser effect for laser trail type
    if (trailType === 'laser') {
      this.createLaserEffect(start, end, faction);
      return;
    }

    const headMesh = this.acquireFromPool(this.projectileHeadPool);
    const glowSprite = this.acquireFromPool(this.projectileGlowPool);

    if (!headMesh || !glowSprite) return;

    // Set faction colors
    const colors = FACTION_COLORS[faction];
    (headMesh.material as THREE.MeshBasicMaterial).color.setHex(colors.primary);
    (glowSprite.material as THREE.SpriteMaterial).color.setHex(colors.glow);

    headMesh.position.copy(start);
    glowSprite.position.copy(start);

    // Create trail geometry (ribbon)
    const trailLength = 8;
    const trailPositions: THREE.Vector3[] = [];
    for (let i = 0; i < trailLength; i++) {
      trailPositions.push(start.clone());
    }

    const trailGeometry = new THREE.BufferGeometry();
    const trailVertices = new Float32Array(trailLength * 2 * 3);
    const trailIndices: number[] = [];

    for (let i = 0; i < trailLength - 1; i++) {
      const base = i * 2;
      trailIndices.push(base, base + 1, base + 2);
      trailIndices.push(base + 1, base + 3, base + 2);
    }

    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailVertices, 3));
    trailGeometry.setIndex(trailIndices);

    const trailMaterial = this.trailMaterial.clone();
    trailMaterial.color.setHex(colors.secondary);

    const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
    trailMesh.renderOrder = RENDER_ORDER.PROJECTILE - 1;
    this.scene.add(trailMesh);

    const id = this.projectileIdCounter++;
    const effect: ProjectileEffect = {
      id,
      entityId,
      startPos: start.clone(),
      endPos: end.clone(),
      currentPos: start.clone(),
      progress: 0,
      duration,
      damageType: 'normal',
      faction,
      isAirTarget: end.y > 2,
      isEntitySynced: true, // Linked to ECS entity
      headMesh,
      trailGeometry,
      trailMesh,
      trailPositions,
      glowSprite,
    };

    this.projectileEffects.set(id, effect);
    this.entityToProjectile.set(entityId, id);
  }

  /**
   * Cleanup a specific projectile effect
   */
  private cleanupProjectileEffect(effectId: number): void {
    const effect = this.projectileEffects.get(effectId);
    if (!effect) return;

    this.releaseToPool(this.projectileHeadPool, effect.headMesh);
    this.releaseToPool(this.projectileGlowPool, effect.glowSprite);
    this.scene.remove(effect.trailMesh);
    effect.trailGeometry.dispose();
    (effect.trailMesh.material as THREE.Material).dispose();

    this.projectileEffects.delete(effectId);
    if (effect.entityId !== undefined) {
      this.entityToProjectile.delete(effect.entityId);
    }
  }

  /**
   * Create a splash effect at impact point
   */
  private createSplashEffect(position: THREE.Vector3, radius: number): void {
    // Create expanding shockwave ring
    const mesh = this.acquireFromPool(this.shockwavePool);
    if (!mesh) return;

    mesh.position.set(position.x, position.y + GROUND_EFFECT_OFFSET, position.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(0.1, 0.1, 1);

    this.groundEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 0.4,
      mesh,
      type: 'shockwave',
      startScale: 0.1,
      endScale: radius * 0.8,
      heightOffset: 0,
    });
  }

  private createLaserEffect(start: THREE.Vector3, end: THREE.Vector3, faction: keyof typeof FACTION_COLORS): void {
    const colors = FACTION_COLORS[faction];

    // Calculate laser beam direction and length
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    direction.normalize();

    // Create cylinder geometry for laser beam (radius 0.08 for thin beam)
    // Note: LineBasicMaterial linewidth doesn't work in WebGL/WebGPU, so we use a mesh
    const beamRadius = 0.08;
    const beamGeometry = new THREE.CylinderGeometry(beamRadius, beamRadius, length, 6, 1);

    const beamMaterial = new THREE.MeshBasicMaterial({
      color: colors.primary,
      transparent: true,
      opacity: 1.0,
    });

    const beam = new THREE.Mesh(beamGeometry, beamMaterial);

    // Position at midpoint between start and end
    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    beam.position.copy(midpoint);

    // Rotate to align with laser direction (cylinder defaults to Y axis)
    const yAxis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, direction);
    beam.setRotationFromQuaternion(quaternion);

    beam.renderOrder = RENDER_ORDER.PROJECTILE;
    this.scene.add(beam);

    // Create larger glow cylinder for bloom effect
    const glowGeometry = new THREE.CylinderGeometry(beamRadius * 3, beamRadius * 3, length, 6, 1);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: colors.glow,
      transparent: true,
      opacity: 0.4,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(midpoint);
    glow.setRotationFromQuaternion(quaternion);
    glow.renderOrder = RENDER_ORDER.PROJECTILE - 1;
    this.scene.add(glow);

    // Create glow sprites at both ends
    const startGlow = this.acquireFromPool(this.projectileGlowPool);
    const endGlow = this.acquireFromPool(this.projectileGlowPool);

    if (startGlow) {
      startGlow.position.copy(start);
      startGlow.scale.set(1.0, 1.0, 1);
      (startGlow.material as THREE.SpriteMaterial).color.setHex(colors.glow);
    }

    if (endGlow) {
      endGlow.position.copy(end);
      endGlow.scale.set(1.2, 1.2, 1);
      (endGlow.material as THREE.SpriteMaterial).color.setHex(colors.glow);
    }

    // Track effect for proper cleanup
    const effect: LaserEffect = {
      beam,
      glow,
      beamGeometry,
      beamMaterial,
      glowGeometry,
      glowMaterial,
      startGlow,
      endGlow,
      animationFrameId: 0,
    };
    this.laserEffects.add(effect);

    // Animate laser fade
    const startTime = performance.now();
    const duration = 150;

    const animateLaser = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.cleanupLaserEffect(effect);
        return;
      }

      beamMaterial.opacity = 1 - progress;
      glowMaterial.opacity = 0.4 * (1 - progress);
      if (startGlow) (startGlow.material as THREE.SpriteMaterial).opacity = 0.8 * (1 - progress);
      if (endGlow) (endGlow.material as THREE.SpriteMaterial).opacity = 0.8 * (1 - progress);

      effect.animationFrameId = requestAnimationFrame(animateLaser);
    };

    effect.animationFrameId = requestAnimationFrame(animateLaser);

    // Create hit effect immediately for lasers
    this.createHitEffect(end, end.y > this.getHeightAt(end.x, end.z) + 2);
    this.eventBus.emit('combat:hit', { position: { x: end.x, y: end.z } });
  }

  private cleanupLaserEffect(effect: LaserEffect): void {
    // Cancel any pending animation
    if (effect.animationFrameId) {
      cancelAnimationFrame(effect.animationFrameId);
    }

    // Remove from scene
    this.scene.remove(effect.beam);
    this.scene.remove(effect.glow);

    // Dispose geometries and materials
    effect.beamGeometry.dispose();
    effect.beamMaterial.dispose();
    effect.glowGeometry.dispose();
    effect.glowMaterial.dispose();

    // Return sprites to pool
    if (effect.startGlow) this.releaseToPool(this.projectileGlowPool, effect.startGlow);
    if (effect.endGlow) this.releaseToPool(this.projectileGlowPool, effect.endGlow);

    // Remove from tracking set
    this.laserEffects.delete(effect);
  }

  // ============================================
  // IMPACT EFFECTS
  // ============================================

  private createHitEffect(position: THREE.Vector3, isAirTarget: boolean): void {
    // Use advanced particle system for impact sparks
    if (this.particleSystem) {
      const upDir = new THREE.Vector3(0, 1, 0);
      this.particleSystem.emitImpact(position, upDir);
    }

    const mesh = this.acquireFromPool(this.groundEffectPool);
    if (!mesh) return;

    const terrainHeight = this.getHeightAt(position.x, position.z);
    const heightOffset = isAirTarget ? (position.y - terrainHeight) : GROUND_EFFECT_OFFSET;

    mesh.position.set(position.x, terrainHeight + heightOffset, position.z);
    mesh.scale.set(1, 1, 1);

    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.9;
    material.color.setHex(0xffcc00);

    // Adjust render order for air targets
    mesh.renderOrder = isAirTarget ? RENDER_ORDER.AIR_EFFECT : RENDER_ORDER.GROUND_EFFECT;

    this.groundEffects.push({
      position: new THREE.Vector3(position.x, terrainHeight, position.z),
      progress: 0,
      duration: 0.35,
      mesh,
      type: 'hit',
      startScale: 1,
      endScale: 2.5,
      heightOffset,
    });

    // Spawn sparks (reduced since particle system also spawns)
    this.spawnSparks(position, 4, 0xffaa00);

    // Create impact decal for ground targets
    if (!isAirTarget) {
      this.createImpactDecal(position);
    }
  }

  private createDeathEffect(position: THREE.Vector3, heightOffset: number): void {
    // Use advanced particle system for death explosion
    if (this.particleSystem) {
      const effectPos = new THREE.Vector3(position.x, position.y + heightOffset, position.z);
      this.particleSystem.emitExplosion(effectPos, 0.6); // Smaller explosion for unit death
    }

    const mesh = this.acquireFromPool(this.groundEffectPool);
    if (!mesh) return;

    mesh.geometry = this.largeRingGeometry;
    mesh.position.set(position.x, position.y + heightOffset + GROUND_EFFECT_OFFSET, position.z);
    mesh.scale.set(1, 1, 1);

    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 1.0;
    material.color.setHex(0xff4400);

    mesh.renderOrder = heightOffset > 0 ? RENDER_ORDER.AIR_EFFECT : RENDER_ORDER.GROUND_EFFECT;

    this.groundEffects.push({
      position: new THREE.Vector3(position.x, position.y, position.z),
      progress: 0,
      duration: 0.5,
      mesh,
      type: 'death',
      startScale: 1,
      endScale: 3,
      heightOffset: heightOffset + GROUND_EFFECT_OFFSET,
    });

    // Spawn sparks
    this.spawnSparks(
      new THREE.Vector3(position.x, position.y + heightOffset + 0.5, position.z),
      15,
      0xff6600
    );
  }

  private createImpactDecal(position: THREE.Vector3): void {
    const mesh = this.acquireFromPool(this.decalPool);
    if (!mesh) return;

    const terrainHeight = this.getHeightAt(position.x, position.z);
    mesh.position.set(position.x, terrainHeight + 0.05, position.z);

    // Random rotation and slight scale variation
    mesh.rotation.z = Math.random() * Math.PI * 2;
    const scale = 0.8 + Math.random() * 0.4;
    mesh.scale.set(scale, scale, 1);

    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.5;

    this.impactDecals.push({
      mesh,
      progress: 0,
      duration: 8.0, // Persist for 8 seconds
      fadeStart: 0.7, // Start fading at 70%
    });
  }

  // ============================================
  // EXPLOSION SYSTEM
  // ============================================

  private createExplosion(position: THREE.Vector3, intensity: number): void {
    // Use advanced particle system for volumetric explosion
    if (this.particleSystem) {
      this.particleSystem.emitExplosion(position, intensity);
    }

    // Core flash
    const coreFlash = this.acquireFromPool(this.explosionCorePool);
    if (coreFlash) {
      coreFlash.position.copy(position);
      coreFlash.position.y += 1.0 * intensity;
      coreFlash.scale.setScalar(intensity);
      const mat = coreFlash.material as THREE.MeshBasicMaterial;
      mat.opacity = 1.0;
      mat.color.setHex(0xffffaa);
    }

    // Shockwave ring
    const shockwaveRing = this.acquireFromPool(this.shockwavePool);
    if (shockwaveRing) {
      shockwaveRing.position.copy(position);
      shockwaveRing.position.y += GROUND_EFFECT_OFFSET;
      shockwaveRing.scale.set(0.5 * intensity, 0.5 * intensity, 1);
      const mat = shockwaveRing.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.9;
    }

    // Debris particles
    const debrisParticles: DebrisParticle[] = [];
    const debrisCount = Math.floor(15 * intensity);

    for (let i = 0; i < debrisCount; i++) {
      const debris = this.acquireFromPool(this.debrisPool);
      if (!debris) break;

      debris.position.copy(position);
      debris.position.y += 0.5 + Math.random() * intensity;

      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5 * intensity;
      const upSpeed = 4 + Math.random() * 6 * intensity;

      // Random color variation
      const colorChoice = Math.random();
      const mat = debris.material as THREE.MeshBasicMaterial;
      if (colorChoice < 0.33) {
        mat.color.setHex(0xff6600);
      } else if (colorChoice < 0.66) {
        mat.color.setHex(0xff3300);
      } else {
        mat.color.setHex(0x664422);
      }
      mat.opacity = 1.0;

      debrisParticles.push({
        mesh: debris,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          upSpeed,
          Math.sin(angle) * speed
        ),
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 10
        ),
        groundY: position.y,
        bounced: false,
      });
    }

    // Spawn lots of sparks
    this.spawnSparks(
      new THREE.Vector3(position.x, position.y + 1, position.z),
      Math.floor(40 * intensity),
      0xffaa00
    );

    // Create scorch decal
    const decal = this.acquireFromPool(this.decalPool);
    if (decal) {
      decal.position.copy(position);
      decal.position.y += 0.05;
      decal.rotation.z = Math.random() * Math.PI * 2;
      decal.scale.setScalar(2 * intensity);
      (decal.material as THREE.MeshBasicMaterial).opacity = 0.7;

      this.impactDecals.push({
        mesh: decal,
        progress: 0,
        duration: 12.0,
        fadeStart: 0.6,
      });
    }

    this.explosionEffects.push({
      position: position.clone(),
      progress: 0,
      duration: 1.2,
      intensity,
      coreFlash,
      fireballSprite: null,
      shockwaveRing,
      debrisParticles,
      sparkParticles: [],
      smokeStarted: false,
    });

    // Emit screen shake event
    this.eventBus.emit('effect:explosion', {
      position: { x: position.x, y: position.z },
      intensity,
    });
  }

  // ============================================
  // SPARK PARTICLE SYSTEM
  // ============================================

  private spawnSparks(position: THREE.Vector3, count: number, color: number): void {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;

    for (let i = 0; i < count; i++) {
      // Find an inactive spark
      let sparkIndex = -1;
      for (let j = 0; j < this.maxSparks; j++) {
        if (this.sparkParticles[j].life <= 0) {
          sparkIndex = j;
          break;
        }
      }

      if (sparkIndex === -1) break;

      const spark = this.sparkParticles[sparkIndex];

      spark.position.copy(position);
      spark.position.x += (Math.random() - 0.5) * 0.5;
      spark.position.z += (Math.random() - 0.5) * 0.5;

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const upSpeed = 3 + Math.random() * 5;

      spark.velocity.set(
        Math.cos(angle) * speed,
        upSpeed,
        Math.sin(angle) * speed
      );

      spark.maxLife = 0.3 + Math.random() * 0.5;
      spark.life = spark.maxLife;
      spark.size = 0.1 + Math.random() * 0.15;

      // Set color in buffer
      this.sparkColors[sparkIndex * 4] = r;
      this.sparkColors[sparkIndex * 4 + 1] = g;
      this.sparkColors[sparkIndex * 4 + 2] = b;
      this.sparkColors[sparkIndex * 4 + 3] = 1.0;
    }
  }

  // ============================================
  // FOCUS FIRE & MOVE INDICATORS
  // ============================================

  private trackFocusFire(attackerId: number, targetId: number, targetPos: { x: number; y: number }, isFlying: boolean, airborneHeight: number = DEFAULT_AIRBORNE_HEIGHT): void {
    let attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) {
      attackers = new Set();
      this.targetAttackerCounts.set(targetId, attackers);
    }

    attackers.add(attackerId);

    const terrainHeight = this.getHeightAt(targetPos.x, targetPos.y);
    // Use per-unit-type airborne height from assets.json for correct positioning
    const heightOffset = isFlying ? airborneHeight : GROUND_EFFECT_OFFSET;

    if (attackers.size >= 2) {
      let indicator = this.focusFireIndicators.get(targetId);

      if (!indicator) {
        const mesh = new THREE.Mesh(this.largeRingGeometry, this.focusFireMaterial.clone());
        mesh.position.set(targetPos.x, terrainHeight + heightOffset, targetPos.y);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = isFlying ? RENDER_ORDER.AIR_EFFECT : RENDER_ORDER.GROUND_EFFECT;
        this.scene.add(mesh);

        indicator = {
          targetId,
          attackerCount: attackers.size,
          mesh,
          pulseTime: 0,
          heightOffset,
        };
        this.focusFireIndicators.set(targetId, indicator);
      } else {
        indicator.mesh.position.set(targetPos.x, terrainHeight + heightOffset, targetPos.y);
        indicator.attackerCount = attackers.size;
      }
    }
  }

  private clearFocusFire(targetId: number): void {
    const indicator = this.focusFireIndicators.get(targetId);
    if (indicator) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
      this.focusFireIndicators.delete(targetId);
    }
    this.targetAttackerCounts.delete(targetId);
  }

  private removeAttackerFromTarget(attackerId: number, targetId: number): void {
    const attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) return;

    attackers.delete(attackerId);

    if (attackers.size < 2) {
      const indicator = this.focusFireIndicators.get(targetId);
      if (indicator) {
        this.scene.remove(indicator.mesh);
        (indicator.mesh.material as THREE.Material).dispose();
        this.focusFireIndicators.delete(targetId);
      }
    }

    if (attackers.size === 0) {
      this.targetAttackerCounts.delete(targetId);
    }
  }

  private createMoveIndicator(position: THREE.Vector3): void {
    const rings: THREE.Mesh[] = [];

    for (let i = 0; i < 3; i++) {
      const ring = this.acquireFromPool(this.moveRingPool);
      if (ring) {
        ring.position.copy(position);
        const baseScale = 1 + i * 0.8;
        ring.scale.set(baseScale, baseScale, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 - i * 0.2;
        rings.push(ring);
      }
    }

    if (rings.length > 0) {
      this.moveIndicators.push({
        position: new THREE.Vector3(position.x, position.y, position.z),
        progress: 0,
        duration: 0.5,
        rings,
      });
    }
  }

  // ============================================
  // PARTICLE SYSTEM INTEGRATION
  // ============================================

  /**
   * Set the advanced particle system for volumetric effects
   */
  public setParticleSystem(particleSystem: AdvancedParticleSystem): void {
    this.particleSystem = particleSystem;
  }

  // ============================================
  // UPDATE LOOP
  // ============================================

  public update(deltaTime: number): void {
    const dt = deltaTime / 1000;

    this.updateProjectiles(dt);
    this.updateGroundEffects(dt);
    this.updateImpactDecals(dt);
    this.updateExplosions(dt);
    this.updateSparks(dt);
    this.updateFocusFireIndicators(dt);
    this.updateMoveIndicators(dt);
  }

  private updateProjectiles(dt: number): void {
    const toRemove: number[] = [];

    for (const [id, effect] of this.projectileEffects) {
      effect.progress += dt / effect.duration;

      // For entity-synced projectiles, check if entity still exists and get real position
      let entityPosition: { x: number; y: number; z: number } | null = null;
      let entityGone = false;

      if (effect.isEntitySynced && effect.entityId !== undefined && this.getProjectilePosition) {
        entityPosition = this.getProjectilePosition(effect.entityId);
        if (!entityPosition) {
          // Entity was destroyed (impact happened) - cleanup visual immediately
          entityGone = true;
        }
      }

      if (effect.progress >= 1 || entityGone) {
        // Projectile reached target (visual only)
        // For entity-synced projectiles, ProjectileSystem handles the actual impact
        // For instant projectiles (non-entity-synced), create hit effect here
        if (!effect.isEntitySynced) {
          this.createHitEffect(effect.endPos, effect.isAirTarget);
          this.eventBus.emit('combat:hit', { position: { x: effect.endPos.x, y: effect.endPos.z } });
        }

        // Cleanup
        this.releaseToPool(this.projectileHeadPool, effect.headMesh);
        this.releaseToPool(this.projectileGlowPool, effect.glowSprite);
        this.scene.remove(effect.trailMesh);
        effect.trailGeometry.dispose();
        (effect.trailMesh.material as THREE.Material).dispose();

        // Clear entity mapping if applicable
        if (effect.entityId !== undefined) {
          this.entityToProjectile.delete(effect.entityId);
        }

        toRemove.push(id);
      } else {
        // Update position - use ECS position for entity-synced, interpolation for instant
        if (entityPosition) {
          // Use actual ECS position (convert from game coords to Three.js coords)
          // Game: x=x, y=y (horizontal), z=height
          // Three.js: x=x, y=height, z=y (horizontal)
          const terrainHeight = this.getHeightAt(entityPosition.x, entityPosition.y);
          effect.currentPos.set(
            entityPosition.x,
            terrainHeight + entityPosition.z,
            entityPosition.y
          );
        } else {
          // Fallback to interpolation (for instant weapons or if callback not set)
          effect.currentPos.lerpVectors(effect.startPos, effect.endPos, effect.progress);
        }

        effect.headMesh.position.copy(effect.currentPos);
        effect.glowSprite.position.copy(effect.currentPos);

        // Pulse glow
        const pulse = 1 + Math.sin(effect.progress * Math.PI * 8) * 0.2;
        effect.glowSprite.scale.set(1.5 * pulse, 1.5 * pulse, 1);

        // Update trail positions (shift and add new)
        effect.trailPositions.pop();
        effect.trailPositions.unshift(effect.currentPos.clone());

        // Update trail geometry
        this.updateTrailGeometry(effect);
      }
    }

    for (const id of toRemove) {
      this.projectileEffects.delete(id);
    }
  }

  private updateTrailGeometry(effect: ProjectileEffect): void {
    const positions = effect.trailGeometry.getAttribute('position') as THREE.BufferAttribute;
    const array = positions.array as Float32Array;

    // Calculate direction for ribbon width
    const direction = _tempVec1.subVectors(effect.endPos, effect.startPos).normalize();
    const up = _tempVec2.set(0, 1, 0);
    const right = _tempVec3.crossVectors(direction, up).normalize().multiplyScalar(0.08);

    for (let i = 0; i < effect.trailPositions.length; i++) {
      const pos = effect.trailPositions[i];
      const fadeRatio = i / effect.trailPositions.length;
      const width = right.clone().multiplyScalar(1 - fadeRatio * 0.8);

      // Left vertex
      array[i * 6] = pos.x - width.x;
      array[i * 6 + 1] = pos.y - width.y;
      array[i * 6 + 2] = pos.z - width.z;

      // Right vertex
      array[i * 6 + 3] = pos.x + width.x;
      array[i * 6 + 4] = pos.y + width.y;
      array[i * 6 + 5] = pos.z + width.z;
    }

    positions.needsUpdate = true;
    effect.trailGeometry.computeBoundingSphere();

    // Fade trail material
    const mat = effect.trailMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.6 * (1 - effect.progress * 0.5);
  }

  private updateGroundEffects(dt: number): void {
    for (let i = this.groundEffects.length - 1; i >= 0; i--) {
      const effect = this.groundEffects[i];
      effect.progress += dt / effect.duration;

      if (effect.progress >= 1) {
        // Reset geometry if we changed it
        if (effect.type === 'death') {
          effect.mesh.geometry = this.groundRingGeometry;
        }
        this.releaseToPool(this.groundEffectPool, effect.mesh);
        this.groundEffects.splice(i, 1);
      } else {
        // Scale and fade
        const scale = effect.startScale + (effect.endScale - effect.startScale) * effect.progress;
        effect.mesh.scale.set(scale, scale, 1);

        const material = effect.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = (1 - effect.progress) * 0.9;

        // Keep at correct height
        effect.mesh.position.y = effect.position.y + effect.heightOffset;
      }
    }
  }

  private updateImpactDecals(dt: number): void {
    for (let i = this.impactDecals.length - 1; i >= 0; i--) {
      const decal = this.impactDecals[i];
      decal.progress += dt / decal.duration;

      if (decal.progress >= 1) {
        this.releaseToPool(this.decalPool, decal.mesh);
        this.impactDecals.splice(i, 1);
      } else if (decal.progress > decal.fadeStart) {
        // Fade out
        const fadeProgress = (decal.progress - decal.fadeStart) / (1 - decal.fadeStart);
        (decal.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - fadeProgress);
      }
    }
  }

  private updateExplosions(dt: number): void {
    const gravity = -20;

    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const explosion = this.explosionEffects[i];
      explosion.progress += dt / explosion.duration;

      if (explosion.progress >= 1) {
        // Cleanup
        if (explosion.coreFlash) this.releaseToPool(this.explosionCorePool, explosion.coreFlash);
        if (explosion.shockwaveRing) this.releaseToPool(this.shockwavePool, explosion.shockwaveRing);
        for (const debris of explosion.debrisParticles) {
          this.releaseToPool(this.debrisPool, debris.mesh);
        }
        this.explosionEffects.splice(i, 1);
      } else {
        // Update core flash (quick fade)
        if (explosion.coreFlash && explosion.progress < 0.15) {
          const flashProgress = explosion.progress / 0.15;
          const scale = explosion.intensity * (1 + flashProgress);
          explosion.coreFlash.scale.setScalar(scale);
          (explosion.coreFlash.material as THREE.MeshBasicMaterial).opacity = 1 - flashProgress;
        } else if (explosion.coreFlash) {
          explosion.coreFlash.visible = false;
        }

        // Update shockwave
        if (explosion.shockwaveRing) {
          const shockwaveProgress = Math.min(explosion.progress * 2, 1);
          const scale = 0.5 + shockwaveProgress * 4 * explosion.intensity;
          explosion.shockwaveRing.scale.set(scale, scale, 1);
          (explosion.shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - shockwaveProgress);
        }

        // Update debris
        for (const debris of explosion.debrisParticles) {
          debris.velocity.y += gravity * dt;
          debris.mesh.position.x += debris.velocity.x * dt;
          debris.mesh.position.y += debris.velocity.y * dt;
          debris.mesh.position.z += debris.velocity.z * dt;

          // Rotation
          debris.mesh.rotation.x += debris.angularVelocity.x * dt;
          debris.mesh.rotation.y += debris.angularVelocity.y * dt;
          debris.mesh.rotation.z += debris.angularVelocity.z * dt;

          // Ground collision
          if (debris.mesh.position.y < debris.groundY + 0.1) {
            debris.mesh.position.y = debris.groundY + 0.1;
            if (!debris.bounced && debris.velocity.y < -2) {
              debris.velocity.y *= -0.3;
              debris.velocity.x *= 0.5;
              debris.velocity.z *= 0.5;
              debris.angularVelocity.multiplyScalar(0.5);
              debris.bounced = true;
            } else {
              debris.velocity.y = 0;
              debris.velocity.x *= 0.9;
              debris.velocity.z *= 0.9;
            }
          }

          // Fade in second half
          if (explosion.progress > 0.5) {
            const fadeProgress = (explosion.progress - 0.5) * 2;
            (debris.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - fadeProgress;
          }
        }
      }
    }
  }

  private updateSparks(dt: number): void {
    const gravity = -15;
    let needsUpdate = false;

    for (let i = 0; i < this.maxSparks; i++) {
      const spark = this.sparkParticles[i];

      if (spark.life <= 0) {
        this.sparkPositions[i * 3 + 1] = -1000;
        continue;
      }

      needsUpdate = true;
      spark.life -= dt;

      if (spark.life <= 0) {
        this.sparkPositions[i * 3 + 1] = -1000;
        continue;
      }

      // Physics
      spark.velocity.y += gravity * dt;
      spark.velocity.multiplyScalar(0.98);
      spark.position.add(_tempVec1.copy(spark.velocity).multiplyScalar(dt));

      // Update buffer
      this.sparkPositions[i * 3] = spark.position.x;
      this.sparkPositions[i * 3 + 1] = spark.position.y;
      this.sparkPositions[i * 3 + 2] = spark.position.z;

      // Fade
      const lifeRatio = spark.life / spark.maxLife;
      this.sparkColors[i * 4 + 3] = lifeRatio;
      this.sparkSizes[i] = spark.size * lifeRatio;
    }

    if (needsUpdate) {
      (this.sparkGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.sparkGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      (this.sparkGeometry.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateFocusFireIndicators(dt: number): void {
    for (const indicator of this.focusFireIndicators.values()) {
      indicator.pulseTime += dt * 4;
      const pulse = 0.8 + Math.sin(indicator.pulseTime) * 0.2;
      indicator.mesh.scale.set(pulse, pulse, 1);

      const baseOpacity = Math.min(0.4 + indicator.attackerCount * 0.15, 0.9);
      (indicator.mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity * pulse;
    }
  }

  private updateMoveIndicators(dt: number): void {
    for (let i = this.moveIndicators.length - 1; i >= 0; i--) {
      const indicator = this.moveIndicators[i];
      indicator.progress += dt / indicator.duration;

      if (indicator.progress >= 1) {
        for (const ring of indicator.rings) {
          this.releaseToPool(this.moveRingPool, ring);
        }
        this.moveIndicators.splice(i, 1);
      } else {
        for (let j = 0; j < indicator.rings.length; j++) {
          const ring = indicator.rings[j];
          const baseScale = 1 + j * 0.8;
          const shrink = 1 - indicator.progress * 0.5;
          ring.scale.set(baseScale * shrink, baseScale * shrink, 1);
          const baseOpacity = 0.9 - j * 0.2;
          (ring.material as THREE.MeshBasicMaterial).opacity = baseOpacity * (1 - indicator.progress);
        }
      }
    }
  }

  // ============================================
  // DEBUG & CLEANUP
  // ============================================

  public getDebugStats(): {
    projectiles: number;
    groundEffects: number;
    decals: number;
    explosions: number;
    sparks: number;
    focusFire: number;
    moveIndicators: number;
  } {
    let activeSparks = 0;
    for (const spark of this.sparkParticles) {
      if (spark.life > 0) activeSparks++;
    }

    return {
      projectiles: this.projectileEffects.size,
      groundEffects: this.groundEffects.length,
      decals: this.impactDecals.length,
      explosions: this.explosionEffects.length,
      sparks: activeSparks,
      focusFire: this.focusFireIndicators.size,
      moveIndicators: this.moveIndicators.length,
    };
  }

  public dispose(): void {
    // Unsubscribe from all events
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers = [];

    // Cleanup all active effects
    for (const effect of this.projectileEffects.values()) {
      this.scene.remove(effect.trailMesh);
      effect.trailGeometry.dispose();
      (effect.trailMesh.material as THREE.Material).dispose();
    }
    this.projectileEffects.clear();

    for (const indicator of this.focusFireIndicators.values()) {
      this.scene.remove(indicator.mesh);
      (indicator.mesh.material as THREE.Material).dispose();
    }
    this.focusFireIndicators.clear();

    // Cleanup all active laser effects
    for (const effect of this.laserEffects) {
      this.cleanupLaserEffect(effect);
    }
    // Note: cleanupLaserEffect removes from set, but clear anyway for safety
    this.laserEffects.clear();

    // Dispose pools
    const disposeMeshPool = (pool: MeshPool) => {
      for (const mesh of [...pool.available, ...pool.inUse]) {
        this.scene.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
          (mesh.material as THREE.Material).dispose();
        }
      }
    };

    disposeMeshPool(this.projectileHeadPool);
    disposeMeshPool(this.projectileGlowPool as unknown as MeshPool);
    disposeMeshPool(this.groundEffectPool);
    disposeMeshPool(this.decalPool);
    disposeMeshPool(this.debrisPool);
    disposeMeshPool(this.explosionCorePool);
    disposeMeshPool(this.shockwavePool);
    disposeMeshPool(this.moveRingPool);

    // Dispose spark system
    this.scene.remove(this.sparkMesh);
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();

    // Dispose shared resources
    this.projectileHeadGeometry.dispose();
    this.groundRingGeometry.dispose();
    this.largeRingGeometry.dispose();
    this.shockwaveGeometry.dispose();
    this.decalGeometry.dispose();
    this.debrisGeometry.dispose();
    this.explosionCoreGeometry.dispose();
    this.moveRingGeometry.dispose();

    this.projectileHeadMaterial.dispose();
    this.trailMaterial.dispose();
    this.groundEffectMaterial.dispose();
    this.deathEffectMaterial.dispose();
    this.shockwaveMaterial.dispose();
    this.decalMaterial.dispose();
    this.debrisMaterial.dispose();
    this.explosionCoreMaterial.dispose();
    this.focusFireMaterial.dispose();
    this.moveIndicatorMaterial.dispose();
    this.glowSpriteMaterial.dispose();

    this.glowTexture.dispose();
    this.scorchTexture.dispose();
  }
}
