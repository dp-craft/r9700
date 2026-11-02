import { z } from 'zod';

/** The one owner of the schema-version literal; writers stamp their envelopes with it. */
export const IR_SCHEMA_VERSION = 1;

/** Every IR document is versioned so a replayed capture can never be parsed by a newer contract. */
export const SchemaVersionSchema = z.literal(IR_SCHEMA_VERSION);
