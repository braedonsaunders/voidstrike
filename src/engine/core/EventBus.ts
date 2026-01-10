type EventCallback<T = unknown> = (data: T) => void;

interface EventSubscription {
  id: number;
  callback: EventCallback;
}

/**
 * EventBus - Optimized pub/sub event system
 *
 * PERFORMANCE: Uses Map for O(1) unsubscribe instead of O(n) array search
 */
export class EventBus {
  // Map of event name -> Map of subscription ID -> callback
  private events: Map<string, Map<number, EventCallback>> = new Map();
  private nextId = 0;

  /**
   * Subscribe to an event
   * @returns Unsubscribe function
   */
  public on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    const id = this.nextId++;

    if (!this.events.has(event)) {
      this.events.set(event, new Map());
    }

    this.events.get(event)!.set(id, callback as EventCallback);

    // Return unsubscribe function
    return () => this.off(event, id);
  }

  /**
   * Subscribe to an event, automatically unsubscribe after first emit
   */
  public once<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    const unsubscribe = this.on<T>(event, (data) => {
      callback(data);
      unsubscribe();
    });

    return unsubscribe;
  }

  /**
   * Unsubscribe from an event - O(1) complexity
   */
  public off(event: string, id: number): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions) return;

    subscriptions.delete(id);

    // Clean up empty event maps
    if (subscriptions.size === 0) {
      this.events.delete(event);
    }
  }

  /**
   * Emit an event to all subscribers
   * OPTIMIZED: Avoid array allocation on every emit by iterating Map directly
   */
  public emit<T = unknown>(event: string, data?: T): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions || subscriptions.size === 0) return;

    // Iterate directly over Map entries - avoids Array.from() allocation
    // Safe because we check if callback still exists before calling
    // (handles case where callback unsubscribes itself or others)
    for (const [id, callback] of subscriptions) {
      // Verify callback still exists (could have been removed by previous callback)
      if (!subscriptions.has(id)) continue;

      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }

  /**
   * Clear all subscriptions for an event, or all events
   */
  public clear(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  /**
   * Check if an event has any listeners
   */
  public hasListeners(event: string): boolean {
    const subscriptions = this.events.get(event);
    return subscriptions !== undefined && subscriptions.size > 0;
  }

  /**
   * Get the number of listeners for an event
   */
  public listenerCount(event: string): number {
    const subscriptions = this.events.get(event);
    return subscriptions?.size ?? 0;
  }
}
