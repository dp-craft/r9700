import { afterEach, describe, expect, it } from 'vitest';

import { MAX_TARGET_FILES, SUPPORTED_AGENT_TYPES } from '../execution/executor';
import { BUILTIN_PROFILES, DEFAULT_PROFILE_NAME, ENV_MODEL_ID_KEY, ENV_PROFILE_KEY } from '../profiles/profiles';
import { buildCapabilities, CAPABILITIES_SCHEMA, RUNNER_BUILD } from './capabilities';
import { LADDERS } from './escalation';
import { PIPELINES } from './pipeline';

describe('buildCapabilities', () => {
  const ORIGINAL_COMPLEXITY = process.env.RUNNER_MAX_COMPLEXITY;

  afterEach(() => {
    if (ORIGINAL_COMPLEXITY === undefined) {
      delete process.env.RUNNER_MAX_COMPLEXITY;
    } else {
      process.env.RUNNER_MAX_COMPLEXITY = ORIGINAL_COMPLEXITY;
    }
  });

  it('should declare the versioned schema and a tsx build (no dist to probe)', () => {
    const caps = buildCapabilities();
    expect(caps.schema).toBe(CAPABILITIES_SCHEMA);
    expect(caps.build).toBe(RUNNER_BUILD);
    expect(caps.build).toBe('none (tsx)');
  });

  it('should report the agent types from the executor SoT', () => {
    expect(buildCapabilities().agentTypes).toEqual([...SUPPORTED_AGENT_TYPES]);
  });

  it('should include ui-writer in the advertised agent types', () => {
    expect(buildCapabilities().agentTypes).toContain('ui-writer');
  });

  it('should advertise a max target-file footprint of fifty', () => {
    expect(buildCapabilities().maxTargetFiles).toBe(50);
  });

  it('should report the run modes from the PIPELINES SoT', () => {
    expect([...buildCapabilities().modes].sort()).toEqual(Object.keys(PIPELINES).sort());
  });

  it('should report the max target-file footprint from the executor SoT', () => {
    expect(buildCapabilities().maxTargetFiles).toBe(MAX_TARGET_FILES);
  });

  it('should name every gate in every mode (no unnamed stage drift)', () => {
    const { gatesByMode } = buildCapabilities();
    const allGates = Object.values(gatesByMode).flat();
    expect(allGates.length).toBeGreaterThan(0);
    expect(allGates).not.toContain('unknown');
  });

  it('should project a gate name per pipeline stage for each mode', () => {
    const { gatesByMode } = buildCapabilities();
    (Object.keys(PIPELINES) as Array<keyof typeof PIPELINES>).forEach(mode => {
      expect(gatesByMode[mode]).toHaveLength(PIPELINES[mode].length);
    });
  });

  it('should reflect the RUNNER_MAX_COMPLEXITY override in complexityCap', () => {
    delete process.env.RUNNER_MAX_COMPLEXITY;
    expect(buildCapabilities().complexityCap).toBe(5);
    process.env.RUNNER_MAX_COMPLEXITY = '9';
    expect(buildCapabilities().complexityCap).toBe(9);
  });

  it('should report the two independent escalation ladders from the escalation SoT', () => {
    const { escalation } = buildCapabilities();
    expect(escalation.ladders).toEqual({
      ollama: [...LADDERS.ollama],
      openrouter: [...LADDERS.openrouter],
    });
    expect(escalation.ladders).toEqual({
      ollama: ['ollama', 'claude'],
      openrouter: ['openrouter', 'claude'],
    });
    expect(escalation.advancesRungOn).toBe('connectivity-error-only');
  });

  it('should advertise the v2 capabilities schema', () => {
    expect(buildCapabilities().schema).toBe('runner-capabilities/v2');
  });

  it('should list every built-in profile and flag the default', () => {
    const { profiles } = buildCapabilities();
    expect(profiles.map(p => p.name).sort()).toEqual(Object.keys(BUILTIN_PROFILES).sort());
    const defaults = profiles.filter(p => p.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it('should advertise the profile and model-override env keys', () => {
    const keys = buildCapabilities().env.map(e => e.key);
    expect(keys).toContain(ENV_PROFILE_KEY);
    expect(keys).toContain(ENV_MODEL_ID_KEY);
    expect(keys).toContain('OPENROUTER_API_KEY');
  });
});
