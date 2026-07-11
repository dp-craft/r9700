import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgress, debugEnabled } from './progress';

// ---------------------------------------------------------------------------
// debugEnabled
// ---------------------------------------------------------------------------

describe('debugEnabled', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.RUNNER_DEBUG = process.env.RUNNER_DEBUG;
    delete process.env.RUNNER_DEBUG;
  });

  afterEach(() => {
    if (savedEnv.RUNNER_DEBUG === undefined) delete process.env.RUNNER_DEBUG;
    else process.env.RUNNER_DEBUG = savedEnv.RUNNER_DEBUG;
  });

  it('should return true when RUNNER_DEBUG env is set to 1', () => {
    process.env.RUNNER_DEBUG = '1';

    expect(debugEnabled([])).toBe(true);
  });

  it('should return true when argv includes --debug', () => {
    delete process.env.RUNNER_DEBUG;

    expect(debugEnabled(['--debug'])).toBe(true);
  });

  it('should return false when neither RUNNER_DEBUG=1 nor --debug is present', () => {
    delete process.env.RUNNER_DEBUG;

    expect(debugEnabled(['--agent', 'code-logic-writer'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createProgress — disabled
// ---------------------------------------------------------------------------

describe('createProgress(false)', () => {
  it('should not call sink when event is invoked', () => {
    const sink = vi.fn();
    const progress = createProgress(false, sink);

    progress.event('any-stage', 'some detail');

    expect(sink).not.toHaveBeenCalled();
  });

  it('should not call sink when event is invoked with no detail', () => {
    const sink = vi.fn();
    const progress = createProgress(false, sink);

    progress.event('rules');

    expect(sink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createProgress — enabled
// ---------------------------------------------------------------------------

describe('createProgress(true)', () => {
  it('should emit formatted line with stage and detail when both are provided', () => {
    const lines: string[] = [];
    const progress = createProgress(true, line => lines.push(line));

    progress.event('stage', 'x ok');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[runner] stage — x ok\n');
  });

  it('should emit formatted line without separator when detail is absent', () => {
    const lines: string[] = [];
    const progress = createProgress(true, line => lines.push(line));

    progress.event('rules');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[runner] rules\n');
  });

  it('should emit formatted line without separator when detail is empty string', () => {
    const lines: string[] = [];
    const progress = createProgress(true, line => lines.push(line));

    progress.event('stage', '');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[runner] stage\n');
  });
});

// ---------------------------------------------------------------------------
// createProgress — default sink writes to stderr not stdout
// ---------------------------------------------------------------------------

describe('createProgress — default sink targets stderr', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should write to process.stderr and not process.stdout when no custom sink is provided', () => {
    const progress = createProgress(true);

    progress.event('boot', 'starting');

    expect(process.stderr.write).toHaveBeenCalledWith('[runner] boot — starting\n');
    expect(process.stdout.write).not.toHaveBeenCalled();
  });
});
