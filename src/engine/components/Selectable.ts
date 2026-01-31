import { Component } from '../ecs/Component';

export class Selectable extends Component {
  public readonly type = 'Selectable';

  public isSelected: boolean;
  public selectionRadius: number;
  public selectionPriority: number; // Higher = selected first when overlapping
  public controlGroup: number | null;
  public playerId: string;
  /** Team number: 0 = FFA (no alliance), 1-4 = team alliance. Same team = allied. */
  public teamId: number;

  // Visual properties for accurate selection
  public visualScale: number; // Scale factor for screen-space hitbox (larger units = bigger hitbox)
  public visualHeight: number; // Height offset for flying units (select at visual position, not ground)

  constructor(
    selectionRadius = 1,
    selectionPriority = 0,
    playerId = 'player1',
    visualScale = 1,
    visualHeight = 0,
    teamId = 0
  ) {
    super();
    this.isSelected = false;
    this.selectionRadius = selectionRadius;
    this.selectionPriority = selectionPriority;
    this.controlGroup = null;
    this.playerId = playerId;
    this.teamId = teamId;
    this.visualScale = visualScale;
    this.visualHeight = visualHeight;
  }

  public select(): void {
    this.isSelected = true;
  }

  public deselect(): void {
    this.isSelected = false;
  }

  public setControlGroup(group: number | null): void {
    this.controlGroup = group;
  }
}
