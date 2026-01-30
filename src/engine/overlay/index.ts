/**
 * Overlay Pipeline - Unified overlay coordination
 *
 * Provides a single API for managing game overlays across:
 * - TSL (3D terrain-conforming overlays in WebGPU renderer)
 * - Phaser (2D UI effects in overlay scene)
 * - UIStore (React component state)
 */

export {
  OverlayCoordinator,
  getOverlayCoordinator,
  resetOverlayCoordinator,
  type OverlayTypeChangedEvent,
  type OverlayRangeToggleEvent,
  type OverlayOpacityChangedEvent,
  type OverlayNavmeshProgressEvent,
} from './OverlayCoordinator';
