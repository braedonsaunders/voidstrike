'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useGameSetupStore, getPlayerColor, getLocalPlayerId, isSpectatorMode } from '@/store/gameSetupStore';
import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';
import { Health } from '@/engine/components/Health';

const MINIMAP_SIZE = 192;

// Convert hex color (0xRRGGBB) to CSS hex string
function hexToCSS(hex: number, darken: number = 0): string {
  const r = Math.max(0, ((hex >> 16) & 0xff) - darken);
  const g = Math.max(0, ((hex >> 8) & 0xff) - darken);
  const b = Math.max(0, (hex & 0xff) - darken);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Ping animation data
interface Ping {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedUnits = useGameStore((state) => state.selectedUnits);
  const [isDragging, setIsDragging] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);

  // Convert screen position to map coordinates
  const screenToMap = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const game = Game.getInstance();
    if (!game) return null;

    const mapWidth = game.config.mapWidth;
    const mapHeight = game.config.mapHeight;

    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(mapWidth, (clientX - rect.left) / MINIMAP_SIZE * mapWidth));
    const y = Math.max(0, Math.min(mapHeight, (clientY - rect.top) / MINIMAP_SIZE * mapHeight));
    return { x, y };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // PERF FIX: Use a flag to prevent animation loop accumulation
    // Without this, multiple animation loops can stack when the effect re-runs
    let isActive = true;

    // PERFORMANCE: Pre-create gradient once instead of every frame
    const terrainGradient = ctx.createLinearGradient(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    terrainGradient.addColorStop(0, '#2d4a3a');
    terrainGradient.addColorStop(0.5, '#3d5a4a');
    terrainGradient.addColorStop(1, '#2d4a3a');

    // PERFORMANCE: Throttle minimap to 15 FPS instead of 60+ FPS
    const MINIMAP_FPS = 15;
    const FRAME_TIME = 1000 / MINIMAP_FPS;
    let lastDrawTime = 0;

    // Draw minimap
    const draw = (timestamp: number) => {
      // PERF FIX: Stop if this animation loop should no longer be active
      if (!isActive) return;

      // Get game instance - may not be available immediately on mount
      const game = Game.getInstance();
      if (!game) {
        // Game not ready yet, draw placeholder and keep trying
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', MINIMAP_SIZE / 2, MINIMAP_SIZE / 2);
        if (isActive) requestAnimationFrame(draw);
        return;
      }

      // Get map dimensions from game config
      const mapWidth = game.config.mapWidth;
      const mapHeight = game.config.mapHeight;
      const mapSize = Math.max(mapWidth, mapHeight); // Use largest dimension for scale
      // PERFORMANCE: Skip frame if not enough time has passed
      if (timestamp - lastDrawTime < FRAME_TIME) {
        if (isActive) requestAnimationFrame(draw);
        return;
      }
      lastDrawTime = timestamp;

      const scale = MINIMAP_SIZE / mapSize;
      const currentTime = Date.now();

      // Clear
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      // Draw terrain gradient (using pre-created gradient)
      ctx.fillStyle = terrainGradient;
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      // Draw grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= mapSize; i += 16) {
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

      // Draw fog of war (simplified) - skip in spectator mode or when FOW disabled
      // PERFORMANCE FIX: Use much coarser grid to avoid 4096+ fillRect calls per frame
      const isSpectating = isSpectatorMode();
      const localPlayer = getLocalPlayerId();
      const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;
      if (game.visionSystem && !isSpectating && localPlayer && fogOfWarEnabled) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        // CRITICAL: Changed from 4 to 16 - reduces checks from 4096 to 256 per frame
        const visionScale = 16;
        for (let mapX = 0; mapX < mapWidth; mapX += visionScale) {
          for (let mapY = 0; mapY < mapHeight; mapY += visionScale) {
            // Sample center of the cell for fog check
            const sampleX = mapX + visionScale / 2;
            const sampleY = mapY + visionScale / 2;
            if (!game.visionSystem.isExplored(localPlayer, sampleX, sampleY)) {
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
        const transform = entity.get<Transform>('Transform');
        const resource = entity.get<Resource>('Resource');

        if (!transform || !resource) continue;

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
        const transform = entity.get<Transform>('Transform');
        const building = entity.get<Building>('Building');
        const selectable = entity.get<Selectable>('Selectable');
        const health = entity.get<Health>('Health');

        if (!transform || !building || !selectable || !health) continue;
        if (health.isDead()) continue;

        // Skip enemy buildings that are not visible due to fog of war (unless spectator)
        const fogOfWarEnabled = useGameSetupStore.getState().fogOfWar;
        if (localPlayer && selectable.playerId !== localPlayer && fogOfWarEnabled && game.visionSystem && !isSpectating) {
          if (!game.visionSystem.isVisible(localPlayer, transform.x, transform.y)) {
            continue;
          }
        }

        const x = transform.x * scale;
        const y = transform.y * scale;
        const w = Math.max(building.width * scale, 4);
        const h = Math.max(building.height * scale, 4);

        // Building color based on player's assigned color
        const playerHex = getPlayerColor(selectable.playerId);
        ctx.fillStyle = building.isComplete() ? hexToCSS(playerHex) : hexToCSS(playerHex, 60);
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
        const transform = entity.get<Transform>('Transform');
        const selectable = entity.get<Selectable>('Selectable');
        const health = entity.get<Health>('Health');

        if (!transform || !selectable || !health) continue;
        if (health.isDead()) continue;

        // Skip enemy units that are not visible due to fog of war (unless spectator)
        const fogEnabled = useGameSetupStore.getState().fogOfWar;
        if (localPlayer && selectable.playerId !== localPlayer && fogEnabled && game.visionSystem && !isSpectating) {
          if (!game.visionSystem.isVisible(localPlayer, transform.x, transform.y)) {
            continue;
          }
        }

        const x = transform.x * scale;
        const y = transform.y * scale;

        // Unit color based on player's assigned color
        const unitPlayerHex = getPlayerColor(selectable.playerId);
        ctx.fillStyle = hexToCSS(unitPlayerHex);
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
      let viewX = currentCameraX * scale - viewWidth / 2;
      let viewY = currentCameraY * scale - viewHeight / 2;

      // Clamp viewport rectangle to stay within minimap bounds
      const clampedX = Math.max(0, Math.min(MINIMAP_SIZE - viewWidth, viewX));
      const clampedY = Math.max(0, Math.min(MINIMAP_SIZE - viewHeight, viewY));

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(clampedX, clampedY, viewWidth, viewHeight);

      // Draw corner markers for visibility (using clamped coordinates)
      const cornerSize = 4;
      ctx.fillStyle = '#ffffff';
      // Top-left
      ctx.fillRect(clampedX - 1, clampedY - 1, cornerSize, 2);
      ctx.fillRect(clampedX - 1, clampedY - 1, 2, cornerSize);
      // Top-right
      ctx.fillRect(clampedX + viewWidth - cornerSize + 1, clampedY - 1, cornerSize, 2);
      ctx.fillRect(clampedX + viewWidth - 1, clampedY - 1, 2, cornerSize);
      // Bottom-left
      ctx.fillRect(clampedX - 1, clampedY + viewHeight - 1, cornerSize, 2);
      ctx.fillRect(clampedX - 1, clampedY + viewHeight - cornerSize + 1, 2, cornerSize);
      // Bottom-right
      ctx.fillRect(clampedX + viewWidth - cornerSize + 1, clampedY + viewHeight - 1, cornerSize, 2);
      ctx.fillRect(clampedX + viewWidth - 1, clampedY + viewHeight - cornerSize + 1, 2, cornerSize);

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

      // PERF FIX: Only schedule next frame if still active
      if (isActive) {
        requestAnimationFrame(draw);
      }
    };

    const frameId = requestAnimationFrame(draw);

    // PERF FIX: Set isActive to false to stop the animation loop before canceling the frame
    // This prevents race conditions where draw() schedules another frame before cleanup runs
    return () => {
      isActive = false;
      cancelAnimationFrame(frameId);
    };
  }, [selectedUnits, pings]); // Camera position read directly from store in draw loop

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
        const localPlayerForMove = getLocalPlayerId();
        if (localPlayerForMove) {
          game.issueCommand({
            tick: game.getCurrentTick(),
            playerId: localPlayerForMove,
            type: 'MOVE',
            entityIds: selectedIds,
            targetPosition: { x: pos.x, y: pos.y },
          });
        }

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
