/**
 * Editor3DCanvas - The main 3D canvas for the map editor
 *
 * Replaces the 2D EditorCanvas with a full Three.js 3D viewport.
 * Supports terrain painting, object placement, and camera controls.
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
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const terrainRef = useRef<EditorTerrain | null>(null);
  const objectsRef = useRef<EditorObjects | null>(null);
  const gridRef = useRef<EditorGrid | null>(null);
  const brushPreviewRef = useRef<EditorBrushPreview | null>(null);

  // Tools
  const terrainBrushRef = useRef<TerrainBrush | null>(null);
  const objectPlacerRef = useRef<ObjectPlacer | null>(null);

  // Raycasting
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseVecRef = useRef<THREE.Vector2>(new THREE.Vector2());

  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [mouseGridPos, setMouseGridPos] = useState<{ x: number; y: number } | null>(null);

  // Camera state
  const cameraState = useRef({
    target: new THREE.Vector3(64, 0, 64),
    distance: 80,
    angle: 0,
    pitch: Math.PI / 4,
    isPanning: false,
    isRotating: false,
    lastMouse: { x: 0, y: 0 },
  });

  // Painting state
  const paintingState = useRef({
    isPainting: false,
    isDraggingObject: false,
    draggedObjectId: null as string | null,
  });

  const { mapData, activeTool, selectedElevation, selectedFeature, brushSize, selectedObjects } = state;

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(config.theme.background);
    sceneRef.current = scene;

    // Camera
    const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.5, 500);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xfff8e0, 1.2);
    directionalLight.position.set(50, 80, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
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

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      renderer.dispose();
      terrain.dispose();
      objects.dispose();
      brushPreview.dispose();
    };
  }, [config]);

  // Update camera position
  const updateCamera = useCallback(() => {
    if (!cameraRef.current) return;

    const { target, distance, angle, pitch } = cameraState.current;

    const x = target.x + distance * Math.sin(angle) * Math.cos(pitch);
    const y = target.y + distance * Math.sin(pitch);
    const z = target.z + distance * Math.cos(angle) * Math.cos(pitch);

    cameraRef.current.position.set(x, y, z);
    cameraRef.current.lookAt(target);
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

    // Create grid
    if (gridRef.current) {
      gridRef.current.dispose();
    }
    const grid = new EditorGrid({
      width: mapData.width,
      height: mapData.height,
      cellSize: 1,
      color: parseInt(config.theme.primary.replace('#', ''), 16),
      opacity: 0.1,
    });
    gridRef.current = grid;
    sceneRef.current?.add(grid.mesh);
    grid.updateHeights(getHeight);

    // Update tools
    terrainBrushRef.current?.setMapData(mapData);
    objectPlacerRef.current?.setMapData(mapData);

    // Center camera on map
    cameraState.current.target.set(mapData.width / 2, 0, mapData.height / 2);
    cameraState.current.distance = Math.max(mapData.width, mapData.height) * 0.6;
    updateCamera();
  }, [isInitialized, mapData, config.theme.primary, updateCamera]);

  // Update terrain when map changes
  useEffect(() => {
    if (!isInitialized || !mapData || !terrainRef.current) return;
    terrainRef.current.forceUpdate();
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

  // Raycast to terrain
  const raycastToTerrain = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    if (!containerRef.current || !cameraRef.current || !terrainRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    mouseVecRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseVecRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseVecRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObject(terrainRef.current.mesh);

    if (intersects.length > 0) {
      return intersects[0].point;
    }

    // Fallback: intersect with ground plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycasterRef.current.ray.intersectPlane(plane, target);
    return target;
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

  // Paint at position
  const paintAt = useCallback((worldPos: THREE.Vector3, force: boolean = false) => {
    if (!mapData || !terrainBrushRef.current) return;

    const gridPos = worldToGrid(worldPos);
    if (!gridPos) return;

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
        // Also apply feature
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

    const worldPos = raycastToTerrain(e.clientX, e.clientY);
    if (!worldPos) return;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle button or Alt+click = pan
      cameraState.current.isPanning = true;
      cameraState.current.lastMouse = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      // Right button or Shift+click = rotate
      cameraState.current.isRotating = true;
      cameraState.current.lastMouse = { x: e.clientX, y: e.clientY };
    } else if (e.button === 0) {
      // Left click
      if (activeTool === 'select') {
        // Check if clicking on an object
        if (cameraRef.current) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            mouseVecRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseVecRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycasterRef.current.setFromCamera(mouseVecRef.current, cameraRef.current);
          }
        }

        const clickedObjId = objectsRef.current?.findObjectAt(raycasterRef.current);
        if (clickedObjId) {
          if (e.ctrlKey || e.metaKey) {
            // Add to selection
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

    if (cameraState.current.isPanning) {
      const dx = e.clientX - cameraState.current.lastMouse.x;
      const dy = e.clientY - cameraState.current.lastMouse.y;

      const panSpeed = 0.5;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraRef.current!.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRef.current!.quaternion);
      right.y = 0;
      right.normalize();

      cameraState.current.target.addScaledVector(right, -dx * panSpeed);
      cameraState.current.target.addScaledVector(forward, dy * panSpeed);
      cameraState.current.lastMouse = { x: e.clientX, y: e.clientY };

      updateCamera();
    } else if (cameraState.current.isRotating) {
      const dx = e.clientX - cameraState.current.lastMouse.x;
      const dy = e.clientY - cameraState.current.lastMouse.y;

      cameraState.current.angle -= dx * 0.01;
      cameraState.current.pitch = Math.max(0.2, Math.min(Math.PI / 2 - 0.1, cameraState.current.pitch + dy * 0.01));
      cameraState.current.lastMouse = { x: e.clientX, y: e.clientY };

      updateCamera();
    } else if (paintingState.current.isDraggingObject && paintingState.current.draggedObjectId && worldPos) {
      const gridPos = worldToGrid(worldPos);
      if (gridPos) {
        onObjectUpdate(paintingState.current.draggedObjectId, { x: gridPos.x, y: gridPos.y });
        objectsRef.current?.updateObject(paintingState.current.draggedObjectId, gridPos.x, gridPos.y);
      }
    } else if (paintingState.current.isPainting && worldPos) {
      paintAt(worldPos);
    }
  }, [activeTool, brushSize, raycastToTerrain, worldToGrid, paintAt, updateCamera, onObjectUpdate]);

  const handleMouseUp = useCallback(() => {
    if (paintingState.current.isPainting) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    cameraState.current.isPanning = false;
    cameraState.current.isRotating = false;
    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
  }, [onCommitBatch]);

  const handleMouseLeave = useCallback(() => {
    brushPreviewRef.current?.setVisible(false);
    setMouseGridPos(null);

    if (paintingState.current.isPainting) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    cameraState.current.isPanning = false;
    cameraState.current.isRotating = false;
    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
  }, [onCommitBatch]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    cameraState.current.distance = Math.max(20, Math.min(200, cameraState.current.distance * delta));

    updateCamera();
  }, [updateCamera]);

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

    // Get first object type for quick placement
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
    if (cameraState.current.isPanning) return 'grabbing';
    if (cameraState.current.isRotating) return 'grabbing';
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
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: getCursor() }}
      />

      {/* Camera distance indicator */}
      <div
        className="absolute bottom-3 right-3 px-2 py-1 rounded text-xs"
        style={{
          backgroundColor: `${config.theme.surface}cc`,
          color: config.theme.text.secondary,
        }}
      >
        Zoom: {Math.round(cameraState.current.distance)}
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
        Scroll to zoom • Alt+drag to pan • Right-drag to rotate • Click to paint
      </div>
    </div>
  );
}

export default Editor3DCanvas;
