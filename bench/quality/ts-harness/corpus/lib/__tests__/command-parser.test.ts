import { describe, expect, it } from 'vitest';

import {
  type CommandSuggestion,
  filterSuggestions,
  parseCommand,
  type ParsedCommand,
  stripLeadingSlashes
} from '@/lib/command-parser';

// -- Builders --

const createSuggestion = (overrides: Partial<CommandSuggestion> = {}): CommandSuggestion => ({
  prefix: 'test',
  skillName: 'Test Skill',
  skillId: 'skill-1',
  group: 'skill',
  ...overrides,
});

// -- stripLeadingSlashes --

describe('stripLeadingSlashes', () => {
  it('should return empty string when input is empty', () => {
    expect(stripLeadingSlashes('')).toBe('');
  });

  it('should return empty string when input is a single slash', () => {
    expect(stripLeadingSlashes('/')).toBe('');
  });

  it('should return empty string when input is multiple slashes', () => {
    expect(stripLeadingSlashes('//')).toBe('');
    expect(stripLeadingSlashes('///')).toBe('');
  });

  it('should return the string unchanged when it has no leading slash', () => {
    expect(stripLeadingSlashes('hello')).toBe('hello');
  });

  it('should strip a single leading slash', () => {
    expect(stripLeadingSlashes('/hello')).toBe('hello');
  });

  it('should strip multiple leading slashes', () => {
    expect(stripLeadingSlashes('//hello')).toBe('hello');
    expect(stripLeadingSlashes('///hello')).toBe('hello');
  });

  it('should not strip slashes in the middle of the string', () => {
    expect(stripLeadingSlashes('he/llo')).toBe('he/llo');
    expect(stripLeadingSlashes('//he/llo')).toBe('he/llo');
  });
});

// -- parseCommand --

describe('parseCommand', () => {
  // -- Positive paths --

  it('should return parsed command when message starts with a known prefix', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should capture everything after prefix and space as body when message has multiple words', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate hello world', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello world',
      hasCommand: true,
    });
  });

  it('should return empty body when message is only a known command prefix with no body', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: '',
      hasCommand: true,
    });
  });

  it('should match the correct prefix when multiple prefixes are known', () => {
    const knownPrefixes = new Set(['translate', 'summarize', 'eli5']);

    const result = parseCommand('/summarize this long text', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'summarize',
      body: 'this long text',
      hasCommand: true,
    });
  });

  // -- Negative cases --

  it('should return no command when prefix is not in known prefixes', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/unknown hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '/unknown hello',
      hasCommand: false,
    });
  });

  it('should return no command when slash is not at the start of message', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('hello /translate', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: 'hello /translate',
      hasCommand: false,
    });
  });

  it('should return no command when message has no slash', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: 'hello',
      hasCommand: false,
    });
  });

  it('should return no command when message is a lone slash', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '/',
      hasCommand: false,
    });
  });

  it('should return no command when known prefixes set is empty', () => {
    const knownPrefixes = new Set<string>();

    const result = parseCommand('/translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '/translate hello',
      hasCommand: false,
    });
  });

  // -- Edge cases --

  it('should return empty body with no command when message is empty', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '',
      hasCommand: false,
    });
  });

  it('should preserve extra spaces in body when multiple spaces follow the prefix', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate  hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: ' hello',
      hasCommand: true,
    });
  });

  it('should match case-insensitively when prefix casing differs from known set', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/Translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should match case-insensitively when known prefix has mixed casing', () => {
    const knownPrefixes = new Set(['Translate']);

    const result = parseCommand('/translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should return no command when message is only whitespace', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('   ', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '   ',
      hasCommand: false,
    });
  });

  it('should return no command when slash is preceded by whitespace', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand(' /translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: ' /translate hello',
      hasCommand: false,
    });
  });

  it('should handle prefix with trailing space and no body text', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate ', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: '',
      hasCommand: true,
    });
  });

  // -- Leading double-slash normalization --

  it('should normalize a leading double-slash and match the known prefix', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('//translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should normalize a leading double-slash when message is only the prefix', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('//translate', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: '',
      hasCommand: true,
    });
  });

  it('should normalize a leading double-slash to a single slash in body when prefix is unknown', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('//unknown hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: null,
      body: '/unknown hello',
      hasCommand: false,
    });
  });

  it('should leave a single leading slash unaffected', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should not alter mid-string double slashes', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('/translate http://example.com', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'http://example.com',
      hasCommand: true,
    });
  });

  // -- Multi-slash normalization --

  it('should normalize triple leading slashes and match the known prefix', () => {
    const knownPrefixes = new Set(['translate']);

    const result = parseCommand('///translate hello', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'translate',
      body: 'hello',
      hasCommand: true,
    });
  });

  it('should normalize double-slash with mixed case and return lowercased prefix', () => {
    const knownPrefixes = new Set(['Eli5']);

    const result = parseCommand('//Eli5 explain this', knownPrefixes);

    expect(result).toEqual<ParsedCommand>({
      prefix: 'eli5',
      body: 'explain this',
      hasCommand: true,
    });
  });
});

// -- filterSuggestions --

describe('filterSuggestions', () => {
  const commands: readonly CommandSuggestion[] = [
    createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    createSuggestion({
      prefix: 'transcribe',
      skillName: 'Transcribe',
      skillId: 'skill-transcribe',
    }),
    createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
  ];

  // -- Positive paths --

  it('should return matching commands when input is a partial prefix', () => {
    const result = filterSuggestions('/tr', commands);

    expect(result).toEqual([
      createSuggestion({
        prefix: 'transcribe',
        skillName: 'Transcribe',
        skillId: 'skill-transcribe',
      }),
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should return all commands when input is just a slash', () => {
    const result = filterSuggestions('/', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
      createSuggestion({
        prefix: 'transcribe',
        skillName: 'Transcribe',
        skillId: 'skill-transcribe',
      }),
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should return single match when input matches exactly one prefix', () => {
    const result = filterSuggestions('/eli', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
    ]);
  });

  it('should return exact match when input matches full prefix', () => {
    const result = filterSuggestions('/translate', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should sort results alphabetically by prefix', () => {
    const unorderedCommands: readonly CommandSuggestion[] = [
      createSuggestion({ prefix: 'zebra', skillName: 'Zebra', skillId: 'skill-z' }),
      createSuggestion({ prefix: 'alpha', skillName: 'Alpha', skillId: 'skill-a' }),
      createSuggestion({ prefix: 'mid', skillName: 'Mid', skillId: 'skill-m' }),
    ];

    const result = filterSuggestions('/', unorderedCommands);

    expect(result.map(s => s.prefix)).toEqual(['alpha', 'mid', 'zebra']);
  });

  // -- Negative cases --

  it('should return empty array when no prefixes match the input', () => {
    const result = filterSuggestions('/xyz', commands);

    expect(result).toEqual([]);
  });

  it('should return empty array when input is empty string', () => {
    const result = filterSuggestions('', commands);

    expect(result).toEqual([]);
  });

  it('should return empty array when input has no slash', () => {
    const result = filterSuggestions('tr', commands);

    expect(result).toEqual([]);
  });

  it('should return empty array when commands list is empty', () => {
    const result = filterSuggestions('/tr', []);

    expect(result).toEqual([]);
  });

  // -- Edge cases --

  it('should match case-insensitively when input has uppercase characters', () => {
    const result = filterSuggestions('/TR', commands);

    expect(result).toEqual([
      createSuggestion({
        prefix: 'transcribe',
        skillName: 'Transcribe',
        skillId: 'skill-transcribe',
      }),
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should return empty array when input is slash followed by space', () => {
    const result = filterSuggestions('/ ', commands);

    expect(result).toEqual([]);
  });

  it('should not match when input contains space after partial prefix', () => {
    const result = filterSuggestions('/tr hello', commands);

    expect(result).toEqual([]);
  });

  it('should return empty array when input is only whitespace', () => {
    const result = filterSuggestions('   ', commands);

    expect(result).toEqual([]);
  });

  // -- Double-slash normalization --

  it('should match commands when input has double leading slashes', () => {
    const result = filterSuggestions('//eli', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
    ]);
  });

  it('should match commands when input has triple leading slashes', () => {
    const result = filterSuggestions('///tr', commands);

    expect(result).toEqual([
      createSuggestion({
        prefix: 'transcribe',
        skillName: 'Transcribe',
        skillId: 'skill-transcribe',
      }),
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should return all commands when input is double slash only', () => {
    const result = filterSuggestions('//', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
      createSuggestion({
        prefix: 'transcribe',
        skillName: 'Transcribe',
        skillId: 'skill-transcribe',
      }),
      createSuggestion({ prefix: 'translate', skillName: 'Translate', skillId: 'skill-translate' }),
    ]);
  });

  it('should match case-insensitively with double-slash input', () => {
    const result = filterSuggestions('//ELI', commands);

    expect(result).toEqual([
      createSuggestion({ prefix: 'eli5', skillName: 'ELI5', skillId: 'skill-eli5' }),
    ]);
  });
});
