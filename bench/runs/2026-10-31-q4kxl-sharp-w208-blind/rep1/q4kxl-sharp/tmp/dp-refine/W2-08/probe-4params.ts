import { type PausePayload } from 'spec-pipeline/protocol';
interface R { readonly kind: string }
interface G { readonly goals: readonly string[] }
export const applyResolve = (result: R, record: PausePayload, originalGoals: G, cli: readonly string[]): Promise<void> => {
  void result;
  void record;
  void originalGoals;
  void cli;
  return Promise.resolve();
};
