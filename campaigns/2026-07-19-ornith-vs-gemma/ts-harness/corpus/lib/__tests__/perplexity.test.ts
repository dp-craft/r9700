import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOrRecordContract, readContract } from '@/test/contract';

// -- Boundary mock: @huggingface/transformers (lazy-loaded inside the lib) --
// The fakes reproduce the REAL transformers.js shapes: AutoTokenizer.from_pretrained
// yields a callable tokenizer returning { input_ids: Tensor }, and
// AutoModelForCausalLM.from_pretrained yields a callable model returning
// { logits: Tensor }. A Tensor is `{ data: <typed array>, dims: number[] }`.

const tokenizerFromPretrained = vi.fn();
const modelFromPretrained = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: tokenizerFromPretrained },
  AutoModelForCausalLM: { from_pretrained: modelFromPretrained },
}));

// -- Contract-pinned fixture (ADR-018 L4) -----------------------------------
// The mock no longer hand-computes its tensors: it PINS to the shape recorded
// from the real model into perplexity.contract.json (via `npm run contract:record`).
// This closes the mock-drift class — the unit mock cannot diverge from the real
// dep's actual output shape, because both flow through the same fixture.
interface PerplexityContract {
  readonly recorded: boolean;
  readonly modelId: string;
  readonly text: string;
  readonly inputIds: readonly number[];
  readonly inputDims: readonly number[];
  readonly logits: readonly number[];
  readonly logitsDims: readonly number[];
  readonly vocabSize: number;
  readonly perplexity: number;
}

const CONTRACT_PATH = resolve(process.cwd(), 'src/lib/__tests__/perplexity.contract.json');
const CONTRACT = readContract<PerplexityContract>(CONTRACT_PATH);
const EXPECTED_PERPLEXITY = CONTRACT.perplexity;

const fakeTensor = (data: Float32Array | BigInt64Array, dims: readonly number[]): unknown => ({
  data,
  dims: [...dims],
});

const createFakeTokenizer = (): ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({
    input_ids: fakeTensor(
      BigInt64Array.from(CONTRACT.inputIds.map(id => BigInt(id))),
      CONTRACT.inputDims
    ),
  }));

const createFakeModel = (): ReturnType<typeof vi.fn> =>
  vi.fn(async () => ({
    logits: fakeTensor(Float32Array.from(CONTRACT.logits), CONTRACT.logitsDims),
  }));

// Re-import the module fresh per test so the module-level readiness singleton
// is reset between cases.
type PerplexityModule = typeof import('@/lib/perplexity');

const loadFreshModule = async (): Promise<PerplexityModule> => {
  vi.resetModules();
  return import('@/lib/perplexity');
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenizerFromPretrained.mockResolvedValue(createFakeTokenizer());
  modelFromPretrained.mockResolvedValue(createFakeModel());
});

describe('perplexity lib', () => {
  it('should use a dynamic import of @huggingface/transformers, never a static top-level import', () => {
    const sourcePath = resolve(process.cwd(), 'src/lib/perplexity.ts');
    const source = readFileSync(sourcePath, 'utf8');
    const staticImport = /^\s*import[^\n]*from\s+['"]@huggingface\/transformers['"]/m;
    const dynamicImport = /import\(\s*['"]@huggingface\/transformers['"]\s*\)/;
    expect(staticImport.test(source)).toBe(false);
    expect(dynamicImport.test(source)).toBe(true);
  });

  it('should compute the contract-pinned true perplexity from a causal-LM forward pass', async () => {
    const { computePerplexity } = await loadFreshModule();
    const result = await computePerplexity(CONTRACT.text);
    expect(result).toBeCloseTo(EXPECTED_PERPLEXITY, 6);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(1);
  });

  it('mock pins to the recorded real-model contract', () => {
    expect(CONTRACT).toMatchObject({
      modelId: expect.any(String),
      text: expect.any(String),
      vocabSize: expect.any(Number),
      perplexity: expect.any(Number),
    });
    expect(typeof CONTRACT.recorded).toBe('boolean');
    expect(CONTRACT.inputIds.length).toBeGreaterThanOrEqual(2);
    expect(CONTRACT.inputDims[CONTRACT.inputDims.length - 1]).toBe(CONTRACT.inputIds.length);
    expect(CONTRACT.logitsDims[CONTRACT.logitsDims.length - 1]).toBe(CONTRACT.vocabSize);
    expect(CONTRACT.logits.length).toBe(CONTRACT.inputIds.length * CONTRACT.vocabSize);
    expect(CONTRACT.perplexity).toBeGreaterThan(1);
  });

  it('should resolve to 0 without loading the model when text is empty or whitespace', async () => {
    const { computePerplexity } = await loadFreshModule();
    const result = await computePerplexity('   \n\t  ');
    expect(result).toBe(0);
    expect(tokenizerFromPretrained).not.toHaveBeenCalled();
    expect(modelFromPretrained).not.toHaveBeenCalled();
  });

  it('should return 0 for single-token text (L < 2, no prediction positions)', async () => {
    tokenizerFromPretrained.mockResolvedValue(
      vi.fn(async () => ({
        input_ids: fakeTensor(BigInt64Array.from([5n]), [1, 1]),
      }))
    );
    const { computePerplexity } = await loadFreshModule();
    const result = await computePerplexity('hi');
    expect(result).toBe(0);
  });

  it('should be idempotent: two sequential ensurePerplexityModel calls load model+tokenizer at most once', async () => {
    const { ensurePerplexityModel, isPerplexityModelReady } = await loadFreshModule();
    await ensurePerplexityModel();
    await ensurePerplexityModel();
    expect(tokenizerFromPretrained).toHaveBeenCalledTimes(1);
    expect(modelFromPretrained).toHaveBeenCalledTimes(1);
    expect(isPerplexityModelReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Graceful-degradation: timeout branch
// ---------------------------------------------------------------------------

describe('ensurePerplexityModel — timeout graceful degradation', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should reject when model load exceeds PERPLEXITY_MODEL_LOAD_TIMEOUT_MS', async () => {
    vi.clearAllMocks();
    // model load returns a promise that never resolves — simulates hung download
    modelFromPretrained.mockReturnValue(new Promise<never>(() => {}));
    tokenizerFromPretrained.mockReturnValue(new Promise<never>(() => {}));

    const { ensurePerplexityModel } = await loadFreshModule();

    vi.useFakeTimers();
    const loadPromise = ensurePerplexityModel();
    const caught = loadPromise.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(120_100);
    const result = await caught;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('perplexity model load timed out');
  });

  it('should clear the in-flight promise and reset ready to false after timeout so a later call can retry', async () => {
    vi.clearAllMocks();
    modelFromPretrained.mockReturnValue(new Promise<never>(() => {}));
    tokenizerFromPretrained.mockReturnValue(new Promise<never>(() => {}));

    const { ensurePerplexityModel, isPerplexityModelReady } = await loadFreshModule();

    vi.useFakeTimers();
    const loadPromise = ensurePerplexityModel();
    const settled = loadPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(120_100);
    await settled;

    expect(isPerplexityModelReady()).toBe(false);
  });

  it('should allow a successful retry after a prior timeout', async () => {
    vi.clearAllMocks();
    // Tokenizer always resolves; the MODEL load hangs on the first call only.
    tokenizerFromPretrained.mockResolvedValue(createFakeTokenizer());
    modelFromPretrained.mockReturnValueOnce(new Promise<never>(() => {}));
    modelFromPretrained.mockReturnValueOnce(Promise.resolve(createFakeModel()));

    const { ensurePerplexityModel, isPerplexityModelReady } = await loadFreshModule();

    vi.useFakeTimers();
    const firstLoad = ensurePerplexityModel();
    const settled = firstLoad.catch(() => {});
    await vi.advanceTimersByTimeAsync(120_100);
    await settled;

    // Retry under fake timers: the second load resolves before the timeout
    // budget elapses; advance just enough to flush microtasks. Real timers
    // would orphan the race's reject-timer past the test boundary.
    const retry = ensurePerplexityModel();
    await vi.advanceTimersByTimeAsync(10);
    await retry;

    expect(isPerplexityModelReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Opt-in smoke: loads the REAL Xenova/distilgpt2 weights (network download).
// Closes the "stubbed-everywhere" gap — verifies the live Tensor field names
// (.data/.dims) and the causal-LM forward pass against a real model, which the
// mocked suite cannot. Skipped in default `test:ci` (offline/CI safe): runs only
// when RUN_MODEL_TESTS is set, and is NOT subject to the @huggingface mock.
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_MODEL_TESTS)('perplexity lib — real-model smoke', () => {
  it('should compute a finite perplexity > 1 for real English text', async () => {
    vi.doUnmock('@huggingface/transformers');
    const { computePerplexity } = await loadFreshModule();
    const result = await computePerplexity('The cat sat on the mat.');
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(1);
  }, 120_000);

  // Recording pass (RECORD_CONTRACTS=1): drive the REAL tokenizer + model on the
  // contract text, capture the live input_ids/logits shape, and persist it so the
  // mocked suite above pins to a recorded fixture (not hand math). Without the env
  // flag this reads back the fixture and asserts the real perplexity matches.
  it('records the real-model output shape into the contract fixture', async () => {
    vi.doUnmock('@huggingface/transformers');
    const transformers = await import('@huggingface/transformers');
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(CONTRACT.modelId);
    const model = await transformers.AutoModelForCausalLM.from_pretrained(CONTRACT.modelId, {
      dtype: 'q4',
    });
    const { computePerplexity } = await loadFreshModule();

    const recorded: PerplexityContract = await loadOrRecordContract<PerplexityContract>(
      CONTRACT_PATH,
      async (): Promise<PerplexityContract> => {
        const encoded = (await tokenizer(CONTRACT.text)) as {
          readonly input_ids: {
            readonly data: ArrayLike<bigint>;
            readonly dims: readonly number[];
          };
        };
        const out = (await model(encoded)) as {
          readonly logits: {
            readonly data: ArrayLike<number>;
            readonly dims: readonly number[];
          };
        };
        const inputDims = [...encoded.input_ids.dims];
        const logitsDims = [...out.logits.dims];
        const vocabSize = logitsDims[logitsDims.length - 1];
        const seqLength = inputDims[inputDims.length - 1];
        const inputIds = Array.from(encoded.input_ids.data, (v: bigint): number => Number(v));
        // Persist only the first logits row (t=0) + a zero tail — enough to pin the
        // mock's [1, L, V] shape without serializing a 50k-wide vocab × L matrix.
        const firstRow = Array.from({ length: vocabSize }, (_unused, i: number): number =>
          Number(out.logits.data[i])
        );
        const tail = new Array<number>((seqLength - 1) * vocabSize).fill(0);
        const perplexity = await computePerplexity(CONTRACT.text);
        return {
          recorded: true,
          modelId: CONTRACT.modelId,
          text: CONTRACT.text,
          inputIds: inputIds.slice(0, 2),
          inputDims: [1, 2],
          logits: [...firstRow, ...tail].slice(0, 2 * vocabSize),
          logitsDims: [1, 2, vocabSize],
          vocabSize,
          perplexity,
        };
      }
    );

    expect(recorded.recorded).toBe(true);
    expect(recorded.perplexity).toBeGreaterThan(1);
  }, 120_000);
});
