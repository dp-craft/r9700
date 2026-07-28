import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuiltInCommand, CommandContext } from '../builtin-commands';
import { BUILTIN_COMMANDS } from '../builtin-commands';

// -- Helpers --

const createMockContext = (): CommandContext => ({
  activeSessionId: 'session-001',
  clearInput: vi.fn(),
  addEphemeralMessage: vi.fn(),
  clearMessages: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue(undefined),
  clearHistory: vi.fn(),
});

// -- Tests --

describe('BUILTIN_COMMANDS registry', () => {
  describe('structure', () => {
    it('should contain exactly 3 commands', () => {
      expect(BUILTIN_COMMANDS).toHaveLength(3);
    });

    it('should have id, prefix, labelKey, descriptionKey, and execute on every command', () => {
      for (const command of BUILTIN_COMMANDS) {
        expect(command).toHaveProperty('id');
        expect(command).toHaveProperty('prefix');
        expect(command).toHaveProperty('labelKey');
        expect(command).toHaveProperty('descriptionKey');
        expect(command).toHaveProperty('execute');
        expect(typeof command.execute).toBe('function');
      }
    });

    it('should have unique IDs across all commands', () => {
      const ids = BUILTIN_COMMANDS.map((c: BuiltInCommand) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('/clear command', () => {
    let clearCommand: BuiltInCommand;
    let context: CommandContext;

    beforeEach(() => {
      const found = BUILTIN_COMMANDS.find((c: BuiltInCommand) => c.prefix === 'clear');
      if (!found) throw new Error('clear command not found');
      clearCommand = found;
      context = createMockContext();
    });

    it('should have prefix "clear"', () => {
      expect(clearCommand.prefix).toBe('clear');
    });

    it('should have labelKey "chat.commandClearLabel"', () => {
      expect(clearCommand.labelKey).toBe('chat.commandClearLabel');
    });

    it('should have descriptionKey "chat.commandClearDescription"', () => {
      expect(clearCommand.descriptionKey).toBe('chat.commandClearDescription');
    });

    it('should call context.clearMessages() when executed', async () => {
      await clearCommand.execute(context);

      expect(context.clearMessages).toHaveBeenCalledTimes(1);
    });

    it('should call context.clearInput() when executed', async () => {
      await clearCommand.execute(context);

      expect(context.clearInput).toHaveBeenCalledTimes(1);
    });

    it('should call context.clearHistory() when executed', async () => {
      await clearCommand.execute(context);

      expect(context.clearHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe('/new command', () => {
    let newCommand: BuiltInCommand;
    let context: CommandContext;

    beforeEach(() => {
      const found = BUILTIN_COMMANDS.find((c: BuiltInCommand) => c.prefix === 'new');
      if (!found) throw new Error('new command not found');
      newCommand = found;
      context = createMockContext();
    });

    it('should have prefix "new"', () => {
      expect(newCommand.prefix).toBe('new');
    });

    it('should have labelKey "chat.commandNewLabel"', () => {
      expect(newCommand.labelKey).toBe('chat.commandNewLabel');
    });

    it('should have descriptionKey "chat.commandNewDescription"', () => {
      expect(newCommand.descriptionKey).toBe('chat.commandNewDescription');
    });

    it('should call context.createSession() when executed', async () => {
      await newCommand.execute(context);

      expect(context.createSession).toHaveBeenCalledTimes(1);
    });

    it('should call context.clearInput() when executed', async () => {
      await newCommand.execute(context);

      expect(context.clearInput).toHaveBeenCalledTimes(1);
    });
  });

  describe('/help command', () => {
    let helpCommand: BuiltInCommand;
    let context: CommandContext;

    beforeEach(() => {
      const found = BUILTIN_COMMANDS.find((c: BuiltInCommand) => c.prefix === 'help');
      if (!found) throw new Error('help command not found');
      helpCommand = found;
      context = createMockContext();
    });

    it('should have prefix "help"', () => {
      expect(helpCommand.prefix).toBe('help');
    });

    it('should have labelKey "chat.commandHelpLabel"', () => {
      expect(helpCommand.labelKey).toBe('chat.commandHelpLabel');
    });

    it('should have descriptionKey "chat.commandHelpDescription"', () => {
      expect(helpCommand.descriptionKey).toBe('chat.commandHelpDescription');
    });

    it('should call context.addEphemeralMessage() with a string argument when executed', async () => {
      await helpCommand.execute(context);

      expect(context.addEphemeralMessage).toHaveBeenCalledTimes(1);
      const [arg] = (context.addEphemeralMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [
        unknown
      ];
      expect(typeof arg).toBe('string');
    });

    it('should call context.clearInput() when executed', async () => {
      await helpCommand.execute(context);

      expect(context.clearInput).toHaveBeenCalledTimes(1);
    });
  });
});
