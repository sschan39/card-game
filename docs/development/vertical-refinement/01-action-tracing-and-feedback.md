# V1 — Action tracing and visible feedback

Status: implemented and verified on 13 October 2026 after the owner selected V1 as the active goal. Planning baseline `8798da1`; implementation baseline `531e5e1`. [Vertical plan](README.md).

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

Actual compatible signature: `withCommandContext<T>(action: string, playerId: PlayerId, operation: () => T, commandId?: string): T`. A nonempty tracing ID affects logs only; never use it as a card/stack identity, permission, ordering or retry key. Existing `StateDelta.commandId` already transports the correlation ID. No new normal-success socket event was added. `parseActionPacket` omits malformed tracing metadata without forwarding it to rule data.

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

- [x] Add focused cases in `tests/server/action-packet.test.ts` and `tests/shared/game-logger.test.ts`: tracing metadata is separated from rule data; existing packets still work; inherited command context reaches sinks.
- [x] Add a socket case in `tests/server/live-routing.test.ts`: one successful action's supplied commandId reaches its delta, and a rejected action's ID/reason reaches the existing error channel. A rejection publishes no fabricated success delta.
- [x] Add client cases in `tests/client/gameStore.test.ts` and new `tests/client/action-feedback.test.ts`: delta log retains commandId; error text renders in App on start and game screens; dismissing clears only the message. Use the existing callback/static-render testing approach.
- [x] Extend the existing seams listed above; broaden `setError` to accept `string | null` for dismissal. Keep packet metadata out of saved rule continuations. Do not introduce another socket singleton or sender abstraction.
- [x] Verify local targeting cancellation sends no player command; server-choice cancellation does send the existing `choose` action and is logged accordingly. Log targeting begin/cancel at the existing store methods, without inventing a target command.
- [x] Run focused Vitest files with two workers and both existing typechecks. In two browser sessions, create/join a room, perform a normal action, provoke one clear rejection, dismiss it and retry successfully. Inspect the console/server trace by one commandId.
- [x] Update `docs/logging.md` and this document with actual signatures/evidence, then commit the item. No unrelated rule or cleanup changes.

Commands: `npm run typecheck:server`, `npm run typecheck:client`, and `node node_modules/vitest/vitest.mjs run tests/server/action-packet.test.ts tests/shared/game-logger.test.ts tests/client/gameStore.test.ts tests/client/action-feedback.test.ts tests/server/live-routing.test.ts --config vitest.config.mts --maxWorkers 2`. Use the bundled runtime if shell Node/npm does not meet the project's existing requirement.

## Acceptance and stop boundary

One ID joins the frontend send, backend decision and applied result/rejection. Both screens converge on accepted state. A rejected action remains recoverable and visibly explains its cause. Detailed logging can be turned on centrally without changing call sites.

Stop if tracing starts controlling gameplay, requires a parallel event/transport framework, or changes reducer/target/payment semantics. This item adds visibility to existing behavior.

## Implemented contracts and evidence

The existing hook generates each ID; server receipt, engine outcome and sync publication retain single ownership. Existing error messages carry optional action/commandId. `setError(string | null)` supports dismissal and new user attempts clear the previous message. The existing store logs snapshot/delta application, preserves IDs and produces UI-only summaries; `PHASE_LABELS` moved from PhaseBar to shared turn utilities so both displays use one vocabulary. Wrapped full-width summaries fix the overflow seen in the actual sidebar.

`tests/server/action-packet.test.ts` proves metadata separation and legacy packets. `tests/client/action-feedback.test.ts` proves both error screens/dismissal, generated hook IDs, choice summaries, readable phases, local target cancellation and the central toggle. `tests/client/socket-feedback.test.ts` proves a rejected action remains visible with traces off and transport failures still report errors. `tests/shared/game-logger.test.ts` exercises inherited sink context and disabled engine rejection tracing. The new actual-server case opens a choice with the supplied ID on both clients, rejects a foreign answer without a delta, then cancels with another ID; saved rule data contains no tracing field.

Initial feature tests reproduced seven missing frontend/parser behaviors plus the actual-server ID mismatch. The review's two disabled-tracing failures and the phase-name readability failure were reproduced before correction. Historical terminal-error assertions now require the extended metadata while retaining the same rejection and final-state checks.

Final suite: 1021 tests in 78 files, including 38 actual-server scenarios, with two workers. Both typechecks and server/client production build passed. Final independent review found no remaining important or critical issues. The final built client was reloaded in both browser sessions and the ordinary phase transition checked again.

Browser transcript (two independent IAB sessions, built client at localhost:3000):

1. Session A submitted nonexistent room `v1-missing-room`: visible "Room not found" banner; Dismiss removed it; Create New Room succeeded.
2. Session B joined room `7d303970-c503-4bd5-8fe3-a16c858181cc`; both chose Rock through visible hand controls and received matching game/phase state.
3. B clicked a creature outside its sorcery window: visible explanatory banner, matching frontend send/rejection and backend receipt/rejection ID `bc1446da-2697-441b-a7c7-e3be5735778c`. No success log entry/state delta was fabricated for the rejected action.
4. After dismissal, A/B used ordinary Pass Priority controls. Command `5781ff4e-0c15-4817-8c83-2456514c6701` matched A's send, both clients' delta application and the server trace. Both screens advanced from upkeep to draw, then main.
5. Both tabs reloaded and rejoined the same room/board/phase, then continued ordinary passes. Screenshot inspection reproduced the sidebar overflow before its CSS correction and verified wrapped summaries afterward. No private React callbacks, injected room state, debug resolve or debug end-turn were used for this acceptance flow.
6. The final build reloaded in both sessions; ordinary passes reached Beginning of Combat. The phase bar and readable GameLog summary agreed on both screens with command ID `5771e77d-d8be-4ec3-9ee4-116ebfe2ed8d`. The two local views remain open for inspection; frontend recent logs are intentionally session-local.

This completes V1 visibility only. Land routing and richer playable consumers remain the following vertical items.
