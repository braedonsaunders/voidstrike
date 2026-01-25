import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventBus } from '@/engine/core/EventBus';

describe('EventBus', () => {
  it('registers listeners and emits data', () => {
    const bus = new EventBus();
    const payloads: number[] = [];

    bus.on<number>('tick', (value) => payloads.push(value));
    bus.emit('tick', 3);
    bus.emit('tick', 7);

    assert.deepStrictEqual(payloads, [3, 7]);
  });

  it('supports once listeners', () => {
    const bus = new EventBus();
    let calls = 0;

    bus.once('ready', () => {
      calls += 1;
    });

    bus.emit('ready');
    bus.emit('ready');

    assert.strictEqual(calls, 1);
  });

  it('unsubscribes listeners and clears events', () => {
    const bus = new EventBus();
    let calls = 0;

    const unsubscribe = bus.on('event', () => {
      calls += 1;
    });

    bus.emit('event');
    unsubscribe();
    bus.emit('event');

    assert.strictEqual(calls, 1);
    assert.strictEqual(bus.hasListeners('event'), false);

    bus.on('event', () => {
      calls += 1;
    });
    assert.strictEqual(bus.listenerCount('event'), 1);

    bus.clear('event');
    assert.strictEqual(bus.listenerCount('event'), 0);
  });

  it('handles unsubscribe during emit without skipping remaining listeners', () => {
    const bus = new EventBus();
    const calls: string[] = [];

    let removeSecond: () => void = () => undefined;

    bus.on('swap', () => {
      calls.push('first');
      removeSecond();
    });

    removeSecond = bus.on('swap', () => {
      calls.push('second');
    });

    bus.on('swap', () => {
      calls.push('third');
    });

    bus.emit('swap');

    assert.deepStrictEqual(calls, ['first', 'third']);
  });

  it('emits error summaries when handlers throw', () => {
    const bus = new EventBus();
    const errors: Array<{ event: string; errorCount: number }> = [];

    bus.on('eventbus:errors', (payload) => {
      errors.push(payload as { event: string; errorCount: number });
    });

    bus.on('faulty', () => {
      throw new Error('boom');
    });

    bus.on('faulty', () => {
      throw new Error('bang');
    });

    bus.emit('faulty');

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].event, 'faulty');
    assert.strictEqual(errors[0].errorCount, 2);
  });
});
