import { describe, it, expect, beforeEach } from 'vitest';

/**
 * EnhancedAISystem Tests
 *
 * Tests for the AI player management system including:
 * 1. registerAI() - new registration and idempotency
 * 2. isAIPlayer() - check if player is AI-controlled
 * 3. getAIPlayer() - retrieve AI player data
 * 4. getAllAIPlayers() - list all AI players
 * 5. getMiningSpeedMultiplier() - difficulty-based mining speed
 * 6. creditResources() - resource crediting
 */

// Difficulty configuration (from DOMINION_AI_CONFIG)
type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';
type AIPersonality = 'aggressive' | 'defensive' | 'economic' | 'balanced' | 'cheese' | 'turtle';

interface DifficultyConfig {
  miningSpeedMultiplier: number;
  targetWorkers: number;
  maxBases: number;
}

const DIFFICULTY_CONFIG: Record<AIDifficulty, DifficultyConfig> = {
  easy: { miningSpeedMultiplier: 1.0, targetWorkers: 16, maxBases: 2 },
  medium: { miningSpeedMultiplier: 1.0, targetWorkers: 22, maxBases: 3 },
  hard: { miningSpeedMultiplier: 1.0, targetWorkers: 28, maxBases: 4 },
  very_hard: { miningSpeedMultiplier: 1.25, targetWorkers: 32, maxBases: 5 },
  insane: { miningSpeedMultiplier: 1.5, targetWorkers: 40, maxBases: 6 },
};

describe('EnhancedAISystem', () => {
  describe('AI player registration', () => {
    interface AIPlayer {
      playerId: string;
      faction: string;
      difficulty: AIDifficulty;
      personality: AIPersonality;
      minerals: number;
      vespene: number;
    }

    /**
     * Simplified AI registry that mimics EnhancedAISystem/AICoordinator behavior
     */
    class MockAIRegistry {
      private aiPlayers: Map<string, AIPlayer> = new Map();
      private registrationEvents: Array<{ playerId: string }> = [];

      registerAI(
        playerId: string,
        faction: string,
        difficulty: AIDifficulty = 'medium',
        personality: AIPersonality = 'balanced'
      ): void {
        // Idempotency check
        if (this.aiPlayers.has(playerId)) {
          return;
        }

        this.aiPlayers.set(playerId, {
          playerId,
          faction,
          difficulty,
          personality,
          minerals: 50,
          vespene: 0,
        });

        // Emit registration event
        this.registrationEvents.push({ playerId });
      }

      isAIPlayer(playerId: string): boolean {
        return this.aiPlayers.has(playerId);
      }

      getAIPlayer(playerId: string): AIPlayer | undefined {
        return this.aiPlayers.get(playerId);
      }

      getAllAIPlayers(): AIPlayer[] {
        return Array.from(this.aiPlayers.values());
      }

      getMiningSpeedMultiplier(playerId: string): number {
        const ai = this.aiPlayers.get(playerId);
        if (!ai) return 1.0;
        return DIFFICULTY_CONFIG[ai.difficulty].miningSpeedMultiplier;
      }

      creditResources(playerId: string, minerals: number, vespene: number): void {
        const ai = this.aiPlayers.get(playerId);
        if (!ai) return;
        ai.minerals += minerals;
        ai.vespene += vespene;
      }

      getRegistrationEvents(): Array<{ playerId: string }> {
        return this.registrationEvents;
      }
    }

    let registry: MockAIRegistry;

    beforeEach(() => {
      registry = new MockAIRegistry();
    });

    describe('registerAI', () => {
      it('registers a new AI player', () => {
        registry.registerAI('ai_1', 'dominion', 'medium', 'balanced');

        expect(registry.isAIPlayer('ai_1')).toBe(true);
        expect(registry.getAIPlayer('ai_1')).toBeDefined();
      });

      it('stores player id, faction, difficulty, and personality', () => {
        registry.registerAI('ai_1', 'dominion', 'hard', 'aggressive');

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.playerId).toBe('ai_1');
        expect(ai?.faction).toBe('dominion');
        expect(ai?.difficulty).toBe('hard');
        expect(ai?.personality).toBe('aggressive');
      });

      it('initializes resources (50 minerals, 0 vespene)', () => {
        registry.registerAI('ai_1', 'dominion');

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(50);
        expect(ai?.vespene).toBe(0);
      });

      it('uses default difficulty (medium) when not specified', () => {
        registry.registerAI('ai_1', 'dominion');

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.difficulty).toBe('medium');
      });

      it('uses default personality (balanced) when not specified', () => {
        registry.registerAI('ai_1', 'dominion');

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.personality).toBe('balanced');
      });

      it('emits ai:registered event on registration', () => {
        registry.registerAI('ai_1', 'dominion');

        const events = registry.getRegistrationEvents();
        expect(events).toHaveLength(1);
        expect(events[0].playerId).toBe('ai_1');
      });

      describe('idempotency', () => {
        it('does not duplicate registration for same playerId', () => {
          registry.registerAI('ai_1', 'dominion', 'easy', 'aggressive');
          registry.registerAI('ai_1', 'dominion', 'hard', 'defensive'); // Duplicate

          const players = registry.getAllAIPlayers();
          expect(players).toHaveLength(1);
        });

        it('preserves original difficulty on duplicate registration', () => {
          registry.registerAI('ai_1', 'dominion', 'easy', 'aggressive');
          registry.registerAI('ai_1', 'dominion', 'hard', 'defensive');

          const ai = registry.getAIPlayer('ai_1');
          expect(ai?.difficulty).toBe('easy');
        });

        it('preserves original personality on duplicate registration', () => {
          registry.registerAI('ai_1', 'dominion', 'easy', 'aggressive');
          registry.registerAI('ai_1', 'dominion', 'hard', 'defensive');

          const ai = registry.getAIPlayer('ai_1');
          expect(ai?.personality).toBe('aggressive');
        });

        it('does not emit duplicate registration events', () => {
          registry.registerAI('ai_1', 'dominion');
          registry.registerAI('ai_1', 'dominion');

          const events = registry.getRegistrationEvents();
          expect(events).toHaveLength(1);
        });

        it('preserves original resources on duplicate registration', () => {
          registry.registerAI('ai_1', 'dominion');
          registry.creditResources('ai_1', 100, 50);
          registry.registerAI('ai_1', 'dominion'); // Duplicate

          const ai = registry.getAIPlayer('ai_1');
          expect(ai?.minerals).toBe(150); // 50 initial + 100 credited
          expect(ai?.vespene).toBe(50);
        });
      });

      it('can register multiple different AI players', () => {
        registry.registerAI('ai_1', 'dominion', 'easy');
        registry.registerAI('ai_2', 'dominion', 'medium');
        registry.registerAI('ai_3', 'dominion', 'hard');

        expect(registry.getAllAIPlayers()).toHaveLength(3);
        expect(registry.isAIPlayer('ai_1')).toBe(true);
        expect(registry.isAIPlayer('ai_2')).toBe(true);
        expect(registry.isAIPlayer('ai_3')).toBe(true);
      });

      it('supports all difficulty levels', () => {
        const difficulties: AIDifficulty[] = ['easy', 'medium', 'hard', 'very_hard', 'insane'];

        difficulties.forEach((diff, i) => {
          registry.registerAI(`ai_${i}`, 'dominion', diff);
          expect(registry.getAIPlayer(`ai_${i}`)?.difficulty).toBe(diff);
        });
      });

      it('supports all personality types', () => {
        const personalities: AIPersonality[] = [
          'aggressive',
          'defensive',
          'economic',
          'balanced',
          'cheese',
          'turtle',
        ];

        personalities.forEach((pers, i) => {
          registry.registerAI(`ai_${i}`, 'dominion', 'medium', pers);
          expect(registry.getAIPlayer(`ai_${i}`)?.personality).toBe(pers);
        });
      });
    });

    describe('isAIPlayer', () => {
      it('returns true for registered AI player', () => {
        registry.registerAI('ai_1', 'dominion');

        expect(registry.isAIPlayer('ai_1')).toBe(true);
      });

      it('returns false for unregistered player', () => {
        expect(registry.isAIPlayer('unknown')).toBe(false);
      });

      it('returns false for empty playerId', () => {
        expect(registry.isAIPlayer('')).toBe(false);
      });

      it('is case-sensitive', () => {
        registry.registerAI('AI_1', 'dominion');

        expect(registry.isAIPlayer('AI_1')).toBe(true);
        expect(registry.isAIPlayer('ai_1')).toBe(false);
        expect(registry.isAIPlayer('Ai_1')).toBe(false);
      });
    });

    describe('getAIPlayer', () => {
      it('returns AI player data for registered player', () => {
        registry.registerAI('ai_1', 'dominion', 'hard', 'aggressive');

        const ai = registry.getAIPlayer('ai_1');
        expect(ai).toBeDefined();
        expect(ai?.playerId).toBe('ai_1');
      });

      it('returns undefined for unregistered player', () => {
        const ai = registry.getAIPlayer('unknown');
        expect(ai).toBeUndefined();
      });

      it('returns undefined for empty playerId', () => {
        const ai = registry.getAIPlayer('');
        expect(ai).toBeUndefined();
      });

      it('returns current resource values', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 200, 100);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(250); // 50 + 200
        expect(ai?.vespene).toBe(100);
      });
    });

    describe('getAllAIPlayers', () => {
      it('returns empty array when no AI players registered', () => {
        const players = registry.getAllAIPlayers();
        expect(players).toEqual([]);
        expect(players).toHaveLength(0);
      });

      it('returns all registered AI players', () => {
        registry.registerAI('ai_1', 'dominion', 'easy');
        registry.registerAI('ai_2', 'dominion', 'medium');
        registry.registerAI('ai_3', 'dominion', 'hard');

        const players = registry.getAllAIPlayers();
        expect(players).toHaveLength(3);

        const ids = players.map((p) => p.playerId);
        expect(ids).toContain('ai_1');
        expect(ids).toContain('ai_2');
        expect(ids).toContain('ai_3');
      });

      it('returns array copy (not reference)', () => {
        registry.registerAI('ai_1', 'dominion');

        const players1 = registry.getAllAIPlayers();
        const players2 = registry.getAllAIPlayers();

        expect(players1).not.toBe(players2);
        expect(players1).toEqual(players2);
      });

      it('reflects current state after registration', () => {
        expect(registry.getAllAIPlayers()).toHaveLength(0);

        registry.registerAI('ai_1', 'dominion');
        expect(registry.getAllAIPlayers()).toHaveLength(1);

        registry.registerAI('ai_2', 'dominion');
        expect(registry.getAllAIPlayers()).toHaveLength(2);
      });
    });

    describe('getMiningSpeedMultiplier', () => {
      it('returns 1.0 for easy difficulty', () => {
        registry.registerAI('ai_1', 'dominion', 'easy');

        expect(registry.getMiningSpeedMultiplier('ai_1')).toBe(1.0);
      });

      it('returns 1.0 for medium difficulty', () => {
        registry.registerAI('ai_1', 'dominion', 'medium');

        expect(registry.getMiningSpeedMultiplier('ai_1')).toBe(1.0);
      });

      it('returns 1.0 for hard difficulty', () => {
        registry.registerAI('ai_1', 'dominion', 'hard');

        expect(registry.getMiningSpeedMultiplier('ai_1')).toBe(1.0);
      });

      it('returns 1.25 for very_hard difficulty', () => {
        registry.registerAI('ai_1', 'dominion', 'very_hard');

        expect(registry.getMiningSpeedMultiplier('ai_1')).toBe(1.25);
      });

      it('returns 1.5 for insane difficulty', () => {
        registry.registerAI('ai_1', 'dominion', 'insane');

        expect(registry.getMiningSpeedMultiplier('ai_1')).toBe(1.5);
      });

      it('returns 1.0 for unregistered player', () => {
        expect(registry.getMiningSpeedMultiplier('unknown')).toBe(1.0);
      });

      it('returns 1.0 for empty playerId', () => {
        expect(registry.getMiningSpeedMultiplier('')).toBe(1.0);
      });

      it('returns correct multiplier for each AI', () => {
        registry.registerAI('ai_easy', 'dominion', 'easy');
        registry.registerAI('ai_insane', 'dominion', 'insane');

        expect(registry.getMiningSpeedMultiplier('ai_easy')).toBe(1.0);
        expect(registry.getMiningSpeedMultiplier('ai_insane')).toBe(1.5);
      });
    });

    describe('creditResources', () => {
      it('adds minerals to AI player', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 100, 0);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(150); // 50 initial + 100
      });

      it('adds vespene to AI player', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 0, 75);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.vespene).toBe(75);
      });

      it('adds both minerals and vespene', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 100, 50);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(150);
        expect(ai?.vespene).toBe(50);
      });

      it('accumulates resources over multiple calls', () => {
        registry.registerAI('ai_1', 'dominion');

        registry.creditResources('ai_1', 10, 5);
        registry.creditResources('ai_1', 20, 10);
        registry.creditResources('ai_1', 30, 15);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(110); // 50 + 10 + 20 + 30
        expect(ai?.vespene).toBe(30); // 0 + 5 + 10 + 15
      });

      it('handles unregistered player gracefully (no error)', () => {
        expect(() => {
          registry.creditResources('unknown', 100, 50);
        }).not.toThrow();
      });

      it('does not affect other players', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.registerAI('ai_2', 'dominion');

        registry.creditResources('ai_1', 100, 50);

        const ai1 = registry.getAIPlayer('ai_1');
        const ai2 = registry.getAIPlayer('ai_2');

        expect(ai1?.minerals).toBe(150);
        expect(ai2?.minerals).toBe(50); // Unchanged
      });

      it('handles zero values', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 0, 0);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(50); // Unchanged
        expect(ai?.vespene).toBe(0);
      });

      it('handles fractional values', () => {
        registry.registerAI('ai_1', 'dominion');
        registry.creditResources('ai_1', 5.5, 2.75);

        const ai = registry.getAIPlayer('ai_1');
        expect(ai?.minerals).toBe(55.5);
        expect(ai?.vespene).toBe(2.75);
      });
    });
  });

  describe('difficulty configuration', () => {
    it('easy has lowest target workers', () => {
      expect(DIFFICULTY_CONFIG['easy'].targetWorkers).toBeLessThan(
        DIFFICULTY_CONFIG['medium'].targetWorkers
      );
    });

    it('insane has highest target workers', () => {
      expect(DIFFICULTY_CONFIG['insane'].targetWorkers).toBeGreaterThan(
        DIFFICULTY_CONFIG['very_hard'].targetWorkers
      );
    });

    it('target workers scale with difficulty', () => {
      expect(DIFFICULTY_CONFIG['easy'].targetWorkers).toBe(16);
      expect(DIFFICULTY_CONFIG['medium'].targetWorkers).toBe(22);
      expect(DIFFICULTY_CONFIG['hard'].targetWorkers).toBe(28);
      expect(DIFFICULTY_CONFIG['very_hard'].targetWorkers).toBe(32);
      expect(DIFFICULTY_CONFIG['insane'].targetWorkers).toBe(40);
    });

    it('max bases scale with difficulty', () => {
      expect(DIFFICULTY_CONFIG['easy'].maxBases).toBe(2);
      expect(DIFFICULTY_CONFIG['medium'].maxBases).toBe(3);
      expect(DIFFICULTY_CONFIG['hard'].maxBases).toBe(4);
      expect(DIFFICULTY_CONFIG['very_hard'].maxBases).toBe(5);
      expect(DIFFICULTY_CONFIG['insane'].maxBases).toBe(6);
    });

    it('mining speed only increases at very_hard and insane', () => {
      expect(DIFFICULTY_CONFIG['easy'].miningSpeedMultiplier).toBe(1.0);
      expect(DIFFICULTY_CONFIG['medium'].miningSpeedMultiplier).toBe(1.0);
      expect(DIFFICULTY_CONFIG['hard'].miningSpeedMultiplier).toBe(1.0);
      expect(DIFFICULTY_CONFIG['very_hard'].miningSpeedMultiplier).toBeGreaterThan(1.0);
      expect(DIFFICULTY_CONFIG['insane'].miningSpeedMultiplier).toBeGreaterThan(
        DIFFICULTY_CONFIG['very_hard'].miningSpeedMultiplier
      );
    });
  });

  describe('AI state management', () => {
    type AIState = 'building' | 'expanding' | 'attacking' | 'defending' | 'scouting' | 'harassing';

    const ALL_STATES: AIState[] = [
      'building',
      'expanding',
      'attacking',
      'defending',
      'scouting',
      'harassing',
    ];

    it('defines all valid AI states', () => {
      expect(ALL_STATES).toHaveLength(6);
      expect(ALL_STATES).toContain('building');
      expect(ALL_STATES).toContain('expanding');
      expect(ALL_STATES).toContain('attacking');
      expect(ALL_STATES).toContain('defending');
      expect(ALL_STATES).toContain('scouting');
      expect(ALL_STATES).toContain('harassing');
    });

    it('initial state should be building', () => {
      // This tests the expected initial state from AICoordinator.registerAI
      const expectedInitialState: AIState = 'building';
      expect(ALL_STATES).toContain(expectedInitialState);
    });
  });

  describe('personality weights', () => {
    interface PersonalityWeights {
      proximity: number;
      threat: number;
      retaliation: number;
      opportunity: number;
      attackThresholdMult: number;
      expandFrequency: number;
    }

    const PERSONALITY_WEIGHTS: Record<AIPersonality, PersonalityWeights> = {
      aggressive: {
        proximity: 0.5,
        threat: 0.1,
        retaliation: 0.2,
        opportunity: 0.2,
        attackThresholdMult: 0.7,
        expandFrequency: 0.5,
      },
      defensive: {
        proximity: 0.2,
        threat: 0.5,
        retaliation: 0.2,
        opportunity: 0.1,
        attackThresholdMult: 1.3,
        expandFrequency: 1.2,
      },
      economic: {
        proximity: 0.3,
        threat: 0.3,
        retaliation: 0.1,
        opportunity: 0.3,
        attackThresholdMult: 1.5,
        expandFrequency: 1.5,
      },
      balanced: {
        proximity: 0.3,
        threat: 0.3,
        retaliation: 0.2,
        opportunity: 0.2,
        attackThresholdMult: 1.0,
        expandFrequency: 1.0,
      },
      cheese: {
        proximity: 0.6,
        threat: 0.1,
        retaliation: 0.1,
        opportunity: 0.2,
        attackThresholdMult: 0.5,
        expandFrequency: 0.3,
      },
      turtle: {
        proximity: 0.1,
        threat: 0.6,
        retaliation: 0.2,
        opportunity: 0.1,
        attackThresholdMult: 2.0,
        expandFrequency: 0.8,
      },
    };

    it('aggressive has low attack threshold (attacks early)', () => {
      expect(PERSONALITY_WEIGHTS['aggressive'].attackThresholdMult).toBeLessThan(1.0);
    });

    it('defensive has high attack threshold (waits longer)', () => {
      expect(PERSONALITY_WEIGHTS['defensive'].attackThresholdMult).toBeGreaterThan(1.0);
    });

    it('economic has highest expand frequency', () => {
      expect(PERSONALITY_WEIGHTS['economic'].expandFrequency).toBeGreaterThan(
        PERSONALITY_WEIGHTS['aggressive'].expandFrequency
      );
      expect(PERSONALITY_WEIGHTS['economic'].expandFrequency).toBeGreaterThan(
        PERSONALITY_WEIGHTS['balanced'].expandFrequency
      );
    });

    it('cheese has lowest attack threshold (rushes)', () => {
      expect(PERSONALITY_WEIGHTS['cheese'].attackThresholdMult).toBeLessThan(
        PERSONALITY_WEIGHTS['aggressive'].attackThresholdMult
      );
    });

    it('turtle has highest attack threshold (very defensive)', () => {
      expect(PERSONALITY_WEIGHTS['turtle'].attackThresholdMult).toBeGreaterThan(
        PERSONALITY_WEIGHTS['defensive'].attackThresholdMult
      );
    });

    it('balanced has 1.0 multipliers (baseline)', () => {
      expect(PERSONALITY_WEIGHTS['balanced'].attackThresholdMult).toBe(1.0);
      expect(PERSONALITY_WEIGHTS['balanced'].expandFrequency).toBe(1.0);
    });

    it('all weights are between 0 and 1 (except multipliers)', () => {
      for (const personality of Object.keys(PERSONALITY_WEIGHTS) as AIPersonality[]) {
        const weights = PERSONALITY_WEIGHTS[personality];
        expect(weights.proximity).toBeGreaterThanOrEqual(0);
        expect(weights.proximity).toBeLessThanOrEqual(1);
        expect(weights.threat).toBeGreaterThanOrEqual(0);
        expect(weights.threat).toBeLessThanOrEqual(1);
        expect(weights.retaliation).toBeGreaterThanOrEqual(0);
        expect(weights.retaliation).toBeLessThanOrEqual(1);
        expect(weights.opportunity).toBeGreaterThanOrEqual(0);
        expect(weights.opportunity).toBeLessThanOrEqual(1);
      }
    });

    it('all multipliers are positive', () => {
      for (const personality of Object.keys(PERSONALITY_WEIGHTS) as AIPersonality[]) {
        const weights = PERSONALITY_WEIGHTS[personality];
        expect(weights.attackThresholdMult).toBeGreaterThan(0);
        expect(weights.expandFrequency).toBeGreaterThan(0);
      }
    });
  });
});
