/**
 * Editor3DCanvas - The main 3D canvas for the map editor
 *
 * Uses the game's RTSCamera for familiar controls:
 * - Scroll wheel: Zoom with smooth interpolation
 * - Middle mouse drag: Rotate and adjust pitch
 * - Arrow keys: Pan camera
 * - Click/drag: Paint terrain or select/move objects
 *
 * Performance optimized with:
 * - Chunked terrain updates
 * - Throttled rendering
 * - Optimized renderer settings
 */

'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import type { EditorConfig, EditorState, EditorCell } from '../config/EditorConfig';
import { EditorTerrain } from '../rendering3d/EditorTerrain';
import { EditorObjects } from '../rendering3d/EditorObjects';
import { EditorGrid } from '../rendering3d/EditorGrid';
import { EditorBrushPreview } from '../rendering3d/EditorBrushPreview';
import { TerrainBrush } from '../tools/TerrainBrush';
import { ObjectPlacer } from '../tools/ObjectPlacer';
import { RTSCamera } from '@/rendering/Camera';

export interface Editor3DCanvasProps {
  config: EditorConfig;
  state: EditorState;
  onCellsUpdateBatched: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  onStartBatch: () => void;
  onCommitBatch: () => void;
  onFillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;
  onObjectSelect: (ids: string[]) => void;
  onObjectUpdate: (id: string, updates: { x?: number; y?: number }) => void;
  onObjectAdd: (obj: { type: string; x: number; y: number; radius?: number; properties?: Record<string, unknown> }) => string;
}

export function Editor3DCanvas({
  config,
  state,
  onCellsUpdateBatched,
  onStartBatch,
  onCommitBatch,
  onFillArea,
  onObjectSelect,
  onObjectUpdate,
  onObjectAdd,
}: Editor3DCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const terrainRef = useRef<EditorTerrain | null>(null);
  const objectsRef = useRef<EditorObjects | null>(null);
  const gridRef = useRef<EditorGrid | null>(null);
  const brushPreviewRef = useRef<EditorBrushPreview | null>(null);

  // Use game's RTS camera
  const rtsCameraRef = useRef<RTSCamera | null>(null);

  // Tools
  const terrainBrushRef = useRef<TerrainBrush | null>(null);
  const objectPlacerRef = useRef<ObjectPlacer | null>(null);

  // Raycasting - reuse objects to avoid allocation
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseVecRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const groundPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const intersectTargetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [mouseGridPos, setMouseGridPos] = useState<{ x: number; y: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(45);

  // Painting state
  const paintingState = useRef({
    isPainting: false,
    isDraggingObject: false,
    draggedObjectId: null as string | null,
    lastPaintPos: null as { x: number; y: number } | null,
  });

  // Performance: track last frame time
  const lastFrameTimeRef = useRef(0);

  const { mapData, activeTool, selectedElevation, selectedFeature, brushSize, selectedObjects } = state;

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(config.theme.background);
    sceneRef.current = scene;

    // Renderer - optimized settings
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: false, // Disable AA for performance
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1); // Force 1x for performance
    renderer.shadowMap.enabled = false; // Disable shadows for editor
    rendererRef.current = renderer;

    // Lighting - simplified for performance
    const ambientLight = new THREE.AmbientLight(0x606080, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xfff8e0, 1.0);
    directionalLight.position.set(50, 80, 30);
    scene.add(directionalLight);

    // Terrain
    const terrain = new EditorTerrain({ cellSize: 1 });
    terrainRef.current = terrain;
    scene.add(terrain.mesh);

    // Objects
    const objects = new EditorObjects();
    objects.setObjectTypes(config.objectTypes);
    objectsRef.current = objects;
    scene.add(objects.group);

    // Brush preview
    const brushPreview = new EditorBrushPreview();
    brushPreviewRef.current = brushPreview;
    scene.add(brushPreview.mesh);

    // Tools
    terrainBrushRef.current = new TerrainBrush(config);
    objectPlacerRef.current = new ObjectPlacer();
    objectPlacerRef.current.setObjectTypes(config.objectTypes);

    setIsInitialized(true);

    // Cleanup
    return () => {
      renderer.dispose();
      terrain.dispose();
      objects.dispose();
      brushPreview.dispose();
    };
  }, [config]);

  // Initialize RTS camera when map loads
  useEffect(() => {
    if (!isInitialized || !mapData || !rendererRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    const aspect = container.clientWidth / container.clientHeight;

    // Dispose old camera
    rtsCameraRef.current?.dispose();

    // Create new RTS camera with map dimensions
    const rtsCamera = new RTSCamera(aspect, mapData.width, mapData.height, {
      minZoom: 20,
      maxZoom: 120,
      panSpeed: 60,
      zoomSpeed: 5,
      rotationSpeed: 2,
      edgeScrollSpeed: 0, // Disable edge scroll in editor
      edgeScrollThreshold: 0,
    });
    rtsCameraRef.current = rtsCamera;

    // Set terrain height function
    const getHeight = (x: number, z: number) => terrainRef.current?.getHeightAt(x, z) ?? 0;
    rtsCamera.setTerrainHeightFunction(getHeight);

    // Center camera
    rtsCamera.setPosition(mapData.width / 2, mapData.height / 2);
    rtsCamera.setZoom(Math.max(mapData.width, mapData.height) * 0.5, true);

    // Animation loop with throttling
    let animationId: number;
    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      animationId = requestAnimationFrame(animate);

      // Calculate delta time
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      // Update camera (handles smooth zoom interpolation)
      rtsCamera.update(deltaTime);

      // Update zoom display
      const zoom = rtsCamera.getZoom();
      if (Math.abs(zoom - currentZoom) > 0.5) {
        setCurrentZoom(Math.round(zoom));
      }

      // Render
      if (rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, rtsCamera.camera);
      }
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
      rtsCamera.dispose();
    };
  }, [isInitialized, mapData?.width, mapData?.height]);

  // Load map data
  useEffect(() => {
    if (!isInitialized || !mapData) return;

    // Load terrain
    terrainRef.current?.loadMap(mapData);

    // Set terrain height function for objects and brush
    const getHeight = (x: number, z: number) => terrainRef.current?.getHeightAt(x, z) ?? 0;
    objectsRef.current?.setTerrainHeightFn(getHeight);
    brushPreviewRef.current?.setTerrainHeightFn(getHeight);

    // Load objects
    objectsRef.current?.loadObjects(mapData.objects);

    // Create/update grid
    if (gridRef.current) {
      sceneRef.current?.remove(gridRef.current.mesh);
      gridRef.current.dispose();
    }
    const grid = new EditorGrid({
      width: mapData.width,
      height: mapData.height,
      cellSize: 1,
      color: parseInt(config.theme.primary.replace('#', ''), 16),
      opacity: 0.08,
    });
    gridRef.current = grid;
    sceneRef.current?.add(grid.mesh);
    grid.updateHeights(getHeight);

    // Update tools
    terrainBrushRef.current?.setMapData(mapData);
    objectPlacerRef.current?.setMapData(mapData);
  }, [isInitialized, mapData, config.theme.primary]);

  // Update terrain when map changes - debounced
  const terrainUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isInitialized || !mapData || !terrainRef.current) return;

    // Debounce terrain updates
    if (terrainUpdateTimeoutRef.current) {
      clearTimeout(terrainUpdateTimeoutRef.current);
    }
    terrainUpdateTimeoutRef.current = setTimeout(() => {
      terrainRef.current?.forceUpdate();
    }, 16); // ~60fps max update rate

    return () => {
      if (terrainUpdateTimeoutRef.current) {
        clearTimeout(terrainUpdateTimeoutRef.current);
      }
    };
  }, [isInitialized, mapData?.terrain]);

  // Update objects when selection changes
  useEffect(() => {
    if (!isInitialized) return;
    objectsRef.current?.setSelection(selectedObjects);
  }, [isInitialized, selectedObjects]);

  // Update biome
  useEffect(() => {
    if (!isInitialized || !mapData) return;
    terrainRef.current?.setBiome(mapData.biomeId);
  }, [isInitialized, mapData?.biomeId]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !rtsCameraRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      rtsCameraRef.current.camera.aspect = width / height;
      rtsCameraRef.current.camera.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Raycast to terrain - optimized to reuse objects
  const raycastToTerrain = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    if (!containerRef.current || !rtsCameraRef.current || !terrainRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    mouseVecRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseVecRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseVecRef.current, rtsCameraRef.current.camera);

    // Try terrain mesh first
    const intersects = raycasterRef.current.intersectObject(terrainRef.current.mesh, false);
    if (intersects.length > 0) {
      return intersects[0].point;
    }

    // Fallback: intersect with ground plane (reuse objects)
    groundPlaneRef.current.constant = 0;
    raycasterRef.current.ray.intersectPlane(groundPlaneRef.current, intersectTargetRef.current);
    return intersectTargetRef.current.clone();
  }, []);

  // Get grid position from world position
  const worldToGrid = useCallback((point: THREE.Vector3): { x: number; y: number } | null => {
    if (!mapData) return null;

    const x = Math.floor(point.x);
    const y = Math.floor(point.z);

    if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) {
      return null;
    }

    return { x, y };
  }, [mapData]);

  // Paint at position - optimized to skip redundant updates
  const paintAt = useCallback((worldPos: THREE.Vector3, force: boolean = false) => {
    if (!mapData || !terrainBrushRef.current) return;

    const gridPos = worldToGrid(worldPos);
    if (!gridPos) return;

    // Skip if same position as last paint (performance optimization)
    const lastPos = paintingState.current.lastPaintPos;
    if (!force && lastPos && lastPos.x === gridPos.x && lastPos.y === gridPos.y) {
      return;
    }
    paintingState.current.lastPaintPos = gridPos;

    const tool = config.tools.find((t) => t.id === activeTool);
    if (!tool) return;

    let updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }> = [];

    // Get tool options
    const toolOptions = (tool as unknown as { options?: Record<string, unknown> }).options || {};
    const paintElevation = (toolOptions.elevation as number) ?? selectedElevation;
    const paintFeature = (toolOptions.feature as string) ?? selectedFeature;
    const paintWalkable = toolOptions.walkable !== undefined
      ? (toolOptions.walkable as boolean)
      : config.terrain.elevations.find((e) => e.id === paintElevation)?.walkable ?? true;

    switch (tool.type) {
      case 'brush':
        updates = terrainBrushRef.current.paintElevation(
          gridPos.x,
          gridPos.y,
          brushSize,
          paintElevation,
          paintWalkable
        );
        if (paintFeature !== 'none') {
          const featureUpdates = terrainBrushRef.current.paintFeature(
            gridPos.x,
            gridPos.y,
            brushSize,
            paintFeature
          );
          updates = updates.map((u, i) => ({
            ...u,
            cell: { ...u.cell, ...featureUpdates[i]?.cell },
          }));
        }
        break;

      case 'eraser':
        updates = terrainBrushRef.current.erase(gridPos.x, gridPos.y, brushSize);
        break;

      case 'plateau':
        updates = terrainBrushRef.current.createPlateau(
          gridPos.x,
          gridPos.y,
          brushSize,
          paintElevation,
          paintWalkable
        );
        break;

      case 'fill':
        if (force) {
          const targetCell = mapData.terrain[gridPos.y]?.[gridPos.x];
          if (targetCell && targetCell.elevation !== paintElevation) {
            onFillArea(gridPos.x, gridPos.y, targetCell.elevation, paintElevation);
          }
        }
        return;

      default:
        return;
    }

    if (updates.length > 0) {
      onCellsUpdateBatched(updates);
      terrainRef.current?.markCellsDirty(updates.map((u) => ({ x: u.x, y: u.y })));
    }
  }, [mapData, config, activeTool, selectedElevation, selectedFeature, brushSize, worldToGrid, onCellsUpdateBatched, onFillArea]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!mapData) return;

    // Let RTS camera handle middle mouse button
    if (e.button === 1) return;

    // Right click - no action in editor (camera handles rotation via middle mouse)
    if (e.button === 2) return;

    const worldPos = raycastToTerrain(e.clientX, e.clientY);
    if (!worldPos) return;

    // Left click
    if (e.button === 0) {
      if (activeTool === 'select') {
        // Check if clicking on an object
        if (rtsCameraRef.current) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            mouseVecRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseVecRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycasterRef.current.setFromCamera(mouseVecRef.current, rtsCameraRef.current.camera);
          }
        }

        const clickedObjId = objectsRef.current?.findObjectAt(raycasterRef.current);
        if (clickedObjId) {
          if (e.ctrlKey || e.metaKey) {
            onObjectSelect([...selectedObjects, clickedObjId]);
          } else {
            onObjectSelect([clickedObjId]);
            paintingState.current.isDraggingObject = true;
            paintingState.current.draggedObjectId = clickedObjId;
          }
        } else {
          onObjectSelect([]);
        }
      } else {
        // Painting tools
        onStartBatch();
        paintingState.current.isPainting = true;
        paintingState.current.lastPaintPos = null;
        paintAt(worldPos, true);
      }
    }
  }, [mapData, activeTool, selectedObjects, raycastToTerrain, paintAt, onObjectSelect, onStartBatch]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = raycastToTerrain(e.clientX, e.clientY);

    if (worldPos) {
      const gridPos = worldToGrid(worldPos);
      setMouseGridPos(gridPos);

      // Update brush preview
      brushPreviewRef.current?.setPosition(worldPos.x, worldPos.z);
      brushPreviewRef.current?.showForTool(activeTool, brushSize);
    }

    if (paintingState.current.isDraggingObject && paintingState.current.draggedObjectId && worldPos) {
      const gridPos = worldToGrid(worldPos);
      if (gridPos) {
        onObjectUpdate(paintingState.current.draggedObjectId, { x: gridPos.x, y: gridPos.y });
        objectsRef.current?.updateObject(paintingState.current.draggedObjectId, gridPos.x, gridPos.y);
      }
    } else if (paintingState.current.isPainting && worldPos) {
      paintAt(worldPos);
    }
  }, [activeTool, brushSize, raycastToTerrain, worldToGrid, paintAt, onObjectUpdate]);

  const handleMouseUp = useCallback(() => {
    if (paintingState.current.isPainting) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
    paintingState.current.lastPaintPos = null;
  }, [onCommitBatch]);

  const handleMouseLeave = useCallback(() => {
    brushPreviewRef.current?.setVisible(false);
    setMouseGridPos(null);

    if (paintingState.current.isPainting) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
    paintingState.current.lastPaintPos = null;
  }, [onCommitBatch]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Double click to place object
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'select') return;

    const worldPos = raycastToTerrain(e.clientX, e.clientY);
    if (!worldPos) return;

    const gridPos = worldToGrid(worldPos);
    if (!gridPos) return;

    const firstObjType = config.objectTypes[0];
    if (firstObjType) {
      onObjectAdd({
        type: firstObjType.id,
        x: gridPos.x,
        y: gridPos.y,
        radius: firstObjType.defaultRadius,
        properties: {},
      });
    }
  }, [activeTool, config.objectTypes, raycastToTerrain, worldToGrid, onObjectAdd]);

  // Get cursor style
  const getCursor = () => {
    if (paintingState.current.isDraggingObject) return 'move';
    if (activeTool === 'select') return 'default';
    return 'crosshair';
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-lg overflow-hidden"
      style={{ backgroundColor: config.theme.surface }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: getCursor() }}
      />

      {/* Zoom indicator */}
      <div
        className="absolute bottom-3 right-3 px-2 py-1 rounded text-xs"
        style={{
          backgroundColor: `${config.theme.surface}cc`,
          color: config.theme.text.secondary,
        }}
      >
        Zoom: {currentZoom}
      </div>

      {/* Grid position */}
      {mouseGridPos && (
        <div
          className="absolute bottom-3 left-3 px-2 py-1 rounded text-xs font-mono"
          style={{
            backgroundColor: `${config.theme.surface}cc`,
            color: config.theme.text.secondary,
          }}
        >
          {mouseGridPos.x}, {mouseGridPos.y}
        </div>
      )}

      {/* Instructions */}
      <div
        className="absolute top-3 left-3 px-3 py-2 rounded text-xs"
        style={{
          backgroundColor: `${config.theme.surface}cc`,
          color: config.theme.text.muted,
        }}
      >
        Scroll to zoom • Middle-drag to rotate • Arrow keys to pan • Click to paint
      </div>
    </div>
  );
}

export default Editor3DCanvas;
