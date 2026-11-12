// In-browser TRUE perplexity via transformers.js (onnxruntime-web WASM).
// `@huggingface/transformers` is loaded ONLY through a dynamic import inside the
// functions below so the model runtime never enters the main bundle — it is
// fetched lazily, gated by the `lab-perplexity-enabled` flag at the call site.
// The network model download is triggered directly on demand by this module.
//
// Perplexity is computed from a causal-LM forward pass: for each position t the
// model's logits row t is the distribution predicting token (t+1). We take the
// log-softmax of that row at the true next-token id (numerically stable) to get
// the per-token cross-entropy, then return exp(mean nll). A `text-generation`
// pipeline only yields decoded text (no logits) — hence the explicit model call.

const MODEL_ID = 'Xenova/distilgpt2';
const MODEL_QUANTIZATION = 'q4';

// Best-effort budget for the lazy transformers import + model load; the browser
// dynamic import / weight download can hang indefinitely with no error.
// Sized for the ONE-TIME model + ONNX WASM download on first use; transformers.js
// caches weights in the browser, so subsequent loads resolve fast. The timeout
// still bounds a genuine hang (offline / blocked CDN), just with a realistic budget.
const PERPLEXITY_MODEL_LOAD_TIMEOUT_MS = 120_000;

// Minimal structural contract over the transformers.js boundary. A Tensor is an
// object exposing a typed-array `data` view and an integer-shape `dims`.
type TensorLike = {
  readonly data: ArrayLike<number | bigint>;
  readonly dims: readonly number[];
};

type Tokenizer = (text: string) => Promise<{ readonly input_ids: TensorLike }>;
type CausalLM = (inputs: {
  readonly input_ids: TensorLike;
}) => Promise<{ readonly logits: TensorLike }>;

type LoadedModel = {
  readonly tokenizer: Tokenizer;
  readonly model: CausalLM;
};

// Module-scoped mutable singleton — the documented infra-state exception
// (an external-handle cache for the loaded model + an in-flight load promise).
let modelPromise: Promise<LoadedModel> | null = null;
let ready = false;

const isTensorLike = (value: unknown): value is TensorLike => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { readonly data?: unknown; readonly dims?: unknown };
  return (
    candidate.data != null &&
    typeof (candidate.data as ArrayLike<unknown>).length === 'number' &&
    Array.isArray(candidate.dims)
  );
};

const toNumber = (value: number | bigint): number =>
  typeof value === 'bigint' ? Number(value) : value;

const loadModel = async (): Promise<LoadedModel> => {
  const { AutoTokenizer, AutoModelForCausalLM } = await import('@huggingface/transformers');
  const tokenizer = (await AutoTokenizer.from_pretrained(MODEL_ID)) as unknown as Tokenizer;
  const model = (await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_QUANTIZATION,
  })) as unknown as CausalLM;
  return { tokenizer, model };
};

const rejectOnTimeout = (ms: number): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('perplexity model load timed out')), ms);
  });

/**
 * Triggers the model download on demand; resolves when ready.
 * Best-effort: the browser dynamic import / weight download can hang, so the load races a
 * timeout. On timeout the in-flight promise is cleared so a later call may retry.
 */
export const ensurePerplexityModel = async (): Promise<void> => {
  if (modelPromise === null) {
    modelPromise = loadModel();
  }
  try {
    await Promise.race([modelPromise, rejectOnTimeout(PERPLEXITY_MODEL_LOAD_TIMEOUT_MS)]);
  } catch (error) {
    modelPromise = null;
    ready = false;
    throw error;
  }
  ready = true;
};

/** True once the model weights are cached/loaded. */
export const isPerplexityModelReady = (): boolean => ready;

// Log-sum-exp of a logits row (numerically stable): m + log(sum(exp(x - m))).
const logSumExp = (row: readonly number[]): number => {
  const max = row.reduce((acc, value) => (value > acc ? value : acc), Number.NEGATIVE_INFINITY);
  const sumExp = row.reduce((acc, value) => acc + Math.exp(value - max), 0);
  return max + Math.log(sumExp);
};

// Cross-entropy (nll) of the true next token at each prediction position t.
const nllPerPosition = (
  inputIds: readonly number[],
  logits: readonly number[],
  vocabSize: number
): readonly number[] =>
  inputIds.slice(0, -1).map((_value, t) => {
    const row = logits.slice(t * vocabSize, (t + 1) * vocabSize);
    const targetId = inputIds[t + 1];
    const logprob = row[targetId] - logSumExp(row);
    return -logprob;
  });

const perplexityFromForwardPass = (input: TensorLike, logits: TensorLike): number => {
  const seqLength = input.dims[input.dims.length - 1];
  if (seqLength < 2) {
    return 0;
  }
  const vocabSize = logits.dims[logits.dims.length - 1];
  const inputIds = Array.from(input.data, toNumber);
  const logitValues = Array.from(logits.data, toNumber);
  const nll = nllPerPosition(inputIds, logitValues, vocabSize);
  const meanNll = nll.reduce((sum, value) => sum + value, 0) / nll.length;
  return Math.exp(meanNll);
};

/** Lazy-loads @huggingface/transformers (Xenova/distilgpt2, q4) on first call; returns exp(mean per-token cross-entropy). */
export const computePerplexity = async (text: string): Promise<number> => {
  if (text.trim().length === 0) {
    return 0;
  }
  await ensurePerplexityModel();
  if (modelPromise === null) {
    return 0;
  }
  const { tokenizer, model } = await modelPromise;
  const inputs = await tokenizer(text);
  if (!isTensorLike(inputs.input_ids)) {
    return 0;
  }
  const { logits } = await model(inputs);
  if (!isTensorLike(logits)) {
    return 0;
  }
  return perplexityFromForwardPass(inputs.input_ids, logits);
};
