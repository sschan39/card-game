import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { instructionParameterSchemas } from '../../packages/engine/src/rules/schema/instructions';

describe('instruction schemas', () => {
  it('uses the inert default instruction schema when no nested schema is supplied', () => {
    const schemas = instructionParameterSchemas(z.unknown());

    const parsed = schemas.PAY_COST.safeParse({ cost: {}, then: [{}] });

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.length).toBeGreaterThan(0);
  });
});
