import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadJson } from '../download';

describe('downloadJson', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url');
  const revokeObjectURL = vi.fn();
  let clickSpy: () => void;
  let lastBlob: Blob | undefined;

  beforeEach(() => {
    lastBlob = undefined;
    createObjectURL.mockImplementation((blob: Blob) => {
      lastBlob = blob;
      return 'blob:mock-url';
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    clickSpy = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => clickSpy());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();
  });

  it('should serialize data as pretty JSON in a Blob when called', async () => {
    downloadJson('out.json', { a: 1, b: 'two' });

    expect(lastBlob).toBeInstanceOf(Blob);
    const text = await lastBlob?.text();
    expect(text).toBe(JSON.stringify({ a: 1, b: 'two' }, null, 2));
  });

  it('should set Blob type to application/json when called', () => {
    downloadJson('out.json', { a: 1 });

    expect(lastBlob?.type).toBe('application/json');
  });

  it('should set the anchor download attribute to the filename when called', () => {
    const created = vi.spyOn(document, 'createElement');

    downloadJson('report-2026.json', { ok: true });

    const anchor = created.mock.results[0]?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('report-2026.json');
    expect(anchor.href).toContain('blob:mock-url');
  });

  it('should programmatically click the anchor when called', () => {
    downloadJson('out.json', {});

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('should revoke the object URL after triggering download when called', () => {
    downloadJson('out.json', {});

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should return undefined when called', () => {
    expect(downloadJson('out.json', {})).toBeUndefined();
  });
});
