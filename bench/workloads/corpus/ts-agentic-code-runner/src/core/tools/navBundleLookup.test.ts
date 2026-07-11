import { describe, expect, it } from 'vitest';

import { buildNavBundleLookup } from './navBundleLookup';

const VALID_BUNDLE = {
  hover: {
    TestRunConfig: 'import("...").TestRunConfig',
    ScratchTab: 'interface ScratchTab { id: string }',
    EmptyHover: '',
  },
  exportsByFile: {
    'src/features/prompt-tester/types.ts': ['TestRunConfig', 'ScratchTab'],
    'src/features/chat/types.ts': ['ChatMessage', 'ChatState'],
  },
};

describe('buildNavBundleLookup', () => {
  describe('hover op', () => {
    it('should return the type string when symbol exists in hover map', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'hover', symbol: 'TestRunConfig' });
      expect(result).toBe('import("...").TestRunConfig');
    });

    it('should return null when symbol is not in hover map', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'hover', symbol: 'UnknownSymbol' });
      expect(result).toBeNull();
    });

    it('should return null when hover value is an empty string', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'hover', symbol: 'EmptyHover' });
      expect(result).toBeNull();
    });

    it('should return the type string regardless of file hint', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'hover', symbol: 'ScratchTab', file: 'src/features/prompt-tester/types.ts' });
      expect(result).toBe('interface ScratchTab { id: string }');
    });
  });

  describe('definition op', () => {
    it('should return the first file path whose exports include the symbol', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'definition', symbol: 'TestRunConfig' });
      expect(result).toBe('src/features/prompt-tester/types.ts');
    });

    it('should return the correct file when symbol is in second file', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'definition', symbol: 'ChatMessage' });
      expect(result).toBe('src/features/chat/types.ts');
    });

    it('should return null when symbol is not exported by any file', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'definition', symbol: 'UnknownSymbol' });
      expect(result).toBeNull();
    });
  });

  describe('references and implementation ops', () => {
    it('should return null for references op (falls through to live ts-morph)', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'references', symbol: 'TestRunConfig' });
      expect(result).toBeNull();
    });

    it('should return null for implementation op (falls through to live ts-morph)', () => {
      const lookup = buildNavBundleLookup(VALID_BUNDLE);
      const result = lookup.find({ op: 'implementation', symbol: 'TestRunConfig' });
      expect(result).toBeNull();
    });
  });

  describe('defensive parsing', () => {
    it('should return null for all ops when bundle is null', () => {
      const lookup = buildNavBundleLookup(null);
      expect(lookup.find({ op: 'hover', symbol: 'TestRunConfig' })).toBeNull();
      expect(lookup.find({ op: 'definition', symbol: 'TestRunConfig' })).toBeNull();
    });

    it('should return null for all ops when bundle is not an object', () => {
      const lookup = buildNavBundleLookup('not-an-object');
      expect(lookup.find({ op: 'hover', symbol: 'TestRunConfig' })).toBeNull();
      expect(lookup.find({ op: 'definition', symbol: 'TestRunConfig' })).toBeNull();
    });

    it('should return null for hover when hover field is missing', () => {
      const lookup = buildNavBundleLookup({ exportsByFile: VALID_BUNDLE.exportsByFile });
      expect(lookup.find({ op: 'hover', symbol: 'TestRunConfig' })).toBeNull();
    });

    it('should return null for definition when exportsByFile field is missing', () => {
      const lookup = buildNavBundleLookup({ hover: VALID_BUNDLE.hover });
      expect(lookup.find({ op: 'definition', symbol: 'TestRunConfig' })).toBeNull();
    });

    it('should return null when hover map value is a non-string type', () => {
      const lookup = buildNavBundleLookup({ hover: { BadType: 42 }, exportsByFile: {} });
      expect(lookup.find({ op: 'hover', symbol: 'BadType' })).toBeNull();
    });

    it('should return null for definition when exportsByFile entry is not an array', () => {
      const lookup = buildNavBundleLookup({ hover: {}, exportsByFile: { 'src/x.ts': 'not-an-array' } });
      expect(lookup.find({ op: 'definition', symbol: 'SomeSymbol' })).toBeNull();
    });
  });
});
