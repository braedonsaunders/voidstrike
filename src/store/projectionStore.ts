import { create } from 'zustand';

/**
 * Projection Store
 *
 * Provides world-to-screen coordinate projection for the Phaser overlay.
 * This bridges the gap between Three.js 3D world coordinates and Phaser 2D screen space.
 */

export type WorldToScreenFn = (worldX: number, worldZ: number, worldY?: number) => { x: number; y: number } | null;

interface ProjectionState {
  // Function to convert world coordinates to screen coordinates
  worldToScreen: WorldToScreenFn | null;

  // Set the projection function (called by HybridGameCanvas when camera is ready)
  setWorldToScreen: (fn: WorldToScreenFn | null) => void;

  // Convenience method that returns screen coords or falls back to simple grid conversion
  projectToScreen: (gridX: number, gridY: number, terrainHeight?: number) => { x: number; y: number };
}

// Fallback cell size for when projection function is not available
const FALLBACK_CELL_SIZE = 32;

export const useProjectionStore = create<ProjectionState>((set, get) => ({
  worldToScreen: null,

  setWorldToScreen: (fn: WorldToScreenFn | null) => set({ worldToScreen: fn }),

  projectToScreen: (gridX: number, gridY: number, terrainHeight?: number) => {
    const { worldToScreen } = get();

    if (worldToScreen) {
      const result = worldToScreen(gridX, gridY, terrainHeight);
      if (result) {
        return result;
      }
    }

    // Fallback to simple grid conversion (for positions behind camera or when not initialized)
    return {
      x: gridX * FALLBACK_CELL_SIZE,
      y: gridY * FALLBACK_CELL_SIZE,
    };
  },
}));
