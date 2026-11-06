import * as React from 'react';

import type { AtomicSkillDTO } from '@/domain/entities';
import { BUILTIN_COMMANDS, type BuiltInCommand } from '@/features/chat';
import { useTranslation } from '@/i18n';
import type { CommandSuggestion } from '@/lib/command-parser';
import { filterSuggestions } from '@/lib/command-parser';

import { CommandAutocomplete } from '../components/CommandAutocomplete';
import { useSkillStore } from '../stores/useSkillStore';

export interface CommandAutocompleteContainerProps {
  readonly inputValue: string;
  readonly onSelectCommand: (prefix: string) => void;
  readonly className?: string;
}

const toBuiltinSuggestion = (
  command: BuiltInCommand,
  t: (key: string) => string
): CommandSuggestion => ({
  prefix: command.prefix,
  skillName: t(command.labelKey),
  skillId: command.id,
  group: 'builtin',
});

const toSuggestion = (
  skill: Pick<AtomicSkillDTO, 'id' | 'name' | 'commandPrefix'> & { commandPrefix: string }
): CommandSuggestion => ({
  prefix: skill.commandPrefix,
  skillName: skill.name,
  skillId: skill.id,
  group: 'skill',
});

const hasCommandPrefix = (
  skill: AtomicSkillDTO
): skill is AtomicSkillDTO & { commandPrefix: string } => skill.commandPrefix !== null;

export function CommandAutocompleteContainer({
  inputValue,
  onSelectCommand,
  className,
}: CommandAutocompleteContainerProps): React.ReactElement {
  const skills = useSkillStore(s => s.skills);
  const t = useTranslation();
  const [focusedIndex, setFocusedIndex] = React.useState(0);

  const builtinSuggestions = BUILTIN_COMMANDS.map(cmd => toBuiltinSuggestion(cmd, t));
  const skillSuggestions = skills.filter(hasCommandPrefix).map(toSuggestion);
  const builtinPrefixes = new Set(builtinSuggestions.map(s => s.prefix));
  const filteredSkillSuggestions = skillSuggestions.filter(s => !builtinPrefixes.has(s.prefix));
  const allSuggestions = [...builtinSuggestions, ...filteredSkillSuggestions];

  const suggestions = filterSuggestions(inputValue, allSuggestions);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelectCommand(suggestions[focusedIndex].prefix);
    }
  };

  return (
    <CommandAutocomplete
      suggestions={suggestions}
      onSelect={onSelectCommand}
      focusedIndex={focusedIndex}
      onKeyDown={handleKeyDown}
      className={className}
      builtinGroupLabel={t('chat.commandGroupBuiltin')}
      skillsGroupLabel={t('chat.commandGroupSkills')}
    />
  );
}
