export interface ParsedCommand {
  readonly prefix: string | null;
  readonly body: string;
  readonly hasCommand: boolean;
}

export interface CommandSuggestion {
  readonly prefix: string;
  readonly skillName: string;
  readonly skillId: string;
  readonly group: 'builtin' | 'skill';
}

const NO_COMMAND = (body: string): ParsedCommand => ({
  prefix: null,
  body,
  hasCommand: false,
});

const MATCHED_COMMAND = (prefix: string, body: string): ParsedCommand => ({
  prefix,
  body,
  hasCommand: true,
});

export const stripLeadingSlashes = (s: string): string => s.replace(/^\/+/, '');

const extractCandidate = (message: string): string | null => {
  if (!message.startsWith('/')) return null;
  const afterSlash = stripLeadingSlashes(message);
  const spaceIndex = afterSlash.indexOf(' ');
  const candidate = spaceIndex === -1 ? afterSlash : afterSlash.slice(0, spaceIndex);
  return candidate.length > 0 ? candidate : null;
};

const findMatchingPrefix = (
  candidate: string,
  knownPrefixes: ReadonlySet<string>
): string | undefined => {
  const strippedCandidate = stripLeadingSlashes(candidate).toLowerCase();
  const found = [...knownPrefixes].find(
    p => stripLeadingSlashes(p).toLowerCase() === strippedCandidate
  );
  return found !== undefined ? strippedCandidate : undefined;
};

const extractBody = (message: string, candidate: string): string => {
  const rest = message.slice(1 + candidate.length);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
};

const normalizeLeadingSlashes = (message: string): string => {
  const stripped = stripLeadingSlashes(message);
  return message.startsWith('/') ? `/${stripped}` : message;
};

export function parseCommand(message: string, knownPrefixes: ReadonlySet<string>): ParsedCommand {
  const normalized = normalizeLeadingSlashes(message);
  const candidate = extractCandidate(normalized);
  if (candidate === null) return NO_COMMAND(normalized);

  const matched = findMatchingPrefix(candidate, knownPrefixes);
  if (matched === undefined) return NO_COMMAND(normalized);

  const body = extractBody(normalized, candidate);
  return MATCHED_COMMAND(matched, body);
}

const hasSpace = (text: string): boolean => text.includes(' ');

export function filterSuggestions(
  input: string,
  commands: readonly CommandSuggestion[]
): readonly CommandSuggestion[] {
  if (!input.startsWith('/')) return [];
  const normalizedInput = normalizeLeadingSlashes(input);
  const filterText = normalizedInput.slice(1);
  if (hasSpace(filterText)) return [];
  const lowerFilter = filterText.toLowerCase();

  return [...commands]
    .filter(cmd => stripLeadingSlashes(cmd.prefix).toLowerCase().startsWith(lowerFilter))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}
