import { Building } from '@/engine/components/Building';
import { Health } from '@/engine/components/Health';
import { Selectable } from '@/engine/components/Selectable';
import { Transform } from '@/engine/components/Transform';
import { Unit } from '@/engine/components/Unit';
import type { IWorldProvider } from '@/engine/ecs/IWorldProvider';
import type { RTSCamera } from '@/rendering/Camera';

export function findEntityAtScreenPosition(
  world: IWorldProvider | null | undefined,
  screenX: number,
  screenY: number,
  camera: RTSCamera | null | undefined
): ReturnType<IWorldProvider['getEntity']> | null {
  if (!world || !camera) return null;

  const resourceScreenRadius = 40;
  const unitScreenRadius = 35;
  const buildingScreenRadius = 50;

  const worldPos = camera.screenToWorld(screenX, screenY);
  if (!worldPos) return null;

  const zoom = camera.getZoom?.() ?? 1;
  const maxScreenRadius = Math.max(resourceScreenRadius, unitScreenRadius, buildingScreenRadius);
  const worldSearchRadius = (maxScreenRadius / zoom) * 1.5 + 5;

  type ClickCandidate = {
    entity: NonNullable<ReturnType<IWorldProvider['getEntity']>>;
    distance: number;
  };
  let closestEntity: ClickCandidate | null = null;

  const units = world.getEntitiesWith('Unit', 'Transform');
  for (const entity of units) {
    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    if (!transform || !health || !selectable) continue;
    if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    const getTerrainHeight = camera.getTerrainHeightFunction();
    const terrainHeight = getTerrainHeight?.(transform.x, transform.y) ?? 0;
    const visualHeight = selectable.visualHeight ?? 0;
    const worldY = terrainHeight + visualHeight;

    const screenPos = camera.worldToScreen(transform.x, transform.y, worldY);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const visualScale = selectable.visualScale ?? 1;
    const effectiveRadius = unitScreenRadius * visualScale;

    if (dist < effectiveRadius && (!closestEntity || dist < closestEntity.distance)) {
      closestEntity = { entity, distance: dist };
    }
  }

  if (closestEntity?.entity.get<Unit>('Unit')) {
    return closestEntity.entity;
  }

  const buildings = world.getEntitiesWith('Building', 'Transform');
  for (const entity of buildings) {
    const transform = entity.get<Transform>('Transform');
    const health = entity.get<Health>('Health');
    const selectable = entity.get<Selectable>('Selectable');
    const building = entity.get<Building>('Building');
    if (!transform || !health || !selectable || !building) continue;
    if (health.isDead?.() || (health as { current?: number }).current === 0) continue;

    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    const getTerrainHeightFn = camera.getTerrainHeightFunction();
    const terrainHeight = getTerrainHeightFn?.(transform.x, transform.y) ?? 0;
    const visualHeight =
      building.isFlying && building.state === 'flying' ? (selectable.visualHeight ?? 0) : 0;
    const worldY = terrainHeight + visualHeight;

    const screenPos = camera.worldToScreen(transform.x, transform.y, worldY);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const visualScale = selectable.visualScale ?? 1;
    const effectiveRadius = buildingScreenRadius * visualScale;

    if (dist < effectiveRadius && (!closestEntity || dist < closestEntity.distance)) {
      closestEntity = { entity, distance: dist };
    }
  }

  const resources = world.getEntitiesWith('Resource', 'Transform');
  for (const entity of resources) {
    const transform = entity.get<Transform>('Transform');
    if (!transform) continue;

    const worldDx = transform.x - worldPos.x;
    const worldDz = transform.y - worldPos.z;
    if (worldDx * worldDx + worldDz * worldDz > worldSearchRadius * worldSearchRadius) continue;

    const screenPos = camera.worldToScreen(transform.x, transform.y);
    if (!screenPos) continue;

    const dx = screenPos.x - screenX;
    const dy = screenPos.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < resourceScreenRadius && (!closestEntity || dist < closestEntity.distance)) {
      closestEntity = { entity, distance: dist };
    }
  }

  return closestEntity?.entity ?? null;
}
