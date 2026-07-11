import { type Context, context, propagation } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const SERVICE_NAME = 'agentic-code-runner';
const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/traces';
const DEFAULT_FUNCTION_ID = 'runner.generate';

// The generate span name becomes the Langfuse trace name. Derive it from the run
// identity (agent + escalation rung) so traces are distinguishable instead of all
// sharing one constant; fall back to the generic id when those fields are absent.
const buildFunctionId = (metadata: Readonly<Record<string, string>>): string => {
  const agentType = metadata.agentType;
  if (agentType === undefined || agentType === '') {
    return DEFAULT_FUNCTION_ID;
  }
  const rung = metadata.rung === undefined || metadata.rung === '' ? '' : `.${metadata.rung}`;
  return `runner.${agentType}${rung}`;
};

export interface TracingHandle {
  readonly shutdown: () => Promise<void>;
}

export type TelemetryOptions =
  | {
    readonly isEnabled: true;
    readonly functionId: string;
    readonly metadata: Record<string, string>;
    readonly recordInputs: true;
    readonly recordOutputs: true;
  }
  | { readonly isEnabled: false };

export const tracingEnabled = (): boolean => process.env.RUNNER_TRACING === '1';

// Resolve the OTLP traces URL per the OpenTelemetry env spec, so a single
// OTEL_EXPORTER_OTLP_ENDPOINT (base, e.g. .../api/public/otel) feeds BOTH this
// runner and Claude Code's native exporter without path drift:
//   - OTEL_EXPORTER_OTLP_TRACES_ENDPOINT → used verbatim (full path)
//   - OTEL_EXPORTER_OTLP_ENDPOINT        → base, '/v1/traces' appended
//   - neither                            → DEFAULT (local obs-collector)
export const resolveTracesEndpoint = (env: NodeJS.ProcessEnv = process.env): string => {
  const perSignal = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (perSignal !== undefined && perSignal !== '') {
    return perSignal;
  }
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base !== undefined && base !== '') {
    return `${base.replace(/\/+$/, '')}/v1/traces`;
  }
  return DEFAULT_OTLP_ENDPOINT;
};

// Module-level ref to the active span processor — a boundary singleton so
// flushTracing() (called per LLM step from the connector) can force a flush
// without threading the processor through every call site.
const holder: { proc?: BatchSpanProcessor; inFlight?: Promise<void> } = {};

// Force the BatchSpanProcessor to drain its queue NOW. The default 5s batch
// timer never fires because synchronous gate runs starve the event loop, so
// spans must be flushed explicitly. MUST never reject — a flush failure must
// not break a run.
export const flushTracing = (): Promise<void> => {
  const proc = holder.proc;
  if (proc === undefined) {
    return Promise.resolve();
  }
  holder.inFlight = proc.forceFlush().catch((): void => {});
  return holder.inFlight;
};

export const initTracing = (): TracingHandle => {
  if (!tracingEnabled()) {
    holder.proc = undefined;
    return { shutdown: async (): Promise<void> => {} };
  }
  const url = resolveTracesEndpoint();
  const processor = new BatchSpanProcessor(new OTLPTraceExporter({ url }));
  holder.proc = processor;
  const sdk = new NodeSDK({
    serviceName: SERVICE_NAME,
    spanProcessors: [processor],
  });
  sdk.start();
  return {
    shutdown: async (): Promise<void> => {
      await holder.inFlight;
      holder.proc = undefined;
      holder.inFlight = undefined;
      await sdk.shutdown();
    },
  };
};

// recordInputs captures the structured prompt only; per-step accumulation is O(N²) within a
// single agentic call but transient — BatchSpanProcessor flushes spans to OTLP→sqlite and
// releases their references for GC, so memory is bounded by one flush window, not call count.
// The heavy raw HTTP bodies stay off via connector's experimental_include requestBody/responseBody.
// The orchestrator injects a W3C traceparent into the child env; extracting it as
// the active context's parent makes the runner's AI-SDK spans nest in the SAME
// Langfuse trace as the orchestrator's task span (no-op when no traceparent / no
// propagator registered → tracing disabled).
export const extractParentContext = (env: NodeJS.ProcessEnv = process.env): Context =>
  propagation.extract(context.active(), env);

export const withParentContext = <T>(fn: () => T, env: NodeJS.ProcessEnv = process.env): T =>
  context.with(extractParentContext(env), fn);

export const telemetrySettings = (metadata: Readonly<Record<string, string>>): TelemetryOptions =>
  tracingEnabled()
    ? {
        isEnabled: true,
        functionId: buildFunctionId(metadata),
        metadata: { ...metadata },
        recordInputs: true,
        recordOutputs: true,
      }
    : { isEnabled: false };
