export type ComponentType = string;

export abstract class Component {
  public abstract readonly type: ComponentType;
}
