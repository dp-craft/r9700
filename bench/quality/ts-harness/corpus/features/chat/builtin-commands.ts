export interface CommandContext {
  readonly activeSessionId: string;
  readonly clearInput: () => void;
  readonly addEphemeralMessage: (content: string) => void;
  readonly clearMessages: () => Promise<void>;
  readonly createSession: () => Promise<void>;
  readonly clearHistory: () => void;
}

export interface BuiltInCommand {
  readonly id: string;
  readonly prefix: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly execute: (context: CommandContext) => void | Promise<void>;
}

const HELP_CONTENT_KEY = 'chat.helpContent';

export const BUILTIN_COMMANDS: readonly BuiltInCommand[] = [
  {
    id: 'clear',
    prefix: 'clear',
    labelKey: 'chat.commandClearLabel',
    descriptionKey: 'chat.commandClearDescription',
    execute: async (context: CommandContext): Promise<void> => {
      await context.clearMessages();
      context.clearInput();
      context.clearHistory();
    },
  },
  {
    id: 'new',
    prefix: 'new',
    labelKey: 'chat.commandNewLabel',
    descriptionKey: 'chat.commandNewDescription',
    execute: async (context: CommandContext): Promise<void> => {
      await context.createSession();
      context.clearInput();
    },
  },
  {
    id: 'help',
    prefix: 'help',
    labelKey: 'chat.commandHelpLabel',
    descriptionKey: 'chat.commandHelpDescription',
    execute: (context: CommandContext): void => {
      context.addEphemeralMessage(HELP_CONTENT_KEY);
      context.clearInput();
    },
  },
] as const satisfies readonly BuiltInCommand[];
