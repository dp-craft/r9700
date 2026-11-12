import type { MessageViewModel } from '../types';
import { shouldShowModelBadge } from './shouldShowModelBadge';

interface BadgeAcc {
  readonly entries: readonly (readonly [string, boolean])[];
  readonly prevModel: string | undefined;
  readonly foundAssistant: boolean;
}

export const computeBadgeMap = (
  messages: readonly MessageViewModel[]
): ReadonlyMap<string, boolean> => {
  const { entries } = messages.reduce<BadgeAcc>(
    (acc, msg) =>
      msg.role !== 'assistant'
        ? acc
        : {
            entries: [
              ...acc.entries,
              [
                msg.id,
                shouldShowModelBadge(msg.model, acc.prevModel, !acc.foundAssistant),
              ] as const,
            ],
            prevModel: msg.model,
            foundAssistant: true,
          },
    { entries: [], prevModel: undefined, foundAssistant: false }
  );
  return new Map(entries);
};
