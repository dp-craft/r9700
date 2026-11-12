import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatNumber, formatTime } from '../format';

// Fixed date: 2026-02-28 10:30:00 local time (month is 0-indexed)
const TEST_DATE = new Date(2026, 1, 28, 10, 30, 0);
const TEST_TIMESTAMP = TEST_DATE.getTime();

// -- formatDate --

describe('formatDate', () => {
  it('should format date in Hungarian style with dots and spaces', () => {
    const result = formatDate(TEST_DATE, 'hu');

    expect(result).toBe('2026. 02. 28.');
  });

  it('should format date in English MM/DD/YYYY style', () => {
    const result = formatDate(TEST_DATE, 'en');

    expect(result).toBe('02/28/2026');
  });

  it('should accept a number timestamp input', () => {
    const result = formatDate(TEST_TIMESTAMP, 'hu');

    expect(result).toBe('2026. 02. 28.');
  });
});

// -- formatTime --

describe('formatTime', () => {
  it('should format time in Hungarian 24-hour style', () => {
    const result = formatTime(TEST_DATE, 'hu');

    expect(result).toBe('10:30');
  });

  it('should format time in English 12-hour style with AM/PM', () => {
    const result = formatTime(TEST_DATE, 'en');

    expect(result).toBe('10:30 AM');
  });
});

// -- formatDateTime --

describe('formatDateTime', () => {
  it('should combine date and time with a space separator', () => {
    const result = formatDateTime(TEST_DATE, 'hu');

    expect(result).toBe('2026. 02. 28. 10:30');
  });
});

// -- formatNumber --

describe('formatNumber', () => {
  it('should use space as thousands separator for Hungarian locale', () => {
    const result = formatNumber(1234567, 'hu');

    // Hungarian uses non-breaking space (U+00A0) as thousands separator
    expect(result).toBe('1\u00a0234\u00a0567');
  });

  it('should use comma as thousands separator for English locale', () => {
    const result = formatNumber(1234567, 'en');

    expect(result).toBe('1,234,567');
  });
});
