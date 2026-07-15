// FILE: impl.test.ts

import { describe, it, expect } from 'vitest';
import { evaluate } from './impl';

describe('evaluate', () => {
  describe('basic operations', () => {
    it('should add when given "2+3"', () => {
      expect(evaluate('2+3')).toEqual({ ok: true, value: 5 });
    });

    it('should subtract when given "10-3"', () => {
      expect(evaluate('10-3')).toEqual({ ok: true, value: 7 });
    });

    it('should multiply when given "3*4"', () => {
      expect(evaluate('3*4')).toEqual({ ok: true, value: 12 });
    });

    it('should divide when given "8/2"', () => {
      expect(evaluate('8/2')).toEqual({ ok: true, value: 4 });
    });
  });

  describe('precedence', () => {
    it('should respect multiplication over addition when given "2+3*4"', () => {
      expect(evaluate('2+3*4')).toEqual({ ok: true, value: 14 });
    });

    it('should respect division over subtraction when given "20-8/2"', () => {
      expect(evaluate('20-8/2')).toEqual({ ok: true, value: 16 });
    });
  });

  describe('associativity', () => {
    it('should associate subtraction left-to-right when given "10-3-2"', () => {
      expect(evaluate('10-3-2')).toEqual({ ok: true, value: 5 });
    });

    it('should associate division left-to-right when given "8/2/2"', () => {
      expect(evaluate('8/2/2')).toEqual({ ok: true, value: 2 });
    });
  });

  describe('parentheses', () => {
    it('should override precedence when given "(2+3)*4"', () => {
      expect(evaluate('(2+3)*4')).toEqual({ ok: true, value: 20 });
    });

    it('should handle nested parentheses when given "((5+2)*3)"', () => {
      expect(evaluate('((5+2)*3)')).toEqual({ ok: true, value: 21 });
    });
  });

  describe('whitespace', () => {
    it('should ignore spaces when given "2 + 3 * 4"', () => {
      expect(evaluate('2 + 3 * 4')).toEqual({ ok: true, value: 14 });
    });
  });

  describe('error cases', () => {
    it('should return error when given unbalanced parentheses "((2+3)"', () => {
      const result = evaluate('((2+3)');
      expect(result.ok).toBe(false);
    });

    it('should return error when dividing by zero in "5/0"', () => {
      const result = evaluate('5/0');
      expect(result.ok).toBe(false);
    });

    it('should return error when encountering unexpected character in "2+a"', () => {
      const result = evaluate('2+a');
      expect(result.ok).toBe(false);
    });

    it('should return error when given missing operand in "2+"', () => {
      const result = evaluate('2+');
      expect(result.ok).toBe(false);
    });
  });
});
