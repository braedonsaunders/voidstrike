/**
 * IWorldProvider Interface
 *
 * Defines a common interface for world-like objects that provide entity queries.
 * This allows renderers to work with both:
 * - ECS World (direct access to entities)
 * - RenderStateWorldAdapter (worker mode - entities from RenderState snapshots)
 */

/**
 * Common entity interface for renderer consumption.
 * Both ECS Entity and RenderState adapters implement this.
 */
export interface IEntity {
  readonly id: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(componentType: string): T | undefined;
  has(componentType: string): boolean;
  isDestroyed(): boolean;
}

/**
 * Common world interface for renderer consumption.
 * Both ECS World and RenderStateWorldAdapter implement this.
 */
export interface IWorldProvider {
  getEntitiesWith(...componentTypes: string[]): IEntity[];
  getEntity(id: number): IEntity | null | undefined;
  getEntityCount(): number;
}
