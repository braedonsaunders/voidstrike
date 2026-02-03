/**
 * GPUMemoryTracker - Central registry for GPU memory usage across all rendering systems
 *
 * WebGPU doesn't provide direct memory queries, so this tracker aggregates
 * estimates from individual systems (water, terrain, units, effects, etc.)
 * to provide a unified view of GPU memory consumption.
 *
 * Systems register their memory usage via updateUsage(), and the tracker
 * provides aggregated totals, per-category breakdowns, and budget alerts.
 *
 * Usage:
 *   // In WaterMemoryManager:
 *   GPUMemoryTracker.getInstance().updateUsage('water', 45, {
 *     geometry: 20,
 *     textures: 25,
 *   });
 *
 *   // In PerformanceDashboard:
 *   const breakdown = GPUMemoryTracker.getInstance().getCategoryBreakdown();
 */

import * as THREE from 'three';

/**
 * Memory category with usage tracking
 */
export interface MemoryCategory {
  /** Category name (e.g., 'water', 'terrain', 'units') */
  name: string;
  /** Current memory usage in megabytes */
  currentMB: number;
  /** Optional per-category budget in megabytes */
  budgetMB: number | null;
  /** Last update timestamp */
  lastUpdated: number;
  /** Detailed breakdown of memory within this category */
  breakdown: Record<string, number>;
}

/**
 * Snapshot of all memory usage
 */
export interface MemorySnapshot {
  /** Total GPU memory usage in megabytes */
  totalMB: number;
  /** Global memory budget in megabytes */
  budgetMB: number;
  /** Usage as percentage of budget */
  usagePercent: number;
  /** Per-category breakdown */
  categories: MemoryCategory[];
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Callback for budget exceeded events
 */
export type BudgetExceededCallback = (category: string, usageMB: number, budgetMB: number) => void;

/**
 * Callback for memory change events
 */
export type MemoryChangeCallback = (snapshot: MemorySnapshot) => void;

/**
 * Default global GPU memory budget (MB)
 * Conservative default that works on most hardware
 */
const DEFAULT_GLOBAL_BUDGET_MB = 512;

/**
 * Predefined category budgets as percentage of global budget
 */
const CATEGORY_BUDGET_PERCENTAGES: Record<string, number> = {
  terrain: 0.30,      // 30% - heightmaps, splatmaps, chunks
  water: 0.15,        // 15% - geometry, normal maps, reflections
  units: 0.20,        // 20% - instance buffers, textures
  buildings: 0.10,    // 10% - geometry, textures
  effects: 0.10,      // 10% - particles, trails
  renderTargets: 0.10, // 10% - TAA, SSGI, shadows
  textures: 0.05,     // 5% - misc textures
};

/**
 * Singleton class for tracking GPU memory across all systems
 */
class GPUMemoryTrackerClass {
  private static instance: GPUMemoryTrackerClass | null = null;

  /** Per-category memory tracking */
  private categories: Map<string, MemoryCategory> = new Map();

  /** Global memory budget in MB */
  private globalBudgetMB: number = DEFAULT_GLOBAL_BUDGET_MB;

  /** Budget exceeded callbacks */
  private budgetCallbacks: Set<BudgetExceededCallback> = new Set();

  /** Memory change callbacks */
  private changeCallbacks: Set<MemoryChangeCallback> = new Set();

  /** Throttle change notifications */
  private lastNotification: number = 0;
  private readonly NOTIFICATION_THROTTLE_MS = 100;

  private constructor() {
    // Initialize default categories
    this.initializeDefaultCategories();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): GPUMemoryTrackerClass {
    if (!GPUMemoryTrackerClass.instance) {
      GPUMemoryTrackerClass.instance = new GPUMemoryTrackerClass();
    }
    return GPUMemoryTrackerClass.instance;
  }

  /**
   * Get the singleton instance (sync access)
   */
  public static getInstanceSync(): GPUMemoryTrackerClass | null {
    return GPUMemoryTrackerClass.instance;
  }

  /**
   * Reset the singleton instance (for game restart)
   */
  public static resetInstance(): void {
    GPUMemoryTrackerClass.instance = null;
  }

  /**
   * Initialize default memory categories
   */
  private initializeDefaultCategories(): void {
    for (const [name, percentage] of Object.entries(CATEGORY_BUDGET_PERCENTAGES)) {
      this.categories.set(name, {
        name,
        currentMB: 0,
        budgetMB: this.globalBudgetMB * percentage,
        lastUpdated: 0,
        breakdown: {},
      });
    }
  }

  /**
   * Set the global GPU memory budget
   *
   * @param budgetMB - Total GPU memory budget in megabytes
   */
  public setGlobalBudget(budgetMB: number): void {
    this.globalBudgetMB = Math.max(64, budgetMB);

    // Update per-category budgets proportionally
    for (const [name, percentage] of Object.entries(CATEGORY_BUDGET_PERCENTAGES)) {
      const category = this.categories.get(name);
      if (category) {
        category.budgetMB = this.globalBudgetMB * percentage;
      }
    }
  }

  /**
   * Get the global memory budget
   */
  public getGlobalBudget(): number {
    return this.globalBudgetMB;
  }

  /**
   * Register a new memory category
   *
   * @param name - Category name
   * @param budgetMB - Optional per-category budget (defaults to proportional share)
   */
  public registerCategory(name: string, budgetMB?: number): void {
    if (!this.categories.has(name)) {
      this.categories.set(name, {
        name,
        currentMB: 0,
        budgetMB: budgetMB ?? null,
        lastUpdated: 0,
        breakdown: {},
      });
    }
  }

  /**
   * Update memory usage for a category
   *
   * @param category - Category name (auto-registered if new)
   * @param usageMB - Current memory usage in megabytes
   * @param breakdown - Optional detailed breakdown within the category
   */
  public updateUsage(
    category: string,
    usageMB: number,
    breakdown?: Record<string, number>
  ): void {
    let cat = this.categories.get(category);

    // Auto-register unknown categories
    if (!cat) {
      cat = {
        name: category,
        currentMB: 0,
        budgetMB: null,
        lastUpdated: 0,
        breakdown: {},
      };
      this.categories.set(category, cat);
    }

    const previousUsage = cat.currentMB;
    cat.currentMB = usageMB;
    cat.lastUpdated = performance.now();

    if (breakdown) {
      cat.breakdown = { ...breakdown };
    }

    // Check for budget exceeded
    if (cat.budgetMB !== null && usageMB > cat.budgetMB) {
      this.notifyBudgetExceeded(category, usageMB, cat.budgetMB);
    }

    // Notify listeners if usage changed significantly (> 1MB)
    if (Math.abs(usageMB - previousUsage) > 1) {
      this.notifyChange();
    }
  }

  /**
   * Remove a category from tracking
   */
  public removeCategory(category: string): void {
    this.categories.delete(category);
    this.notifyChange();
  }

  /**
   * Get total memory usage across all categories
   */
  public getTotalUsageMB(): number {
    let total = 0;
    for (const cat of this.categories.values()) {
      total += cat.currentMB;
    }
    return total;
  }

  /**
   * Get memory usage for a specific category
   */
  public getCategoryUsage(category: string): number {
    return this.categories.get(category)?.currentMB ?? 0;
  }

  /**
   * Get all category data
   */
  public getCategoryBreakdown(): MemoryCategory[] {
    return Array.from(this.categories.values()).sort((a, b) => b.currentMB - a.currentMB);
  }

  /**
   * Get a complete memory snapshot
   */
  public getSnapshot(): MemorySnapshot {
    const totalMB = this.getTotalUsageMB();
    return {
      totalMB,
      budgetMB: this.globalBudgetMB,
      usagePercent: (totalMB / this.globalBudgetMB) * 100,
      categories: this.getCategoryBreakdown(),
      timestamp: performance.now(),
    };
  }

  /**
   * Check if total usage exceeds global budget
   */
  public isOverBudget(): boolean {
    return this.getTotalUsageMB() > this.globalBudgetMB;
  }

  /**
   * Check if a specific category exceeds its budget
   */
  public isCategoryOverBudget(category: string): boolean {
    const cat = this.categories.get(category);
    if (!cat || cat.budgetMB === null) return false;
    return cat.currentMB > cat.budgetMB;
  }

  /**
   * Get usage as percentage of budget for a category
   */
  public getCategoryUsagePercent(category: string): number {
    const cat = this.categories.get(category);
    if (!cat || cat.budgetMB === null || cat.budgetMB === 0) return 0;
    return (cat.currentMB / cat.budgetMB) * 100;
  }

  /**
   * Subscribe to budget exceeded events
   *
   * @param callback - Function called when any category exceeds budget
   * @returns Unsubscribe function
   */
  public onBudgetExceeded(callback: BudgetExceededCallback): () => void {
    this.budgetCallbacks.add(callback);
    return () => this.budgetCallbacks.delete(callback);
  }

  /**
   * Subscribe to memory change events
   *
   * @param callback - Function called when memory usage changes
   * @returns Unsubscribe function
   */
  public onMemoryChange(callback: MemoryChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => this.changeCallbacks.delete(callback);
  }

  /**
   * Notify budget exceeded listeners
   */
  private notifyBudgetExceeded(category: string, usageMB: number, budgetMB: number): void {
    for (const callback of this.budgetCallbacks) {
      try {
        callback(category, usageMB, budgetMB);
      } catch (e) {
        console.error('[GPUMemoryTracker] Budget callback error:', e);
      }
    }
  }

  /**
   * Notify change listeners (throttled)
   */
  private notifyChange(): void {
    const now = performance.now();
    if (now - this.lastNotification < this.NOTIFICATION_THROTTLE_MS) {
      return;
    }
    this.lastNotification = now;

    const snapshot = this.getSnapshot();
    for (const callback of this.changeCallbacks) {
      try {
        callback(snapshot);
      } catch (e) {
        console.error('[GPUMemoryTracker] Change callback error:', e);
      }
    }
  }

  /**
   * Get a human-readable status string
   */
  public getStatusString(): string {
    const total = this.getTotalUsageMB();
    const percent = ((total / this.globalBudgetMB) * 100).toFixed(1);
    return `GPU Memory: ${total.toFixed(1)}MB / ${this.globalBudgetMB}MB (${percent}%)`;
  }

  /**
   * Get detailed status with per-category breakdown
   */
  public getDetailedStatus(): string {
    const lines = [this.getStatusString()];
    for (const cat of this.getCategoryBreakdown()) {
      if (cat.currentMB > 0.1) {
        lines.push(`  ${cat.name}: ${cat.currentMB.toFixed(1)}MB`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Clear all usage data (keeps categories registered)
   */
  public clearUsage(): void {
    for (const cat of this.categories.values()) {
      cat.currentMB = 0;
      cat.breakdown = {};
      cat.lastUpdated = 0;
    }
    this.notifyChange();
  }
}

// Export singleton instance getter
export const GPUMemoryTracker = GPUMemoryTrackerClass.getInstance();

// Convenience functions
export function getGPUMemoryTracker(): GPUMemoryTrackerClass {
  return GPUMemoryTrackerClass.getInstance();
}

export function getGPUMemoryTrackerSync(): GPUMemoryTrackerClass | null {
  return GPUMemoryTrackerClass.getInstanceSync();
}

// =============================================================================
// Texture Memory Estimation Utilities
// =============================================================================

/**
 * Get bytes per pixel for a Three.js texture format
 */
export function getFormatBytesPerPixel(format: THREE.PixelFormat | THREE.CompressedPixelFormat): number {
  switch (format) {
    // Standard formats
    case THREE.RGBAFormat:
      return 4;
    case THREE.RGBFormat:
      return 3;
    case THREE.RedFormat:
    case THREE.AlphaFormat:
      return 1;
    case THREE.RGFormat:
      return 2;

    // Compressed formats (approximate average)
    case THREE.RGBA_S3TC_DXT1_Format:
    case THREE.RGB_S3TC_DXT1_Format:
      return 0.5; // 4:1 compression
    case THREE.RGBA_S3TC_DXT3_Format:
    case THREE.RGBA_S3TC_DXT5_Format:
      return 1; // 4:1 compression for RGBA
    case THREE.RGBA_BPTC_Format:
      return 1;
    case THREE.RGBA_ASTC_4x4_Format:
      return 1;

    default:
      return 4; // Assume RGBA as fallback
  }
}

/**
 * Get bytes per pixel for a Three.js data type
 */
export function getTypeBytesPerChannel(type: THREE.TextureDataType): number {
  switch (type) {
    case THREE.UnsignedByteType:
    case THREE.ByteType:
      return 1;
    case THREE.ShortType:
    case THREE.UnsignedShortType:
    case THREE.HalfFloatType:
      return 2;
    case THREE.IntType:
    case THREE.UnsignedIntType:
    case THREE.FloatType:
      return 4;
    default:
      return 1;
  }
}

/**
 * Estimate memory usage for a Three.js texture
 *
 * @param texture - Three.js texture to estimate
 * @returns Memory usage in megabytes
 */
export function estimateTextureMemory(texture: THREE.Texture): number {
  const image = texture.image;
  if (!image) return 0;

  // Handle different image types
  let width: number;
  let height: number;

  if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    width = image.width;
    height = image.height;
  } else if (image instanceof ImageBitmap) {
    width = image.width;
    height = image.height;
  } else if ('width' in image && 'height' in image) {
    width = (image as { width: number; height: number }).width;
    height = (image as { width: number; height: number }).height;
  } else {
    return 0;
  }

  if (width === 0 || height === 0) return 0;

  // Calculate bytes per pixel based on format and type
  const formatBytes = getFormatBytesPerPixel(texture.format);
  const typeMultiplier = getTypeBytesPerChannel(texture.type);
  const bytesPerPixel = formatBytes * typeMultiplier;

  // Account for mipmaps (adds ~33% for full chain)
  const mipMultiplier = texture.generateMipmaps ? 1.333 : 1;

  // Account for array/cube textures
  let layerCount = 1;
  if (texture instanceof THREE.CubeTexture) {
    layerCount = 6;
  } else if (texture instanceof THREE.DataArrayTexture) {
    layerCount = texture.image.depth || 1;
  }

  const bytes = width * height * bytesPerPixel * mipMultiplier * layerCount;
  return bytes / (1024 * 1024);
}

/**
 * Estimate memory usage for a render target
 *
 * @param target - Three.js render target
 * @returns Memory usage in megabytes
 */
export function estimateRenderTargetMemory(target: THREE.WebGLRenderTarget): number {
  const width = target.width;
  const height = target.height;

  // Color attachment
  let colorBytes = 0;
  const colorTexture = target.texture;
  const colorBytesPerPixel = getFormatBytesPerPixel(colorTexture.format) *
    getTypeBytesPerChannel(colorTexture.type);
  colorBytes = width * height * colorBytesPerPixel;

  // Handle MRT (multiple render targets)
  if (target.textures && target.textures.length > 1) {
    colorBytes *= target.textures.length;
  }

  // Depth attachment (if present)
  let depthBytes = 0;
  if (target.depthBuffer) {
    // Depth is typically 24-bit or 32-bit
    depthBytes = width * height * 4;
  }

  // Stencil (if present, usually combined with depth)
  // Already accounted for in depth32+stencil8 format

  return (colorBytes + depthBytes) / (1024 * 1024);
}

/**
 * Estimate memory for a buffer geometry
 *
 * @param geometry - Three.js buffer geometry
 * @returns Memory usage in megabytes
 */
export function estimateGeometryMemory(geometry: THREE.BufferGeometry): number {
  let totalBytes = 0;

  // Sum all attribute buffer sizes
  for (const name in geometry.attributes) {
    const attr = geometry.attributes[name];
    if (attr instanceof THREE.BufferAttribute || attr instanceof THREE.InterleavedBufferAttribute) {
      const itemSize = attr.itemSize;
      const count = attr.count;
      const bytesPerElement = attr.array.BYTES_PER_ELEMENT;
      totalBytes += count * itemSize * bytesPerElement;
    }
  }

  // Add index buffer if present
  if (geometry.index) {
    const index = geometry.index;
    totalBytes += index.count * index.array.BYTES_PER_ELEMENT;
  }

  return totalBytes / (1024 * 1024);
}
