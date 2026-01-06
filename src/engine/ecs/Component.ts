export type ComponentType = string;

export abstract class Component {
  public abstract readonly type: ComponentType;
}

// Helper for creating simple data components
export function createComponent<T extends object>(type: ComponentType) {
  return class extends Component {
    public readonly type = type;

    constructor(data: T) {
      super();
      Object.assign(this, data);
    }
  } as new (data: T) => Component & T;
}
