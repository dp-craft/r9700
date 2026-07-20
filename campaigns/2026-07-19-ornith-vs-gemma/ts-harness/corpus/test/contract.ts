// L4-contract helper (ADR-018): record a heavy dep's REAL output to a fixture
// once (gated, RECORD_CONTRACTS=1), then PIN the cheap unit mock to that fixture
// so the mock can never silently drift from the real shape. fs lives at the
// boundary here; callers pass absolute paths.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const isRecording = (): boolean =>
  process.env.RECORD_CONTRACTS != null && process.env.RECORD_CONTRACTS !== '';

/**
 * Sync read of a recorded contract fixture for mock pinning.
 * Throws a clear, actionable error when the fixture is absent.
 */
export const readContract = <T>(absFixturePath: string): T => {
  try {
    return JSON.parse(readFileSync(absFixturePath, 'utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `contract fixture not readable at ${absFixturePath} (${message}) — run \`npm run contract:record\``
    );
  }
};

/**
 * In RECORD_CONTRACTS mode: run `produce()` against the real dep, write the
 * result as pretty JSON, and return it. Otherwise: read+parse the existing
 * fixture (throwing an actionable error when it is missing).
 */
export const loadOrRecordContract = async <T>(
  absFixturePath: string,
  produce: () => Promise<T>
): Promise<T> => {
  if (isRecording()) {
    const recorded = await produce();
    mkdirSync(dirname(absFixturePath), { recursive: true });
    writeFileSync(absFixturePath, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
    return recorded;
  }
  return readContract<T>(absFixturePath);
};
