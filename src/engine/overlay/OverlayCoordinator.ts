/**
 * OverlayCoordinator - Unified overlay pipeline coordination
 *
 * Single source of truth for overlay state, coordinating:
 * - TSLGameOverlayManager (3D terrain-conforming overlays)
 * - OverlayScene (2D UI effects via EventBus)
 * - UIStore (for UI components that read state)
 *
 * This eliminates the scattered store subscriptions and provides
 * a clean API for input handlers to control overlays.
 */

import { EventBus } from '@/engine/core/EventBus';
import { TSLGameOverlayManager } from '@/rendering/tsl/GameOverlay';
import { useUIStore, GameOverlayType, OverlaySettings } from '@/store/uiStore';
import { debugPathfinding } from '@/utils/debugLogger';

// Typed overlay events for cross-system communication
export interface OverlayTypeChangedEvent {
  overlay: GameOverlayType;
  previousOverlay: GameOverlayType;
}

export interface OverlayRangeToggleEvent {
  rangeType: 'attack' | 'vision';
  show: boolean;
}

export interface OverlayOpacityChangedEvent {
  overlay: GameOverlayType;
  opacity: number;
}

export interface OverlayNavmeshProgressEvent {
  progress: number;
  isComputing: boolean;
}

/**
 * OverlayCoordinator singleton
 *
 * Usage:
 * 1. Initialize with setOverlayManager() and setEventBus() after renderer setup
 * 2. Input handlers call setActiveOverlay(), setShowAttackRange(), etc.
 * 3. Coordinator updates TSLGameOverlayManager directly, emits events for Phaser
 * 4. UIStore is synced for React UI components
 */
export class OverlayCoordinator {
  private static instance: OverlayCoordinator | null = null;

  private overlayManager: TSLGameOverlayManager | null = null;
  private eventBus: EventBus | null = null;

  // Internal state (mirrors UIStore.overlaySettings)
  private activeOverlay: GameOverlayType = 'none';
  private showAttackRange: boolean = false;
  private showVisionRange: boolean = false;
  private opacities: Record<GameOverlayType, number> = {
    none: 0,
    elevation: 0.7,
    threat: 0.5,
    navmesh: 0.8,
    resource: 0.7,
    buildable: 0.6,
  };

  private constructor() {}

  public static getInstance(): OverlayCoordinator {
    if (!OverlayCoordinator.instance) {
      OverlayCoordinator.instance = new OverlayCoordinator();
    }
    return OverlayCoordinator.instance;
  }

  public static resetInstance(): void {
    OverlayCoordinator.instance = null;
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Set the TSLGameOverlayManager reference.
   * Called after renderer initialization.
   */
  public setOverlayManager(manager: TSLGameOverlayManager): void {
    this.overlayManager = manager;

    // Wire up navmesh progress callbacks
    manager.setNavmeshProgressCallback((progress) => {
      this.handleNavmeshProgress(progress, true);
    });

    manager.setNavmeshCompleteCallback((stats) => {
      this.handleNavmeshProgress(1, false);
      debugPathfinding.log('[OverlayCoordinator] Navmesh complete:', stats);
    });

    // Apply current state to manager
    this.syncToManager();

    debugPathfinding.log('[OverlayCoordinator] Overlay manager connected');
  }

  /**
   * Set the EventBus reference for emitting typed overlay events.
   * Called during game initialization.
   */
  public setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
    debugPathfinding.log('[OverlayCoordinator] EventBus connected');
  }

  /**
   * Initialize coordinator from current UIStore state.
   * Call this after setting up manager and eventBus.
   */
  public initializeFromStore(): void {
    const settings = useUIStore.getState().overlaySettings;
    this.activeOverlay = settings.activeOverlay;
    this.showAttackRange = settings.showAttackRange;
    this.showVisionRange = settings.showVisionRange;
    this.opacities.elevation = settings.elevationOverlayOpacity;
    this.opacities.threat = settings.threatOverlayOpacity;
    this.opacities.navmesh = settings.navmeshOverlayOpacity;
    this.opacities.resource = settings.resourceOverlayOpacity;
    this.opacities.buildable = settings.buildableOverlayOpacity;

    this.syncToManager();
  }

  // ==========================================================================
  // PUBLIC API - Called by input handlers
  // ==========================================================================

  /**
   * Set the active overlay type.
   * Updates TSLGameOverlayManager, emits event, syncs UIStore.
   */
  public setActiveOverlay(overlay: GameOverlayType): void {
    const previousOverlay = this.activeOverlay;
    if (overlay === previousOverlay) return;

    this.activeOverlay = overlay;

    // Update TSLGameOverlayManager
    if (this.overlayManager) {
      this.overlayManager.setActiveOverlay(overlay);
      if (overlay !== 'none') {
        this.overlayManager.setOpacity(this.opacities[overlay]);
      }
    }

    // Emit typed event for Phaser/other listeners
    this.emitEvent<OverlayTypeChangedEvent>('overlay:typeChanged', {
      overlay,
      previousOverlay,
    });

    // Sync to UIStore for React components
    useUIStore.getState().setActiveOverlay(overlay);

    debugPathfinding.log(`[OverlayCoordinator] Active overlay: ${previousOverlay} -> ${overlay}`);
  }

  /**
   * Toggle between an overlay type and 'none'.
   */
  public toggleOverlay(overlay: GameOverlayType): void {
    if (this.activeOverlay === overlay) {
      this.setActiveOverlay('none');
    } else {
      this.setActiveOverlay(overlay);
    }
  }

  /**
   * Cycle to the next overlay type.
   */
  public cycleOverlay(): void {
    const order: GameOverlayType[] = ['none', 'elevation', 'threat', 'navmesh', 'resource', 'buildable'];
    const currentIndex = order.indexOf(this.activeOverlay);
    const nextIndex = (currentIndex + 1) % order.length;
    this.setActiveOverlay(order[nextIndex]);
  }

  /**
   * Set overlay opacity for a specific type.
   */
  public setOverlayOpacity(overlay: GameOverlayType, opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    this.opacities[overlay] = clampedOpacity;

    // Update manager if this is the active overlay
    if (this.overlayManager && overlay === this.activeOverlay && overlay !== 'none') {
      this.overlayManager.setOpacity(clampedOpacity);
    }

    // Emit event
    this.emitEvent<OverlayOpacityChangedEvent>('overlay:opacityChanged', {
      overlay,
      opacity: clampedOpacity,
    });

    // Sync to UIStore
    useUIStore.getState().setOverlayOpacity(overlay, clampedOpacity);
  }

  /**
   * Show/hide attack range rings for selected units.
   * SC2-style hold-to-show behavior.
   */
  public setShowAttackRange(show: boolean): void {
    if (this.showAttackRange === show) return;

    this.showAttackRange = show;

    // Update TSLGameOverlayManager
    if (this.overlayManager) {
      this.overlayManager.setShowAttackRange(show);
    }

    // Emit typed event
    this.emitEvent<OverlayRangeToggleEvent>('overlay:rangeToggle', {
      rangeType: 'attack',
      show,
    });

    // Sync to UIStore
    useUIStore.getState().setShowAttackRange(show);

    debugPathfinding.log(`[OverlayCoordinator] Attack range: ${show ? 'ON' : 'OFF'}`);
  }

  /**
   * Show/hide vision range rings for selected units.
   * SC2-style hold-to-show behavior.
   */
  public setShowVisionRange(show: boolean): void {
    if (this.showVisionRange === show) return;

    this.showVisionRange = show;

    // Update TSLGameOverlayManager
    if (this.overlayManager) {
      this.overlayManager.setShowVisionRange(show);
    }

    // Emit typed event
    this.emitEvent<OverlayRangeToggleEvent>('overlay:rangeToggle', {
      rangeType: 'vision',
      show,
    });

    // Sync to UIStore
    useUIStore.getState().setShowVisionRange(show);

    debugPathfinding.log(`[OverlayCoordinator] Vision range: ${show ? 'ON' : 'OFF'}`);
  }

  /**
   * Toggle attack range visibility.
   */
  public toggleAttackRange(): void {
    this.setShowAttackRange(!this.showAttackRange);
  }

  /**
   * Toggle vision range visibility.
   */
  public toggleVisionRange(): void {
    this.setShowVisionRange(!this.showVisionRange);
  }

  // ==========================================================================
  // STATE GETTERS
  // ==========================================================================

  public getActiveOverlay(): GameOverlayType {
    return this.activeOverlay;
  }

  public isShowingAttackRange(): boolean {
    return this.showAttackRange;
  }

  public isShowingVisionRange(): boolean {
    return this.showVisionRange;
  }

  public getOverlayOpacity(overlay: GameOverlayType): number {
    return this.opacities[overlay];
  }

  public getNavmeshState(): { isComputing: boolean; progress: number; cached: boolean } | null {
    return this.overlayManager?.getNavmeshState() ?? null;
  }

  // ==========================================================================
  // SELECTED ENTITIES
  // ==========================================================================

  /**
   * Update selected entity IDs for range ring display.
   * Called by selection system when selection changes.
   */
  public setSelectedEntities(entityIds: number[]): void {
    if (this.overlayManager) {
      this.overlayManager.setSelectedEntities(entityIds);
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Sync current state to TSLGameOverlayManager.
   */
  private syncToManager(): void {
    if (!this.overlayManager) return;

    this.overlayManager.setActiveOverlay(this.activeOverlay);
    if (this.activeOverlay !== 'none') {
      this.overlayManager.setOpacity(this.opacities[this.activeOverlay]);
    }
    this.overlayManager.setShowAttackRange(this.showAttackRange);
    this.overlayManager.setShowVisionRange(this.showVisionRange);
  }

  /**
   * Emit a typed event through the EventBus.
   */
  private emitEvent<T>(event: string, data: T): void {
    if (this.eventBus) {
      this.eventBus.emit(event, data);
    }
  }

  /**
   * Handle navmesh computation progress updates.
   */
  private handleNavmeshProgress(progress: number, isComputing: boolean): void {
    // Emit event
    this.emitEvent<OverlayNavmeshProgressEvent>('overlay:navmeshProgress', {
      progress,
      isComputing,
    });

    // Sync to UIStore
    const uiStore = useUIStore.getState();
    uiStore.setNavmeshComputeProgress(progress);
    uiStore.setNavmeshIsComputing(isComputing);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  public dispose(): void {
    this.overlayManager = null;
    this.eventBus = null;
  }
}

// Convenience functions for backward compatibility
export function getOverlayCoordinator(): OverlayCoordinator {
  return OverlayCoordinator.getInstance();
}

export function resetOverlayCoordinator(): void {
  OverlayCoordinator.resetInstance();
}
