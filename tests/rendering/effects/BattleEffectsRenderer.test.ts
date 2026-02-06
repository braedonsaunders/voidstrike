import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BattleEffectsRenderer - Pool Release Regression Tests
 *
 * Validates that ground effects release meshes back to their correct source pools.
 * Bug: createSplashEffect acquired from shockwavePool but updateGroundEffects
 * released to groundEffectPool, causing a silent no-op (mesh not in that pool's
 * inUse set) and permanent mesh leak in the scene.
 */

// vi.mock factories are hoisted - all mock classes must be defined inside the factory
vi.mock('three', () => {
  class Vec3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    copy(v: Vec3) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    clone() {
      return new Vec3(this.x, this.y, this.z);
    }
    add(v: Vec3) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    }
    sub(v: Vec3) {
      this.x -= v.x;
      this.y -= v.y;
      this.z -= v.z;
      return this;
    }
    subVectors(a: Vec3, b: Vec3) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      return this;
    }
    addVectors(a: Vec3, b: Vec3) {
      this.x = a.x + b.x;
      this.y = a.y + b.y;
      this.z = a.z + b.z;
      return this;
    }
    lerpVectors(a: Vec3, b: Vec3, t: number) {
      this.x = a.x + (b.x - a.x) * t;
      this.y = a.y + (b.y - a.y) * t;
      this.z = a.z + (b.z - a.z) * t;
      return this;
    }
    normalize() {
      const l = this.length() || 1;
      this.x /= l;
      this.y /= l;
      this.z /= l;
      return this;
    }
    multiplyScalar(s: number) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
    addScaledVector(v: Vec3, s: number) {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    setScalar(s: number) {
      this.x = s;
      this.y = s;
      this.z = s;
      return this;
    }
  }

  class Clr {
    r = 1;
    g = 1;
    b = 1;
    setHex() {
      return this;
    }
    copy() {
      return this;
    }
    set() {
      return this;
    }
    lerp() {
      return this;
    }
    multiplyScalar() {
      return this;
    }
  }

  class Mat {
    color = new Clr();
    opacity = 1;
    transparent = true;
    side = 0;
    depthTest = true;
    depthWrite = false;
    blending = 0;
    map = null;
    polygonOffset = false;
    polygonOffsetFactor = 0;
    polygonOffsetUnits = 0;
    sizeAttenuation = true;
    vertexColors = false;
    size = 1;
    constructor(opts?: Record<string, unknown>) {
      if (opts) Object.assign(this, opts);
      if (!(this.color instanceof Clr)) this.color = new Clr();
    }
    clone() {
      return new Mat();
    }
    dispose() {}
  }

  class Geo {
    private _attrs: Record<string, { needsUpdate: boolean }> = {};
    setAttribute(name: string) {
      this._attrs[name] = { needsUpdate: false };
    }
    getAttribute(name: string) {
      return this._attrs[name] ?? { needsUpdate: false };
    }
    dispose() {}
    attributes = {};
  }

  class Obj3D {
    position = new Vec3();
    scale = new Vec3(1, 1, 1);
    rotation = { x: 0, y: 0, z: 0 };
    visible = true;
    renderOrder = 0;
    parent: unknown = null;
    frustumCulled = true;
    material: Mat;
    constructor(_geo?: Geo, mat?: Mat) {
      this.material = mat ?? new Mat();
    }
    setRotationFromQuaternion() {}
  }

  class Scn {
    children: Obj3D[] = [];
    add(obj: Obj3D) {
      obj.parent = this;
      this.children.push(obj);
    }
    remove(obj: Obj3D) {
      obj.parent = null;
      const i = this.children.indexOf(obj);
      if (i >= 0) this.children.splice(i, 1);
    }
  }

  class Tex {
    dispose() {}
    needsUpdate = false;
    image = null;
  }
  class Quat {
    setFromUnitVectors() {
      return this;
    }
    setFromAxisAngle() {
      return this;
    }
  }
  class M4 {
    makeTranslation() {
      return this;
    }
    makeRotationY() {
      return this;
    }
    lookAt() {
      return this;
    }
    scale() {
      return this;
    }
    setPosition() {
      return this;
    }
  }

  return {
    Vector3: Vec3,
    Quaternion: Quat,
    Matrix4: M4,
    Color: Clr,
    SphereGeometry: Geo,
    RingGeometry: Geo,
    PlaneGeometry: Geo,
    BoxGeometry: Geo,
    CylinderGeometry: Geo,
    BufferGeometry: Geo,
    BufferAttribute: class {
      constructor() {}
    },
    Float32BufferAttribute: class {
      constructor() {}
    },
    InstancedBufferAttribute: class {
      constructor() {}
    },
    MeshBasicMaterial: Mat,
    SpriteMaterial: Mat,
    PointsMaterial: Mat,
    Mesh: Obj3D,
    Sprite: Obj3D,
    Points: Obj3D,
    InstancedMesh: class extends Obj3D {
      count = 0;
      instanceMatrix = { needsUpdate: false };
      instanceColor = { needsUpdate: false };
      setMatrixAt() {}
      setColorAt() {}
    },
    Scene: Scn,
    Texture: Tex,
    DataTexture: Tex,
    CanvasTexture: Tex,
    DoubleSide: 2,
    AdditiveBlending: 2,
  };
});

// Mock DOM for canvas-based texture creation
const mockGradient = { addColorStop: vi.fn() };
const mockCtx = {
  createRadialGradient: vi.fn().mockReturnValue(mockGradient),
  fillRect: vi.fn(),
  fillStyle: '',
  getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(128 * 128 * 4) }),
  putImageData: vi.fn(),
};
const mockCanvas = {
  width: 128,
  height: 128,
  getContext: vi.fn().mockReturnValue(mockCtx),
};
vi.stubGlobal('document', {
  createElement: vi.fn().mockReturnValue(mockCanvas),
});

vi.mock('@/store/gameSetupStore', () => ({
  getLocalPlayerId: vi.fn().mockReturnValue('player1'),
  isSpectatorMode: vi.fn().mockReturnValue(false),
}));

vi.mock('@/assets/AssetManager', () => ({
  AssetManager: { getAirborneHeight: vi.fn().mockReturnValue(5) },
  DEFAULT_AIRBORNE_HEIGHT: 5,
}));

vi.mock('@/utils/math', () => ({
  clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
}));

vi.mock('@/utils/debugLogger', () => ({
  debugInitialization: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import after mocks
import { BattleEffectsRenderer } from '@/rendering/effects/BattleEffectsRenderer';
import { EventBus } from '@/engine/core/EventBus';

describe('BattleEffectsRenderer', () => {
  let renderer: BattleEffectsRenderer;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    // Scene mock is provided by the 'three' mock above
    const THREE = require('three');
    const scene = new THREE.Scene();
    renderer = new BattleEffectsRenderer(scene, eventBus, () => 0);
  });

  describe('ground effect pool lifecycle', () => {
    it('cleans up splash effects after completion', () => {
      eventBus.emit('projectile:impact', {
        entityId: 1,
        position: { x: 10, y: 20, z: 0 },
        damageType: 'explosive',
        splashRadius: 5,
        faction: 'dominion',
        projectileId: 'test-proj',
      });

      const stats = renderer.getDebugStats();
      expect(stats.groundEffects).toBeGreaterThanOrEqual(1);

      // Advance past all effect durations (update takes ms)
      renderer.update(1000);

      const statsAfter = renderer.getDebugStats();
      expect(statsAfter.groundEffects).toBe(0);
    });

    it('cleans up death effects after completion', () => {
      eventBus.emit('unit:died', {
        entityId: 42,
        position: { x: 5, y: 15 },
        isFlying: false,
        unitType: 'marine',
      });

      const stats = renderer.getDebugStats();
      expect(stats.groundEffects).toBeGreaterThanOrEqual(1);

      renderer.update(1000);

      const statsAfter = renderer.getDebugStats();
      expect(statsAfter.groundEffects).toBe(0);
    });

    it('cleans up hit effects from instant weapons after completion', () => {
      eventBus.emit('combat:attack', {
        attackerPos: { x: 0, y: 0 },
        targetPos: { x: 10, y: 10 },
        damage: 10,
        damageType: 'normal',
        attackerIsFlying: false,
        targetIsFlying: false,
        attackerFaction: 'dominion',
      });

      renderer.update(2000);

      const statsAfter = renderer.getDebugStats();
      expect(statsAfter.groundEffects).toBe(0);
    });

    it('does not leak effects over multiple explosion cycles', () => {
      for (let i = 0; i < 10; i++) {
        eventBus.emit('building:destroyed', {
          entityId: i,
          playerId: 'player1',
          buildingType: 'headquarters',
          position: { x: i * 10, y: i * 10 },
        });
      }

      const statsDuring = renderer.getDebugStats();
      expect(statsDuring.explosions).toBeGreaterThan(0);

      // Advance well past explosion (1.2s) + decal duration (12s)
      for (let i = 0; i < 15; i++) {
        renderer.update(1000);
      }

      const statsAfter = renderer.getDebugStats();
      expect(statsAfter.explosions).toBe(0);
      expect(statsAfter.groundEffects).toBe(0);
      expect(statsAfter.decals).toBe(0);
    });

    it('does not leak splash shockwave effects over repeated impacts', () => {
      // Regression: splash effects acquired from shockwavePool were released to
      // groundEffectPool, causing releaseToPool to no-op (mesh not in pool's inUse set)
      for (let i = 0; i < 20; i++) {
        eventBus.emit('projectile:impact', {
          entityId: 100 + i,
          position: { x: i * 5, y: i * 5, z: 0 },
          damageType: 'explosive',
          splashRadius: 3,
          faction: 'dominion',
          projectileId: `proj-${i}`,
        });
      }

      const statsDuring = renderer.getDebugStats();
      expect(statsDuring.groundEffects).toBeGreaterThan(0);

      renderer.update(2000);

      const statsAfter = renderer.getDebugStats();
      expect(statsAfter.groundEffects).toBe(0);
    });
  });
});
