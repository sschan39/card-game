# Multiplayer Room Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract multiplayer room/application lifecycle from `src/server.ts` into a directly
testable runtime while preserving every existing Socket.IO event, payload, ordering rule, game
setup step, reconnect decision, and gameplay outcome.

**Architecture:** Add one `RoomRuntime` beside the existing cohesive server-side store, reconnect,
and synchronization modules. The runtime owns stateful multiplayer coordination and exposes typed
use-case methods; `server.ts` remains the Socket.IO composition/translation adapter. Two narrow
callbacks carry delta-publication and room-destruction requests outward without exposing Socket.IO
to the runtime.

**Tech Stack:** TypeScript 6, Node.js, Socket.IO 4, Vitest 4, existing `GameEngine`, existing
`InMemoryStore` / reconnect helpers / `SyncService`.

## Global Constraints

- Preserve gameplay, cards, commands, event names and payloads, event order, reconnect policy,
  security behavior, RPS/game setup, mutation order, persistence timing, and delta filtering.
- Keep `StateStore`, reconnect helpers, and `SyncService` behavior intact; do not move or redesign
  them for directory appearance.
- Do not split `GameRoom`, add deterministic runtime infrastructure, or change ID/randomness
  behavior in this slice.
- Do not import Socket.IO, Express, HTTP, or transport event names in `room-runtime.ts`.
- Use test-first red/green cycles for every production API and commit each task separately.
- Keep the existing live-routing test as the authoritative transport compatibility suite.

---

### Task 1: Extract room lifecycle ownership

**Files:**
- Create: `src/server/room-runtime.ts`
- Create: `tests/server/room-runtime.test.ts`

**Interfaces:**
- Consumes: `StateStore`, `GameEngine`, `OptionService`, room-factory functions, and the existing
  reconnect helpers.
- Produces:

```ts
export interface RoomDeltaRequest {
  oldState: GameRoom;
  room: GameRoom;
  mutations: GameMutation[];
  action: string;
  playerId: PlayerId;
  batches: AppliedEventBatch[];
  recipients: ReadonlyMap<PlayerId, string>;
}

export interface RoomDestroyedNotice {
  roomId: string;
  socketIds: string[];
}

export interface RoomRuntimePorts {
  publishDelta(request: RoomDeltaRequest): void;
  roomDestroyed(notice: RoomDestroyedNotice): void;
}

export type ConnectResult =
  | { kind: 'no_rejoin' }
  | { kind: 'rejoined'; roomId: string; playerId: PlayerId; room: GameRoom }
  | { kind: 'rejoin_failed'; reason: 'room_destroyed' | 'not_a_member' };

export type JoinRoomResult =
  | { kind: 'not_found' }
  | { kind: 'full' }
  | { kind: 'joined'; roomId: string; playerId: PlayerId; room: GameRoom };

export class RoomRuntime {
  constructor(store: StateStore, ports: RoomRuntimePorts, gracePeriodMs?: number);
  connect(socketId: string, authPlayerId?: PlayerId, authRoomId?: string | null): ConnectResult;
  createRoom(socketId: string, authPlayerId?: PlayerId):
    { roomId: string; playerId: PlayerId; room: GameRoom };
  joinRoom(socketId: string, authPlayerId: PlayerId | undefined, roomId: string): JoinRoomResult;
  getOptions(socketId: string, roomId: string, cardUuid: string,
    zone: 'hand' | 'battlefield'): ActionOption[];
  disconnect(socketId: string): void;
  dispose(): void;
}
```

- [ ] **Step 1: Write lifecycle tests against the wished-for runtime API**

Create `tests/server/room-runtime.test.ts`. Use a real `InMemoryStore`, real room setup, fake port
functions, and fake timers. The first tests must prove:

```ts
const runtime = new RoomRuntime(store, ports);
const created = runtime.createRoom('socket-1', 'player-1');
expect(store.getRoom(created.roomId)).toBe(created.room);

const joined = runtime.joinRoom('socket-2', 'player-2', created.roomId);
expect(joined.kind).toBe('joined');
if (joined.kind === 'joined') {
  expect(joined.room.status).toBe('RPS');
  expect(joined.room.players['player-1'].hand.map(card => card.blueprint.id).sort())
    .toEqual(['paper', 'rock', 'scissors']);
}
```

Add separate assertions for not-found/full joins, valid/invalid rejoin, option queries, immediate
unjoined-room destruction, 30-second delayed destruction with fake timers, rejoin cancellation,
recipient socket ids, engine replacement disposal, and idempotent `dispose()` cleanup.

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts
```

Expected: FAIL because `src/server/room-runtime.ts` does not exist.

- [ ] **Step 3: Implement the minimal lifecycle runtime**

Create `src/server/room-runtime.ts` with private maps for engines, socket room membership, and
destroy timers. Preserve the existing helper order:

```ts
private replaceRoomEngine(room: GameRoom): GameEngine {
  this.engines.get(room.roomId)?.dispose();
  const engine = new GameEngine(room);
  engine.initRoom();
  this.engines.set(room.roomId, engine);
  return engine;
}

private destroyRoom(roomId: string): void {
  this.cancelScheduledDestroy(roomId);
  const room = this.store.getRoom(roomId);
  const engine = this.engines.get(roomId);
  if (engine) {
    engine.dispose();
    this.engines.delete(roomId);
  }
  this.store.deleteRoom(roomId);
  if (room) {
    const socketIds = [room.player1Id, room.player2Id]
      .filter((id): id is PlayerId => id !== null && id !== undefined)
      .map(playerId => resolveSocketId(this.identity, playerId));
    this.ports.roomDestroyed({ roomId, socketIds });
    unbindRoom(this.identity, room);
    socketIds.forEach(socketId => this.roomIdBySocket.delete(socketId));
  }
}
```

`joinRoom` must retain the current sequence: mutate/store the joined room, replace the engine,
call `setupRPS`, commit `SET_STATUS`, drain setup batches, then store and return `engine.roomState`.
`disconnect` must resolve the stable player before unbinding and preserve the immediate-versus-
grace policy. `dispose` must clear all timers, dispose all retained engines, and clear both maps.

- [ ] **Step 4: Run focused lifecycle and existing helper tests**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts tests/server/state-store.test.ts tests/server/reconnect.test.ts
```

Expected: all tests pass with no open handles.

- [ ] **Step 5: Run server typecheck and whitespace validation**

Run:

```powershell
npm run typecheck:server
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit lifecycle extraction**

```powershell
git add -- src/server/room-runtime.ts tests/server/room-runtime.test.ts
git commit -m "refactor: extract multiplayer room lifecycle"
```

---

### Task 2: Move command and synchronization coordination into the runtime

**Files:**
- Modify: `src/server/action-packet.ts`
- Modify: `src/server/room-runtime.ts`
- Modify: `tests/server/action-packet.test.ts`
- Modify: `tests/server/room-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 `RoomRuntime`, existing `GameEngine.executePlayerAction`, RPS setup helpers, and
  the existing flat action packet contract.
- Produces:

```ts
export interface ActionPacket {
  roomId: string;
  actionId: string;
  commandId?: string;
  data: ActionData;
}

export type PlayerActionRuntimeResult =
  | { kind: 'error'; message: string; commandId: string; action: string }
  | { kind: 'success'; commandId: string; action: string; snapshot?: GameRoom };

executePlayerAction(socketId: string, packet: ActionPacket): PlayerActionRuntimeResult;
```

- [ ] **Step 1: Add failing command tests**

Extend `tests/server/room-runtime.test.ts` to create/join a room and submit each player's real RPS
card through `executePlayerAction`. Assert:

```ts
expect(first.kind).toBe('success');
expect(second).toMatchObject({ kind: 'success', snapshot: { status: 'playing' } });
expect(store.getRoom(roomId)?.status).toBe('playing');
expect(published.at(-1)).toMatchObject({ action: ACTION_IDS.rpsPlay, playerId: 'player-2' });
expect(published.at(-1)?.room).toBe(store.getRoom(roomId));
```

Add independent tests for a missing room error, an engine validation error, caller-supplied
`commandId`, generated command ids, no publication on failure, and recipients resolving to current
socket ids. Extend `action-packet.test.ts` with a compile/runtime assertion using exported
`ActionPacket` without changing parsing behavior.

- [ ] **Step 2: Run command tests and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts tests/server/action-packet.test.ts
```

Expected: FAIL because `ActionPacket` and `RoomRuntime.executePlayerAction` are not exported.

- [ ] **Step 3: Export the existing packet shape and implement command coordination**

Change only the return annotation in `action-packet.ts` to the named `ActionPacket` interface.
Implement the server's current command sequence in `RoomRuntime.executePlayerAction`:

```ts
const commandId = packet.commandId ?? uuidv4();
const playerId = resolvePlayerId(this.identity, socketId);
const room = this.store.getRoom(packet.roomId);
if (!room) return { kind: 'error', message: 'Room not found', commandId, action: packet.actionId };

const engine = this.getOrCreateEngine(packet.roomId);
const oldState = engine.roomState;
return engine.withCommandContext(packet.actionId, playerId, () => {
  const result = engine.executePlayerAction(playerId, packet.actionId, packet.data);
  if (!result.success) return { kind: 'error', message: result.reason, commandId,
    action: packet.actionId } as const;

  const mutations = [...(result.mutations ?? [])];
  let rpsResolved = false;
  const chosen = engine.roomState;
  if (packet.actionId === ACTION_IDS.rpsPlay && chosen.status === 'RPS' && chosen.player2Id &&
      chosen.rpsState.playedCards[chosen.player1Id] &&
      chosen.rpsState.playedCards[chosen.player2Id]) {
    mutations.push(...engine.applyMutations(resolveRPS(chosen)));
    mutations.push(...engine.applyMutations(buildStartingCardMutations(engine.roomState)));
    mutations.push(...engine.advancePhase('complete'));
    rpsResolved = true;
  }

  const currentRoom = engine.roomState;
  this.store.saveRoom(currentRoom);
  const batches = engine.drainEventBatches();
  if (mutations.length > 0) this.ports.publishDelta({
    oldState, room: currentRoom, mutations, action: packet.actionId, playerId, batches,
    recipients: this.recipients(currentRoom),
  });
  return { kind: 'success', commandId, action: packet.actionId,
    ...(rpsResolved ? { snapshot: currentRoom } : {}) } as const;
}, commandId);
```

Pass `RoomDeltaRequest.recipients` as a new `Map` built from the current room's player ids and the
identity resolver. Drain event batches even when a successful command produced no mutations, as
the current eager `syncAfter(...)` argument evaluation does.

- [ ] **Step 4: Run focused command, room, RPS, and engine cleanup tests**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts tests/server/action-packet.test.ts tests/engine/rps-play-handler.test.ts tests/engine/engine-cleanup.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck and whitespace validation**

Run:

```powershell
npm run typecheck:server
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit command coordination**

```powershell
git add -- src/server/action-packet.ts src/server/room-runtime.ts tests/server/action-packet.test.ts tests/server/room-runtime.test.ts
git commit -m "refactor: move room commands into runtime"
```

---

### Task 3: Reduce `server.ts` to a transport adapter

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/architecture/import-graph.ts`
- Modify: `tests/architecture/import-boundaries.test.ts`
- Modify: `docs/architecture-import-policy.md`
- Test: `tests/server/live-routing.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 `RoomRuntime`, its typed outcomes/ports, existing `SyncService`, and
  `parseActionPacket`.
- Produces: a transport entry point with no direct `src/engine/**` imports and unchanged exported
  `{ app, server, io }`.

- [ ] **Step 1: Add a failing entry-point architecture policy**

Extend `ArchitecturePolicyViolations` with `transportEntryToEngine: string[]`. Populate it from all
imports whose source is exactly `src/server.ts` and target starts with `src/engine/`. Extend the
fixture test with a direct entry-point-to-engine edge, and add this repository assertion:

```ts
it('keeps the Socket.IO entry point behind the room runtime', () => {
  expect(policy.transportEntryToEngine,
    `Transport entry-point engine imports:\n${policy.transportEntryToEngine.join('\n')}`)
    .toEqual([]);
});
```

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```powershell
npm run test:architecture
```

Expected: FAIL listing the current `src/server.ts` imports of `GameEngine`, `OptionService`, and
`room-factory.ts`.

- [ ] **Step 3: Rewire the server entry point**

Construct one runtime with the existing store and these adapters:

```ts
const runtime = new RoomRuntime(new InMemoryStore(), {
  publishDelta: request => {
    const delta = syncService.buildDelta(request.oldState, request.mutations, {
      action: request.action, playerId: request.playerId, batches: request.batches,
    });
    syncService.broadcast(delta, request.room,
      playerId => request.recipients.get(playerId) ?? playerId);
  },
  roomDestroyed: ({ roomId, socketIds }) => {
    socketIds.forEach(socketId => io.to(socketId).emit('roomDestroyed', { roomId }));
  },
});
```

Replace each callback body with decode → runtime call → unchanged emissions. Preserve join emission
order and player-action error payloads. Call `runtime.dispose()` from the HTTP server's `close`
handler. Remove all engine, room-factory, option-service, reconnect, timer, state-map, and untyped
socket-room-property code from `server.ts`.

- [ ] **Step 4: Run architecture and focused non-network tests**

Run:

```powershell
npm run test:architecture
npx vitest run --pool=threads --maxWorkers=1 tests/server --exclude tests/server/live-routing.test.ts
npm run typecheck:server
```

Expected: all pass.

- [ ] **Step 5: Run the real Socket.IO compatibility suite**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
```

Expected: 49 tests pass, including rejoin, room destruction, RPS setup, options, packet rejection,
delta convergence, and final server cleanup.

- [ ] **Step 6: Commit the transport boundary**

```powershell
git add -- src/server.ts tests/architecture/import-graph.ts tests/architecture/import-boundaries.test.ts docs/architecture-import-policy.md
git commit -m "refactor: isolate socket transport from room runtime"
```

---

### Task 4: Document and verify Slice 6

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**
- Consumes: the committed runtime and transport boundary from Tasks 1-3.
- Produces: current architecture documentation and a fully verified, review-ready Slice 6.

- [ ] **Step 1: Update current documentation**

Document `RoomRuntime` ownership and the flow:

```text
Socket.IO callback → RoomRuntime use case → GameEngine → StateStore / delta publication port
```

In the audit, preserve the original overloaded-server finding and append its Slice 6 resolution.
Mark recommendation 5 and roadmap Slice 6 complete. Do not claim `GameRoom` separation,
deterministic dependencies, or `SyncService` redesign.

- [ ] **Step 2: Run the complete non-live suite**

```powershell
npx vitest run --pool=threads --maxWorkers=1 --exclude tests/server/live-routing.test.ts
```

Expected: every non-live test passes, including architecture and new room-runtime tests.

- [ ] **Step 3: Run the complete live suite**

```powershell
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
```

Expected: all 49 tests pass.

- [ ] **Step 4: Run static and build gates**

```powershell
npm run test:architecture
npm run typecheck:server
npm run typecheck:client
npm run build
git diff --check
```

Expected: every command exits 0. The existing Node 22.10/Vite version warning may remain while the
build succeeds.

- [ ] **Step 5: Request independent code review**

Review the Slice 6 commit range against the design and plan. Require inspection of ownership,
resource cleanup, exact event/payload compatibility, timer/reconnect behavior, command context,
RPS sequencing, persistence, delta recipients, test strength, and architecture-policy scope. Fix
all Critical and Important findings with focused tests before proceeding.

- [ ] **Step 6: Commit documentation**

```powershell
git add -- ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record multiplayer runtime boundary"
```

- [ ] **Step 7: Verify the committed state and pause**

Repeat the complete non-live suite, live suite, both typechecks, production build, architecture
gate, `git diff --check`, and `git status --short`. Confirm a clean working tree, report Slice 6 as
6/9 complete, identify Slice 7 as deterministic runtime dependencies, keep the branch as-is, and
pause the standing goal.
