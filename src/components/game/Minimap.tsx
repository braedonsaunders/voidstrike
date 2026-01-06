'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';

const MINIMAP_SIZE = 192;
const MAP_SIZE = 128;

// Ping animation data
interface Ping {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { cameraX, cameraY, cameraZoom, selectedUnits } = useGameStore();
  const [isDragging, setIsDragging] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);

  // Convert screen position to map coordinates
  const screenToMap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(MAP_SIZE, (clientX - rect.left) / MINIMAP_SIZE * MAP_SIZE));
    const y = Math.max(0, Math.min(MAP_SIZE, (clientY - rect.top) / MINIMAP_SIZE * MAP_SIZE));
    return { x, y };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const game = Game.getInstance();
    if (!game) return;

    // Draw minimap
    const draw = () => {
      const scale = MINIMAP_SIZE / MAP_SIZE;
      const currentTime = Date.now();

      // Clear
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      // Draw terrain gradient (simplified)
      const gradient = ctx.createLinearGradient(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      gradient.addColorStop(0, '#2d4a3a');
      gradient.addColorStop(0.5, '#3d5a4a');
      gradient.addColorStop(1, '#2d4a3a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      // Draw grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= MAP_SIZE; i += 16) {
        const pos = i * scale;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, MINIMAP_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(MINIMAP_SIZE, pos);
        ctx.stroke();
      }

      // Draw fog of war (simplified)
      if (game.visionSystem) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        const visionScale = 4; // Check every 4 units
        for (let mapX = 0; mapX < MAP_SIZE; mapX += visionScale) {
          for (let mapY = 0; mapY < MAP_SIZE; mapY += visionScale) {
            if (!game.visionSystem.isExplored('player1', mapX, mapY)) {
              ctx.fillRect(
                mapX * scale,
                mapY * scale,
                visionScale * scale,
                visionScale * scale
              );
            }
          }
        }
      }

      // Draw resources
      const resources = game.world.getEntitiesWith('Transform', 'Resource');
      for (const entity of resources) {
        const transform = entity.get<Transform>('Transform')!;
        const resource = entity.get<Resource>('Resource')!;

        const x = transform.x * scale;
        const y = transform.y * scale;

        ctx.fillStyle = resource.resourceType === 'minerals' ? '#00aaff' : '#00ff66';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw buildings
      const buildings = game.world.getEntitiesWith('Transform', 'Building', 'Selectable', 'Health');
      for (const entity of buildings) {
        const transform = entity.get<Transform>('Transform')!;
        const building = entity.get<Building>('Building')!;
        const selectable = entity.get<Selectable>('Selectable')!;
        const health = entity.get<Health>('Health')!;

        if (health.isDead()) continue;

        const x = transform.x * scale;
        const y = transform.y * scale;
        const w = Math.max(building.width * scale, 4);
        const h = Math.max(building.height * scale, 4);

        // Building color based on player
        if (selectable.playerId === 'player1') {
          ctx.fillStyle = building.isComplete() ? '#4a90d9' : '#2a5090';
        } else {
          ctx.fillStyle = '#d94a4a';
        }
        ctx.fillRect(x - w / 2, y - h / 2, w, h);

        // Border for selected buildings
        if (selectedUnits.includes(entity.id)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2);
        }
      }

      // Draw units
      const units = game.world.getEntitiesWith('Transform', 'Unit', 'Selectable', 'Health');
      for (const entity of units) {
        const transform = entity.get<Transform>('Transform')!;
        const selectable = entity.get<Selectable>('Selectable')!;
        const health = entity.get<Health>('Health')!;

        if (health.isDead()) continue;

        const x = transform.x * scale;
        const y = transform.y * scale;

        // Unit color based on player
        ctx.fillStyle = selectable.playerId === 'player1' ? '#7cb9e8' : '#e87c7c';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Highlight for selected units
        if (selectedUnits.includes(entity.id)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw camera viewport - read fresh values from store for zoom tracking
      const storeState = useGameStore.getState();
      const currentZoom = storeState.cameraZoom;
      const currentCameraX = storeState.cameraX;
      const currentCameraY = storeState.cameraY;
      const viewWidth = (currentZoom * 2) * scale;
      const viewHeight = (currentZoom * 1.5) * scale;
      const viewX = currentCameraX * scale - viewWidth / 2;
      const viewY = currentCameraY * scale - viewHeight / 2;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);

      // Draw corner markers for visibility
      const cornerSize = 4;
      ctx.fillStyle = '#ffffff';
      // Top-left
      ctx.fillRect(viewX - 1, viewY - 1, cornerSize, 2);
      ctx.fillRect(viewX - 1, viewY - 1, 2, cornerSize);
      // Top-right
      ctx.fillRect(viewX + viewWidth - cornerSize + 1, viewY - 1, cornerSize, 2);
      ctx.fillRect(viewX + viewWidth - 1, viewY - 1, 2, cornerSize);
      // Bottom-left
      ctx.fillRect(viewX - 1, viewY + viewHeight - 1, cornerSize, 2);
      ctx.fillRect(viewX - 1, viewY + viewHeight - cornerSize + 1, 2, cornerSize);
      // Bottom-right
      ctx.fillRect(viewX + viewWidth - cornerSize + 1, viewY + viewHeight - 1, cornerSize, 2);
      ctx.fillRect(viewX + viewWidth - 1, viewY + viewHeight - cornerSize + 1, 2, cornerSize);

      // Draw pings with animation
      const activePings: Ping[] = [];
      for (const ping of pings) {
        const elapsed = currentTime - ping.startTime;
        if (elapsed < ping.duration) {
          activePings.push(ping);
          const progress = elapsed / ping.duration;
          const radius = 5 + progress * 20;
          const alpha = 1 - progress;

          ctx.strokeStyle = `rgba(255, 255, 0, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ping.x * scale, ping.y * scale, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Update pings state if changed
      if (activePings.length !== pings.length) {
        setPings(activePings);
      }

      requestAnimationFrame(draw);
    };

    const frameId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frameId);
  }, [cameraX, cameraY, cameraZoom, selectedUnits, pings]);

  // Handle mouse down - start drag or click
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      // Left click - start dragging or move camera
      setIsDragging(true);
      const pos = screenToMap(e.clientX, e.clientY);
      if (pos) {
        useGameStore.getState().moveCameraTo(pos.x, pos.y);
      }
    }
  }, [screenToMap]);

  // Handle mouse move while dragging
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const pos = screenToMap(e.clientX, e.clientY);
      if (pos) {
        useGameStore.getState().moveCameraTo(pos.x, pos.y);
      }
    }
  }, [isDragging, screenToMap]);

  // Handle mouse up - stop dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle mouse leave - stop dragging
  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle right-click - issue move command
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const pos = screenToMap(e.clientX, e.clientY);
    if (!pos) return;

    const game = Game.getInstance();
    if (!game) return;

    const selectedIds = useGameStore.getState().selectedUnits;
    if (selectedIds.length > 0) {
      // Check if any selected are units (not buildings)
      const hasUnits = selectedIds.some((id) => {
        const entity = game.world.getEntity(id);
        return entity?.get<Unit>('Unit') !== undefined;
      });

      if (hasUnits) {
        // Issue move command
        game.processCommand({
          tick: game.getCurrentTick(),
          playerId: 'player1',
          type: 'MOVE',
          entityIds: selectedIds,
          targetPosition: { x: pos.x, y: pos.y },
        });

        // Add ping animation
        setPings((prev) => [...prev, {
          x: pos.x,
          y: pos.y,
          startTime: Date.now(),
          duration: 1000,
        }]);
      }
    }
  }, [screenToMap]);

  // Handle double-click - center and zoom
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = screenToMap(e.clientX, e.clientY);
    if (pos) {
      useGameStore.getState().moveCameraTo(pos.x, pos.y);
    }
  }, [screenToMap]);

  return (
    <div className="minimap-container relative">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        className={`cursor-${isDragging ? 'grabbing' : 'crosshair'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      />
      {/* Minimap border decoration */}
      <div className="absolute inset-0 pointer-events-none border-2 border-void-600 rounded" />
      <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-void-400 pointer-events-none" />
      <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-void-400 pointer-events-none" />
      <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-void-400 pointer-events-none" />
      <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-void-400 pointer-events-none" />
    </div>
  );
}
