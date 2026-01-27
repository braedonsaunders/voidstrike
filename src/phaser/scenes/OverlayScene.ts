import * as Phaser from 'phaser';
import { EventBus } from '@/engine/core/EventBus';
import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, isLocalPlayer, getLocalPlayerId, enableSpectatorMode, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { useProjectionStore } from '@/store/projectionStore';
import { MusicPlayer } from '@/audio/MusicPlayer';
import { DamageNumberSystem } from '../systems/DamageNumberSystem';
import { ScreenEffectsSystem } from '../systems/ScreenEffectsSystem';

/**
 * Phaser 4 Overlay Scene
 *
 * This scene renders ABOVE the Three.js 3D world to provide:
 * - Tactical overlay view (toggle with Tab)
 * - Stylized ability effects and combat feedback
 * - Screen-space effects (damage vignettes, alerts)
 * - Animated alerts and notifications
 *
 * Hybrid 2D/3D approach where Phaser handles the UI polish layer.
 */

interface TacticalUnit {
  id: number;
  x: number;
  y: number;
  type: string;
  isEnemy: boolean;
  attackRange?: number;
  isSelected: boolean;
}

interface AlertMessage {
  text: string;
  color: number;
  x: number;
  y: number;
  createdAt: number;
  duration: number;
  graphics?: Phaser.GameObjects.Text;
}

interface ScreenEffect {
  type: 'damage_vignette' | 'ability_flash' | 'nuke_warning';
  intensity: number;
  startTime: number;
  duration: number;
}

interface DamageVignetteState {
  currentIntensity: number;
  targetIntensity: number;
  pulsePhase: number;
  lastDamageTime: number;
}

interface AbilitySplash {
  x: number;
  y: number;
  abilityName: string;
  color: number;
  startTime: number;
  duration: number;
  container?: Phaser.GameObjects.Container;
}

interface AttackTargetIndicator {
  entityId: number;
  startTime: number;
  duration: number;
}

interface GroundClickIndicator {
  worldX: number;
  worldY: number;
  type: 'move' | 'attack';
  startTime: number;
  duration: number;
}

export class OverlayScene extends Phaser.Scene {
  private eventBus: EventBus | null = null;

  // Store unsubscribe functions for cleanup (EventBus.on returns unsubscribe fn)
  private eventUnsubscribers: Array<() => void> = [];
  private resizeHandler: (() => void) | null = null;

  // Tactical view elements
  private tacticalMode = false;
  private tacticalGraphics!: Phaser.GameObjects.Graphics;
  private threatZoneGraphics!: Phaser.GameObjects.Graphics;
  private rallyPathGraphics!: Phaser.GameObjects.Graphics;

  // Screen effects
  private vignetteGraphics!: Phaser.GameObjects.Graphics;
  private screenEffects: ScreenEffect[] = [];

  // Alerts
  private alerts: AlertMessage[] = [];
  private alertContainer!: Phaser.GameObjects.Container;

  // Ability splashes
  private abilitySplashes: AbilitySplash[] = [];
  private splashContainer!: Phaser.GameObjects.Container;

  // Combat intensity tracking
  private combatIntensity = 0;
  private combatDecayRate = 0.5;
  private screenShakeIntensity = 0;

  // Screen edge warning indicators
  private edgeWarnings: Map<string, { x: number; y: number; time: number }> = new Map();

  // Damage vignette state
  private damageVignetteState: DamageVignetteState = {
    currentIntensity: 0,
    targetIntensity: 0,
    pulsePhase: 0,
    lastDamageTime: 0,
  };
  private vignetteTexture: Phaser.GameObjects.RenderTexture | null = null;
  private vignetteSprite: Phaser.GameObjects.Sprite | null = null;

  // Game end overlay elements (for hiding when continuing to spectate)
  private gameEndOverlay: Phaser.GameObjects.Graphics | null = null;
  private gameEndContainer: Phaser.GameObjects.Container | null = null;
  private escKeyListener: Phaser.Input.Keyboard.Key | null = null;

  // Match start countdown - Web Worker for timing (not throttled when tab inactive)
  private countdownActive = false;
  private countdownContainer: Phaser.GameObjects.Container | null = null;
  private countdownWorker: Worker | null = null;
  private countdownStartTime = 0;
  private currentCountdownState: 'waiting' | 3 | 2 | 1 | 'GO' | 'done' = 'waiting';
  private countdownText: Phaser.GameObjects.Text | null = null;
  private countdownGlow: Phaser.GameObjects.Graphics | null = null;
  private countdownRingGraphics: Phaser.GameObjects.Graphics | null = null;

  // Attack target indicators (animated circles when right-clicking to attack)
  private attackTargetIndicators: AttackTargetIndicator[] = [];
  private attackTargetGraphics!: Phaser.GameObjects.Graphics;

  // Ground click indicators (visual feedback when clicking ground for move/attack commands)
  private groundClickIndicators: GroundClickIndicator[] = [];
  private groundClickGraphics!: Phaser.GameObjects.Graphics;

  // Effect systems
  private damageNumberSystem: DamageNumberSystem | null = null;
  private screenEffectsSystem: ScreenEffectsSystem | null = null;

  // Note: SC2-style range overlays now handled by TSLGameOverlayManager
  // The following graphics are kept for destroy() cleanup but no longer used:
  private attackRangeGraphics!: Phaser.GameObjects.Graphics;
  private visionRangeGraphics!: Phaser.GameObjects.Graphics;
  private resourceOverlayGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    // Set active: false to prevent auto-start before eventBus is passed
    super({ key: 'OverlayScene', active: false });
  }

  // Check if we're in spectator mode (no human player)
  private isSpectator(): boolean {
    return useGameSetupStore.getState().isSpectator();
  }

  init(data: { eventBus: EventBus }): void {
    this.eventBus = data?.eventBus ?? null;
    if (!this.eventBus) {
      console.warn('[OverlayScene] init called without eventBus - scene will have limited functionality');
    } else {
      console.log('[OverlayScene] Initialized with eventBus');
    }
  }

  create(): void {
    console.log('[OverlayScene] create() called, eventBus:', this.eventBus ? 'present' : 'missing');

    // Create graphics layers (back to front)
    this.threatZoneGraphics = this.add.graphics();
    this.threatZoneGraphics.setDepth(10);

    this.tacticalGraphics = this.add.graphics();
    this.tacticalGraphics.setDepth(20);

    this.rallyPathGraphics = this.add.graphics();
    this.rallyPathGraphics.setDepth(30);

    // Attack target indicator graphics
    this.attackTargetGraphics = this.add.graphics();
    this.attackTargetGraphics.setDepth(35);

    // Ground click indicator graphics (move/attack commands)
    this.groundClickGraphics = this.add.graphics();
    this.groundClickGraphics.setDepth(36);

    // SC2-style range preview graphics
    this.attackRangeGraphics = this.add.graphics();
    this.attackRangeGraphics.setDepth(37);

    this.visionRangeGraphics = this.add.graphics();
    this.visionRangeGraphics.setDepth(38);

    this.resourceOverlayGraphics = this.add.graphics();
    this.resourceOverlayGraphics.setDepth(39);

    // Ability splash container
    this.splashContainer = this.add.container(0, 0);
    this.splashContainer.setDepth(100);

    // Alert container (top of screen)
    this.alertContainer = this.add.container(0, 0);
    this.alertContainer.setDepth(200);

    // Vignette for screen effects (covers entire screen)
    this.vignetteGraphics = this.add.graphics();
    this.vignetteGraphics.setDepth(300);

    // Create damage vignette render texture
    this.createDamageVignetteTexture();

    this.setupEventListeners();
    this.setupKeyboardShortcuts();

    // Initialize effect systems
    if (this.eventBus) {
      this.damageNumberSystem = new DamageNumberSystem(this, this.eventBus);
      this.screenEffectsSystem = new ScreenEffectsSystem(this, this.eventBus);
    }
  }

  /**
   * Set terrain height function for accurate damage number positioning
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.damageNumberSystem?.setTerrainHeightFunction(fn);
  }

  /**
   * Helper to register an event listener and track it for cleanup.
   * EventBus.on returns an unsubscribe function which we store.
   *
   * @param event - The event name to subscribe to
   * @param handler - Callback receiving the event data (typed per-call via generic)
   */
  private registerEvent<T = unknown>(event: string, handler: (data: T) => void): void {
    if (!this.eventBus) return;
    const unsubscribe = this.eventBus.on<T>(event, handler);
    this.eventUnsubscribers.push(unsubscribe);
  }

  private setupEventListeners(): void {
    if (!this.eventBus) {
      console.warn('[OverlayScene] setupEventListeners skipped - no eventBus');
      return;
    }
    console.log('[OverlayScene] Setting up event listeners');

    // Combat events increase intensity (only for human player)
    this.registerEvent('combat:attack', (data: {
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
      targetPlayerId?: string;
    }) => {
      // Skip combat feedback in spectator mode
      if (this.isSpectator()) return;

      // Only show intensity/warnings when local player's units are targeted
      // If targetPlayerId is not provided or not the local player, skip
      if (!data.targetPlayerId || !isLocalPlayer(data.targetPlayerId)) return;

      // Increase combat intensity
      this.combatIntensity = Math.min(1, this.combatIntensity + 0.05);

      // Check if attack is off-screen, show edge warning
      if (data.targetPos) {
        this.checkOffScreenAttack(data.targetPos.x, data.targetPos.y);
      }
    });

    // Player takes damage - show vignette (only for local player, not in battle simulator)
    this.registerEvent('player:damage', (data: { damage: number; position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode, battle simulator, or if not local player
      if (this.isSpectator()) return;
      if (isBattleSimulatorMode()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.addScreenEffect({
        type: 'damage_vignette',
        intensity: Math.min(0.5, data.damage / 100),
        startTime: Date.now(),
        duration: 300,
      });

      // Add screen shake based on damage
      this.screenShakeIntensity = Math.min(10, this.screenShakeIntensity + data.damage / 20);
    });

    // Nuclear launch detected!
    this.registerEvent('alert:nuclear', (data: { targetPosition?: { x: number; y: number } }) => {
      this.showAlert('NUCLEAR LAUNCH DETECTED', 0xff0000, 5000);
      this.addScreenEffect({
        type: 'nuke_warning',
        intensity: 0.3,
        startTime: Date.now(),
        duration: 2000,
      });
    });

    // Base under attack (only for local player)
    this.registerEvent('alert:underAttack', (data: { position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert('YOUR BASE IS UNDER ATTACK', 0xff4444, 3000);
      if (data.position) {
        this.checkOffScreenAttack(data.position.x, data.position.y);
      }
    });

    // Unit died (only show vignette for local player's units)
    this.registerEvent('unit:died', (data: { position?: { x: number; y: number }; isPlayerUnit?: boolean; playerId?: string }) => {
      // Skip screen effects in spectator mode
      if (this.isSpectator()) return;

      // Check if this is local player's unit
      const isLocalPlayerUnit = data.isPlayerUnit || (data.playerId && isLocalPlayer(data.playerId));
      if (isLocalPlayerUnit) {
        this.combatIntensity = Math.min(1, this.combatIntensity + 0.1);
        // Show damage vignette when player unit dies
        this.addScreenEffect({
          type: 'damage_vignette',
          intensity: 0.4,
          startTime: Date.now(),
          duration: 400,
        });
      }
    });

    // Player unit takes damage - show vignette (only for local player, not in battle simulator)
    // NOTE: This is a second listener for the same event - both will fire
    this.registerEvent('player:damage', (data: { damage: number; position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode, battle simulator, or if not local player
      if (this.isSpectator()) return;
      if (isBattleSimulatorMode()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.addScreenEffect({
        type: 'damage_vignette',
        intensity: Math.min(0.6, data.damage / 80),
        startTime: Date.now(),
        duration: 350,
      });
      // Add screen shake based on damage
      this.screenShakeIntensity = Math.min(12, this.screenShakeIntensity + data.damage / 15);
    });

    // Production complete notifications (only for local player)
    this.registerEvent('production:complete', (data: { unitName: string; buildingName?: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert(`${data.unitName.toUpperCase()} READY`, 0x00ff88, 2000);
    });

    // Research complete (only for local player)
    this.registerEvent('research:complete', (data: { researchName: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert(`RESEARCH COMPLETE: ${data.researchName.toUpperCase()}`, 0x00ffff, 3000);
    });

    // Building complete - only show for local player's buildings
    this.registerEvent('building:complete', (data: { buildingName?: string; buildingType?: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      const name = data.buildingName || data.buildingType || 'BUILDING';
      this.showAlert(`${name.toUpperCase()} COMPLETE`, 0x88ff00, 2000);
    });

    // Resource warnings (only for human player)
    this.registerEvent('warning:lowMinerals', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('NOT ENOUGH MINERALS', 0xffaa00, 1500);
    });

    this.registerEvent('warning:lowVespene', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('NOT ENOUGH VESPENE', 0x00ffaa, 1500);
    });

    this.registerEvent('warning:supplyBlocked', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('SUPPLY BLOCKED', 0xff6600, 2000);
    });

    // Major ability used - show splash effect
    this.registerEvent('ability:major', (data: {
      abilityName: string;
      position: { x: number; y: number };
      color?: number;
    }) => {
      // Project world coordinates to screen space
      const projectionStore = useProjectionStore.getState();
      const screenPos = projectionStore.projectToScreen(data.position.x, data.position.y);
      this.addAbilitySplash(screenPos.x, screenPos.y, data.abilityName, data.color ?? 0xffffff);
      this.showAlert(data.abilityName.toUpperCase(), data.color ?? 0xffffff, 2000);
    });

    // Player eliminated event (may or may not end the game)
    this.registerEvent('game:playerEliminated', (data: {
      playerId: string;
      reason: string;
      duration: number;
      gameOver: boolean;
      remainingPlayers: number;
    }) => {
      const localPlayerId = getLocalPlayerId();
      // Show defeat screen for local player when they are eliminated
      if (localPlayerId && data.playerId === localPlayerId) {
        // canSpectate = true if game continues (other players still fighting)
        const canSpectate = !data.gameOver && data.remainingPlayers >= 2;
        this.showGameEndOverlay(false, data.duration, data.reason, canSpectate);
      }
    });

    // Victory/Defeat events - game is completely over
    this.registerEvent('game:victory', (data: {
      winner: string;
      loser: string;
      reason: string;
      duration: number;
    }) => {
      const localPlayerId = getLocalPlayerId();
      const isVictory = localPlayerId ? data.winner === localPlayerId : null;
      // Game is over - no spectating option (canSpectate = false)
      this.showGameEndOverlay(isVictory, data.duration, data.reason, false, data.winner);
    });

    this.registerEvent('game:draw', (data: { duration: number }) => {
      // Game is over - no spectating option
      this.showGameEndOverlay(null, data.duration, 'draw', false);
    });

    // Match start countdown
    this.registerEvent('game:countdown', () => {
      this.showMatchCountdown();
    });

    // Attack target indicator - shows animated circle when right-clicking to attack
    this.registerEvent('command:attack', (data: {
      entityIds?: number[];
      targetEntityId?: number;
      targetPosition?: { x: number; y: number };
      playerId?: string;
      queue?: boolean;
    }) => {
      // Only show indicator for local player's commands (not AI)
      if (data.playerId && !isLocalPlayer(data.playerId)) return;
      // Skip in spectator mode (would show all players' indicators)
      if (this.isSpectator()) return;
      // Only show indicator when attacking a specific target entity
      if (data.targetEntityId !== undefined) {
        this.addAttackTargetIndicator(data.targetEntityId);
      }
    });

    // Ground click indicator for move commands
    this.registerEvent('command:moveGround', (data: {
      targetPosition: { x: number; y: number };
      playerId?: string;
    }) => {
      // Only show indicator for local player's commands
      if (data.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      this.addGroundClickIndicator(data.targetPosition.x, data.targetPosition.y, 'move');
    });

    // Ground click indicator for attack-move commands (clicking ground in attack mode)
    this.registerEvent('command:attackGround', (data: {
      targetPosition: { x: number; y: number };
      playerId?: string;
    }) => {
      // Only show indicator for local player's commands
      if (data.playerId && !isLocalPlayer(data.playerId)) return;
      if (this.isSpectator()) return;
      this.addGroundClickIndicator(data.targetPosition.x, data.targetPosition.y, 'attack');
    });

    // UI error messages - show as alerts so user can see what went wrong
    this.registerEvent('ui:error', (data: { message: string; playerId?: string }) => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      // Only show errors from local player (skip AI player errors)
      if (data.playerId && !isLocalPlayer(data.playerId)) return;
      this.showAlert(data.message.toUpperCase(), 0xff4444, 2000);
    });
  }

  private setupKeyboardShortcuts(): void {
    if (!this.input.keyboard) return;

    // Toggle tactical view with ` (backtick/tilde)
    this.input.keyboard.on('keydown-BACK_QUOTE', () => {
      this.tacticalMode = !this.tacticalMode;
      this.showAlert(
        this.tacticalMode ? 'TACTICAL VIEW: ON' : 'TACTICAL VIEW: OFF',
        0x00ffff,
        1000
      );
    });

    // Note: SC2-style range overlays (attack/vision) are now handled by
    // TSLGameOverlayManager in the WebGPU renderer via Alt+A and Alt+V
  }

  // Note: Range overlay methods removed - now handled by TSLGameOverlayManager

  /**
   * Match start countdown using Web Worker for timing.
   * Web Workers are NOT throttled when browser tab is inactive, ensuring
   * consistent timing for multiplayer game starts.
   *
   * The countdown calculates what to display based on wall-clock time,
   * so if the tab is backgrounded and refocused, it shows the correct state.
   */
  public showMatchCountdown(): void {
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.countdownStartTime = Date.now();
    this.currentCountdownState = 'waiting';

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // Create container for countdown elements
    this.countdownContainer = this.add.container(centerX, centerY);
    this.countdownContainer.setDepth(400);

    // Ring graphics for subtle expanding effect
    this.countdownRingGraphics = this.add.graphics();
    this.countdownRingGraphics.setDepth(395);

    // Create reusable glow graphics
    this.countdownGlow = this.add.graphics();
    this.countdownContainer.add(this.countdownGlow);

    // Create countdown text (will be updated by worker messages)
    this.countdownText = this.add.text(0, 0, '', {
      fontSize: '80px',
      fontFamily: 'Orbitron, Arial, sans-serif',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    });
    this.countdownText.setOrigin(0.5, 0.5);
    this.countdownText.setAlpha(0);
    this.countdownContainer.add(this.countdownText);

    // Initialize Web Worker for timing (ES module for Next.js 16+ Turbopack)
    try {
      this.countdownWorker = new Worker(
        new URL('../../workers/countdownWorker.ts', import.meta.url),
        { type: 'module' }
      );

      this.countdownWorker.onmessage = (event) => {
        const data = event.data;

        if (data.type === 'tick') {
          this.handleCountdownTick(data.state, centerX, centerY);
        } else if (data.type === 'complete') {
          this.handleCountdownComplete();
        }
      };

      this.countdownWorker.onerror = (error) => {
        console.error('[OverlayScene] Countdown worker error:', error);
        // Fallback: complete immediately on worker error
        this.handleCountdownComplete();
      };

      // Start the countdown worker
      this.countdownWorker.postMessage({
        type: 'start',
        startTime: this.countdownStartTime,
        duration: 4000, // 3, 2, 1, GO = 4 seconds
      });
    } catch (error) {
      // Fallback if Worker fails to initialize (e.g., in some environments)
      console.warn('[OverlayScene] Failed to create countdown worker, using fallback:', error);
      this.startFallbackCountdown(centerX, centerY);
    }
  }

  /**
   * Handle countdown tick from Web Worker.
   * Updates the visual display based on the current state.
   */
  private handleCountdownTick(
    state: 'waiting' | 3 | 2 | 1 | 'GO' | 'done',
    centerX: number,
    centerY: number
  ): void {
    // Only update visual when state changes
    if (state === this.currentCountdownState) return;
    if (state === 'done') return; // Handled by complete message

    const previousState = this.currentCountdownState;
    this.currentCountdownState = state;

    if (!this.countdownText || !this.countdownGlow || !this.countdownContainer) return;

    // Determine text to show
    let displayText = '';
    let isGo = false;
    if (typeof state === 'number') {
      displayText = state.toString();
    } else if (state === 'GO') {
      displayText = 'GO';
      isGo = true;
    }

    if (!displayText) return;

    // Update text
    this.countdownText.setText(displayText);
    this.countdownText.setFontSize(isGo ? 64 : 80);

    // Animate in the new number
    this.countdownText.setScale(0.7);
    this.countdownText.setAlpha(0);

    // Draw glow
    this.countdownGlow.clear();
    this.countdownGlow.fillStyle(0xffffff, 0.03);
    this.countdownGlow.fillCircle(0, 0, 80);
    this.countdownGlow.fillStyle(0xffffff, 0.02);
    this.countdownGlow.fillCircle(0, 0, 50);
    this.countdownGlow.setScale(0.5);
    this.countdownGlow.setAlpha(0);

    // Create expanding ring effect
    this.createCountdownRing(centerX, centerY);

    // Entrance animation
    this.tweens.add({
      targets: this.countdownText,
      scale: 1,
      alpha: 0.9,
      duration: 150,
      ease: 'Quad.easeOut',
    });

    this.tweens.add({
      targets: this.countdownGlow,
      scale: 1,
      alpha: 1,
      duration: 200,
      ease: 'Quad.easeOut',
    });

    // Exit animation (timed to match the 1-second per state)
    const holdDuration = isGo ? 350 : 650;
    this.time.delayedCall(holdDuration, () => {
      if (!this.countdownText || !this.countdownGlow) return;

      this.tweens.add({
        targets: this.countdownText,
        scale: 1.15,
        alpha: 0,
        duration: 200,
        ease: 'Quad.easeIn',
      });

      this.tweens.add({
        targets: this.countdownGlow,
        scale: 1.3,
        alpha: 0,
        duration: 250,
        ease: 'Quad.easeOut',
      });
    });
  }

  /**
   * Create a subtle expanding ring effect for countdown transitions
   */
  private createCountdownRing(centerX: number, centerY: number): void {
    if (!this.countdownRingGraphics) return;

    const startTime = Date.now();
    const duration = 400;

    const animateRing = () => {
      if (!this.countdownRingGraphics || !this.countdownActive) return;

      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        this.countdownRingGraphics.clear();
        return;
      }

      this.countdownRingGraphics.clear();
      const radius = 40 + 60 * this.easeOutQuart(progress);
      const alpha = (1 - progress) * 0.25;

      this.countdownRingGraphics.lineStyle(1.5, 0xffffff, alpha);
      this.countdownRingGraphics.strokeCircle(centerX, centerY, radius);

      requestAnimationFrame(animateRing);
    };

    animateRing();
  }

  /**
   * Handle countdown completion from Web Worker
   */
  private handleCountdownComplete(): void {
    // Cleanup worker
    if (this.countdownWorker) {
      this.countdownWorker.terminate();
      this.countdownWorker = null;
    }

    // Cleanup visual elements
    this.cleanupCountdown();

    // Signal that countdown is complete - game can now start
    this.eventBus?.emit('game:countdownComplete', {});
  }

  /**
   * Cleanup countdown visual elements
   */
  private cleanupCountdown(): void {
    this.countdownActive = false;

    if (this.countdownRingGraphics) {
      this.countdownRingGraphics.destroy();
      this.countdownRingGraphics = null;
    }

    if (this.countdownContainer) {
      this.countdownContainer.destroy();
      this.countdownContainer = null;
    }

    this.countdownText = null;
    this.countdownGlow = null;
    this.currentCountdownState = 'waiting';
  }

  /**
   * Fallback countdown using setInterval (for environments where Web Worker fails)
   * setInterval is throttled to minimum 1000ms in background tabs, but still works
   */
  private startFallbackCountdown(centerX: number, centerY: number): void {
    const startTime = this.countdownStartTime;
    const duration = 4000;

    const getState = (elapsed: number): 'waiting' | 3 | 2 | 1 | 'GO' | 'done' => {
      if (elapsed < 0) return 'waiting';
      if (elapsed < 1000) return 3;
      if (elapsed < 2000) return 2;
      if (elapsed < 3000) return 1;
      if (elapsed < 4000) return 'GO';
      return 'done';
    };

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const state = getState(elapsed);

      if (state === 'done') {
        clearInterval(intervalId);
        this.handleCountdownComplete();
        return;
      }

      this.handleCountdownTick(state, centerX, centerY);
    };

    // Tick immediately, then every 100ms
    tick();
    const intervalId = setInterval(tick, 100);
  }

  // Easing function for smooth animations
  private easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4);
  }

  /**
   * Create a radial vignette texture for damage overlay.
   */
  private createDamageVignetteTexture(): void {
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Create render texture for the vignette
    this.vignetteTexture = this.add.renderTexture(0, 0, screenWidth, screenHeight);
    this.vignetteTexture.setOrigin(0, 0);
    this.vignetteTexture.setDepth(301);
    this.vignetteTexture.setAlpha(0);

    // Draw the vignette pattern to the texture
    this.redrawVignetteTexture();

    // Handle resize - store handler for cleanup
    this.resizeHandler = () => {
      this.redrawVignetteTexture();
    };
    this.scale.on('resize', this.resizeHandler);
  }

  /**
   * Redraw the vignette texture (called on resize)
   */
  private redrawVignetteTexture(): void {
    if (!this.vignetteTexture) return;

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Resize the texture
    this.vignetteTexture.resize(screenWidth, screenHeight);
    this.vignetteTexture.clear();

    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Calculate vignette dimensions - relative to screen size
    const maxDimension = Math.max(screenWidth, screenHeight);

    // Create edge-based vignette with smooth gradient falloff
    const edgeWidth = maxDimension * 0.25;
    const steps = 32;

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const alpha = Math.pow(1 - t, 2.5) * 0.85; // Exponential falloff
      const offset = t * edgeWidth;

      // Blend from deep crimson at edges to brighter red inside
      const r = Math.floor(0x22 + (0xcc - 0x22) * t);
      const color = (r << 16) | 0x0000;

      graphics.lineStyle(edgeWidth / steps + 1, color, alpha);

      // Draw rounded rectangle frame
      if (offset < Math.min(screenWidth, screenHeight) / 2) {
        graphics.strokeRoundedRect(
          offset,
          offset,
          screenWidth - offset * 2,
          screenHeight - offset * 2,
          Math.max(0, 30 - offset * 0.5)
        );
      }
    }

    // Add corner bloom effects for extra polish
    const corners = [
      { x: 0, y: 0 },
      { x: screenWidth, y: 0 },
      { x: 0, y: screenHeight },
      { x: screenWidth, y: screenHeight },
    ];

    for (const corner of corners) {
      const bloomRadius = maxDimension * 0.35;
      const bloomSteps = 20;

      for (let i = 0; i < bloomSteps; i++) {
        const t = i / bloomSteps;
        const radius = bloomRadius * (1 - t);
        const alpha = Math.pow(t, 0.5) * 0.4;

        const r = Math.floor(0x88 + (0xff - 0x88) * (1 - t));
        const color = (r << 16) | 0x0000;

        graphics.fillStyle(color, alpha);
        graphics.fillCircle(corner.x, corner.y, radius);
      }
    }

    // Subtle edge glow line
    graphics.lineStyle(2, 0xff2200, 0.6);
    graphics.strokeRect(0, 0, screenWidth, screenHeight);

    graphics.lineStyle(1, 0xff4400, 0.4);
    graphics.strokeRect(2, 2, screenWidth - 4, screenHeight - 4);

    // Draw to render texture
    this.vignetteTexture.draw(graphics);
    graphics.destroy();
  }

  private checkOffScreenAttack(worldX: number, worldY: number): void {
    // Get camera position from game store
    const store = useGameStore.getState();
    const { cameraX, cameraY, cameraZoom } = store;

    // Convert to screen space (approximate)
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const viewWidth = screenWidth / (cameraZoom * 32); // Approximate view size
    const viewHeight = screenHeight / (cameraZoom * 32);

    const minX = cameraX - viewWidth / 2;
    const maxX = cameraX + viewWidth / 2;
    const minY = cameraY - viewHeight / 2;
    const maxY = cameraY + viewHeight / 2;

    // Check if position is off screen
    if (worldX < minX || worldX > maxX || worldY < minY || worldY > maxY) {
      // Determine edge direction
      let edgeX = screenWidth / 2;
      let edgeY = screenHeight / 2;

      if (worldX < minX) edgeX = 20;
      else if (worldX > maxX) edgeX = screenWidth - 20;

      if (worldY < minY) edgeY = 20;
      else if (worldY > maxY) edgeY = screenHeight - 20;

      const key = `${Math.round(edgeX / 50)}_${Math.round(edgeY / 50)}`;
      this.edgeWarnings.set(key, { x: edgeX, y: edgeY, time: Date.now() });
    }
  }

  private addScreenEffect(effect: ScreenEffect): void {
    this.screenEffects.push(effect);
  }

  /**
   * Show full-screen victory or defeat overlay
   * Animated game end screen with particle effects
   * @param isVictory - true for victory, false for defeat, null for draw/spectator
   * @param duration - game duration in seconds
   * @param reason - reason for game end
   * @param canSpectate - whether player can continue spectating (game continues with other players)
   * @param winner - optional winner player ID (for spectator display)
   */
  private showGameEndOverlay(isVictory: boolean | null, duration: number, reason: string, canSpectate: boolean = false, winner?: string): void {
    // If overlay is already showing, don't create another one
    if (this.gameEndOverlay || this.gameEndContainer) {
      return;
    }

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // Play victory or defeat music
    const musicUrl = isVictory === true
      ? '/audio/music/victory/victory.mp3'
      : '/audio/music/defeat/defeat.mp3';
    MusicPlayer.playOneShot(musicUrl);

    // Determine colors based on result
    let mainColor: number;
    let glowColor: number;
    let mainText: string;

    if (reason === 'draw') {
      mainText = 'DRAW';
      mainColor = 0xffd700;
      glowColor = 0xffaa00;
    } else if (isVictory === null) {
      mainText = 'GAME OVER';
      mainColor = 0x8899aa;
      glowColor = 0x667788;
    } else if (isVictory) {
      mainText = 'VICTORY';
      mainColor = 0x00ff88;
      glowColor = 0x00cc66;
    } else {
      mainText = 'DEFEAT';
      mainColor = 0xff4466;
      glowColor = 0xcc2244;
    }

    const colorHex = '#' + mainColor.toString(16).padStart(6, '0');
    const glowHex = '#' + glowColor.toString(16).padStart(6, '0');

    // Use device pixel ratio for crisp text on high-DPI displays
    const resolution = Math.min(window.devicePixelRatio || 1, 2);

    // Create dark overlay with animated fade
    const overlay = this.add.graphics();
    overlay.setDepth(500);
    overlay.fillStyle(0x000000, 0);
    overlay.fillRect(0, 0, screenWidth, screenHeight);
    this.gameEndOverlay = overlay;

    // Animate overlay darkness
    this.tweens.addCounter({
      from: 0,
      to: 0.9,
      duration: 600,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => {
        const alpha = tween.getValue() ?? 0;
        overlay.clear();
        overlay.fillStyle(0x000000, alpha);
        overlay.fillRect(0, 0, screenWidth, screenHeight);
      },
    });

    // Create container for all elements
    const container = this.add.container(centerX, centerY);
    container.setDepth(501);
    this.gameEndContainer = container;

    // Animated background glow burst
    const glowBurst = this.add.graphics();
    glowBurst.setAlpha(0);
    container.add(glowBurst);

    // Draw radial glow
    const drawGlow = (radius: number, alpha: number) => {
      glowBurst.clear();
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const r = radius * (1 - t);
        const a = alpha * Math.pow(t, 0.5);
        glowBurst.fillStyle(glowColor, a);
        glowBurst.fillCircle(0, 0, r);
      }
    };

    // Animate glow expansion
    this.tweens.addCounter({
      from: 50,
      to: 400,
      duration: 800,
      delay: 200,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => {
        drawGlow(tween.getValue() ?? 50, 0.15);
      },
    });

    this.tweens.add({
      targets: glowBurst,
      alpha: 1,
      duration: 400,
      delay: 200,
      ease: 'Quad.easeOut',
    });

    // Decorative horizontal lines that animate in
    const lineWidth = 300;
    const topLine = this.add.graphics();
    const bottomLine = this.add.graphics();
    topLine.lineStyle(2, mainColor, 0.6);
    bottomLine.lineStyle(2, mainColor, 0.6);
    topLine.setAlpha(0);
    bottomLine.setAlpha(0);
    container.add(topLine);
    container.add(bottomLine);

    // Glow text layer (behind main title)
    const titleGlow = this.add.text(0, -60, mainText, {
      fontSize: '108px',
      fontFamily: 'Orbitron, Arial Black, sans-serif',
      color: glowHex,
      stroke: glowHex,
      strokeThickness: 20,
      resolution,
    });
    titleGlow.setOrigin(0.5, 0.5);
    titleGlow.setAlpha(0);
    container.add(titleGlow);

    // Main title
    const title = this.add.text(0, -60, mainText, {
      fontSize: '108px',
      fontFamily: 'Orbitron, Arial Black, sans-serif',
      color: colorHex,
      stroke: '#000000',
      strokeThickness: 6,
      shadow: {
        offsetX: 0,
        offsetY: 4,
        color: '#000000',
        blur: 12,
        fill: true,
      },
      resolution,
    });
    title.setOrigin(0.5, 0.5);
    title.setAlpha(0);
    title.setScale(0.5);
    container.add(title);

    // Subtitle with reason
    let reasonText: string;
    if (isVictory === null && reason !== 'draw') {
      const winnerName = winner ? this.formatPlayerName(winner) : 'Unknown';
      if (reason === 'elimination') {
        reasonText = `${winnerName} Wins - Enemy Eliminated`;
      } else if (reason === 'surrender') {
        reasonText = `${winnerName} Wins - Enemy Surrendered`;
      } else {
        reasonText = `${winnerName} Wins`;
      }
    } else if (reason === 'draw') {
      reasonText = 'All Forces Lost';
    } else if (reason === 'elimination') {
      reasonText = isVictory ? 'Enemy Eliminated' : 'Your Forces Eliminated';
    } else if (reason === 'surrender') {
      reasonText = isVictory ? 'Enemy Surrendered' : 'You Surrendered';
    } else {
      reasonText = 'Game Over';
    }

    const subtitle = this.add.text(0, 30, reasonText, {
      fontSize: '28px',
      fontFamily: 'Orbitron, Inter, sans-serif',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      resolution,
    });
    subtitle.setOrigin(0.5, 0.5);
    subtitle.setAlpha(0);
    container.add(subtitle);

    // Game duration with icon-like decoration (format matches HUD clock: MM:SS with padded minutes)
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const durationLabel = this.add.text(-40, 80, 'DURATION', {
      fontSize: '14px',
      fontFamily: 'Orbitron, sans-serif',
      color: '#666666',
      resolution,
    });
    durationLabel.setOrigin(1, 0.5);
    durationLabel.setAlpha(0);
    container.add(durationLabel);

    const durationValue = this.add.text(0, 80, durationStr, {
      fontSize: '28px',
      fontFamily: 'Orbitron, sans-serif',
      color: '#ffffff',
      resolution,
    });
    durationValue.setOrigin(0.5, 0.5);
    durationValue.setAlpha(0);
    container.add(durationValue);

    // Spectate button or menu hint
    let actionElements: Phaser.GameObjects.GameObject[] = [];

    if (canSpectate) {
      const spectateButton = this.add.text(0, 150, '[ CONTINUE SPECTATING ]', {
        fontSize: '22px',
        fontFamily: 'Orbitron, sans-serif',
        color: '#00aaff',
        stroke: '#000000',
        strokeThickness: 3,
        resolution,
      });
      spectateButton.setOrigin(0.5, 0.5);
      spectateButton.setAlpha(0);
      spectateButton.setInteractive({ useHandCursor: true });

      spectateButton.on('pointerover', () => {
        spectateButton.setColor('#00ffff');
        this.tweens.add({
          targets: spectateButton,
          scale: 1.08,
          duration: 100,
          ease: 'Quad.easeOut',
        });
      });
      spectateButton.on('pointerout', () => {
        spectateButton.setColor('#00aaff');
        this.tweens.add({
          targets: spectateButton,
          scale: 1,
          duration: 100,
          ease: 'Quad.easeOut',
        });
      });
      spectateButton.on('pointerdown', () => {
        this.hideGameEndOverlay();
        setTimeout(() => {
          enableSpectatorMode();
        }, 0);
        MusicPlayer.play('gameplay');
      });

      container.add(spectateButton);
      actionElements.push(spectateButton);

      const hintText = this.add.text(0, 200, 'Press ESCAPE to return to menu', {
        fontSize: '16px',
        fontFamily: 'Inter, sans-serif',
        color: '#555555',
        resolution,
      });
      hintText.setOrigin(0.5, 0.5);
      hintText.setAlpha(0);
      container.add(hintText);
      actionElements.push(hintText);
    } else {
      const hintText = this.add.text(0, 150, 'Press ESCAPE to return to menu', {
        fontSize: '18px',
        fontFamily: 'Inter, sans-serif',
        color: '#666666',
        resolution,
      });
      hintText.setOrigin(0.5, 0.5);
      hintText.setAlpha(0);
      container.add(hintText);
      actionElements.push(hintText);
    }

    // === ANIMATION SEQUENCE ===

    // Title dramatic entrance (delay 300ms)
    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 500,
      delay: 300,
      ease: 'Back.easeOut',
    });

    // Title glow bloom
    this.tweens.add({
      targets: titleGlow,
      alpha: 0.35,
      duration: 600,
      delay: 300,
      ease: 'Quad.easeOut',
    });

    // Decorative lines animate in (delay 500ms)
    this.time.delayedCall(500, () => {
      // Animate lines from center outward
      let lineProgress = 0;
      const lineTimer = this.time.addEvent({
        delay: 16,
        repeat: 30,
        callback: () => {
          lineProgress += 1 / 30;
          const currentWidth = lineWidth * this.easeOutQuart(lineProgress);

          topLine.clear();
          topLine.lineStyle(2, mainColor, 0.5);
          topLine.lineBetween(-currentWidth / 2, -120, currentWidth / 2, -120);

          bottomLine.clear();
          bottomLine.lineStyle(2, mainColor, 0.5);
          bottomLine.lineBetween(-currentWidth / 2, 120, currentWidth / 2, 120);
        },
      });

      topLine.setAlpha(1);
      bottomLine.setAlpha(1);
    });

    // Subtitle fade in (delay 600ms)
    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      y: 25,
      duration: 400,
      delay: 600,
      ease: 'Quad.easeOut',
    });
    subtitle.y = 35;

    // Duration fade in (delay 800ms)
    this.tweens.add({
      targets: [durationLabel, durationValue],
      alpha: 1,
      duration: 400,
      delay: 800,
      ease: 'Quad.easeOut',
    });

    // Action elements fade in (delay 1000ms)
    this.tweens.add({
      targets: actionElements,
      alpha: 1,
      duration: 400,
      delay: 1000,
      ease: 'Quad.easeOut',
    });

    // Subtle title breathing animation (after entrance)
    this.time.delayedCall(900, () => {
      this.tweens.add({
        targets: title,
        scaleX: 1.02,
        scaleY: 1.02,
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Glow pulses slightly
      this.tweens.add({
        targets: titleGlow,
        alpha: 0.45,
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });

    // Listen for escape key
    if (this.input.keyboard) {
      this.escKeyListener = this.input.keyboard.addKey('ESC');
      this.escKeyListener.once('down', () => {
        window.location.href = '/';
      });
    }
  }

  /**
   * Format a player ID for display (e.g., "player1" -> "Player 1")
   */
  private formatPlayerName(playerId: string): string {
    // Extract number from player ID like "player1", "player2"
    const match = playerId.match(/player(\d+)/i);
    if (match) {
      return `Player ${match[1]}`;
    }
    // Fallback: capitalize first letter
    return playerId.charAt(0).toUpperCase() + playerId.slice(1);
  }

  /**
   * Hide the game end overlay (used when continuing to spectate)
   */
  private hideGameEndOverlay(): void {
    // Remove ESC key listener
    if (this.escKeyListener && this.input.keyboard) {
      this.input.keyboard.removeKey('ESC');
      this.escKeyListener = null;
    }

    // Animate out and destroy overlay elements
    if (this.gameEndContainer) {
      this.tweens.add({
        targets: this.gameEndContainer,
        alpha: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => {
          this.gameEndContainer?.destroy();
          this.gameEndContainer = null;
        },
      });
    }

    if (this.gameEndOverlay) {
      this.tweens.add({
        targets: this.gameEndOverlay,
        alpha: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => {
          this.gameEndOverlay?.destroy();
          this.gameEndOverlay = null;
        },
      });
    }
  }

  private showAlert(text: string, color: number, duration: number): void {
    const screenWidth = this.scale.width;
    const colorHex = `#${color.toString(16).padStart(6, '0')}`;
    const yPosition = 80 + this.alerts.length * 44;

    // Use device pixel ratio for crisp text on high-DPI displays
    const resolution = Math.min(window.devicePixelRatio || 1, 2);

    // Create container for the alert elements
    const alertContainer = this.add.container(screenWidth / 2, yPosition);
    alertContainer.setDepth(250);

    // Subtle glow/bloom layer behind text
    const glowText = this.add.text(0, 0, text, {
      fontSize: '22px',
      fontFamily: 'Orbitron, Arial Black, Arial, sans-serif',
      color: colorHex,
      stroke: colorHex,
      strokeThickness: 8,
      resolution,
    });
    glowText.setOrigin(0.5, 0.5);
    glowText.setAlpha(0.3);
    alertContainer.add(glowText);

    // Main alert text - crisp and readable
    const alertText = this.add.text(0, 0, text, {
      fontSize: '22px',
      fontFamily: 'Orbitron, Arial Black, Arial, sans-serif',
      color: colorHex,
      stroke: '#000000',
      strokeThickness: 4,
      shadow: {
        offsetX: 0,
        offsetY: 2,
        color: '#000000',
        blur: 6,
        fill: true,
      },
      resolution,
    });
    alertText.setOrigin(0.5, 0.5);
    alertContainer.add(alertText);

    // Decorative underline accent
    const textWidth = alertText.width;
    const underline = this.add.graphics();
    underline.lineStyle(2, color, 0.6);
    underline.lineBetween(-textWidth / 2, 14, textWidth / 2, 14);
    underline.setAlpha(0);
    alertContainer.add(underline);

    const alert: AlertMessage = {
      text,
      color,
      x: screenWidth / 2,
      y: yPosition,
      createdAt: Date.now(),
      duration,
      graphics: alertText,
    };

    this.alerts.push(alert);
    this.alertContainer.add(alertContainer);

    // Entrance animation: scale + alpha + slide
    alertContainer.setScale(0.8, 0.6);
    alertContainer.setAlpha(0);
    alertContainer.y = yPosition - 20;

    // Glow starts larger for bloom effect
    glowText.setScale(1.2);

    this.tweens.add({
      targets: alertContainer,
      scale: 1,
      alpha: 1,
      y: yPosition,
      duration: 200,
      ease: 'Back.easeOut',
    });

    // Glow settles to normal size
    this.tweens.add({
      targets: glowText,
      scale: 1,
      alpha: 0.25,
      duration: 300,
      ease: 'Quad.easeOut',
    });

    // Underline slides in from center
    this.tweens.add({
      targets: underline,
      alpha: 0.5,
      duration: 250,
      delay: 100,
      ease: 'Quad.easeOut',
    });

    // Exit animation: fade and slide up
    this.tweens.add({
      targets: alertContainer,
      alpha: 0,
      y: yPosition - 15,
      scale: 0.95,
      duration: 300,
      delay: duration - 300,
      ease: 'Quad.easeIn',
      onComplete: () => {
        alertContainer.destroy();
      },
    });
  }

  private addAbilitySplash(x: number, y: number, abilityName: string, color: number): void {
    const container = this.add.container(x, y);

    // Create burst effect
    const burst = this.add.graphics();
    burst.fillStyle(color, 0.8);

    // Draw starburst pattern
    const points = 8;
    const innerRadius = 20;
    const outerRadius = 60;

    for (let i = 0; i < points; i++) {
      const angle1 = (i / points) * Math.PI * 2;
      const angle2 = ((i + 0.5) / points) * Math.PI * 2;

      burst.beginPath();
      burst.moveTo(0, 0);
      burst.lineTo(Math.cos(angle1) * outerRadius, Math.sin(angle1) * outerRadius);
      burst.lineTo(Math.cos(angle2) * innerRadius, Math.sin(angle2) * innerRadius);
      burst.closePath();
      burst.fill();
    }

    container.add(burst);

    // Add ability name text
    const text = this.add.text(0, 0, abilityName.toUpperCase(), {
      fontSize: '18px',
      fontFamily: 'Arial Black',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    });
    text.setOrigin(0.5, 0.5);
    container.add(text);

    this.splashContainer.add(container);

    const splash: AbilitySplash = {
      x, y,
      abilityName,
      color,
      startTime: Date.now(),
      duration: 500,
      container,
    };

    this.abilitySplashes.push(splash);

    // Animate
    container.setScale(0);
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1.5,
      alpha: 1,
      duration: 100,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: container,
          scale: 2,
          alpha: 0,
          duration: 400,
          ease: 'Quad.easeOut',
        });
      },
    });
  }

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const now = Date.now();

    // Decay combat intensity
    this.combatIntensity = Math.max(0, this.combatIntensity - this.combatDecayRate * dt);
    this.screenShakeIntensity = Math.max(0, this.screenShakeIntensity - 20 * dt);

    // Apply screen shake
    if (this.screenShakeIntensity > 0.1) {
      const shakeX = (Math.random() - 0.5) * this.screenShakeIntensity;
      const shakeY = (Math.random() - 0.5) * this.screenShakeIntensity;
      this.cameras.main.setScroll(shakeX, shakeY);
    } else {
      this.cameras.main.setScroll(0, 0);
    }

    // Clear tactical graphics
    this.tacticalGraphics.clear();
    this.threatZoneGraphics.clear();
    this.rallyPathGraphics.clear();
    this.vignetteGraphics.clear();
    this.attackRangeGraphics.clear();
    this.visionRangeGraphics.clear();
    this.resourceOverlayGraphics.clear();

    // Draw tactical overlay if enabled
    if (this.tacticalMode) {
      this.drawTacticalOverlay();
    }

    // Note: Range previews and resource overlays now handled by TSLGameOverlayManager

    // Update damage vignette
    this.updateDamageVignette(now, dt);

    // Draw other screen effects (ability flash, nuke warning)
    this.updateScreenEffects(now);

    // Draw combat intensity border
    if (this.combatIntensity > 0.1) {
      this.drawCombatIntensityBorder();
    }

    // Update edge warnings
    this.updateEdgeWarnings(now);

    // Cleanup expired alerts
    this.cleanupAlerts(now);

    // Cleanup expired splashes
    this.cleanupSplashes(now);

    // Draw and update attack target indicators
    this.updateAttackTargetIndicators(now);

    // Draw and update ground click indicators
    this.updateGroundClickIndicators(now);

    // Update effect systems
    this.damageNumberSystem?.update();
    this.screenEffectsSystem?.update(time, delta);

    // Apply screen shake from effects system
    const effectsShake = this.screenEffectsSystem?.getScreenShakeIntensity() ?? 0;
    if (effectsShake > 0.1) {
      const totalShake = this.screenShakeIntensity + effectsShake;
      const shakeX = (Math.random() - 0.5) * totalShake;
      const shakeY = (Math.random() - 0.5) * totalShake;
      this.cameras.main.setScroll(shakeX, shakeY);
    }
  }

  /**
   * Update the damage vignette with smooth animations.
   */
  private updateDamageVignette(now: number, dt: number): void {
    if (!this.vignetteTexture) return;

    const state = this.damageVignetteState;

    // Calculate target intensity from active damage effects
    let targetIntensity = 0;
    for (const effect of this.screenEffects) {
      if (effect.type === 'damage_vignette') {
        const elapsed = now - effect.startTime;
        const progress = elapsed / effect.duration;
        if (progress < 1) {
          // Use a more interesting curve - quick rise, slow fall
          const curve = progress < 0.15
            ? progress / 0.15 // Fast rise
            : Math.pow(1 - (progress - 0.15) / 0.85, 1.5); // Slow exponential fall
          targetIntensity = Math.max(targetIntensity, effect.intensity * curve);
        }
      }
    }

    state.targetIntensity = targetIntensity;

    // Smooth lerp to target (fast rise, slower fall)
    const lerpSpeed = state.currentIntensity < state.targetIntensity ? 15 : 4;
    state.currentIntensity = state.currentIntensity + (state.targetIntensity - state.currentIntensity) * Math.min(1, lerpSpeed * dt);

    // Add subtle pulse when taking damage
    state.pulsePhase += dt * 8;
    const pulse = state.currentIntensity > 0.05
      ? 1 + Math.sin(state.pulsePhase) * 0.08 * state.currentIntensity
      : 1;

    // Calculate final alpha with pulse
    const finalAlpha = state.currentIntensity * pulse;

    // Apply to vignette texture
    if (finalAlpha > 0.01) {
      this.vignetteTexture.setAlpha(finalAlpha);
      this.vignetteTexture.setVisible(true);

      // Subtle scale pulse for extra punch on high damage
      if (state.currentIntensity > 0.3) {
        const scalePulse = 1 + (state.currentIntensity - 0.3) * 0.02 * Math.sin(state.pulsePhase * 1.5);
        this.vignetteTexture.setScale(scalePulse);
      } else {
        this.vignetteTexture.setScale(1);
      }
    } else {
      this.vignetteTexture.setVisible(false);
      state.pulsePhase = 0;
    }
  }

  private drawTacticalOverlay(): void {
    const store = useGameStore.getState();
    const selectedUnits = store.selectedUnits;

    // Draw grid overlay with tactical styling
    this.tacticalGraphics.lineStyle(1, 0x00ffff, 0.1);

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const gridSize = 64;

    for (let x = 0; x < screenWidth; x += gridSize) {
      this.tacticalGraphics.lineBetween(x, 0, x, screenHeight);
    }
    for (let y = 0; y < screenHeight; y += gridSize) {
      this.tacticalGraphics.lineBetween(0, y, screenWidth, y);
    }

    // Draw "TACTICAL" label
    if (!this.tacticalGraphics.getData('hasLabel')) {
      const label = this.add.text(screenWidth - 20, 20, 'TACTICAL', {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: '#00ffff',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 4 },
      });
      label.setOrigin(1, 0);
      label.setDepth(25);
      this.tacticalGraphics.setData('labelObj', label);
      this.tacticalGraphics.setData('hasLabel', true);
    }

    // Show the label
    const labelObj = this.tacticalGraphics.getData('labelObj') as Phaser.GameObjects.Text;
    if (labelObj) labelObj.setVisible(true);
  }

  private updateScreenEffects(now: number): void {
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    for (let i = this.screenEffects.length - 1; i >= 0; i--) {
      const effect = this.screenEffects[i];
      const elapsed = now - effect.startTime;
      const progress = elapsed / effect.duration;

      if (progress >= 1) {
        this.screenEffects.splice(i, 1);
        continue;
      }

      const alpha = effect.intensity * (1 - progress);

      switch (effect.type) {
        case 'damage_vignette':
          // Handled by updateDamageVignette - just keep the effect alive for timing
          break;

        case 'ability_flash':
          // White flash with smooth falloff
          const flashCurve = Math.pow(1 - progress, 2);
          this.vignetteGraphics.fillStyle(0xffffff, alpha * 0.5 * flashCurve);
          this.vignetteGraphics.fillRect(0, 0, screenWidth, screenHeight);
          break;

        case 'nuke_warning':
          // Pulsing red with scan lines
          const pulse = Math.sin(progress * Math.PI * 6) * 0.5 + 0.5;
          this.vignetteGraphics.fillStyle(0xff0000, alpha * pulse * 0.2);
          this.vignetteGraphics.fillRect(0, 0, screenWidth, screenHeight);

          // Scan lines
          this.vignetteGraphics.lineStyle(1, 0xff0000, alpha * 0.3);
          for (let y = 0; y < screenHeight; y += 4) {
            this.vignetteGraphics.lineBetween(0, y, screenWidth, y);
          }
          break;
      }
    }
  }

  private drawCombatIntensityBorder(): void {
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Pulsing border based on combat intensity - MORE VISIBLE
    const pulse = Math.sin(Date.now() / 80) * 0.4 + 0.6;
    const alpha = this.combatIntensity * 0.7 * pulse;

    // Outer glow effect (multiple layers)
    for (let i = 0; i < 3; i++) {
      const offset = i * 4;
      const layerAlpha = alpha * (1 - i * 0.3);
      this.vignetteGraphics.lineStyle(6 - i * 2, 0xff4400, layerAlpha);
      this.vignetteGraphics.strokeRect(offset, offset, screenWidth - offset * 2, screenHeight - offset * 2);
    }

    // Corner highlights - BIGGER and BRIGHTER
    const cornerSize = 50 + this.combatIntensity * 40;
    const cornerThickness = 6 + this.combatIntensity * 4;
    this.vignetteGraphics.lineStyle(cornerThickness, 0xff6600, alpha * 1.8);

    // Top-left
    this.vignetteGraphics.lineBetween(0, cornerSize, 0, 0);
    this.vignetteGraphics.lineBetween(0, 0, cornerSize, 0);

    // Top-right
    this.vignetteGraphics.lineBetween(screenWidth - cornerSize, 0, screenWidth, 0);
    this.vignetteGraphics.lineBetween(screenWidth, 0, screenWidth, cornerSize);

    // Bottom-left
    this.vignetteGraphics.lineBetween(0, screenHeight - cornerSize, 0, screenHeight);
    this.vignetteGraphics.lineBetween(0, screenHeight, cornerSize, screenHeight);

    // Bottom-right
    this.vignetteGraphics.lineBetween(screenWidth - cornerSize, screenHeight, screenWidth, screenHeight);
    this.vignetteGraphics.lineBetween(screenWidth, screenHeight - cornerSize, screenWidth, screenHeight);

    // Inner corner accents
    this.vignetteGraphics.lineStyle(2, 0xffaa00, alpha * 2);
    const innerCorner = 20;
    this.vignetteGraphics.lineBetween(innerCorner, innerCorner + 15, innerCorner, innerCorner);
    this.vignetteGraphics.lineBetween(innerCorner, innerCorner, innerCorner + 15, innerCorner);

    this.vignetteGraphics.lineBetween(screenWidth - innerCorner - 15, innerCorner, screenWidth - innerCorner, innerCorner);
    this.vignetteGraphics.lineBetween(screenWidth - innerCorner, innerCorner, screenWidth - innerCorner, innerCorner + 15);

    this.vignetteGraphics.lineBetween(innerCorner, screenHeight - innerCorner - 15, innerCorner, screenHeight - innerCorner);
    this.vignetteGraphics.lineBetween(innerCorner, screenHeight - innerCorner, innerCorner + 15, screenHeight - innerCorner);

    this.vignetteGraphics.lineBetween(screenWidth - innerCorner - 15, screenHeight - innerCorner, screenWidth - innerCorner, screenHeight - innerCorner);
    this.vignetteGraphics.lineBetween(screenWidth - innerCorner, screenHeight - innerCorner - 15, screenWidth - innerCorner, screenHeight - innerCorner);
  }

  private updateEdgeWarnings(now: number): void {
    // Draw warning indicators at screen edges for off-screen attacks
    for (const [key, warning] of this.edgeWarnings) {
      const age = now - warning.time;
      if (age > 2000) {
        this.edgeWarnings.delete(key);
        continue;
      }

      const pulse = Math.sin(age / 100) * 0.3 + 0.7;
      const alpha = (1 - age / 2000) * pulse;

      // Draw warning arrow/indicator
      this.vignetteGraphics.fillStyle(0xff0000, alpha);

      const size = 15;
      const x = warning.x;
      const y = warning.y;

      // Draw triangle pointing inward
      if (x < 50) {
        // Left edge - point right
        this.vignetteGraphics.fillTriangle(x, y, x + size, y - size/2, x + size, y + size/2);
      } else if (x > this.scale.width - 50) {
        // Right edge - point left
        this.vignetteGraphics.fillTriangle(x, y, x - size, y - size/2, x - size, y + size/2);
      }

      if (y < 50) {
        // Top edge - point down
        this.vignetteGraphics.fillTriangle(x, y, x - size/2, y + size, x + size/2, y + size);
      } else if (y > this.scale.height - 50) {
        // Bottom edge - point up
        this.vignetteGraphics.fillTriangle(x, y, x - size/2, y - size, x + size/2, y - size);
      }
    }
  }

  private cleanupAlerts(now: number): void {
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const alert = this.alerts[i];
      const age = now - alert.createdAt;

      if (age > alert.duration) {
        if (alert.graphics) {
          alert.graphics.destroy();
        }
        this.alerts.splice(i, 1);
      }
    }
  }

  private cleanupSplashes(now: number): void {
    for (let i = this.abilitySplashes.length - 1; i >= 0; i--) {
      const splash = this.abilitySplashes[i];
      const age = now - splash.startTime;

      if (age > splash.duration) {
        if (splash.container) {
          splash.container.destroy();
        }
        this.abilitySplashes.splice(i, 1);
      }
    }
  }

  /**
   * Add an attack target indicator for the specified entity
   * Shows an animated red circle under the target
   */
  private addAttackTargetIndicator(entityId: number): void {
    // Remove any existing indicator for this entity
    this.attackTargetIndicators = this.attackTargetIndicators.filter(
      (indicator) => indicator.entityId !== entityId
    );

    // Add new indicator
    this.attackTargetIndicators.push({
      entityId,
      startTime: Date.now(),
      duration: 600, // 600ms animation
    });
  }

  /**
   * Update and draw attack target indicators
   * Draws animated expanding/fading circles at target positions
   */
  private updateAttackTargetIndicators(now: number): void {
    this.attackTargetGraphics.clear();

    const projectionStore = useProjectionStore.getState();

    // Process indicators in reverse to safely remove expired ones
    for (let i = this.attackTargetIndicators.length - 1; i >= 0; i--) {
      const indicator = this.attackTargetIndicators[i];
      const elapsed = now - indicator.startTime;
      const progress = elapsed / indicator.duration;

      // Remove expired indicators
      if (progress >= 1) {
        this.attackTargetIndicators.splice(i, 1);
        continue;
      }

      // Get entity position from game world
      const game = Game.getInstance();
      if (!game) continue;

      let entityPos: { x: number; y: number } | null = null;
      const entity = game.world.getEntity(indicator.entityId);
      if (entity) {
        const transform = entity.get<Transform>('Transform');
        if (transform) {
          entityPos = { x: transform.x, y: transform.y };
        }
      }

      if (!entityPos) {
        // Entity no longer exists, remove indicator
        this.attackTargetIndicators.splice(i, 1);
        continue;
      }

      // Project world position to screen
      const screenPos = projectionStore.projectToScreen(entityPos.x, entityPos.y);

      // Draw animated indicator - multiple rings that expand and fade
      const baseRadius = 25;
      const maxRadius = 50;

      // Ring 1: Primary expanding ring
      const ring1Progress = Math.min(1, progress * 1.5);
      const ring1Radius = baseRadius + (maxRadius - baseRadius) * ring1Progress;
      const ring1Alpha = (1 - ring1Progress) * 0.8;

      if (ring1Alpha > 0.01) {
        this.attackTargetGraphics.lineStyle(3, 0xff3333, ring1Alpha);
        this.attackTargetGraphics.strokeCircle(screenPos.x, screenPos.y, ring1Radius);
      }

      // Ring 2: Secondary ring (delayed)
      if (progress > 0.15) {
        const ring2Progress = Math.min(1, (progress - 0.15) * 1.8);
        const ring2Radius = baseRadius * 0.7 + (maxRadius * 0.8 - baseRadius * 0.7) * ring2Progress;
        const ring2Alpha = (1 - ring2Progress) * 0.5;

        if (ring2Alpha > 0.01) {
          this.attackTargetGraphics.lineStyle(2, 0xff6666, ring2Alpha);
          this.attackTargetGraphics.strokeCircle(screenPos.x, screenPos.y, ring2Radius);
        }
      }

      // Inner fill pulse (quick flash at start)
      if (progress < 0.3) {
        const fillProgress = progress / 0.3;
        const fillAlpha = (1 - fillProgress) * 0.25;
        this.attackTargetGraphics.fillStyle(0xff0000, fillAlpha);
        this.attackTargetGraphics.fillCircle(screenPos.x, screenPos.y, baseRadius * (1 - fillProgress * 0.3));
      }

      // Crosshair lines (X pattern) that fade
      if (progress < 0.5) {
        const lineProgress = progress / 0.5;
        const lineAlpha = (1 - lineProgress) * 0.6;
        const lineLength = 15 + 10 * lineProgress;

        this.attackTargetGraphics.lineStyle(2, 0xff4444, lineAlpha);

        // Diagonal lines forming X
        const offset = baseRadius * 0.5 + lineLength * lineProgress;
        this.attackTargetGraphics.lineBetween(
          screenPos.x - offset, screenPos.y - offset,
          screenPos.x - offset + lineLength, screenPos.y - offset + lineLength
        );
        this.attackTargetGraphics.lineBetween(
          screenPos.x + offset, screenPos.y - offset,
          screenPos.x + offset - lineLength, screenPos.y - offset + lineLength
        );
        this.attackTargetGraphics.lineBetween(
          screenPos.x - offset, screenPos.y + offset,
          screenPos.x - offset + lineLength, screenPos.y + offset - lineLength
        );
        this.attackTargetGraphics.lineBetween(
          screenPos.x + offset, screenPos.y + offset,
          screenPos.x + offset - lineLength, screenPos.y + offset - lineLength
        );
      }
    }
  }

  /**
   * Add a ground click indicator at the specified world position
   * Shows visual feedback when clicking ground for move or attack commands
   */
  private addGroundClickIndicator(worldX: number, worldY: number, type: 'move' | 'attack'): void {
    this.groundClickIndicators.push({
      worldX,
      worldY,
      type,
      startTime: Date.now(),
      duration: 500,
    });
  }

  /**
   * Update and draw ground click indicators
   * Move: Green expanding ring with chevron arrows pointing inward
   * Attack: Red expanding ring with crosshair pattern
   */
  private updateGroundClickIndicators(now: number): void {
    this.groundClickGraphics.clear();

    const projectionStore = useProjectionStore.getState();

    for (let i = this.groundClickIndicators.length - 1; i >= 0; i--) {
      const indicator = this.groundClickIndicators[i];
      const elapsed = now - indicator.startTime;
      const progress = elapsed / indicator.duration;

      if (progress >= 1) {
        this.groundClickIndicators.splice(i, 1);
        continue;
      }

      // Project world position to screen
      const screenPos = projectionStore.projectToScreen(indicator.worldX, indicator.worldY);

      if (indicator.type === 'move') {
        this.drawMoveIndicator(screenPos.x, screenPos.y, progress);
      } else {
        this.drawAttackGroundIndicator(screenPos.x, screenPos.y, progress);
      }
    }
  }

  /**
   * Draw move command indicator - green ring with inward-pointing chevrons
   */
  private drawMoveIndicator(x: number, y: number, progress: number): void {
    const baseRadius = 20;
    const maxRadius = 40;

    // Primary expanding ring
    const ringProgress = Math.min(1, progress * 1.5);
    const ringRadius = baseRadius + (maxRadius - baseRadius) * ringProgress;
    const ringAlpha = (1 - ringProgress) * 0.8;

    if (ringAlpha > 0.01) {
      this.groundClickGraphics.lineStyle(2.5, 0x00ff66, ringAlpha);
      this.groundClickGraphics.strokeCircle(x, y, ringRadius);
    }

    // Secondary ring (delayed)
    if (progress > 0.1) {
      const ring2Progress = Math.min(1, (progress - 0.1) * 1.6);
      const ring2Radius = baseRadius * 0.6 + (maxRadius * 0.7 - baseRadius * 0.6) * ring2Progress;
      const ring2Alpha = (1 - ring2Progress) * 0.5;

      if (ring2Alpha > 0.01) {
        this.groundClickGraphics.lineStyle(1.5, 0x44ff88, ring2Alpha);
        this.groundClickGraphics.strokeCircle(x, y, ring2Radius);
      }
    }

    // Center dot that pulses
    if (progress < 0.6) {
      const dotProgress = progress / 0.6;
      const dotAlpha = (1 - dotProgress) * 0.6;
      const dotRadius = 4 + 2 * dotProgress;
      this.groundClickGraphics.fillStyle(0x00ff66, dotAlpha);
      this.groundClickGraphics.fillCircle(x, y, dotRadius);
    }

    // Inward-pointing chevrons (4 directions)
    if (progress < 0.5) {
      const chevronProgress = progress / 0.5;
      const chevronAlpha = (1 - chevronProgress) * 0.7;
      const chevronDist = baseRadius + 8 - 6 * chevronProgress;
      const chevronSize = 6;

      this.groundClickGraphics.lineStyle(2, 0x00ff66, chevronAlpha);

      // Draw 4 chevrons pointing inward
      const directions = [
        { angle: 0, dx: 1, dy: 0 },       // Right
        { angle: Math.PI / 2, dx: 0, dy: 1 },   // Down
        { angle: Math.PI, dx: -1, dy: 0 },      // Left
        { angle: -Math.PI / 2, dx: 0, dy: -1 }, // Up
      ];

      for (const dir of directions) {
        const cx = x + dir.dx * chevronDist;
        const cy = y + dir.dy * chevronDist;

        // Chevron pointing toward center
        const perpX = -dir.dy;
        const perpY = dir.dx;

        this.groundClickGraphics.lineBetween(
          cx + perpX * chevronSize - dir.dx * chevronSize,
          cy + perpY * chevronSize - dir.dy * chevronSize,
          cx,
          cy
        );
        this.groundClickGraphics.lineBetween(
          cx - perpX * chevronSize - dir.dx * chevronSize,
          cy - perpY * chevronSize - dir.dy * chevronSize,
          cx,
          cy
        );
      }
    }
  }

  /**
   * Draw attack-ground command indicator - red ring with X crosshair
   */
  private drawAttackGroundIndicator(x: number, y: number, progress: number): void {
    const baseRadius = 22;
    const maxRadius = 45;

    // Primary expanding ring
    const ringProgress = Math.min(1, progress * 1.5);
    const ringRadius = baseRadius + (maxRadius - baseRadius) * ringProgress;
    const ringAlpha = (1 - ringProgress) * 0.8;

    if (ringAlpha > 0.01) {
      this.groundClickGraphics.lineStyle(2.5, 0xff4444, ringAlpha);
      this.groundClickGraphics.strokeCircle(x, y, ringRadius);
    }

    // Secondary ring
    if (progress > 0.12) {
      const ring2Progress = Math.min(1, (progress - 0.12) * 1.7);
      const ring2Radius = baseRadius * 0.65 + (maxRadius * 0.75 - baseRadius * 0.65) * ring2Progress;
      const ring2Alpha = (1 - ring2Progress) * 0.5;

      if (ring2Alpha > 0.01) {
        this.groundClickGraphics.lineStyle(1.5, 0xff6666, ring2Alpha);
        this.groundClickGraphics.strokeCircle(x, y, ring2Radius);
      }
    }

    // Inner fill flash
    if (progress < 0.25) {
      const fillProgress = progress / 0.25;
      const fillAlpha = (1 - fillProgress) * 0.2;
      this.groundClickGraphics.fillStyle(0xff0000, fillAlpha);
      this.groundClickGraphics.fillCircle(x, y, baseRadius * (1 - fillProgress * 0.2));
    }

    // X crosshair pattern
    if (progress < 0.55) {
      const xProgress = progress / 0.55;
      const xAlpha = (1 - xProgress) * 0.7;
      const xSize = 10 + 5 * xProgress;
      const xOffset = baseRadius * 0.4;

      this.groundClickGraphics.lineStyle(2, 0xff4444, xAlpha);

      // Draw X pattern
      this.groundClickGraphics.lineBetween(
        x - xOffset - xSize * 0.5, y - xOffset - xSize * 0.5,
        x - xOffset + xSize * 0.5, y - xOffset + xSize * 0.5
      );
      this.groundClickGraphics.lineBetween(
        x + xOffset - xSize * 0.5, y - xOffset + xSize * 0.5,
        x + xOffset + xSize * 0.5, y - xOffset - xSize * 0.5
      );
      this.groundClickGraphics.lineBetween(
        x - xOffset - xSize * 0.5, y + xOffset + xSize * 0.5,
        x - xOffset + xSize * 0.5, y + xOffset - xSize * 0.5
      );
      this.groundClickGraphics.lineBetween(
        x + xOffset - xSize * 0.5, y + xOffset - xSize * 0.5,
        x + xOffset + xSize * 0.5, y + xOffset + xSize * 0.5
      );
    }
  }

  setTacticalMode(enabled: boolean): void {
    this.tacticalMode = enabled;

    // Hide label when tactical mode is off
    const labelObj = this.tacticalGraphics.getData('labelObj') as Phaser.GameObjects.Text;
    if (labelObj) {
      labelObj.setVisible(enabled);
    }
  }

  getTacticalMode(): boolean {
    return this.tacticalMode;
  }

  // Note: Attack range, vision range, and resource overlay methods have been removed.
  // These are now handled by TSLGameOverlayManager in the WebGPU renderer.

  destroy(): void {
    // Clean up all EventBus listeners to prevent memory leaks
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers = [];

    // Clean up Phaser scale resize listener
    if (this.resizeHandler) {
      this.scale.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Clean up all graphics and containers
    this.tacticalGraphics?.destroy();
    this.threatZoneGraphics?.destroy();
    this.rallyPathGraphics?.destroy();
    this.vignetteGraphics?.destroy();
    this.vignetteTexture?.destroy();
    this.alertContainer?.destroy();
    this.splashContainer?.destroy();
    this.countdownContainer?.destroy();
    this.attackTargetGraphics?.destroy();
    this.groundClickGraphics?.destroy();
    this.attackRangeGraphics?.destroy();
    this.visionRangeGraphics?.destroy();
    this.resourceOverlayGraphics?.destroy();

    for (const alert of this.alerts) {
      alert.graphics?.destroy();
    }
    for (const splash of this.abilitySplashes) {
      splash.container?.destroy();
    }

    this.alerts = [];
    this.abilitySplashes = [];
    this.attackTargetIndicators = [];
    this.groundClickIndicators = [];
    this.edgeWarnings.clear();
    this.vignetteTexture = null;
    this.countdownContainer = null;

    // Dispose effect systems
    this.damageNumberSystem?.dispose();
    this.screenEffectsSystem?.dispose();
    this.damageNumberSystem = null;
    this.screenEffectsSystem = null;
  }
}
