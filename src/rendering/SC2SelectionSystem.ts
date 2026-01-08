import * as THREE from 'three';

/**
 * SC2-LEVEL SELECTION SYSTEM
 *
 * Creates beautiful, animated selection rings like StarCraft 2:
 * - Glowing team-colored rings with pulsing animation
 * - Multiple concentric rings for selected units
 * - Subtle rotation animation
 * - Hover highlight effect
 * - Formation preview indicators
 */

// Team colors matching SC2 palette
export const TEAM_COLORS = {
  player1: new THREE.Color(0x00d4ff), // Bright cyan blue
  player2: new THREE.Color(0xff3030), // Bright red
  player3: new THREE.Color(0x30ff30), // Bright green
  player4: new THREE.Color(0xffff30), // Yellow
  ai: new THREE.Color(0xff3030),      // Red for AI
  neutral: new THREE.Color(0x888888), // Gray
};

interface SelectionRingData {
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  glowRing: THREE.Mesh;
  createdAt: number;
  baseScale: number;
}

export class SC2SelectionSystem {
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

    // Create ring geometries with high segment count for smooth circles
    this.outerRingGeometry = new THREE.RingGeometry(0.85, 1.0, 64);
    this.innerRingGeometry = new THREE.RingGeometry(0.7, 0.75, 64);
    this.glowRingGeometry = new THREE.RingGeometry(0.5, 1.2, 64);

    this.createHoverRing();
  }

  private createSelectionMaterial(color: THREE.Color, opacity: number, isGlow = false): THREE.ShaderMaterial {
    // Custom shader for animated glow effect
    return new THREE.ShaderMaterial({
      uniforms: {
        color: { value: color },
        time: { value: 0 },
        opacity: { value: opacity },
        isGlow: { value: isGlow ? 1.0 : 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        uniform float opacity;
        uniform float isGlow;
        varying vec2 vUv;

        void main() {
          // Calculate radial distance from center
          vec2 center = vec2(0.5, 0.5);
          float dist = length(vUv - center) * 2.0;

          // Pulsing animation
          float pulse = 0.85 + 0.15 * sin(time * 3.0);

          // Rotating shimmer effect
          float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
          float shimmer = 0.9 + 0.1 * sin(angle * 8.0 + time * 2.0);

          // Glow falloff for glow ring
          float glowFalloff = isGlow > 0.5 ? (1.0 - smoothstep(0.3, 1.0, dist)) : 1.0;

          // Final color with effects
          vec3 finalColor = color * pulse * shimmer;
          float finalOpacity = opacity * glowFalloff * pulse;

          gl_FragColor = vec4(finalColor, finalOpacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private createHoverRing(): void {
    const geometry = new THREE.RingGeometry(0.9, 1.05, 64);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0xffffff) },
        time: { value: 0 },
        opacity: { value: 0.3 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        uniform float opacity;
        varying vec2 vUv;

        void main() {
          float pulse = 0.7 + 0.3 * sin(time * 5.0);
          gl_FragColor = vec4(color, opacity * pulse);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.hoverRing = new THREE.Mesh(geometry, material);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  createSelectionRing(entityId: number, playerId: string, size: number = 1): void {
    if (this.selectionRings.has(entityId)) return;

    const teamColor = TEAM_COLORS[playerId as keyof typeof TEAM_COLORS] ?? TEAM_COLORS.neutral;

    // Outer ring - bright, solid
    const outerMaterial = this.createSelectionMaterial(teamColor, 0.9);
    const outerRing = new THREE.Mesh(this.outerRingGeometry, outerMaterial);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.scale.setScalar(size);

    // Inner ring - slightly darker, offset animation
    const innerColor = teamColor.clone().multiplyScalar(0.7);
    const innerMaterial = this.createSelectionMaterial(innerColor, 0.6);
    const innerRing = new THREE.Mesh(this.innerRingGeometry, innerMaterial);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.scale.setScalar(size);

    // Glow ring - soft outer glow
    const glowMaterial = this.createSelectionMaterial(teamColor, 0.3, true);
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
      const outerMat = ring.outerRing.material as THREE.ShaderMaterial;
      const innerMat = ring.innerRing.material as THREE.ShaderMaterial;
      const glowMat = ring.glowRing.material as THREE.ShaderMaterial;

      outerMat.uniforms.time.value = this.animationTime;
      innerMat.uniforms.time.value = this.animationTime + 0.5; // Offset
      glowMat.uniforms.time.value = this.animationTime;

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
      const mat = this.hoverRing.material as THREE.ShaderMaterial;
      mat.uniforms.time.value = this.animationTime;
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
