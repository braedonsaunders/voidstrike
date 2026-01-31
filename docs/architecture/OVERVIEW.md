# VOIDSTRIKE - Architecture Overview

## Directory Structure

```
voidstrike/
├── .claude/
│   ├── templates/ # Documentation templates
│   │   ├── component.md
│   │   ├── feature.md
│   │   ├── system.md
│   │   └── tool.md
│   ├── CLAUDE.md # Main instructions file
│   └── TODO.md # Development roadmap
├── docs/
│   ├── architecture/ # Architecture docs (this file)
│   │   ├── networking.md # P2P multiplayer
│   │   ├── OVERVIEW.md # System architecture
│   │   └── rendering.md # Graphics pipeline
│   ├── design/ # Game design docs
│   │   ├── audio.md # Audio system
│   │   └── GAME_DESIGN.md # Core design doc
│   ├── reference/ # Technical reference
│   │   ├── models.md # 3D model specs
│   │   ├── schema.md # Data schemas
│   │   └── textures.md # Texture specs
│   ├── security/ # Security documentation
│   │   └── CODE_AUDIT_REPORT.md
│   ├── tools/ # Development tools
│   │   ├── blender/
│   │   │   └── README.md
│   │   ├── debug/
│   │   │   ├── effect-placer.html
│   │   │   └── README.md
│   │   └── README.md
│   └── TESTING.md # Test documentation
├── wasm/ # WASM module wrappers
│   └── boids/ # SIMD-accelerated boids
│       ├── src/
│       │   ├── lib.rs
│       │   ├── simd.rs
│       │   └── soa.rs
│       └── Cargo.toml
├── src/
│   ├── adapters/
│   │   └── ZustandStateAdapter.ts
│   ├── app/ # Next.js App Router
│   │   ├── game/
│   │   │   ├── setup/
│   │   │   │   ├── editor/ # 3D Map Editor
│   │   │   │   │   └── ...
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── assets/ # Asset management
│   │   ├── AssetManager.ts
│   │   └── GLTFWorkerManager.ts
│   ├── audio/ # Audio management
│   │   ├── audioConfig.ts
│   │   ├── AudioManager.ts
│   │   └── MusicPlayer.ts
│   ├── components/ # React components
│   │   ├── game/
│   │   │   ├── hooks/ # React hooks
│   │   │   │   ├── index.ts
│   │   │   │   ├── useCameraControl.ts
│   │   │   │   ├── useGameInput.ts
│   │   │   │   ├── useLoadingState.ts
│   │   │   │   ├── usePhaserOverlay.ts
│   │   │   │   ├── usePostProcessing.ts
│   │   │   │   ├── useWebGPURenderer.ts
│   │   │   │   └── useWorkerBridge.ts
│   │   │   ├── BaseModal.tsx
│   │   │   ├── BasePanel.tsx
│   │   │   ├── BattleSimulatorPanel.tsx
│   │   │   ├── CommandCard.tsx
│   │   │   ├── ConsolePanel.tsx
│   │   │   ├── DebugMenuPanel.tsx
│   │   │   ├── GraphicsOptionsPanel.tsx
│   │   │   ├── HUD.tsx
│   │   │   ├── icons.ts
│   │   │   ├── IdleWorkerButton.tsx
│   │   │   ├── KeyboardShortcutsPanel.tsx
│   │   │   ├── LoadingScreen.tsx
│   │   │   ├── Minimap.tsx
│   │   │   ├── MultiplayerOverlay.tsx
│   │   │   ├── PerformanceDashboard.tsx
│   │   │   ├── PerformancePanel.tsx
│   │   │   ├── PerformanceRecorder.tsx
│   │   │   ├── PlayerStatusPanel.tsx
│   │   │   ├── ResourcePanel.tsx
│   │   │   ├── SelectionBox.tsx
│   │   │   ├── SelectionPanel.tsx
│   │   │   ├── SoundOptionsPanel.tsx
│   │   │   ├── TechTreePanel.tsx
│   │   │   └── WebGPUGameCanvas.tsx
│   │   ├── game-setup/
│   │   │   ├── index.ts
│   │   │   ├── JoinLobbyModal.tsx
│   │   │   ├── MapPreview.tsx
│   │   │   ├── PlayerSlotRow.tsx
│   │   │   ├── SettingSelect.tsx
│   │   │   └── utils.ts
│   │   ├── home/
│   │   │   └── HomeBackground.tsx
│   │   ├── lobby/
│   │   │   └── LobbyBrowser.tsx
│   │   ├── ui/
│   │   │   └── Tooltip.tsx
│   │   └── Providers.tsx
│   ├── config/ # Configuration files
│   │   └── consoleCommands.ts
│   ├── data/ # Game data definitions
│   │   ├── abilities/
│   │   │   ├── abilities.ts
│   │   │   └── abilityMapper.ts
│   │   ├── ai/ # AI subsystems
│   │   │   ├── factions/
│   │   │   │   └── dominion.ts
│   │   │   ├── aiConfig.ts
│   │   │   ├── buildOrders.ts
│   │   │   └── index.ts
│   │   ├── buildings/
│   │   │   ├── dominion.ts
│   │   │   └── walls.ts
│   │   ├── combat/
│   │   │   └── combat.ts
│   │   ├── formations/
│   │   │   └── formations.ts
│   │   ├── maps/
│   │   │   ├── core/
│   │   │   │   ├── ConnectivityAnalyzer.ts
│   │   │   │   ├── ConnectivityFixer.ts
│   │   │   │   ├── ConnectivityGraph.ts
│   │   │   │   ├── ConnectivityValidator.ts
│   │   │   │   ├── ElevationMap.ts
│   │   │   │   ├── ElevationMapGenerator.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── MapScaffolder.ts
│   │   │   ├── json/
│   │   │   │   ├── battle_arena.json
│   │   │   │   ├── contested_frontier.json
│   │   │   │   ├── crystal_caverns.json
│   │   │   │   ├── index.ts
│   │   │   │   ├── scorched_basin.json
│   │   │   │   ├── test_6p_flat.json
│   │   │   │   ├── titans_colosseum.json
│   │   │   │   ├── void_assault.json
│   │   │   │   └── webpack.d.ts
│   │   │   ├── schema/
│   │   │   │   ├── index.ts
│   │   │   │   └── MapJsonSchema.ts
│   │   │   ├── serialization/
│   │   │   │   ├── deserialize.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── serialize.ts
│   │   │   ├── index.ts
│   │   │   ├── loader.ts
│   │   │   └── MapTypes.ts
│   │   ├── projectiles/
│   │   │   ├── index.ts
│   │   │   └── projectileTypes.ts
│   │   ├── research/
│   │   │   └── dominion.ts
│   │   ├── resources/
│   │   │   └── resources.ts
│   │   ├── units/
│   │   │   ├── categories.ts
│   │   │   └── dominion.ts
│   │   ├── audio.config.ts
│   │   ├── collisionConfig.ts
│   │   ├── index.ts
│   │   ├── movement.config.ts
│   │   ├── music-manifest.json
│   │   ├── pathfinding.config.ts
│   │   ├── rendering.config.ts
│   │   └── tech-tree.ts
│   ├── editor/ # 3D Map Editor
│   │   ├── config/ # Configuration files
│   │   │   └── EditorConfig.ts
│   │   ├── configs/
│   │   │   └── voidstrike.ts
│   │   ├── core/
│   │   │   ├── Editor3DCanvas.tsx
│   │   │   ├── EditorCanvas.tsx
│   │   │   ├── EditorContextMenu.tsx
│   │   │   ├── EditorCore.tsx
│   │   │   ├── EditorExportModal.tsx
│   │   │   ├── EditorFloatingToolbar.tsx
│   │   │   ├── EditorHeader.tsx
│   │   │   ├── EditorMiniMap.tsx
│   │   │   ├── EditorPanels.tsx
│   │   │   ├── EditorStatusBar.tsx
│   │   │   └── EditorToolbar.tsx
│   │   ├── hooks/ # React hooks
│   │   │   ├── useEditorState.ts
│   │   │   └── useLLMGeneration.ts
│   │   ├── panels/
│   │   │   └── AIGeneratePanel.tsx
│   │   ├── providers/
│   │   │   └── voidstrike.ts
│   │   ├── rendering3d/
│   │   │   ├── CliffMesh.ts
│   │   │   ├── EditorBrushPreview.ts
│   │   │   ├── EditorGrid.ts
│   │   │   ├── EditorModelLoader.ts
│   │   │   ├── EditorObjects.ts
│   │   │   ├── EditorTerrain.ts
│   │   │   ├── EditorWater.ts
│   │   │   ├── GuardrailMesh.ts
│   │   │   └── index.ts
│   │   ├── services/
│   │   │   └── LLMMapGenerator.ts
│   │   ├── terrain/
│   │   │   └── EdgeDetector.ts
│   │   ├── tools/ # Development tools
│   │   │   ├── AngleConstraint.ts
│   │   │   ├── index.ts
│   │   │   ├── ObjectPlacer.ts
│   │   │   └── TerrainBrush.ts
│   │   ├── utils/ # Utility functions
│   │   │   ├── borderDecorations.ts
│   │   │   └── mapExport.ts
│   │   └── index.ts
│   ├── engine/ # Game engine core
│   │   ├── ai/ # AI subsystems
│   │   │   ├── AbilityAI.ts
│   │   │   ├── AIWorkerManager.ts
│   │   │   ├── BehaviorTree.ts
│   │   │   ├── FormationControl.ts
│   │   │   ├── index.ts
│   │   │   ├── InfluenceMap.ts
│   │   │   ├── PositionalAnalysis.ts
│   │   │   ├── RetreatCoordination.ts
│   │   │   ├── ScoutingMemory.ts
│   │   │   ├── UnitBehaviors.ts
│   │   │   └── WorkerDistribution.ts
│   │   ├── animation/
│   │   │   ├── AnimationConfigLoader.ts
│   │   │   ├── AnimationController.ts
│   │   │   ├── AnimationLayer.ts
│   │   │   ├── AnimationParameterBridge.ts
│   │   │   ├── AnimationState.ts
│   │   │   ├── AnimationStateMachine.ts
│   │   │   ├── AnimationTransition.ts
│   │   │   ├── AnimationTypes.ts
│   │   │   └── index.ts
│   │   ├── combat/
│   │   │   └── TargetAcquisition.ts
│   │   ├── components/ # React components
│   │   │   ├── Ability.ts
│   │   │   ├── Building.ts
│   │   │   ├── Health.ts
│   │   │   ├── Projectile.ts
│   │   │   ├── Resource.ts
│   │   │   ├── Selectable.ts
│   │   │   ├── Transform.ts
│   │   │   ├── Unit.ts
│   │   │   ├── Velocity.ts
│   │   │   └── Wall.ts
│   │   ├── core/
│   │   │   ├── __mocks__/
│   │   │   │   └── MockStatePort.ts
│   │   │   ├── EventBus.ts # Event system
│   │   │   ├── Game.ts # Main game class
│   │   │   ├── GameCommand.ts
│   │   │   ├── GameCore.ts
│   │   │   ├── GameLoop.ts # Fixed timestep loop
│   │   │   ├── GameStatePort.ts
│   │   │   ├── PerformanceMonitor.ts
│   │   │   ├── SpatialGrid.ts
│   │   │   └── SystemRegistry.ts
│   │   ├── debug/
│   │   │   ├── ConsoleEngine.ts
│   │   │   └── index.ts
│   │   ├── definitions/ # Definition registry
│   │   │   ├── bootstrap.ts
│   │   │   ├── DefinitionLoader.ts
│   │   │   ├── DefinitionRegistry.ts
│   │   │   ├── DefinitionValidator.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── ecs/ # Entity Component System
│   │   │   ├── Component.ts # Component base
│   │   │   ├── Entity.ts # Entity class
│   │   │   ├── EntityId.ts
│   │   │   ├── IWorldProvider.ts
│   │   │   ├── System.ts # System base
│   │   │   └── World.ts # ECS world container
│   │   ├── input/
│   │   │   ├── handlers/
│   │   │   │   ├── BuildingInputHandler.ts
│   │   │   │   ├── CommandInputHandler.ts
│   │   │   │   ├── GameplayInputHandler.ts
│   │   │   │   └── index.ts
│   │   │   ├── index.ts
│   │   │   ├── InputManager.ts
│   │   │   └── types.ts
│   │   ├── network/
│   │   │   ├── p2p/
│   │   │   │   ├── ConnectionCode.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── NostrMatchmaking.ts
│   │   │   │   ├── NostrRelays.ts
│   │   │   │   └── PeerRelay.ts
│   │   │   ├── DesyncDetection.ts
│   │   │   ├── index.ts
│   │   │   ├── MerkleTree.ts
│   │   │   └── types.ts
│   │   ├── overlay/
│   │   │   ├── index.ts
│   │   │   └── OverlayCoordinator.ts
│   │   ├── pathfinding/ # Navigation & pathfinding
│   │   │   └── RecastNavigation.ts
│   │   ├── systems/ # ECS Systems
│   │   │   ├── ai/ # AI subsystems
│   │   │   │   ├── AIBuildOrderExecutor.ts
│   │   │   │   ├── AICoordinator.ts
│   │   │   │   ├── AIEconomyManager.ts
│   │   │   │   ├── AIScoutingManager.ts
│   │   │   │   ├── AITacticsManager.ts
│   │   │   │   └── index.ts
│   │   │   ├── movement/
│   │   │   │   ├── FlockingBehavior.ts
│   │   │   │   ├── FormationMovement.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── MovementOrchestrator.ts
│   │   │   │   └── PathfindingMovement.ts
│   │   │   ├── AbilitySystem.ts
│   │   │   ├── AIEconomySystem.ts
│   │   │   ├── AIMicroSystem.ts
│   │   │   ├── AudioSystem.ts
│   │   │   ├── BuildingMechanicsSystem.ts
│   │   │   ├── BuildingPlacementSystem.ts
│   │   │   ├── ChecksumSystem.ts
│   │   │   ├── CombatSystem.ts
│   │   │   ├── EnhancedAISystem.ts
│   │   │   ├── GameStateSystem.ts
│   │   │   ├── MovementSystem.ts
│   │   │   ├── PathfindingSystem.ts
│   │   │   ├── ProductionSystem.ts
│   │   │   ├── ProjectileSystem.ts
│   │   │   ├── ResearchSystem.ts
│   │   │   ├── ResourceSystem.ts
│   │   │   ├── SaveLoadSystem.ts
│   │   │   ├── SelectionSystem.ts
│   │   │   ├── SpawnSystem.ts
│   │   │   ├── systemDependencies.ts
│   │   │   ├── UnitMechanicsSystem.ts
│   │   │   ├── VisionSystem.ts
│   │   │   └── WallSystem.ts
│   │   ├── wasm/ # WASM module wrappers
│   │   │   ├── wasm-modules.d.ts
│   │   │   └── WasmBoids.ts
│   │   └── workers/ # Web Workers
│   │       ├── GameWorker.ts
│   │       ├── index.ts
│   │       ├── MainThreadEventHandler.ts
│   │       ├── RenderStateAdapter.ts
│   │       ├── types.ts
│   │       └── WorkerBridge.ts
│   ├── hooks/ # React hooks
│   │   ├── useGameSetupMusic.ts
│   │   ├── useGameStart.ts
│   │   ├── useLobbySync.ts
│   │   ├── useMultiplayer.ts
│   │   ├── useP2P.ts
│   │   └── usePublicLobbies.ts
│   ├── phaser/ # Phaser 4 2D overlay
│   │   ├── scenes/
│   │   │   └── OverlayScene.ts
│   │   ├── systems/ # ECS Systems
│   │   │   ├── DamageNumberSystem.ts
│   │   │   ├── index.ts
│   │   │   └── ScreenEffectsSystem.ts
│   │   └── index.ts
│   ├── rendering/ # Rendering systems
│   │   ├── compute/
│   │   │   ├── GPUEntityBuffer.ts
│   │   │   ├── GPUIndirectRenderer.ts
│   │   │   ├── UnifiedCullingCompute.ts
│   │   │   └── VisionCompute.ts
│   │   ├── effects/ # Visual effects
│   │   │   ├── AdvancedParticleSystem.ts
│   │   │   ├── BattleEffectsRenderer.ts
│   │   │   ├── index.ts
│   │   │   └── VehicleEffectsSystem.ts
│   │   ├── services/
│   │   │   └── CullingService.ts
│   │   ├── shared/
│   │   │   ├── HealthBarRenderer.ts
│   │   │   ├── index.ts
│   │   │   ├── InstancedMeshPool.ts
│   │   │   └── SelectionRingRenderer.ts
│   │   ├── tsl/
│   │   │   ├── effects/ # Visual effects
│   │   │   │   ├── EffectPasses.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── TemporalManager.ts
│   │   │   │   └── TemporalUtils.ts
│   │   │   ├── BuildingMaterials.ts
│   │   │   ├── FogOfWar.ts
│   │   │   ├── GameOverlay.ts
│   │   │   ├── index.ts
│   │   │   ├── InstancedVelocity.ts
│   │   │   ├── MapBorderFog.ts
│   │   │   ├── noise.ts
│   │   │   ├── PostProcessing.ts
│   │   │   ├── SelectionMaterial.ts
│   │   │   ├── TemporalAO.ts
│   │   │   ├── TemporalSSR.ts
│   │   │   ├── TerrainMaterial.ts
│   │   │   ├── UpscalerNode.ts
│   │   │   ├── VolumetricFog.ts
│   │   │   └── WebGPURenderer.ts
│   │   ├── Biomes.ts
│   │   ├── BuildingPlacementPreview.ts
│   │   ├── BuildingRenderer.ts
│   │   ├── Camera.ts
│   │   ├── CommandQueueRenderer.ts
│   │   ├── DecorationLightManager.ts
│   │   ├── EmissiveDecorationManager.ts
│   │   ├── EnhancedDecorations.ts
│   │   ├── EnvironmentManager.ts
│   │   ├── GroundDetail.ts
│   │   ├── InstancedDecorations.ts
│   │   ├── LightPool.ts
│   │   ├── RallyPointRenderer.ts
│   │   ├── ResourceRenderer.ts
│   │   ├── Terrain.ts
│   │   ├── UnitRenderer.ts
│   │   ├── WallPlacementPreview.ts
│   │   ├── WatchTowerRenderer.ts
│   │   └── WaterMesh.ts
│   ├── store/ # State management
│   │   ├── cameraStore.ts
│   │   ├── gameSetupStore.ts
│   │   ├── gameStore.ts
│   │   ├── multiplayerStore.ts
│   │   ├── projectionStore.ts
│   │   └── uiStore.ts
│   ├── types/
│   │   └── three-webgpu.d.ts
│   ├── utils/ # Utility functions
│   │   ├── debugLogger.ts
│   │   ├── EntityValidator.ts
│   │   ├── FixedPoint.ts
│   │   ├── math.ts
│   │   ├── overlayCache.ts
│   │   ├── storage.ts
│   │   ├── ThrottledCache.ts
│   │   └── VectorPool.ts
│   └── workers/ # Web Workers
│       ├── ai-decisions.worker.ts
│       ├── countdownWorker.ts
│       ├── gltf.worker.ts
│       ├── pathfinding.worker.ts
│       ├── phaserLoopWorker.ts
│       └── vision.worker.ts
├── public/
│   ├── audio/ # Audio management
│   │   ├── alert/
│   │   ├── ambient/
│   │   ├── building/
│   │   ├── combat/
│   │   │   └── death/
│   │   ├── music/
│   │   │   ├── defeat/
│   │   │   ├── gameplay/
│   │   │   ├── menu/
│   │   │   └── victory/
│   │   ├── ui/
│   │   ├── unit/
│   │   ├── voice/
│   │   │   ├── breacher/
│   │   │   ├── colossus/
│   │   │   ├── devastator/
│   │   │   ├── dreadnought/
│   │   │   ├── fabricator/
│   │   │   ├── lifter/
│   │   │   ├── operative/
│   │   │   ├── overseer/
│   │   │   ├── scorcher/
│   │   │   ├── specter/
│   │   │   ├── trooper/
│   │   │   ├── valkyrie/
│   │   │   └── vanguard/
│   │   ├── music.config.json
│   │   ├── sounds.config.json
│   │   └── voices.config.json
│   ├── config/ # Configuration files
│   │   ├── assets.json
│   │   ├── collision.config.json
│   │   └── graphics-presets.json
│   ├── data/ # Game data definitions
│   │   ├── factions/
│   │   │   └── dominion/
│   │   │       ├── abilities.json
│   │   │       ├── buildings.json
│   │   │       ├── manifest.json
│   │   │       ├── research.json
│   │   │       └── units.json
│   │   └── game.json
│   ├── draco/
│   │   ├── draco_decoder.js
│   │   └── draco_wasm_wrapper.js
│   ├── models/ # 3D models (GLTF/GLB)
│   │   ├── buildings/
│   │   ├── decorations/
│   │   ├── resources/
│   │   └── units/
│   ├── textures/ # Texture assets
│   │   └── terrain/
│   └── wasm/ # WASM module wrappers
│       ├── boids_wasm.d.ts
│       └── boids_wasm.js
└── tests/
    ├── data/ # Game data definitions
    │   ├── aiConfig.test.ts
    │   ├── audioConfig.test.ts
    │   ├── buildOrders.test.ts
    │   ├── categories.test.ts
    │   ├── collisionConfig.test.ts
    │   ├── combat.test.ts
    │   ├── formations.test.ts
    │   ├── movementConfig.test.ts
    │   ├── pathfindingConfig.test.ts
    │   ├── projectileTypes.test.ts
    │   ├── renderingConfig.test.ts
    │   ├── resources.test.ts
    │   ├── techTree.test.ts
    │   └── walls.test.ts
    ├── engine/ # Game engine core
    │   ├── ai/ # AI subsystems
    │   │   └── behaviorTree.test.ts
    │   ├── components/ # React components
    │   │   ├── ability.test.ts
    │   │   ├── building.test.ts
    │   │   ├── health.test.ts
    │   │   ├── projectile.test.ts
    │   │   ├── resource.test.ts
    │   │   ├── selectable.test.ts
    │   │   ├── transform.test.ts
    │   │   ├── unit.test.ts
    │   │   ├── velocity.test.ts
    │   │   └── wall.test.ts
    │   ├── core/
    │   │   ├── eventBus.test.ts
    │   │   ├── gameLoop.test.ts
    │   │   ├── performanceMonitor.test.ts
    │   │   ├── spatialGrid.test.ts
    │   │   └── systemRegistry.test.ts
    │   ├── definitions/ # Definition registry
    │   │   ├── definitionRegistry.test.ts
    │   │   └── definitionValidator.test.ts
    │   ├── ecs/ # Entity Component System
    │   │   ├── entity.test.ts
    │   │   ├── entityId.test.ts
    │   │   └── world.test.ts
    │   ├── network/
    │   │   ├── connectionCode.test.ts
    │   │   ├── desyncDetection.test.ts
    │   │   ├── merkleTree.test.ts
    │   │   └── types.test.ts
    │   ├── systems/ # ECS Systems
    │   │   ├── movement/
    │   │   │   ├── flockingBehavior.perf.test.ts
    │   │   │   └── flockingBehavior.test.ts
    │   │   ├── abilitySystem.test.ts
    │   │   ├── buildingPlacementSystem.test.ts
    │   │   ├── combatSystem.test.ts
    │   │   ├── pathfindingSystem.test.ts
    │   │   ├── productionSystem.test.ts
    │   │   ├── projectileSystem.test.ts
    │   │   ├── resourceSystem.test.ts
    │   │   └── visionSystem.test.ts
    │   └── workers/ # Web Workers
    │       └── gameWorker.test.ts
    └── utils/ # Utility functions
        ├── BenchmarkRunner.ts
        ├── debugLogger.test.ts
        ├── fixedPoint.test.ts
        ├── math.test.ts
        ├── performanceTestHelpers.ts
        └── vectorPool.test.ts
```

## Data-Driven Game Configuration

VOIDSTRIKE uses a **fully data-driven architecture** that separates game-specific values from engine code. This allows forking the codebase to create different RTS games (medieval, fantasy, etc.) by modifying data files without touching engine systems.

### Configuration Modules (`src/data/`)

| Module | File | Purpose |
|--------|------|---------|
| **Combat** | `combat/combat.ts` | Damage types, armor types, damage multipliers |
| **Resources** | `resources/resources.ts` | Resource types, gather rates, starting amounts |
| **Categories** | `units/categories.ts` | Unit categories, subcategories, target priorities |
| **Abilities** | `abilities/abilities.ts` | All unit/building abilities with effects |
| **Formations** | `formations/formations.ts` | Unit formation patterns and positioning |
| **AI** | `ai/buildOrders.ts` | AI difficulty config, build orders, unit compositions |
| **AI** | `ai/factions/*.ts` | Faction macro rules, roles, and economic thresholds |

AI macro rules are cost-sensitive and should stay aligned with building definitions to avoid economic deadlocks (for example, supply-building rules should require at least the building's mineral cost).

### Example: Creating an Age of Empires Clone

To transform VOIDSTRIKE into a medieval RTS:

```typescript
// 1. Modify combat/combat.ts - Change damage types
export const DAMAGE_TYPES = {
  melee: { id: 'melee', name: 'Melee', description: 'Close combat damage' },
  pierce: { id: 'pierce', name: 'Pierce', description: 'Arrow and bolt damage' },
  siege: { id: 'siege', name: 'Siege', description: 'Building destruction' },
};

// 2. Modify resources/resources.ts - Add 4 resources
export const RESOURCE_TYPES = {
  food: { id: 'food', gatherRate: 10, ... },
  wood: { id: 'wood', gatherRate: 8, ... },
  gold: { id: 'gold', gatherRate: 5, requiresBuilding: true, ... },
  stone: { id: 'stone', gatherRate: 4, ... },
};

// 3. Update units/dominion.ts - Define medieval units
trooper: {
  name: 'Militia',
  damageType: 'melee',
  armorType: 'infantry',
  targetPriority: 50,
  category: 'infantry',
  // ...
}
```

### Import Pattern

All data modules are re-exported from a single index:

```typescript
// Import everything from one place
import {
  getDamageMultiplier,
  RESOURCE_TYPES,
  getFormation,
  getAIConfig,
} from '@/data';

// Or import specific modules
import { COMBAT_CONFIG } from '@/data/combat/combat';
```

### DefinitionRegistry Access

The `DefinitionRegistry` provides centralized access to all configuration:

```typescript
// Access combat config
const combat = DefinitionRegistry.getCombatConfig();
console.log(combat.getDamageMultiplier('explosive', 'armored'));

// Access resource types
const resources = DefinitionRegistry.getResourceTypes();
console.log(resources.types.minerals.gatherRate);

// Access formations
const formations = DefinitionRegistry.getFormations();
const positions = formations.generateFormationPositions('wedge', 10, 0, 0, 0);
```

## Core Systems

### Entity Component System (ECS)

The game uses a custom ECS for performance and flexibility:

```typescript
// Entity: Just an ID
type EntityId = number;

// Components: Pure data
interface TransformComponent {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

// Systems: Logic that operates on components
class MovementSystem extends System {
  requiredComponents = ['Transform', 'Velocity'];

  update(entities: Entity[], deltaTime: number) {
    for (const entity of entities) {
      const transform = entity.get('Transform');
      const velocity = entity.get('Velocity');
      transform.x += velocity.x * deltaTime;
      transform.y += velocity.y * deltaTime;
    }
  }
}
```

### System Execution Order

Systems are executed in dependency order, determined by the `SystemRegistry` (`src/engine/core/SystemRegistry.ts`). Instead of numeric priorities (which were error-prone), the registry uses explicit dependencies and topological sort.

**Execution Layers:**

| Layer | Systems | Purpose |
|-------|---------|---------|
| **Input** | SelectionSystem | Handle player input |
| **Spawn** | SpawnSystem | Create new entities |
| **Placement** | BuildingPlacementSystem, PathfindingSystem | Building grid, navmesh |
| **Mechanics** | BuildingMechanicsSystem, WallSystem, UnitMechanicsSystem | Unit/building mechanics |
| **Movement** | MovementSystem | Unit movement with collision avoidance |
| **Vision** | VisionSystem | Fog of war (runs AFTER movement) |
| **Combat** | CombatSystem, ProjectileSystem, AbilitySystem | Combat resolution |
| **Economy** | ResourceSystem, ProductionSystem, ResearchSystem | Resource gathering, production |
| **AI** | EnhancedAISystem, AIEconomySystem, AIMicroSystem | AI decision making |
| **Output** | AudioSystem | Audio feedback |
| **Meta** | GameStateSystem, ChecksumSystem, SaveLoadSystem | Victory/defeat, sync, persistence |

**Adding New Systems:**

1. Create the system in `src/engine/systems/`
2. Add to `SYSTEM_DEFINITIONS` in `src/engine/systems/systemDependencies.ts`
3. Specify dependencies (systems that must run before it)
4. The registry validates at startup - no cycles, no missing deps

```typescript
// Example: Adding a new system
{
  name: 'MyNewSystem',
  dependencies: ['MovementSystem', 'CombatSystem'], // Must run after these
  factory: (game: Game) => new MyNewSystem(game),
  condition: (game: Game) => game.config.featureEnabled, // Optional
}
```

### Game Loop

Fixed timestep with interpolation for smooth rendering:

```typescript
const TICK_RATE = 20; // 20 ticks per second
const TICK_MS = 1000 / TICK_RATE;

class GameLoop {
  private accumulator = 0;
  private lastTime = 0;

  tick(currentTime: number) {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    this.accumulator += deltaTime;

    // Fixed update (deterministic)
    while (this.accumulator >= TICK_MS) {
      this.game.fixedUpdate(TICK_MS);
      this.accumulator -= TICK_MS;
    }

    // Render with interpolation
    const alpha = this.accumulator / TICK_MS;
    this.game.render(alpha);

    requestAnimationFrame(this.tick.bind(this));
  }
}
```

### Background Tab Immunity

Browsers throttle `requestAnimationFrame` and `setInterval` to ~1fps when tabs are in the background. This would cause the game to freeze when tabbed out, breaking multiplayer synchronization.

**Solution:** Use Web Workers for timing-critical operations. Workers are NOT throttled:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Background Tab Immune Loops                  │
├─────────────────────────────────────────────────────────────────┤
│  GameLoop Worker (src/engine/core/GameLoop.ts)                  │
│    - Game state updates at 20 ticks/sec                         │
│    - Deterministic for multiplayer sync                         │
│    - Uses inline Worker via Blob URL                            │
├─────────────────────────────────────────────────────────────────┤
│  Countdown Worker (src/workers/countdownWorker.ts)              │
│    - Match start countdown timing                               │
│    - Wall-clock based state calculation                         │
├─────────────────────────────────────────────────────────────────┤
│  Phaser Loop Worker (src/workers/phaserLoopWorker.ts)           │
│    - Phaser overlay updates (damage numbers, effects)           │
│    - Only steps Phaser when document.hidden = true              │
│    - Manually calls scene.sys.step() to bypass RAF              │
├─────────────────────────────────────────────────────────────────┤
│  Pathfinding Worker (src/workers/pathfinding.worker.ts)         │
│    - Recast Navigation WASM-based navmesh pathfinding           │
│    - Offloads heavy pathfinding calculations from main thread   │
│    - Request/response pattern with requestId tracking           │
├─────────────────────────────────────────────────────────────────┤
│  Vision Worker (src/workers/vision.worker.ts)                   │
│    - Fog of war visibility calculations                         │
│    - Updates every 10 ticks (500ms at 20 TPS)                   │
│    - Uses TypedArrays for efficient vision map transfer         │
│    - Saves ~5-8ms per frame in multiplayer games                │
├─────────────────────────────────────────────────────────────────┤
│  AI Decisions Worker (src/workers/ai-decisions.worker.ts)       │
│    - AI micro decision-making (threat assessment, kiting)       │
│    - Focus fire target selection, retreat decisions             │
│    - Transform decisions for units like Valkyrie                │
│    - Managed via AIWorkerManager singleton                      │
│    - Saves ~8-15ms per frame with many AI units                 │
└─────────────────────────────────────────────────────────────────┘
```

When tab is visible, Phaser uses its normal RAF-based loop. When hidden, the worker takes over to keep overlay state synchronized with game state.

### Debug Logging (Worker Mode)

Debug categories are toggled in the Options menu and forwarded to the game worker via `WorkerBridge` (`setDebugSettings`). Worker-side systems use `debugLogger` with worker-local settings so AI/pathfinding logs respect the same category filters as the main thread.

### Performance Workers

Vision and AI workers offload computation from the main thread:

```typescript
// Vision Worker - off-thread fog of war
// VisionSystem sends unit positions, receives updated vision maps
visionWorker.postMessage({
  type: 'updateVision',
  units: unitSnapshots,
  buildings: buildingSnapshots,
  players: playerIds,
  version: visionVersion,
});

// AI Worker - off-thread micro decisions
// AIMicroSystem sends game state, receives decisions (attack, kite, retreat, transform)
aiWorker.postMessage({
  type: 'evaluateMicro',
  aiPlayerId,
  aiUnits: unitSnapshots,
  enemyUnits: enemySnapshots,
  enemyBuildings: buildingSnapshots,
  tick: currentTick,
});
```

Both workers maintain main thread fallbacks for environments without Web Worker support.

In worker mode, `WorkerGame` mirrors main-thread building placement validation (terrain, collisions, decorations) so AI and player placement rules stay consistent across runtimes.

### State Management

Zustand store for reactive game state:

```typescript
interface GameState {
  // Resources
  minerals: number;
  vespene: number;
  supply: number;
  maxSupply: number;

  // Selection
  selectedUnits: EntityId[];
  controlGroups: Map<number, EntityId[]>;

  // Game
  gameTime: number;
  isPaused: boolean;

  // Actions
  selectUnits: (ids: EntityId[]) => void;
  setControlGroup: (key: number, ids: EntityId[]) => void;
  addResources: (minerals: number, vespene: number) => void;
}
```

### Pathfinding Architecture

Industry-standard WASM-based navigation using **recast-navigation-js** (same core as Unity/Unreal/Godot):

```typescript
// RecastNavigation singleton - WASM-powered pathfinding
const recast = RecastNavigation.getInstance();

// Initialize from terrain geometry
await recast.generateFromTerrain(walkableMesh, mapWidth, mapHeight);

// Fast O(1) path queries via NavMeshQuery
const path = recast.findPath(startX, startY, endX, endY);
// Returns: { success: boolean, path: { x: number, y: number }[] }

// Point queries
recast.findNearestPoint(x, y);  // Snap to navmesh
recast.isWalkable(x, y);        // Check walkability

// Crowd simulation (replaces custom RVO)
const agentId = recast.addAgent(entityId, x, y, radius, maxSpeed);
recast.setAgentTarget(entityId, targetX, targetY);
recast.updateCrowd(deltaTime);  // Run ORCA collision avoidance
const state = recast.getAgentState(entityId);  // { x, y, vx, vy }

// Dynamic obstacles for buildings (TileCache)
recast.addBoxObstacle(buildingId, centerX, centerY, width, height);
recast.removeObstacle(buildingId);
```

Key Components:
- **NavMesh**: Navigation mesh generated from terrain walkable geometry
- **NavMeshQuery**: O(1) path lookups with string-pulling path smoothing
- **DetourCrowd**: RVO/ORCA-based local collision avoidance
- **TileCache**: Dynamic obstacle support for buildings

**Ramp Connectivity**: The walkable geometry generation pre-computes consistent vertex heights
to ensure shared vertices between adjacent cells have identical heights. This prevents gaps
in the navmesh at ramp/platform boundaries that would cause pathfinding to fail across
elevation transitions. Vertices touching ramp zones always use smooth heightMap interpolation.

### Multiplayer Architecture

VOIDSTRIKE uses a **fully serverless peer-to-peer architecture** with Nostr-based signaling.

#### Protocol Stack

| Layer | Technology | Location |
|-------|------------|----------|
| Transport | WebRTC DataChannels | `src/hooks/useMultiplayer.ts` |
| Signaling | Nostr Protocol | `src/engine/network/p2p/NostrMatchmaking.ts` |
| NAT Traversal | STUN (Google) | ICE servers in useMultiplayer |
| Synchronization | Lockstep | `src/engine/network/types.ts` |
| Desync Detection | Checksums | `src/engine/network/DesyncDetection.ts` |

#### Lobby System (`src/hooks/useMultiplayer.ts`)

The `useLobby` hook manages multiplayer connections:

```typescript
// Lobby-based matchmaking flow:
// 1. Host generates 4-char code (e.g., "ABCD")
// 2. Lobby published to Nostr relays
// 3. Guest enters code, sends join request
// 4. WebRTC offer/answer exchanged via Nostr
// 5. Direct P2P DataChannel established

const {
  status,        // 'initializing' | 'hosting' | 'joining' | 'connected' | 'error'
  lobbyCode,     // 4-char lobby code (e.g., "ABCD")
  guests,        // Connected guest connections
  hostConnection, // DataChannel to host (when guest)
  isHost,
  joinLobby,     // (code, playerName) => Promise<void>
  leaveLobby,
  kickGuest,
} = useLobby(onGuestJoin, onGuestLeave);
```

#### Nostr Signaling Events

| Kind | Name | Purpose |
|------|------|---------|
| 30430 | `LOBBY_HOST` | Host announces lobby with code |
| 30431 | `LOBBY_JOIN` | Guest requests to join |
| 30433 | `WEBRTC_OFFER` | Host sends WebRTC offer |
| 30434 | `WEBRTC_ANSWER` | Guest sends WebRTC answer |

Public relays used: `relay.damus.io`, `nos.lol`, `relay.nostr.band`, etc.

#### Connection Flow

```
┌─────────────┐      Nostr Relays      ┌─────────────┐
│    Host     │ ──── Lobby + Offer ──→ │    Guest    │
│  (Code:ABCD)│ ←───── Answer ──────── │             │
└──────┬──────┘                        └──────┬──────┘
       │                                      │
       └──────── WebRTC DataChannel ──────────┘
```

#### Lockstep Synchronization

All clients run identical deterministic simulation:

```typescript
// Only player inputs are transmitted, not game state
interface GameInput {
  tick: number;
  playerId: string;
  type: 'MOVE' | 'ATTACK' | 'BUILD' | 'ABILITY';
  data: GameCommandData;
}

// Every N ticks, broadcast checksum for desync detection
interface StateChecksum {
  tick: number;
  checksum: number;      // Primary state hash
  unitCount: number;
  buildingCount: number;
  resourceSum: number;
  unitPositionHash: number;
  healthSum: number;
}

// On checksum mismatch = desync detected
// DesyncDetectionManager provides debugging tools
```

#### NAT Traversal

```typescript
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
```

For symmetric NATs, the peer relay system (`PeerRelay.ts`) routes through other players with E2E encryption (ECDH + AES-GCM).

#### Alternative: Connection Codes (`src/engine/network/p2p/ConnectionCode.ts`)

For offline/manual connections, SDP offers can be encoded as shareable codes:

```typescript
// Format: VOID-XXXX-XXXX-XXXX-...
// Encodes: SDP + ICE candidates + metadata
// Compression: pako (zlib) + Crockford Base32
// Expiry: 5 minutes
```

## Rendering Pipeline

### WebGPU-First Architecture (Three.js r182 + TSL)

The game uses Three.js WebGPU Renderer with automatic WebGL fallback, powered by TSL (Three.js Shading Language) for cross-backend shader compatibility:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASER 4 OVERLAY LAYER                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Stylized 2D Effect Overlays (ability splashes)       │   │
│  │  • "Tactical View" toggle (strategic info layer)        │   │
│  │  • Screen-space particles (combat intensity sparks)     │   │
│  │  • Alert system ("Nuclear launch detected" animations)  │   │
│  │  • Damage vignettes, screen shake effects               │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     REACT HUD LAYER                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Command Card    │  │   Minimap    │  │  Resources/Info  │   │
│  │ (React + CSS)   │  │  (Phaser 4)  │  │   (React)        │   │
│  └─────────────────┘  └──────────────┘  └──────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                THREE.JS WEBGPU RENDERER                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • WebGPURenderer with automatic WebGL2 fallback        │   │
│  │  • TSL (Three.js Shading Language) for all shaders      │   │
│  │  • GPU-computed particle systems via TSL ParticleSystem │   │
│  │  • Node-based post-processing (bloom, SSAO, FXAA)       │   │
│  │  • Async rendering for non-blocking frame submission    │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                   THREE.JS 3D WORLD                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  • Isometric 3D Camera (~60° angle)                     │   │
│  │  • 3D Terrain with height maps                          │   │
│  │  • GLB Models (units, buildings) with animations        │   │
│  │  • Real-time shadows + lighting                         │   │
│  │  • 3D Particle systems (explosions, projectiles)        │   │
│  │  • Post-processing (bloom, ambient occlusion)           │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    ECS GAME ENGINE                              │
│               (Unchanged - drives both layers)                  │
└─────────────────────────────────────────────────────────────────┘
```

Key Components:
- `WebGPUGameCanvas.tsx` - Main game canvas (WebGPU with WebGL fallback)
- `OverlayScene.ts` - Phaser 4 scene for 2D effects overlay

### TSL Rendering Systems

Located in `src/rendering/tsl/`:

1. **WebGPURenderer.ts** - Renderer initialization and management
   - `createWebGPURenderer()` - Async renderer creation with fallback
   - Automatic WebGL2 fallback if WebGPU unavailable
   - Backend detection via `renderer.backend.isWebGLBackend`

2. **PostProcessing.ts** - TSL-based post-processing pipeline
   - Bloom effect with configurable strength/radius/threshold
   - Screen-space ambient occlusion (SSAO)
   - FXAA anti-aliasing
   - Vignette and color grading (exposure, saturation, contrast)
   - `RenderPipeline` class for unified effect management

3. **SelectionMaterial.ts** - TSL selection ring shaders
   - `createSelectionRingMaterial()` - Animated pulsing glow
   - Team-colored rings with shimmer animation
   - `createHealthBarMaterial()` - Health bar rendering
   - Uses `MeshBasicNodeMaterial` from `three/webgpu`

4. **ProceduralTerrainMaterial.ts** - TSL terrain shaders
   - Multi-layer procedural texturing (grass, dirt, rock, cliff)
   - fBM noise for height-based blending
   - Triplanar mapping for cliffs
   - Real-time normal generation

5. **TextureTerrainMaterial.ts** - Texture-based terrain
   - Multi-texture splatting with TSL
   - PBR material properties

6. **TerrainMaterial.ts** - Primary terrain material (WebGPU-compatible)
   - 4-layer terrain blending (grass, dirt, rock, cliff)
   - 12 textures total (3 per layer: diffuse, normal, roughness)
   - Dual-scale texture sampling to reduce tiling artifacts
   - Macro color variation across the map
   - **Note**: Displacement maps removed to stay under WebGPU's 16-texture limit

7. **SelectionMaterial.ts** - Unit selection visuals
   - Animated glowing selection rings
   - Team-colored rings with shimmer animation
   - Hover highlight indicators

### Selection System (`SelectionSystem.ts`)

Selection with multiple improvements:
- **Screen-space selection** - Box/click selection done in screen coordinates for perspective-accurate selection
- **Selection radius buffer** - Uses circle-rectangle intersection so partial overlaps count as selected
- **Visual height support** - Flying units can be selected at their visual position (8 units above ground)
- **Visual scale support** - Larger units (>300 HP) get 50% bigger hitboxes for easier selection
- **Iterative terrain convergence** - 6 iterations with early termination for accurate screen-to-world mapping
- **Priority-based selection** - Units are selected over buildings when both are in the selection box

### Battle Effects (`src/rendering/effects/`)

1. **AdvancedParticleSystem.ts** - GPU-instanced particle effects (main particle system)
   - Muzzle flashes, projectile trails
   - Explosion particles with debris
   - Impact sparks and energy effects
   - Death explosions with smoke
   - Up to 15000 particles via instanced mesh
   - TSL-based rendering with billboard sprites

2. **PostProcessing.ts** (`src/rendering/tsl/`) - Cinematic post-processing
   - HDR bloom for energy weapons and explosions
   - Subtle vignette for focus
   - Color grading and contrast
   - ACES tone mapping
   - GTAO, SSR, SSGI, Volumetric Fog
   - FXAA/TRAA anti-aliasing

4. **VehicleEffectsSystem.ts** - Continuous vehicle visual effects
   - Configuration-driven via assets.json (per-unit effect definitions)
   - State-aware emission (moving, idle, attacking, flying conditions)
   - LOD-aware (reduced/skipped effects beyond 120 units distance)
   - Effect types:
     - `engine_exhaust` - Fire particles for engines
     - `thruster` - Blue/energy thruster glow for flying units
     - `smoke_trail` - Trailing smoke behind vehicles
     - `dust_cloud` - Ground dust behind wheeled/tracked vehicles
     - `afterburner` - Intense engine fire effect
     - `hover_dust` - Dust from hovering/landing
     - `sparks` - Mechanical sparks
   - Attachment points for precise effect positioning relative to unit
   - Speed-scaled emission for dynamic effects
   - Integrates with AdvancedParticleSystem for GPU-instanced rendering

5. **tsl/TerrainMaterial.ts** - TSL terrain material (WebGPU + WebGL compatible)
   - 4-texture blending (grass, dirt, rock, cliff) with PBR support
   - Slope-based weight calculation from vertex attributes
   - RTS-style terrain type system (ground, ramp, unwalkable, platform)
   - Procedural platform material with beveled metal panels
   - Biome-aware texture loading (grassland, desert, frozen, volcanic, void, jungle)
   - Shared blend weight helper to avoid code duplication

6. **Terrain.ts** - Enhanced terrain geometry with THREE.Terrain-style algorithms
   - **256-level elevation system** (0-255, classic RTS-style height precision)
   - Proper Perlin noise with gradient interpolation
   - Fractal Brownian Motion (fBM) for multi-octave noise
   - Ridged multi-fractal noise for mountain ridges
   - Voronoi/Worley noise for cellular rock patterns
   - Turbulence noise for hard-edged features
   - Gaussian smoothing pass for natural transitions
   - Bilinear height interpolation for smooth unit movement
   - Per-biome configuration with distinct visual styles
   - **Terrain feature rendering** with color tints for water, forests, mud, roads
   - **Speed modifier queries** for movement system integration
   - **Vision blocking queries** for forest concealment

### Three.js Scene Graph

```
Scene
├── Terrain (mesh)
├── Units (instanced meshes)
│   ├── DominionMarines
│   ├── DominionTanks
│   └── ...
├── Buildings (individual meshes)
├── Effects (particles, projectiles)
├── Fog of War (shader overlay)
└── UI Elements (sprites, billboards)
```

### Camera System

RTS-style camera with constraints:

```typescript
class RTSCamera {
  // Position constraints
  minX, maxX: number;
  minZ, maxZ: number;

  // Zoom constraints
  minZoom = 10;
  maxZoom = 50;

  // Movement
  panSpeed = 20;
  edgeScrollSpeed = 15;
  edgeScrollThreshold = 20; // pixels from edge

  // Rotation
  rotationEnabled = true;
  rotationSpeed = 0.5;
}
```

## Data Flow

```
User Input
    ↓
InputManager (normalize input)
    ↓
Command Generator (create game commands)
    ↓
[Multiplayer: Broadcast to all clients]
    ↓
Command Processor (validate & queue)
    ↓
Game Loop (process commands at tick boundary)
    ↓
ECS Systems (update game state)
    ↓
Renderer (draw current state)
    ↓
HUD Update (React state sync)
```

## Asset System

### AssetManager

Centralized 3D asset management with procedural generation and GLTF loading. The system is fully **JSON-configurable** for easy forking as an RTS engine.

```typescript
// Get mesh for a unit (auto-loads from GLB if available)
const mesh = AssetManager.getUnitMesh('marine', playerColor);

// Get mesh for a building
const buildingMesh = AssetManager.getBuildingMesh('barracks', playerColor);

// Load custom GLTF model manually
await AssetManager.loadGLTF('/models/custom_unit.glb', 'custom_unit');

// Get animation mappings from JSON config
const mappings = AssetManager.getAnimationMappings('fabricator');
// Returns: { idle: ['idle', 'stand'], walk: ['walk', 'run'], ... }

// Get animation speed multiplier
const speed = AssetManager.getAnimationSpeed('fabricator'); // 0.4
```

### JSON Asset Configuration (`public/config/assets.json`)

All models and animation mappings are configured via a single JSON file, making the engine forkable without code changes:

```json
{
  "units": {
    "fabricator": {
      "model": "/models/units/fabricator.glb",
      "height": 1.0,
      "animationSpeed": 0.4,
      "animations": {
        "idle": ["idle", "stand", "pose"],
        "walk": ["walk", "run", "move", "locomotion"],
        "attack": ["attack", "shoot", "fire"],
        "death": ["death", "die"]
      }
    },
    "trooper": {
      "model": "/models/units/trooper.glb",
      "height": 1.2,
      "animations": {
        "idle": ["idle", "stand"],
        "walk": ["walk", "run"],
        "attack": ["attack", "shoot"],
        "death": ["death"]
      }
    },
    "valkyrie": {
      "model": "/models/units/valkyrie.glb",
      "height": 1.8,
      "airborneHeight": 6,
      "animations": {
        "idle": ["idle", "hover"],
        "walk": ["walk", "fly", "move"],
        "attack": ["attack", "missiles"],
        "death": ["death", "crash"]
      }
    }
  },
  "buildings": { ... },
  "resources": { ... },
  "decorations": { ... }
}
```

**Key Configuration Options:**

| Field | Description |
|-------|-------------|
| `model` | Path to GLB file relative to `public/` |
| `height` | Target height in game units - models are scaled so their bounding box height matches this value |
| `scale` | Optional scale multiplier applied after height normalization (default: 1.0) |
| `airborneHeight` | For flying units: height above terrain in game units (default: 8) |
| `animationSpeed` | Playback speed multiplier (default: 1.0) |
| `rotation` | Y-axis rotation offset in degrees to fix model facing direction |
| `animations` | Map of game actions to animation clip names |

**Model Sizing vs Flight Altitude:**

The system separates visual size from flight altitude:
- `height` controls how big the model appears (scales the model's bounding box to this height)
- `airborneHeight` controls how high flying units hover above terrain (doesn't affect size)

Example: A dreadnought might have `"height": 45.0` (massive ship) and `"airborneHeight": 15` (flies high).

**Animation Mapping Priority:**

1. **JSON config** - Explicit mappings from `assets.json` (first matching name wins)
2. **Exact match** - Animation clip name matches exactly
3. **Partial match** - Animation clip name contains the search term
4. **Fallback** - Uses `idle` animation if walk/attack not found

**Example: Custom Animation Names**

If your GLB has animations named `"CustomWalk_v2"` and `"MyIdleAnim"`:

```json
"animations": {
  "idle": ["MyIdleAnim", "idle", "stand"],
  "walk": ["CustomWalk_v2", "walk", "run"]
}
```

The system will find `"MyIdleAnim"` for idle and `"CustomWalk_v2"` for walk because they match the first entry in each array.

### Procedural Generator

Built-in procedural mesh generation for all unit types (fallback when GLB not found):

- **Units**: Fabricator, Trooper, Breacher, Devastator, Valkyrie, etc.
- **Buildings**: Headquarters, Supply Cache, Infantry Bay, Forge, etc.
- **Resources**: Mineral patches, Vespene geysers
- **Decorations**: Trees, rocks, grass

Each procedural mesh:
- Applies player team colors dynamically
- Casts and receives shadows
- Uses optimized geometry

### Custom Asset Pipeline

To add custom 3D models:

1. Export from Blender/Maya as GLTF/GLB with embedded animations
2. Place in `public/models/{category}/{name}.glb`
3. Add entry to `public/config/assets.json`:
   ```json
   "my_unit": {
     "model": "/models/units/my_unit.glb",
     "height": 1.5,
     "animations": {
       "idle": ["my_idle_anim"],
       "walk": ["my_walk_cycle"],
       "attack": ["my_attack"]
     }
   }
   ```
4. The system automatically loads and maps animations on startup

### Animation System

Animations are loaded from GLB files and mapped to game actions:

| Game Action | Used When | Fallback |
|-------------|-----------|----------|
| `idle` | Unit stationary | First non-death animation |
| `walk` | Unit moving | `idle` |
| `attack` | Unit attacking (and stationary) | `idle` |
| `death` | Unit dying | None |

**Blender Export Tips:**
- Name animations clearly (e.g., `idle`, `walk`, `attack`)
- The system strips `Armature|` prefixes automatically
- Use lowercase names for best matching

## Performance Considerations

1. **Instanced Rendering**: All units of same type use instanced meshes
2. **Spatial Hashing**: O(1) lookups for nearby entities
3. **WASM Pathfinding**: Recast Navigation runs near-native via WebAssembly
4. **WASM SIMD Boids**: f32x4 vector operations for 4x throughput on boids forces (see below)
5. **Object Pooling**: Reuse entities, projectiles, particles
6. **LOD System**: Reduce detail at distance
7. **Frustum Culling**: Don't render off-screen entities
8. **Delta Compression**: Only send changed state in multiplayer
9. **Asset Caching**: Meshes cached and cloned for reuse
10. **WebGPU Texture Limit**: Fragment shaders limited to 16 sampled textures per stage
    - `MeshStandardNodeMaterial` uses 1 internal texture for environment/IBL
    - Terrain materials limited to 12 textures (4 layers × 3 maps each)
    - Displacement maps removed to stay under limit

### WASM SIMD Boids Acceleration

High-performance boids computation using WebAssembly SIMD (f32x4):

```
wasm/boids/                     # Rust WASM crate
├── Cargo.toml                  # Crate config with wasm-bindgen
└── src/
    ├── lib.rs                  # WASM exports (BoidsEngine class)
    ├── simd.rs                 # f32x4 SIMD operations
    └── soa.rs                  # SoA memory layout

src/engine/wasm/
└── WasmBoids.ts               # TypeScript wrapper with JS fallback

.github/workflows/
└── build-wasm.yml             # GitHub Actions WASM build pipeline
```

**Architecture:**
- **SoA Layout**: Positions, velocities stored in contiguous arrays for cache-friendly SIMD access
- **f32x4 Operations**: 4 units processed per SIMD instruction (separation, cohesion, alignment)
- **Batch Processing**: Forces computed for all units in single WASM call
- **Zero-Copy**: JS gets TypedArray views into WASM linear memory
- **Graceful Fallback**: Auto-uses JS when SIMD unavailable or <20 units

**Build Pipeline:**
- GitHub Actions builds WASM on push to `wasm/boids/**`
- Pre-built WASM committed to `public/wasm/` for Vercel
- Local build: `./scripts/build-wasm.sh` (requires Rust + wasm-pack)

### High-Performance SpatialGrid

Optimized spatial partitioning for 500+ unit battles:

```typescript
// Flat array storage for O(1) direct cell access
private readonly fineCells: Int32Array;
private readonly fineCellCounts: Uint8Array;

// Hierarchical grid: fine (8x8) + coarse (32x32) cells
// Small radius queries use fine grid, large queries use coarse

// Inline entity data eliminates entity lookups in hot paths
interface SpatialEntityData {
  id: number;
  x: number; y: number; radius: number;
  isFlying: boolean;
  state: SpatialUnitState;  // Enum for fast comparison
  playerId: number;         // Numeric ID for fast comparison
  collisionRadius: number;
  isWorker: boolean;
  maxSpeed: number;
}

// Query with inline data - no entity.get() calls needed
const neighbors = unitGrid.queryRadiusWithData(x, y, radius);
for (const n of neighbors) {
  // Use n.isFlying, n.state directly - no entity lookup!
}
```

**Key Optimizations:**
- **Flat Array Cells**: `Int32Array` instead of `Map<number, Set>` for direct indexing
- **Hierarchical Grid**: Fine (8x8) + coarse (32x32) cells for multi-scale queries
- **Inline Entity Data**: Position, state, player ID stored in grid to avoid lookups
- **Pre-allocated Buffers**: Reusable query result arrays eliminate GC pressure
- **Hot Cell Detection**: `getHotCells()` marks cells with multi-player units for combat zone optimization
- **Fast Enemy Detection**: `hasEnemyInRadius()` with inline data for O(nearby) combat checks

### MovementSystem Architecture

The MovementSystem has been refactored into modular subsystems for maintainability:

```
MovementSystem.ts (thin wrapper)
  └── MovementOrchestrator (main coordinator)
        ├── FlockingBehavior      # Boids steering forces
        ├── PathfindingMovement   # A-star, crowd, building avoidance
        └── FormationMovement     # Magic box, group formations
```

**Module Responsibilities:**

| Module | Responsibility |
|--------|----------------|
| **FlockingBehavior** | Separation, cohesion, alignment, physics push, velocity smoothing, stuck detection |
| **PathfindingMovement** | Crowd agent management, path requests, building avoidance (3-tier), terrain speed modifiers |
| **FormationMovement** | Magic box detection, group formations, move command handling |
| **MovementOrchestrator** | Main update loop, spatial grid updates, WASM boids integration, attack-move/patrol |

**Key Design Decisions:**
- **Separation cache re-enabled**: Now that code is isolated, the separation force cache is re-enabled for performance
- **Deterministic behavior preserved**: All modules maintain determinism for multiplayer sync
- **Per-frame entity cache**: Component lookups cached for alignment force calculations

### MovementSystem Optimizations

Performance enhancements for large-scale battles:

```typescript
// Dirty-flag spatial updates - only update grid when position changed
const GRID_UPDATE_THRESHOLD_SQ = 0.25; // 0.5 unit movement
if (distSq > this.GRID_UPDATE_THRESHOLD_SQ) {
  unitGrid.updateFull(id, x, y, radius, isFlying, state, playerId, ...);
  this.gridDirtyEntities.add(id);
} else {
  unitGrid.updateState(id, state); // Fast path - no spatial update
}

// Frame entity cache - avoid repeated lookups
this.frameEntityCache.set(entity.id, { transform, unit, velocity });

// Steering forces use inline SpatialGrid data
const nearbyData = unitGrid.queryRadiusWithData(x, y, radius);
for (const other of nearbyData) {
  if (other.state === SpatialUnitState.Dead) continue;
  if (other.isFlying !== selfUnit.isFlying) continue;
  // No entity.get() calls!
}
```

**Key Optimizations:**
- **Dirty-Flag Updates**: Only update grid when unit moves > 0.5 units
- **Single Pass**: Merged spatial grid update + entity caching in one loop
- **Inline Data Steering**: Separation, cohesion, physics push use grid data directly
- **Frame Entity Cache**: Cache component references to avoid repeated lookups

### CombatSystem Optimizations

Efficient target acquisition for large battles:

```typescript
// Combat-active entity list - only process units near enemies
private combatActiveUnits: Set<number>;

// Hot cell tracking from SpatialGrid
private hotCells: Set<number>;
if (unitGrid.isInHotCell(x, y, hotCells)) {
  // Unit is near enemies - process target acquisition
}

// Fast combat zone check with inline data
const hasEnemy = unitGrid.hasEnemyInRadius(x, y, sightRange, myPlayerId);

// Priority queue for attack cooldowns (min-heap)
private attackReadyQueue: Array<{ entityId: number; nextAttackTime: number }>;
while (this.heapPeek().nextAttackTime <= gameTime) {
  const ready = this.heapPop();
  // Process attack for ready unit
}
```

**Key Optimizations:**
- **Combat-Active List**: Only iterate units in combat zones, not all 500
- **Hot Cell Detection**: Skip target acquisition for units in "cold" cells
- **hasEnemyInRadius()**: O(nearby) enemy detection with inline data
- **Attack Cooldown Queue**: Min-heap for O(log n) attack scheduling

## RTS Features

### Unit Movement System

Enhanced movement with classic RTS responsiveness:

```typescript
// Unit acceleration/deceleration
unit.maxSpeed = definition.speed;
unit.currentSpeed = 0; // Starts at 0
unit.acceleration = 15; // Units/sec²

// Boids-like separation for unit avoidance
const SEPARATION_RADIUS = 2.0;
const SEPARATION_STRENGTH = 8.0;
calculateSeparationForce(self, others);
```

Features:
- **Smooth acceleration**: Units ramp up to max speed naturally
- **Separation steering**: Units avoid overlapping via boids algorithm
- **Command queuing**: Shift-click to queue move/attack/patrol/gather commands
- **Patrol**: P key sets patrol between current position and target
- **Visual waypoints**: Green lines and markers show queued command paths

### Command Queue System

RTS-style shift-click command chaining with visual feedback:

```typescript
// Supported queued command types
type QueuedCommand = {
  type: 'move' | 'attack' | 'attackmove' | 'patrol' | 'gather';
  targetX?: number;
  targetY?: number;
  targetEntityId?: number;
};

// Unit.ts - command queue execution
unit.commandQueue: QueuedCommand[];
unit.queueCommand(cmd);      // Add to queue (shift-click)
unit.executeNextCommand();   // Called when current action completes
```

Visual feedback via `CommandQueueRenderer.ts`:
- Green waypoint markers at each queued destination
- Green lines connecting unit position → current target → queued waypoints
- Only shown for selected units owned by the player

### Camera Hotkey System

```typescript
// Save camera location (Ctrl+F5-F8)
camera.saveLocation('F5');

// Recall camera location (F5-F8)
camera.recallLocation('F5');

// Double-tap control group to center camera
if (doubleTapDetected) {
  camera.setPosition(avgX, avgY);
}
```

### Smart Combat System

Priority-based target selection:

```typescript
const TARGET_PRIORITY = {
  devastator: 100,    // High-value targets first
  dreadnought: 95,
  trooper: 50,
  fabricator: 10,     // Workers last
};

// Area of effect damage
if (unit.splashRadius > 0) {
  applySplashDamage(target, damage, splashRadius);
}
```

### Idle Worker Button

UI component + F1 hotkey for fast worker management:

```typescript
// IdleWorkerButton.tsx
const idleWorkers = workers.filter(
  w => w.unit.isWorker && w.unit.state === 'idle'
);

// On click: select and center camera on idle worker
selectUnits([worker.id]);
camera.setPosition(worker.x, worker.y);
```

### Building Dependencies

Tech tree validation in BuildingPlacementSystem:

```typescript
// Check all required buildings exist and are complete
private checkBuildingDependencies(requirements: string[], playerId: string) {
  for (const reqBuildingId of requirements) {
    const found = playerBuildings.some(b =>
      b.buildingId === reqBuildingId && b.isComplete()
    );
    if (!found) return def?.name; // Return missing requirement
  }
  return null; // All requirements met
}
```

## Terrain Feature System

### MapTypes.ts - Terrain Data Structures

```typescript
// 256-level elevation
type Elevation = number; // 0-255

// Gameplay elevation zones
function elevationToZone(elevation: Elevation): 'low' | 'mid' | 'high';

// Terrain features overlay terrain types
type TerrainFeature =
  | 'none'           // Normal terrain
  | 'water_shallow'  // 0.6x speed, unbuildable
  | 'water_deep'     // Impassable
  | 'forest_light'   // 0.85x speed, partial vision
  | 'forest_dense'   // 0.5x speed, blocks vision
  | 'mud'            // 0.4x speed
  | 'road'           // 1.25x speed
  | 'void'           // Impassable
  | 'cliff';         // Impassable, blocks vision

// Feature configuration
interface TerrainFeatureConfig {
  walkable: boolean;
  buildable: boolean;
  speedModifier: number;
  blocksVision: boolean;
  partialVision: boolean;
  flyingIgnores: boolean;
}
```

### Map Helper Functions

```typescript
// Forest corridors with clear paths
createForestCorridor(grid, x1, y1, x2, y2, width, pathWidth, denseEdges);

// Rivers with optional bridge crossings
createRiver(grid, x1, y1, x2, y2, width, bridgePosition, bridgeWidth);

// Circular lakes with shallow edges
createLake(grid, centerX, centerY, radius, shallowEdgeWidth);

// Impassable void areas
createVoidChasm(grid, x, y, width, height, edgeWidth);

// Fast movement roads
createRoad(grid, x1, y1, x2, y2, width);

// Mud/swamp areas
createMudArea(grid, centerX, centerY, radius);

// Procedural forest scattering
scatterForests(grid, mapWidth, mapHeight, count, minRadius, maxRadius, exclusionZones, seed, denseChance);
```

### Pathfinding Integration (AStar.ts)

```typescript
// Movement costs per cell
interface PathNode {
  moveCost: number;  // 1.0 = normal, <1 = faster (road), >1 = slower (mud/forest)
}

// Cost calculation
const terrainCost = baseCost * neighbor.moveCost;
```

### Movement System Integration

```typescript
// Speed modifiers applied in MovementSystem
const terrainSpeedMod = getTerrainSpeedModifier(x, y, isFlying);
targetSpeed *= terrainSpeedMod;
```

## Map System Architecture

### Overview

The map system uses **JSON files as the primary source of truth** for map definitions. Maps are stored in `src/data/maps/json/*.json` and loaded at build time for bundling. The Map Editor provides visual editing with JSON export for easy iteration.

### Directory Structure

```
src/data/maps/
├── MapTypes.ts              # Core types (MapData, MapCell, etc.)
├── index.ts                 # Public API exports
├── loader.ts                # Runtime map loading utilities
├── json/                    # JSON map files (PRIMARY SOURCE)
│   ├── index.ts             # Imports and converts all JSON to MapData
│   ├── crystal_caverns.json
│   ├── void_assault.json
│   ├── scorched_basin.json
│   ├── contested_frontier.json
│   ├── titans_colosseum.json
│   └── battle_arena.json
├── schema/                  # JSON schema types
│   └── MapJsonSchema.ts     # TypeScript interfaces for JSON format
├── serialization/           # Convert between formats
│   ├── serialize.ts         # MapData → JSON
│   └── deserialize.ts       # JSON → MapData
└── core/                    # Map generation utilities (legacy)
    ├── ElevationMap.ts          # Paint command types & helpers
    ├── ElevationMapGenerator.ts # Generates MapData from MapBlueprint
    ├── ConnectivityGraph.ts     # Graph types for walkability analysis
    ├── ConnectivityAnalyzer.ts  # Analyzes maps for connectivity
    ├── ConnectivityValidator.ts # Reports connectivity issues
    ├── ConnectivityFixer.ts     # Auto-fixes ramps and connections
    ├── MapScaffolder.ts         # Auto-generate maps from base positions
    └── index.ts                 # Public API exports
```

### JSON Map Format

Maps use a compact JSON format with compressed terrain data:

```json
{
  "id": "crystal_caverns",
  "name": "Crystal Caverns",
  "author": "VOIDSTRIKE Team",
  "width": 200,
  "height": 180,
  "biome": "frozen",
  "playerCount": 2,
  "maxPlayers": 2,
  "isRanked": true,

  "terrain": {
    "elevation": [140, 140, ...],         // Flat array (row-major)
    "types": "gggggguuuurrrrgggg...",     // Single char per cell
    "features": [                          // Sparse (only non-'none')
      { "x": 50, "y": 30, "f": "water_deep" }
    ]
  },

  "spawns": [...],
  "expansions": [...],
  "watchTowers": [...],
  "ramps": [...],
  "destructibles": [...],
  "decorations": [...]
}
```

**Terrain type characters:** g=ground, u=unwalkable, r=ramp, b=unbuildable, c=creep

### Adding a New Map

1. Create a new JSON file in `src/data/maps/json/my_map.json`
2. Add the import to `src/data/maps/json/index.ts`:
   ```typescript
   import myMapJson from './my_map.json';
   export const MY_MAP = jsonToMapData(myMapJson as MapJson);
   ```
3. Add to `ALL_MAPS` and `MAPS_BY_PLAYER_COUNT` in the same file

### Editor Export Workflow

The Map Editor exports maps as JSON for easy iteration:

1. Open editor: `/game/setup/editor?map=crystal_caverns`
2. Make visual changes (paint terrain, move bases)
3. Click **Export** → **Copy to Clipboard**
4. Paste into `src/data/maps/json/crystal_caverns.json`
5. Commit and push

### Legacy: Code-Defined Maps (MapBlueprint)

The `core/` directory still contains utilities for defining maps programmatically using paint commands. This can be used to generate initial maps that are then exported to JSON:

```typescript
import { generateMap, plateau, ramp, water, mainBase } from '@/data/maps/core';

const MY_MAP = generateMap({
  meta: { id: 'my_map', name: 'My Map', author: 'Me' },
  canvas: { width: 200, height: 200, biome: 'grassland', baseElevation: 128 },

  // Paint commands execute in order
  paint: [
    // Create high-ground main bases
    plateau({ x: 40, y: 100 }, 25, 200),   // Player 1 main
    plateau({ x: 160, y: 100 }, 25, 200),  // Player 2 main

    // Create ramps connecting to mid-ground
    ramp({ x: 40, y: 100 }, { x: 60, y: 100 }, 8),
    ramp({ x: 160, y: 100 }, { x: 140, y: 100 }, 8),

    // Add water features
    water({ x: 100, y: 50 }, 15, 'deep'),
  ],

  // Base locations with resources
  bases: [
    mainBase({ x: 40, y: 100 }, 1),
    mainBase({ x: 160, y: 100 }, 2),
  ],
});
```

**Available paint commands:**
- `fill(elevation)` - Fill entire map
- `plateau(center, radius, elevation)` - Circular elevated area
- `rect(x, y, width, height, elevation)` - Rectangular area
- `ramp(from, to, width)` - Walkable connection between elevations
- `water(center, radius, 'shallow'|'deep')` - Water features
- `forest(center, radius, 'light'|'dense')` - Forests
- `voidArea(center, radius)` - Impassable void
- `road(from, to, width)` - Speed-boosting roads
- `mud(center, radius)` - Slow terrain

#### Approach 2: 3D Map Editor (Hand-Painted)

The editor (`src/editor/`) allows direct terrain painting:

```typescript
// Editor uses EditorMapData format
interface EditorMapData {
  id: string;
  name: string;
  width: number;
  height: number;
  terrain: EditorCell[][];  // Per-cell elevation, feature, walkability
  objects: EditorObject[];  // Bases, towers, destructibles
  biomeId: string;
  metadata: { author, description, playerCount };
}

// TerrainBrush tools
brush.paintElevation(x, y, radius, elevation, walkable);
brush.paintFeature(x, y, radius, 'forest_light');
brush.raiseElevation(x, y, radius, amount);
brush.lowerElevation(x, y, radius, amount);
brush.smoothTerrain(x, y, radius);
brush.flattenTerrain(x, y, radius);
```

### Connectivity Validation Layer

**Both approaches** use connectivity validation to ensure maps are playable:

```typescript
// 1. Analyze connectivity from painted terrain
import { analyzeConnectivity, validateConnectivity, autoFixConnectivity } from '@/data/maps/core';

const analysis = analyzeConnectivity(mapData);
// Returns: ConnectivityGraph with nodes for bases and edges for paths

// 2. Validate that all bases are connected
const result = validateConnectivity(analysis.graph);
if (!result.valid) {
  console.log(formatValidationResult(result));
  // Output:
  // ✗ [BASES_NOT_CONNECTED] Main base "p1_main" cannot reach "p2_main"
  //   → Add a ramp or ground connection between these bases
}

// 3. Auto-fix issues by adding ramps
const fixed = autoFixConnectivity(mapData, analysis);
console.log(formatFixResult(fixed));
// Output: Added 2 ramps to connect isolated regions
```

### How Cliffs Work

Cliffs emerge automatically from elevation differences:

```typescript
// CLIFF_THRESHOLD = 30 elevation units
// If neighboring cells differ by > 30, a cliff forms

// Example:
// Cell A: elevation 200 (high ground)
// Cell B: elevation 128 (mid ground)
// Difference: 72 > 30 → CLIFF (unwalkable)

// Ramps explicitly mark cells as walkable despite elevation change
```

### NavMesh Integration

The terrain generates walkable geometry for Recast NavMesh:

```typescript
// Permissive NavMesh config - let geometry decide walkability
const NAVMESH_CONFIG = {
  cs: 0.5,
  ch: 0.3,
  walkableSlopeAngle: 85,  // Very permissive
  walkableClimb: 5.0,      // High climb for steep ramps
  walkableRadius: 0.6,
};

// Cliffs are blocked by NOT including them in walkable geometry
// Ramps ARE included because they're explicitly marked walkable
```

### Map Scaffolder (Auto-Generation)

For quick map creation, use the scaffolder:

```typescript
import { scaffoldMap, scaffold1v1Diagonal, addTerrain } from '@/data/maps/core';

// Generate a standard 1v1 map layout
const scaffold = scaffold1v1Diagonal({
  width: 200,
  height: 200,
  biome: 'volcanic',
});

// Add custom terrain features
addTerrain(scaffold, [
  water({ x: 100, y: 100 }, 20, 'deep'),
  forest({ x: 50, y: 150 }, 15, 'dense'),
]);

// Generate final MapData
const mapData = scaffoldMap(scaffold);
```

### Editor ↔ Game Format Conversion

The editor provider handles format conversion:

```typescript
// voidstrike.ts provider
const provider: EditorDataProvider = {
  // Load game map into editor format
  async loadMap(id: string): Promise<EditorMapData> {
    const map = ALL_MAPS[id];
    return mapDataToEditorFormat(map);
  },

  // Export editor map to game format
  exportForGame(data: EditorMapData): MapData {
    return editorFormatToMapData(data);
  },

  // Validate using connectivity system
  async validateMap(data: EditorMapData): Promise<ValidationResult> {
    const mapData = editorFormatToMapData(data);
    const analysis = analyzeConnectivity(mapData);
    return validateConnectivity(analysis.graph);
  },
};
```

### Key Insight: Connectivity Matters

The critical insight preserved from the original architecture:

> **Walkability must be explicitly validated, not inferred from geometry.**

Whether you paint terrain by hand or define it in code, the connectivity validation layer ensures:
1. All player bases can reach each other
2. Ramps exist where needed between elevation levels
3. No isolated regions exist that would trap units

This solves the classic RTS problem where slight terrain misalignment causes pathfinding failures.

## 3D Map Editor

### Overview

The map editor (`src/editor/`) provides a visual interface for creating and editing maps. It uses a generic editor framework with game-specific data providers.

### Architecture

```
editor/
├── core/                    # Editor UI (React components)
│   ├── EditorCore.tsx       # Main editor container
│   ├── Editor3DCanvas.tsx   # Three.js canvas wrapper
│   ├── EditorHeader.tsx     # Title bar, file menu
│   ├── EditorToolbar.tsx    # Tool selection
│   └── EditorPanels.tsx     # Side panels (properties, layers)
├── config/
│   └── EditorConfig.ts      # Type definitions for editor data
├── hooks/
│   └── useEditorState.ts    # Zustand store for editor state
├── providers/
│   └── voidstrike.ts        # VOIDSTRIKE-specific data provider
├── rendering3d/             # Three.js rendering
│   ├── EditorTerrain.ts     # 3D terrain mesh from EditorMapData
│   ├── EditorGrid.ts        # Grid overlay
│   ├── EditorBrushPreview.ts # Brush cursor preview
│   └── EditorObjects.ts     # Base/tower/destructible rendering
└── tools/                   # Editing tools
    ├── TerrainBrush.ts      # Elevation/feature painting
    └── ObjectPlacer.ts      # Object placement tool
```

### Editor State (`useEditorState.ts`)

```typescript
interface EditorState {
  // Current map being edited
  mapData: EditorMapData | null;
  isDirty: boolean;

  // Active tool and settings
  activeTool: 'select' | 'elevation' | 'feature' | 'object';
  brushRadius: number;
  brushElevation: number;
  selectedFeature: string;
  selectedObject: string;

  // Selection
  selectedCells: Array<{ x: number; y: number }>;
  selectedObjects: string[];

  // Actions
  loadMap: (id: string) => Promise<void>;
  saveMap: () => Promise<void>;
  createMap: (width, height, name) => void;
  applyBrush: (x, y) => void;
  undo: () => void;
  redo: () => void;
}
```

### EditorTerrain Rendering

The 3D terrain renders `EditorMapData` as a mesh with real-time updates:

```typescript
class EditorTerrain {
  // Load map and build initial geometry
  loadMap(mapData: EditorMapData): void;

  // Efficient partial updates via dirty chunks
  markCellsDirty(cells: Array<{ x, y }>): void;
  updateDirtyChunks(): void;

  // Height queries for tools
  getHeightAt(x: number, z: number): number;
  worldToGrid(x: number, z: number): { x, y } | null;

  // Biome switching
  setBiome(biomeId: string): void;
}
```

Features:
- **Chunked updates** - Only rebuild geometry for modified regions
- **Vertex colors** - Per-cell coloring based on elevation, feature, biome
- **Heightmap** - Stored for accurate brush positioning
- **Biome themes** - 6 visual themes (grassland, desert, frozen, volcanic, void, jungle)

### TerrainBrush Tools

```typescript
class TerrainBrush {
  // Set elevation directly
  paintElevation(x, y, radius, elevation, walkable): CellUpdate[];

  // Paint terrain features
  paintFeature(x, y, radius, feature): CellUpdate[];

  // Sculpting tools
  raiseElevation(x, y, radius, amount): CellUpdate[];
  lowerElevation(x, y, radius, amount): CellUpdate[];
  smoothTerrain(x, y, radius): CellUpdate[];
  flattenTerrain(x, y, radius, targetElevation?): CellUpdate[];

  // Special operations
  createPlateau(x, y, radius, elevation, walkable): CellUpdate[];
  floodFill(startX, startY, targetElevation, newElevation): CellUpdate[];
  erase(x, y, radius): CellUpdate[];
}
```

### Data Provider Pattern

The editor is decoupled from game-specific data via providers:

```typescript
interface EditorDataProvider {
  // Map management
  getMapList(): Promise<Array<{ id, name, thumbnail }>>;
  loadMap(id: string): Promise<EditorMapData>;
  saveMap(data: EditorMapData): Promise<void>;
  createMap(width, height, name): EditorMapData;

  // Validation (uses connectivity system)
  validateMap(data: EditorMapData): Promise<ValidationResult>;

  // Export to game format
  exportForGame(data: EditorMapData): MapData;
}

// VOIDSTRIKE implementation
const voidstrikeDataProvider: EditorDataProvider = {
  async loadMap(id) {
    const map = ALL_MAPS[id];
    return mapDataToEditorFormat(map);
  },
  exportForGame(data) {
    return editorFormatToMapData(data);
  },
  // ...
};
```

### Editor URL

Access the editor at `/game/setup/editor`:

```typescript
// src/app/game/setup/editor/page.tsx
export default function EditorPage() {
  return <EditorCore config={voidstrikeEditorConfig} />;
}
```

## Biome & Environment System

### Biome Configuration (`src/rendering/Biomes.ts`)

6 distinct biomes with unique visual characteristics:

| Biome | Colors | Features | Particles |
|-------|--------|----------|-----------|
| Grassland | Greens, browns | Trees, grass, water | None |
| Desert | Tans, oranges | Cacti, rocks, oases | Dust |
| Frozen | Whites, blues | Dead trees, ice crystals, frozen lakes | Snow |
| Volcanic | Blacks, reds | Charred stumps, lava rivers | Ash |
| Void | Purples, blacks | Alien trees, crystals, energy pools | Spores |
| Jungle | Dark greens | Dense trees, grass, murky water | Spores |

Each biome defines:
- Ground/cliff/ramp color palettes
- PBR material properties (roughness, metalness)
- Decoration densities (trees, rocks, grass, crystals)
- Water/lava settings
- Fog and lighting colors

### Environment Manager (`src/rendering/EnvironmentManager.ts`)

Unified system that creates and manages:

```typescript
const environment = new EnvironmentManager(scene, mapData);

// Creates:
// - Terrain mesh with biome colors
// - Lighting (ambient, directional, fill)
// - Sky and fog
// - Enhanced trees (biome-specific types)
// - Rock formations
// - Instanced grass (GPU instancing)
// - Ground debris
// - Crystal fields
// - Water/lava planes
// - Particle systems

// Update animated elements
environment.update(deltaTime, gameTime);
```

### Ground Detail (`src/rendering/GroundDetail.ts`)

- **InstancedGrass**: Up to 50,000 grass blades via THREE.InstancedMesh
- **GroundDebris**: Pebbles and sticks scattered on terrain
- **CrystalField**: Glowing crystal clusters for frozen/void biomes
- **WaterPlane**: Animated shader with wave simulation
- **MapBorderFog**: Dark smoky fog around map edges, animated shader with multi-octave simplex noise for organic smoke movement

### Game Overlay Manager (`src/rendering/GameOverlayManager.ts`)

Strategic information overlays for tactical awareness:

```typescript
// Overlay types
type GameOverlayType = 'none' | 'terrain' | 'elevation' | 'threat';

// Usage
const overlayManager = new GameOverlayManager(scene, mapData, getHeightFn);
overlayManager.setWorld(game.world);
overlayManager.setActiveOverlay('terrain');
overlayManager.update(deltaTime);
```

**Terrain Overlay** - Color-coded walkability and speed:
- Green: Normal walkable terrain
- Cyan: Roads (1.25x speed boost)
- Yellow: Ramps, light forest (0.85x speed)
- Orange: Slow terrain (mud, shallow water, 0.4-0.6x speed)
- Red: Impassable (deep water, void, cliffs)

**Elevation Overlay** - Height zone visualization:
- Blue: Low ground (elevation 0-85)
- Yellow: Mid ground (elevation 86-170)
- Red: High ground (elevation 171-255)
- Gradient coloring within each zone

**Threat Range Overlay** - Enemy attack coverage:
- Red zones show areas within enemy attack range
- Pulsing shader effect for visibility
- Updates dynamically as enemies move
- Considers both units and buildings with attack capability

UI Integration:
- Options menu "Overlays" submenu with toggle buttons
- Keyboard shortcut: 'O' to cycle through overlays
- Per-overlay opacity settings in uiStore

### Enhanced Decorations (`src/rendering/EnhancedDecorations.ts`)

- **EnhancedTrees**: 6 tree types (pine, oak, dead, cactus, palm, alien)
- **EnhancedRocks**: Procedural rock formations with surrounding debris
- **EnvironmentParticles**: Snow, dust, ash, spores with physics

## Phase 1-3 Systems

### Unit Mechanics System (`UnitMechanicsSystem.ts`)

Handles advanced unit behaviors:

```typescript
// Transform system (Siege Tank, Hellion, Viking)
handleTransformCommand(entityIds, targetMode);
updateTransforming(entity, unit, deltaTime);

// Cloak system (Ghost, Banshee)
handleCloakCommand(entityIds);
updateCloakedUnits(deltaTime); // Energy drain

// Transport system (Medivac)
handleLoadCommand(transportId, unitIds);
handleUnloadCommand(transportId, position, unitId);

// Bunker system
handleBunkerLoad(bunkerId, unitIds);
handleBunkerUnload(bunkerId, unitId);
processBunkerAttacks(bunker, deltaTime);

// Healing & Repair
handleHealCommand(healerId, targetId); // Medivac
handleRepairCommand(repairerId, targetId); // SCV
```

### Building Mechanics System (`BuildingMechanicsSystem.ts`)

Handles building-specific behaviors:

```typescript
// Lift-off/Landing (Barracks, Factory, Starport, CC)
handleLiftOffCommand(entityIds);
handleLandCommand(entityIds, positions);

// Addon management (Tech Lab, Reactor)
handleBuildAddonCommand(buildingId, addonType);
canProduceUnit(building, unitType); // Tech Lab check
canDoubleProduceUnit(building, unitType); // Reactor check

// Supply Depot lowering
handleLowerCommand(entityIds);

// Building attacks (Turrets, Planetary Fortress)
processBuildingAttacks(building, deltaTime);
```

### Wall/Fortification System

Comprehensive wall building system with line placement and gate mechanics.

#### Wall Component (`Wall.ts`)

```typescript
// Wall connection types for visual mesh selection
type WallConnectionType = 'none' | 'horizontal' | 'vertical' |
  'corner_ne' | 'corner_nw' | 'corner_se' | 'corner_sw' |
  't_north' | 't_south' | 't_east' | 't_west' | 'cross';

// Gate states
type GateState = 'closed' | 'open' | 'auto' | 'locked';

// Wall upgrades
type WallUpgradeType = 'reinforced' | 'shielded' | 'weapon' | 'repair_drone';

class Wall extends Component {
  connectionType: WallConnectionType;
  neighborNorth/South/East/West: number | null;

  // Gate mechanics
  isGate: boolean;
  gateState: GateState;
  gateOpenProgress: number; // 0 = closed, 1 = open

  // Turret mounting
  mountedTurretId: number | null;
  canMountTurret: boolean;

  // Upgrades
  appliedUpgrade: WallUpgradeType | null;
  shield: number; // For shielded walls
  hasRepairDrone: boolean;
}
```

#### WallSystem (`WallSystem.ts`)

```typescript
// Auto-connecting walls to neighbors
handleWallPlaced(entityId, position);
updateWallConnections(entity, wall, transform);

// Gate state machine
updateGateProximity(gateEntity, wall); // Auto-open for friendlies
wall.updateGate(deltaTime);            // Animate open/close

// Wall upgrades
handleWallUpgrade(entityIds, upgradeType, playerId);
applyWallUpgradeEffects(entity, wall, building, health);

// Shield regeneration
wall.updateShield(deltaTime);

// Repair drone healing adjacent walls
updateRepairDrone(droneEntity, wall, deltaTime);
```

#### Wall Line Placement

Click+drag to place multiple wall segments:

```typescript
// Game store wall line state
interface WallLineState {
  isActive: boolean;
  startX, startY: number;
  endX, endY: number;
  positions: Array<{ x: number; y: number }>;
  totalCost: { minerals: number; vespene: number };
}

// Line calculation (straight lines only)
calculateWallLine(startX, startY, endX, endY): Array<{x, y}>;
// Returns horizontal, vertical, or 45° diagonal segments

// BuildingPlacementSystem handles wall:place_line events
handleWallLinePlacement({
  positions: Array<{ x, y, valid }>,
  buildingType: string,
  playerId: string
});
// - Validates all positions
// - Deducts total cost
// - Assigns workers round-robin
// - Creates wall entities with Wall component
```

#### WallPlacementPreview (`WallPlacementPreview.ts`)

Visual preview during wall line drawing:

```typescript
class WallPlacementPreview {
  startLine(worldX, worldY);    // Mouse down - start drawing
  updateLine(worldX, worldY);   // Mouse move - update preview
  finishLine(): { positions, cost }; // Mouse up - confirm placement

  // Renders:
  // - Green/red boxes for valid/invalid positions
  // - Connecting line between segments
  // - Cost label showing total minerals
}
```

#### Wall Buildings (`walls.ts`)

```typescript
// Basic wall segment (1x1)
wall_segment: {
  cost: 25 minerals,
  hp: 400, armor: 1,
  canMountTurret: true,
  wallUpgrades: ['reinforced', 'shielded', 'weapon', 'repair_drone']
}

// Entrance gate (2x1)
wall_gate: {
  cost: 75 minerals,
  hp: 500, armor: 2,
  isGate: true,
  canMountTurret: false
}

// Upgraded variants (created via upgrade, not built directly)
wall_reinforced: { hp: 800, armor: 3 }
wall_shielded: { hp: 400, shield: 200 }
wall_weapon: { hp: 500, attackRange: 6, attackDamage: 5 }
```

### Building Placement System (`BuildingPlacementSystem.ts`)

Handles Dominion-style construction (worker builds structure):

```typescript
// Building states
type BuildingState =
  | 'waiting_for_worker'  // Blueprint placed, worker en route
  | 'constructing'        // Worker present, construction progressing
  | 'paused'              // Started but no worker present
  | 'complete'            // Finished
  | 'destroyed';          // Destroyed

// Construction flow
handleBuildingPlace(buildingType, position, workerId);  // Place blueprint
handleResumeConstruction(workerId, buildingId);         // Resume paused building
updateBuildingConstruction(dt);                          // Progress/pause logic
cancelOrphanedBlueprints();                              // Only cancel waiting_for_worker

// Events emitted
'building:placed'              // Building blueprint created
'building:construction_started' // Worker arrived, construction begins
'building:construction_paused'  // Worker left, construction paused
'building:construction_resumed' // Worker resumed construction
'building:complete'             // Construction finished
'building:cancelled'            // Blueprint cancelled (refunded)
```

Key features:
- **Pause/Resume**: Construction pauses when worker leaves, resumes when assigned
- **Right-click Resume**: Workers can right-click paused buildings to resume
- **No Auto-Cancel**: Paused buildings persist until manually resumed or destroyed
- **Multiple Workers**: Multiple workers can speed up construction

### AI System Architecture (`src/engine/systems/ai/`)

The AI system uses a modular architecture with focused subsystems coordinated by a central orchestrator:

```
src/engine/systems/ai/
├── AICoordinator.ts        # Central orchestrator, manages AI players
├── AIEconomyManager.ts     # Worker management, resource gathering, repair
├── AIBuildOrderExecutor.ts # Build orders, macro rules, production, research
├── AITacticsManager.ts     # Combat state, attack/defend/harass execution
├── AIScoutingManager.ts    # Map exploration, intel gathering
└── index.ts                # Module exports
```

The `EnhancedAISystem.ts` wrapper provides backward compatibility by delegating to `AICoordinator`.

#### Difficulty System

5-tier difficulty with strategic behaviors and simulation-based economy:

```typescript
type AIDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard' | 'insane';

interface DifficultySettings {
  actionDelayTicks: number;       // 60 (easy) to 10 (insane)
  targetWorkers: number;          // 16-40 workers
  maxBases: number;               // 2-6 bases
  miningSpeedMultiplier: number;  // 1.0 (normal) to 1.5 (insane)
  buildSpeedMultiplier: number;
  scoutingEnabled: boolean;
  microEnabled: boolean;
  harassmentEnabled: boolean;
}

// State machine
type AIState = 'building' | 'expanding' | 'attacking' |
               'defending' | 'scouting' | 'harassing';
```

#### Subsystem Responsibilities

| Subsystem | Responsibilities |
|-----------|------------------|
| **AICoordinator** | AI player state, subsystem coordination, entity query caching |
| **AIEconomyManager** | Worker gathering, repair assignment, incomplete building resumption |
| **AIBuildOrderExecutor** | Build order steps, macro rules, research initiation, expansion |
| **AITacticsManager** | Tactical state, attack/defend/harass phase execution |
| **AIScoutingManager** | Scout selection, target determination, enemy intel |

#### Simulation-Based Economy

The AI uses a fully simulated economy:

- **No passive income**: Workers must actually gather and deliver resources
- **Mining speed bonuses**: Higher difficulties get faster mining (1.25x-1.5x)
- **Worker death tracking**: AI detects harassment and increases worker production priority
- **Resource depletion awareness**: AI tracks depleted patches to inform expansion decisions
- **Auto-reassignment**: Workers automatically find new resources when patches deplete

#### Research System Integration

The AI can now initiate research through `AIBuildOrderExecutor.tryStartResearch()`:

```typescript
// Finds appropriate building, checks requirements, deducts resources
tryStartResearch(ai: AIPlayer, researchId: string): boolean

// Research tracking in AIPlayer
completedResearch: Set<string>;
researchInProgress: Map<string, number>; // researchId -> buildingId
```

#### Worker Lifecycle Management

```typescript
interface AIPlayer {
  // Worker tracking
  previousWorkerIds: Set<number>;       // For death detection
  lastWorkerDeathTick: number;          // Harassment detection
  recentWorkerDeaths: number;           // Decays over time
  workerReplacementPriority: number;    // 0-1, triggers emergency production
  depletedPatchesNearBases: number;     // Informs expansion decisions
}
```

### AI Economy Metrics System (`AIEconomySystem.ts`)

Metrics tracking for AI economy debugging (separate from AIEconomyManager):

```typescript
interface AIEconomyMetrics {
  mineralsPerMinute: number;
  vespenePerMinute: number;
  totalMineralsGathered: number;
  workerCount: number;
  incomePerWorker: number;
}

// Logs metrics every ~20 seconds for debugging
// Tracks income via resource:delivered events
```

### Game State System (`GameStateSystem.ts`)

Tracks game statistics and victory conditions:

```typescript
interface PlayerStats {
  unitsProduced: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsConstructed: number;
  buildingsLost: number;
  buildingsDestroyed: number;
  resourcesGathered: { minerals: number; vespene: number };
  resourcesSpent: { minerals: number; vespene: number };
  totalDamageDealt: number;
  totalDamageTaken: number;
  apm: number;
}

interface GameResult {
  winner: string | null;
  loser: string | null;
  reason: 'elimination' | 'surrender' | 'disconnect' | 'timeout';
  duration: number;
  stats: Map<string, PlayerStats>;
}

// Victory conditions
checkVictoryConditions(); // Destroy all enemy buildings
handleSurrender(playerId);
```

### Save/Load System (`SaveLoadSystem.ts`)

Complete game state serialization:

```typescript
interface SavedGameState {
  version: string;
  timestamp: number;
  gameTime: number;
  currentTick: number;
  mapWidth: number;
  mapHeight: number;
  players: SavedPlayerState[];
  entities: SavedEntity[];
  fogOfWar: Record<string, number[][]>;
}

// Save operations
saveGame(slot, name); // Manual save
quickSave();          // F5 style
autoSave();           // Every 60 seconds

// Load operations
loadGame(slot);
quickLoad();          // F9 style

// Management
getSaveSlots(): SaveSlotInfo[];
deleteSave(slot);
setAutoSaveEnabled(enabled);
```

### Combat Enhancements

High ground advantage in CombatSystem:

```typescript
// 30% miss chance when attacking uphill
const HIGH_GROUND_MISS_CHANCE = 0.3;
const HIGH_GROUND_THRESHOLD = 1.5; // Height difference

// In performAttack()
const heightDifference = targetTransform.z - attackerTransform.z;
if (heightDifference > HIGH_GROUND_THRESHOLD) {
  if (missRoll < HIGH_GROUND_MISS_CHANCE) {
    emit('combat:miss', { reason: 'high_ground' });
    return;
  }
}
```

### Buff/Debuff System

Integrated into Unit component:

```typescript
// Unit.ts
activeBuffs: Map<string, {
  duration: number;
  effects: Record<string, number>;
}>;

applyBuff(buffId, duration, effects);
getEffectiveSpeed(); // Base speed * buff modifiers
getEffectiveDamage(); // Base damage * buff modifiers

// Example buffs
- stim_pack: +50% speed, +50% attack speed
- concussive_shells: -50% speed for 1.07s
- combat_shield: +10 max HP (permanent)
```

## Pathfinding System (Recast Navigation)

### Overview

The game uses **recast-navigation-js**, a WASM port of the industry-standard Recast Navigation library used by Unity, Unreal Engine, and Godot. This provides:

- **NavMesh generation** from terrain geometry
- **O(1) pathfinding** via NavMeshQuery with string-pulling
- **Crowd simulation** with ORCA collision avoidance
- **Dynamic obstacles** via TileCache for buildings
- **Dual navmesh support** for ground and water navigation

### Movement Domains

Units have a `movementDomain` that determines which navmesh they use:

| Domain | Description | Navmesh |
|--------|-------------|---------|
| `ground` | Standard land units | Ground navmesh (walkable terrain) |
| `water` | Naval units (ships, submarines) | Water navmesh (water cells) |
| `amphibious` | Can use both land and water | Tries water first, falls back to ground |
| `air` | Flying units | No navmesh (direct paths) |

**Worker note:** The pathfinding Web Worker is optimized for the ground navmesh and receives a cached terrain heightmap for elevation-aware queries. Water/amphibious pathing stays on the main thread so naval units never query the land navmesh by accident.

### Water Navmesh

Naval units use a separate water navmesh where:
- **water_deep** and **water_shallow** terrain features are walkable
- Land cells are blocked with barrier walls
- Generated via `Terrain.generateWaterGeometry()`

```typescript
// Initialize water navmesh (if map has water)
const waterGeometry = terrain.generateWaterGeometry();
if (waterGeometry.positions.length > 0) {
  await game.initializeWaterNavMesh(waterGeometry.positions, waterGeometry.indices);
}

// Find path with domain awareness
const path = recast.findPathForDomain(startX, startY, endX, endY, 'water');
```

### RecastNavigation (`RecastNavigation.ts`)

Singleton wrapper for all navigation functionality:

```typescript
export class RecastNavigation {
  // Singleton access
  public static getInstance(): RecastNavigation;
  public static async initWasm(): Promise<void>;

  // NavMesh generation from terrain
  public async generateFromTerrain(
    walkableMesh: THREE.Mesh,
    mapWidth: number,
    mapHeight: number
  ): Promise<boolean>;

  // Terrain height provider for elevation-aware queries
  public setTerrainHeightProvider(provider: (x, z) => number): void;

  // Navmesh projection helper
  public projectToNavMesh(x, z): { x: number; y: number; z: number } | null;

  // Path queries (use terrain height for better accuracy)
  public findPath(startX, startY, endX, endY): PathResult;
  public findNearestPoint(x, y): { x: number; y: number } | null;
  public isWalkable(x, y): boolean;

  // Crowd simulation (ORCA collision avoidance)
  // All positions projected onto navmesh surface automatically
  public addAgent(entityId, x, y, radius, maxSpeed): number;
  public removeAgent(entityId): void;
  public setAgentTarget(entityId, targetX, targetY): boolean;
  public updateAgentPosition(entityId, x, y): void;
  public getAgentState(entityId): { x, y, vx, vy } | null;
  public updateCrowd(deltaTime): void;

  // Dynamic obstacles for buildings
  public addBoxObstacle(buildingId, centerX, centerY, width, height): void;
  public removeObstacle(buildingId): void;
}
```

### Elevation-Aware Pathfinding

The pathfinding system uses terrain height for accurate queries on multi-elevation terrain.

**Critical: Terrain Height Provider Must Match NavMesh Geometry**

The terrain height provider MUST use the same height values used to generate the
navmesh geometry. The navmesh is generated from the Terrain class's heightMap (which
has smoothing applied). Using a different height source (like raw `elevation * 0.04`)
causes agents to be placed slightly off the navmesh surface, resulting in very slow
or zero crowd velocities.

```typescript
// In WebGPUGameCanvas - set terrain height BEFORE navmesh init
// This ensures crowd agents are placed ON the navmesh surface
game.pathfindingSystem.setTerrainHeightFunction((x: number, z: number) => {
  return terrain.getNavmeshHeightAt(x, z);  // Matches navmesh vertex heights (ramps included)
});

// Then initialize navmesh - it will use the terrain height function above
await game.initializeNavMesh(walkableGeometry.positions, walkableGeometry.indices);
```

**Why this matters:**
- NavMesh geometry uses the vertex heights computed during `Terrain.generateWalkableGeometry()`
- If crowd agents are placed using a different height source (like raw `elevation * 0.04`),
  there can be small height differences near ramps/platforms
- Even 0.01 unit height mismatch can cause crowd to return near-zero velocities
- Result: units appear to move at "glacial pace" despite correct speed settings

**Walkability checks:**
- `isWalkable` uses both horizontal distance and vertical height tolerances to avoid
  marking cliff edges as valid ground when the closest polygon is on a different layer.
- Navmesh queries use a tighter vertical search window when a terrain height provider
  is available, preventing projections onto the wrong elevation tier near ramps.

**Terrain Height for Crowd Operations:**

Crowd operations use terrain height for the Y coordinate instead of y=0, ensuring
agents are placed at the correct elevation on multi-level terrain.

```typescript
// Crowd operations use terrain height for Y, keep original X/Z:
// - addAgent() places agent at terrain height
// - setAgentTarget() uses terrain height at target
// - updateAgentPosition() syncs at terrain height

const terrainY = this.getTerrainHeight(x, y);
agent.teleport({ x, y: terrainY, z: y });
```

Note: We keep original X/Z coordinates to avoid position drift between the game's
Transform component and the crowd agent position.

### PathfindingSystem (`PathfindingSystem.ts`)

ECS system that wraps RecastNavigation for game integration:

```typescript
// Dynamic obstacle updates on building changes
eventBus.on('building:placed', (data) => {
  recast.addBoxObstacle(data.entityId, data.position.x, data.position.y,
                        data.width, data.height);
});

eventBus.on('building:destroyed', (data) => {
  recast.removeObstacle(data.entityId);
});
```

Features:
- **NavMesh initialization** from terrain walkable geometry
- **Building obstacle management** via TileCache
- **Path request handling** for unit movement

### MovementSystem Integration

The MovementSystem uses Recast's DetourCrowd for collision avoidance via the PathfindingMovement module:

```typescript
// PathfindingMovement handles crowd agent lifecycle
pathfinding.ensureAgentRegistered(entityId, transform, unit);
pathfinding.prepareCrowdAgents(entities, dt);
pathfinding.updateCrowd(dt);

// Get computed velocity for smooth movement
const state = pathfinding.getAgentState(entityId);
if (state) {
  velocity.x = state.vx;
  velocity.y = state.vy;
}

// Building avoidance is handled by PathfindingMovement
pathfinding.calculateBuildingAvoidanceForce(entityId, transform, unit, out, vx, vy);
pathfinding.resolveHardBuildingCollision(entityId, transform, unit);
```

### NavMesh Configuration

Tuned for RTS gameplay with strict cliff handling:

```typescript
const NAVMESH_CONFIG = {
  // Cell sizing
  cs: 0.5,          // Cell size (0.5 units for Safari compatibility)
  ch: 0.2,          // Cell height (finer vertical precision for cliffs)

  // Agent parameters - STRICT for cliff blocking
  walkableRadius: 0.6,     // Must exceed unit collision radius (0.5)
  walkableHeight: 2.0,
  walkableClimb: 0.3,      // CRITICAL: Low value prevents stepping between elevations
  walkableSlopeAngle: 50,  // Max 50° slopes (cliffs are 90°, ramps are 30-40°)

  // NavMesh quality - tighter for cliff edge precision
  maxSimplificationError: 0.5,
  tileSize: 48,
  maxObstacles: 512,
};
```

### RTS-Style Cliff Blocking

Three-layer defense prevents units from walking up/down cliffs:

1. **Low walkableClimb (0.3)** - Elevation level gaps are 3.2+ units, so stepping is impossible
2. **Reasonable walkableSlopeAngle (50°)** - Rejects near-vertical navmesh connections
3. **Explicit cliff wall geometry** - Physical barriers generated at elevation boundaries

```typescript
// Elevation levels and gaps
// Low ground:  elevation 60  → 2.4 height units
// Mid ground:  elevation 140 → 5.6 height units
// High ground: elevation 220 → 8.8 height units
// Gap between levels: 3.2 units >> 0.3 walkableClimb
```

### Building Obstacle Expansion

Critical for preventing units getting stuck on building edges:

```typescript
// Obstacles are expanded by agent radius + buffer
public addBoxObstacle(buildingId, centerX, centerY, width, height, agentRadius = 0.5) {
  const expansionMargin = agentRadius + 0.1;  // Extra buffer for safety
  const halfExtents = {
    x: (width / 2) + expansionMargin,
    z: (height / 2) + expansionMargin
  };
  // NavMesh now excludes area around building with proper clearance
}
```

### Building Avoidance System

Three-tier avoidance in MovementSystem:

1. **Hard Avoidance** (margin 0.6) - Immediate push when very close
2. **Soft Avoidance** (margin 1.5) - Gentle steering in approach zone
3. **Predictive Avoidance** - Steer away from predicted collision points

```typescript
const BUILDING_AVOIDANCE_STRENGTH = 35.0;
const BUILDING_AVOIDANCE_MARGIN = 0.6;      // > unit collision radius (0.5)
const BUILDING_AVOIDANCE_SOFT_MARGIN = 1.5; // Early detection zone
const BUILDING_PREDICTION_LOOKAHEAD = 0.5;  // Seconds ahead
```

### RTS-Style Formation & Clumping System

The FormationMovement module implements classic RTS unit movement behavior:

#### Magic Box Detection

When issuing move commands to multiple units, the system calculates a bounding box around selected units:

- **Target INSIDE box** → **Clump Mode**: All units move to the exact same point. Separation forces spread them naturally on arrival.
- **Target OUTSIDE box** → **Preserve Spacing Mode**: Each unit maintains its relative offset from group center.

```typescript
// Magic box check determines clump vs formation behavior
const box = this.calculateBoundingBox(entityIds);
const isInsideBox = this.isTargetInsideMagicBox(targetX, targetY, box);

if (isInsideBox) {
  // All units move to same point - clump
  this.moveUnitsToSamePoint(entityIds, targetX, targetY);
} else {
  // Preserve relative offsets - formation-like
  this.moveUnitsWithRelativeOffsets(entityIds, targetX, targetY, box);
}
```

#### State-Dependent Separation

Separation force strength varies based on unit state:

| State | Strength | Behavior |
|-------|----------|----------|
| **Moving** | 1.2 (weak) | Allow clumping for faster group movement |
| **Idle** | 2.5 (strong) | Spread out for anti-splash |
| **Arriving** | 3.0 (strongest) | Natural spreading at destination |
| **Gathering** | 0 | Workers can overlap at resources |

#### Flocking Behaviors (FlockingBehavior module)

Three steering forces work together:

1. **Separation** - Prevents overlapping, strongest force
2. **Cohesion** (0.1 weight) - Weak force keeping group together
3. **Alignment** (0.3 weight) - Matches group heading direction

#### Explicit Formation Commands

Players can issue explicit formation commands using the data-driven formation system:

```typescript
// Event: command:formation
{
  entityIds: number[];      // Units to form up
  formationId: string;      // e.g., 'wedge', 'box', 'line'
  targetPosition: { x, y }; // Formation center
}
```

Available formations: `box`, `line`, `column`, `wedge`, `scatter`, `circle`, `siege_line`, `air_cover`

Units are automatically sorted (melee front, ranged back, support center) based on formation preferences.

### Terrain Integration (`Terrain.ts`)

The terrain generates walkable geometry with cliff walls for navmesh creation:

```typescript
// Generate walkable mesh with cliff barriers
public generateWalkableGeometry(): {
  positions: Float32Array;
  indices: Uint32Array;
}

// Two-pass generation:
// PASS 1: Floor geometry for walkable cells
//   - Ramps use smooth heightMap for natural slope traversal
//   - Non-ramp terrain uses quantized elevation for strict height gaps
//
// PASS 2: Cliff wall geometry at elevation boundaries
//   - Walls generated between cells with elevation diff > 40
//   - Walls extend 4 units vertically as physical barriers
//   - Both front and back faces for robust blocking
```

## AI Micro System

### AIMicroSystem (`AIMicroSystem.ts`)

Handles tactical unit control for AI players:

```typescript
// Kiting for ranged units
if (shouldKite(unit, nearestMeleeEnemy)) {
  kiteAwayFrom(unit, enemy.position);
  reacquireTarget(unit);
}

// Focus fire on low-health targets
const FOCUS_FIRE_THRESHOLD = 0.7;
if (currentTarget.healthPercent > FOCUS_FIRE_THRESHOLD) {
  const betterTarget = findLowHealthTarget();
  if (betterTarget) switchTarget(unit, betterTarget);
}

// Threat assessment
interface ThreatInfo {
  entityId: number;
  threatScore: number;    // Based on DPS, priority, distance
  distance: number;
  healthPercent: number;
  dps: number;
}
```

Features:
- **Kiting Logic**: Ranged units maintain distance from melee threats
- **Focus Fire**: AI coordinates attacks on low-health or high-priority targets
- **Threat Assessment**: Ranks nearby enemies by threat score
- **Retreat Logic**: Damaged units retreat to base when overwhelmed

### Counter-Building System

Analyzes enemy composition and recommends unit production:

```typescript
interface EnemyComposition {
  infantry: number;
  vehicles: number;
  air: number;
  workers: number;
  total: number;
}

// Counter matrix
const COUNTER_MATRIX = {
  marine: ['hellion', 'hellbat', 'siege_tank'],
  siege_tank: ['viking', 'banshee', 'marine'],
  thor: ['marine', 'marauder', 'siege_tank'],
};

// AI adapts production to counter enemy
if (enemyComp.air > 0.3 * enemyComp.total) {
  prioritize(['viking', 'marine', 'thor']);
}
```

Enabled for 'hard', 'very_hard', and 'insane' difficulties.

## Behavior Tree System

### BehaviorTree (`ai/BehaviorTree.ts`)

Composable behavior tree for unit AI decision making:

```typescript
// Node types
type BehaviorStatus = 'success' | 'failure' | 'running';

// Composite nodes
selector(...children);   // OR - try until one succeeds
sequence(...children);   // AND - try until one fails
parallel(threshold, ...children);  // Run all, succeed if N succeed

// Decorator nodes
inverter(child);         // Invert result
condition(predicate, child);  // Only run if condition true
cooldown(ms, child);     // Rate limit execution

// Action nodes
action((ctx) => boolean);  // Execute and return success/failure
wait(ms);                  // Wait for duration
```

Example combat micro tree:

```typescript
const combatMicroTree = selector(
  // Priority 1: Kite from melee enemies
  sequence(
    action(ctx => shouldKite(ctx)),
    action(ctx => executeKite(ctx))
  ),
  // Priority 2: Retreat if in danger
  sequence(
    action(ctx => isInDanger(ctx)),
    action(ctx => retreat(ctx))
  ),
  // Priority 3: Optimal positioning
  action(ctx => positionForCombat(ctx))
);
```

Features:
- **Composable**: Build complex behaviors from simple nodes
- **Stateful**: Blackboard stores per-unit decision data
- **Reusable**: Same tree works for multiple units

## Audio System

### MusicPlayer (`src/audio/MusicPlayer.ts`)

Dynamic music system that discovers and plays MP3 files randomly:

```typescript
// Initialize and play menu music
await MusicPlayer.initialize();
await MusicPlayer.discoverTracks();
MusicPlayer.play('menu');

// Switch to gameplay music
MusicPlayer.play('gameplay');

// Playback controls
MusicPlayer.pause();
MusicPlayer.resume();
MusicPlayer.skip();

// Volume control
MusicPlayer.setVolume(0.5);
MusicPlayer.setMuted(false);
```

Features:
- **Auto-discovery**: Scans `/audio/music/menu/` and `/audio/music/gameplay/` for MP3 files
- **Shuffle playback**: Tracks play in random order, reshuffles when all played
- **Crossfading**: 2-second crossfade between tracks
- **Category switching**: Separate playlists for menu and gameplay

### Build-time Manifest (`scripts/generate-music-manifest.js`)

Music track discovery is performed at build time to avoid serverless function size limits:
- Runs automatically via `prebuild` script before `next build`
- Scans folders defined in `public/audio/music.config.json`
- Outputs to `src/data/music-manifest.json` which is statically imported

### SoundOptionsPanel (`src/components/game/SoundOptionsPanel.tsx`)

In-game sound settings UI:
- Music volume slider
- Sound effects volume slider
- Music on/off toggle
- SFX on/off toggle
- Now playing display with track name
- Play/pause and skip buttons

### AudioManager Integration

The AudioManager handles all game sound effects with category-based volume:
- `music`: Background music (controlled separately by MusicPlayer)
- `combat`: Weapon sounds, explosions, impacts
- `ui`: Click, error, notification sounds
- `unit`: Movement, attack confirmations
- `building`: Construction, production sounds
- `ambient`: Biome-specific ambient loops
- `voice`: Unit voice lines
- `alert`: Under attack, supply blocked alerts

## Audio Asset Guidelines

See `.claude/AUDIO_PROMPTS.md` for comprehensive audio generation prompts including:
- Music tracks (menu, gameplay, events)
- Unit sound effects
- Building sounds
- UI feedback sounds
- Ambient sounds
- Voice lines

## Homescreen 3D Background System

### HomeBackground Component (`src/components/home/HomeBackground.tsx`)

A cinematic Three.js animated background that creates an immersive menu experience:

```typescript
// Key features:
- Procedural void nebula shader with flowing noise patterns
- 3000+ animated stars with twinkling effect
- Floating asteroid field with rotation and drift
- Energy stream particle systems flowing toward center
- Cinematic camera movement following mouse position
- Post-processing pipeline (bloom, chromatic aberration, vignette)
```

### Visual Systems

1. **Void Nebula Shader** - Custom GLSL fragment shader
   - 6-octave fractal Brownian motion (fBM) for organic noise
   - Multi-layer color gradient based on noise intensity
   - Energy stream highlights with power function
   - Mouse-reactive position offset
   - Pulsing intensity animation

2. **Star Field** - GPU-instanced points
   - 3000 stars distributed in a spherical shell
   - Color variation (white, blue, purple tints)
   - Size-based distance scaling
   - Twinkle animation via vertex shader

3. **Asteroid Field** - Deformed icosahedrons
   - 15 randomly deformed asteroids
   - Individual rotation speeds
   - Gentle floating motion (sinusoidal)
   - Dark purple emissive material

4. **Energy Streams** - Point particle systems
   - 5 streams with 200 particles each
   - Particles flow from outer edges toward center
   - Lifetime-based respawning
   - Additive blending for glow effect

5. **Post-Processing Stack**
   - UnrealBloomPass (strength: 0.8, radius: 0.4, threshold: 0.85)
   - ChromaticAberrationShader (subtle edge distortion)
   - VignetteShader (darker edges for focus)

### Camera System

```typescript
// Cinematic camera movement:
- Base position at (0, 0, 5) looking at (0, 0, -5)
- Mouse tracking with 0.02 interpolation factor
- Subtle "breathing" motion via sine waves
- Results in parallax effect as mouse moves
```

### Integration

The HomeBackground is dynamically imported in `page.tsx` to avoid SSR issues:

```typescript
const HomeBackground = dynamic(() => import('@/components/home/HomeBackground'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#050010]" />,
});
```

### UI Overlay

The homepage uses glassmorphism design with:
- Translucent faction cards with backdrop blur
- Animated number counters for stats
- Shimmer animation on title text
- Staggered fade-in animations on load
- Mouse parallax on hero content

## Loading Screen System

### LoadingScreen Component (`src/components/game/LoadingScreen.tsx`)

A world-class Three.js-powered loading screen that creates a cinematic experience while game assets load. Inspired by the HomeBackground but with unique loading-specific effects:

```typescript
// Key features:
- Full Three.js WebGL scene with 4000 twinkling stars
- Central wormhole vortex with spiral arms and rotating rings
- 12 orbiting asteroids with gentle floating motion
- 300 converging energy particles that accelerate with progress
- 5 concentric energy rings that pulse and intensify
- Procedural nebula shader with wormhole distortion
- Progress-reactive effects (everything intensifies as loading approaches 100%)
```

### Visual Systems

1. **Void Nebula Shader** - Custom GLSL fragment shader
   - Simplex noise with fractal Brownian motion (fBM)
   - **Wormhole distortion** - spiral pattern that intensifies with loading progress
   - Central vortex glow that grows as loading progresses
   - Pulsing ring effect at 25% distance from center
   - Mouse-reactive position for subtle parallax

2. **Wormhole Effect** - Central portal shader
   - Rotating tunnel rings with progress-reactive speed
   - 4 spiral arms rotating at different speeds
   - Core glow with fade toward edges
   - Cyan-to-purple color gradient

3. **Star Field** - GPU-instanced points (4000 stars)
   - Spherical distribution (30-200 unit radius)
   - Color variation (white 60%, blue 20%, purple 20%)
   - Twinkle animation via vertex shader
   - Slow rotation around Y and X axes

4. **Orbiting Asteroids** - Deformed icosahedrons (12 total)
   - Random vertex deformation for organic shapes
   - Individual rotation speeds on all axes
   - Orbital motion around center with varying radii
   - Dark purple emissive material

5. **Energy Rings** - Concentric ring geometries (5 rings)
   - Alternate rotation directions
   - Opacity increases with loading progress
   - Color shifts from purple to cyan outward
   - Additive blending for glow effect

6. **Converging Particles** - Point cloud (300 particles)
   - Spawn at outer edges, flow toward center
   - Velocity and lifetime accelerate with loading progress
   - Fade in/out based on particle lifetime
   - Color shifts from cyan to purple over lifetime

7. **Post-Processing Stack**
   - UnrealBloomPass (strength: 1.2, radius: 0.5, threshold: 0.7)
   - ChromaticAberrationShader (reduces as loading completes)
   - ScanlineShader (subtle CRT effect with moving beam)
   - Vignette built into scanline shader

### Camera System

```typescript
// Cinematic camera movement:
- Base position at (0, 0, 8) looking at (0, 0, -10)
- Mouse tracking with 0.02 interpolation factor
- "Breathing" motion via sine/cosine oscillation
- Parallax effect creates immersive depth
```

### Progress Integration

All visual effects respond to loading progress (0-100%):
- Nebula brightness and wormhole distortion increase
- Wormhole scale grows (1.0 → 1.3)
- Energy ring rotation speed and opacity increase
- Particle velocity multiplier increases (1x → 3x)
- Chromatic aberration decreases (less distortion = cleaner image)
- Scanline intensity decreases

### UI Overlay

Clean, futuristic loading UI:
- Large "VOIDSTRIKE" title with gradient and drop-shadow glow
- "Initializing Combat Systems" subtitle with tracking
- 5 stage indicators (CORE, RENDER, WORLD, UNITS, SYNC) with active/complete states
- Sleek progress bar with shimmer animation and glowing tip
- Status text with animated dots
- Percentage display with gradient text
- Inspirational quote at bottom
