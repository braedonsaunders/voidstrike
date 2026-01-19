import * as THREE from 'three';
import { LightPool } from './LightPool';

/**
 * Rendering hints for decorations defined in assets.json
 */
export interface DecorationRenderingHints {
  envMapIntensity?: number;
  emissive?: string | null; // Hex color string like "#00ff88"
  emissiveIntensity?: number;
  roughnessOverride?: number | null;
  metalnessOverride?: number | null;
  receiveShadow?: boolean;
  castShadow?: boolean;
  pulseSpeed?: number; // Animation speed for emissive pulsing
  pulseAmplitude?: number; // How much intensity varies (0-1)
  attachLight?: {
    color: string;
    intensity: number;
    distance: number;
  } | null;
}

/**
 * Tracked emissive decoration for animation
 */
interface EmissiveDecoration {
  mesh: THREE.Mesh | THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
  pulseSpeed: number;
  pulseAmplitude: number;
  attachedLightId?: string;
  position: THREE.Vector3;
}

/**
 * Tracked instanced decoration (shared material, no per-instance lights)
 */
interface InstancedEmissiveDecoration {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
  pulseSpeed: number;
  pulseAmplitude: number;
}

/**
 * Manages emissive decorations (crystals, alien structures) with optional attached lights.
 * Supports pulsing animations and per-decoration light emission.
 */
export class EmissiveDecorationManager {
  private scene: THREE.Scene;
  private lightPool: LightPool | null;
  private decorations: EmissiveDecoration[] = [];
  private instancedDecorations: InstancedEmissiveDecoration[] = [];
  private enabled: boolean = true;
  private intensityMultiplier: number = 1.0;
  private time: number = 0;

  constructor(scene: THREE.Scene, lightPool: LightPool | null = null) {
    this.scene = scene;
    this.lightPool = lightPool;
  }

  /**
   * Register an InstancedMesh for uniform emissive control.
   * All instances share the same material, so emissive changes affect all.
   * Use this for crystalline fields, fungal growths, or other batch decorations.
   *
   * Note: Per-instance lights are not supported - use DecorationLightManager
   * for distance-sorted, frustum-culled decoration lights.
   */
  public registerInstancedDecoration(
    mesh: THREE.InstancedMesh,
    hints: DecorationRenderingHints
  ): void {
    if (!hints.emissive) return;

    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material || !(material instanceof THREE.MeshStandardMaterial)) return;

    const emissiveColor = new THREE.Color(hints.emissive);
    const emissiveIntensity = hints.emissiveIntensity ?? 1.0;

    // Apply initial emissive to material
    material.emissive = emissiveColor;
    material.emissiveIntensity = emissiveIntensity * this.intensityMultiplier;

    this.instancedDecorations.push({
      mesh,
      material,
      baseEmissive: emissiveColor.clone(),
      baseIntensity: emissiveIntensity,
      pulseSpeed: hints.pulseSpeed ?? 0,
      pulseAmplitude: hints.pulseAmplitude ?? 0,
    });
  }

  /**
   * Register a decoration mesh with emissive properties
   */
  public registerDecoration(
    mesh: THREE.Mesh | THREE.InstancedMesh,
    hints: DecorationRenderingHints,
    position: THREE.Vector3
  ): void {
    if (!hints.emissive) return;

    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material || !(material instanceof THREE.MeshStandardMaterial)) return;

    const emissiveColor = new THREE.Color(hints.emissive);
    const emissiveIntensity = hints.emissiveIntensity ?? 1.0;

    // Apply emissive to material
    material.emissive = emissiveColor;
    material.emissiveIntensity = emissiveIntensity * this.intensityMultiplier;

    const decoration: EmissiveDecoration = {
      mesh,
      material,
      baseEmissive: emissiveColor.clone(),
      baseIntensity: emissiveIntensity,
      pulseSpeed: hints.pulseSpeed ?? 0,
      pulseAmplitude: hints.pulseAmplitude ?? 0,
      position: position.clone(),
    };

    // Attach light if specified and light pool available
    if (hints.attachLight && this.lightPool) {
      const lightId = this.lightPool.spawn({
        position,
        color: new THREE.Color(hints.attachLight.color),
        intensity: hints.attachLight.intensity * this.intensityMultiplier,
        distance: hints.attachLight.distance,
        duration: Infinity, // Permanent light
        fadeOut: false,
      });
      if (lightId) {
        decoration.attachedLightId = lightId;
      }
    }

    this.decorations.push(decoration);
  }

  /**
   * Apply rendering hints to a material (static, non-animated)
   */
  public static applyHintsToMaterial(
    material: THREE.MeshStandardMaterial,
    hints: DecorationRenderingHints
  ): void {
    if (hints.envMapIntensity !== undefined) {
      material.envMapIntensity = hints.envMapIntensity;
    }
    if (hints.emissive) {
      material.emissive = new THREE.Color(hints.emissive);
      material.emissiveIntensity = hints.emissiveIntensity ?? 1.0;
    }
    if (hints.roughnessOverride !== null && hints.roughnessOverride !== undefined) {
      material.roughness = hints.roughnessOverride;
    }
    if (hints.metalnessOverride !== null && hints.metalnessOverride !== undefined) {
      material.metalness = hints.metalnessOverride;
    }
  }

  /**
   * Update all emissive decorations (call every frame)
   */
  public update(deltaTime: number): void {
    if (!this.enabled) return;

    this.time += deltaTime * 0.001; // Convert to seconds

    // Update individual decorations
    for (const deco of this.decorations) {
      if (deco.pulseSpeed > 0 && deco.pulseAmplitude > 0) {
        const pulse = 1.0 + Math.sin(this.time * deco.pulseSpeed * Math.PI * 2) * deco.pulseAmplitude;
        const finalIntensity = deco.baseIntensity * pulse * this.intensityMultiplier;
        deco.material.emissiveIntensity = finalIntensity;

        // Note: LightPool doesn't expose direct intensity control after spawn
        // For proper pulsing lights, we'd need to extend LightPool
      }
    }

    // Update instanced decorations (shared material animation)
    for (const deco of this.instancedDecorations) {
      if (deco.pulseSpeed > 0 && deco.pulseAmplitude > 0) {
        const pulse = 1.0 + Math.sin(this.time * deco.pulseSpeed * Math.PI * 2) * deco.pulseAmplitude;
        const finalIntensity = deco.baseIntensity * pulse * this.intensityMultiplier;
        deco.material.emissiveIntensity = finalIntensity;
      }
    }
  }

  /**
   * Set whether emissive decorations are enabled
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    // Update individual decorations
    for (const deco of this.decorations) {
      if (enabled) {
        deco.material.emissive = deco.baseEmissive;
        deco.material.emissiveIntensity = deco.baseIntensity * this.intensityMultiplier;
      } else {
        deco.material.emissive = new THREE.Color(0x000000);
        deco.material.emissiveIntensity = 0;
      }
    }

    // Update instanced decorations
    for (const deco of this.instancedDecorations) {
      if (enabled) {
        deco.material.emissive = deco.baseEmissive;
        deco.material.emissiveIntensity = deco.baseIntensity * this.intensityMultiplier;
      } else {
        deco.material.emissive = new THREE.Color(0x000000);
        deco.material.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Set global emissive intensity multiplier
   */
  public setIntensityMultiplier(multiplier: number): void {
    this.intensityMultiplier = multiplier;

    for (const deco of this.decorations) {
      deco.material.emissiveIntensity = deco.baseIntensity * multiplier;
    }

    for (const deco of this.instancedDecorations) {
      deco.material.emissiveIntensity = deco.baseIntensity * multiplier;
    }
  }

  /**
   * Get count of registered emissive decorations (individual + instanced)
   */
  public getDecorationCount(): number {
    return this.decorations.length + this.instancedDecorations.length;
  }

  /**
   * Clear all registered decorations
   */
  public clear(): void {
    // Release attached lights
    if (this.lightPool) {
      for (const deco of this.decorations) {
        if (deco.attachedLightId) {
          this.lightPool.releaseImmediate(deco.attachedLightId);
        }
      }
    }
    this.decorations = [];
    this.instancedDecorations = [];
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.clear();
  }
}

/**
 * Parse rendering hints from assets.json decoration entry
 */
export function parseRenderingHints(entry: any): DecorationRenderingHints | null {
  if (!entry || !entry.rendering) return null;

  const r = entry.rendering;
  return {
    envMapIntensity: r.envMapIntensity,
    emissive: r.emissive,
    emissiveIntensity: r.emissiveIntensity,
    roughnessOverride: r.roughnessOverride,
    metalnessOverride: r.metalnessOverride,
    receiveShadow: r.receiveShadow,
    castShadow: r.castShadow,
    pulseSpeed: r.pulseSpeed,
    pulseAmplitude: r.pulseAmplitude,
    attachLight: r.attachLight,
  };
}
