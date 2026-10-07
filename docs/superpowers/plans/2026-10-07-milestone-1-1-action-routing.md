# Milestone 1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route player commands through one engine boundary and expose lean debug modes configured in one file.

**Architecture:** Keep card handlers in ActionRegistry. A function descriptor table handles orchestration, with shape validation and state prerequisites before execution. The server retains only transport and RPS deck setup; debug UI consumes the room setting.

**Tech Stack:** TypeScript, Socket.IO, React, Vitest.

**Status:** Implemented and verified on 7 October 2026. Changes remain in the current checkout on `codex/milestone-0`.

**Final evidence:** 469 tests in 37 files passed; server and client TypeScript checks passed; production server/client build passed with Node 24.19.0. Read-only code review approved after the selected-target regression was fixed. Vitest needed execution outside the sandbox because its temporary transform-cache rename failed with EPERM inside it.

**Review corrections:** Selected pointers cannot request engine-generated target expansion; malformed filter arrays are rejected before costs, UUID allocation or events. Player commands discard supplied stack IDs; lower-level methods keep fixture UUID injection. No later milestone rules changes were introduced.

## Global Constraints

- Implement only slice 1.1 of the approved action-routing design.
- Keep debug snapshots, flat packets, existing action IDs and `{ message: string }` errors.
- Centralize new settings in `src/config.ts`; use a typed `gameConfig.debugMode` default of `flow` rather than environment parsing scattered through consumers.
- Keep the current checkout/branch as the user requested. No authentication framework, dependencies, new server factory, later rules checkpoint or priority-history redesign.

### Task 1: Engine command boundary and central configuration

**Files:** Create `src/config.ts`, `src/types/debug-mode.types.ts`, `src/engine/player-commands.ts`, `tests/engine/player-commands.test.ts`. Modify `src/engine/game-engine.ts`, `src/types/game.room.types.ts`, `src/engine/room-factory.ts`, `src/engine/option-service.ts`.

**Interfaces:** `DebugMode = 'off' | 'stack' | 'flow'`; `gameConfig: { debugMode: DebugMode }`; optional `GameRoom.debugMode` for old room compatibility; `GameEngine.executePlayerAction(playerId: PlayerId, actionId: string, data: unknown = {}): ActionResult`.

- [x] Write boundary tests for mode matrix, both players' debug controls, rejected inputs with unchanged room/collector, safe options, ordinary legality, RPS, extension payload retention, and lethal debug resolution.
- [x] Run the new test file and observe failures due to the missing command entry point.
- [x] Add the typed central setting, room copy, descriptor table, common preflight and existing-pipeline execution. Validate the consumed array entries before handlers iterate them. Keep handler-specific semantic rules in handlers.
- [x] Run focused tests and correct any failures.

### Task 2: Debug UI

**Files:** Create `src/client/components/DebugControls.tsx`, `tests/client/debug-controls.test.ts`; modify `src/client/components/PhaseBar.tsx`.

**Interfaces:** `DebugControls({ mode, stackLength, ready, onAction })`, where `mode: DebugMode`, `stackLength: number`, `ready: boolean`, and `onAction: (actionId: ActionIdOrAbility) => void`. PhaseBar passes `room.debugMode ?? gameConfig.debugMode` and readiness based on playing/waiting/no outcome.

- [x] Add render tests covering all modes, nonempty/empty stack and terminal/busy suppression; observe failure before implementation.
- [x] Put end-turn/resolve buttons in a labelled DebugControls section. Keep pass/combat controls in PhaseBar; enter-battle also requires priority.
- [x] Run the rendering test and client typecheck.

### Task 3: Thin socket routing and integration

**Files:** Create `src/server/action-packet.ts`, `tests/server/action-packet.test.ts`; modify `src/server.ts`, `tests/server/live-routing.test.ts`, and action-routing documentation.

**Interfaces:** `parseActionPacket(input: unknown): { roomId: string; actionId: string; data: ActionData } | null`, retaining flat action payload fields except transport/identity fields.

- [x] Write packet tests and actual socket tests for malformed requests, missing actors, mode rejections without deltas, non-priority debug use, ordinary mana/pass/combat and reconnect mode retention. Observe failures before wiring changes.
- [x] Replace the player-action switch with parse → engine.executePlayerAction → RPS setup if both choices exist → save → sync. Guard options inputs and callback type.
- [x] Run focused engine/UI/socket tests, full test suite, both typechecks and production build with the supported bundled Node runtime.
- [x] Review the final diff against the approved spec, fix material findings and report changes and verification. Leave the branch available for the user; no merge/push.
