/**
 * Screen Effects System
 *
 * Features:
 * - Chromatic aberration on heavy damage
 * - Directional damage indicators
 * - Kill streak effects
 * - Screen flash with intensity scaling
 * - Impact punch (brief directional blur)
 * - Explosion distortion rings
 * - Critical hit emphasis
 * - Screen cracks for near-death state
 * - Heat distortion for fire/explosion areas
 *
 * This system manages all screen-space visual feedback that makes
 * combat feel impactful and responsive.
 */

import * as Phaser from 'phaser';
import { EventBus } from '@/engine/core/EventBus';
import { useProjectionStore } from '@/store/projectionStore';
import { getLocalPlayerId, isLocalPlayer, isSpectatorMode, isBattleSimulatorMode } from '@/store/gameSetupStore';
import { clamp } from '@/utils/math';

// ============================================
// CONSTANTS
// ============================================

const KILL_STREAK_THRESHOLDS = [3, 5, 10, 15, 25];
const KILL_STREAK_MESSAGES = ['TRIPLE KILL', 'KILLING SPREE', 'RAMPAGE', 'UNSTOPPABLE', 'GODLIKE'];
const KILL_STREAK_COLORS = [0xffaa00, 0xff6600, 0xff3300, 0xff0000, 0xff00ff];

const DIRECTIONAL_INDICATOR_DURATION = 1500;
const KILL_STREAK_TIMEOUT = 4000; // Time between kills to maintain streak

// ============================================
// INTERFACES
// ============================================

interface DirectionalIndicator {
  angle: number;
  intensity: number;
  startTime: number;
  duration: number;
  graphics: Phaser.GameObjects.Graphics;
}

interface KillStreakState {
  count: number;
  lastKillTime: number;
  displayedLevel: number;
}

interface ScreenCrack {
  startX: number;
  startY: number;
  segments: Array<{ x: number; y: number }>;
  alpha: number;
  createdAt: number;
}

interface ExplosionRing {
  x: number;
  y: number;
  startTime: number;
  duration: number;
  maxRadius: number;
}

// ============================================
// SCREEN EFFECTS SYSTEM
// ============================================

export class ScreenEffectsSystem {
  private scene: Phaser.Scene;
  private eventBus: EventBus;

  // Graphics layers
  private effectsContainer: Phaser.GameObjects.Container;
  private chromaticContainer: Phaser.GameObjects.Container;
  private directionalContainer: Phaser.GameObjects.Container;
  private killStreakContainer: Phaser.GameObjects.Container;
  private crackContainer: Phaser.GameObjects.Container;

  // Graphics objects
  private chromaticGraphics: Phaser.GameObjects.Graphics;
  private flashGraphics: Phaser.GameObjects.Graphics;
  private distortionGraphics: Phaser.GameObjects.Graphics;

  // State tracking
  private chromaticIntensity = 0;
  private chromaticTargetIntensity = 0;
  private flashIntensity = 0;
  private screenShakeIntensity = 0;

  // Directional damage indicators
  private directionalIndicators: DirectionalIndicator[] = [];

  // Kill streak tracking
  private killStreak: KillStreakState = {
    count: 0,
    lastKillTime: 0,
    displayedLevel: -1,
  };
  private killStreakText: Phaser.GameObjects.Text | null = null;

  // Screen cracks (near death)
  private screenCracks: ScreenCrack[] = [];
  private healthRatio = 1.0;

  // Explosion distortion rings
  private explosionRings: ExplosionRing[] = [];

  // Critical hit flash
  private criticalFlashActive = false;

  constructor(scene: Phaser.Scene, eventBus: EventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    // Create containers at different depths
    this.effectsContainer = scene.add.container(0, 0);
    this.effectsContainer.setDepth(280);

    this.chromaticContainer = scene.add.container(0, 0);
    this.chromaticContainer.setDepth(285);

    this.directionalContainer = scene.add.container(0, 0);
    this.directionalContainer.setDepth(290);

    this.killStreakContainer = scene.add.container(0, 0);
    this.killStreakContainer.setDepth(295);

    this.crackContainer = scene.add.container(0, 0);
    this.crackContainer.setDepth(275);

    // Create graphics objects
    this.chromaticGraphics = scene.add.graphics();
    this.chromaticContainer.add(this.chromaticGraphics);

    this.flashGraphics = scene.add.graphics();
    this.effectsContainer.add(this.flashGraphics);

    this.distortionGraphics = scene.add.graphics();
    this.effectsContainer.add(this.distortionGraphics);

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Player damage - directional indicator + chromatic (not in battle simulator)
    this.eventBus.on('player:damage', (data: {
      damage: number;
      position?: { x: number; y: number };
      playerId?: string;
      sourcePosition?: { x: number; y: number };
    }) => {
      if (isSpectatorMode()) return;
      if (isBattleSimulatorMode()) return;
      if (data.playerId && !isLocalPlayer(data.playerId)) return;

      const intensity = Math.min(data.damage / 50, 1);

      // Chromatic aberration
      this.triggerChromaticAberration(intensity);

      // Directional indicator if we know source
      if (data.sourcePosition && data.position) {
        this.createDirectionalIndicator(data.position, data.sourcePosition, intensity);
      }

      // Screen shake
      this.screenShakeIntensity = Math.min(this.screenShakeIntensity + data.damage / 15, 15);
    });

    // Unit killed by local player
    this.eventBus.on('unit:killed', (data: {
      killerPlayerId?: string;
      victimPlayerId?: string;
      position?: { x: number; y: number };
    }) => {
      if (isSpectatorMode()) return;

      const localPlayerId = getLocalPlayerId();
      if (data.killerPlayerId === localPlayerId && data.victimPlayerId !== localPlayerId) {
        this.incrementKillStreak();
      }
    });

    // Explosion effect
    this.eventBus.on('effect:explosion', (data: {
      position: { x: number; y: number };
      intensity: number;
    }) => {
      this.createExplosionRing(data.position, data.intensity);
    });

    // Critical hit
    this.eventBus.on('combat:critical', (data: {
      targetPlayerId?: string;
    }) => {
      if (isSpectatorMode()) return;
      const localPlayerId = getLocalPlayerId();
      if (data.targetPlayerId === localPlayerId) {
        this.triggerCriticalHitEffect();
      }
    });

    // Health update for screen crack effect
    this.eventBus.on('player:healthUpdate', (data: {
      playerId: string;
      current: number;
      max: number;
    }) => {
      if (isSpectatorMode()) return;
      if (!isLocalPlayer(data.playerId)) return;

      this.healthRatio = data.current / data.max;
      this.updateScreenCracks();
    });

    // Screen flash on big events
    this.eventBus.on('screen:flash', (data: {
      color?: number;
      intensity?: number;
      duration?: number;
    }) => {
      this.triggerScreenFlash(
        data.color ?? 0xffffff,
        data.intensity ?? 0.5,
        data.duration ?? 200
      );
    });
  }

  // ============================================
  // CHROMATIC ABERRATION
  // ============================================

  /**
   * Trigger chromatic aberration effect
   */
  private triggerChromaticAberration(intensity: number): void {
    this.chromaticTargetIntensity = Math.max(this.chromaticTargetIntensity, intensity);
  }

  /**
   * Update chromatic aberration rendering
   */
  private updateChromaticAberration(dt: number): void {
    // Smooth interpolation
    const lerpSpeed = this.chromaticIntensity < this.chromaticTargetIntensity ? 15 : 5;
    this.chromaticIntensity += (this.chromaticTargetIntensity - this.chromaticIntensity) * Math.min(dt * lerpSpeed, 1);

    // Decay target
    this.chromaticTargetIntensity *= Math.pow(0.9, dt * 60);

    if (this.chromaticIntensity < 0.01) {
      this.chromaticGraphics.clear();
      return;
    }

    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;

    this.chromaticGraphics.clear();

    // Draw colored edge vignettes to simulate chromatic aberration
    const offset = this.chromaticIntensity * 15;

    // Red channel shift (left)
    this.chromaticGraphics.fillStyle(0xff0000, this.chromaticIntensity * 0.15);
    this.chromaticGraphics.fillRect(0, 0, offset, screenHeight);

    // Cyan channel shift (right)
    this.chromaticGraphics.fillStyle(0x00ffff, this.chromaticIntensity * 0.15);
    this.chromaticGraphics.fillRect(screenWidth - offset, 0, offset, screenHeight);

    // Green shift (top)
    this.chromaticGraphics.fillStyle(0x00ff00, this.chromaticIntensity * 0.08);
    this.chromaticGraphics.fillRect(0, 0, screenWidth, offset * 0.5);

    // Magenta shift (bottom)
    this.chromaticGraphics.fillStyle(0xff00ff, this.chromaticIntensity * 0.08);
    this.chromaticGraphics.fillRect(0, screenHeight - offset * 0.5, screenWidth, offset * 0.5);
  }

  // ============================================
  // DIRECTIONAL DAMAGE INDICATORS
  // ============================================

  /**
   * Create a directional damage indicator
   */
  private createDirectionalIndicator(
    playerPos: { x: number; y: number },
    sourcePos: { x: number; y: number },
    intensity: number
  ): void {
    // Calculate angle from player to damage source
    const dx = sourcePos.x - playerPos.x;
    const dy = sourcePos.y - playerPos.y;
    const angle = Math.atan2(dy, dx);

    // Create graphics for this indicator
    const graphics = this.scene.add.graphics();
    this.directionalContainer.add(graphics);

    this.directionalIndicators.push({
      angle,
      intensity,
      startTime: Date.now(),
      duration: DIRECTIONAL_INDICATOR_DURATION,
      graphics,
    });
  }

  /**
   * Update directional indicators
   */
  private updateDirectionalIndicators(dt: number): void {
    const now = Date.now();
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    for (let i = this.directionalIndicators.length - 1; i >= 0; i--) {
      const indicator = this.directionalIndicators[i];
      const elapsed = now - indicator.startTime;
      const progress = elapsed / indicator.duration;

      if (progress >= 1) {
        indicator.graphics.destroy();
        this.directionalIndicators.splice(i, 1);
        continue;
      }

      indicator.graphics.clear();

      // Fade out
      const alpha = indicator.intensity * (1 - progress) * 0.8;

      // Calculate screen edge position based on angle
      // The indicator points TOWARD the center (showing where damage came from)
      const cos = Math.cos(indicator.angle);
      const sin = Math.sin(indicator.angle);

      // Find intersection with screen edge
      let edgeX: number, edgeY: number;
      const margin = 40;

      // Calculate intersection point
      if (Math.abs(cos) > Math.abs(sin)) {
        // Left or right edge
        edgeX = cos > 0 ? screenWidth - margin : margin;
        edgeY = centerY + (edgeX - centerX) * (sin / cos);
        edgeY = clamp(edgeY, margin, screenHeight - margin);
      } else {
        // Top or bottom edge
        edgeY = sin > 0 ? screenHeight - margin : margin;
        edgeX = centerX + (edgeY - centerY) * (cos / sin);
        edgeX = clamp(edgeX, margin, screenWidth - margin);
      }

      // Draw arrow pointing toward center
      const arrowLength = 30 + indicator.intensity * 20;
      const arrowWidth = 15 + indicator.intensity * 10;

      // Calculate arrow direction (pointing toward center)
      const toCenter = Math.atan2(centerY - edgeY, centerX - edgeX);

      // Draw the damage indicator arrow
      indicator.graphics.fillStyle(0xff0000, alpha);

      const tipX = edgeX;
      const tipY = edgeY;
      const baseX = edgeX - Math.cos(toCenter) * arrowLength;
      const baseY = edgeY - Math.sin(toCenter) * arrowLength;

      const perpX = Math.cos(toCenter + Math.PI / 2) * arrowWidth / 2;
      const perpY = Math.sin(toCenter + Math.PI / 2) * arrowWidth / 2;

      indicator.graphics.beginPath();
      indicator.graphics.moveTo(tipX, tipY);
      indicator.graphics.lineTo(baseX + perpX, baseY + perpY);
      indicator.graphics.lineTo(baseX - perpX, baseY - perpY);
      indicator.graphics.closePath();
      indicator.graphics.fill();

      // Add glow
      indicator.graphics.fillStyle(0xff4444, alpha * 0.5);
      const glowScale = 1.3;
      indicator.graphics.beginPath();
      indicator.graphics.moveTo(tipX, tipY);
      indicator.graphics.lineTo(baseX + perpX * glowScale, baseY + perpY * glowScale);
      indicator.graphics.lineTo(baseX - perpX * glowScale, baseY - perpY * glowScale);
      indicator.graphics.closePath();
      indicator.graphics.fill();
    }
  }

  // ============================================
  // KILL STREAK
  // ============================================

  /**
   * Increment kill streak counter
   */
  private incrementKillStreak(): void {
    const now = Date.now();

    // Check if streak has timed out
    if (now - this.killStreak.lastKillTime > KILL_STREAK_TIMEOUT) {
      this.killStreak.count = 0;
      this.killStreak.displayedLevel = -1;
    }

    this.killStreak.count++;
    this.killStreak.lastKillTime = now;

    // Check for new threshold
    for (let i = KILL_STREAK_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.killStreak.count >= KILL_STREAK_THRESHOLDS[i] && i > this.killStreak.displayedLevel) {
        this.displayKillStreak(i);
        this.killStreak.displayedLevel = i;
        break;
      }
    }
  }

  /**
   * Display kill streak announcement
   */
  private displayKillStreak(level: number): void {
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;

    // Remove existing text
    if (this.killStreakText) {
      this.killStreakText.destroy();
    }

    const message = KILL_STREAK_MESSAGES[level];
    const color = KILL_STREAK_COLORS[level];

    // Create text
    this.killStreakText = this.scene.add.text(screenWidth / 2, screenHeight * 0.35, message, {
      fontSize: '48px',
      fontFamily: 'Orbitron, Arial Black, sans-serif',
      color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#000000',
      strokeThickness: 6,
      shadow: {
        offsetX: 3,
        offsetY: 3,
        color: '#000000',
        blur: 10,
        fill: true,
      },
    });
    this.killStreakText.setOrigin(0.5, 0.5);
    this.killStreakContainer.add(this.killStreakText);

    // Animate in
    this.killStreakText.setScale(0);
    this.killStreakText.setAlpha(0);

    this.scene.tweens.add({
      targets: this.killStreakText,
      scale: 1.2,
      alpha: 1,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.killStreakText,
          scale: 1,
          duration: 100,
          ease: 'Quad.easeOut',
        });
      },
    });

    // Fade out
    this.scene.tweens.add({
      targets: this.killStreakText,
      alpha: 0,
      y: screenHeight * 0.3,
      delay: 1500,
      duration: 500,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (this.killStreakText) {
          this.killStreakText.destroy();
          this.killStreakText = null;
        }
      },
    });

    // Screen flash
    this.triggerScreenFlash(color, 0.3, 150);
  }

  // ============================================
  // SCREEN FLASH
  // ============================================

  /**
   * Trigger a screen flash
   */
  private triggerScreenFlash(color: number, intensity: number, duration: number): void {
    this.flashGraphics.clear();
    this.flashGraphics.fillStyle(color, intensity);
    this.flashGraphics.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);

    this.scene.tweens.add({
      targets: this.flashGraphics,
      alpha: 0,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.flashGraphics.clear();
        this.flashGraphics.setAlpha(1);
      },
    });
  }

  // ============================================
  // CRITICAL HIT
  // ============================================

  /**
   * Trigger critical hit effect
   */
  private triggerCriticalHitEffect(): void {
    if (this.criticalFlashActive) return;
    this.criticalFlashActive = true;

    // Red edge flash
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;

    const critGraphics = this.scene.add.graphics();
    this.effectsContainer.add(critGraphics);

    // Draw red border
    critGraphics.lineStyle(8, 0xff0000, 0.8);
    critGraphics.strokeRect(0, 0, screenWidth, screenHeight);

    // Animate
    this.scene.tweens.add({
      targets: critGraphics,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => {
        critGraphics.destroy();
        this.criticalFlashActive = false;
      },
    });

    // Extra chromatic aberration
    this.triggerChromaticAberration(0.8);
  }

  // ============================================
  // EXPLOSION RINGS
  // ============================================

  /**
   * Create explosion distortion ring
   */
  private createExplosionRing(position: { x: number; y: number }, intensity: number): void {
    const projectToScreen = useProjectionStore.getState().projectToScreen;
    if (!projectToScreen) return;

    const screenPos = projectToScreen(position.x, position.y);

    this.explosionRings.push({
      x: screenPos.x,
      y: screenPos.y,
      startTime: Date.now(),
      duration: 400,
      maxRadius: 100 + intensity * 80,
    });
  }

  /**
   * Update explosion rings
   */
  private updateExplosionRings(dt: number): void {
    const now = Date.now();

    this.distortionGraphics.clear();

    for (let i = this.explosionRings.length - 1; i >= 0; i--) {
      const ring = this.explosionRings[i];
      const elapsed = now - ring.startTime;
      const progress = elapsed / ring.duration;

      if (progress >= 1) {
        this.explosionRings.splice(i, 1);
        continue;
      }

      const radius = ring.maxRadius * progress;
      const alpha = (1 - progress) * 0.4;
      const thickness = 4 + (1 - progress) * 8;

      this.distortionGraphics.lineStyle(thickness, 0xffffff, alpha);
      this.distortionGraphics.strokeCircle(ring.x, ring.y, radius);

      // Inner glow
      this.distortionGraphics.lineStyle(thickness * 0.5, 0xffaa00, alpha * 0.5);
      this.distortionGraphics.strokeCircle(ring.x, ring.y, radius * 0.9);
    }
  }

  // ============================================
  // SCREEN CRACKS
  // ============================================

  /**
   * Update screen cracks based on health
   */
  private updateScreenCracks(): void {
    // Add cracks when health is low
    if (this.healthRatio < 0.3 && this.screenCracks.length < 5) {
      this.addScreenCrack();
    }

    // Clear cracks when health recovers
    if (this.healthRatio > 0.5) {
      this.clearScreenCracks();
    }
  }

  /**
   * Add a screen crack
   */
  private addScreenCrack(): void {
    const screenWidth = this.scene.scale.width;
    const screenHeight = this.scene.scale.height;

    // Start from edge
    const edge = Math.floor(Math.random() * 4);
    let startX: number, startY: number;

    switch (edge) {
      case 0: // Top
        startX = Math.random() * screenWidth;
        startY = 0;
        break;
      case 1: // Right
        startX = screenWidth;
        startY = Math.random() * screenHeight;
        break;
      case 2: // Bottom
        startX = Math.random() * screenWidth;
        startY = screenHeight;
        break;
      default: // Left
        startX = 0;
        startY = Math.random() * screenHeight;
    }

    // Generate crack segments
    const segments: Array<{ x: number; y: number }> = [];
    let x = startX;
    let y = startY;
    const segmentCount = 5 + Math.floor(Math.random() * 5);

    for (let i = 0; i < segmentCount; i++) {
      const angle = Math.atan2(screenHeight / 2 - y, screenWidth / 2 - x) + (Math.random() - 0.5) * 1.5;
      const length = 20 + Math.random() * 40;
      x += Math.cos(angle) * length;
      y += Math.sin(angle) * length;
      segments.push({ x, y });
    }

    this.screenCracks.push({
      startX,
      startY,
      segments,
      alpha: 0,
      createdAt: Date.now(),
    });
  }

  /**
   * Clear all screen cracks
   */
  private clearScreenCracks(): void {
    this.screenCracks = [];
  }

  /**
   * Render screen cracks
   */
  private renderScreenCracks(): void {
    const graphics = this.scene.add.graphics();
    this.crackContainer.add(graphics);

    // Clear old graphics
    this.crackContainer.removeAll(true);

    if (this.screenCracks.length === 0) return;

    const crackGraphics = this.scene.add.graphics();
    this.crackContainer.add(crackGraphics);

    for (const crack of this.screenCracks) {
      // Fade in
      const age = Date.now() - crack.createdAt;
      crack.alpha = Math.min(age / 500, (1 - this.healthRatio) * 2);

      crackGraphics.lineStyle(2, 0x000000, crack.alpha * 0.8);

      crackGraphics.beginPath();
      crackGraphics.moveTo(crack.startX, crack.startY);

      for (const segment of crack.segments) {
        crackGraphics.lineTo(segment.x, segment.y);
      }

      crackGraphics.stroke();

      // White highlight
      crackGraphics.lineStyle(1, 0xffffff, crack.alpha * 0.3);
      crackGraphics.beginPath();
      crackGraphics.moveTo(crack.startX + 1, crack.startY + 1);

      for (const segment of crack.segments) {
        crackGraphics.lineTo(segment.x + 1, segment.y + 1);
      }

      crackGraphics.stroke();
    }
  }

  // ============================================
  // UPDATE
  // ============================================

  /**
   * Update all screen effects
   */
  public update(time: number, delta: number): void {
    const dt = delta / 1000;

    this.updateChromaticAberration(dt);
    this.updateDirectionalIndicators(dt);
    this.updateExplosionRings(dt);
    this.renderScreenCracks();

    // Decay screen shake
    this.screenShakeIntensity *= Math.pow(0.9, dt * 60);
  }

  /**
   * Get current screen shake intensity
   */
  public getScreenShakeIntensity(): number {
    return this.screenShakeIntensity;
  }

  /**
   * Dispose the system
   */
  public dispose(): void {
    for (const indicator of this.directionalIndicators) {
      indicator.graphics.destroy();
    }
    this.directionalIndicators = [];

    if (this.killStreakText) {
      this.killStreakText.destroy();
    }

    this.effectsContainer.destroy();
    this.chromaticContainer.destroy();
    this.directionalContainer.destroy();
    this.killStreakContainer.destroy();
    this.crackContainer.destroy();
  }
}
