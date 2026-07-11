import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractParentContext,
  flushTracing,
  initTracing,
  resolveTracesEndpoint,
  telemetrySettings,
  tracingEnabled,
  withParentContext
} from './tracing';

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

describe('resolveTracesEndpoint', () => {
  it('should append /v1/traces to a base OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(resolveTracesEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:3000/api/public/otel' })).toBe(
      'http://localhost:3000/api/public/otel/v1/traces'
    );
  });

  it('should not double a trailing slash on the base endpoint', () => {
    expect(resolveTracesEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:3000/api/public/otel/' })).toBe(
      'http://localhost:3000/api/public/otel/v1/traces'
    );
  });

  it('should use OTEL_EXPORTER_OTLP_TRACES_ENDPOINT verbatim (no append)', () => {
    expect(
      resolveTracesEndpoint({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://x/custom/v1/traces',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://base',
      })
    ).toBe('http://x/custom/v1/traces');
  });

  it('should fall back to the local default when no OTLP env is set', () => {
    expect(resolveTracesEndpoint({})).toBe('http://127.0.0.1:4318/v1/traces');
  });
});

describe('tracingEnabled', () => {
  const original = process.env.RUNNER_TRACING;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RUNNER_TRACING;
    } else {
      process.env.RUNNER_TRACING = original;
    }
  });

  it('should return true when RUNNER_TRACING is 1', () => {
    process.env.RUNNER_TRACING = '1';
    expect(tracingEnabled()).toBe(true);
  });

  it('should return false when RUNNER_TRACING is unset', () => {
    delete process.env.RUNNER_TRACING;
    expect(tracingEnabled()).toBe(false);
  });

  it('should return false when RUNNER_TRACING is some other value', () => {
    process.env.RUNNER_TRACING = 'true';
    expect(tracingEnabled()).toBe(false);
  });
});

describe('telemetrySettings', () => {
  const original = process.env.RUNNER_TRACING;

  beforeEach(() => {
    delete process.env.RUNNER_TRACING;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RUNNER_TRACING;
    } else {
      process.env.RUNNER_TRACING = original;
    }
  });

  it('should enable telemetry with functionId and metadata when tracing is on', () => {
    process.env.RUNNER_TRACING = '1';
    const result = telemetrySettings({ modelId: 'm', backend: 'ollama' });
    expect(result).toEqual({
      isEnabled: true,
      functionId: 'runner.generate',
      metadata: { modelId: 'm', backend: 'ollama' },
      recordInputs: true,
      recordOutputs: true,
    });
  });

  it('should record both inputs and outputs when tracing is on', () => {
    process.env.RUNNER_TRACING = '1';
    const result = telemetrySettings({ modelId: 'm', backend: 'ollama' });
    expect((result as { recordInputs: boolean }).recordInputs).toBe(true);
    expect((result as { recordOutputs: boolean }).recordOutputs).toBe(true);
  });

  it('should disable telemetry when tracing is off', () => {
    const result = telemetrySettings({ modelId: 'm', backend: 'ollama' });
    expect(result).toEqual({ isEnabled: false });
  });
});

describe('flushTracing', () => {
  const original = process.env.RUNNER_TRACING;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RUNNER_TRACING;
    } else {
      process.env.RUNNER_TRACING = original;
    }
  });

  it('should resolve without rejection when RUNNER_TRACING is unset (no active processor)', async () => {
    delete process.env.RUNNER_TRACING;
    await expect(flushTracing()).resolves.toBeUndefined();
  });

  it('should resolve without rejection after initTracing on the disabled path', async () => {
    delete process.env.RUNNER_TRACING;
    initTracing();
    await expect(flushTracing()).resolves.toBeUndefined();
  });
});

describe('inbound trace context adoption', () => {
  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterEach(() => {
    context.disable();
    propagation.disable();
  });

  it('should extract the inbound traceId from a traceparent env var', () => {
    const parent = extractParentContext({ traceparent: TRACEPARENT });
    expect(trace.getSpanContext(parent)?.traceId).toBe(TRACE_ID);
  });

  it('should yield no span context when env has no traceparent', () => {
    const parent = extractParentContext({});
    expect(trace.getSpanContext(parent)).toBeUndefined();
  });

  it('should activate the inbound parent context inside withParentContext', () => {
    const traceId = withParentContext(
      () => trace.getSpanContext(context.active())?.traceId,
      { traceparent: TRACEPARENT }
    );
    expect(traceId).toBe(TRACE_ID);
  });
});
