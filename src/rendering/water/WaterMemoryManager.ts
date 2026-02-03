/**
 * WaterMemoryManager - GPU memory budget management for water rendering
 *
 * Manages GPU memory allocation for water systems by:
 * - Estimating memory usage per quality tier
 * - Selecting optimal quality within budget constraints
 * - Monitoring runtime usage and triggering degradation
 * - Reporting usage to the central GPUMemoryTracker
 *
 * Memory is allocated for:
 * - Water mesh geometry (vertices, normals, UVs)
 * - Water normal maps and textures
 * - Reflection render targets (for ultra quality)
 * - Shore transition geometry
 */

import type { WaterQuality } from './UnifiedWaterMesh';
import { getGPUMemoryTracker } from '@/engine/core/GPUMemoryTracker';

/**
 * Memory estimate breakdown for a water configuration
 */
export interface MemoryEstimate {
  /** Total estimated memory in megabytes */
  totalMB: number;
  /** Geometry memory (vertices, indices, normals) */
  geometryMB: number;
  /** Texture memory (normal maps, reflection targets) */
  textureMB: number;
  /** Shore transition overlay memory */
  shoreMB: number;
  /** Detailed breakdown by component */
  breakdown: {
    meshVertices: number;
    meshIndices: number;
    normalMaps: number;
    reflectionTarget: number;
    shoreGeometry: number;
  };
}

/**
 * Memory usage thresholds per quality tier
 */
interface QualityMemoryProfile {
  /** Base geometry memory per cell in bytes */
  bytesPerCell: number;
  /** Normal map resolution */
  normalMapSize: number;
  /** Reflection render target resolution (0 if no reflection) */
  reflectionSize: number;
  /** Shore transition complexity multiplier */
  shoreMultiplier: number;
}

/**
 * Memory profiles for each quality tier
 * These are estimates based on typical water mesh configurations
 */
const QUALITY_MEMORY_PROFILES: Record<WaterQuality, QualityMemoryProfile> = {
  low: {
    // Minimal quality: simple plane, small textures
    bytesPerCell: 64, // 4 vertices * 16 bytes position+normal
    normalMapSize: 256,
    reflectionSize: 0, // No reflections
    shoreMultiplier: 0.5,
  },
  medium: {
    // Medium quality: subdivided mesh, medium textures
    bytesPerCell: 128,
    normalMapSize: 512,
    reflectionSize: 0, // No real-time reflections
    shoreMultiplier: 0.75,
  },
  high: {
    // High quality: detailed mesh, full textures, environment reflections
    bytesPerCell: 256,
    normalMapSize: 1024,
    reflectionSize: 0, // Uses environment map, not planar
    shoreMultiplier: 1.0,
  },
  ultra: {
    // Ultra quality: maximum detail, planar reflections
    bytesPerCell: 512,
    normalMapSize: 1024,
    reflectionSize: 1024, // Real-time planar reflections
    shoreMultiplier: 1.5,
  },
};

/**
 * Quality tier ordering from lowest to highest
 */
const QUALITY_ORDER: WaterQuality[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Singleton class managing GPU memory budget for water rendering.
 * Provides memory estimation, optimal quality selection, and runtime monitoring.
 */
class WaterMemoryManagerClass {
  private static instance: WaterMemoryManagerClass | null = null;

  /** Default memory budget for water system in megabytes */
  private static readonly WATER_MEMORY_BUDGET_MB = 100;

  /** Threshold percentage at which to trigger quality degradation */
  private static readonly DEGRADATION_THRESHOLD = 0.9;

  /** Hysteresis buffer to prevent quality oscillation */
  private static readonly UPGRADE_THRESHOLD = 0.7;

  /** Current tracked memory usage in MB */
  private currentUsageMB: number = 0;

  /** Current quality setting */
  private currentQuality: WaterQuality = 'high';

  /** Memory budget in MB */
  private memoryBudgetMB: number = WaterMemoryManagerClass.WATER_MEMORY_BUDGET_MB;

  /** Listeners for quality change events */
  private qualityChangeListeners: Set<(quality: WaterQuality) => void> = new Set();

  /** Last computed memory estimate (for breakdown reporting) */
  private lastEstimate: MemoryEstimate | null = null;

  private constructor() {
    // Private constructor for singleton
    // Register with the central GPU memory tracker
    getGPUMemoryTracker().registerCategory('water', WaterMemoryManagerClass.WATER_MEMORY_BUDGET_MB);
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): WaterMemoryManagerClass {
    if (!WaterMemoryManagerClass.instance) {
      WaterMemoryManagerClass.instance = new WaterMemoryManagerClass();
    }
    return WaterMemoryManagerClass.instance;
  }

  /**
   * Get the singleton instance (sync access)
   */
  public static getInstanceSync(): WaterMemoryManagerClass | null {
    return WaterMemoryManagerClass.instance;
  }

  /**
   * Reset the singleton instance (for game restart)
   */
  public static resetInstance(): void {
    WaterMemoryManagerClass.instance = null;
  }

  /**
   * Set the memory budget for water rendering
   * @param budgetMB - Memory budget in megabytes
   */
  public setMemoryBudget(budgetMB: number): void {
    this.memoryBudgetMB = Math.max(16, budgetMB); // Minimum 16MB
  }

  /**
   * Get the current memory budget
   */
  public getMemoryBudget(): number {
    return this.memoryBudgetMB;
  }

  /**
   * Estimate memory usage for water at a given quality tier
   *
   * @param cellCount - Number of water cells in the map
   * @param quality - Water quality tier
   * @returns Detailed memory estimate breakdown
   */
  public estimateMemoryUsage(cellCount: number, quality: WaterQuality): MemoryEstimate {
    const profile = QUALITY_MEMORY_PROFILES[quality];

    // Geometry memory: vertices, indices, normals, UVs per cell
    // Each cell may have up to 6 vertices (2 triangles) with:
    // - Position: 3 floats * 4 bytes = 12 bytes
    // - Normal: 3 floats * 4 bytes = 12 bytes
    // - UV: 2 floats * 4 bytes = 8 bytes
    // - Index: 6 indices * 2 bytes = 12 bytes (Uint16)
    const meshVertexBytes = cellCount * profile.bytesPerCell;
    const meshIndexBytes = cellCount * 6 * 2; // 6 indices per cell, 2 bytes each

    // Normal map texture memory (RGBA, 1 byte per channel)
    const normalMapBytes = profile.normalMapSize * profile.normalMapSize * 4;

    // Reflection render target (RGBA16F for HDR if enabled)
    // HalfFloat = 2 bytes per channel, 4 channels
    const reflectionBytes = profile.reflectionSize > 0
      ? profile.reflectionSize * profile.reflectionSize * 4 * 2
      : 0;

    // Shore transition geometry (gradient overlays at water edges)
    // Estimate based on cell perimeter - approximately sqrt(cellCount) * 4 edge cells
    const estimatedEdgeCells = Math.sqrt(cellCount) * 4;
    const shoreVertexBytes = estimatedEdgeCells * 4 * 32 * profile.shoreMultiplier; // 4 verts per edge, 32 bytes each

    // Convert to megabytes
    const bytesToMB = (bytes: number) => bytes / (1024 * 1024);

    const geometryMB = bytesToMB(meshVertexBytes + meshIndexBytes);
    const textureMB = bytesToMB(normalMapBytes + reflectionBytes);
    const shoreMB = bytesToMB(shoreVertexBytes);
    const totalMB = geometryMB + textureMB + shoreMB;

    return {
      totalMB,
      geometryMB,
      textureMB,
      shoreMB,
      breakdown: {
        meshVertices: bytesToMB(meshVertexBytes),
        meshIndices: bytesToMB(meshIndexBytes),
        normalMaps: bytesToMB(normalMapBytes),
        reflectionTarget: bytesToMB(reflectionBytes),
        shoreGeometry: bytesToMB(shoreVertexBytes),
      },
    };
  }

  /**
   * Select the optimal quality tier that fits within the memory budget
   *
   * @param cellCount - Number of water cells in the map
   * @param availableMemoryMB - Optional override for available memory (defaults to budget)
   * @returns The highest quality tier that fits within budget
   */
  public selectOptimalQuality(
    cellCount: number,
    availableMemoryMB?: number
  ): WaterQuality {
    const budget = availableMemoryMB ?? this.memoryBudgetMB;

    // Try each quality from highest to lowest
    for (let i = QUALITY_ORDER.length - 1; i >= 0; i--) {
      const quality = QUALITY_ORDER[i];
      const estimate = this.estimateMemoryUsage(cellCount, quality);

      if (estimate.totalMB <= budget) {
        return quality;
      }
    }

    // If even low quality exceeds budget, return low anyway
    // The system will need to handle this gracefully
    return 'low';
  }

  /**
   * Update the current tracked memory usage
   * Call this after water mesh creation/destruction
   *
   * @param usageMB - Current actual memory usage in megabytes
   * @param estimate - Optional detailed memory estimate for breakdown reporting
   */
  public updateCurrentUsage(usageMB: number, estimate?: MemoryEstimate): void {
    this.currentUsageMB = usageMB;
    if (estimate) {
      this.lastEstimate = estimate;
    }

    // Report to the central GPU memory tracker
    getGPUMemoryTracker().updateUsage('water', usageMB, {
      geometry: this.lastEstimate?.geometryMB ?? 0,
      textures: this.lastEstimate?.textureMB ?? 0,
      shore: this.lastEstimate?.shoreMB ?? 0,
    });
  }

  /**
   * Get the current tracked memory usage
   */
  public getCurrentUsage(): number {
    return this.currentUsageMB;
  }

  /**
   * Check if current usage warrants quality degradation
   *
   * @param currentUsageMB - Current memory usage (or uses tracked if not provided)
   * @returns True if quality should be degraded
   */
  public shouldDegradeQuality(currentUsageMB?: number): boolean {
    const usage = currentUsageMB ?? this.currentUsageMB;
    const threshold = this.memoryBudgetMB * WaterMemoryManagerClass.DEGRADATION_THRESHOLD;
    return usage > threshold;
  }

  /**
   * Check if current usage allows quality upgrade
   *
   * @param targetQuality - Quality tier to potentially upgrade to
   * @param cellCount - Number of water cells
   * @returns True if upgrade is safe
   */
  public canUpgradeQuality(targetQuality: WaterQuality, cellCount: number): boolean {
    const estimate = this.estimateMemoryUsage(cellCount, targetQuality);
    const threshold = this.memoryBudgetMB * WaterMemoryManagerClass.UPGRADE_THRESHOLD;
    return estimate.totalMB <= threshold;
  }

  /**
   * Get the recommended quality after degradation
   *
   * @param currentQuality - Current quality tier
   * @returns Next lower quality tier, or 'low' if already at minimum
   */
  public getDegradedQuality(currentQuality: WaterQuality): WaterQuality {
    const currentIndex = QUALITY_ORDER.indexOf(currentQuality);
    if (currentIndex <= 0) {
      return 'low';
    }
    return QUALITY_ORDER[currentIndex - 1];
  }

  /**
   * Get the next higher quality tier
   *
   * @param currentQuality - Current quality tier
   * @returns Next higher quality tier, or 'ultra' if already at maximum
   */
  public getUpgradedQuality(currentQuality: WaterQuality): WaterQuality {
    const currentIndex = QUALITY_ORDER.indexOf(currentQuality);
    if (currentIndex >= QUALITY_ORDER.length - 1) {
      return 'ultra';
    }
    return QUALITY_ORDER[currentIndex + 1];
  }

  /**
   * Set the current quality level (for tracking)
   */
  public setCurrentQuality(quality: WaterQuality): void {
    if (this.currentQuality !== quality) {
      this.currentQuality = quality;
      this.notifyQualityChange(quality);
    }
  }

  /**
   * Get the current quality level
   */
  public getCurrentQuality(): WaterQuality {
    return this.currentQuality;
  }

  /**
   * Subscribe to quality change events
   *
   * @param listener - Callback function when quality changes
   * @returns Unsubscribe function
   */
  public onQualityChange(listener: (quality: WaterQuality) => void): () => void {
    this.qualityChangeListeners.add(listener);
    return () => {
      this.qualityChangeListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of quality change
   */
  private notifyQualityChange(quality: WaterQuality): void {
    for (const listener of this.qualityChangeListeners) {
      try {
        listener(quality);
      } catch (e) {
        console.error('[WaterMemoryManager] Quality change listener error:', e);
      }
    }
  }

  /**
   * Get memory usage as a percentage of budget
   */
  public getUsagePercentage(): number {
    return (this.currentUsageMB / this.memoryBudgetMB) * 100;
  }

  /**
   * Get a human-readable status string
   */
  public getStatusString(): string {
    const percent = this.getUsagePercentage().toFixed(1);
    const usage = this.currentUsageMB.toFixed(1);
    const budget = this.memoryBudgetMB.toFixed(0);
    return `Water: ${usage}MB / ${budget}MB (${percent}%) @ ${this.currentQuality}`;
  }

  /**
   * Check if planar reflections are affordable within budget
   *
   * @param cellCount - Number of water cells
   * @returns True if ultra quality with reflections fits in budget
   */
  public canAffordPlanarReflections(cellCount: number): boolean {
    const estimate = this.estimateMemoryUsage(cellCount, 'ultra');
    return estimate.totalMB <= this.memoryBudgetMB;
  }

  /**
   * Get the reflection render target resolution that fits in remaining budget
   *
   * @param currentUsageWithoutReflection - Memory usage without reflection target
   * @returns Recommended resolution (512, 1024, 2048) or 0 if none fit
   */
  public getAffordableReflectionResolution(currentUsageWithoutReflection: number): 512 | 1024 | 2048 | 0 {
    const remainingMB = this.memoryBudgetMB - currentUsageWithoutReflection;

    // HalfFloat RGBA = 8 bytes per pixel
    const bytesPerPixel = 8;
    const calculateMB = (res: number) => (res * res * bytesPerPixel) / (1024 * 1024);

    if (calculateMB(2048) <= remainingMB) return 2048;
    if (calculateMB(1024) <= remainingMB) return 1024;
    if (calculateMB(512) <= remainingMB) return 512;
    return 0;
  }
}

// Export singleton instance getter
export const WaterMemoryManager = WaterMemoryManagerClass.getInstance();

// Export convenience functions for backward compatibility
export function getWaterMemoryManager(): WaterMemoryManagerClass {
  return WaterMemoryManagerClass.getInstance();
}

export function getWaterMemoryManagerSync(): WaterMemoryManagerClass | null {
  return WaterMemoryManagerClass.getInstanceSync();
}
