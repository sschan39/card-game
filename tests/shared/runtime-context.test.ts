import { describe, expect, it } from 'vitest';
import {
  defaultRuntimeContext,
  resolveRuntimeContext,
} from '@rules/runtime-context';

describe('resolveRuntimeContext', () => {
  it('uses production capabilities when partial overrides are explicitly undefined', () => {
    const resolved = resolveRuntimeContext({ uuid: undefined, random: undefined });

    expect(resolved.uuid).toBe(defaultRuntimeContext.uuid);
    expect(resolved.random).toBe(defaultRuntimeContext.random);
  });

  it('retains each supplied capability independently', () => {
    const uuid = () => 'fixed';
    const random = () => 0.25;

    expect(resolveRuntimeContext({ uuid })).toEqual({ uuid, random: defaultRuntimeContext.random });
    expect(resolveRuntimeContext({ random })).toEqual({ uuid: defaultRuntimeContext.uuid, random });
  });
});
