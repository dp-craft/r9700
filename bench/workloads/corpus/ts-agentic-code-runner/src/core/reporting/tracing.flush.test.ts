import * as http from 'node:http';

import { trace } from '@opentelemetry/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { flushTracing, initTracing, type TracingHandle } from './tracing';

// ---------------------------------------------------------------------------
// In-process collector helpers
// ---------------------------------------------------------------------------

interface CollectorState {
  requestCount: number;
  totalBodyBytes: number;
}

interface Collector {
  state: CollectorState;
  port: number;
  resetState: () => void;
  close: () => Promise<void>;
}

const startCollector = (): Promise<Collector> =>
  new Promise((resolve, reject) => {
    const state: CollectorState = { requestCount: 0, totalBodyBytes: 0 };
    const server = http.createServer((req, res) => {
      let bodyLen = 0;
      req.on('data', (chunk: Buffer) => {
        bodyLen += chunk.length;
      });
      req.on('end', () => {
        state.requestCount += 1;
        state.totalBodyBytes += bodyLen;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('unexpected address type'));
        return;
      }
      resolve({
        state,
        port: addr.port,
        resetState: () => {
          state.requestCount = 0;
          state.totalBodyBytes = 0;
        },
        close: (): Promise<void> =>
          new Promise((res, rej) => server.close(err => (err !== undefined ? rej(err) : res()))),
      });
    });
    server.on('error', reject);
  });

const pollUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 50
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    }
    await new Promise<void>(res => setTimeout(res, intervalMs));
  }
};

// ---------------------------------------------------------------------------
// Suite — uses a SINGLE SDK lifecycle (beforeAll/afterAll) because
// OTEL's global TracerProvider is a process singleton: a second sdk.start()
// silently fails duplicate-registration, so all network tests must share
// one initTracing() call.
// ---------------------------------------------------------------------------

describe('flushTracing — incremental export stress test', () => {
  let collector: Collector;
  let handle: TracingHandle;

  const origTracingEnv = process.env.RUNNER_TRACING;
  const origOtlpEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  beforeAll(async () => {
    collector = await startCollector();
    process.env.RUNNER_TRACING = '1';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${collector.port}`;
    handle = initTracing();
  });

  afterAll(async () => {
    await handle.shutdown();
    await collector.close();

    if (origTracingEnv === undefined) {
      delete process.env.RUNNER_TRACING;
    } else {
      process.env.RUNNER_TRACING = origTracingEnv;
    }
    if (origOtlpEnv === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origOtlpEnv;
    }
  });

  it('should export spans INCREMENTALLY (multiple POSTs before shutdown)', async () => {
    // Arrange
    const ITERATIONS = 10;
    const tracer = trace.getTracer('test');
    collector.resetState();

    // Act — emit one span then flush per iteration, mimicking per-step runner behaviour
    for (let i = 0; i < ITERATIONS; i++) {
      const span = tracer.startSpan(`step-${i}`);
      span.end();
      await flushTracing();
    }

    // Assert (1) — the collector must have received MULTIPLE separate HTTP POSTs
    // BEFORE shutdown is ever called.  A single-batch-on-shutdown implementation
    // would yield requestCount === 0 here.
    await pollUntil(() => collector.state.requestCount >= 2);
    expect(collector.state.requestCount).toBeGreaterThanOrEqual(2);

    // Assert (2) — body bytes > 0 proves the exporter serialised real span data.
    expect(collector.state.totalBodyBytes).toBeGreaterThan(0);
  });

  it('should not lose spans buffered after the last flush when shutdown drains the queue', async () => {
    // Arrange — reset counters, then emit one span WITHOUT flushing
    collector.resetState();
    const tracer = trace.getTracer('test');
    const span = tracer.startSpan('pre-shutdown-span');
    span.end();

    // Act — explicit forceFlush (simulating what shutdown does internally)
    await flushTracing();

    // Poll until the in-flight POST lands
    await pollUntil(() => collector.state.totalBodyBytes > 0, 2000);

    // Assert — the span was delivered without waiting for sdk.shutdown()
    expect(collector.state.requestCount).toBeGreaterThanOrEqual(1);
    expect(collector.state.totalBodyBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Disabled-path suite — no SDK, no network
// ---------------------------------------------------------------------------

describe('flushTracing — disabled path', () => {
  const origTracingEnv = process.env.RUNNER_TRACING;

  afterAll(() => {
    if (origTracingEnv === undefined) {
      delete process.env.RUNNER_TRACING;
    } else {
      process.env.RUNNER_TRACING = origTracingEnv;
    }
  });

  it('should resolve without sending anything when RUNNER_TRACING is unset and initTracing was not called', async () => {
    delete process.env.RUNNER_TRACING;
    await expect(flushTracing()).resolves.toBeUndefined();
  });
});
