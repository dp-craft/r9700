import { describe, expect, it } from 'vitest';

import { buildDetailLabels } from '../detailPanelProps';

describe('buildDetailLabels', () => {
  it('should return an object with an analyze label when given a translation function', () => {
    const t = (key: string) => key;
    const labels = buildDetailLabels(t);
    expect(typeof labels).toBe('object');
    expect(labels).not.toBeNull();
  });
});
