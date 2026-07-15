import { describe, expectTypeOf, it } from 'vitest';

import type {
  AxisConfigVM,
  AxisValueVM,
  AxisVariableTypeVM,
  ConfigPanelVM,
  ModelGroupVM,
  ModelOptionVM,
  ResultCardVM,
  ResultGridVM,
  StreamingResultVM,
  SystemPromptEntryVM,
  Tier1MetricsVM
} from './types';

describe('prompt-tester view model types', () => {
  it('should have correct shape for all exported view model interfaces', () => {
    // AxisVariableTypeVM is a string union of 3 members
    expectTypeOf<AxisVariableTypeVM>().toEqualTypeOf<
      'models' | 'skill-containers' | 'custom-system-prompts'
    >();

    // AxisValueVM has readonly id, label, and nullable providerId
    expectTypeOf<AxisValueVM>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<AxisValueVM>().toHaveProperty('providerId').toEqualTypeOf<string | null>();

    // AxisConfigVM.values is a readonly array of AxisValueVM
    expectTypeOf<AxisConfigVM>().toHaveProperty('values').toEqualTypeOf<readonly AxisValueVM[]>();

    // ModelOptionVM has required providerId and providerName
    expectTypeOf<ModelOptionVM>().toHaveProperty('providerId').toEqualTypeOf<string>();
    expectTypeOf<ModelOptionVM>().toHaveProperty('providerName').toEqualTypeOf<string>();

    // ModelGroupVM.models is a readonly array of ModelOptionVM
    expectTypeOf<ModelGroupVM>().toHaveProperty('models').toEqualTypeOf<readonly ModelOptionVM[]>();

    // StreamingResultVM.status is a 5-member discriminated union
    expectTypeOf<StreamingResultVM>()
      .toHaveProperty('status')
      .toEqualTypeOf<'pending' | 'streaming' | 'completed' | 'failed' | 'aborted'>();

    // StreamingResultVM.tier1 is nullable Tier1MetricsVM
    expectTypeOf<StreamingResultVM>()
      .toHaveProperty('tier1')
      .toEqualTypeOf<Tier1MetricsVM | null>();

    // Tier1MetricsVM has all numeric metric fields
    expectTypeOf<Tier1MetricsVM>().toHaveProperty('responseTimeMs').toEqualTypeOf<number>();
    expectTypeOf<Tier1MetricsVM>().toHaveProperty('structureScore').toEqualTypeOf<number>();

    // ResultCardVM has callback prop
    expectTypeOf<ResultCardVM>().toHaveProperty('onSelect').toEqualTypeOf<() => void>();

    // ResultGridVM.onHeaderClick accepts label and fullText
    expectTypeOf<ResultGridVM>()
      .toHaveProperty('onHeaderClick')
      .toEqualTypeOf<(label: string, fullText: string) => void>();

    // ConfigPanelVM.warningLevel is a 3-member union
    expectTypeOf<ConfigPanelVM>()
      .toHaveProperty('warningLevel')
      .toEqualTypeOf<'none' | 'warning' | 'blocked'>();

    // SystemPromptEntryVM.source is a 2-member union
    expectTypeOf<SystemPromptEntryVM>()
      .toHaveProperty('source')
      .toEqualTypeOf<'container' | 'custom' | 'skill'>();
  });
});
