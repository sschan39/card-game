# V1 — Action tracing and visible feedback

Status: proposed, first execution item. Baseline `8798da1`, 13 October 2026. [Vertical plan](README.md).

## Scope and result

Follow one normal action and one rejection from browser click to backend decision to frontend result. Make start-screen and in-game errors visible and dismissible. Reuse the existing logger and sender; no log collector, dashboard, acknowledgement protocol, retry system or command queue.

## Boundaries

| Module | Change |
|---|---|
| `src/client/hooks/useGameActions.ts` | Log create/join/options sends; generate a tracing commandId once for each playerAction; include it in the existing packet |
| `src/server/action-packet.ts` | Extract optional tracing commandId separately from rule action data; keep existing actor resolution |
| `src/server.ts` | Log receipt; enter the engine command context with that ID; include the same ID/action in existing rejection messages |
| `src/engine/game-engine.ts` | Extend `withCommandContext` with an optional command ID; retain the server-generated default for legacy/internal callers; log a compact accepted/rejected result |
| `src/server/sync-service.ts` | Log published sequence/change count with existing delta.commandId; preserve JSONL/event ownership |
| `src/client/socket.ts` / `store/gameStore.ts` | Log snapshot/reconnect and delta application; retain commandId in existing GameLog entries; log rejected actions with reason |
| `src/client/App.tsx` / `components/GameLog.tsx` | Show dismissible errors on both screens; show concise action/result context instead of only patch count |
| `src/config.ts` / `src/shared/game-logger.ts` | One central `logging.actions` toggle, default true; keep `appliedEvents` for detailed diagnostics; use existing singletons/sinks |

Proposed compatible signature: `withCommandContext<T>(action: string, playerId: PlayerId, operation: () => T, commandId?: string): T`. A nonempty tracing ID affects logs only; never use it as a card/stack identity, permission, ordering or retry key. Existing `StateDelta.commandId` already transports the correlation ID. No new normal-success socket event is necessary.

## Log contract

Normal flow records short IDs, action, source/choice ID where applicable, outcome and reason. Avoid dumping the room or full definitions in the normal trace. Each choice answer is its own command; choiceId connects it with the saved request.

```text
INFO client action:sent        commandId=c1 action=cast_spell cardUuid=s1
INFO server command:received   commandId=c1 action=cast_spell playerId=p1
INFO engine command:accepted   commandId=c1 outcome=choice choiceId=q1 kind=targets
INFO server delta:published    commandId=c1 seq=12 changes=3
INFO client delta:applied      commandId=c1 seq=12 choiceId=q1 stack=0

INFO client action:sent        commandId=c2 action=choose choiceId=q1
WARN engine command:rejected   commandId=c2 reason="Select a legal target"
WARN client action:rejected    commandId=c2 reason="Select a legal target"
```

Server receipt, engine decision and sync publication each have one owner. Info means intent or accepted result; warn means a normal rejected action; error means a runtime/transport failure. Logs must distinguish opening a choice from committing the spell. Start/join requests need room/player context but do not require new command contexts.

GameLog remains a small recent-action view: retain its existing 100-entry policy; add commandId and a brief result summary from the applied room (phase, priority, choice, stack or changed life when relevant). It is not a second semantic event generator and must never feed engine rules.

## First-item execution plan

- [ ] Add focused cases in `tests/server/action-packet.test.ts` and `tests/shared/game-logger.test.ts`: tracing metadata is separated from rule data; existing packets still work; inherited command context reaches sinks.
- [ ] Add a socket case in `tests/server/live-routing.test.ts`: one successful action's supplied commandId reaches its delta, and a rejected action's ID/reason reaches the existing error channel. A rejection publishes no fabricated success delta.
- [ ] Add client cases in `tests/client/gameStore.test.ts` and new `tests/client/action-feedback.test.ts`: delta log retains commandId; error text renders in App on start and game screens; dismissing clears only the message. Use the existing callback/static-render testing approach.
- [ ] Extend the existing seams listed above; broaden `setError` to accept `string | null` for dismissal. Keep packet metadata out of saved rule continuations. Do not introduce another socket singleton or sender abstraction.
- [ ] Verify local targeting cancellation sends no player command; server-choice cancellation does send the existing `choose` action and is logged accordingly. Log targeting begin/cancel at the existing store methods, without inventing a target command.
- [ ] Run focused Vitest files with two workers and both existing typechecks. In two browser sessions, create/join a room, perform a normal action, provoke one clear rejection, dismiss it and retry successfully. Inspect the console/server trace by one commandId.
- [ ] Update `docs/logging.md` and this document with actual signatures/evidence, then commit the item. No unrelated rule or cleanup changes.

Commands: `npm run typecheck:server`, `npm run typecheck:client`, and `node node_modules/vitest/vitest.mjs run tests/server/action-packet.test.ts tests/shared/game-logger.test.ts tests/client/gameStore.test.ts tests/client/action-feedback.test.ts tests/server/live-routing.test.ts --config vitest.config.mts --maxWorkers 2`. Use the bundled runtime if shell Node/npm does not meet the project's existing requirement.

## Acceptance and stop boundary

One ID joins the frontend send, backend decision and applied result/rejection. Both screens converge on accepted state. A rejected action remains recoverable and visibly explains its cause. Detailed logging can be turned on centrally without changing call sites.

Stop if tracing starts controlling gameplay, requires a parallel event/transport framework, or changes reducer/target/payment semantics. This item adds visibility to existing behavior.
