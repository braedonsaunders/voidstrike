type EventCallback<T = unknown> = (data: T) => void;

interface EventSubscription {
  id: number;
  callback: EventCallback;
}

export class EventBus {
  private events: Map<string, EventSubscription[]> = new Map();
  private nextId = 0;

  public on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    const id = this.nextId++;
    const subscription: EventSubscription = { id, callback: callback as EventCallback };

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    this.events.get(event)!.push(subscription);

    // Return unsubscribe function
    return () => this.off(event, id);
  }

  public once<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    const unsubscribe = this.on<T>(event, (data) => {
      callback(data);
      unsubscribe();
    });

    return unsubscribe;
  }

  public off(event: string, id: number): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;

    const index = subscriptions.findIndex((sub) => sub.id === id);
    if (index !== -1) {
      subscriptions.splice(index, 1);
    }
  }

  public emit<T = unknown>(event: string, data?: T): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;

    // Create a copy to avoid issues if callbacks modify subscriptions
    const callbacks = [...subscriptions];
    for (const subscription of callbacks) {
      try {
        subscription.callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }

  public clear(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  public hasListeners(event: string): boolean {
    const subscriptions = this.events.get(event);
    return subscriptions !== undefined && subscriptions.length > 0;
  }
}
