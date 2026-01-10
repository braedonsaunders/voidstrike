import * as Phaser from 'phaser';
import { EventBus } from '@/engine/core/EventBus';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, isLocalPlayer, getLocalPlayerId, enableSpectatorMode } from '@/store/gameSetupStore';
import { useProjectionStore } from '@/store/projectionStore';
import { MusicPlayer } from '@/audio/MusicPlayer';

/**
 * Phaser 4 Overlay Scene
 *
 * This scene renders ABOVE the Three.js 3D world to provide:
 * - Tactical overlay view (toggle with Tab)
 * - Stylized ability effects and combat feedback
 * - Screen-space effects (damage vignettes, alerts)
 * - Animated alerts and notifications
 *
 * This is what makes VOIDSTRIKE unique - a hybrid 2D/3D approach
 * where Phaser handles the "game feel" polish layer.
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

export class OverlayScene extends Phaser.Scene {
  private eventBus: EventBus | null = null;

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

  // Premium damage vignette state
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

  constructor() {
    super({ key: 'OverlayScene' });
  }

  // Check if we're in spectator mode (no human player)
  private isSpectator(): boolean {
    return useGameSetupStore.getState().isSpectator();
  }

  init(data: { eventBus: EventBus }): void {
    this.eventBus = data.eventBus;
  }

  create(): void {
    // Create graphics layers (back to front)
    this.threatZoneGraphics = this.add.graphics();
    this.threatZoneGraphics.setDepth(10);

    this.tacticalGraphics = this.add.graphics();
    this.tacticalGraphics.setDepth(20);

    this.rallyPathGraphics = this.add.graphics();
    this.rallyPathGraphics.setDepth(30);

    // Ability splash container
    this.splashContainer = this.add.container(0, 0);
    this.splashContainer.setDepth(100);

    // Alert container (top of screen)
    this.alertContainer = this.add.container(0, 0);
    this.alertContainer.setDepth(200);

    // Vignette for screen effects (covers entire screen)
    this.vignetteGraphics = this.add.graphics();
    this.vignetteGraphics.setDepth(300);

    // Create premium damage vignette render texture
    this.createDamageVignetteTexture();

    this.setupEventListeners();
    this.setupKeyboardShortcuts();
  }

  private setupEventListeners(): void {
    if (!this.eventBus) return;

    // Combat events increase intensity (only for human player)
    this.eventBus.on('combat:attack', (data: {
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
      targetPlayerId?: string;
    }) => {
      // Skip combat feedback in spectator mode
      if (this.isSpectator()) return;

      // Only show intensity/warnings when local player's units are targeted
      if (data.targetPlayerId && !isLocalPlayer(data.targetPlayerId)) return;

      // Increase combat intensity
      this.combatIntensity = Math.min(1, this.combatIntensity + 0.05);

      // Check if attack is off-screen, show edge warning
      if (data.targetPos) {
        this.checkOffScreenAttack(data.targetPos.x, data.targetPos.y);
      }
    });

    // Player takes damage - show vignette (only for local player)
    this.eventBus.on('player:damage', (data: { damage: number; position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
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
    this.eventBus.on('alert:nuclear', (data: { targetPosition?: { x: number; y: number } }) => {
      this.showAlert('NUCLEAR LAUNCH DETECTED', 0xff0000, 5000);
      this.addScreenEffect({
        type: 'nuke_warning',
        intensity: 0.3,
        startTime: Date.now(),
        duration: 2000,
      });
    });

    // Base under attack (only for local player)
    this.eventBus.on('alert:underAttack', (data: { position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert('YOUR BASE IS UNDER ATTACK', 0xff4444, 3000);
      if (data.position) {
        this.checkOffScreenAttack(data.position.x, data.position.y);
      }
    });

    // Unit died (only show vignette for local player's units)
    this.eventBus.on('unit:died', (data: { position?: { x: number; y: number }; isPlayerUnit?: boolean; playerId?: string }) => {
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

    // Player unit takes damage - show vignette (only for local player)
    // NOTE: This is a second listener for the same event - both will fire
    this.eventBus.on('player:damage', (data: { damage: number; position?: { x: number; y: number }; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
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
    this.eventBus.on('production:complete', (data: { unitName: string; buildingName?: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert(`${data.unitName.toUpperCase()} READY`, 0x00ff88, 2000);
    });

    // Research complete (only for local player)
    this.eventBus.on('research:complete', (data: { researchName: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      this.showAlert(`RESEARCH COMPLETE: ${data.researchName.toUpperCase()}`, 0x00ffff, 3000);
    });

    // Building complete - only show for local player's buildings
    this.eventBus.on('building:complete', (data: { buildingName?: string; buildingType?: string; playerId?: string }) => {
      // Skip in spectator mode or if not local player
      if (this.isSpectator()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      const name = data.buildingName || data.buildingType || 'BUILDING';
      this.showAlert(`${name.toUpperCase()} COMPLETE`, 0x88ff00, 2000);
    });

    // Resource warnings (only for human player)
    this.eventBus.on('warning:lowMinerals', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('NOT ENOUGH MINERALS', 0xffaa00, 1500);
    });

    this.eventBus.on('warning:lowVespene', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('NOT ENOUGH VESPENE', 0x00ffaa, 1500);
    });

    this.eventBus.on('warning:supplyBlocked', () => {
      // Skip in spectator mode
      if (this.isSpectator()) return;
      this.showAlert('SUPPLY BLOCKED', 0xff6600, 2000);
    });

    // Major ability used - show splash effect
    this.eventBus.on('ability:major', (data: {
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
    this.eventBus.on('game:playerEliminated', (data: {
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
    this.eventBus.on('game:victory', (data: {
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

    this.eventBus.on('game:draw', (data: { duration: number }) => {
      // Game is over - no spectating option
      this.showGameEndOverlay(null, data.duration, 'draw', false);
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
  }

  /**
   * Create a premium radial vignette texture for damage overlay
   * Uses multiple gradient layers for a rich, cinematic effect
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

    // Handle resize
    this.scale.on('resize', () => {
      this.redrawVignetteTexture();
    });
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
   * @param isVictory - true for victory, false for defeat, null for draw/spectator
   * @param duration - game duration in seconds
   * @param reason - reason for game end
   * @param canSpectate - whether player can continue spectating (game continues with other players)
   * @param winner - optional winner player ID (for spectator display)
   */
  private showGameEndOverlay(isVictory: boolean | null, duration: number, reason: string, canSpectate: boolean = false, winner?: string): void {
    // If overlay is already showing, don't create another one
    // (This can happen if player is eliminated and then game ends shortly after)
    if (this.gameEndOverlay || this.gameEndContainer) {
      return;
    }

    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Play victory or defeat music
    const musicUrl = isVictory === true
      ? '/audio/music/victory/victory.mp3'
      : '/audio/music/defeat/defeat.mp3';
    MusicPlayer.playOneShot(musicUrl);

    // Create dark overlay
    const overlay = this.add.graphics();
    overlay.setDepth(500);
    overlay.fillStyle(0x000000, 0.85);
    overlay.fillRect(0, 0, screenWidth, screenHeight);
    this.gameEndOverlay = overlay;

    // Create container for all elements
    const container = this.add.container(screenWidth / 2, screenHeight / 2);
    container.setDepth(501);
    this.gameEndContainer = container;

    // Determine text and colors based on result
    // isVictory: true = local player won, false = local player lost, null = spectator or draw
    let mainText: string;
    let mainColor: number;

    if (reason === 'draw') {
      // Actual draw - all forces lost
      mainText = 'DRAW';
      mainColor = 0xffff00;
    } else if (isVictory === null) {
      // Spectator watching a non-draw game end
      mainText = 'GAME OVER';
      mainColor = 0xaaaaaa;
    } else if (isVictory) {
      mainText = 'VICTORY';
      mainColor = 0x00ff00;
    } else {
      mainText = 'DEFEAT';
      mainColor = 0xff0000;
    }

    // Create main title with glow effect
    const title = this.add.text(0, -80, mainText, {
      fontSize: '96px',
      fontFamily: 'Orbitron, sans-serif',
      color: '#' + mainColor.toString(16).padStart(6, '0'),
      stroke: '#000000',
      strokeThickness: 6,
    });
    title.setOrigin(0.5, 0.5);
    container.add(title);

    // Subtitle with reason - show appropriate message based on victory/defeat
    let reasonText: string;
    if (isVictory === null && reason !== 'draw') {
      // Spectator watching game end - show who won
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
    } else if (reason === 'draw') {
      reasonText = 'All Forces Lost';
    } else {
      reasonText = 'Game Over';
    }
    const subtitle = this.add.text(0, 0, reasonText, {
      fontSize: '32px',
      fontFamily: 'Inter, sans-serif',
      color: '#ffffff',
    });
    subtitle.setOrigin(0.5, 0.5);
    container.add(subtitle);

    // Game duration
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationText = this.add.text(0, 50, `Game Duration: ${minutes}:${seconds.toString().padStart(2, '0')}`, {
      fontSize: '24px',
      fontFamily: 'Inter, sans-serif',
      color: '#aaaaaa',
    });
    durationText.setOrigin(0.5, 0.5);
    container.add(durationText);

    // Show "Continue Spectating" button only if game continues and player can spectate
    if (canSpectate) {
      // Continue Spectating button
      const spectateButton = this.add.text(0, 110, '[ CONTINUE SPECTATING ]', {
        fontSize: '24px',
        fontFamily: 'Orbitron, sans-serif',
        color: '#00aaff',
        stroke: '#000000',
        strokeThickness: 2,
      });
      spectateButton.setOrigin(0.5, 0.5);
      spectateButton.setInteractive({ useHandCursor: true });

      // Hover effects
      spectateButton.on('pointerover', () => {
        spectateButton.setColor('#00ffff');
        spectateButton.setScale(1.05);
      });
      spectateButton.on('pointerout', () => {
        spectateButton.setColor('#00aaff');
        spectateButton.setScale(1);
      });

      // Click handler - hide overlay and enable spectator mode
      // Use setTimeout to avoid React state update conflicts
      spectateButton.on('pointerdown', () => {
        this.hideGameEndOverlay();
        // Delay state update to avoid React render conflicts
        setTimeout(() => {
          enableSpectatorMode();
        }, 0);
        // Transition back to gameplay music
        MusicPlayer.play('gameplay');
      });

      container.add(spectateButton);

      // Return to menu hint (positioned lower)
      const hintText = this.add.text(0, 160, 'Press ESCAPE to return to menu', {
        fontSize: '20px',
        fontFamily: 'Inter, sans-serif',
        color: '#666666',
      });
      hintText.setOrigin(0.5, 0.5);
      container.add(hintText);
    } else {
      // No spectating option - just show return to menu hint
      const hintText = this.add.text(0, 120, 'Press ESCAPE to return to menu', {
        fontSize: '20px',
        fontFamily: 'Inter, sans-serif',
        color: '#666666',
      });
      hintText.setOrigin(0.5, 0.5);
      container.add(hintText);
    }

    // Animate elements in
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 500,
      ease: 'Power2',
    });

    // Pulse animation on title
    this.tweens.add({
      targets: title,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Listen for escape key to return to menu
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

    // Create styled alert text
    const alertText = this.add.text(screenWidth / 2, 80 + this.alerts.length * 40, text, {
      fontSize: '24px',
      fontFamily: 'Arial Black, Arial',
      color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#000000',
      strokeThickness: 4,
      shadow: {
        offsetX: 2,
        offsetY: 2,
        color: '#000000',
        blur: 8,
        fill: true,
      },
    });
    alertText.setOrigin(0.5, 0.5);
    alertText.setDepth(250);

    const alert: AlertMessage = {
      text,
      color,
      x: screenWidth / 2,
      y: 80 + this.alerts.length * 40,
      createdAt: Date.now(),
      duration,
      graphics: alertText,
    };

    this.alerts.push(alert);
    this.alertContainer.add(alertText);

    // Animate in
    alertText.setScale(0);
    alertText.setAlpha(0);
    this.tweens.add({
      targets: alertText,
      scale: 1,
      alpha: 1,
      duration: 150,
      ease: 'Back.easeOut',
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

    // Draw tactical overlay if enabled
    if (this.tacticalMode) {
      this.drawTacticalOverlay();
    }

    // Update premium damage vignette with smooth animation
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
  }

  /**
   * Update the premium damage vignette with smooth animations
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
          // Handled by premium updateDamageVignette - just keep the effect alive for timing
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

  destroy(): void {
    // Clean up all graphics and containers
    this.tacticalGraphics?.destroy();
    this.threatZoneGraphics?.destroy();
    this.rallyPathGraphics?.destroy();
    this.vignetteGraphics?.destroy();
    this.vignetteTexture?.destroy();
    this.alertContainer?.destroy();
    this.splashContainer?.destroy();

    for (const alert of this.alerts) {
      alert.graphics?.destroy();
    }
    for (const splash of this.abilitySplashes) {
      splash.container?.destroy();
    }

    this.alerts = [];
    this.abilitySplashes = [];
    this.edgeWarnings.clear();
    this.vignetteTexture = null;
  }
}
