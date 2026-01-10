/**
 * TSL Selection Ring Material
 *
 * WebGPU-compatible animated selection rings with:
 * - Glowing team-colored rings with pulsing animation
 * - Multiple concentric rings for selected units
 * - Subtle rotation animation
 * - Hover highlight effect
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  color,
  Fn,
  sin,
  cos,
  atan2,
  length,
  smoothstep,
  mix,
  pow,
  abs,
} from 'three/tsl';

// ============================================
// TEAM COLORS
// ============================================

export const TEAM_COLORS = {
  player1: new THREE.Color(0x00d4ff), // Bright cyan blue
  player2: new THREE.Color(0xff3030), // Bright red
  player3: new THREE.Color(0x30ff30), // Bright green
  player4: new THREE.Color(0xffff30), // Yellow
  ai: new THREE.Color(0xff3030),      // Red for AI
  neutral: new THREE.Color(0x888888), // Gray
};

// ============================================
// SELECTION RING MATERIAL
// ============================================

export interface SelectionRingConfig {
  color: THREE.Color;
  opacity?: number;
  isGlow?: boolean;
}

/**
 * Create an animated selection ring material using TSL
 */
export function createSelectionRingMaterial(config: SelectionRingConfig): MeshBasicNodeMaterial {
  const uColor = uniform(config.color);
  const uTime = uniform(0);
  const uOpacity = uniform(config.opacity ?? 0.9);
  const uIsGlow = uniform(config.isGlow ? 1.0 : 0.0);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;

  // Fragment shader
  material.colorNode = Fn(() => {
    // Calculate radial distance from center of UV
    const center = vec2(0.5, 0.5);
    const dist = length(uv().sub(center)).mul(2.0);

    // Pulsing animation
    const pulse = float(0.85).add(sin(uTime.mul(3.0)).mul(0.15));

    // Rotating shimmer effect
    const uvCentered = uv().sub(0.5);
    const angle = atan2(uvCentered.y, uvCentered.x);
    const shimmer = float(0.9).add(sin(angle.mul(8.0).add(uTime.mul(2.0))).mul(0.1));

    // Glow falloff for glow ring
    const glowFalloff = mix(
      float(1.0),
      float(1.0).sub(smoothstep(0.3, 1.0, dist)),
      uIsGlow
    );

    // Final color with effects
    const finalColor = uColor.mul(pulse).mul(shimmer);
    const finalOpacity = uOpacity.mul(glowFalloff).mul(pulse);

    return vec4(finalColor, finalOpacity);
  })();

  // Store uniforms for external updates
  (material as any)._uniforms = { uTime, uColor, uOpacity };

  return material;
}

/**
 * Create hover ring material
 */
export function createHoverRingMaterial(): MeshBasicNodeMaterial {
  const uColor = uniform(new THREE.Color(0xffffff));
  const uTime = uniform(0);
  const uOpacity = uniform(0.3);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  material.colorNode = Fn(() => {
    const pulse = float(0.7).add(sin(uTime.mul(5.0)).mul(0.3));
    return vec4(uColor, uOpacity.mul(pulse));
  })();

  (material as any)._uniforms = { uTime, uColor, uOpacity };

  return material;
}

/**
 * Update selection ring animation
 */
export function updateSelectionMaterial(material: MeshBasicNodeMaterial, time: number): void {
  const uniforms = (material as any)._uniforms;
  if (uniforms?.uTime) {
    uniforms.uTime.value = time;
  }
}

// ============================================
// SELECTION SYSTEM CLASS
// ============================================

interface SelectionRingData {
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  glowRing: THREE.Mesh;
  createdAt: number;
  baseScale: number;
}

export class SelectionSystem {
  private scene: THREE.Scene;
  private selectionRings: Map<number, SelectionRingData> = new Map();
  private hoverRing: THREE.Mesh | null = null;
  private hoverTargetId: number | null = null;

  // Shared geometries
  private outerRingGeometry: THREE.RingGeometry;
  private innerRingGeometry: THREE.RingGeometry;
  private glowRingGeometry: THREE.RingGeometry;

  // Animation timing
  private animationTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create ring geometries with high segment count
    this.outerRingGeometry = new THREE.RingGeometry(0.85, 1.0, 64);
    this.innerRingGeometry = new THREE.RingGeometry(0.7, 0.75, 64);
    this.glowRingGeometry = new THREE.RingGeometry(0.5, 1.2, 64);

    this.createHoverRing();
  }

  private createHoverRing(): void {
    const geometry = new THREE.RingGeometry(0.9, 1.05, 64);
    const material = createHoverRingMaterial();

    this.hoverRing = new THREE.Mesh(geometry, material);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  createSelectionRing(entityId: number, playerId: string, size: number = 1): void {
    if (this.selectionRings.has(entityId)) return;

    const teamColor = TEAM_COLORS[playerId as keyof typeof TEAM_COLORS] ?? TEAM_COLORS.neutral;

    // Outer ring - bright, solid
    const outerMaterial = createSelectionRingMaterial({ color: teamColor, opacity: 0.9 });
    const outerRing = new THREE.Mesh(this.outerRingGeometry, outerMaterial);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.scale.setScalar(size);

    // Inner ring - slightly darker, offset animation
    const innerColor = teamColor.clone().multiplyScalar(0.7);
    const innerMaterial = createSelectionRingMaterial({ color: innerColor, opacity: 0.6 });
    const innerRing = new THREE.Mesh(this.innerRingGeometry, innerMaterial);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.scale.setScalar(size);

    // Glow ring - soft outer glow
    const glowMaterial = createSelectionRingMaterial({ color: teamColor, opacity: 0.3, isGlow: true });
    const glowRing = new THREE.Mesh(this.glowRingGeometry, glowMaterial);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.scale.setScalar(size * 1.1);

    this.scene.add(outerRing);
    this.scene.add(innerRing);
    this.scene.add(glowRing);

    this.selectionRings.set(entityId, {
      outerRing,
      innerRing,
      glowRing,
      createdAt: performance.now(),
      baseScale: size,
    });
  }

  updateSelectionRing(entityId: number, x: number, y: number, z: number): void {
    const ring = this.selectionRings.get(entityId);
    if (!ring) return;

    ring.outerRing.position.set(x, y + 0.05, z);
    ring.innerRing.position.set(x, y + 0.03, z);
    ring.glowRing.position.set(x, y + 0.01, z);
  }

  removeSelectionRing(entityId: number): void {
    const ring = this.selectionRings.get(entityId);
    if (!ring) return;

    this.scene.remove(ring.outerRing);
    this.scene.remove(ring.innerRing);
    this.scene.remove(ring.glowRing);

    (ring.outerRing.material as THREE.Material).dispose();
    (ring.innerRing.material as THREE.Material).dispose();
    (ring.glowRing.material as THREE.Material).dispose();

    this.selectionRings.delete(entityId);
  }

  showHoverRing(entityId: number, x: number, y: number, z: number, size: number = 1): void {
    if (!this.hoverRing) return;

    // Don't show hover on already selected entities
    if (this.selectionRings.has(entityId)) {
      this.hideHoverRing();
      return;
    }

    this.hoverTargetId = entityId;
    this.hoverRing.position.set(x, y + 0.02, z);
    this.hoverRing.scale.setScalar(size);
    this.hoverRing.visible = true;
  }

  hideHoverRing(): void {
    if (this.hoverRing) {
      this.hoverRing.visible = false;
    }
    this.hoverTargetId = null;
  }

  update(deltaTime: number): void {
    this.animationTime += deltaTime / 1000;

    // Update all selection ring animations
    for (const [entityId, ring] of this.selectionRings) {
      const age = (performance.now() - ring.createdAt) / 1000;

      // Update shader uniforms
      updateSelectionMaterial(ring.outerRing.material as MeshBasicNodeMaterial, this.animationTime);
      updateSelectionMaterial(ring.innerRing.material as MeshBasicNodeMaterial, this.animationTime + 0.5);
      updateSelectionMaterial(ring.glowRing.material as MeshBasicNodeMaterial, this.animationTime);

      // Subtle rotation for visual interest
      ring.outerRing.rotation.z = this.animationTime * 0.1;
      ring.innerRing.rotation.z = -this.animationTime * 0.15;

      // Scale-in animation when first created
      if (age < 0.2) {
        const scaleProgress = age / 0.2;
        const easeOut = 1 - Math.pow(1 - scaleProgress, 3);
        const scale = ring.baseScale * easeOut;
        ring.outerRing.scale.setScalar(scale);
        ring.innerRing.scale.setScalar(scale);
        ring.glowRing.scale.setScalar(scale * 1.1);
      }
    }

    // Update hover ring
    if (this.hoverRing && this.hoverRing.visible) {
      updateSelectionMaterial(this.hoverRing.material as MeshBasicNodeMaterial, this.animationTime);
    }
  }

  dispose(): void {
    // Dispose all selection rings
    for (const ring of this.selectionRings.values()) {
      this.scene.remove(ring.outerRing);
      this.scene.remove(ring.innerRing);
      this.scene.remove(ring.glowRing);
      (ring.outerRing.material as THREE.Material).dispose();
      (ring.innerRing.material as THREE.Material).dispose();
      (ring.glowRing.material as THREE.Material).dispose();
    }
    this.selectionRings.clear();

    // Dispose hover ring
    if (this.hoverRing) {
      this.scene.remove(this.hoverRing);
      this.hoverRing.geometry.dispose();
      (this.hoverRing.material as THREE.Material).dispose();
    }

    // Dispose shared geometries
    this.outerRingGeometry.dispose();
    this.innerRingGeometry.dispose();
    this.glowRingGeometry.dispose();
  }
}
