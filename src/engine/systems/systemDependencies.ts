import { SystemDefinition } from '../core/SystemRegistry';
import type { IGameInstance } from '../core/IGameInstance';

// System imports
import { SelectionSystem } from './SelectionSystem';
import { SpawnSystem } from './SpawnSystem';
import { BuildingPlacementSystem } from './BuildingPlacementSystem';
import { BuildingMechanicsSystem } from './BuildingMechanicsSystem';
import { WallSystem } from './WallSystem';
import { UnitMechanicsSystem } from './UnitMechanicsSystem';
import { MovementSystem } from './MovementSystem';
import { CombatSystem } from './CombatSystem';
import { ProjectileSystem } from './ProjectileSystem';
import { ProductionSystem } from './ProductionSystem';
import { ResourceSystem } from './ResourceSystem';
import { ResearchSystem } from './ResearchSystem';
import { AbilitySystem } from './AbilitySystem';
import { EnhancedAISystem } from './EnhancedAISystem';
import { AIEconomySystem } from './AIEconomySystem';

/**
 * System Dependency Definitions
 *
 * This file defines the execution order of all game systems through explicit
 * dependencies. The SystemRegistry uses topological sort to derive the actual
 * execution order from these dependencies.
 *
 * EXECUTION ORDER LAYERS:
 * 1. Input Layer: SelectionSystem (handles player input)
 * 2. Spawn Layer: SpawnSystem (creates new entities)
 * 3. Placement Layer: BuildingPlacementSystem, PathfindingSystem
 * 4. Mechanics Layer: BuildingMechanics, WallSystem, UnitMechanics
 * 5. Movement Layer: MovementSystem
 * 6. Vision Layer: VisionSystem (MUST run after movement for accurate fog)
 * 7. Combat Layer: CombatSystem, ProjectileSystem, AbilitySystem
 * 8. Economy Layer: ResourceSystem, ProductionSystem, ResearchSystem
 * 9. AI Layer: EnhancedAISystem, AICoordinator, AIEconomySystem, AIMicroSystem
 * 10. Output Layer: AudioSystem
 * 11. Meta Layer: GameStateSystem, ChecksumSystem, SaveLoadSystem
 *
 * ADDING NEW SYSTEMS:
 * 1. Add import at top of file
 * 2. Add SystemDefinition with appropriate dependencies
 * 3. Run game to validate no cycles or missing deps
 */

export const SYSTEM_DEFINITIONS: SystemDefinition[] = [
  // ============================================================================
  // INPUT LAYER - Handles player input first
  // ============================================================================
  {
    name: 'SelectionSystem',
    dependencies: [],
    factory: (game: IGameInstance) => new SelectionSystem(game),
  },

  // ============================================================================
  // SPAWN LAYER - Creates new entities early in the frame
  // ============================================================================
  {
    name: 'SpawnSystem',
    dependencies: [],
    factory: (game: IGameInstance) => new SpawnSystem(game),
  },

  // ============================================================================
  // PLACEMENT LAYER - Building placement and pathfinding setup
  // ============================================================================
  {
    name: 'BuildingPlacementSystem',
    dependencies: ['SelectionSystem'], // Placement responds to selection
    factory: (game: IGameInstance) => new BuildingPlacementSystem(game),
  },
  {
    name: 'PathfindingSystem',
    dependencies: ['BuildingPlacementSystem'], // Needs building grid populated
    factory: (game: IGameInstance) => game.pathfindingSystem,
  },

  // ============================================================================
  // MECHANICS LAYER - Building and unit mechanics before movement
  // ============================================================================
  {
    name: 'BuildingMechanicsSystem',
    dependencies: ['BuildingPlacementSystem'], // Needs buildings placed
    factory: (game: IGameInstance) => new BuildingMechanicsSystem(game),
  },
  {
    name: 'WallSystem',
    dependencies: ['BuildingPlacementSystem'], // Wall connections after placement
    factory: (game: IGameInstance) => new WallSystem(game),
  },
  {
    name: 'UnitMechanicsSystem',
    dependencies: ['SelectionSystem'], // Responds to unit commands
    factory: (game: IGameInstance) => new UnitMechanicsSystem(game),
  },

  // ============================================================================
  // MOVEMENT LAYER - Core movement after pathfinding is ready
  // ============================================================================
  {
    name: 'MovementSystem',
    dependencies: ['PathfindingSystem', 'UnitMechanicsSystem'],
    factory: (game: IGameInstance) => new MovementSystem(game),
  },

  // ============================================================================
  // VISION LAYER - MUST run after movement for accurate fog of war
  // This was previously bugged: priority 5 ran BEFORE movement (priority 10)
  // ============================================================================
  {
    name: 'VisionSystem',
    dependencies: ['MovementSystem'], // CRITICAL: vision updates after units move
    factory: (game: IGameInstance) => game.visionSystem,
  },

  // ============================================================================
  // COMBAT LAYER - Combat resolution after movement
  // ============================================================================
  {
    name: 'CombatSystem',
    dependencies: ['MovementSystem', 'VisionSystem'], // Combat after positioning
    factory: (game: IGameInstance) => new CombatSystem(game),
  },
  {
    name: 'ProjectileSystem',
    dependencies: ['CombatSystem'], // Projectiles created by combat
    factory: (game: IGameInstance) => new ProjectileSystem(game),
  },
  {
    name: 'AbilitySystem',
    dependencies: ['CombatSystem'], // Abilities may depend on combat state
    factory: (game: IGameInstance) => new AbilitySystem(game),
  },

  // ============================================================================
  // ECONOMY LAYER - Resource gathering and production
  // ============================================================================
  {
    name: 'ResourceSystem',
    dependencies: ['MovementSystem'], // Workers need to move to gather
    factory: (game: IGameInstance) => new ResourceSystem(game),
  },
  {
    name: 'ProductionSystem',
    dependencies: ['ResourceSystem'], // Production consumes resources
    factory: (game: IGameInstance) => new ProductionSystem(game),
  },
  {
    name: 'ResearchSystem',
    dependencies: ['ProductionSystem'], // Research after production queues
    factory: (game: IGameInstance) => new ResearchSystem(game),
  },

  // ============================================================================
  // AI LAYER - AI decision making after game state is resolved
  // ============================================================================
  {
    name: 'EnhancedAISystem',
    dependencies: ['CombatSystem', 'ResourceSystem'], // AI reacts to game state
    factory: (game: IGameInstance) => new EnhancedAISystem(game, game.config.aiDifficulty),
    condition: (game: IGameInstance) => game.config.aiEnabled,
  },
  {
    name: 'AIEconomySystem',
    dependencies: ['EnhancedAISystem'], // Economy metrics after AI decisions
    factory: (game: IGameInstance) => new AIEconomySystem(game),
    condition: (game: IGameInstance) => game.config.aiEnabled,
  },
  {
    name: 'AIMicroSystem',
    dependencies: ['EnhancedAISystem', 'CombatSystem'], // Micro after strategic AI
    factory: (game: IGameInstance) => game.aiMicroSystem,
    condition: (game: IGameInstance) => game.config.aiEnabled,
  },

  // ============================================================================
  // OUTPUT LAYER - Audio and visual feedback
  // ============================================================================
  {
    name: 'AudioSystem',
    dependencies: ['CombatSystem'], // Audio responds to combat events
    factory: (game: IGameInstance) => game.audioSystem!,
    condition: (game: IGameInstance) => game.audioSystem !== null,
  },

  // ============================================================================
  // META LAYER - Game state tracking, checksums, save/load (run last)
  // ============================================================================
  {
    name: 'GameStateSystem',
    dependencies: ['CombatSystem', 'ProductionSystem', 'ResourceSystem'], // Victory/defeat after gameplay
    factory: (game: IGameInstance) => game.gameStateSystem,
  },
  {
    name: 'ChecksumSystem',
    dependencies: ['GameStateSystem'], // Checksum after all game state settled
    factory: (game: IGameInstance) => {
      // ChecksumSystem is created in Game constructor for multiplayer
      // Return the existing instance
      if (!game.checksumSystem) {
        throw new Error('ChecksumSystem should be created in Game constructor');
      }
      return game.checksumSystem;
    },
    condition: (game: IGameInstance) => game.config.isMultiplayer,
  },
  {
    name: 'SaveLoadSystem',
    dependencies: ['GameStateSystem'], // Save after game state is final
    factory: (game: IGameInstance) => game.saveLoadSystem,
  },
];

/**
 * Get system definitions for the registry.
 * This is the main export used by Game.ts.
 */
export function getSystemDefinitions(): SystemDefinition[] {
  return SYSTEM_DEFINITIONS;
}
