'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';

interface SC2MinimapProps {
  game: Game;
  mapWidth: number;
  mapHeight: number;
  size?: number;
}

// SC2-style color palette
const COLORS = {
  // Player colors
  player1: '#00aaff',
  ai: '#ff4444',
  player2: '#44ff44',
  player3: '#ffff44',
  player4: '#ff44ff',
  neutral: '#aaaaaa',

  // Resource colors
  minerals: '#00ddff',
  vespene: '#44ff44',

  // Terrain colors
  ground: '#1a2a1a',
  unwalkable: '#0a0a0a',
  ramp: '#2a3a2a',
  highGround: '#2a3a2a',

  // UI colors
  cameraViewport: 'rgba(255, 255, 255, 0.6)',
  cameraViewportFill: 'rgba(255, 255, 255, 0.05)',
  border: '#444444',
  alertPing: '#ff0000',
};

export function SC2Minimap({ game, mapWidth, mapHeight, size = 200 }: SC2MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  const { cameraX, cameraZ, cameraZoom, pendingAlerts, clearPendingAlerts } = useGameStore();

  // Calculate scale
  const scale = size / Math.max(mapWidth, mapHeight);
  const displayWidth = mapWidth * scale;
  const displayHeight = mapHeight * scale;

  // Pre-render terrain to offscreen canvas (only once)
  useEffect(() => {
    const terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = displayWidth;
    terrainCanvas.height = displayHeight;
    (terrainCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = terrainCanvas;

    const ctx = terrainCanvas.getContext('2d');
    if (!ctx) return;

    // Draw basic terrain grid (simplified since mapData may not be directly accessible)
    const cellWidth = displayWidth / mapWidth;
    const cellHeight = displayHeight / mapHeight;

    // Fill with ground color
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Add some visual noise for terrain variety
    for (let y = 0; y < mapHeight; y += 4) {
      for (let x = 0; x < mapWidth; x += 4) {
        const brightness = 0.9 + Math.random() * 0.2;
        const r = Math.floor(parseInt(COLORS.ground.slice(1, 3), 16) * brightness);
        const g = Math.floor(parseInt(COLORS.ground.slice(3, 5), 16) * brightness);
        const b = Math.floor(parseInt(COLORS.ground.slice(5, 7), 16) * brightness);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth * 4, cellHeight * 4);
      }
    }
  }, [displayWidth, displayHeight, mapWidth, mapHeight]);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastRenderTime = 0;
    const RENDER_INTERVAL = 66; // ~15 FPS for minimap

    const render = (currentTime: number) => {
      // Throttle rendering
      if (currentTime - lastRenderTime < RENDER_INTERVAL) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = currentTime;

      // Clear canvas
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Draw terrain from cached canvas
      if (terrainCanvasRef.current) {
        ctx.drawImage(terrainCanvasRef.current, 0, 0);
      }

      // Draw fog of war (if enabled) - simplified version
      // Full fog implementation would require vision grid access

      // Draw resources
      const resources = game.world.getEntitiesWith('Resource', 'Transform');
      for (const entity of resources) {
        const transform = entity.get<Transform>('Transform')!;
        const resource = entity.get<Resource>('Resource')!;

        const x = transform.x * scale;
        const y = transform.y * scale;

        ctx.fillStyle = resource.resourceType === 'minerals' ? COLORS.minerals : COLORS.vespene;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw buildings
      const buildings = game.world.getEntitiesWith('Building', 'Transform', 'Selectable');
      for (const entity of buildings) {
        const transform = entity.get<Transform>('Transform')!;
        const building = entity.get<Building>('Building')!;
        const selectable = entity.get<Selectable>('Selectable')!;
        const health = entity.get<Health>('Health');

        // Skip dead buildings
        if (health?.isDead()) continue;

        const x = transform.x * scale;
        const y = transform.y * scale;
        const w = building.width * scale;
        const h = building.height * scale;

        // Get player color
        const color = COLORS[selectable.playerId as keyof typeof COLORS] || COLORS.neutral;

        ctx.fillStyle = color;
        ctx.fillRect(x - w / 2, y - h / 2, w, h);

        // White border for selected
        if (selectable.isSelected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - w / 2, y - h / 2, w, h);
        }
      }

      // Draw units
      const units = game.world.getEntitiesWith('Unit', 'Transform', 'Selectable');
      for (const entity of units) {
        const transform = entity.get<Transform>('Transform')!;
        const unit = entity.get<Unit>('Unit')!;
        const selectable = entity.get<Selectable>('Selectable')!;
        const health = entity.get<Health>('Health');

        // Skip dead units
        if (health?.isDead()) continue;
        if (unit.state === 'dead') continue;

        const x = transform.x * scale;
        const y = transform.y * scale;

        // Get player color
        const color = COLORS[selectable.playerId as keyof typeof COLORS] || COLORS.neutral;

        // Unit dot size based on unit type
        const dotSize = unit.isWorker ? 1.5 : 2.5;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();

        // Highlight selected units
        if (selectable.isSelected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, dotSize + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw camera viewport
      const viewportWidth = (cameraZoom * 2.5) * scale;
      const viewportHeight = (cameraZoom * 1.8) * scale;
      const viewportX = cameraX * scale - viewportWidth / 2;
      const viewportY = cameraZ * scale - viewportHeight / 2;

      ctx.strokeStyle = COLORS.cameraViewport;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
      ctx.fillStyle = COLORS.cameraViewportFill;
      ctx.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);

      // Draw alert pings
      const currentTime2 = Date.now();
      for (const alert of pendingAlerts) {
        const age = currentTime2 - alert.time;
        if (age < 3000) { // Show for 3 seconds
          const x = alert.x * scale;
          const y = alert.y * scale;

          // Pulsing effect
          const pulse = Math.sin(age / 150) * 0.5 + 0.5;
          const radius = 5 + pulse * 5;

          ctx.strokeStyle = COLORS.alertPing;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 1 - age / 3000;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [displayWidth, displayHeight, mapWidth, mapHeight, scale, cameraX, cameraZ, cameraZoom, game, pendingAlerts]);

  // Handle click to move camera
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    // Emit camera move event
    useGameStore.getState().setPendingCameraMove(x, y);
  }, [scale]);

  // Handle right-click to issue commands
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    const selectedUnits = useGameStore.getState().selectedUnits;
    if (selectedUnits.length > 0) {
      // Issue move command through event bus
      game.eventBus.emit('command:move', {
        entityIds: selectedUnits,
        targetPosition: { x, y },
        queue: e.shiftKey,
      });
    }
  }, [scale, game.eventBus]);

  return (
    <div
      className="relative"
      style={{
        width: displayWidth,
        height: displayHeight,
      }}
    >
      {/* Minimap border */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          border: `2px solid ${COLORS.border}`,
          borderRadius: '2px',
          boxShadow: 'inset 0 0 10px rgba(0, 0, 0, 0.5)',
        }}
      />

      {/* Minimap canvas */}
      <canvas
        ref={canvasRef}
        width={displayWidth}
        height={displayHeight}
        className="cursor-pointer"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{
          display: 'block',
        }}
      />

      {/* Corner decorations (SC2-style) */}
      <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-gray-500 pointer-events-none" />
      <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-gray-500 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-gray-500 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-gray-500 pointer-events-none" />
    </div>
  );
}
