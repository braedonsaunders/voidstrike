/**
 * Phaser Damage Number System
 *
 * Features:
 * - Per-entity damage consolidation (one number per unit max)
 * - Hit accumulation with visual intensity scaling
 * - Pop-in animation with physics-based float
 * - Color coding (normal, high damage, critical, killing blow)
 * - Screen-space positioning with 3D projection
 * - Smooth animations using Phaser tweens
 *
 * This replaces the Three.js sprite-based damage numbers with
 * crisp 2D text rendering that stays sharp at any zoom level.
 */

import * as Phaser from 'phaser';
import { EventBus } from '@/engine/core/EventBus';
import { useProjectionStore } from '@/store/projectionStore';
import { AssetManager, DEFAULT_AIRBORNE_HEIGHT } from '@/assets/AssetManager';

// ============================================
// CONSTANTS
// ============================================

// Consolidation window - hits within this time merge into one number
const CONSOLIDATION_WINDOW = 400; // ms

// Damage thresholds for color coding
const HIGH_DAMAGE_THRESHOLD = 30;
const CRITICAL_THRESHOLD = 50;

// Colors - vibrant with good contrast
const COLORS = {
  normal: '#ffe066',      // Warm gold
  high: '#ffb347',        // Rich amber
  critical: '#ff7f50',    // Coral orange
  killingBlow: '#ff4757', // Vivid red
  healing: '#7bed9f',     // Soft green
  shield: '#70a1ff',      // Sky blue
  miss: '#888888',        // Gray for misses
} as const;

// Glow colors (slightly more saturated for bloom effect)
const GLOW_COLORS = {
  normal: '#ffd700',
  high: '#ff9f1a',
  critical: '#ff6348',
  killingBlow: '#ff3838',
  healing: '#2ed573',
  shield: '#1e90ff',
  miss: '#666666',
} as const;

// Font settings - sized for visibility and impact
const FONT_FAMILY = 'Orbitron, Arial Black, Arial, sans-serif';
const FONT_SIZE = 18; // Readable, impactful size
const FONT_SIZE_LARGE = 24; // For high damage

// Height offset above unit for damage numbers (above health bar)
const DAMAGE_NUMBER_HEIGHT_OFFSET = 1.5;

// Animation durations - tuned for satisfying feedback
const FLOAT_DURATION = 800;
const FADE_DURATION = 300;
const ENTRANCE_DURATION = 120;
const POP_SCALE = 1.3; // Initial pop scale for entrance

// ============================================
// INTERFACES
// ============================================

interface ActiveDamageNumber {
  targetId: number;
  totalDamage: number;
  hitCount: number;
  lastHitTime: number;
  createdAt: number;
  worldX: number;
  worldZ: number;
  worldY: number;
  isKillingBlow: boolean;
  text: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Text;
  glow: Phaser.GameObjects.Text; // Soft glow layer behind text
  yOffset: number; // Current float offset
  xOffset: number; // Subtle horizontal drift
  currentScale: number;
  isAnimatingPop: boolean;
  glowColor: string; // Current glow color for this number
}

// ============================================
// DAMAGE NUMBER SYSTEM
// ============================================

export class DamageNumberSystem {
  private scene: Phaser.Scene;
  private eventBus: EventBus;
  private container: Phaser.GameObjects.Container;

  // Active damage numbers per entity
  private activeNumbers: Map<number, ActiveDamageNumber> = new Map();

  // Pool of text objects for reuse
  private textPool: Array<{ text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text; glow: Phaser.GameObjects.Text }> = [];
  private poolSize = 30;

  // Animation tracking
  private tweenMap: Map<number, Phaser.Tweens.Tween[]> = new Map();

  // Terrain height lookup function
  private getTerrainHeight: ((x: number, z: number) => number) | null = null;

  constructor(scene: Phaser.Scene, eventBus: EventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    // Create container at high depth
    this.container = scene.add.container(0, 0);
    this.container.setDepth(150); // Above most overlay elements

    // Pre-create text pool
    this.initializePool();

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Initialize the text object pool
   */
  private initializePool(): void {
    // Use device pixel ratio for crisp text on high-DPI displays
    const resolution = Math.min(window.devicePixelRatio || 1, 2);

    for (let i = 0; i < this.poolSize; i++) {
      // Glow layer - soft bloom effect behind text
      const glow = this.scene.add.text(0, 0, '', {
        fontSize: `${FONT_SIZE}px`,
        fontFamily: FONT_FAMILY,
        color: GLOW_COLORS.normal,
        stroke: GLOW_COLORS.normal,
        strokeThickness: 12,
        resolution,
      });
      glow.setOrigin(0.5, 0.5);
      glow.setVisible(false);
      glow.setAlpha(0.4);

      // Shadow layer - depth and contrast
      const shadow = this.scene.add.text(0, 0, '', {
        fontSize: `${FONT_SIZE}px`,
        fontFamily: FONT_FAMILY,
        color: '#000000',
        stroke: '#000000',
        strokeThickness: 6,
        resolution,
      });
      shadow.setOrigin(0.5, 0.5);
      shadow.setVisible(false);
      shadow.setAlpha(0.7);

      // Main text layer - crisp and readable
      const text = this.scene.add.text(0, 0, '', {
        fontSize: `${FONT_SIZE}px`,
        fontFamily: FONT_FAMILY,
        color: COLORS.normal,
        stroke: '#000000',
        strokeThickness: 4,
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: '#000000',
          blur: 4,
          fill: true,
        },
        resolution,
      });
      text.setOrigin(0.5, 0.5);
      text.setVisible(false);

      // Add in order: glow (back), shadow, text (front)
      this.container.add(glow);
      this.container.add(shadow);
      this.container.add(text);
      this.textPool.push({ text, shadow, glow });
    }
  }

  /**
   * Acquire a text object from the pool
   */
  private acquireText(): { text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text; glow: Phaser.GameObjects.Text } | null {
    const item = this.textPool.pop();
    if (item) {
      item.text.setVisible(true);
      item.shadow.setVisible(true);
      item.glow.setVisible(true);
      return item;
    }
    return null;
  }

  /**
   * Release a text object back to the pool
   */
  private releaseText(item: { text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text; glow: Phaser.GameObjects.Text }): void {
    item.text.setVisible(false);
    item.shadow.setVisible(false);
    item.glow.setVisible(false);
    item.text.setAlpha(1);
    item.shadow.setAlpha(0.7);
    item.glow.setAlpha(0.4);
    item.text.setScale(1);
    item.shadow.setScale(1);
    item.glow.setScale(1);
    this.textPool.push(item);
  }

  /**
   * Set terrain height lookup function for accurate vertical positioning
   */
  public setTerrainHeightFunction(fn: (x: number, z: number) => number): void {
    this.getTerrainHeight = fn;
  }

  /**
   * Setup event listeners for damage events
   */
  private setupEventListeners(): void {
    // Listen for damage events from the combat system
    this.eventBus.on('damage:dealt', (data: {
      targetId: number;
      damage: number;
      targetPos: { x: number; y: number };
      targetHeight?: number;
      isKillingBlow?: boolean;
      isCritical?: boolean;
      targetIsFlying?: boolean;
      targetUnitType?: string; // For airborne height lookup
    }) => {
      this.onDamageDealt(data);
    });

    // Listen for unit deaths to mark killing blows
    this.eventBus.on('unit:died', (data: { entityId?: number }) => {
      if (data.entityId !== undefined) {
        this.markKillingBlow(data.entityId);
      }
    });

    // Listen for combat misses (high-ground miss chance)
    this.eventBus.on('combat:miss', (data: {
      targetPos: { x: number; y: number };
      reason?: string;
    }) => {
      this.onMiss(data);
    });
  }

  /**
   * Handle damage dealt event
   */
  private onDamageDealt(data: {
    targetId: number;
    damage: number;
    targetPos: { x: number; y: number };
    targetHeight?: number;
    isKillingBlow?: boolean;
    isCritical?: boolean;
    targetIsFlying?: boolean;
    targetUnitType?: string;
  }): void {
    const now = Date.now();
    const existing = this.activeNumbers.get(data.targetId);

    // Calculate world Y position (terrain height + model height + flying offset + extra offset)
    // targetPos.y is world Z (horizontal), targetPos.x is world X
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(data.targetPos.x, data.targetPos.y) : 0;
    // For units, get model height from assets.json; for buildings, use targetHeight
    const modelHeight = data.targetUnitType
      ? AssetManager.getModelHeight(data.targetUnitType)
      : (data.targetHeight ?? 2);
    // Get per-unit-type airborne height from assets.json
    const airborneHeight = data.targetUnitType ? AssetManager.getAirborneHeight(data.targetUnitType) : DEFAULT_AIRBORNE_HEIGHT;
    const flyingOffset = data.targetIsFlying ? airborneHeight : 0;
    // Position damage numbers above health bars (model height + extra offset)
    const worldY = terrainHeight + flyingOffset + modelHeight + DAMAGE_NUMBER_HEIGHT_OFFSET;

    if (existing && (now - existing.lastHitTime) < CONSOLIDATION_WINDOW) {
      // Consolidate into existing number
      this.consolidateDamage(existing, data.damage, data.targetPos, worldY, data.isKillingBlow);
    } else {
      // Create new damage number
      this.createDamageNumber(
        data.targetId,
        data.damage,
        data.targetPos,
        worldY,
        data.isKillingBlow ?? false
      );
    }
  }

  /**
   * Handle combat miss event - show "MISS" text
   */
  private onMiss(data: {
    targetPos: { x: number; y: number };
    reason?: string;
  }): void {
    const terrainHeight = this.getTerrainHeight ? this.getTerrainHeight(data.targetPos.x, data.targetPos.y) : 0;
    const worldY = terrainHeight + 2 + DAMAGE_NUMBER_HEIGHT_OFFSET;

    // Create a one-off miss text (not consolidated like damage)
    this.createMissNumber(data.targetPos, worldY);
  }

  /**
   * Create a "MISS" floating text
   */
  private createMissNumber(
    pos: { x: number; y: number },
    worldY: number
  ): void {
    // Create text layers
    const shadow = this.scene.add.text(0, 0, 'MISS', {
      fontFamily: FONT_FAMILY,
      fontSize: `${FONT_SIZE}px`,
      color: '#000000',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5);

    const glow = this.scene.add.text(0, 0, 'MISS', {
      fontFamily: FONT_FAMILY,
      fontSize: `${FONT_SIZE}px`,
      color: GLOW_COLORS.miss,
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4);

    const text = this.scene.add.text(0, 0, 'MISS', {
      fontFamily: FONT_FAMILY,
      fontSize: `${FONT_SIZE}px`,
      color: COLORS.miss,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Add to container
    this.container.add([shadow, glow, text]);

    // Position and animate
    const startScale = POP_SCALE;
    text.setScale(startScale);
    shadow.setScale(startScale);
    glow.setScale(startScale);

    // Entrance animation
    this.scene.tweens.add({
      targets: [text, shadow, glow],
      scaleX: 1,
      scaleY: 1,
      duration: ENTRANCE_DURATION,
      ease: 'Back.easeOut',
    });

    // Float up animation
    const floatOffset = { y: 0 };
    this.scene.tweens.add({
      targets: floatOffset,
      y: -40,
      duration: FLOAT_DURATION,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        const projectToScreen = useProjectionStore.getState().projectToScreen;
        if (!projectToScreen) return;
        const screenPos = projectToScreen(pos.x, pos.y, worldY + floatOffset.y * 0.02);
        if (screenPos) {
          text.setPosition(screenPos.x, screenPos.y);
          shadow.setPosition(screenPos.x + 1, screenPos.y + 1);
          glow.setPosition(screenPos.x, screenPos.y);
        }
      },
    });

    // Fade out and destroy
    this.scene.tweens.add({
      targets: [text, shadow, glow],
      alpha: 0,
      duration: FADE_DURATION,
      delay: FLOAT_DURATION - FADE_DURATION,
      onComplete: () => {
        text.destroy();
        shadow.destroy();
        glow.destroy();
      },
    });
  }

  /**
   * Consolidate damage into an existing number
   */
  private consolidateDamage(
    existing: ActiveDamageNumber,
    damage: number,
    pos: { x: number; y: number },
    worldY: number,
    isKillingBlow?: boolean
  ): void {
    existing.totalDamage += damage;
    existing.hitCount++;
    existing.lastHitTime = Date.now();
    existing.worldX = pos.x;
    existing.worldZ = pos.y;
    existing.worldY = worldY;

    if (isKillingBlow) {
      existing.isKillingBlow = true;
    }

    // Update text
    this.updateDamageText(existing);

    // Trigger pop animation for the new hit
    this.triggerPopAnimation(existing);

    // Reset float animation
    this.resetFloatAnimation(existing);
  }

  /**
   * Create a new damage number
   */
  private createDamageNumber(
    targetId: number,
    damage: number,
    pos: { x: number; y: number },
    worldY: number,
    isKillingBlow: boolean
  ): void {
    // Remove any existing number for this target
    this.removeDamageNumber(targetId);

    // Acquire text from pool
    const textItem = this.acquireText();
    if (!textItem) return;

    const now = Date.now();

    // Slight random horizontal offset for visual variety
    const xDrift = (Math.random() - 0.5) * 8;

    const damageNumber: ActiveDamageNumber = {
      targetId,
      totalDamage: damage,
      hitCount: 1,
      lastHitTime: now,
      createdAt: now,
      worldX: pos.x,
      worldZ: pos.y,
      worldY,
      isKillingBlow,
      text: textItem.text,
      shadow: textItem.shadow,
      glow: textItem.glow,
      yOffset: 0,
      xOffset: xDrift,
      currentScale: 0.5,
      isAnimatingPop: false,
      glowColor: GLOW_COLORS.normal,
    };

    this.activeNumbers.set(targetId, damageNumber);

    // Update text content and style
    this.updateDamageText(damageNumber);

    // Start entrance animation
    this.startEntranceAnimation(damageNumber);
  }

  /**
   * Update the text content and style of a damage number
   * Dynamic sizing for high damage, glow color updates
   */
  private updateDamageText(damageNumber: ActiveDamageNumber): void {
    const { text, shadow, glow, totalDamage, isKillingBlow } = damageNumber;

    // Format damage text - simple number
    const damageStr = Math.round(totalDamage).toString();

    text.setText(damageStr);
    shadow.setText(damageStr);
    glow.setText(damageStr);

    // Determine color and glow based on damage level
    let color: string;
    let glowColor: string;
    let fontSize = FONT_SIZE;

    if (isKillingBlow) {
      color = COLORS.killingBlow;
      glowColor = GLOW_COLORS.killingBlow;
      fontSize = FONT_SIZE_LARGE;
    } else if (totalDamage >= CRITICAL_THRESHOLD) {
      color = COLORS.critical;
      glowColor = GLOW_COLORS.critical;
      fontSize = FONT_SIZE_LARGE;
    } else if (totalDamage >= HIGH_DAMAGE_THRESHOLD) {
      color = COLORS.high;
      glowColor = GLOW_COLORS.high;
      fontSize = FONT_SIZE + 2;
    } else {
      color = COLORS.normal;
      glowColor = GLOW_COLORS.normal;
    }

    // Store glow color for animations
    damageNumber.glowColor = glowColor;

    // Apply colors
    text.setColor(color);
    glow.setColor(glowColor);
    glow.setStroke(glowColor, 12);

    // Apply font sizes
    text.setFontSize(fontSize);
    shadow.setFontSize(fontSize);
    glow.setFontSize(fontSize);
    text.setStroke('#000000', 4);
  }

  /**
   * Start the entrance animation for a new damage number
   * Punchy pop-in with glow bloom effect
   */
  private startEntranceAnimation(damageNumber: ActiveDamageNumber): void {
    const { text, shadow, glow, targetId } = damageNumber;

    // Clear any existing tweens
    this.clearTweens(targetId);

    // Start at larger scale for pop effect
    text.setScale(POP_SCALE);
    shadow.setScale(POP_SCALE);
    glow.setScale(POP_SCALE * 1.2); // Glow starts bigger for bloom
    text.setAlpha(0);
    shadow.setAlpha(0);
    glow.setAlpha(0);

    const tweens: Phaser.Tweens.Tween[] = [];

    // Pop-in with overshoot for satisfying entrance
    const popTween = this.scene.tweens.add({
      targets: [text, shadow],
      scale: 1,
      alpha: { value: 1, ease: 'Quad.easeOut' },
      duration: ENTRANCE_DURATION,
      ease: 'Back.easeOut',
    });
    tweens.push(popTween);

    // Glow bloom: starts big and bright, settles to subtle
    const glowTween = this.scene.tweens.add({
      targets: glow,
      scale: 1,
      alpha: 0.5,
      duration: ENTRANCE_DURATION * 1.5,
      ease: 'Quad.easeOut',
    });
    tweens.push(glowTween);

    // Shadow settles to proper alpha
    this.scene.tweens.add({
      targets: shadow,
      alpha: 0.7,
      duration: ENTRANCE_DURATION,
      ease: 'Linear',
    });

    // Start float animation
    this.startFloatAnimation(damageNumber, tweens);

    this.tweenMap.set(targetId, tweens);
  }

  /**
   * Trigger a satisfying pulse when damage is consolidated
   * Includes glow intensification
   */
  private triggerPopAnimation(damageNumber: ActiveDamageNumber): void {
    if (damageNumber.isAnimatingPop) return;

    damageNumber.isAnimatingPop = true;
    const { text, shadow, glow } = damageNumber;

    // Scale bump with glow flash
    this.scene.tweens.add({
      targets: [text, shadow],
      scale: 1.15,
      duration: 80,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => {
        damageNumber.isAnimatingPop = false;
        damageNumber.currentScale = 1;
      },
    });

    // Glow intensifies briefly
    this.scene.tweens.add({
      targets: glow,
      scale: 1.3,
      alpha: 0.8,
      duration: 80,
      ease: 'Quad.easeOut',
      yoyo: true,
      onYoyo: () => {
        glow.setAlpha(0.4);
      },
    });
  }

  /**
   * Start the floating animation
   * Smooth float with deceleration, glow fades first
   */
  private startFloatAnimation(damageNumber: ActiveDamageNumber, tweens: Phaser.Tweens.Tween[]): void {
    // Smooth float upward with deceleration
    const floatTween = this.scene.tweens.add({
      targets: damageNumber,
      yOffset: -35,
      duration: FLOAT_DURATION,
      ease: 'Cubic.easeOut',
    });
    tweens.push(floatTween);

    // Subtle horizontal drift
    this.scene.tweens.add({
      targets: damageNumber,
      xOffset: damageNumber.xOffset * 2,
      duration: FLOAT_DURATION,
      ease: 'Sine.easeOut',
    });

    // Glow fades out earlier for nice trail effect
    const glowFadeTween = this.scene.tweens.add({
      targets: damageNumber.glow,
      alpha: 0,
      delay: FLOAT_DURATION * 0.4,
      duration: FLOAT_DURATION * 0.4,
      ease: 'Quad.easeIn',
    });
    tweens.push(glowFadeTween);

    // Main text and shadow fade out at end
    const fadeTween = this.scene.tweens.add({
      targets: [damageNumber.text, damageNumber.shadow],
      alpha: 0,
      delay: FLOAT_DURATION - FADE_DURATION,
      duration: FADE_DURATION,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.removeDamageNumber(damageNumber.targetId);
      },
    });
    tweens.push(fadeTween);
  }

  /**
   * Reset float animation when damage is consolidated
   * Refreshes the animation for continued visibility
   */
  private resetFloatAnimation(damageNumber: ActiveDamageNumber): void {
    const { targetId } = damageNumber;

    // Clear existing tweens
    this.clearTweens(targetId);

    const tweens: Phaser.Tweens.Tween[] = [];

    // Continue float animation from current position
    const floatTween = this.scene.tweens.add({
      targets: damageNumber,
      yOffset: -35,
      duration: FLOAT_DURATION,
      ease: 'Cubic.easeOut',
    });
    tweens.push(floatTween);

    // Ensure alpha is visible
    damageNumber.text.setAlpha(1);
    damageNumber.shadow.setAlpha(0.7);
    damageNumber.glow.setAlpha(0.5);

    // Glow fades earlier
    const glowFadeTween = this.scene.tweens.add({
      targets: damageNumber.glow,
      alpha: 0,
      delay: FLOAT_DURATION * 0.4,
      duration: FLOAT_DURATION * 0.4,
      ease: 'Quad.easeIn',
    });
    tweens.push(glowFadeTween);

    // New fade out for text and shadow
    const fadeTween = this.scene.tweens.add({
      targets: [damageNumber.text, damageNumber.shadow],
      alpha: 0,
      delay: FLOAT_DURATION - FADE_DURATION,
      duration: FADE_DURATION,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.removeDamageNumber(damageNumber.targetId);
      },
    });
    tweens.push(fadeTween);

    this.tweenMap.set(targetId, tweens);
  }

  /**
   * Mark a damage number as a killing blow
   * Creates a dramatic emphasis effect
   */
  private markKillingBlow(targetId: number): void {
    const damageNumber = this.activeNumbers.get(targetId);
    if (damageNumber && !damageNumber.isKillingBlow) {
      damageNumber.isKillingBlow = true;
      this.updateDamageText(damageNumber);

      // Dramatic scale pop for killing blow
      this.scene.tweens.add({
        targets: [damageNumber.text, damageNumber.shadow],
        scale: 1.6,
        duration: 120,
        ease: 'Back.easeOut',
        yoyo: true,
      });

      // Intense glow flash for emphasis
      this.scene.tweens.add({
        targets: damageNumber.glow,
        scale: 2,
        alpha: 0.9,
        duration: 120,
        ease: 'Quad.easeOut',
        yoyo: true,
        onYoyo: () => {
          damageNumber.glow.setAlpha(0.5);
        },
      });
    }
  }

  /**
   * Clear all tweens for a target
   */
  private clearTweens(targetId: number): void {
    const tweens = this.tweenMap.get(targetId);
    if (tweens) {
      for (const tween of tweens) {
        tween.stop();
        tween.destroy();
      }
      this.tweenMap.delete(targetId);
    }
  }

  /**
   * Remove a damage number
   */
  private removeDamageNumber(targetId: number): void {
    const damageNumber = this.activeNumbers.get(targetId);
    if (damageNumber) {
      this.clearTweens(targetId);
      this.releaseText({ text: damageNumber.text, shadow: damageNumber.shadow, glow: damageNumber.glow });
      this.activeNumbers.delete(targetId);
    }
  }

  /**
   * Update - called each frame to update screen positions
   */
  public update(): void {
    const projectToScreen = useProjectionStore.getState().projectToScreen;
    if (!projectToScreen) return;

    for (const damageNumber of this.activeNumbers.values()) {
      // Project world position to screen
      const screenPos = projectToScreen(
        damageNumber.worldX,
        damageNumber.worldZ,
        damageNumber.worldY
      );

      // Apply float and drift offsets
      const finalX = screenPos.x + damageNumber.xOffset;
      const finalY = screenPos.y + damageNumber.yOffset;

      // Update positions (glow behind, shadow offset, text on top)
      damageNumber.glow.setPosition(finalX, finalY);
      damageNumber.shadow.setPosition(finalX + 1, finalY + 2);
      damageNumber.text.setPosition(finalX, finalY);
    }
  }

  /**
   * Get active damage number count
   */
  public getActiveCount(): number {
    return this.activeNumbers.size;
  }

  /**
   * Clear all damage numbers
   */
  public clear(): void {
    for (const targetId of this.activeNumbers.keys()) {
      this.removeDamageNumber(targetId);
    }
  }

  /**
   * Dispose the system
   */
  public dispose(): void {
    this.clear();

    // Destroy all pooled texts
    for (const item of this.textPool) {
      item.text.destroy();
      item.shadow.destroy();
      item.glow.destroy();
    }
    this.textPool = [];

    this.container.destroy();
  }
}
