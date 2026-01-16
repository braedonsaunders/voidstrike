/**
 * Phaser Damage Number System - World Class 2D Damage Display
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

// Colors - simple yellow for all damage
const COLORS = {
  normal: '#ffff00',      // Yellow
  high: '#ffcc00',        // Slightly darker yellow
  critical: '#ffaa00',    // Orange-yellow
  killingBlow: '#ff6600', // Orange
  healing: '#00ff88',     // Green (for future use)
  shield: '#00aaff',      // Blue (for future use)
} as const;

// Font settings - fixed size, no scaling
const FONT_FAMILY = 'Orbitron, Arial Black, Arial, sans-serif';
const FONT_SIZE = 14; // Smaller, cleaner size

// Height offset above unit for damage numbers (above health bar)
const DAMAGE_NUMBER_HEIGHT_OFFSET = 1.5;

// Animation durations - simplified
const FLOAT_DURATION = 600;
const FADE_DURATION = 200;

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
  yOffset: number; // Current float offset
  currentScale: number;
  isAnimatingPop: boolean;
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
  private textPool: Array<{ text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text }> = [];
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
    for (let i = 0; i < this.poolSize; i++) {
      const shadow = this.scene.add.text(0, 0, '', {
        fontSize: `${FONT_SIZE}px`,
        fontFamily: FONT_FAMILY,
        color: '#000000',
        stroke: '#000000',
        strokeThickness: 0,
      });
      shadow.setOrigin(0.5, 0.5);
      shadow.setVisible(false);
      shadow.setAlpha(0.5);

      const text = this.scene.add.text(0, 0, '', {
        fontSize: `${FONT_SIZE}px`,
        fontFamily: FONT_FAMILY,
        color: COLORS.normal,
        stroke: '#000000',
        strokeThickness: 3,
      });
      text.setOrigin(0.5, 0.5);
      text.setVisible(false);

      this.container.add(shadow);
      this.container.add(text);
      this.textPool.push({ text, shadow });
    }
  }

  /**
   * Acquire a text object from the pool
   */
  private acquireText(): { text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text } | null {
    const item = this.textPool.pop();
    if (item) {
      item.text.setVisible(true);
      item.shadow.setVisible(true);
      return item;
    }
    return null;
  }

  /**
   * Release a text object back to the pool
   */
  private releaseText(item: { text: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Text }): void {
    item.text.setVisible(false);
    item.shadow.setVisible(false);
    item.text.setAlpha(1);
    item.shadow.setAlpha(0.6);
    item.text.setScale(1);
    item.shadow.setScale(1);
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
      yOffset: 0,
      currentScale: 0.5,
      isAnimatingPop: false,
    };

    this.activeNumbers.set(targetId, damageNumber);

    // Update text content and style
    this.updateDamageText(damageNumber);

    // Start entrance animation
    this.startEntranceAnimation(damageNumber);
  }

  /**
   * Update the text content and style of a damage number
   * Simplified: fixed font size, just update the number
   */
  private updateDamageText(damageNumber: ActiveDamageNumber): void {
    const { text, shadow, totalDamage, isKillingBlow } = damageNumber;

    // Format damage text - simple number
    const damageStr = Math.round(totalDamage).toString();

    text.setText(damageStr);
    shadow.setText(damageStr);

    // Simple color based on damage level
    let color: string;
    if (isKillingBlow) {
      color = COLORS.killingBlow;
    } else if (totalDamage >= CRITICAL_THRESHOLD) {
      color = COLORS.critical;
    } else if (totalDamage >= HIGH_DAMAGE_THRESHOLD) {
      color = COLORS.high;
    } else {
      color = COLORS.normal;
    }

    text.setColor(color);

    // Fixed font size - no scaling
    text.setFontSize(FONT_SIZE);
    shadow.setFontSize(FONT_SIZE);
    text.setStroke('#000000', 3);
  }

  /**
   * Start the entrance animation for a new damage number
   * Simplified: just fade in and float up
   */
  private startEntranceAnimation(damageNumber: ActiveDamageNumber): void {
    const { text, shadow, targetId } = damageNumber;

    // Clear any existing tweens
    this.clearTweens(targetId);

    // Start at normal scale, just fade in
    text.setScale(1);
    shadow.setScale(1);
    text.setAlpha(0);
    shadow.setAlpha(0);

    const tweens: Phaser.Tweens.Tween[] = [];

    // Simple fade in
    const fadeInTween = this.scene.tweens.add({
      targets: text,
      alpha: 1,
      duration: 100,
      ease: 'Linear',
    });
    tweens.push(fadeInTween);

    const shadowFadeIn = this.scene.tweens.add({
      targets: shadow,
      alpha: 0.5,
      duration: 100,
      ease: 'Linear',
    });
    tweens.push(shadowFadeIn);

    // Start float animation
    this.startFloatAnimation(damageNumber, tweens);

    this.tweenMap.set(targetId, tweens);
  }

  /**
   * Trigger a subtle pulse when damage is consolidated
   * Simplified: very subtle scale bump
   */
  private triggerPopAnimation(damageNumber: ActiveDamageNumber): void {
    if (damageNumber.isAnimatingPop) return;

    damageNumber.isAnimatingPop = true;
    const { text, shadow } = damageNumber;

    // Very subtle scale bump
    this.scene.tweens.add({
      targets: [text, shadow],
      scale: 1.05,
      duration: 50,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => {
        damageNumber.isAnimatingPop = false;
        damageNumber.currentScale = 1;
      },
    });
  }

  /**
   * Start the floating animation
   * Simplified: gentle float up and fade
   */
  private startFloatAnimation(damageNumber: ActiveDamageNumber, tweens: Phaser.Tweens.Tween[]): void {
    // Gentle float upward
    const floatTween = this.scene.tweens.add({
      targets: damageNumber,
      yOffset: -25,
      duration: FLOAT_DURATION,
      ease: 'Quad.easeOut',
    });
    tweens.push(floatTween);

    // Fade out at end
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
   * Just extends the lifetime of the number
   */
  private resetFloatAnimation(damageNumber: ActiveDamageNumber): void {
    const { targetId } = damageNumber;

    // Clear existing tweens
    this.clearTweens(targetId);

    const tweens: Phaser.Tweens.Tween[] = [];

    // Continue float animation from current position
    const floatTween = this.scene.tweens.add({
      targets: damageNumber,
      yOffset: -25,
      duration: FLOAT_DURATION,
      ease: 'Quad.easeOut',
    });
    tweens.push(floatTween);

    // Ensure alpha is visible
    damageNumber.text.setAlpha(1);
    damageNumber.shadow.setAlpha(0.5);

    // New fade out
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
   */
  private markKillingBlow(targetId: number): void {
    const damageNumber = this.activeNumbers.get(targetId);
    if (damageNumber && !damageNumber.isKillingBlow) {
      damageNumber.isKillingBlow = true;
      this.updateDamageText(damageNumber);

      // Extra pop for killing blow
      this.scene.tweens.add({
        targets: [damageNumber.text, damageNumber.shadow],
        scale: 1.5,
        duration: 100,
        ease: 'Back.easeOut',
        yoyo: true,
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
      this.releaseText({ text: damageNumber.text, shadow: damageNumber.shadow });
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

      // Apply float offset
      const finalY = screenPos.y + damageNumber.yOffset;

      // Update positions
      damageNumber.text.setPosition(screenPos.x, finalY);
      damageNumber.shadow.setPosition(screenPos.x + 2, finalY + 2);
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
    }
    this.textPool = [];

    this.container.destroy();
  }
}
