/**
 * EditorCanvas - The main canvas for viewing and editing the map
 */

'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { EditorConfig, EditorState, EditorCell } from '../config/EditorConfig';

export interface EditorCanvasProps {
  config: EditorConfig;
  state: EditorState;
  onZoomChange: (zoom: number) => void;
  onOffsetChange: (offset: { x: number; y: number }) => void;
  onCellUpdate: (x: number, y: number, updates: Partial<EditorCell>) => void;
  onCellsUpdate: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  onCellsUpdateBatched: (updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }>) => void;
  onStartBatch: () => void;
  onCommitBatch: () => void;
  onFillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;
  onObjectSelect: (ids: string[]) => void;
  onObjectUpdate: (id: string, updates: { x?: number; y?: number }) => void;
}

export function EditorCanvas({
  config,
  state,
  onZoomChange,
  onOffsetChange,
  onCellsUpdateBatched,
  onStartBatch,
  onCommitBatch,
  onFillArea,
  onObjectSelect,
  onObjectUpdate,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [isDraggingObject, setIsDraggingObject] = useState(false);
  const [draggedObjectId, setDraggedObjectId] = useState<string | null>(null);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [mouseGridPos, setMouseGridPos] = useState<{ x: number; y: number } | null>(null);
  const lastPaintedRef = useRef<string | null>(null);

  const { mapData, zoom, offset, activeTool, selectedElevation, selectedFeature, selectedMaterial, brushSize } = state;

  // Get biome colors
  const biome = config.biomes.find((b) => b.id === state.activeBiome) || config.biomes[0];

  // Convert screen position to grid position
  const screenToGrid = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } | null => {
      if (!mapData || !canvasRef.current) return null;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const canvasX = (screenX - rect.left) * scaleX;
      const canvasY = (screenY - rect.top) * scaleY;

      const cellSize = Math.max(2, Math.floor(zoom / 10));
      const startX = (canvas.width - mapData.width * cellSize) / 2 + offset.x;
      const startY = (canvas.height - mapData.height * cellSize) / 2 + offset.y;

      const gridX = Math.floor((canvasX - startX) / cellSize);
      const gridY = Math.floor((canvasY - startY) / cellSize);

      // Return position even if out of bounds for object placement
      return { x: gridX, y: gridY };
    },
    [mapData, zoom, offset]
  );

  // Check if position is within map bounds
  const isInBounds = useCallback(
    (x: number, y: number): boolean => {
      if (!mapData) return false;
      return x >= 0 && x < mapData.width && y >= 0 && y < mapData.height;
    },
    [mapData]
  );

  // Find object at position
  const findObjectAt = useCallback(
    (gridX: number, gridY: number): string | null => {
      if (!mapData) return null;

      for (const obj of mapData.objects) {
        const objType = config.objectTypes.find((t) => t.id === obj.type);
        const radius = obj.radius || objType?.defaultRadius || 5;
        const dx = obj.x - gridX;
        const dy = obj.y - gridY;
        if (dx * dx + dy * dy <= radius * radius) {
          return obj.id;
        }
      }
      return null;
    },
    [mapData, config.objectTypes]
  );

  // Paint at grid position
  const paintAt = useCallback(
    (gridX: number, gridY: number, force = false) => {
      if (!mapData) return;
      if (!isInBounds(gridX, gridY)) return;

      // Debounce to avoid painting same cell multiple times in a stroke
      const key = `${gridX},${gridY}`;
      if (!force && lastPaintedRef.current === key) return;
      lastPaintedRef.current = key;

      const tool = config.tools.find((t) => t.id === activeTool);
      if (!tool) return;

      // Get default values from tool options or current selection
      const toolOptions = (tool as any).options || {};
      const paintElevation = toolOptions.elevation ?? selectedElevation;
      const paintFeature = toolOptions.feature ?? selectedFeature;
      const paintWalkable = toolOptions.walkable !== undefined
        ? toolOptions.walkable
        : (config.terrain.elevations.find((e) => e.id === paintElevation)?.walkable ?? true);

      if (tool.type === 'brush' || tool.type === 'eraser') {
        // Brush/eraser: paint in a circular area
        const updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }> = [];
        const radius = brushSize;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              const x = gridX + dx;
              const y = gridY + dy;
              if (isInBounds(x, y)) {
                if (tool.type === 'eraser') {
                  updates.push({
                    x,
                    y,
                    cell: {
                      elevation: config.terrain.defaultElevation,
                      feature: config.terrain.defaultFeature,
                      walkable: true,
                      materialId: 0,
                    },
                  });
                } else {
                  updates.push({
                    x,
                    y,
                    cell: {
                      elevation: paintElevation,
                      feature: paintFeature,
                      walkable: paintWalkable,
                      materialId: selectedMaterial,
                    },
                  });
                }
              }
            }
          }
        }

        if (updates.length > 0) {
          onCellsUpdateBatched(updates);
        }
      } else if (tool.type === 'fill') {
        // Flood fill
        const targetElevation = mapData.terrain[gridY]?.[gridX]?.elevation;
        if (targetElevation !== undefined && targetElevation !== selectedElevation) {
          onFillArea(gridX, gridY, targetElevation, selectedElevation);
        }
      } else if (tool.type === 'plateau') {
        // Create circular plateau
        const updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }> = [];
        const radius = brushSize;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              const x = gridX + dx;
              const y = gridY + dy;
              if (isInBounds(x, y)) {
                updates.push({
                  x,
                  y,
                  cell: {
                    elevation: selectedElevation,
                    walkable,
                    materialId: selectedMaterial,
                  },
                });
              }
            }
          }
        }

        if (updates.length > 0) {
          onCellsUpdateBatched(updates);
        }
      }
    },
    [mapData, config, activeTool, selectedElevation, selectedFeature, selectedMaterial, brushSize, isInBounds, onCellsUpdateBatched, onFillArea]
  );

  // Draw the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = config.theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate grid dimensions
    const cellSize = Math.max(2, Math.floor(zoom / 10));
    const startX = (canvas.width - mapData.width * cellSize) / 2 + offset.x;
    const startY = (canvas.height - mapData.height * cellSize) / 2 + offset.y;

    // Draw terrain
    const { terrain } = mapData;
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const cell = terrain[y]?.[x];
        if (!cell) continue;

        // Get color based on elevation
        let color: string;
        if (!cell.walkable) {
          // Unwalkable terrain
          const elevConfig = config.terrain.elevations.find((e) => !e.walkable && cell.elevation <= e.id);
          color = elevConfig?.color || '#1a0a2e';
        } else {
          // Map elevation to ground color index
          const elevRange = (config.terrain.elevationMax || 255) - (config.terrain.elevationMin || 0);
          const normalizedElev = (cell.elevation - (config.terrain.elevationMin || 0)) / elevRange;
          const colorIndex = Math.min(
            Math.floor(normalizedElev * biome.groundColors.length),
            biome.groundColors.length - 1
          );
          color = biome.groundColors[Math.max(0, colorIndex)];

          // If explicit material is set (not 0/auto), use material color
          if (cell.materialId && cell.materialId > 0) {
            const material = config.terrain.materials?.find((m) => m.id === cell.materialId);
            if (material) {
              color = material.color;
            }
          }
        }

        // Apply feature color overlay
        if (cell.feature && cell.feature !== 'none') {
          const feature = config.terrain.features.find((f) => f.id === cell.feature);
          if (feature && feature.color !== 'transparent') {
            color = feature.color;
          }
        }

        ctx.fillStyle = color;
        ctx.fillRect(startX + x * cellSize, startY + y * cellSize, cellSize, cellSize);
      }
    }

    // Draw grid lines
    if (config.canvas.showGrid && cellSize >= 4) {
      ctx.strokeStyle = biome.gridColor || 'rgba(132, 61, 255, 0.1)';
      ctx.lineWidth = 0.5;

      for (let x = 0; x <= mapData.width; x++) {
        ctx.beginPath();
        ctx.moveTo(startX + x * cellSize, startY);
        ctx.lineTo(startX + x * cellSize, startY + mapData.height * cellSize);
        ctx.stroke();
      }

      for (let y = 0; y <= mapData.height; y++) {
        ctx.beginPath();
        ctx.moveTo(startX, startY + y * cellSize);
        ctx.lineTo(startX + mapData.width * cellSize, startY + y * cellSize);
        ctx.stroke();
      }
    }

    // Draw objects
    for (const obj of mapData.objects) {
      const objType = config.objectTypes.find((t) => t.id === obj.type);
      if (!objType) continue;

      const objX = startX + obj.x * cellSize;
      const objY = startY + obj.y * cellSize;
      const radius = (obj.radius || objType.defaultRadius || 5) * (cellSize / 4);

      // Draw object fill
      ctx.fillStyle = `${objType.color}40`;
      ctx.beginPath();
      ctx.arc(objX, objY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Draw object circle
      ctx.strokeStyle = objType.color;
      ctx.lineWidth = state.selectedObjects.includes(obj.id) ? 3 : 2;
      ctx.stroke();

      // Draw selection highlight
      if (state.selectedObjects.includes(obj.id)) {
        ctx.strokeStyle = config.theme.selection;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(objX, objY, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw object icon/label
      ctx.fillStyle = objType.color;
      ctx.font = `${Math.max(10, cellSize * 2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(objType.icon, objX, objY);
    }

    // Draw brush preview
    if (mouseGridPos && (activeTool === 'brush' || activeTool === 'eraser' || activeTool === 'plateau')) {
      const radius = brushSize * cellSize;
      ctx.strokeStyle = config.theme.selection;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(
        startX + mouseGridPos.x * cellSize + cellSize / 2,
        startY + mouseGridPos.y * cellSize + cellSize / 2,
        radius,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [mapData, zoom, offset, config, biome, state.selectedObjects, activeTool, brushSize, mouseGridPos]);

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const gridPos = screenToGrid(e.clientX, e.clientY);

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle button or Alt+click = pan
        setIsPanning(true);
        setLastMouse({ x: e.clientX, y: e.clientY });
      } else if (e.button === 0 && gridPos) {
        if (activeTool === 'select') {
          // Check if clicking on an object
          const clickedObjId = findObjectAt(gridPos.x, gridPos.y);

          if (clickedObjId) {
            if (e.shiftKey) {
              // Add to selection
              onObjectSelect([...state.selectedObjects, clickedObjId]);
            } else {
              // Replace selection and start dragging
              onObjectSelect([clickedObjId]);
              setIsDraggingObject(true);
              setDraggedObjectId(clickedObjId);
            }
            setLastMouse({ x: e.clientX, y: e.clientY });
          } else if (!e.shiftKey) {
            onObjectSelect([]);
          }
        } else if (isInBounds(gridPos.x, gridPos.y)) {
          // Painting tools - start batch for undo
          onStartBatch();
          setIsPainting(true);
          lastPaintedRef.current = null; // Reset debounce
          paintAt(gridPos.x, gridPos.y, true);
        }
      }
    },
    [screenToGrid, activeTool, findObjectAt, state.selectedObjects, onObjectSelect, isInBounds, paintAt, onStartBatch]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Update mouse grid position for brush preview
      const gridPos = screenToGrid(e.clientX, e.clientY);
      setMouseGridPos(gridPos);

      if (isPanning) {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        onOffsetChange({ x: offset.x + dx, y: offset.y + dy });
        setLastMouse({ x: e.clientX, y: e.clientY });
      } else if (isDraggingObject && draggedObjectId && gridPos) {
        // Move the dragged object
        if (isInBounds(gridPos.x, gridPos.y)) {
          onObjectUpdate(draggedObjectId, { x: gridPos.x, y: gridPos.y });
        }
      } else if (isPainting && gridPos) {
        paintAt(gridPos.x, gridPos.y);
      }
    },
    [screenToGrid, isPanning, isDraggingObject, draggedObjectId, isPainting, lastMouse, offset, onOffsetChange, onObjectUpdate, isInBounds, paintAt]
  );

  const handleMouseUp = useCallback(() => {
    // Commit batch if we were painting
    if (isPainting) {
      onCommitBatch();
    }
    setIsPanning(false);
    setIsPainting(false);
    setIsDraggingObject(false);
    setDraggedObjectId(null);
    lastPaintedRef.current = null;
  }, [isPainting, onCommitBatch]);

  const handleMouseLeave = useCallback(() => {
    // Commit batch if we were painting
    if (isPainting) {
      onCommitBatch();
    }
    setIsPanning(false);
    setIsPainting(false);
    setIsDraggingObject(false);
    setDraggedObjectId(null);
    setMouseGridPos(null);
    lastPaintedRef.current = null;
  }, [isPainting, onCommitBatch]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      onZoomChange(zoom + delta);
    },
    [zoom, onZoomChange]
  );

  // Get cursor style
  const getCursor = () => {
    if (isPanning) return 'grabbing';
    if (isDraggingObject) return 'move';
    if (activeTool === 'select') {
      // Check if hovering over an object
      if (mouseGridPos && findObjectAt(mouseGridPos.x, mouseGridPos.y)) {
        return 'move';
      }
      return 'default';
    }
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
    >
      <canvas
        ref={canvasRef}
        width={1200}
        height={800}
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
        {zoom}%
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
        Scroll to zoom • Alt+drag or middle-click to pan • Select tool to move objects
      </div>
    </div>
  );
}

export default EditorCanvas;
