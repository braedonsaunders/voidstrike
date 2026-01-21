import { System } from '../ecs/System';
import { Game } from './Game';

/**
 * Defines a system's dependencies for execution ordering.
 * The registry uses topological sort to derive execution order from dependencies.
 */
export interface SystemDefinition {
  /** Unique system name (must match System.name) */
  name: string;
  /** Systems that MUST execute before this one */
  dependencies: string[];
  /** Factory function to create the system instance */
  factory: (game: Game) => System;
  /** Optional: only create if this condition is true */
  condition?: (game: Game) => boolean;
}

/**
 * SystemRegistry manages system dependencies and execution order.
 *
 * Instead of using numeric priorities (which are error-prone and don't express
 * intent), the registry uses explicit dependencies and topological sort to
 * determine execution order.
 *
 * Benefits:
 * - Self-documenting: dependencies express WHY systems run in a certain order
 * - Validates at startup: catches cycles and missing dependencies immediately
 * - Maintainable: adding new systems just requires declaring dependencies
 */
export class SystemRegistry {
  private definitions = new Map<string, SystemDefinition>();

  /**
   * Register a system definition.
   * @throws Error if a system with the same name is already registered
   */
  public register(definition: SystemDefinition): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`System "${definition.name}" is already registered`);
    }
    this.definitions.set(definition.name, definition);
  }

  /**
   * Register multiple system definitions.
   */
  public registerAll(definitions: SystemDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Validate all dependencies and check for cycles.
   * @returns Array of error messages (empty if valid)
   */
  public validate(): string[] {
    const errors: string[] = [];

    // Check for missing dependencies
    for (const [name, def] of this.definitions) {
      for (const dep of def.dependencies) {
        if (!this.definitions.has(dep)) {
          errors.push(`System "${name}" depends on unknown system: "${dep}"`);
        }
      }
    }

    // Check for cycles using topological sort
    try {
      this.getExecutionOrder();
    } catch (e) {
      if (e instanceof Error) {
        errors.push(e.message);
      }
    }

    return errors;
  }

  /**
   * Get the execution order using topological sort (Kahn's algorithm).
   * @returns Array of system names in dependency order
   * @throws Error if circular dependency detected
   */
  public getExecutionOrder(): string[] {
    // Build adjacency list and in-degree count
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // dep -> systems that depend on it

    for (const name of this.definitions.keys()) {
      inDegree.set(name, 0);
      dependents.set(name, []);
    }

    for (const [name, def] of this.definitions) {
      for (const dep of def.dependencies) {
        if (this.definitions.has(dep)) {
          inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
          dependents.get(dep)!.push(name);
        }
      }
    }

    // Find all systems with no dependencies (in-degree 0)
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    // Sort queue for deterministic order when multiple systems have no deps
    queue.sort();

    const result: string[] = [];

    while (queue.length > 0) {
      // Sort to ensure deterministic order among systems at same "level"
      queue.sort();
      const current = queue.shift()!;
      result.push(current);

      // Reduce in-degree for all dependents
      for (const dependent of dependents.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // If we didn't process all systems, there's a cycle
    if (result.length !== this.definitions.size) {
      const remaining = [...this.definitions.keys()].filter(
        (name) => !result.includes(name)
      );
      throw new Error(
        `Circular dependency detected involving systems: ${remaining.join(', ')}`
      );
    }

    return result;
  }

  /**
   * Create all system instances in dependency order.
   * @param game The game instance to pass to system constructors
   * @returns Array of system instances in execution order
   */
  public createSystems(game: Game): System[] {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new Error(`System dependency errors:\n${errors.join('\n')}`);
    }

    const order = this.getExecutionOrder();
    const systems: System[] = [];
    const createdSystems = new Map<string, System>();

    for (const name of order) {
      const def = this.definitions.get(name)!;

      // Check condition if present
      if (def.condition && !def.condition(game)) {
        continue;
      }

      const system = def.factory(game);

      // Validate that the system's name matches the definition
      if (system.name !== name) {
        throw new Error(
          `System name mismatch: definition says "${name}" but system.name is "${system.name}"`
        );
      }

      systems.push(system);
      createdSystems.set(name, system);
    }

    // Assign priorities based on execution order for compatibility with existing code
    // This ensures World.addSystem() sorting doesn't break anything
    for (let i = 0; i < systems.length; i++) {
      systems[i].priority = i * 10;
    }

    return systems;
  }

  /**
   * Get a registered system definition by name.
   */
  public getDefinition(name: string): SystemDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * Get all registered system names.
   */
  public getSystemNames(): string[] {
    return [...this.definitions.keys()];
  }

  /**
   * Clear all registered definitions.
   */
  public clear(): void {
    this.definitions.clear();
  }

  /**
   * Print the dependency graph for debugging.
   */
  public printDependencyGraph(): void {
    console.log('System Dependency Graph:');
    console.log('========================');

    const order = this.getExecutionOrder();
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      const def = this.definitions.get(name)!;
      const deps = def.dependencies.length > 0
        ? `← [${def.dependencies.join(', ')}]`
        : '(no dependencies)';
      console.log(`${i + 1}. ${name} ${deps}`);
    }
  }
}
