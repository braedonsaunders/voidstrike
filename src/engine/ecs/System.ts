import type { IGameInstance } from '../core/IGameInstance';
import { World } from './World';

export abstract class System {
  public enabled = true;
  public priority = 0;

  /**
   * Human-readable system name for debugging and performance monitoring.
   * Required because constructor.name gets minified in production builds.
   */
  public abstract readonly name: string;

  protected world!: World;
  protected game: IGameInstance;

  constructor(game: IGameInstance) {
    this.game = game;
  }

  public init(world: World): void {
    this.world = world;
  }

  public abstract update(deltaTime: number): void;
}
