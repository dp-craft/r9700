import { z } from 'zod';
export const ResidueEntrySchema = z.object({
  class: z.string(),
  anchor: z.object({ artifact: z.string(), jsonPath: z.string() }),
  findingIds: z.array(z.string()),
  text: z.string(),
});
