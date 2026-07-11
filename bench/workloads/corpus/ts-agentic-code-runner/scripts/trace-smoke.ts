// Minimal end-to-end tracing smoke: one real OpenRouter generation through the
// runner's instrumented connector, emitting an OTLP trace (prompt/response/usage).
// Run with RUNNER_TRACING=1 and OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS pointed at Langfuse.
// NOT a Claude model — Claude stays on its own native telemetry by project policy.
import { createModel, generate } from '../src/core/llm';
import type { ModelProfile } from '../src/core/profiles';
import { initTracing } from '../src/core/reporting';

const MODEL_ID = process.env.RUNNER_MODEL_ID ?? 'qwen/qwen3.6-35b-a3b';

const main = async (): Promise<void> => {
  const tracing = initTracing();
  const profile: ModelProfile = { name: 'trace-smoke', backend: 'openrouter', modelId: MODEL_ID };
  const model = createModel(profile);
  const result = await generate(model, {
    system: 'You are a terse assistant.',
    messages: [{ role: 'user', content: 'Reply with exactly: tracing works' }],
    tools: {},
    maxSteps: 1,
    telemetry: {
      modelId: MODEL_ID,
      backend: profile.backend,
      agentType: 'smoke',
      rung: 'openrouter',
    },
  });
  console.log('text:', result.text.trim());
  console.log('usage:', JSON.stringify(result.usage ?? null));
  await tracing.shutdown();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
