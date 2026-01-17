/**
 * Behavior Tree Implementation for RTS AI
 *
 * Features:
 * - Stateless functional nodes with composable architecture
 * - Memory nodes that resume from previous state
 * - Utility-based selection with dynamic scoring
 * - Reactive sequences with interrupt support
 * - Hierarchical blackboard with scoping
 * - Comprehensive debugging and tracing
 * - Pre-built combat, worker, and strategic behaviors
 *
 * Architecture follows industry standards from:
 * - Unreal Engine Behavior Trees
 * - Unity's ML-Agents
 * - behavior3js patterns
 */

import { debugAI } from '@/utils/debugLogger';

// ==================== CORE TYPES ====================

export type BehaviorStatus = 'success' | 'failure' | 'running';

export interface BehaviorContext {
  entityId: number;
  world: import('../ecs/World').World;
  game: import('../core/Game').Game;
  blackboard: Blackboard;
  deltaTime: number;
  tick: number;
  // Debug info
  trace?: BehaviorTrace;
}

export interface BehaviorTrace {
  nodes: TraceEntry[];
  startTime: number;
  endTime?: number;
}

export interface TraceEntry {
  nodeId: string;
  nodeName: string;
  status: BehaviorStatus;
  startTime: number;
  endTime: number;
  depth: number;
}

// Node metadata for debugging
export interface NodeMetadata {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export type BehaviorNode = ((context: BehaviorContext) => BehaviorStatus) & {
  __meta?: NodeMetadata;
};

// ==================== BLACKBOARD ====================

/**
 * Hierarchical blackboard for sharing data between nodes.
 * Supports scoped data (per-entity, per-tree, global).
 */
export class Blackboard {
  private data: Map<string, unknown> = new Map();
  private parent: Blackboard | null = null;
  private children: Map<string, Blackboard> = new Map();

  constructor(parent: Blackboard | null = null) {
    this.parent = parent;
  }

  /**
   * Get a value, checking parent scopes if not found
   */
  public get<T>(key: string): T | undefined {
    if (this.data.has(key)) {
      return this.data.get(key) as T;
    }
    return this.parent?.get<T>(key);
  }

  /**
   * Set a value in this scope
   */
  public set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  /**
   * Check if key exists in this scope or parents
   */
  public has(key: string): boolean {
    return this.data.has(key) || (this.parent?.has(key) ?? false);
  }

  /**
   * Delete a key from this scope
   */
  public delete(key: string): boolean {
    return this.data.delete(key);
  }

  /**
   * Clear all data in this scope
   */
  public clear(): void {
    this.data.clear();
  }

  /**
   * Create a child scope
   */
  public createScope(name: string): Blackboard {
    const child = new Blackboard(this);
    this.children.set(name, child);
    return child;
  }

  /**
   * Get or create a child scope
   */
  public getScope(name: string): Blackboard {
    if (!this.children.has(name)) {
      this.children.set(name, new Blackboard(this));
    }
    return this.children.get(name)!;
  }

  /**
   * Get all keys in this scope (not parents)
   */
  public keys(): string[] {
    return Array.from(this.data.keys());
  }

  /**
   * Serialize blackboard state for debugging
   */
  public toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      result[key] = value;
    }
    return result;
  }
}

// ==================== NODE FACTORY HELPERS ====================

let nodeIdCounter = 0;

function createNode(
  fn: (context: BehaviorContext) => BehaviorStatus,
  type: string,
  name: string,
  description?: string
): BehaviorNode {
  const node = fn as BehaviorNode;
  node.__meta = {
    id: `${type}_${++nodeIdCounter}`,
    name,
    type,
    description,
  };
  return node;
}

// ==================== COMPOSITE NODES ====================

/**
 * Selector (OR) - Tries children in order until one succeeds
 * Returns success if any child succeeds, failure if all fail
 */
export function selector(name: string, ...children: BehaviorNode[]): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      for (const child of children) {
        const status = child(context);
        if (status === 'success') return 'success';
        if (status === 'running') return 'running';
      }
      return 'failure';
    },
    'selector',
    name,
    `Tries ${children.length} children until one succeeds`
  );
}

/**
 * Sequence (AND) - Tries children in order until one fails
 * Returns success if all children succeed, failure if any fails
 */
export function sequence(name: string, ...children: BehaviorNode[]): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      for (const child of children) {
        const status = child(context);
        if (status === 'failure') return 'failure';
        if (status === 'running') return 'running';
      }
      return 'success';
    },
    'sequence',
    name,
    `Runs ${children.length} children in sequence`
  );
}

/**
 * Memory Selector - Remembers which child was running and resumes from there
 */
export function memorySelector(name: string, ...children: BehaviorNode[]): BehaviorNode {
  const stateKey = `__memSel_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      let startIndex = context.blackboard.get<number>(stateKey) ?? 0;

      for (let i = startIndex; i < children.length; i++) {
        const status = children[i](context);

        if (status === 'running') {
          context.blackboard.set(stateKey, i);
          return 'running';
        }

        if (status === 'success') {
          context.blackboard.delete(stateKey);
          return 'success';
        }
      }

      context.blackboard.delete(stateKey);
      return 'failure';
    },
    'memorySelector',
    name,
    `Selector that resumes from last running child`
  );
}

/**
 * Memory Sequence - Remembers which child was running and resumes from there
 */
export function memorySequence(name: string, ...children: BehaviorNode[]): BehaviorNode {
  const stateKey = `__memSeq_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      let startIndex = context.blackboard.get<number>(stateKey) ?? 0;

      for (let i = startIndex; i < children.length; i++) {
        const status = children[i](context);

        if (status === 'running') {
          context.blackboard.set(stateKey, i);
          return 'running';
        }

        if (status === 'failure') {
          context.blackboard.delete(stateKey);
          return 'failure';
        }
      }

      context.blackboard.delete(stateKey);
      return 'success';
    },
    'memorySequence',
    name,
    `Sequence that resumes from last running child`
  );
}

/**
 * Parallel - Runs all children simultaneously
 * Returns success if required number succeed, failure if too many fail
 */
export function parallel(
  name: string,
  successThreshold: number,
  ...children: BehaviorNode[]
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      let successCount = 0;
      let failureCount = 0;
      const failureThreshold = children.length - successThreshold + 1;

      for (const child of children) {
        const status = child(context);
        if (status === 'success') successCount++;
        if (status === 'failure') failureCount++;
      }

      if (successCount >= successThreshold) return 'success';
      if (failureCount >= failureThreshold) return 'failure';
      return 'running';
    },
    'parallel',
    name,
    `Runs ${children.length} children in parallel, needs ${successThreshold} to succeed`
  );
}

/**
 * Utility Selector - Scores children and picks the best
 * This is more sophisticated than priority - it evaluates all and picks highest
 */
export function utilitySelector(
  name: string,
  children: Array<{
    node: BehaviorNode;
    score: (ctx: BehaviorContext) => number;
    threshold?: number; // Minimum score to consider
  }>
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      let bestChild: BehaviorNode | null = null;
      let bestScore = -Infinity;

      for (const { node, score, threshold = 0 } of children) {
        const s = score(context);
        if (s >= threshold && s > bestScore) {
          bestScore = s;
          bestChild = node;
        }
      }

      if (bestChild) {
        return bestChild(context);
      }
      return 'failure';
    },
    'utilitySelector',
    name,
    `Picks highest-scoring option from ${children.length} children`
  );
}

// ==================== DECORATOR NODES ====================

/**
 * Inverter - Inverts the result of a child node
 */
export function inverter(name: string, child: BehaviorNode): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      const status = child(context);
      if (status === 'success') return 'failure';
      if (status === 'failure') return 'success';
      return 'running';
    },
    'inverter',
    name,
    `Inverts child result`
  );
}

/**
 * Succeeder - Always returns success (useful for optional actions)
 */
export function succeeder(name: string, child: BehaviorNode): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      child(context);
      return 'success';
    },
    'succeeder',
    name,
    `Always succeeds after running child`
  );
}

/**
 * Condition - Only runs child if condition is true
 */
export function condition(
  name: string,
  predicate: (context: BehaviorContext) => boolean,
  child: BehaviorNode
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      if (predicate(context)) {
        return child(context);
      }
      return 'failure';
    },
    'condition',
    name,
    `Guards child with condition`
  );
}

/**
 * Guard - Like condition but can specify failure vs running on false
 */
export function guard(
  name: string,
  predicate: (context: BehaviorContext) => boolean,
  child: BehaviorNode,
  onFalse: BehaviorStatus = 'failure'
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      if (predicate(context)) {
        return child(context);
      }
      return onFalse;
    },
    'guard',
    name,
    `Guards child, returns ${onFalse} if condition false`
  );
}

/**
 * Cooldown - Only allows child to run after cooldown period
 */
export function cooldown(
  name: string,
  cooldownMs: number,
  child: BehaviorNode
): BehaviorNode {
  const stateKey = `__cd_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      const lastRun = context.blackboard.get<number>(stateKey) ?? 0;
      const now = Date.now();

      if (now - lastRun < cooldownMs) {
        return 'failure';
      }

      const status = child(context);

      if (status === 'success') {
        context.blackboard.set(stateKey, now);
      }

      return status;
    },
    'cooldown',
    name,
    `Enforces ${cooldownMs}ms cooldown between executions`
  );
}

/**
 * Cooldown by ticks (deterministic, better for multiplayer)
 */
export function cooldownTicks(
  name: string,
  cooldownTicks: number,
  child: BehaviorNode
): BehaviorNode {
  const stateKey = `__cdT_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      const lastRun = context.blackboard.get<number>(stateKey) ?? 0;

      if (context.tick - lastRun < cooldownTicks) {
        return 'failure';
      }

      const status = child(context);

      if (status === 'success') {
        context.blackboard.set(stateKey, context.tick);
      }

      return status;
    },
    'cooldownTicks',
    name,
    `Enforces ${cooldownTicks} tick cooldown between executions`
  );
}

/**
 * Timeout - Fails if child takes too long (by ticks)
 */
export function timeout(
  name: string,
  maxTicks: number,
  child: BehaviorNode
): BehaviorNode {
  const startKey = `__to_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      let startTick = context.blackboard.get<number>(startKey);

      if (startTick === undefined) {
        startTick = context.tick;
        context.blackboard.set(startKey, startTick);
      }

      if (context.tick - startTick >= maxTicks) {
        context.blackboard.delete(startKey);
        return 'failure';
      }

      const status = child(context);

      if (status !== 'running') {
        context.blackboard.delete(startKey);
      }

      return status;
    },
    'timeout',
    name,
    `Fails if child runs longer than ${maxTicks} ticks`
  );
}

/**
 * Reactive - Re-evaluates condition each tick, can interrupt running child
 */
export function reactive(
  name: string,
  predicate: (context: BehaviorContext) => boolean,
  child: BehaviorNode
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      // Always check condition first
      if (!predicate(context)) {
        return 'failure';
      }
      return child(context);
    },
    'reactive',
    name,
    `Re-evaluates condition each tick`
  );
}

// ==================== ACTION NODES ====================

/**
 * Action - Wraps a function that performs an action
 */
export function action(
  name: string,
  fn: (context: BehaviorContext) => boolean
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      return fn(context) ? 'success' : 'failure';
    },
    'action',
    name,
    `Executes action`
  );
}

/**
 * Action with running state - Can return running
 */
export function asyncAction(
  name: string,
  fn: (context: BehaviorContext) => BehaviorStatus
): BehaviorNode {
  return createNode(fn, 'asyncAction', name, `Executes async action`);
}

/**
 * Wait - Waits for a specified duration (in ticks for determinism)
 */
export function wait(name: string, durationTicks: number): BehaviorNode {
  const startKey = `__wait_${name}_${++nodeIdCounter}`;

  return createNode(
    (context: BehaviorContext) => {
      let startTick = context.blackboard.get<number>(startKey);

      if (startTick === undefined) {
        startTick = context.tick;
        context.blackboard.set(startKey, startTick);
      }

      if (context.tick - startTick >= durationTicks) {
        context.blackboard.delete(startKey);
        return 'success';
      }

      return 'running';
    },
    'wait',
    name,
    `Waits for ${durationTicks} ticks`
  );
}

/**
 * Log - Logs a message (for debugging)
 */
export function log(name: string, message: string | ((ctx: BehaviorContext) => string)): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      const msg = typeof message === 'function' ? message(context) : message;
      debugAI.log(`[BT:${context.entityId}] ${msg}`);
      return 'success';
    },
    'log',
    name,
    `Logs message`
  );
}

/**
 * SetBlackboard - Sets a value on the blackboard
 */
export function setBlackboard(
  name: string,
  key: string,
  value: unknown | ((ctx: BehaviorContext) => unknown)
): BehaviorNode {
  return createNode(
    (context: BehaviorContext) => {
      const v = typeof value === 'function' ? (value as (ctx: BehaviorContext) => unknown)(context) : value;
      context.blackboard.set(key, v);
      return 'success';
    },
    'setBlackboard',
    name,
    `Sets blackboard key "${key}"`
  );
}

/**
 * Fail - Always fails
 */
export function fail(name: string): BehaviorNode {
  return createNode(() => 'failure', 'fail', name, `Always fails`);
}

/**
 * Running - Always returns running
 */
export function running(name: string): BehaviorNode {
  return createNode(() => 'running', 'running', name, `Always running`);
}

// ==================== BEHAVIOR TREE RUNNER ====================

/**
 * Stateful behavior tree runner with debugging support
 */
export class BehaviorTreeRunner {
  private root: BehaviorNode;
  private blackboard: Blackboard;
  private debugEnabled: boolean = false;
  private lastTrace: BehaviorTrace | null = null;

  constructor(root: BehaviorNode, parentBlackboard?: Blackboard) {
    this.root = root;
    this.blackboard = parentBlackboard
      ? parentBlackboard.createScope(`tree_${nodeIdCounter++}`)
      : new Blackboard();
  }

  /**
   * Tick the behavior tree
   */
  public tick(
    entityId: number,
    world: import('../ecs/World').World,
    game: import('../core/Game').Game,
    deltaTime: number
  ): BehaviorStatus {
    const context: BehaviorContext = {
      entityId,
      world,
      game,
      blackboard: this.blackboard,
      deltaTime,
      tick: game.getCurrentTick(),
    };

    if (this.debugEnabled) {
      context.trace = {
        nodes: [],
        startTime: performance.now(),
      };
    }

    const status = this.root(context);

    if (context.trace) {
      context.trace.endTime = performance.now();
      this.lastTrace = context.trace;
    }

    return status;
  }

  /**
   * Get the blackboard
   */
  public getBlackboard(): Blackboard {
    return this.blackboard;
  }

  /**
   * Set a blackboard value
   */
  public set(key: string, value: unknown): void {
    this.blackboard.set(key, value);
  }

  /**
   * Get a blackboard value
   */
  public get<T>(key: string): T | undefined {
    return this.blackboard.get<T>(key);
  }

  /**
   * Clear the blackboard
   */
  public clear(): void {
    this.blackboard.clear();
  }

  /**
   * Enable/disable debugging
   */
  public setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Get the last execution trace
   */
  public getLastTrace(): BehaviorTrace | null {
    return this.lastTrace;
  }

  /**
   * Get the root node metadata
   */
  public getRootMeta(): NodeMetadata | undefined {
    return this.root.__meta;
  }
}

// ==================== GLOBAL BLACKBOARD ====================

/**
 * Global blackboard for sharing data across all behavior trees
 */
export const globalBlackboard = new Blackboard();

// ==================== RE-EXPORTS FOR BACKWARDS COMPATIBILITY ====================

// Keep old function signatures working
export { selector as selectorSimple };
export { sequence as sequenceSimple };
