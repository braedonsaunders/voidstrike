/**
 * TSL Selection Ring Material
 *
 * WebGPU-compatible animated selection ring materials for instanced rendering.
 * Provides glowing, pulsing selection rings with team colors.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  uniform,
  uv,
  vec2,
  vec4,
  float,
  Fn,
  sin,
  atan,
  length,
  smoothstep,
  mix,
} from 'three/tsl';
import { UNIT_SELECTION_RING } from '@/data/rendering.config';

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
// SELECTION RING MATERIAL (INSTANCED)
// ============================================

export interface SelectionRingConfig {
  color: THREE.Color;
  opacity?: number;
  isGlow?: boolean;
}

// Shared time uniform for all selection ring materials
const globalTimeUniform = uniform(0);

/**
 * Update the global animation time for all selection ring materials
 */
export function updateSelectionRingTime(time: number): void {
  globalTimeUniform.value = time;
}

/**
 * Create an animated selection ring material using TSL.
 * Suitable for instanced rendering - shares global time uniform.
 */
export function createSelectionRingMaterial(config: SelectionRingConfig): MeshBasicNodeMaterial {
  const uColor = uniform(config.color);
  const uOpacity = uniform(config.opacity ?? UNIT_SELECTION_RING.OPACITY);
  const uIsGlow = uniform(config.isGlow ? 1.0 : 0.0);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;

  // Fragment shader with animation
  material.colorNode = Fn(() => {
    // Calculate radial distance from center of UV
    const center = vec2(0.5, 0.5);
    const dist = length(uv().sub(center)).mul(2.0);

    // Pulsing animation
    const pulse = float(1.0 - UNIT_SELECTION_RING.PULSE_INTENSITY / 2)
      .add(sin(globalTimeUniform.mul(UNIT_SELECTION_RING.PULSE_SPEED)).mul(UNIT_SELECTION_RING.PULSE_INTENSITY));

    // Rotating shimmer effect
    const uvCentered = uv().sub(0.5);
    const angle = atan(uvCentered.y, uvCentered.x);
    const shimmer = float(0.9).add(
      sin(angle.mul(UNIT_SELECTION_RING.SHIMMER_BANDS).add(globalTimeUniform.mul(UNIT_SELECTION_RING.SHIMMER_SPEED))).mul(0.1)
    );

    // Glow falloff for glow ring variant
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

  // Store uniforms for external access if needed
  (material as any)._uniforms = { uColor, uOpacity };

  return material;
}

/**
 * Create hover ring material (white, pulsing)
 */
export function createHoverRingMaterial(): MeshBasicNodeMaterial {
  const uColor = uniform(new THREE.Color(0xffffff));
  const uOpacity = uniform(0.3);

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  material.colorNode = Fn(() => {
    const pulse = float(0.7).add(sin(globalTimeUniform.mul(5.0)).mul(0.3));
    return vec4(uColor, uOpacity.mul(pulse));
  })();

  (material as any)._uniforms = { uColor, uOpacity };

  return material;
}

/**
 * @deprecated Use updateSelectionRingTime() instead for global time updates
 */
export function updateSelectionMaterial(material: MeshBasicNodeMaterial, time: number): void {
  // Legacy support - individual material time updates no longer needed
  // All materials now share globalTimeUniform
  updateSelectionRingTime(time);
}
