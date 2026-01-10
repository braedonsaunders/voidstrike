import * as Phaser from 'phaser';
import { EventBus } from '@/engine/core/EventBus';
import { DEPTH } from '../constants';
import { useProjectionStore } from '@/store/projectionStore';

interface AttackEffect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  progress: number;
  duration: number;
  graphics: Phaser.GameObjects.Graphics;
  type: 'projectile' | 'laser';
}

interface HitEffect {
  x: number;
  y: number;
  progress: number;
  duration: number;
  graphics: Phaser.GameObjects.Graphics;
}

interface DamageNumber {
  x: number;
  y: number;
  damage: number;
  progress: number;
  duration: number;
  text: Phaser.GameObjects.Text;
  velocityY: number;
}

interface FocusFireIndicator {
  targetId: number;
  attackerCount: number;
  x: number;
  y: number;
  graphics: Phaser.GameObjects.Graphics;
  pulseTime: number;
}

export class EffectsRenderer {
  private scene: Phaser.Scene;
  private eventBus: EventBus;

  private attackEffects: AttackEffect[] = [];
  private hitEffects: HitEffect[] = [];
  private damageNumbers: DamageNumber[] = [];
  private focusFireIndicators: Map<number, FocusFireIndicator> = new Map();
  private targetAttackerCounts: Map<number, Set<number>> = new Map();

  private container: Phaser.GameObjects.Container;

  private readonly MAX_DAMAGE_NUMBERS = 15;

  constructor(scene: Phaser.Scene, eventBus: EventBus) {
    this.scene = scene;
    this.eventBus = eventBus;

    this.container = scene.add.container(0, 0);
    this.container.setDepth(DEPTH.EFFECTS);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.eventBus.on('combat:attack', (data: {
      attackerId?: number;
      targetId?: number;
      attackerPos?: { x: number; y: number };
      targetPos?: { x: number; y: number };
      damage: number;
      damageType: string;
    }) => {
      if (data.attackerPos && data.targetPos) {
        // Project world coordinates to screen space (accounts for terrain height and camera)
        const projectionStore = useProjectionStore.getState();
        const attackerScreen = projectionStore.projectToScreen(data.attackerPos.x, data.attackerPos.y);
        const targetScreen = projectionStore.projectToScreen(data.targetPos.x, data.targetPos.y);

        this.createAttackEffect(
          attackerScreen.x, attackerScreen.y,
          targetScreen.x, targetScreen.y,
          data.damageType
        );

        this.createDamageNumber(targetScreen.x, targetScreen.y, data.damage);

        if (data.attackerId !== undefined && data.targetId !== undefined) {
          this.trackFocusFire(data.attackerId, data.targetId, {
            x: targetScreen.x,
            y: targetScreen.y
          });
        }
      }
    });

    this.eventBus.on('unit:died', (data: {
      entityId?: number;
      position?: { x: number; y: number };
    }) => {
      if (data.position) {
        // Project world coordinates to screen space
        const projectionStore = useProjectionStore.getState();
        const screenPos = projectionStore.projectToScreen(data.position.x, data.position.y);
        this.createDeathEffect(screenPos.x, screenPos.y);
      }
      if (data.entityId !== undefined) {
        this.clearFocusFire(data.entityId);
      }
    });

    this.eventBus.on('unit:stopAttack', (data: { attackerId?: number; targetId?: number }) => {
      if (data.attackerId !== undefined && data.targetId !== undefined) {
        this.removeAttackerFromTarget(data.attackerId, data.targetId);
      }
    });
  }

  private createAttackEffect(
    startX: number, startY: number,
    endX: number, endY: number,
    damageType: string
  ): void {
    const graphics = this.scene.add.graphics();
    this.container.add(graphics);

    const effect: AttackEffect = {
      startX, startY, endX, endY,
      progress: 0,
      duration: damageType === 'psionic' ? 100 : 200,
      graphics,
      type: damageType === 'psionic' ? 'laser' : 'projectile',
    };

    this.attackEffects.push(effect);
  }

  private createDamageNumber(x: number, y: number, damage: number): void {
    // Limit max damage numbers
    if (this.damageNumbers.length >= this.MAX_DAMAGE_NUMBERS) {
      const oldest = this.damageNumbers.shift();
      if (oldest) {
        oldest.text.destroy();
      }
    }

    // Spawn damage number well ABOVE the target (y - 25 in screen coords)
    const startY = y - 25;
    const text = this.scene.add.text(x, startY, Math.round(damage).toString(), {
      fontSize: '14px',
      fontFamily: 'Arial',
      color: '#ffff00',
      stroke: '#000000',
      strokeThickness: 2,
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(250);

    this.damageNumbers.push({
      x, y: startY,
      damage,
      progress: 0,
      duration: 700,
      text,
      velocityY: -40, // Float upward faster
    });
  }

  private createDeathEffect(x: number, y: number): void {
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    this.container.add(graphics);

    this.hitEffects.push({
      x, y,
      progress: 0,
      duration: 500,
      graphics,
    });
  }

  private createHitEffect(x: number, y: number): void {
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    this.container.add(graphics);

    this.hitEffects.push({
      x, y,
      progress: 0,
      duration: 300,
      graphics,
    });
  }

  private trackFocusFire(
    attackerId: number,
    targetId: number,
    targetPos: { x: number; y: number }
  ): void {
    let attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) {
      attackers = new Set();
      this.targetAttackerCounts.set(targetId, attackers);
    }

    attackers.add(attackerId);

    if (attackers.size >= 2) {
      let indicator = this.focusFireIndicators.get(targetId);

      if (!indicator) {
        const graphics = this.scene.add.graphics();
        this.container.add(graphics);

        indicator = {
          targetId,
          attackerCount: attackers.size,
          x: targetPos.x,
          y: targetPos.y,
          graphics,
          pulseTime: 0,
        };
        this.focusFireIndicators.set(targetId, indicator);
      } else {
        indicator.x = targetPos.x;
        indicator.y = targetPos.y;
        indicator.attackerCount = attackers.size;
      }
    }
  }

  private clearFocusFire(targetId: number): void {
    const indicator = this.focusFireIndicators.get(targetId);
    if (indicator) {
      indicator.graphics.destroy();
      this.focusFireIndicators.delete(targetId);
    }
    this.targetAttackerCounts.delete(targetId);
  }

  private removeAttackerFromTarget(attackerId: number, targetId: number): void {
    const attackers = this.targetAttackerCounts.get(targetId);
    if (!attackers) return;

    attackers.delete(attackerId);

    if (attackers.size < 2) {
      const indicator = this.focusFireIndicators.get(targetId);
      if (indicator) {
        indicator.graphics.destroy();
        this.focusFireIndicators.delete(targetId);
      }
    }

    if (attackers.size === 0) {
      this.targetAttackerCounts.delete(targetId);
    }
  }

  update(delta: number): void {
    const dt = delta / 1000;

    // Update attack effects
    for (let i = this.attackEffects.length - 1; i >= 0; i--) {
      const effect = this.attackEffects[i];
      effect.progress += (delta / effect.duration);

      if (effect.progress >= 1) {
        effect.graphics.destroy();
        this.attackEffects.splice(i, 1);

        if (effect.type === 'projectile') {
          this.createHitEffect(effect.endX, effect.endY);
        }
      } else {
        effect.graphics.clear();

        if (effect.type === 'projectile') {
          // Draw projectile
          const x = Phaser.Math.Linear(effect.startX, effect.endX, effect.progress);
          const y = Phaser.Math.Linear(effect.startY, effect.endY, effect.progress);
          effect.graphics.fillStyle(0xffaa00, 0.9);
          effect.graphics.fillCircle(x, y, 2);
        } else {
          // Draw laser line
          effect.graphics.lineStyle(2, 0xff0000, 1 - effect.progress);
          effect.graphics.lineBetween(
            effect.startX, effect.startY,
            effect.endX, effect.endY
          );
        }
      }
    }

    // Update hit effects
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const effect = this.hitEffects[i];
      effect.progress += (delta / effect.duration);

      if (effect.progress >= 1) {
        effect.graphics.destroy();
        this.hitEffects.splice(i, 1);
      } else {
        effect.graphics.clear();
        const scale = 1 + effect.progress * 2;
        const alpha = 1 - effect.progress;

        effect.graphics.lineStyle(2, 0xff4400, alpha);
        effect.graphics.strokeCircle(effect.x, effect.y, 5 * scale);
      }
    }

    // Update damage numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dmg = this.damageNumbers[i];
      dmg.progress += (delta / dmg.duration);

      if (dmg.progress >= 1) {
        dmg.text.destroy();
        this.damageNumbers.splice(i, 1);
      } else {
        // Float upward
        dmg.y += dmg.velocityY * dt * (1 - dmg.progress * 0.8);
        dmg.text.setPosition(dmg.x, dmg.y);

        // Fade out in second half
        if (dmg.progress > 0.5) {
          dmg.text.setAlpha(1 - (dmg.progress - 0.5) * 2);
        }

        // Scale up slightly
        const scale = 1 + dmg.progress * 0.3;
        dmg.text.setScale(scale);
      }
    }

    // Update focus fire indicators
    for (const indicator of this.focusFireIndicators.values()) {
      indicator.pulseTime += dt * 4;
      const pulse = 0.8 + Math.sin(indicator.pulseTime) * 0.2;

      indicator.graphics.clear();
      const opacity = Math.min(0.4 + indicator.attackerCount * 0.15, 0.9) * pulse;
      indicator.graphics.lineStyle(3, 0xff0000, opacity);
      indicator.graphics.strokeCircle(indicator.x, indicator.y, 15 * pulse);
    }
  }

  destroy(): void {
    for (const effect of this.attackEffects) {
      effect.graphics.destroy();
    }
    for (const effect of this.hitEffects) {
      effect.graphics.destroy();
    }
    for (const dmg of this.damageNumbers) {
      dmg.text.destroy();
    }
    for (const indicator of this.focusFireIndicators.values()) {
      indicator.graphics.destroy();
    }

    this.attackEffects = [];
    this.hitEffects = [];
    this.damageNumbers = [];
    this.focusFireIndicators.clear();
    this.targetAttackerCounts.clear();
    this.container.destroy();
  }
}
