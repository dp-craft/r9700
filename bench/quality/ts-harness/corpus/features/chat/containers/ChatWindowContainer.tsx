import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ERROR_MESSAGE_DURATION_MS, UNSENT_MESSAGE_STORAGE_KEY } from '@/config';
import { useSessionStore } from '@/features/sessions';
import { useFeatureFlagStore } from '@/features/settings';
import { CommandAutocompleteContainer, SessionSkillIndicatorContainer } from '@/features/skills';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTranslation } from '@/i18n';

import type { CommandContext } from '../builtin-commands';
import { BUILTIN_COMMANDS } from '../builtin-commands';
import { ChatChoosersStrip } from '../components/ChatChoosersStrip';
import { ChatInput } from '../components/ChatInput';
import { ChatSystemPromptChooser } from '../components/ChatSystemPromptChooser';
import type { MessageListLabels } from '../components/MessageList';
import { MessageList } from '../components/MessageList';
import { PipelineProgress } from '../components/PipelineProgress';
import { useChat } from '../hooks/useChat';
import { useInputHistory } from '../hooks/useInputHistory';
import { useScrollToBottom } from '../hooks/useScrollToBottom';
import { computeBadgeMap } from '../lib/computeBadgeMap';
import { dispatchTestInLab } from '../lib/dispatchTestInLab';
import { shouldShowModelBadge } from '../lib/shouldShowModelBadge';
import { useChatStore } from '../stores/useChatStore';
import type { MessageViewModel } from '../types';
import { ChatModelChooserContainer } from './ChatModelChooserContainer';

const MAX_HISTORY_ENTRIES = 50;

export function ChatWindowContainer(): React.ReactElement {
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const messages = useSessionStore(s => s.messages);
  const sessionList = useSessionStore(s => s.sessionList);
  const clearSessionMessages = useSessionStore(s => s.clearSessionMessages);
  const createSession = useSessionStore(s => s.createSession);
  const { sendMessage, isStreaming, streamingContent, abort } = useChat();
  const t = useTranslation();

  const streamingReasoning = useChatStore(s => s.streamingReasoning);
  const pipelineProgress = useChatStore(s => s.pipelineProgress);
  const error = useChatStore(s => s.error);
  const clearStreamError = useChatStore(s => s.clearStreamError);

  const activeSession = sessionList.find(s => s.id === activeSessionId);
  const activeProviderId = activeSession?.providerId ?? '';
  const activeModelId = activeSession?.model ?? '';

  const [inputValue, setInputValue] = useState(
    () => sessionStorage.getItem(UNSENT_MESSAGE_STORAGE_KEY) ?? ''
  );
  const [showingOriginalMap, setShowingOriginalMap] = useState<Map<string, boolean>>(new Map());
  const [ephemeralMessages, setEphemeralMessages] = useState<readonly string[]>([]);
  const [prevSession, setPrevSession] = useState(activeSessionId);
  if (prevSession !== activeSessionId) {
    setPrevSession(activeSessionId);
    setEphemeralMessages([]);
  }
  const isOnline = useOnlineStatus();
  const promptLabEnabled = useFeatureFlagStore(s => s.flags['prompt-lab-enabled']) ?? false;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const history = useInputHistory(inputValue);

  // useEffect: store-load — reloads input history snapshot on session switch

  useEffect(() => {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const last50 =
      userMessages.length > MAX_HISTORY_ENTRIES
        ? userMessages.slice(userMessages.length - MAX_HISTORY_ENTRIES)
        : userMessages;
    history.reset(last50);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeSessionId triggers full history reload on session switch
  }, [activeSessionId, messages, history.reset]);

  const displayValue = history.currentEntry ?? inputValue;

  const handleInputChange = useCallback((value: string): void => {
    setInputValue(value);
    sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, value);
  }, []);

  const clearInput = useCallback((): void => {
    setInputValue('');
    sessionStorage.removeItem(UNSENT_MESSAGE_STORAGE_KEY);
  }, []);

  const addEphemeralMessage = useCallback((content: string): void => {
    setEphemeralMessages(prev => [...prev, content]);
  }, []);

  // useEffect: cleanup — auto-dismiss stream error after ERROR_MESSAGE_DURATION_MS
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearStreamError, ERROR_MESSAGE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [error, clearStreamError]);

  const bottomRef = useScrollToBottom<HTMLDivElement>(
    messages.length + (isStreaming ? streamingContent.length : 0)
  );

  const handleCopyMessage = useCallback((content: string): void => {
    void navigator.clipboard.writeText(content);
  }, []);

  const executeBuiltinCommand = useCallback(
    (command: (typeof BUILTIN_COMMANDS)[number]): void => {
      const context: CommandContext = {
        activeSessionId: activeSessionId ?? '',
        clearInput,
        addEphemeralMessage,
        clearMessages: () => clearSessionMessages(activeSessionId ?? ''),
        createSession: () =>
          createSession(activeProviderId, activeModelId, activeSession?.skillSnapshot ?? null),
        clearHistory: () => history.reset(),
      };
      void command.execute(context);
    },
    [
      activeSessionId,
      activeProviderId,
      activeModelId,
      activeSession?.skillSnapshot,
      clearInput,
      addEphemeralMessage,
      clearSessionMessages,
      createSession,
      history.reset,
    ]
  );

  const submitMessage = useCallback(async (): Promise<void> => {
    const trimmed = displayValue.trim();
    if (!trimmed || isStreaming) return;

    const builtinMatch = trimmed.startsWith('/')
      ? BUILTIN_COMMANDS.find(cmd => `/${cmd.prefix}` === trimmed.toLowerCase())
      : undefined;

    if (builtinMatch) {
      executeBuiltinCommand(builtinMatch);
      return;
    }

    history.addEntry(trimmed);
    setInputValue('');
    sessionStorage.removeItem(UNSENT_MESSAGE_STORAGE_KEY);
    await sendMessage(trimmed);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [displayValue, isStreaming, sendMessage, history.addEntry, executeBuiltinCommand]);

  const handleSubmit = useCallback((): void => {
    void submitMessage();
  }, [submitMessage]);

  const handleCommandSelect = useCallback((prefix: string): void => {
    const value = `/${prefix.replace(/^\/+/, '')} `;
    setInputValue(value);
    sessionStorage.setItem(UNSENT_MESSAGE_STORAGE_KEY, value);
  }, []);

  const handleTestInLab = useCallback(
    (message: MessageViewModel): void => {
      const { pipelineTrace: _, ...msg } = message;
      dispatchTestInLab(activeSession, { ...msg, pipelineTrace: undefined });
    },
    [activeSession]
  );

  const handleToggleOriginal = useCallback((messageId: string): void => {
    setShowingOriginalMap(prev => {
      const next = new Map(prev);
      next.set(messageId, !(prev.get(messageId) ?? false));
      return next;
    });
  }, []);

  const badgeMap = computeBadgeMap(messages);
  const lastAssistantModel = [...messages].reverse().find(m => m.role === 'assistant')?.model;
  const hasAnyAssistant = messages.some(m => m.role === 'assistant');
  const showStreamingBadge = shouldShowModelBadge(
    activeModelId || undefined,
    lastAssistantModel,
    !hasAnyAssistant
  );

  // Disable input when offline AND using OpenRouter (Ollama is local, works offline)
  const isOfflineWithRemoteProvider = !isOnline && activeProviderId === 'openrouter';
  const canSend = !isStreaming && displayValue.trim().length > 0 && !isOfflineWithRemoteProvider;

  // Command chooser arbitration: while open, ↑/↓ drive the chooser, not input history.
  const isChooserOpen = inputValue.startsWith('/');

  const messageLabels: MessageListLabels = {
    copyLabel: t('chat.copy'),
    copyAriaLabel: t('chat.copyMessage'),
    streamingAriaLabel: t('chat.streaming'),
    userMessageAria: t('chat.you'),
    assistantMessageAria: t('chat.assistant'),
    showOriginalLabel: t('pipeline.showOriginal'),
    showTranslatedLabel: t('pipeline.showTranslated'),
    sourcesLabel: t('chat.sources'),
    reasoningTitle: t('chat.thinking'),
    citationPrefix: t('chat.citationPrefix'),
  };

  if (!activeSessionId) {
    return (
      <output
        className="text-muted-foreground flex flex-1 items-center justify-center"
        aria-label={t('chat.noSessionAria')}
      >
        <p>{t('chat.noSessionMessage')}</p>
      </output>
    );
  }

  const choosersStrip = (
    <ChatChoosersStrip
      modelChooserSlot={<ChatModelChooserContainer />}
      systemPromptChooserSlot={(
        <ChatSystemPromptChooser
          title={t('chat.systemPromptTitle')}
          skillSlot={<SessionSkillIndicatorContainer />}
        />
      )}
    />
  );

  if (!activeProviderId) {
    return (
      <div data-testid="chat-window" className="flex flex-1 flex-col overflow-hidden">
        {choosersStrip}
        <output
          className="flex flex-1 items-center justify-center p-8 text-center"
          aria-label={t('chat.noProviderTitle')}
        >
          <div className="max-w-md space-y-4">
            <h2 className="text-lg font-semibold">{t('chat.noProviderTitle')}</h2>
            <p className="text-muted-foreground">{t('chat.noProviderMessage')}</p>
            <p className="text-muted-foreground text-sm">{t('chat.noProviderHint')}</p>
          </div>
        </output>
      </div>
    );
  }

  if (!activeModelId) {
    return (
      <div data-testid="chat-window" className="flex flex-1 flex-col overflow-hidden">
        {choosersStrip}
        <output
          className="flex flex-1 items-center justify-center p-8 text-center"
          aria-label={t('chat.noModelTitle')}
        >
          <div className="max-w-md space-y-4">
            <h2 className="text-lg font-semibold">{t('chat.noModelTitle')}</h2>
            <p className="text-muted-foreground">{t('chat.noModelMessage')}</p>
            <p className="text-muted-foreground text-sm">{t('chat.noModelHint')}</p>
          </div>
        </output>
      </div>
    );
  }

  return (
    <div data-testid="chat-window" className="flex flex-1 flex-col overflow-hidden">
      {choosersStrip}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        streamingReasoning={streamingReasoning}
        bottomRef={bottomRef}
        onCopyMessage={handleCopyMessage}
        labels={messageLabels}
        showingOriginalMap={showingOriginalMap}
        onToggleOriginal={handleToggleOriginal}
        badgeMap={badgeMap}
        showStreamingBadge={showStreamingBadge}
        activeModelId={activeModelId}
        showTestInLab={promptLabEnabled}
        onTestInLab={promptLabEnabled ? handleTestInLab : undefined}
        testInLabLabel={t('chat.testInLab')}
      />
      {ephemeralMessages.map(msg => (
        <div key={msg} className="text-muted-foreground px-4 py-2 text-sm">
          {t(msg)}
        </div>
      ))}
      {pipelineProgress.isActive && (
        <div className="px-4 pb-2">
          <PipelineProgress
            currentStepId={pipelineProgress.currentStepId}
            currentStepLabel={pipelineProgress.currentStepLabel}
            completedSteps={pipelineProgress.completedSteps}
            translatingInputLabel={t('pipeline.translatingInput')}
            generatingResponseLabel={t('pipeline.generatingResponse')}
            translatingOutputLabel={t('pipeline.translatingOutput')}
            progressAriaLabel={t('chat.pipelineProgress')}
            stateLabels={{
              active: t('chat.stepActive'),
              completed: t('chat.stepCompleted'),
              pending: t('chat.stepPending'),
            }}
          />
        </div>
      )}
      {error && (
        <div role="alert" className="text-destructive px-4 py-2 text-sm">
          {error}
        </div>
      )}
      {isChooserOpen && (
        <CommandAutocompleteContainer
          inputValue={inputValue}
          onSelectCommand={handleCommandSelect}
        />
      )}
      <ChatInput
        value={displayValue}
        onValueChange={handleInputChange}
        onSubmit={handleSubmit}
        onAbort={abort}
        isStreaming={isStreaming}
        canSend={canSend}
        textareaRef={textareaRef}
        onArrowUp={isChooserOpen ? undefined : history.navigateUp}
        onArrowDown={isChooserOpen ? undefined : history.navigateDown}
        onEscape={history.dismiss}
        placeholder={t('chat.inputPlaceholder')}
        inputAriaLabel={t('chat.messageInput')}
        sendAriaLabel={t('chat.sendMessage')}
        sendLabel={t('chat.send')}
        stopAriaLabel={t('chat.stopGeneration')}
        stopLabel={t('chat.stop')}
      />
    </div>
  );
}
