/**
 * EditorMiniMap - Mini-map overview for quick navigation
 *
 * Shows a small overview of the entire map with current viewport indicator.
 * Click to quickly navigate to any part of the map.
 */

'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { EditorConfig, EditorMapData, EditorObject } from '../config/EditorConfig';

export interface EditorMiniMapProps {
  config: EditorConfig;
  mapData: EditorMapData | null;
  objects: EditorObject[];
  viewportBounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
  onNavigate: (x: number, y: number) => void;
}

export function EditorMiniMap({
  config,
  mapData,
  objects,
  viewportBounds,
  onNavigate,
}: EditorMiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Mini-map dimensions
  const miniMapWidth = 160;
  const miniMapHeight = mapData
    ? Math.round((mapData.height / mapData.width) * miniMapWidth)
    : 100;

  // Memoize elevation color lookup
  const elevationColors = useMemo(() => {
    const colors: Record<number, string> = {};
    for (const elev of config.terrain.elevations) {
      colors[elev.id] = elev.color;
    }
    return colors;
  }, [config.terrain.elevations]);

  // Draw the mini-map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = miniMapWidth / mapData.width;
    const scaleY = miniMapHeight / mapData.height;

    // Clear
    ctx.fillStyle = config.theme.background;
    ctx.fillRect(0, 0, miniMapWidth, miniMapHeight);

    // Draw terrain (simplified - sample every few cells)
    const sampleRate = Math.max(1, Math.floor(mapData.width / 80));
    for (let y = 0; y < mapData.height; y += sampleRate) {
      for (let x = 0; x < mapData.width; x += sampleRate) {
        const cell = mapData.terrain[y]?.[x];
        if (!cell) continue;

        // Get color based on elevation
        const elevColor = elevationColors[cell.elevation] || '#444';
        ctx.fillStyle = elevColor;

        // Darken if unwalkable
        if (!cell.walkable) {
          ctx.fillStyle = '#222';
        }

        // Draw with feature overlay
        ctx.fillRect(
          x * scaleX,
          y * scaleY,
          sampleRate * scaleX + 1,
          sampleRate * scaleY + 1
        );

        // Feature tints
        if (cell.feature === 'water_deep' || cell.feature === 'water_shallow') {
          ctx.fillStyle = 'rgba(64, 128, 255, 0.5)';
          ctx.fillRect(x * scaleX, y * scaleY, sampleRate * scaleX + 1, sampleRate * scaleY + 1);
        } else if (cell.feature?.includes('forest')) {
          ctx.fillStyle = 'rgba(34, 139, 34, 0.4)';
          ctx.fillRect(x * scaleX, y * scaleY, sampleRate * scaleX + 1, sampleRate * scaleY + 1);
        }
      }
    }

    // Draw objects as dots
    for (const obj of objects) {
      const objType = config.objectTypes.find((t) => t.id === obj.type);
      if (!objType) continue;

      const px = obj.x * scaleX;
      const py = obj.y * scaleY;
      const size = objType.category === 'bases' ? 4 : 2;

      // Color by category
      if (objType.category === 'bases') {
        ctx.fillStyle = config.theme.primary;
      } else if (objType.category === 'objects') {
        ctx.fillStyle = config.theme.warning;
      } else {
        ctx.fillStyle = config.theme.text.muted;
      }

      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport indicator
    if (viewportBounds) {
      const vx = viewportBounds.minX * scaleX;
      const vy = viewportBounds.minY * scaleY;
      const vw = (viewportBounds.maxX - viewportBounds.minX) * scaleX;
      const vh = (viewportBounds.maxY - viewportBounds.minY) * scaleY;

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    }
  }, [mapData, objects, viewportBounds, config, elevationColors, miniMapWidth, miniMapHeight]);

  // Convert screen position to map coordinates
  const screenToMap = useCallback(
    (clientX: number, clientY: number) => {
      if (!mapData || !canvasRef.current) return null;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const mapX = Math.max(0, Math.min((x / miniMapWidth) * mapData.width, mapData.width));
      const mapY = Math.max(0, Math.min((y / miniMapHeight) * mapData.height, mapData.height));

      return { x: mapX, y: mapY };
    },
    [mapData, miniMapWidth, miniMapHeight]
  );

  // Handle mouse down - start drag and navigate
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return; // Only left click

      const pos = screenToMap(e.clientX, e.clientY);
      if (pos) {
        setIsDragging(true);
        onNavigate(pos.x, pos.y);
      }
    },
    [screenToMap, onNavigate]
  );

  // Handle mouse move while dragging
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging) return;

      const pos = screenToMap(e.clientX, e.clientY);
      if (pos) {
        onNavigate(pos.x, pos.y);
      }
    },
    [isDragging, screenToMap, onNavigate]
  );

  // Handle mouse up - stop dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle mouse leave - stop dragging
  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!mapData) return null;

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden shadow-2xl"
      style={{
        border: `1px solid ${config.theme.border}`,
        backgroundColor: config.theme.background,
      }}
    >
      {/* Header */}
      <div
        className="px-2 py-1 text-[10px] flex items-center justify-between"
        style={{
          backgroundColor: config.theme.surface,
          color: config.theme.text.muted,
          borderBottom: `1px solid ${config.theme.border}`,
        }}
      >
        <span>Mini Map</span>
        <span className="font-mono">{mapData.width}×{mapData.height}</span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={miniMapWidth}
        height={miniMapHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={isDragging ? 'cursor-grabbing' : 'cursor-pointer'}
        style={{ display: 'block' }}
      />
    </div>
  );
}

export default EditorMiniMap;
