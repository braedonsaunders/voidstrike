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
import type { EditorConfig, EditorState, EditorCell, EditorObject } from '../config/EditorConfig';
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
  visibility: {
    labels: boolean;
    grid: boolean;
    categories: Record<string, boolean>;
  };
  edgeScrollEnabled: boolean;
  onCellsUpdateBatched: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  onStartBatch: () => void;
  onCommitBatch: () => void;
  onFillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;
  onObjectSelect: (ids: string[]) => void;
  onObjectUpdate: (id: string, updates: { x?: number; y?: number }) => void;
  onObjectAdd: (obj: { type: string; x: number; y: number; radius?: number; properties?: Record<string, unknown> }) => string;
  // Enhanced UI callbacks
  onCursorMove?: (gridPos: { x: number; y: number } | null, worldPos: { x: number; y: number; z: number } | null) => void;
  onObjectHover?: (obj: EditorObject | null) => void;
  onContextMenu?: (e: { clientX: number; clientY: number }, gridPos: { x: number; y: number } | null, objectAtPosition: EditorObject | null) => void;
  onViewportChange?: (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => void;
  onNavigateRef?: (fn: (x: number, y: number) => void) => void;
}

export function Editor3DCanvas({
  config,
  state,
  visibility,
  edgeScrollEnabled,
  onCellsUpdateBatched,
  onStartBatch,
  onCommitBatch,
  onFillArea,
  onObjectSelect,
  onObjectUpdate,
  onObjectAdd,
  onCursorMove,
  onObjectHover,
  onContextMenu,
  onViewportChange,
  onNavigateRef,
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
  const hoveredObjectRef = useRef<EditorObject | null>(null);

  // Painting state
  const paintingState = useRef({
    isPainting: false,
    isDraggingObject: false,
    draggedObjectId: null as string | null,
    lastPaintPos: null as { x: number; y: number } | null,
    // Shape tool state (ramp, line, rect, ellipse, platform_rect, platform_ramp)
    shapeStartPos: null as { x: number; y: number } | null,
    isDrawingShape: false,
    activeShapeType: null as 'ramp' | 'line' | 'rect' | 'ellipse' | 'platform_rect' | 'platform_ramp' | null,
    // Polygon tool state (for platform_polygon)
    isDrawingPolygon: false,
    polygonVertices: [] as Array<{ x: number; y: number }>,
  });

  // Performance: track last frame time
  const lastFrameTimeRef = useRef(0);

  const { mapData, activeTool, selectedElevation, selectedFeature, selectedMaterial, brushSize, selectedObjects } = state;

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
    scene.add(brushPreview.shapeMesh); // Shape preview for line/rect/ellipse/ramp

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
      edgeScrollSpeed: 50, // Edge panning enabled
      edgeScrollThreshold: 40,
    });
    rtsCameraRef.current = rtsCamera;

    // Set right edge offset for edge scrolling to account for right panel (256px = w-64)
    rtsCamera.setEdgeScrollRightOffset(256);

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

  // Update object properties (like scale) when they change
  useEffect(() => {
    if (!isInitialized || !mapData) return;

    // Update scale for all objects that have it
    for (const obj of mapData.objects) {
      if (obj.properties?.scale !== undefined) {
        objectsRef.current?.updateObjectScale(obj.id, obj.properties.scale as number);
      }
    }
  }, [isInitialized, mapData?.objects]);

  // Update biome
  useEffect(() => {
    if (!isInitialized || !mapData) return;
    terrainRef.current?.setBiome(mapData.biomeId);
  }, [isInitialized, mapData?.biomeId]);

  // Update visibility
  useEffect(() => {
    if (!isInitialized) return;

    // Labels visibility
    objectsRef.current?.setLabelsVisible(visibility.labels);

    // Grid visibility
    if (gridRef.current) {
      gridRef.current.mesh.visible = visibility.grid;
    }

    // Category visibility
    for (const [category, visible] of Object.entries(visibility.categories)) {
      objectsRef.current?.setCategoryVisible(category, visible);
    }
  }, [isInitialized, visibility]);

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

  // Control edge scrolling based on prop
  useEffect(() => {
    if (rtsCameraRef.current) {
      rtsCameraRef.current.setEdgeScrollEnabled(edgeScrollEnabled);
    }
  }, [edgeScrollEnabled]);

  // Expose navigate function for mini-map
  useEffect(() => {
    if (!onNavigateRef || !rtsCameraRef.current) return;

    const navigateTo = (x: number, y: number) => {
      rtsCameraRef.current?.setPosition(x, y);
    };

    onNavigateRef(navigateTo);
  }, [onNavigateRef, isInitialized]);

  // Track viewport bounds for mini-map
  useEffect(() => {
    if (!onViewportChange || !rtsCameraRef.current || !mapData) return;

    const updateViewport = () => {
      if (!rtsCameraRef.current || !containerRef.current) return;

      const camera = rtsCameraRef.current.camera;
      const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      const fov = camera.fov * (Math.PI / 180);
      const distance = camera.position.y;

      // Approximate visible area based on camera parameters
      const visibleHeight = 2 * Math.tan(fov / 2) * distance;
      const visibleWidth = visibleHeight * aspect;

      const camPos = rtsCameraRef.current.getPosition();
      const halfWidth = visibleWidth / 2;
      const halfHeight = visibleHeight / 2;

      onViewportChange({
        minX: Math.max(0, camPos.x - halfWidth),
        maxX: Math.min(mapData.width, camPos.x + halfWidth),
        minY: Math.max(0, camPos.z - halfHeight),
        maxY: Math.min(mapData.height, camPos.z + halfHeight),
      });
    };

    // Update on interval while mounted
    const intervalId = setInterval(updateViewport, 100);
    updateViewport(); // Initial update

    return () => clearInterval(intervalId);
  }, [onViewportChange, mapData?.width, mapData?.height, isInitialized]);

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

    // Ensure brush always has the latest mapData
    terrainBrushRef.current.setMapData(mapData);

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
        // Apply selected material if one is explicitly selected (not auto/0)
        if (selectedMaterial > 0) {
          updates = updates.map((u) => ({
            ...u,
            cell: { ...u.cell, materialId: selectedMaterial },
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

      case 'raise':
        updates = terrainBrushRef.current.raiseElevation(
          gridPos.x,
          gridPos.y,
          brushSize,
          (toolOptions.amount as number) ?? 15
        );
        break;

      case 'lower':
        updates = terrainBrushRef.current.lowerElevation(
          gridPos.x,
          gridPos.y,
          brushSize,
          (toolOptions.amount as number) ?? 15
        );
        break;

      case 'smooth':
        updates = terrainBrushRef.current.smoothTerrain(
          gridPos.x,
          gridPos.y,
          brushSize
        );
        break;

      case 'noise':
        updates = terrainBrushRef.current.paintNoise(
          gridPos.x,
          gridPos.y,
          brushSize,
          (toolOptions.intensity as number) ?? 20
        );
        break;

      // Shape tools are handled in mouseUp, not here
      case 'ramp':
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'platform_rect':
      case 'platform_polygon':
        return;

      // Platform brush tool - paint platform terrain
      case 'platform_brush':
        updates = terrainBrushRef.current.paintPlatform(
          gridPos.x,
          gridPos.y,
          brushSize,
          paintElevation
        );
        break;

      // Convert existing terrain to platform
      case 'convert_platform':
        updates = terrainBrushRef.current.convertToPlatform(
          gridPos.x,
          gridPos.y,
          brushSize
        );
        break;

      // Edge style tool - cycle edge style on click (handled specially)
      case 'edge_style':
        // Edge style is a click tool, not continuous painting
        return;

      default:
        return;
    }

    if (updates.length > 0) {
      onCellsUpdateBatched(updates);
      terrainRef.current?.markCellsDirty(updates.map((u) => ({ x: u.x, y: u.y })));
    }
  }, [mapData, config, activeTool, selectedElevation, selectedFeature, selectedMaterial, brushSize, worldToGrid, onCellsUpdateBatched, onFillArea]);

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
        const tool = config.tools.find((t) => t.id === activeTool);
        const shapeTypes = ['ramp', 'line', 'rect', 'ellipse', 'platform_rect', 'platform_ramp'];

        // Shape tools: click and drag to draw between two points
        if (tool && shapeTypes.includes(tool.type)) {
          const gridPos = worldToGrid(worldPos);
          if (gridPos) {
            paintingState.current.shapeStartPos = gridPos;
            paintingState.current.isDrawingShape = true;
            paintingState.current.activeShapeType = tool.type as 'ramp' | 'line' | 'rect' | 'ellipse' | 'platform_rect' | 'platform_ramp';
            onStartBatch();
            // Start shape preview (use 'rect' for platform_rect, 'ramp' for platform_ramp)
            brushPreviewRef.current?.startShapePreview(
              tool.type === 'platform_rect' ? 'rect' : tool.type === 'platform_ramp' ? 'ramp' : tool.type as 'ramp' | 'line' | 'rect' | 'ellipse',
              worldPos.x,
              worldPos.z
            );
          }
        } else if (tool && tool.type === 'platform_polygon') {
          // Polygon tool: click to add vertices
          const gridPos = worldToGrid(worldPos);
          if (gridPos) {
            if (!paintingState.current.isDrawingPolygon) {
              // Start new polygon
              paintingState.current.isDrawingPolygon = true;
              paintingState.current.polygonVertices = [gridPos];
              onStartBatch();
            } else {
              // Check if closing the polygon (click near first vertex)
              const firstVertex = paintingState.current.polygonVertices[0];
              const dist = Math.sqrt(
                Math.pow(gridPos.x - firstVertex.x, 2) +
                Math.pow(gridPos.y - firstVertex.y, 2)
              );
              if (dist < 2 && paintingState.current.polygonVertices.length >= 3) {
                // Close and complete the polygon
                if (terrainBrushRef.current && mapData) {
                  terrainBrushRef.current.setMapData(mapData);
                  const updates = terrainBrushRef.current.paintPlatformPolygon(
                    paintingState.current.polygonVertices,
                    selectedElevation
                  );
                  if (updates.length > 0) {
                    onCellsUpdateBatched(updates);
                    terrainRef.current?.markCellsDirty(updates.map((u) => ({ x: u.x, y: u.y })));
                  }
                }
                onCommitBatch();
                terrainRef.current?.updateDirtyChunks();
                paintingState.current.isDrawingPolygon = false;
                paintingState.current.polygonVertices = [];
              } else {
                // Add vertex
                paintingState.current.polygonVertices.push(gridPos);
              }
            }
          }
        } else if (tool && tool.type === 'edge_style') {
          // Edge style tool: cycle edge style on platform cells
          const gridPos = worldToGrid(worldPos);
          if (gridPos && mapData && terrainBrushRef.current) {
            const cell = mapData.terrain[gridPos.y]?.[gridPos.x];
            if (cell?.isPlatform) {
              // Determine which edge is closest to click position
              const fracX = worldPos.x - gridPos.x;
              const fracZ = worldPos.z - gridPos.y;
              let edge: 'north' | 'south' | 'east' | 'west';

              // Determine closest edge based on fractional position in cell
              if (fracZ < 0.25) edge = 'north';
              else if (fracZ > 0.75) edge = 'south';
              else if (fracX < 0.25) edge = 'west';
              else if (fracX > 0.75) edge = 'east';
              else edge = 'north'; // Default to north if in center

              // Cycle style: cliff -> natural -> ramp -> cliff
              const currentStyle = cell.edges?.[edge] || 'cliff';
              const styles: Array<'cliff' | 'natural' | 'ramp'> = ['cliff', 'natural', 'ramp'];
              const nextStyle = styles[(styles.indexOf(currentStyle as 'cliff' | 'natural' | 'ramp') + 1) % 3];

              terrainBrushRef.current.setMapData(mapData);
              const updates = terrainBrushRef.current.setPlatformEdgeStyle(gridPos.x, gridPos.y, edge, nextStyle);
              if (updates.length > 0) {
                onStartBatch();
                onCellsUpdateBatched(updates);
                terrainRef.current?.markCellsDirty(updates.map((u) => ({ x: u.x, y: u.y })));
                onCommitBatch();
                terrainRef.current?.updateDirtyChunks();
              }
            }
          }
        } else {
          // Standard painting tools (brush, eraser, plateau, raise, lower, smooth, noise, platform_brush, convert_platform)
          onStartBatch();
          paintingState.current.isPainting = true;
          paintingState.current.lastPaintPos = null;
          paintAt(worldPos, true);
        }
      }
    }
  }, [mapData, activeTool, selectedObjects, selectedElevation, raycastToTerrain, paintAt, onObjectSelect, onStartBatch, onCommitBatch, onCellsUpdateBatched, config.tools, worldToGrid]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = raycastToTerrain(e.clientX, e.clientY);

    if (worldPos) {
      const gridPos = worldToGrid(worldPos);
      setMouseGridPos(gridPos);

      // Call cursor move callback for status bar
      onCursorMove?.(gridPos, { x: worldPos.x, y: worldPos.y, z: worldPos.z });

      // Update brush preview - pass Y from raycast to avoid offset on slopes
      brushPreviewRef.current?.setPosition(worldPos.x, worldPos.z, worldPos.y);
      // Get material color if a material is selected
      const materialColor = selectedMaterial > 0
        ? config.terrain.materials?.find((m) => m.id === selectedMaterial)?.color
        : undefined;
      brushPreviewRef.current?.showForTool(activeTool, brushSize, materialColor);

      // Track hovered object
      if (rtsCameraRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        mouseVecRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseVecRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseVecRef.current, rtsCameraRef.current.camera);
        const hoveredId = objectsRef.current?.findObjectAt(raycasterRef.current);
        const hoveredObj = hoveredId ? mapData?.objects.find(o => o.id === hoveredId) || null : null;
        if (hoveredObj !== hoveredObjectRef.current) {
          hoveredObjectRef.current = hoveredObj;
          onObjectHover?.(hoveredObj);
        }
      }
    } else {
      onCursorMove?.(null, null);
      if (hoveredObjectRef.current) {
        hoveredObjectRef.current = null;
        onObjectHover?.(null);
      }
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

    // Update shape preview while dragging
    if (paintingState.current.isDrawingShape && worldPos) {
      brushPreviewRef.current?.updateShapePreview(worldPos.x, worldPos.z);
    }
  }, [activeTool, brushSize, selectedMaterial, config, raycastToTerrain, worldToGrid, paintAt, onObjectUpdate, onCursorMove, onObjectHover, mapData?.objects]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Handle shape tool completion (ramp, line, rect, ellipse)
    if (paintingState.current.isDrawingShape && paintingState.current.shapeStartPos) {
      const worldPos = raycastToTerrain(e.clientX, e.clientY);
      if (worldPos && terrainBrushRef.current && mapData) {
        const endPos = worldToGrid(worldPos);
        if (endPos) {
          const startPos = paintingState.current.shapeStartPos;
          const shapeType = paintingState.current.activeShapeType;
          terrainBrushRef.current.setMapData(mapData);

          let updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }> = [];

          switch (shapeType) {
            case 'ramp':
              updates = terrainBrushRef.current.paintRamp(
                startPos.x, startPos.y,
                endPos.x, endPos.y,
                brushSize
              );
              break;

            case 'line':
              updates = terrainBrushRef.current.paintLine(
                startPos.x, startPos.y,
                endPos.x, endPos.y,
                brushSize,
                selectedElevation
              );
              break;

            case 'rect':
              updates = terrainBrushRef.current.paintRect(
                startPos.x, startPos.y,
                endPos.x, endPos.y,
                selectedElevation
              );
              break;

            case 'ellipse': {
              // For ellipse, calculate center and radii from drag bounds
              const centerX = (startPos.x + endPos.x) / 2;
              const centerY = (startPos.y + endPos.y) / 2;
              const radiusX = Math.abs(endPos.x - startPos.x) / 2;
              const radiusY = Math.abs(endPos.y - startPos.y) / 2;
              updates = terrainBrushRef.current.paintEllipse(
                centerX, centerY,
                radiusX, radiusY,
                selectedElevation
              );
              break;
            }

            case 'platform_rect':
              updates = terrainBrushRef.current.paintPlatformRect(
                startPos.x, startPos.y,
                endPos.x, endPos.y,
                selectedElevation
              );
              break;

            case 'platform_ramp':
              updates = terrainBrushRef.current.paintPlatformRamp(
                startPos.x, startPos.y,
                endPos.x, endPos.y,
                brushSize,
                state.snapMode
              );
              break;
          }

          if (updates.length > 0) {
            onCellsUpdateBatched(updates);
            terrainRef.current?.markCellsDirty(updates.map((u) => ({ x: u.x, y: u.y })));
          }
        }
      }
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
      paintingState.current.isDrawingShape = false;
      paintingState.current.shapeStartPos = null;
      paintingState.current.activeShapeType = null;
      brushPreviewRef.current?.endShapePreview();
    }

    if (paintingState.current.isPainting) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
    paintingState.current.lastPaintPos = null;
  }, [onCommitBatch, raycastToTerrain, worldToGrid, mapData, brushSize, selectedElevation, onCellsUpdateBatched]);

  const handleMouseLeave = useCallback(() => {
    brushPreviewRef.current?.setVisible(false);
    setMouseGridPos(null);

    if (paintingState.current.isPainting || paintingState.current.isDrawingShape || paintingState.current.isDrawingPolygon) {
      onCommitBatch();
      terrainRef.current?.updateDirtyChunks();
    }

    paintingState.current.isPainting = false;
    paintingState.current.isDraggingObject = false;
    paintingState.current.draggedObjectId = null;
    paintingState.current.lastPaintPos = null;
    paintingState.current.isDrawingShape = false;
    paintingState.current.shapeStartPos = null;
    paintingState.current.activeShapeType = null;
    paintingState.current.isDrawingPolygon = false;
    paintingState.current.polygonVertices = [];
    brushPreviewRef.current?.endShapePreview();
  }, [onCommitBatch]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    // Get world/grid position and object at cursor
    const worldPos = raycastToTerrain(e.clientX, e.clientY);
    const gridPos = worldPos ? worldToGrid(worldPos) : null;

    // Check for object at cursor
    let objectAtPosition: EditorObject | null = null;
    if (rtsCameraRef.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      mouseVecRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseVecRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseVecRef.current, rtsCameraRef.current.camera);
      const hoveredId = objectsRef.current?.findObjectAt(raycasterRef.current);
      objectAtPosition = hoveredId ? mapData?.objects.find(o => o.id === hoveredId) || null : null;
    }

    onContextMenu?.({ clientX: e.clientX, clientY: e.clientY }, gridPos, objectAtPosition);
  }, [raycastToTerrain, worldToGrid, mapData?.objects, onContextMenu]);

  // Double click handler - currently disabled to prevent accidental object creation
  // Objects should be added from the panel instead
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Intentionally empty - double-click was causing accidental object creation
    // when trying to select objects quickly
  }, []);

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
        Scroll zoom • Middle-drag rotate • Edge/arrows pan • Click paint
      </div>
    </div>
  );
}

export default Editor3DCanvas;
