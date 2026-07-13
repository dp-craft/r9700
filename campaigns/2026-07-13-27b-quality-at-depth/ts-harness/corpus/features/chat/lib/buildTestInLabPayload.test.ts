import { describe, expect, it } from 'vitest';

import { TEST_IN_LAB_PAYLOAD_CAP } from '@/config';
import type { ChatMessage, ChatSession, SkillSnapshot } from '@/db/idb';
import type { TestInLabPayload } from '@/domain/cross-mf';

import {
  buildTestInLabPayload,
  type PayloadTruncationResult,
  truncatePayload
} from './buildTestInLabPayload';

// -- Builders --

const buildSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'session-001',
  title: 'Test Session',
  createdAt: 1_000_000,
  updatedAt: 1_000_001,
  model: 'gpt-4o',
  providerId: 'openai',
  skillSnapshot: null,
  ...overrides,
});

const buildSkillSnapshot = (overrides: Partial<SkillSnapshot> = {}): SkillSnapshot => ({
  containerId: 'container-001',
  containerName: 'My Container',
  skillNames: ['Skill A'],
  composedPrompt: 'You are a helpful assistant.',
  ...overrides,
});

const buildMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-001',
  sessionId: 'session-001',
  role: 'user',
  content: 'Hello, world!',
  createdAt: 1_000_000,
  ...overrides,
});

const buildPayload = (overrides: Partial<TestInLabPayload> = {}): TestInLabPayload => ({
  systemPrompts: ['You are a helpful assistant.'],
  userPrompt: 'Hello, world!',
  model: 'gpt-4o',
  providerId: 'openai',
  sourceSessionId: 'session-001',
  source: 'chat-deep-link',
  ...overrides,
});

// -- Tests --

describe('buildTestInLabPayload', () => {
  it('should return null when session is null', () => {
    const result = buildTestInLabPayload(null, buildMessage());
    expect(result).toBeNull();
  });

  it('should return null when session is undefined', () => {
    const result = buildTestInLabPayload(undefined, buildMessage());
    expect(result).toBeNull();
  });

  it('should set userPrompt to message.content', () => {
    const session = buildSession();
    const message = buildMessage({ content: 'What is TypeScript?' });
    const result = buildTestInLabPayload(session, message);
    expect(result?.userPrompt).toBe('What is TypeScript?');
  });

  it('should set systemPrompts to single-element array from session.skillSnapshot.composedPrompt', () => {
    const session = buildSession({
      skillSnapshot: buildSkillSnapshot({ composedPrompt: 'You are a code assistant.' }),
    });
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.systemPrompts).toEqual(['You are a code assistant.']);
  });

  it('should set systemPrompts to empty array when session.skillSnapshot is null', () => {
    const session = buildSession({ skillSnapshot: null });
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.systemPrompts).toEqual([]);
  });

  it('should set systemPrompts to empty array when session.skillSnapshot.composedPrompt is null', () => {
    const session = buildSession({
      skillSnapshot: buildSkillSnapshot({ composedPrompt: null }),
    });
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.systemPrompts).toEqual([]);
  });

  it('should set model to session.model', () => {
    const session = buildSession({ model: 'claude-3-5-sonnet' });
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.model).toBe('claude-3-5-sonnet');
  });

  it('should set sourceSessionId to session.id', () => {
    const session = buildSession({ id: 'session-abc-123' });
    const result = buildTestInLabPayload(session, buildMessage({ sessionId: 'session-abc-123' }));
    expect(result?.sourceSessionId).toBe('session-abc-123');
  });

  it('should set source literal to \'chat-deep-link\'', () => {
    const session = buildSession();
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.source).toBe('chat-deep-link');
  });

  it('should set providerId to session.providerId', () => {
    const session = buildSession({ providerId: 'anthropic' });
    const result = buildTestInLabPayload(session, buildMessage());
    expect(result?.providerId).toBe('anthropic');
  });
});

describe('truncatePayload', () => {
  it('should return truncated=false and droppedSystemPromptCount=0 when payload fits cap', () => {
    const payload = buildPayload({
      systemPrompts: ['Short system prompt'],
      userPrompt: 'Short user prompt',
    });
    const result: PayloadTruncationResult = truncatePayload(payload, TEST_IN_LAB_PAYLOAD_CAP);
    expect(result.truncated).toBe(false);
    expect(result.droppedSystemPromptCount).toBe(0);
    expect(result.payload).toEqual(payload);
  });

  it('should drop systemPrompts tail-first when JSON-stringified payload exceeds cap', () => {
    const longPrompt = 'x'.repeat(5_000);
    const systemPrompts = Array.from({ length: 10 }, (_, i) => `${longPrompt}-${i}`);
    const payload = buildPayload({ systemPrompts, userPrompt: 'Short user prompt' });
    const smallCap = 10_000;
    const result = truncatePayload(payload, smallCap);
    expect(result.truncated).toBe(true);
    expect(result.payload.systemPrompts.length).toBeLessThan(systemPrompts.length);
    const lastKept = result.payload.systemPrompts[result.payload.systemPrompts.length - 1];
    if (lastKept !== undefined) {
      expect(lastKept).toBe(systemPrompts[result.payload.systemPrompts.length - 1]);
    }
  });

  it('should NEVER truncate userPrompt even when oversized', () => {
    const oversizedUserPrompt = 'u'.repeat(40_000);
    const payload = buildPayload({
      systemPrompts: ['Some system prompt'],
      userPrompt: oversizedUserPrompt,
    });
    const result = truncatePayload(payload, TEST_IN_LAB_PAYLOAD_CAP);
    expect(result.payload.userPrompt).toBe(oversizedUserPrompt);
  });

  it('should return droppedSystemPromptCount equal to number of dropped entries', () => {
    const longPrompt = 'x'.repeat(5_000);
    const systemPrompts = Array.from({ length: 10 }, (_, i) => `${longPrompt}-${i}`);
    const payload = buildPayload({ systemPrompts, userPrompt: 'Short user prompt' });
    const smallCap = 10_000;
    const result = truncatePayload(payload, smallCap);
    expect(result.droppedSystemPromptCount).toBe(
      systemPrompts.length - result.payload.systemPrompts.length
    );
  });

  it('should preserve other fields (model, sourceSessionId, source, userPrompt) unchanged after truncation', () => {
    const longPrompt = 'x'.repeat(5_000);
    const systemPrompts = Array.from({ length: 10 }, () => longPrompt);
    const payload = buildPayload({
      systemPrompts,
      userPrompt: 'Original user prompt',
      model: 'gemini-pro',
      sourceSessionId: 'session-xyz',
      source: 'chat-deep-link',
    });
    const result = truncatePayload(payload, 10_000);
    expect(result.payload.model).toBe('gemini-pro');
    expect(result.payload.sourceSessionId).toBe('session-xyz');
    expect(result.payload.source).toBe('chat-deep-link');
    expect(result.payload.userPrompt).toBe('Original user prompt');
  });

  it('should preserve providerId through truncatePayload when payload fits cap', () => {
    const payload = buildPayload({ providerId: 'anthropic', systemPrompts: ['Short'] });
    const result = truncatePayload(payload, TEST_IN_LAB_PAYLOAD_CAP);
    expect(result.payload.providerId).toBe('anthropic');
  });

  it('should preserve providerId through dropTailUntilFits (truncation path)', () => {
    const longPrompt = 'x'.repeat(5_000);
    const systemPrompts = Array.from({ length: 10 }, (_, i) => `${longPrompt}-${i}`);
    const payload = buildPayload({ providerId: 'perplexity', systemPrompts });
    const result = truncatePayload(payload, 10_000);
    expect(result.truncated).toBe(true);
    expect(result.payload.providerId).toBe('perplexity');
  });

  it('should handle the case where all systemPrompts must be dropped (returns empty array)', () => {
    const systemPrompts = Array.from({ length: 5 }, () => 'x'.repeat(5_000));
    const userPrompt = 'My user prompt';
    const payload = buildPayload({ systemPrompts, userPrompt });
    const tinyCapThatOnlyFitsUserPrompt =
      JSON.stringify({
        ...payload,
        systemPrompts: [],
      }).length + 10;
    const result = truncatePayload(payload, tinyCapThatOnlyFitsUserPrompt);
    expect(result.payload.systemPrompts).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.droppedSystemPromptCount).toBe(systemPrompts.length);
  });
});
