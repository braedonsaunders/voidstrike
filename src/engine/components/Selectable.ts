import { Component } from '../ecs/Component';

export class Selectable extends Component {
  public readonly type = 'Selectable';

  public isSelected: boolean;
  public selectionRadius: number;
  public selectionPriority: number; // Higher = selected first when overlapping
  public controlGroup: number | null;
  public playerId: string;

  constructor(
    selectionRadius = 1,
    selectionPriority = 0,
    playerId = 'player1'
  ) {
    super();
    this.isSelected = false;
    this.selectionRadius = selectionRadius;
    this.selectionPriority = selectionPriority;
    this.controlGroup = null;
    this.playerId = playerId;
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
