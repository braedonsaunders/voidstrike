import { SystemDefinition } from '../core/SystemRegistry';
import { Game } from '../core/Game';

// System imports
import { SelectionSystem } from './SelectionSystem';
import { SpawnSystem } from './SpawnSystem';
import { BuildingPlacementSystem } from './BuildingPlacementSystem';
import { PathfindingSystem } from './PathfindingSystem';
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
import { VisionSystem } from './VisionSystem';
import { AudioSystem } from './AudioSystem';
import { GameStateSystem } from './GameStateSystem';
import { SaveLoadSystem } from './SaveLoadSystem';
import { EnhancedAISystem } from './EnhancedAISystem';
import { AIEconomySystem } from './AIEconomySystem';
import { AIMicroSystem } from './AIMicroSystem';
import { ChecksumSystem } from './ChecksumSystem';

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
    factory: (game: Game) => new SelectionSystem(game),
  },

  // ============================================================================
  // SPAWN LAYER - Creates new entities early in the frame
  // ============================================================================
  {
    name: 'SpawnSystem',
    dependencies: [],
    factory: (game: Game) => new SpawnSystem(game),
  },

  // ============================================================================
  // PLACEMENT LAYER - Building placement and pathfinding setup
  // ============================================================================
  {
    name: 'BuildingPlacementSystem',
    dependencies: ['SelectionSystem'], // Placement responds to selection
    factory: (game: Game) => new BuildingPlacementSystem(game),
  },
  {
    name: 'PathfindingSystem',
    dependencies: ['BuildingPlacementSystem'], // Needs building grid populated
    factory: (game: Game) => game.pathfindingSystem,
  },

  // ============================================================================
  // MECHANICS LAYER - Building and unit mechanics before movement
  // ============================================================================
  {
    name: 'BuildingMechanicsSystem',
    dependencies: ['BuildingPlacementSystem'], // Needs buildings placed
    factory: (game: Game) => new BuildingMechanicsSystem(game),
  },
  {
    name: 'WallSystem',
    dependencies: ['BuildingPlacementSystem'], // Wall connections after placement
    factory: (game: Game) => new WallSystem(game),
  },
  {
    name: 'UnitMechanicsSystem',
    dependencies: ['SelectionSystem'], // Responds to unit commands
    factory: (game: Game) => new UnitMechanicsSystem(game),
  },

  // ============================================================================
  // MOVEMENT LAYER - Core movement after pathfinding is ready
  // ============================================================================
  {
    name: 'MovementSystem',
    dependencies: ['PathfindingSystem', 'UnitMechanicsSystem'],
    factory: (game: Game) => new MovementSystem(game),
  },

  // ============================================================================
  // VISION LAYER - MUST run after movement for accurate fog of war
  // This was previously bugged: priority 5 ran BEFORE movement (priority 10)
  // ============================================================================
  {
    name: 'VisionSystem',
    dependencies: ['MovementSystem'], // CRITICAL: vision updates after units move
    factory: (game: Game) => game.visionSystem,
  },

  // ============================================================================
  // COMBAT LAYER - Combat resolution after movement
  // ============================================================================
  {
    name: 'CombatSystem',
    dependencies: ['MovementSystem', 'VisionSystem'], // Combat after positioning
    factory: (game: Game) => new CombatSystem(game),
  },
  {
    name: 'ProjectileSystem',
    dependencies: ['CombatSystem'], // Projectiles created by combat
    factory: (game: Game) => new ProjectileSystem(game),
  },
  {
    name: 'AbilitySystem',
    dependencies: ['CombatSystem'], // Abilities may depend on combat state
    factory: (game: Game) => new AbilitySystem(game),
  },

  // ============================================================================
  // ECONOMY LAYER - Resource gathering and production
  // ============================================================================
  {
    name: 'ResourceSystem',
    dependencies: ['MovementSystem'], // Workers need to move to gather
    factory: (game: Game) => new ResourceSystem(game),
  },
  {
    name: 'ProductionSystem',
    dependencies: ['ResourceSystem'], // Production consumes resources
    factory: (game: Game) => new ProductionSystem(game),
  },
  {
    name: 'ResearchSystem',
    dependencies: ['ProductionSystem'], // Research after production queues
    factory: (game: Game) => new ResearchSystem(game),
  },

  // ============================================================================
  // AI LAYER - AI decision making after game state is resolved
  // ============================================================================
  {
    name: 'EnhancedAISystem',
    dependencies: ['CombatSystem', 'ResourceSystem'], // AI reacts to game state
    factory: (game: Game) => new EnhancedAISystem(game, game.config.aiDifficulty),
    condition: (game: Game) => game.config.aiEnabled,
  },
  {
    name: 'AIEconomySystem',
    dependencies: ['EnhancedAISystem'], // Economy metrics after AI decisions
    factory: (game: Game) => new AIEconomySystem(game),
    condition: (game: Game) => game.config.aiEnabled,
  },
  {
    name: 'AIMicroSystem',
    dependencies: ['EnhancedAISystem', 'CombatSystem'], // Micro after strategic AI
    factory: (game: Game) => game.aiMicroSystem,
    condition: (game: Game) => game.config.aiEnabled,
  },

  // ============================================================================
  // OUTPUT LAYER - Audio and visual feedback
  // ============================================================================
  {
    name: 'AudioSystem',
    dependencies: ['CombatSystem'], // Audio responds to combat events
    factory: (game: Game) => game.audioSystem,
  },

  // ============================================================================
  // META LAYER - Game state tracking, checksums, save/load (run last)
  // ============================================================================
  {
    name: 'GameStateSystem',
    dependencies: [
      'CombatSystem',
      'ProductionSystem',
      'ResourceSystem',
    ], // Victory/defeat after gameplay
    factory: (game: Game) => game.gameStateSystem,
  },
  {
    name: 'ChecksumSystem',
    dependencies: ['GameStateSystem'], // Checksum after all game state settled
    factory: (game: Game) => {
      // ChecksumSystem is created in Game constructor for multiplayer
      // Return the existing instance
      if (!game.checksumSystem) {
        throw new Error('ChecksumSystem should be created in Game constructor');
      }
      return game.checksumSystem;
    },
    condition: (game: Game) => game.config.isMultiplayer,
  },
  {
    name: 'SaveLoadSystem',
    dependencies: ['GameStateSystem'], // Save after game state is final
    factory: (game: Game) => game.saveLoadSystem,
  },
];

/**
 * Get system definitions for the registry.
 * This is the main export used by Game.ts.
 */
export function getSystemDefinitions(): SystemDefinition[] {
  return SYSTEM_DEFINITIONS;
}
