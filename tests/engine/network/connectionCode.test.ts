import { describe, it, expect } from 'vitest';
import {
  parseConnectionCode,
  ConnectionCodeError,
} from '@/engine/network/p2p/ConnectionCode';

describe('ConnectionCode - parseConnectionCode error handling', () => {
  it('throws on code that is too short', () => {
    expect(() => parseConnectionCode('VOID-ABC')).toThrow(ConnectionCodeError);
  });

  it('throws on empty code', () => {
    expect(() => parseConnectionCode('')).toThrow(ConnectionCodeError);
  });

  it('throws on just prefix', () => {
    expect(() => parseConnectionCode('VOID-')).toThrow(ConnectionCodeError);
  });

  it('throws on random garbage', () => {
    expect(() => parseConnectionCode('NOT-A-VALID-CODE-AT-ALL-AAAA-BBBB-CCCC')).toThrow(ConnectionCodeError);
  });

  it('throws ConnectionCodeError specifically', () => {
    expect(() => parseConnectionCode('VOID-INVALID')).toThrow(ConnectionCodeError);
  });
});

describe('ConnectionCodeError', () => {
  it('is an instance of Error', () => {
    const error = new ConnectionCodeError('test message');
    expect(error instanceof Error).toBe(true);
  });

  it('has correct name', () => {
    const error = new ConnectionCodeError('test message');
    expect(error.name).toBe('ConnectionCodeError');
  });

  it('preserves message', () => {
    const error = new ConnectionCodeError('custom error message');
    expect(error.message).toBe('custom error message');
  });

  it('has a stack trace', () => {
    const error = new ConnectionCodeError('test');
    expect(error.stack).toBeTruthy();
    expect(error.stack).toContain('ConnectionCodeError');
  });
});

describe('ConnectionCode - input normalization', () => {
  it('handles lowercase input by throwing ConnectionCodeError', () => {
    // Even with lowercase normalization, invalid content should throw
    expect(() => parseConnectionCode('void-aaaa-bbbb')).toThrow(ConnectionCodeError);
  });

  it('handles extra whitespace by throwing for invalid content', () => {
    expect(() => parseConnectionCode('  VOID-XXXX  ')).toThrow(ConnectionCodeError);
  });
});
