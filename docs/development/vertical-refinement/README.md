# Vertical refinement

Status: V1 selected by the owner and implemented; V2–V4 remain proposed, independently reviewed scopes. Planning source baseline `8798da1` on local `main`, inspected 13 October 2026. [Development index](../README.md).

## Objective

Make the existing game work through the frontend and backend as a small, understandable product. Each item finishes one usable interaction. Logging should explain what the player tried, what the server decided, and what both screens received. Favor clean existing boundaries over new frameworks or comprehensive security/robustness projects.

```text
Authored definition / current room
  → visible action or choice
  → useGameActions + Socket.IO
  → normal server command / existing engine planners
  → committed state and existing events
  → delta or reconnect snapshot
  → visible result on both screens + readable logs
```

## Inspected baseline

| Area | Current evidence | Vertical gap |
|---|---|---|
| Start/setup | StartScreen creates/joins; server handles RPS and configured development deck | Confirm this through two actual browser sessions, including visible failures |
| Actions | Player actions already share `useGameActions`; options and local targeting are separate stages of that flow | Add consistent logs at those existing seams; do not invent a second sender |
| Feedback | Socket error handler sets `gameStore.error`; App only chooses StartScreen or GameScreen | A rejected action can be invisible except in the console; render a dismissible message |
| Logs | Shared contextual logger; server command/batch/event IDs; JSONL; deltas carry commandId | Client does not log action sends or applied results; UI GameLog shows action and patch count only |
| Lands | CardComponent clicks hand cards as `cast_spell`; no land action or allowance | Current deck's lands enter through the spell stack |
| Spells/priority | Targets, mana payment, stack and ordinary priority passing already exist | Prove the browser can select, pay, pass and see the result without debug resolve |
| Choices | Scalar/list/allocation ChoicePanel and reconnect work in component/socket tests | New numbers/cost routes have no loaded, browser-playable consumer |
| Combat | Existing declarations, manual allocation, phase cursor and reconciliation | Confirm declarations/rejection recovery and an ordinary turn handoff through the UI |

This is a source inspection, not a fresh browser run. The previous merged implementation passed 1008 tests; that historical result does not prove these browser interactions.

## Sequence

| Item | Player-facing deliverable | Working document |
|---|---|---|
| V1 — implemented | A click has a traceable outcome and a visible rejection reason | [Action tracing and feedback](01-action-tracing-and-feedback.md) |
| V2 | Create/join → RPS → play land → produce mana → cast/resolve a spell | [Start to spell resolution](02-start-to-spell-resolution.md) |
| V3 | Choose a number/cost/target/payment, cancel or reconnect, then resolve | [Existing choices as a playable consumer](03-playable-choice-consumer.md) |
| V4 | Declare attacks/blocks, allocate damage and reach the next ordinary turn | [Combat and turn handoff](04-combat-and-turn-handoff.md) |

V1 makes V2–V4 diagnosable. V2 fixes the common basic path before adding a demonstration definition. V3 uses data to consume already implemented engine contracts. V4 proves the rest of the ordinary game loop. Implement and review one item at a time; finish its UI/backend flow before starting the next item.

## Keep it light

- Reuse GameEngine, proposals/reducer/checkpoint, ChoicePanel, existing socket events, Zustand and the shared logger.
- Keep every setting in `src/config.ts`. Ordinary action tracing is compact; detailed applied-event logging stays optional.
- Use a reproducible development deck assembled from current definitions for V2/V4. Shuffle/order/hand-size changes belong to central development settings, never handler branches. Establish playable hands and enough library cards before running the transcript.
- V3 may add one plainly named development demonstration definition in JSON. Its behavior must consist entirely of existing typed mechanics. This is an authored consumer, not a card-specific engine patch or a content-expansion project.
- Preserve current payment atomicity and rules checks. Build no new authorization system, private-view projection, durable replay service, command retry/deduplication queue or general schema framework.
- Defer copying, creation/family infrastructure, new combat keywords, optional cost modifiers, cross-zone casting and broader targeting redesign while these vertical items are unfinished. Their roadmap documents remain open.
- Use the existing socket/component tests for code regressions and two browser sessions for visible acceptance. No new browser-runner dependency/server factory is required by this plan.

## Completion and change rule

An item is complete when its normal controls produce the expected result on both screens, one meaningful rejection/cancellation can be understood and recovered from, and the same interaction can be followed in frontend/backend logs. Record the browser transcript and focused regression evidence in its item document; no separate summary-report artifact is needed.

Refactor a file only where the selected interaction reveals duplicate responsibility. If completing a flow needs a new engine subsystem, a fake zone occupant, rules-text matching, a card-ID branch or bypassed commit semantics, stop and describe that missing contract. Do not pad a vertical slice with unused extension hooks.

## Alternatives considered

Continuing engine breadth would deepen the consumer gap. Rebuilding transport/state would introduce overhead without demonstrating a playable turn. The selected approach follows existing interactions and makes the smallest coherent changes needed to finish them.
