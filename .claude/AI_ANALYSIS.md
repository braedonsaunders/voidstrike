# AI System Analysis - Is This a World-Class Reference Implementation?

**Date:** 2026-01-15
**Status:** CRITICAL ARCHITECTURAL ISSUES IDENTIFIED

## Executive Summary

**The AI system has good foundations but is NOT a proper data-driven reference implementation.** The `buildOrders.ts` data file provides ~30% of what's needed, but ~70% of game-specific logic is hardcoded directly in `EnhancedAISystem.ts` and `AIMicroSystem.ts`.

A world-class RTS AI reference implementation should allow creating entirely new factions, unit types, and strategies **without touching engine code**. Currently, adding a new faction requires modifying 1000+ lines of hardcoded logic.

---

## Current Architecture Assessment

### What's Data-Driven (GOOD)

| Component | Location | Quality |
|-----------|----------|---------|
| Difficulty configs | `buildOrders.ts` | Excellent |
| Build order steps | `buildOrders.ts` | Good |
| Unit composition weights | `buildOrders.ts` | Good |
| Timing parameters | `AI_DIFFICULTY_CONFIG` | Excellent |

### What's Hardcoded (BAD)

| Component | Location | Impact |
|-----------|----------|--------|
| Unit names | `EnhancedAISystem.ts:207, 340, 809-871` | Cannot add new units without code changes |
| Building names | `EnhancedAISystem.ts:354-365, 756-773` | Cannot add new buildings without code changes |
| Production sequences | `EnhancedAISystem.ts:754-773` | Cannot change build timing without code changes |
| Resource thresholds | `EnhancedAISystem.ts:497, 504, 513, 563, 575` | Cannot tune economy without code changes |
| Unit priorities | `AIMicroSystem.ts:56-69` | Cannot rebalance combat without code changes |
| Counter matrix | `AIMicroSystem.ts:706-717` | Cannot define counters without code changes |
| Threat formulas | `AIMicroSystem.ts:453-459` | Cannot tune tactics without code changes |

---

## Critical Issues Found

### Issue 1: Duplicate Difficulty Configuration

**Two separate configurations exist that can drift:**

```typescript
// In buildOrders.ts (lines 77-168)
export const AI_DIFFICULTY_CONFIG: Record<AIDifficulty, AIBehaviorConfig> = {
  easy: { ticksBetweenActions: 40, ... },
  // ...
};

// In EnhancedAISystem.ts (lines 239-317) - DIFFERENT!
private getDifficultyConfig() {
  const configs = {
    easy: { actionDelay: 40, ... },
    // DIFFERENT VALUES AND STRUCTURE
  };
}
```

**Problem:** The system has two sources of truth. `buildOrders.ts` config is partially ignored.

### Issue 2: Hardcoded Unit Names Throughout

```typescript
// EnhancedAISystem.ts line 207
const workerType = 'fabricator';  // Hardcoded

// EnhancedAISystem.ts lines 809-871
if (ai.vespene >= 200 && ai.minerals >= 300) {
  if (this.tryTrainUnit(ai, 'colossus')) return;  // Hardcoded
}
if (ai.vespene >= 125) {
  if (this.tryTrainUnit(ai, 'devastator')) return;  // Hardcoded
}
// ... 15+ more hardcoded unit names
```

**Problem:** Cannot add new units or change unit roles without modifying engine code.

### Issue 3: Hardcoded Building Sequences

```typescript
// EnhancedAISystem.ts lines 754-773
if (!hasInfantryBay && ai.workerCount >= 12) {
  if (this.tryBuildBuilding(ai, 'infantry_bay')) return;
}
if (infantryBayCount === 1 && ai.workerCount >= 18 && ai.armySupply >= 4) {
  if (this.tryBuildBuilding(ai, 'infantry_bay')) return;  // Max 2 bays!
}
if (!hasForge && hasExtractor && ai.vespene >= 100) {
  if (this.tryBuildBuilding(ai, 'forge')) return;
}
```

**Problems:**
1. Infantry bay hardcapped at 2 (never builds 3rd, 4th, etc.)
2. Worker/vespene thresholds are hardcoded magic numbers
3. Building unlock order is hardcoded, not data-driven

### Issue 4: Hardcoded Combat Logic

```typescript
// AIMicroSystem.ts lines 56-69
const UNIT_PRIORITY: Record<string, number> = {
  devastator: 100,
  colossus: 90,
  lifter: 85,
  specter: 80,
  valkyrie: 75,
  // ... all hardcoded
};

// AIMicroSystem.ts lines 706-717
const COUNTER_MATRIX: Record<string, string[]> = {
  trooper: ['scorcher', 'inferno', 'devastator'],
  breacher: ['colossus', 'valkyrie', 'scorcher'],
  // ... all hardcoded
};
```

**Problem:** Cannot balance combat or add new units without code changes.

### Issue 5: Magic Number Epidemic

```typescript
// Resource thresholds
const baseIncomePerWorker = 5;           // Line 497
const optimalWorkersPerBase = 22;        // Line 575
const expansionMineralThreshold = 400;   // Line 563

// Combat thresholds
const FOCUS_FIRE_THRESHOLD = 0.7;        // Line 25
const HIGH_GROUND_THRESHOLD = 1.5;       // Combat system

// Timing thresholds
const longGameTick = 2000;               // Line 580
const buildOrderTimeout = 10;            // 10 failures to skip
```

**Problem:** Tuning the AI requires hunting through thousands of lines of code.

---

## What a World-Class Implementation Would Look Like

### Proposed Data Schema

```typescript
// ai/factionAI.ts - Complete faction AI configuration
export interface FactionAIConfig {
  id: string;

  // Unit role mappings (no hardcoded names in engine)
  roles: {
    worker: string;           // e.g., 'fabricator'
    scout: string;            // e.g., 'trooper'
    mainInfantry: string;     // e.g., 'trooper'
    antiAir: string[];        // e.g., ['valkyrie', 'trooper']
    siege: string[];          // e.g., ['devastator', 'colossus']
  };

  // Building role mappings
  buildings: {
    mainBase: string;         // e.g., 'headquarters'
    supply: string;           // e.g., 'supply_cache'
    gasExtractor: string;     // e.g., 'extractor'
    basicProduction: string;  // e.g., 'infantry_bay'
    advancedProduction: string[];  // e.g., ['forge', 'hangar']
  };

  // Economy configuration
  economy: {
    workerIncomePerTick: number;
    gasIncomeMultiplier: number;
    optimalWorkersPerBase: number;
    expansionMineralThreshold: number;
    supplyBufferBeforeBuild: number;
  };

  // Production scaling rules
  production: {
    // Dynamic scaling instead of hardcoded limits
    productionBuildingsPerBase: number;  // e.g., 2 infantry bays per base
    maxProductionBuildings: number;      // e.g., 6 total
    workerThresholdForFirst: number;     // e.g., 12 workers
    workerThresholdForAdditional: number; // e.g., 8 more workers each
  };

  // Combat configuration
  combat: {
    unitPriorities: Record<string, number>;
    counterMatrix: Record<string, string[]>;
    focusFireThreshold: number;
    retreatHealthThreshold: number;
  };

  // Threat assessment weights
  threatWeights: {
    damageFactor: number;
    priorityFactor: number;
    distanceFactor: number;
    healthFactor: number;
  };
}
```

### Proposed Build Order Enhancement

```typescript
// Enhanced build order with macro rules
export interface EnhancedBuildOrder {
  // ... existing fields ...

  // Macro rules that apply after build order completes
  macroRules: MacroRule[];
}

export interface MacroRule {
  id: string;
  priority: number;

  // Condition to trigger this rule
  condition: {
    type: 'supply' | 'workers' | 'minerals' | 'vespene' | 'buildings' | 'army' | 'time';
    operator: '>' | '<' | '==' | '>=' | '<=';
    value: number;
    building?: string;  // For building count conditions
  }[];

  // Action to take
  action: {
    type: 'build' | 'train' | 'expand' | 'attack' | 'defend';
    target: string;  // Building or unit ID
    count?: number;
  };
}

// Example: Dynamic infantry bay scaling
const MACRO_RULES: MacroRule[] = [
  {
    id: 'scale_production',
    priority: 80,
    condition: [
      { type: 'workers', operator: '>=', value: 12 },
      { type: 'buildings', operator: '<', value: 2, building: 'infantry_bay' },
    ],
    action: { type: 'build', target: 'infantry_bay' },
  },
  {
    id: 'scale_production_per_base',
    priority: 70,
    condition: [
      { type: 'buildings', operator: '<', value: 2, building: 'infantry_bay' },
      // productionBuildingsPerBase from config
    ],
    action: { type: 'build', target: 'infantry_bay' },
  },
];
```

---

## Migration Path

### Phase 1: Consolidate Configuration (1-2 days)
1. Remove `getDifficultyConfig()` from EnhancedAISystem.ts
2. Use `getAIConfig()` from buildOrders.ts as single source
3. Add missing fields to `AI_DIFFICULTY_CONFIG`

### Phase 2: Extract Unit/Building Names (2-3 days)
1. Create `FactionAIConfig` interface
2. Define role mappings for Dominion faction
3. Replace all hardcoded unit names with role lookups
4. Replace all hardcoded building names with role lookups

### Phase 3: Extract Magic Numbers (1-2 days)
1. Move all numeric thresholds to configuration
2. Add economy config to `FactionAIConfig`
3. Add combat config to `FactionAIConfig`

### Phase 4: Dynamic Production Scaling (2-3 days)
1. Replace hardcoded `infantryBayCount === 1` with dynamic rules
2. Implement `MacroRule` system for post-build-order decisions
3. Allow production buildings to scale with bases/workers

### Phase 5: Data-Driven Combat (2-3 days)
1. Move `UNIT_PRIORITY` to faction config
2. Move `COUNTER_MATRIX` to faction config
3. Make threat assessment formula configurable

---

## Immediate Bugs Causing Current Issues

These are the direct causes of the user-reported problems:

| Symptom | Root Cause | Fix Location |
|---------|-----------|--------------|
| Builds 2 infantry bays then stops | `infantryBayCount === 1` hardcoded | Line 761 |
| Doesn't make units | Supply cache built at `maxSupply - 2` (too late) | Line 727 |
| Idle workers | `isStuckMoving` catches non-stuck workers | Lines 2632-2634 |
| Doesn't expand | All 5 conditions must be true simultaneously | Lines 552-586 |
| Mines until depleted | No expansion + gather commands unverified | Multiple |

---

## Recommendation

**Before adding more features, the AI architecture needs a refactor to be truly data-driven.**

The current implementation works for a single faction with fixed behavior, but:
1. Cannot easily add new factions
2. Cannot easily tune balance
3. Has multiple bugs from scattered hardcoded values
4. Has duplicate configuration that can drift

A proper reference implementation would allow game designers to:
- Define new factions entirely in JSON/TypeScript data files
- Tune AI behavior without touching engine code
- Create AI personalities (aggressive, defensive, economic) via config
- Balance units via data changes, not code changes

---

## Files to Modify

1. **`src/data/ai/buildOrders.ts`** - Expand with full faction config
2. **`src/engine/systems/EnhancedAISystem.ts`** - Remove hardcoded values, use config
3. **`src/engine/systems/AIMicroSystem.ts`** - Remove hardcoded values, use config
4. **`src/data/ai/factionAI.ts`** (NEW) - Faction-specific AI configuration

---

## Conclusion

The AI system needs architectural improvement before it can be considered a reference implementation. The good news is the foundation exists in `buildOrders.ts` - it just needs to be expanded and actually used throughout the engine code.

Current state: **5/10 - Functional but not reference-quality**
Target state: **9/10 - Fully data-driven, easily extensible**
