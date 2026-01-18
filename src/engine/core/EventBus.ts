import { debugInitialization } from '@/utils/debugLogger';

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
   * FIX: Improved error handling - collects all errors and continues processing
   */
  public emit<T = unknown>(event: string, data?: T): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions || subscriptions.size === 0) return;

    // FIX: Create snapshot of IDs to safely iterate even if handlers modify subscriptions
    // This fixes the iterator invalidation bug where a handler unsubscribing another
    // handler could cause the iteration to skip or fail
    const handlerIds = Array.from(subscriptions.keys());
    const errors: Array<{ id: number; error: unknown }> = [];

    for (const id of handlerIds) {
      const callback = subscriptions.get(id);
      // Verify callback still exists (could have been removed by previous callback)
      if (!callback) continue;

      try {
        callback(data);
      } catch (error) {
        // FIX: Collect errors instead of just logging, continue processing other handlers
        errors.push({ id, error });
        debugInitialization.error(`Error in event handler for ${event}:`, error);
      }
    }

    // FIX: Report collected errors for monitoring if any occurred
    if (errors.length > 0) {
      // Emit error event for monitoring (use different channel to avoid recursion)
      // Only emit if there are listeners and this isn't itself an error event
      if (event !== 'eventbus:errors' && this.hasListeners('eventbus:errors')) {
        try {
          this.emit('eventbus:errors', {
            event,
            errorCount: errors.length,
            errors: errors.map(e => ({
              handlerId: e.id,
              message: e.error instanceof Error ? e.error.message : String(e.error),
            })),
          });
        } catch {
          // Prevent infinite recursion if error handler itself fails
        }
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
