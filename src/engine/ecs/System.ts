import { Game } from '../core/Game';
import { World } from './World';

export abstract class System {
  public enabled = true;
  public priority = 0;

  protected world!: World;
  protected game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  public init(world: World): void {
    this.world = world;
  }

  public abstract update(deltaTime: number): void;
}
