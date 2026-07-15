type NlpDoc = {
  readonly people: () => { readonly out: (fmt: 'array') => readonly string[] };
  readonly places: () => { readonly out: (fmt: 'array') => readonly string[] };
  readonly organizations: () => { readonly out: (fmt: 'array') => readonly string[] };
};

type NlpFactory = (text: string) => NlpDoc;

const toDistinctSurfaceForms = (entities: readonly string[]): readonly string[] =>
  entities
    .map((entity: string): string => entity.trim().toLowerCase())
    .filter((form: string): boolean => form.length > 0);

/** Best-effort budget for the lazy compromise import + count; the browser dynamic import can hang. */
const NAMED_ENTITY_COUNT_TIMEOUT_MS = 3000;

const countDistinctEntities = async (text: string): Promise<number> => {
  const compromiseDefault: unknown = (await import('compromise')).default;
  const nlp: NlpFactory = compromiseDefault as NlpFactory;
  const doc: NlpDoc = nlp(text);
  const surfaceForms: readonly string[] = [
    ...toDistinctSurfaceForms(doc.people().out('array')),
    ...toDistinctSurfaceForms(doc.places().out('array')),
    ...toDistinctSurfaceForms(doc.organizations().out('array')),
  ];
  return new Set(surfaceForms).size;
};

const timeoutToNull = (ms: number): Promise<null> =>
  new Promise<null>(resolve => {
    setTimeout(() => resolve(null), ms);
  });

/**
 * Lazy-loads compromise; counts distinct people + places + organizations.
 * Best-effort: the browser dynamic import can hang, so the count races a timeout
 * and any hang or error degrades to `null`.
 */
export const computeNamedEntityCount = async (text: string): Promise<number | null> => {
  if (text.trim().length === 0) {
    return 0;
  }
  try {
    return await Promise.race([
      countDistinctEntities(text),
      timeoutToNull(NAMED_ENTITY_COUNT_TIMEOUT_MS),
    ]);
  } catch {
    return null;
  }
};
