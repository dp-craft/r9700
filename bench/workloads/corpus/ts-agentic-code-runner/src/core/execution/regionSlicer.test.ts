import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { sliceSymbol } from './regionSlicer';

// ─── helpers ─────────────────────────────────────────────────────────────────

const withSource = (code: string): Project => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('sample.ts', code);
  return project;
};

const STORE_SOURCE = `
export const useStore = create<State>()((set, get) => ({
  count: 0,
  runEvalComparison: async (id: string) => {
    set({ count: 1 });
    await Promise.resolve(id);
  },
}));
`;

const ARROW_SOURCE = `
const helper = 1;
export const add = (a: number, b: number): number => a + b;
`;

// ─── sliceSymbol ─────────────────────────────────────────────────────────────

describe('sliceSymbol', () => {
  it('should return the whole property node span when matching a store-object method', () => {
    // Arrange
    const project = withSource(STORE_SOURCE);

    // Act
    const result = sliceSymbol('sample.ts', 'runEvalComparison', project);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.text).toContain('runEvalComparison: async (id: string) =>');
    expect(result?.text).toContain('await Promise.resolve(id);');
    expect(result?.startLine).toBe(4);
    expect(result?.endLine).toBe(7);
  });

  it('should return the full statement span for an exported const arrow function', () => {
    // Arrange
    const project = withSource(ARROW_SOURCE);

    // Act
    const result = sliceSymbol('sample.ts', 'add', project);

    // Assert
    expect(result?.text).toBe('export const add = (a: number, b: number): number => a + b;');
    expect(result?.startLine).toBe(3);
    expect(result?.endLine).toBe(3);
  });

  it('should return null when no declaration or member matches', () => {
    // Arrange
    const project = withSource(ARROW_SOURCE);

    // Act
    const result = sliceSymbol('sample.ts', 'missingSymbol', project);

    // Assert
    expect(result).toBeNull();
  });
});
