import { Component } from '../ecs/Component';
import { WallConnectionType, GateState, WallUpgradeType } from '@/data/buildings/walls';

/**
 * Wall Component - extends buildings with wall-specific functionality
 *
 * Handles:
 * - Wall connections to neighbors (auto-connecting meshes)
 * - Gate open/close state machine
 * - Mounted turret reference
 * - Wall upgrades
 */
export class Wall extends Component {
  public readonly type = 'Wall';

  // Wall connection type (determines mesh appearance)
  public connectionType: WallConnectionType = 'none';

  // IDs of adjacent wall entities (for connection updates)
  public neighborNorth: number | null = null;
  public neighborSouth: number | null = null;
  public neighborEast: number | null = null;
  public neighborWest: number | null = null;

  // Gate-specific properties
  public isGate: boolean = false;
  public gateState: GateState = 'auto';
  public gateOpenProgress: number = 0; // 0 = closed, 1 = open
  public gateAutoCloseTimer: number = 0;
  public static readonly GATE_OPEN_TIME = 0.5; // seconds to open/close
  public static readonly GATE_AUTO_CLOSE_DELAY = 2.0; // seconds before auto-close

  // Mounted turret (if any)
  public mountedTurretId: number | null = null;
  public canMountTurret: boolean = true;

  // Upgrade state
  public appliedUpgrade: WallUpgradeType | null = null;
  public upgradeInProgress: WallUpgradeType | null = null;
  public upgradeProgress: number = 0;

  // Shield (for shielded walls)
  public shield: number = 0;
  public maxShield: number = 0;
  public shieldRegenRate: number = 2; // per second

  // Repair drone (for repair_drone upgrade)
  public hasRepairDrone: boolean = false;
  public repairRadius: number = 3;
  public repairRate: number = 5; // HP per second to adjacent walls

  constructor(isGate: boolean = false, canMountTurret: boolean = true) {
    super();
    this.isGate = isGate;
    this.canMountTurret = !isGate && canMountTurret;

    if (isGate) {
      this.gateState = 'auto'; // Default to auto mode
    }
  }

  // ==================== GATE MECHANICS ====================

  /**
   * Set gate state (open, closed, auto, locked)
   */
  public setGateState(state: GateState): void {
    if (!this.isGate) return;

    this.gateState = state;

    // If explicitly opened or closed, set progress accordingly
    if (state === 'open') {
      this.gateOpenProgress = 1;
    } else if (state === 'closed' || state === 'locked') {
      this.gateOpenProgress = 0;
    }
  }

  /**
   * Toggle gate between open and closed
   */
  public toggleGate(): void {
    if (!this.isGate) return;
    if (this.gateState === 'locked') return;

    if (this.gateState === 'open' || this.gateOpenProgress > 0.5) {
      this.gateState = 'closed';
    } else {
      this.gateState = 'open';
    }
  }

  /**
   * Lock/unlock the gate
   */
  public toggleLock(): void {
    if (!this.isGate) return;

    if (this.gateState === 'locked') {
      this.gateState = 'closed';
    } else {
      this.gateState = 'locked';
      this.gateOpenProgress = 0;
    }
  }

  /**
   * Set gate to auto mode
   */
  public setAutoMode(): void {
    if (!this.isGate) return;
    this.gateState = 'auto';
  }

  /**
   * Trigger gate to open (called when friendly unit approaches in auto mode)
   */
  public triggerOpen(): void {
    if (!this.isGate) return;
    if (this.gateState === 'locked') return;
    if (this.gateState === 'auto') {
      this.gateAutoCloseTimer = Wall.GATE_AUTO_CLOSE_DELAY;
    }
  }

  /**
   * Update gate animation and auto-close timer
   */
  public updateGate(deltaTime: number): void {
    if (!this.isGate) return;

    // Determine target open state
    let targetOpen = 0;
    if (this.gateState === 'open') {
      targetOpen = 1;
    } else if (this.gateState === 'auto' && this.gateAutoCloseTimer > 0) {
      targetOpen = 1;
      this.gateAutoCloseTimer -= deltaTime;
    }

    // Animate towards target
    const openSpeed = 1 / Wall.GATE_OPEN_TIME;
    if (this.gateOpenProgress < targetOpen) {
      this.gateOpenProgress = Math.min(1, this.gateOpenProgress + openSpeed * deltaTime);
    } else if (this.gateOpenProgress > targetOpen) {
      this.gateOpenProgress = Math.max(0, this.gateOpenProgress - openSpeed * deltaTime);
    }
  }

  /**
   * Check if gate is currently passable
   */
  public isPassable(): boolean {
    if (!this.isGate) return false;
    return this.gateOpenProgress > 0.5;
  }

  // ==================== TURRET MOUNTING ====================

  /**
   * Mount a turret on this wall segment
   */
  public mountTurret(turretEntityId: number): boolean {
    if (!this.canMountTurret) return false;
    if (this.mountedTurretId !== null) return false;
    if (this.appliedUpgrade === 'weapon') return false; // Already has weapon

    this.mountedTurretId = turretEntityId;
    return true;
  }

  /**
   * Dismount the turret from this wall
   */
  public dismountTurret(): number | null {
    const turretId = this.mountedTurretId;
    this.mountedTurretId = null;
    return turretId;
  }

  /**
   * Check if a turret can be mounted
   */
  public canMount(): boolean {
    return this.canMountTurret && this.mountedTurretId === null && this.appliedUpgrade !== 'weapon';
  }

  // ==================== UPGRADES ====================

  /**
   * Start applying an upgrade to this wall
   */
  public startUpgrade(upgradeType: WallUpgradeType): boolean {
    if (this.appliedUpgrade !== null) return false;
    if (this.upgradeInProgress !== null) return false;
    if (this.mountedTurretId !== null && upgradeType === 'weapon') return false;

    this.upgradeInProgress = upgradeType;
    this.upgradeProgress = 0;
    return true;
  }

  /**
   * Update upgrade progress
   */
  public updateUpgrade(deltaTime: number, upgradeTime: number): boolean {
    if (this.upgradeInProgress === null) return false;

    this.upgradeProgress += deltaTime / upgradeTime;

    if (this.upgradeProgress >= 1) {
      this.appliedUpgrade = this.upgradeInProgress;
      this.upgradeInProgress = null;
      this.upgradeProgress = 0;

      // Apply upgrade effects
      this.applyUpgradeEffects();
      return true;
    }

    return false;
  }

  /**
   * Apply the effects of the completed upgrade
   */
  private applyUpgradeEffects(): void {
    switch (this.appliedUpgrade) {
      case 'shielded':
        this.maxShield = 200;
        this.shield = 200;
        break;
      case 'repair_drone':
        this.hasRepairDrone = true;
        break;
      case 'weapon':
        this.canMountTurret = false;
        break;
    }
  }

  /**
   * Cancel in-progress upgrade
   */
  public cancelUpgrade(): WallUpgradeType | null {
    const upgrade = this.upgradeInProgress;
    this.upgradeInProgress = null;
    this.upgradeProgress = 0;
    return upgrade;
  }

  // ==================== SHIELD MECHANICS ====================

  /**
   * Update shield regeneration
   */
  public updateShield(deltaTime: number): void {
    if (this.maxShield <= 0) return;

    if (this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + this.shieldRegenRate * deltaTime);
    }
  }

  /**
   * Take damage to shield first, then return remaining damage
   */
  public absorbDamage(damage: number): number {
    if (this.shield <= 0) return damage;

    if (damage <= this.shield) {
      this.shield -= damage;
      return 0;
    } else {
      const remaining = damage - this.shield;
      this.shield = 0;
      return remaining;
    }
  }

  // ==================== CONNECTION UPDATES ====================

  /**
   * Update connection type based on current neighbors
   */
  public updateConnectionType(): void {
    const hasNorth = this.neighborNorth !== null;
    const hasSouth = this.neighborSouth !== null;
    const hasEast = this.neighborEast !== null;
    const hasWest = this.neighborWest !== null;

    const count = [hasNorth, hasSouth, hasEast, hasWest].filter(Boolean).length;

    if (count === 0) {
      this.connectionType = 'none';
    } else if (count === 4) {
      this.connectionType = 'cross';
    } else if (count === 3) {
      if (!hasNorth) this.connectionType = 't_south';
      else if (!hasSouth) this.connectionType = 't_north';
      else if (!hasEast) this.connectionType = 't_west';
      else this.connectionType = 't_east';
    } else if (count === 2) {
      if (hasNorth && hasSouth) this.connectionType = 'vertical';
      else if (hasEast && hasWest) this.connectionType = 'horizontal';
      else if (hasNorth && hasEast) this.connectionType = 'corner_ne';
      else if (hasNorth && hasWest) this.connectionType = 'corner_nw';
      else if (hasSouth && hasEast) this.connectionType = 'corner_se';
      else this.connectionType = 'corner_sw';
    } else {
      // count === 1
      if (hasNorth || hasSouth) this.connectionType = 'vertical';
      else this.connectionType = 'horizontal';
    }
  }

  /**
   * Set a neighbor reference
   */
  public setNeighbor(direction: 'north' | 'south' | 'east' | 'west', entityId: number | null): void {
    switch (direction) {
      case 'north':
        this.neighborNorth = entityId;
        break;
      case 'south':
        this.neighborSouth = entityId;
        break;
      case 'east':
        this.neighborEast = entityId;
        break;
      case 'west':
        this.neighborWest = entityId;
        break;
    }
    this.updateConnectionType();
  }

  /**
   * Get all neighbor IDs
   */
  public getNeighborIds(): number[] {
    const ids: number[] = [];
    if (this.neighborNorth !== null) ids.push(this.neighborNorth);
    if (this.neighborSouth !== null) ids.push(this.neighborSouth);
    if (this.neighborEast !== null) ids.push(this.neighborEast);
    if (this.neighborWest !== null) ids.push(this.neighborWest);
    return ids;
  }
}
