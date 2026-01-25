import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseConnectionCode,
  ConnectionCodeError,
} from '@/engine/network/p2p/ConnectionCode';

describe('ConnectionCode - parseConnectionCode error handling', () => {
  it('throws on code that is too short', () => {
    assert.throws(() => {
      parseConnectionCode('VOID-ABC');
    }, ConnectionCodeError);
  });

  it('throws on empty code', () => {
    assert.throws(() => {
      parseConnectionCode('');
    }, ConnectionCodeError);
  });

  it('throws on just prefix', () => {
    assert.throws(() => {
      parseConnectionCode('VOID-');
    }, ConnectionCodeError);
  });

  it('throws on random garbage', () => {
    assert.throws(() => {
      parseConnectionCode('NOT-A-VALID-CODE-AT-ALL-AAAA-BBBB-CCCC');
    }, ConnectionCodeError);
  });

  it('throws ConnectionCodeError specifically', () => {
    try {
      parseConnectionCode('VOID-INVALID');
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error instanceof ConnectionCodeError);
    }
  });
});

describe('ConnectionCodeError', () => {
  it('is an instance of Error', () => {
    const error = new ConnectionCodeError('test message');
    assert.ok(error instanceof Error);
  });

  it('has correct name', () => {
    const error = new ConnectionCodeError('test message');
    assert.strictEqual(error.name, 'ConnectionCodeError');
  });

  it('preserves message', () => {
    const error = new ConnectionCodeError('custom error message');
    assert.strictEqual(error.message, 'custom error message');
  });

  it('has a stack trace', () => {
    const error = new ConnectionCodeError('test');
    assert.ok(error.stack);
    assert.ok(error.stack.includes('ConnectionCodeError'));
  });
});

describe('ConnectionCode - input normalization', () => {
  it('handles lowercase input by throwing ConnectionCodeError', () => {
    // Even with lowercase normalization, invalid content should throw
    assert.throws(() => {
      parseConnectionCode('void-aaaa-bbbb');
    }, ConnectionCodeError);
  });

  it('handles extra whitespace by throwing for invalid content', () => {
    assert.throws(() => {
      parseConnectionCode('  VOID-XXXX  ');
    }, ConnectionCodeError);
  });
});
