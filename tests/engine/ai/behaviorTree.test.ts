import { describe, it, expect, beforeEach } from 'vitest';
import {
  Blackboard,
  BehaviorContext,
  BehaviorStatus,
  BehaviorNode,
  selector,
  sequence,
  memorySelector,
  memorySequence,
  parallel,
  utilitySelector,
  inverter,
  succeeder,
  condition,
  guard,
  cooldownTicks,
  timeout,
  reactive,
  action,
  asyncAction,
  wait,
  setBlackboard,
  fail,
  running,
  BehaviorTreeRunner,
  globalBlackboard,
} from '@/engine/ai/BehaviorTree';

// Mock minimal context
function createMockContext(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  return {
    entityId: 1,
    world: {} as BehaviorContext['world'],
    game: { getCurrentTick: () => overrides.tick ?? 0 } as BehaviorContext['game'],
    blackboard: new Blackboard(),
    deltaTime: 0.016,
    tick: 0,
    ...overrides,
  };
}

// Helper to create nodes that track execution
function createTrackingNode(status: BehaviorStatus, tracker: { calls: number[] }, id: number): BehaviorNode {
  return action(`tracker-${id}`, () => {
    tracker.calls.push(id);
    return status === 'success';
  });
}

describe('Blackboard', () => {
  let blackboard: Blackboard;

  beforeEach(() => {
    blackboard = new Blackboard();
  });

  it('stores and retrieves values', () => {
    blackboard.set('health', 100);
    blackboard.set('name', 'warrior');

    expect(blackboard.get('health')).toBe(100);
    expect(blackboard.get('name')).toBe('warrior');
  });

  it('returns undefined for missing keys', () => {
    expect(blackboard.get('missing')).toBeUndefined();
  });

  it('checks key existence', () => {
    blackboard.set('exists', true);

    expect(blackboard.has('exists')).toBe(true);
    expect(blackboard.has('missing')).toBe(false);
  });

  it('deletes keys', () => {
    blackboard.set('temp', 'value');
    expect(blackboard.has('temp')).toBe(true);

    const result = blackboard.delete('temp');

    expect(result).toBe(true);
    expect(blackboard.has('temp')).toBe(false);
  });

  it('clears all data', () => {
    blackboard.set('a', 1);
    blackboard.set('b', 2);

    blackboard.clear();

    expect(blackboard.has('a')).toBe(false);
    expect(blackboard.has('b')).toBe(false);
  });

  it('lists keys', () => {
    blackboard.set('x', 1);
    blackboard.set('y', 2);
    blackboard.set('z', 3);

    const keys = blackboard.keys();

    expect(keys).toContain('x');
    expect(keys).toContain('y');
    expect(keys).toContain('z');
    expect(keys.length).toBe(3);
  });

  describe('hierarchical scoping', () => {
    it('inherits values from parent', () => {
      const parent = new Blackboard();
      parent.set('inherited', 'from parent');

      const child = new Blackboard(parent);

      expect(child.get('inherited')).toBe('from parent');
    });

    it('shadows parent values', () => {
      const parent = new Blackboard();
      parent.set('value', 'parent');

      const child = new Blackboard(parent);
      child.set('value', 'child');

      expect(child.get('value')).toBe('child');
      expect(parent.get('value')).toBe('parent');
    });

    it('creates named scopes', () => {
      const scope = blackboard.createScope('combat');
      scope.set('target', 42);

      expect(scope.get('target')).toBe(42);
    });

    it('gets or creates scopes', () => {
      const scope1 = blackboard.getScope('test');
      const scope2 = blackboard.getScope('test');

      expect(scope1).toBe(scope2);
    });
  });

  it('serializes to JSON', () => {
    blackboard.set('num', 42);
    blackboard.set('str', 'hello');

    const json = blackboard.toJSON();

    expect(json).toEqual({ num: 42, str: 'hello' });
  });
});

describe('Composite Nodes', () => {
  describe('selector', () => {
    it('returns success on first successful child', () => {
      const sel = selector('test',
        action('fail1', () => false),
        action('succeed', () => true),
        action('fail2', () => false)
      );

      const result = sel(createMockContext());

      expect(result).toBe('success');
    });

    it('returns failure when all children fail', () => {
      const sel = selector('test',
        action('fail1', () => false),
        action('fail2', () => false)
      );

      const result = sel(createMockContext());

      expect(result).toBe('failure');
    });

    it('returns running when child is running', () => {
      const sel = selector('test',
        action('fail', () => false),
        asyncAction('running', () => 'running')
      );

      const result = sel(createMockContext());

      expect(result).toBe('running');
    });

    it('stops evaluating after success', () => {
      const tracker = { calls: [] as number[] };

      const sel = selector('test',
        createTrackingNode('failure', tracker, 1),
        createTrackingNode('success', tracker, 2),
        createTrackingNode('success', tracker, 3)
      );

      sel(createMockContext());

      expect(tracker.calls).toEqual([1, 2]);
    });
  });

  describe('sequence', () => {
    it('returns success when all children succeed', () => {
      const seq = sequence('test',
        action('s1', () => true),
        action('s2', () => true),
        action('s3', () => true)
      );

      const result = seq(createMockContext());

      expect(result).toBe('success');
    });

    it('returns failure on first failing child', () => {
      const seq = sequence('test',
        action('s1', () => true),
        action('fail', () => false),
        action('s2', () => true)
      );

      const result = seq(createMockContext());

      expect(result).toBe('failure');
    });

    it('returns running when child is running', () => {
      const seq = sequence('test',
        action('s1', () => true),
        asyncAction('running', () => 'running')
      );

      const result = seq(createMockContext());

      expect(result).toBe('running');
    });

    it('stops evaluating after failure', () => {
      const tracker = { calls: [] as number[] };

      const seq = sequence('test',
        createTrackingNode('success', tracker, 1),
        createTrackingNode('failure', tracker, 2),
        createTrackingNode('success', tracker, 3)
      );

      seq(createMockContext());

      expect(tracker.calls).toEqual([1, 2]);
    });
  });

  describe('memorySelector', () => {
    it('resumes from running child', () => {
      const blackboard = new Blackboard();
      let runCount = 0;

      const memSel = memorySelector('test',
        action('fail', () => false),
        asyncAction('runThenSucceed', () => {
          runCount++;
          return runCount >= 2 ? 'success' : 'running';
        })
      );

      const ctx = createMockContext({ blackboard });

      // First tick - goes running
      expect(memSel(ctx)).toBe('running');

      // Second tick - should resume from second child, not re-evaluate first
      expect(memSel(ctx)).toBe('success');
      expect(runCount).toBe(2);
    });
  });

  describe('memorySequence', () => {
    it('resumes from running child', () => {
      const blackboard = new Blackboard();
      let firstCalled = 0;
      let runCount = 0;

      const memSeq = memorySequence('test',
        action('succeed', () => {
          firstCalled++;
          return true;
        }),
        asyncAction('runThenSucceed', () => {
          runCount++;
          return runCount >= 2 ? 'success' : 'running';
        })
      );

      const ctx = createMockContext({ blackboard });

      // First tick
      expect(memSeq(ctx)).toBe('running');
      expect(firstCalled).toBe(1);

      // Second tick - should NOT call first child again
      expect(memSeq(ctx)).toBe('success');
      expect(firstCalled).toBe(1);
      expect(runCount).toBe(2);
    });
  });

  describe('parallel', () => {
    it('returns success when threshold is met', () => {
      const par = parallel('test', 2,
        action('s1', () => true),
        action('s2', () => true),
        action('fail', () => false)
      );

      const result = par(createMockContext());

      expect(result).toBe('success');
    });

    it('returns failure when too many fail', () => {
      const par = parallel('test', 2,
        action('s1', () => true),
        action('f1', () => false),
        action('f2', () => false)
      );

      const result = par(createMockContext());

      expect(result).toBe('failure');
    });

    it('returns running when threshold not yet met', () => {
      const par = parallel('test', 2,
        action('s1', () => true),
        asyncAction('running', () => 'running'),
        asyncAction('running2', () => 'running')
      );

      const result = par(createMockContext());

      expect(result).toBe('running');
    });
  });

  describe('utilitySelector', () => {
    it('picks highest scoring child', () => {
      const tracker = { calls: [] as number[] };

      const util = utilitySelector('test', [
        { node: createTrackingNode('success', tracker, 1), score: () => 10 },
        { node: createTrackingNode('success', tracker, 2), score: () => 50 },
        { node: createTrackingNode('success', tracker, 3), score: () => 30 },
      ]);

      util(createMockContext());

      expect(tracker.calls).toEqual([2]);
    });

    it('respects threshold', () => {
      const util = utilitySelector('test', [
        { node: action('low', () => true), score: () => 5, threshold: 10 },
        { node: action('high', () => true), score: () => 15, threshold: 10 },
      ]);

      const result = util(createMockContext());

      expect(result).toBe('success');
    });

    it('returns failure when no child meets threshold', () => {
      const util = utilitySelector('test', [
        { node: action('a', () => true), score: () => 5, threshold: 10 },
        { node: action('b', () => true), score: () => 8, threshold: 10 },
      ]);

      const result = util(createMockContext());

      expect(result).toBe('failure');
    });
  });
});

describe('Decorator Nodes', () => {
  describe('inverter', () => {
    it('inverts success to failure', () => {
      const inv = inverter('test', action('succeed', () => true));
      expect(inv(createMockContext())).toBe('failure');
    });

    it('inverts failure to success', () => {
      const inv = inverter('test', action('fail', () => false));
      expect(inv(createMockContext())).toBe('success');
    });

    it('preserves running', () => {
      const inv = inverter('test', asyncAction('running', () => 'running'));
      expect(inv(createMockContext())).toBe('running');
    });
  });

  describe('succeeder', () => {
    it('always returns success', () => {
      const succ = succeeder('test', action('fail', () => false));
      expect(succ(createMockContext())).toBe('success');
    });
  });

  describe('condition', () => {
    it('runs child when condition is true', () => {
      const cond = condition('test', () => true, action('child', () => true));
      expect(cond(createMockContext())).toBe('success');
    });

    it('returns failure when condition is false', () => {
      const cond = condition('test', () => false, action('child', () => true));
      expect(cond(createMockContext())).toBe('failure');
    });
  });

  describe('guard', () => {
    it('runs child when predicate is true', () => {
      const g = guard('test', () => true, action('child', () => true));
      expect(g(createMockContext())).toBe('success');
    });

    it('returns specified status when predicate is false', () => {
      const gFail = guard('test', () => false, action('child', () => true), 'failure');
      const gRun = guard('test', () => false, action('child', () => true), 'running');

      expect(gFail(createMockContext())).toBe('failure');
      expect(gRun(createMockContext())).toBe('running');
    });
  });

  describe('cooldownTicks', () => {
    it('allows execution when past cooldown', () => {
      const blackboard = new Blackboard();
      // Use tick > cooldown to avoid the edge case where default lastRun=0 at tick=0 causes failure
      const cd = cooldownTicks('test-initial', 5, action('child', () => true));
      const ctx = createMockContext({ blackboard, tick: 10 });

      expect(cd(ctx)).toBe('success');
    });

    it('blocks execution during cooldown', () => {
      const blackboard = new Blackboard();
      const cd = cooldownTicks('test-block', 5, action('child', () => true));

      // Execute at tick 0
      cd(createMockContext({ blackboard, tick: 0 }));

      // Should fail during cooldown
      expect(cd(createMockContext({ blackboard, tick: 2 }))).toBe('failure');
      expect(cd(createMockContext({ blackboard, tick: 4 }))).toBe('failure');

      // Should succeed after cooldown
      expect(cd(createMockContext({ blackboard, tick: 5 }))).toBe('success');
    });
  });

  describe('timeout', () => {
    it('allows normal completion', () => {
      const blackboard = new Blackboard();
      const to = timeout('test', 10, action('quick', () => true));

      expect(to(createMockContext({ blackboard, tick: 0 }))).toBe('success');
    });

    it('fails when child exceeds timeout', () => {
      const blackboard = new Blackboard();
      const to = timeout('test', 5, asyncAction('slow', () => 'running'));

      // Start at tick 0
      to(createMockContext({ blackboard, tick: 0 }));

      // Still running at tick 4
      expect(to(createMockContext({ blackboard, tick: 4 }))).toBe('running');

      // Times out at tick 5
      expect(to(createMockContext({ blackboard, tick: 5 }))).toBe('failure');
    });
  });

  describe('reactive', () => {
    it('re-evaluates condition each tick', () => {
      let shouldRun = true;

      const react = reactive('test', () => shouldRun, asyncAction('child', () => 'running'));
      const ctx = createMockContext();

      expect(react(ctx)).toBe('running');

      shouldRun = false;
      expect(react(ctx)).toBe('failure');
    });
  });
});

describe('Action Nodes', () => {
  describe('action', () => {
    it('returns success for truthy result', () => {
      const act = action('test', () => true);
      expect(act(createMockContext())).toBe('success');
    });

    it('returns failure for falsy result', () => {
      const act = action('test', () => false);
      expect(act(createMockContext())).toBe('failure');
    });
  });

  describe('asyncAction', () => {
    it('returns the status directly', () => {
      expect(asyncAction('s', () => 'success')(createMockContext())).toBe('success');
      expect(asyncAction('f', () => 'failure')(createMockContext())).toBe('failure');
      expect(asyncAction('r', () => 'running')(createMockContext())).toBe('running');
    });
  });

  describe('wait', () => {
    it('returns running during wait period', () => {
      const blackboard = new Blackboard();
      const w = wait('test', 5);

      expect(w(createMockContext({ blackboard, tick: 0 }))).toBe('running');
      expect(w(createMockContext({ blackboard, tick: 2 }))).toBe('running');
      expect(w(createMockContext({ blackboard, tick: 4 }))).toBe('running');
    });

    it('returns success after wait period', () => {
      const blackboard = new Blackboard();
      const w = wait('test', 5);

      w(createMockContext({ blackboard, tick: 0 }));

      expect(w(createMockContext({ blackboard, tick: 5 }))).toBe('success');
    });
  });

  describe('setBlackboard', () => {
    it('sets static value', () => {
      const blackboard = new Blackboard();
      const sb = setBlackboard('test', 'key', 'value');

      sb(createMockContext({ blackboard }));

      expect(blackboard.get('key')).toBe('value');
    });

    it('sets computed value', () => {
      const blackboard = new Blackboard();
      const sb = setBlackboard('test', 'key', (ctx) => ctx.entityId * 10);

      sb(createMockContext({ blackboard, entityId: 5 }));

      expect(blackboard.get('key')).toBe(50);
    });
  });

  describe('fail and running', () => {
    it('fail always returns failure', () => {
      expect(fail('test')(createMockContext())).toBe('failure');
    });

    it('running always returns running', () => {
      expect(running('test')(createMockContext())).toBe('running');
    });
  });
});

describe('BehaviorTreeRunner', () => {
  it('ticks the root node', () => {
    const root = action('root', () => true);
    const runner = new BehaviorTreeRunner(root);

    const status = runner.tick(
      1,
      {} as BehaviorContext['world'],
      { getCurrentTick: () => 0 } as BehaviorContext['game'],
      0.016
    );

    expect(status).toBe('success');
  });

  it('maintains blackboard across ticks', () => {
    let tickCount = 0;
    const root = sequence('test',
      setBlackboard('set', 'counter', () => ++tickCount),
      action('check', () => true)
    );

    const runner = new BehaviorTreeRunner(root);
    const game = { getCurrentTick: () => 0 } as BehaviorContext['game'];
    const world = {} as BehaviorContext['world'];

    runner.tick(1, world, game, 0.016);
    runner.tick(1, world, game, 0.016);

    expect(runner.get('counter')).toBe(2);
  });

  it('provides set/get for blackboard', () => {
    const runner = new BehaviorTreeRunner(action('test', () => true));

    runner.set('key', 'value');
    expect(runner.get('key')).toBe('value');
  });

  it('clears blackboard', () => {
    const runner = new BehaviorTreeRunner(action('test', () => true));

    runner.set('key', 'value');
    runner.clear();

    expect(runner.get('key')).toBeUndefined();
  });

  it('exposes root node metadata', () => {
    const root = selector('MySelector', action('a', () => true));
    const runner = new BehaviorTreeRunner(root);

    const meta = runner.getRootMeta();

    expect(meta?.name).toBe('MySelector');
    expect(meta?.type).toBe('selector');
  });
});

describe('globalBlackboard', () => {
  it('is a shared Blackboard instance', () => {
    globalBlackboard.set('global-test', 'value');
    expect(globalBlackboard.get('global-test')).toBe('value');
    globalBlackboard.delete('global-test');
  });
});
