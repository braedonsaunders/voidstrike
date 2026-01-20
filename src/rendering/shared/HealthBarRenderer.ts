/**
 * HealthBarRenderer - Shared health bar creation and update utilities
 *
 * Consolidates health bar logic used by both UnitRenderer and BuildingRenderer.
 * Uses shared geometry to reduce GC pressure and improve performance.
 */

import * as THREE from 'three';
import { Health } from '@/engine/components/Health';
import { UNIT_HEALTH_BAR, RENDER_ORDER } from '@/data/rendering.config';

/**
 * Configuration for health bar appearance
 */
export interface HealthBarConfig {
  width: number;
  height: number;
  bgColor: number;
  bgOpacity: number;
  colorHigh: number;
  colorMedium: number;
  colorLow: number;
  thresholdHigh: number;
  thresholdLow: number;
}

/**
 * Default health bar config (matches UNIT_HEALTH_BAR from rendering.config)
 */
export const DEFAULT_HEALTH_BAR_CONFIG: HealthBarConfig = {
  width: UNIT_HEALTH_BAR.WIDTH,
  height: UNIT_HEALTH_BAR.HEIGHT,
  bgColor: UNIT_HEALTH_BAR.BG_COLOR,
  bgOpacity: UNIT_HEALTH_BAR.BG_OPACITY,
  colorHigh: UNIT_HEALTH_BAR.COLOR_HIGH,
  colorMedium: UNIT_HEALTH_BAR.COLOR_MEDIUM,
  colorLow: UNIT_HEALTH_BAR.COLOR_LOW,
  thresholdHigh: UNIT_HEALTH_BAR.THRESHOLD_HIGH,
  thresholdLow: UNIT_HEALTH_BAR.THRESHOLD_LOW,
};

/**
 * Shared health bar renderer utility.
 * Manages shared geometry and provides creation/update methods.
 */
export class HealthBarRenderer {
  private readonly config: HealthBarConfig;

  // Shared geometry to avoid per-bar allocation
  private readonly bgGeometry: THREE.PlaneGeometry;
  private readonly fillGeometry: THREE.PlaneGeometry;

  // Shared background material (all bars have same background)
  private readonly bgMaterial: THREE.MeshBasicMaterial;

  constructor(config: HealthBarConfig = DEFAULT_HEALTH_BAR_CONFIG) {
    this.config = config;

    // Pre-create shared geometry to avoid per-unit allocation (reduces GC pressure)
    this.bgGeometry = new THREE.PlaneGeometry(config.width, config.height);
    this.fillGeometry = new THREE.PlaneGeometry(config.width, config.height);
    this.bgMaterial = new THREE.MeshBasicMaterial({
      color: config.bgColor,
      transparent: true,
      opacity: config.bgOpacity,
    });
  }

  /**
   * Create a health bar group.
   * Returns a THREE.Group containing background and fill meshes.
   */
  public createHealthBar(): THREE.Group {
    const group = new THREE.Group();

    // Background uses shared geometry and material
    const bg = new THREE.Mesh(this.bgGeometry, this.bgMaterial);
    group.add(bg);

    // Health fill uses shared geometry but needs unique material for color changes
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: this.config.colorHigh,
    });
    const fill = new THREE.Mesh(this.fillGeometry, fillMaterial);
    fill.position.z = 0.01;
    fill.name = 'healthFill';
    group.add(fill);

    // Make health bar always face camera (billboarding)
    group.lookAt(0, 100, 0);

    return group;
  }

  /**
   * Update health bar fill width and color based on health percentage.
   */
  public updateHealthBar(healthBar: THREE.Group, health: Health): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;

    if (fill) {
      const percent = health.getHealthPercent();
      fill.scale.x = percent;
      fill.position.x = (percent - 1) / 2;

      // Color based on health thresholds
      const material = fill.material as THREE.MeshBasicMaterial;
      if (percent > this.config.thresholdHigh) {
        material.color.setHex(this.config.colorHigh);
      } else if (percent > this.config.thresholdLow) {
        material.color.setHex(this.config.colorMedium);
      } else {
        material.color.setHex(this.config.colorLow);
      }
    }
  }

  /**
   * Update health bar from a raw health percentage (0-1).
   * Use this when you don't have a Health component.
   */
  public updateHealthBarFromPercent(healthBar: THREE.Group, percent: number): void {
    const fill = healthBar.getObjectByName('healthFill') as THREE.Mesh;

    if (fill) {
      fill.scale.x = percent;
      fill.position.x = (percent - 1) / 2;

      // Color based on health thresholds
      const material = fill.material as THREE.MeshBasicMaterial;
      if (percent > this.config.thresholdHigh) {
        material.color.setHex(this.config.colorHigh);
      } else if (percent > this.config.thresholdLow) {
        material.color.setHex(this.config.colorMedium);
      } else {
        material.color.setHex(this.config.colorLow);
      }
    }
  }

  /**
   * Dispose health bar group.
   * Only disposes fill material (geometry and bg material are shared).
   */
  public disposeHealthBar(healthBar: THREE.Group): void {
    healthBar.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Don't dispose shared geometry
        if (child.geometry !== this.bgGeometry && child.geometry !== this.fillGeometry) {
          child.geometry.dispose();
        }
        // Dispose materials except shared bgMaterial
        if (child.material instanceof THREE.Material) {
          if (child.material !== this.bgMaterial) {
            child.material.dispose();
          }
        } else if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            if (m !== this.bgMaterial) m.dispose();
          });
        }
      }
    });
  }

  /**
   * Check if a geometry is one of the shared geometries.
   */
  public isSharedGeometry(geometry: THREE.BufferGeometry): boolean {
    return geometry === this.bgGeometry || geometry === this.fillGeometry;
  }

  /**
   * Check if a material is the shared background material.
   */
  public isSharedMaterial(material: THREE.Material): boolean {
    return material === this.bgMaterial;
  }

  /**
   * Dispose all shared resources.
   * Call this when the renderer is being destroyed.
   */
  public dispose(): void {
    this.bgGeometry.dispose();
    this.fillGeometry.dispose();
    this.bgMaterial.dispose();
  }
}
