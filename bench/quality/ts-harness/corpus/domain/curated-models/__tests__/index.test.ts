import { describe, expect, it } from 'vitest';

import { getAllCuratedModels, matchCuratedModel, sortModelsWithCurated } from '../index';
import type { CuratedModel } from '../types';

// -- Types --

interface TestModel {
  readonly id: string;
  readonly name: string;
}

// -- Builders --

const buildTestModel = (overrides: Partial<TestModel> = {}): TestModel => ({
  id: 'test-model-id',
  name: 'Test Model',
  ...overrides,
});

// -- Helpers --

const CURATED_MODEL_FIELDS: readonly (keyof CuratedModel)[] = [
  'baseName',
  'displayName',
  'description',
  'approxSize',
  'pros',
  'cons',
];

// -- getAllCuratedModels --

describe('getAllCuratedModels', () => {
  // -- Positive paths --

  it('should return a non-empty array of curated models', () => {
    const result = getAllCuratedModels();

    expect(result.length).toBeGreaterThan(0);
  });

  it('should return models with all required fields populated', () => {
    const result = getAllCuratedModels();

    result.forEach(model => {
      CURATED_MODEL_FIELDS.forEach(field => {
        expect(model[field]).toBeDefined();
        expect(typeof model[field]).toBe('string');
        expect(model[field].trim().length).toBeGreaterThan(0);
      });
    });
  });

  // -- Consistency --

  it('should return the same array on repeated calls', () => {
    const first = getAllCuratedModels();
    const second = getAllCuratedModels();

    expect(first).toEqual(second);
  });

  it('should have unique baseNames across all entries', () => {
    const result = getAllCuratedModels();
    const baseNames = result.map(m => m.baseName);
    const uniqueBaseNames = new Set(baseNames);

    expect(uniqueBaseNames.size).toBe(baseNames.length);
  });
});

// -- matchCuratedModel --

describe('matchCuratedModel', () => {
  // -- Positive paths --

  it('should match exact baseName', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];

    const result = matchCuratedModel(firstModel.baseName);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should match case-insensitively when provider ID has different casing', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];
    const upperCaseId = firstModel.baseName.toUpperCase();

    const result = matchCuratedModel(upperCaseId);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should match provider ID containing baseName as substring', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];
    const providerStyleId = `google/${firstModel.baseName}-it`;

    const result = matchCuratedModel(providerStyleId);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should match when baseName appears with provider prefix only', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];
    const prefixedId = `some-provider/${firstModel.baseName}`;

    const result = matchCuratedModel(prefixedId);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should match when baseName appears with suffix only', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];
    const suffixedId = `${firstModel.baseName}:latest`;

    const result = matchCuratedModel(suffixedId);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should return a valid CuratedModel with all fields when matched', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];

    const result = matchCuratedModel(firstModel.baseName);

    expect(result).toBeDefined();
    CURATED_MODEL_FIELDS.forEach(field => {
      expect(result?.[field]).toBeDefined();
      expect(typeof result?.[field]).toBe('string');
    });
  });

  // -- Negative cases --

  it('should return undefined for non-matching model ID', () => {
    const result = matchCuratedModel('nonexistent-model-xyz-999');

    expect(result).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    const result = matchCuratedModel('');

    expect(result).toBeUndefined();
  });

  // -- Edge cases --

  it('should match case-insensitively with mixed casing in provider ID', () => {
    const allModels = getAllCuratedModels();
    const firstModel = allModels[0];
    const mixedCaseId = firstModel.baseName
      .split('')
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join('');

    const result = matchCuratedModel(mixedCaseId);

    expect(result).toBeDefined();
    expect(result?.baseName).toBe(firstModel.baseName);
  });

  it('should return undefined for whitespace-only input', () => {
    const result = matchCuratedModel('   ');

    expect(result).toBeUndefined();
  });
});

// -- sortModelsWithCurated --

describe('sortModelsWithCurated', () => {
  // -- Positive paths --

  it('should place curated matches before non-curated models', () => {
    const allCurated = getAllCuratedModels();
    const curatedBaseName = allCurated[0].baseName;

    const models: readonly TestModel[] = [
      buildTestModel({ id: 'unknown-model-abc', name: 'Unknown Model' }),
      buildTestModel({ id: curatedBaseName, name: 'Curated Model' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result[0].id).toBe(curatedBaseName);
    expect(result[1].id).toBe('unknown-model-abc');
  });

  it('should sort curated matches by approxSize ascending then name', () => {
    const allCurated = getAllCuratedModels();

    if (allCurated.length < 2) {
      return;
    }

    const sortedBySpec = [...allCurated].sort((a, b) => {
      const sizeCompare = a.approxSize.localeCompare(b.approxSize, undefined, { numeric: true });
      return sizeCompare !== 0 ? sizeCompare : a.displayName.localeCompare(b.displayName);
    });

    const smallerModel = sortedBySpec[0];
    const largerModel = sortedBySpec[sortedBySpec.length - 1];

    const models: readonly TestModel[] = [
      buildTestModel({ id: largerModel.baseName, name: largerModel.displayName }),
      buildTestModel({ id: smallerModel.baseName, name: smallerModel.displayName }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result[0].id).toBe(smallerModel.baseName);
    expect(result[1].id).toBe(largerModel.baseName);
  });

  it('should preserve original order for non-curated models', () => {
    const nonCuratedModels: readonly TestModel[] = [
      buildTestModel({ id: 'zzz-custom-model', name: 'ZZZ Custom' }),
      buildTestModel({ id: 'aaa-custom-model', name: 'AAA Custom' }),
      buildTestModel({ id: 'mmm-custom-model', name: 'MMM Custom' }),
    ];

    const result = sortModelsWithCurated(nonCuratedModels);

    expect(result.map(m => m.id)).toEqual([
      'zzz-custom-model',
      'aaa-custom-model',
      'mmm-custom-model',
    ]);
  });

  // -- Negative cases --

  it('should return all models unchanged when none match curated list', () => {
    const models: readonly TestModel[] = [
      buildTestModel({ id: 'totally-unknown-1', name: 'Unknown 1' }),
      buildTestModel({ id: 'totally-unknown-2', name: 'Unknown 2' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result).toEqual(models);
  });

  // -- Edge cases --

  it('should handle empty input array', () => {
    const result = sortModelsWithCurated([]);

    expect(result).toEqual([]);
  });

  it('should handle single curated model', () => {
    const allCurated = getAllCuratedModels();
    const curatedBaseName = allCurated[0].baseName;

    const models: readonly TestModel[] = [
      buildTestModel({ id: curatedBaseName, name: 'Only Model' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(curatedBaseName);
  });

  it('should handle single non-curated model', () => {
    const models: readonly TestModel[] = [
      buildTestModel({ id: 'totally-unknown', name: 'Only Model' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('totally-unknown');
  });

  it('should match curated models using substring matching within provider-prefixed IDs', () => {
    const allCurated = getAllCuratedModels();
    const curatedBaseName = allCurated[0].baseName;

    const models: readonly TestModel[] = [
      buildTestModel({ id: 'unknown-model', name: 'Unknown' }),
      buildTestModel({ id: `provider/${curatedBaseName}-instruct`, name: 'Curated Variant' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result[0].id).toBe(`provider/${curatedBaseName}-instruct`);
    expect(result[1].id).toBe('unknown-model');
  });

  it('should not mutate the input array', () => {
    const allCurated = getAllCuratedModels();
    const curatedBaseName = allCurated[0].baseName;

    const models: readonly TestModel[] = [
      buildTestModel({ id: 'unknown-model', name: 'Unknown' }),
      buildTestModel({ id: curatedBaseName, name: 'Curated' }),
    ];
    const originalOrder = [...models];

    sortModelsWithCurated(models);

    expect(models).toEqual(originalOrder);
  });

  it('should return all input models with no duplicates or losses', () => {
    const allCurated = getAllCuratedModels();
    const curatedBaseName = allCurated[0].baseName;

    const models: readonly TestModel[] = [
      buildTestModel({ id: 'unknown-1', name: 'Unknown 1' }),
      buildTestModel({ id: curatedBaseName, name: 'Curated' }),
      buildTestModel({ id: 'unknown-2', name: 'Unknown 2' }),
    ];

    const result = sortModelsWithCurated(models);

    expect(result).toHaveLength(models.length);
    const resultIds = result.map(m => m.id).sort();
    const inputIds = [...models].map(m => m.id).sort();
    expect(resultIds).toEqual(inputIds);
  });
});
