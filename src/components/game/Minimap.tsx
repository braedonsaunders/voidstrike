'use client';

import { useRef, useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Game } from '@/engine/core/Game';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import { Building } from '@/engine/components/Building';
import { Resource } from '@/engine/components/Resource';
import { Selectable } from '@/engine/components/Selectable';

const MINIMAP_SIZE = 192;
const MAP_SIZE = 128;

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { cameraX, cameraY, cameraZoom } = useGameStore();

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

      // Clear
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      // Draw terrain (simplified)
      ctx.fillStyle = '#2d4a3a';
      ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

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
      const buildings = game.world.getEntitiesWith('Transform', 'Building', 'Selectable');
      for (const entity of buildings) {
        const transform = entity.get<Transform>('Transform')!;
        const building = entity.get<Building>('Building')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        const x = transform.x * scale;
        const y = transform.y * scale;
        const w = building.width * scale;
        const h = building.height * scale;

        ctx.fillStyle = selectable.playerId === 'player1' ? '#4a90d9' : '#d94a4a';
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
      }

      // Draw units
      const units = game.world.getEntitiesWith('Transform', 'Unit', 'Selectable');
      for (const entity of units) {
        const transform = entity.get<Transform>('Transform')!;
        const selectable = entity.get<Selectable>('Selectable')!;

        const x = transform.x * scale;
        const y = transform.y * scale;

        ctx.fillStyle = selectable.playerId === 'player1' ? '#7cb9e8' : '#e87c7c';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw camera viewport
      const viewWidth = (cameraZoom * 2) * scale;
      const viewHeight = (cameraZoom * 1.5) * scale;
      const viewX = cameraX * scale - viewWidth / 2;
      const viewY = cameraY * scale - viewHeight / 2;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);

      requestAnimationFrame(draw);
    };

    const frameId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frameId);
  }, [cameraX, cameraY, cameraZoom]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / MINIMAP_SIZE * MAP_SIZE;
    const y = (e.clientY - rect.top) / MINIMAP_SIZE * MAP_SIZE;

    useGameStore.getState().setCamera(x, y);
  };

  return (
    <div className="minimap-container">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        className="cursor-pointer"
        onClick={handleClick}
      />
    </div>
  );
}
