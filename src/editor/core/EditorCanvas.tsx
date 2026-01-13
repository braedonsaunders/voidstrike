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
  onFillArea: (startX: number, startY: number, targetElevation: number, newElevation: number) => void;
  onObjectSelect: (ids: string[]) => void;
  onObjectUpdate: (id: string, updates: { x?: number; y?: number }) => void;
}

export function EditorCanvas({
  config,
  state,
  onZoomChange,
  onOffsetChange,
  onCellUpdate,
  onCellsUpdate,
  onFillArea,
  onObjectSelect,
  onObjectUpdate,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [mouseGridPos, setMouseGridPos] = useState<{ x: number; y: number } | null>(null);

  const { mapData, zoom, offset, activeTool, selectedElevation, selectedFeature, brushSize } = state;

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

      if (gridX < 0 || gridX >= mapData.width || gridY < 0 || gridY >= mapData.height) {
        return null;
      }

      return { x: gridX, y: gridY };
    },
    [mapData, zoom, offset]
  );

  // Paint at grid position
  const paintAt = useCallback(
    (gridX: number, gridY: number) => {
      if (!mapData) return;

      const tool = config.tools.find((t) => t.id === activeTool);
      if (!tool) return;

      // Get the elevation config for walkability
      const elevConfig = config.terrain.elevations.find((e) => e.id === selectedElevation);
      const walkable = elevConfig?.walkable ?? true;

      if (tool.type === 'brush' || tool.type === 'eraser') {
        // Brush/eraser: paint in a circular area
        const updates: Array<{ x: number; y: number; cell: Partial<EditorCell> }> = [];
        const radius = brushSize;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
              const x = gridX + dx;
              const y = gridY + dy;
              if (x >= 0 && x < mapData.width && y >= 0 && y < mapData.height) {
                if (tool.type === 'eraser') {
                  updates.push({
                    x,
                    y,
                    cell: {
                      elevation: config.terrain.defaultElevation,
                      feature: config.terrain.defaultFeature,
                      walkable: true,
                    },
                  });
                } else {
                  updates.push({
                    x,
                    y,
                    cell: {
                      elevation: selectedElevation,
                      feature: selectedFeature,
                      walkable,
                    },
                  });
                }
              }
            }
          }
        }

        if (updates.length > 0) {
          onCellsUpdate(updates);
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
              if (x >= 0 && x < mapData.width && y >= 0 && y < mapData.height) {
                updates.push({
                  x,
                  y,
                  cell: {
                    elevation: selectedElevation,
                    walkable,
                  },
                });
              }
            }
          }
        }

        if (updates.length > 0) {
          onCellsUpdate(updates);
        }
      }
    },
    [mapData, config, activeTool, selectedElevation, selectedFeature, brushSize, onCellsUpdate, onFillArea]
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

      // Draw object circle
      ctx.strokeStyle = objType.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(objX, objY, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw fill for selected objects
      if (state.selectedObjects.includes(obj.id)) {
        ctx.fillStyle = `${objType.color}40`;
        ctx.fill();
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
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle button or Alt+click = pan
        setIsPanning(true);
        setLastMouse({ x: e.clientX, y: e.clientY });
      } else if (e.button === 0) {
        // Left click = tool action
        const gridPos = screenToGrid(e.clientX, e.clientY);
        if (gridPos) {
          if (activeTool === 'select') {
            // Check if clicking on an object
            const clickedObj = mapData?.objects.find((obj) => {
              const dx = obj.x - gridPos.x;
              const dy = obj.y - gridPos.y;
              const objType = config.objectTypes.find((t) => t.id === obj.type);
              const radius = obj.radius || objType?.defaultRadius || 5;
              return dx * dx + dy * dy <= radius * radius;
            });

            if (clickedObj) {
              if (e.shiftKey) {
                // Add to selection
                onObjectSelect([...state.selectedObjects, clickedObj.id]);
              } else {
                // Replace selection
                onObjectSelect([clickedObj.id]);
              }
            } else if (!e.shiftKey) {
              onObjectSelect([]);
            }
          } else {
            // Painting tools
            setIsPainting(true);
            paintAt(gridPos.x, gridPos.y);
          }
        }
      }
    },
    [screenToGrid, activeTool, mapData, config.objectTypes, state.selectedObjects, onObjectSelect, paintAt]
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
      } else if (isPainting && gridPos) {
        paintAt(gridPos.x, gridPos.y);
      }
    },
    [screenToGrid, isPanning, isPainting, lastMouse, offset, onOffsetChange, paintAt]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setIsPainting(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setIsPainting(false);
    setMouseGridPos(null);
  }, []);

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
        Scroll to zoom • Alt+drag or middle-click to pan
      </div>
    </div>
  );
}

export default EditorCanvas;
