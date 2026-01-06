'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { Game } from '@/engine/core/Game';
import { RTSCamera } from '@/rendering/Camera';
import { Terrain, TerrainGrid, MapDecorations } from '@/rendering/Terrain';
import { UnitRenderer } from '@/rendering/UnitRenderer';
import { BuildingRenderer } from '@/rendering/BuildingRenderer';
import { ResourceRenderer } from '@/rendering/ResourceRenderer';
import { useGameStore } from '@/store/gameStore';
import { SelectionBox } from './SelectionBox';
import { spawnInitialEntities } from '@/utils/gameSetup';
import { DEFAULT_MAP, MapData } from '@/data/maps';

// Get current map (will support map selection later)
const CURRENT_MAP: MapData = DEFAULT_MAP;

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<RTSCamera | null>(null);

  const unitRendererRef = useRef<UnitRenderer | null>(null);
  const buildingRendererRef = useRef<BuildingRenderer | null>(null);
  const resourceRendererRef = useRef<ResourceRenderer | null>(null);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionEnd, setSelectionEnd] = useState({ x: 0, y: 0 });

  const { isBuilding, buildingType } = useGameStore();

  // Initialize Three.js and game engine
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 50, 150);
    sceneRef.current = scene;

    // Create camera with map dimensions
    const mapWidth = CURRENT_MAP.width;
    const mapHeight = CURRENT_MAP.height;

    const camera = new RTSCamera(
      window.innerWidth / window.innerHeight,
      mapWidth,
      mapHeight
    );
    camera.setPosition(mapWidth / 2, mapHeight / 2);
    cameraRef.current = camera;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 10;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    // Create terrain from map data
    const terrain = new Terrain({ mapData: CURRENT_MAP });
    scene.add(terrain.mesh);

    // Create map decorations (watch towers, destructible rocks)
    const decorations = new MapDecorations(CURRENT_MAP);
    scene.add(decorations.group);

    // Create terrain grid (for building placement)
    const grid = new TerrainGrid(mapWidth, mapHeight, 1);
    scene.add(grid.mesh);

    // Initialize game engine
    const game = Game.getInstance({
      mapWidth,
      mapHeight,
      tickRate: 20,
      isMultiplayer: false,
      playerId: 'player1',
      aiEnabled: true,
    });
    gameRef.current = game;

    // Create renderers
    unitRendererRef.current = new UnitRenderer(scene, game.world);
    buildingRendererRef.current = new BuildingRenderer(scene, game.world);
    resourceRendererRef.current = new ResourceRenderer(scene, game.world);

    // Spawn initial entities based on map data
    spawnInitialEntities(game, CURRENT_MAP);

    // Start game
    game.start();

    // Animation loop
    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      // Update camera
      camera.update(deltaTime);

      // Update renderers
      unitRendererRef.current?.update();
      buildingRendererRef.current?.update();
      resourceRendererRef.current?.update();

      // Update game store camera position
      const pos = camera.getPosition();
      useGameStore.getState().setCamera(pos.x, pos.z, camera.getZoom());

      // Render
      renderer.render(scene, camera.camera);

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);

    // Handle resize
    const handleResize = () => {
      if (!renderer || !camera) return;
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.camera.aspect = window.innerWidth / window.innerHeight;
      camera.camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      terrain.dispose();
      decorations.dispose();
      grid.dispose();
      camera.dispose();
      unitRendererRef.current?.dispose();
      buildingRendererRef.current?.dispose();
      resourceRendererRef.current?.dispose();
      Game.resetInstance();
    };
  }, []);

  // Handle mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left click - start selection or place building
      if (isBuilding && buildingType) {
        // Place building
        const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
        if (worldPos && gameRef.current) {
          gameRef.current.eventBus.emit('building:place', {
            buildingType,
            position: { x: worldPos.x, y: worldPos.z },
          });
          useGameStore.getState().setBuildingMode(null);
        }
      } else {
        // Start selection box
        setIsSelecting(true);
        setSelectionStart({ x: e.clientX, y: e.clientY });
        setSelectionEnd({ x: e.clientX, y: e.clientY });
      }
    } else if (e.button === 2) {
      // Right click - issue command
      const worldPos = cameraRef.current?.screenToWorld(e.clientX, e.clientY);
      if (worldPos && gameRef.current) {
        const selectedUnits = useGameStore.getState().selectedUnits;

        if (selectedUnits.length > 0) {
          gameRef.current.processCommand({
            tick: gameRef.current.getCurrentTick(),
            playerId: 'player1',
            type: 'MOVE',
            entityIds: selectedUnits,
            targetPosition: { x: worldPos.x, y: worldPos.z },
          });
        }
      }
    }
  }, [isBuilding, buildingType]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isSelecting) {
      setSelectionEnd({ x: e.clientX, y: e.clientY });
    }
  }, [isSelecting]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && isSelecting) {
      setIsSelecting(false);

      // Calculate world coordinates for selection box
      const camera = cameraRef.current;
      const game = gameRef.current;

      if (camera && game) {
        const start = camera.screenToWorld(selectionStart.x, selectionStart.y);
        const end = camera.screenToWorld(selectionEnd.x, selectionEnd.y);

        const dx = Math.abs(end.x - start.x);
        const dy = Math.abs(end.z - start.z);

        if (dx > 1 || dy > 1) {
          // Box selection
          game.eventBus.emit('selection:box', {
            startX: Math.min(start.x, end.x),
            startY: Math.min(start.z, end.z),
            endX: Math.max(start.x, end.x),
            endY: Math.max(start.z, end.z),
            additive: e.shiftKey,
            playerId: 'player1',
          });
        } else {
          // Click selection
          game.eventBus.emit('selection:click', {
            x: end.x,
            y: end.z,
            additive: e.shiftKey,
            playerId: 'player1',
          });
        }
      }
    }
  }, [isSelecting, selectionStart, selectionEnd]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;

      // Control groups
      if (e.ctrlKey && e.key >= '0' && e.key <= '9') {
        const group = parseInt(e.key);
        const selectedUnits = useGameStore.getState().selectedUnits;

        if (selectedUnits.length > 0) {
          game.eventBus.emit('selection:controlGroup:set', {
            group,
            entityIds: selectedUnits,
          });
        }
      } else if (e.key >= '0' && e.key <= '9') {
        const group = parseInt(e.key);
        game.eventBus.emit('selection:controlGroup:get', { group });
      }

      // Commands
      switch (e.key.toLowerCase()) {
        case 'a':
          // Attack move
          // TODO: Implement attack-move cursor
          break;
        case 's':
          // Stop
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'STOP',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'h':
          // Hold position
          game.processCommand({
            tick: game.getCurrentTick(),
            playerId: 'player1',
            type: 'HOLD',
            entityIds: useGameStore.getState().selectedUnits,
          });
          break;
        case 'escape':
          // Cancel building mode or clear selection
          if (isBuilding) {
            useGameStore.getState().setBuildingMode(null);
          } else {
            game.eventBus.emit('selection:clear');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBuilding]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} className="w-full h-full" />

      {isSelecting && (
        <SelectionBox
          startX={selectionStart.x}
          startY={selectionStart.y}
          endX={selectionEnd.x}
          endY={selectionEnd.y}
        />
      )}

      {isBuilding && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/80 px-4 py-2 rounded border border-void-600">
          <span className="text-void-300">
            Placing {buildingType} - Click to place, ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
}
