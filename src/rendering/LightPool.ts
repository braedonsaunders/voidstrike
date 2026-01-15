import * as THREE from 'three';

/**
 * Pooled dynamic light system for efficient transient lighting effects.
 * Used for explosions, muzzle flashes, ability effects, etc.
 *
 * Performance: Pre-allocates lights to avoid runtime allocation.
 * Lights are recycled and reused for different effects.
 */

export interface LightSpawnOptions {
  position: THREE.Vector3;
  color: THREE.Color | number;
  intensity: number;
  distance: number;
  duration: number; // milliseconds
  fadeOut?: boolean; // Gradually reduce intensity
  decay?: number; // Light decay (default 2 for physically correct)
}

interface ActiveLight {
  light: THREE.PointLight;
  startTime: number;
  duration: number;
  initialIntensity: number;
  fadeOut: boolean;
}

export class LightPool {
  private scene: THREE.Scene;
  private pool: THREE.PointLight[] = [];
  private active: Map<string, ActiveLight> = new Map();
  private maxLights: number;
  private enabled: boolean = true;
  private nextId: number = 0;

  constructor(scene: THREE.Scene, maxLights: number = 16) {
    this.scene = scene;
    this.maxLights = maxLights;
    this.initializePool();
  }

  private initializePool(): void {
    for (let i = 0; i < this.maxLights; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.visible = false;
      light.castShadow = false; // Dynamic lights don't cast shadows (performance)
      this.scene.add(light);
      this.pool.push(light);
    }
  }

  /**
   * Spawn a temporary light effect
   * @returns Light ID for manual release, or null if pool exhausted
   */
  public spawn(options: LightSpawnOptions): string | null {
    if (!this.enabled) return null;

    // Find available light
    const light = this.pool.find(l => !l.visible);
    if (!light) {
      // Pool exhausted - find oldest active light and recycle it
      let oldest: { id: string; entry: ActiveLight } | null = null;
      for (const [id, entry] of this.active) {
        if (!oldest || entry.startTime < oldest.entry.startTime) {
          oldest = { id, entry };
        }
      }
      if (oldest) {
        this.releaseImmediate(oldest.id);
        return this.spawn(options);
      }
      return null;
    }

    const id = `light_${this.nextId++}`;
    const color = options.color instanceof THREE.Color
      ? options.color
      : new THREE.Color(options.color);

    light.position.copy(options.position);
    light.color.copy(color);
    light.intensity = options.intensity;
    light.distance = options.distance;
    light.decay = options.decay ?? 2;
    light.visible = true;

    this.active.set(id, {
      light,
      startTime: performance.now(),
      duration: options.duration,
      initialIntensity: options.intensity,
      fadeOut: options.fadeOut ?? true,
    });

    return id;
  }

  /**
   * Spawn a quick flash effect (common preset)
   */
  public flash(position: THREE.Vector3, color: number = 0xffaa00, intensity: number = 3): string | null {
    return this.spawn({
      position,
      color,
      intensity,
      distance: 8,
      duration: 100,
      fadeOut: true,
    });
  }

  /**
   * Spawn an explosion light (common preset)
   */
  public explosion(position: THREE.Vector3, scale: number = 1): string | null {
    return this.spawn({
      position,
      color: 0xff6600,
      intensity: 5 * scale,
      distance: 12 * scale,
      duration: 400,
      fadeOut: true,
    });
  }

  /**
   * Spawn a laser/energy impact light (common preset)
   */
  public energyImpact(position: THREE.Vector3, color: number = 0x00ffff): string | null {
    return this.spawn({
      position,
      color,
      intensity: 4,
      distance: 6,
      duration: 150,
      fadeOut: true,
    });
  }

  /**
   * Update all active lights (call every frame)
   */
  public update(): void {
    if (!this.enabled) return;

    const now = performance.now();
    const toRelease: string[] = [];

    for (const [id, entry] of this.active) {
      const elapsed = now - entry.startTime;

      if (elapsed >= entry.duration) {
        toRelease.push(id);
        continue;
      }

      // Apply fade out
      if (entry.fadeOut) {
        const progress = elapsed / entry.duration;
        const fadeMultiplier = 1 - progress;
        entry.light.intensity = entry.initialIntensity * fadeMultiplier;
      }
    }

    // Release expired lights
    for (const id of toRelease) {
      this.releaseImmediate(id);
    }
  }

  /**
   * Immediately release a light back to pool
   */
  public releaseImmediate(id: string): void {
    const entry = this.active.get(id);
    if (entry) {
      entry.light.visible = false;
      entry.light.intensity = 0;
      this.active.delete(id);
    }
  }

  /**
   * Set whether dynamic lights are enabled
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // Turn off all active lights
      for (const [id] of this.active) {
        this.releaseImmediate(id);
      }
    }
  }

  /**
   * Resize the light pool
   */
  public setMaxLights(maxLights: number): void {
    if (maxLights === this.maxLights) return;

    if (maxLights > this.maxLights) {
      // Add more lights
      for (let i = this.maxLights; i < maxLights; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 10, 2);
        light.visible = false;
        light.castShadow = false;
        this.scene.add(light);
        this.pool.push(light);
      }
    } else {
      // Remove excess lights (release active ones first)
      while (this.pool.length > maxLights) {
        const light = this.pool.pop();
        if (light) {
          light.visible = false;
          this.scene.remove(light);
          light.dispose();
        }
      }
    }

    this.maxLights = maxLights;
  }

  /**
   * Get current active light count
   */
  public getActiveCount(): number {
    return this.active.size;
  }

  /**
   * Dispose all lights
   */
  public dispose(): void {
    for (const light of this.pool) {
      light.visible = false;
      this.scene.remove(light);
      light.dispose();
    }
    this.pool = [];
    this.active.clear();
  }
}
