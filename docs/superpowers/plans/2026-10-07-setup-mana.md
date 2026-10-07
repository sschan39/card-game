# Setup and Mana Implementation Plan

> Execute inline with TDD and independent read-only review.

**Goal:** Complete only setup config, mana payment and mana abilities.
**Architecture:** Setup defaults live in config and room snapshots; reducer turn switches update turnNumber. ManaPool plans concrete payment. A small mana-abilities module selects eligible abilities and output choices, consumed by handler and option service. Existing command, reducer, checkpoint and delta boundaries stay authoritative.
**Tech Stack:** TypeScript, React, Vitest, Socket.IO.

- [x] Write tests/engine/setup-mana.test.ts and observe failures for setup config, generic/explicit payment and mana ability choices/costs.
- [x] Add typed setup config; update room-factory, room/mutation types, turn reducer/planner and sync turnNumber mapping.
- [x] Add ManaPayment and generic cost; implement pure payment proposal/validation, parser rejection and concrete cast-cost mutations; validate action payment shape.
- [x] Implement mana ability eligibility/selection/output and validated atomic costs; enumerate actionable context-menu options and render mana symbols correctly.
- [x] Add option/client/live routing regressions, run full tests/typechecks/build, review and fix findings; update docs and commit.

## Completion evidence

537 tests in 44 files, server/client typechecks and production build pass. Independent review found no important implementation issues. Socket integration confirms selected mana output, concrete allocation and reconnect/setup/turn counter agreement. Client callback and symbol rendering tested. Existing setup defaults preserved. Manual payment allocations are supported by the action API; regular UI casting uses deterministic automatic payment.
