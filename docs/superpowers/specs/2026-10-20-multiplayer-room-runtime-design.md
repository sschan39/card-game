# Multiplayer room runtime design

Date: 20 October 2026
Status: approved under the standing behavior-preserving architecture instruction

## Problem

`src/server.ts` is both the Socket.IO adapter and the owner of multiplayer application state. It
creates and replaces `GameEngine` instances, stores rooms, maps stable players to sockets, manages
destruction timers, performs room setup, completes RPS, executes commands, persists state, and
coordinates synchronization. Those responsibilities are individually coherent, but their current
composition is only testable by starting the real network server.

The engine is already independent of networking, and `state-store.ts`, `reconnect.ts`, and
`sync-service.ts` are cohesive and tested. This slice should preserve those subsystems and extract
only the missing application coordinator. It must not reorganize working rules code to match a
diagram.

## Goals

- Make room and match lifecycle testable without Express or Socket.IO.
- Give one application service ownership of room storage, per-room engines, identity maps,
  destruction timers, room creation/join/rejoin/disconnect, RPS setup/completion, command
  execution, persistence, and option queries.
- Leave `src/server.ts` responsible for HTTP/Socket.IO bootstrap, transport input decoding, socket
  room membership, and exact event emission.
- Preserve all event names, payloads, ordering, reconnect decisions, 30-second grace period,
  command errors, RPS/game setup, persistence timing, delta publication, and engine disposal.
- Keep the runtime independent of Socket.IO through narrow callback ports.
- Add a static check that the Socket.IO entry point no longer imports engine modules directly.

## Non-goals

- No gameplay, card, command, event-contract, security, authentication, hidden-information, or UI
  changes.
- No `GameRoom` split; that remains evidence-dependent follow-up work.
- No deterministic ID/randomness context; that is Slice 7.
- No redesign or relocation of the cohesive state store, reconnect helpers, or synchronization
  service.
- No generic command bus, workflow engine, dependency-injection container, repository framework,
  or transport event abstraction.
- No change to `SyncService` filtering, logging, replay, or sequence behavior.

## Considered approaches

### 1. Focused runtime beside existing server modules — selected

Add `src/server/room-runtime.ts`. A `RoomRuntime` class encapsulates the application resources that
currently live as module globals in `server.ts`. It uses the existing `StateStore`, reconnect
helpers, `GameEngine`, room factory, and `OptionService` directly. Two injected callbacks describe
the only outward effects: publish a committed delta request and notify recipients that a room was
destroyed.

This creates a testable application boundary while leaving already cohesive modules and paths
alone. The directory still contains both the transport entry point and server-side application
modules, but ownership is explicit at the file/API level and dependency direction is improved
without relocation churn.

### 2. Move store, reconnect, and runtime into `src/multiplayer/`

This would make the conceptual layer visible in the directory tree, but it would move two
well-separated, well-tested modules and add compatibility exports solely for appearance. It does
not improve the runtime API or behavior over approach 1, so it is deferred unless future
multiplayer growth creates a real package boundary.

### 3. Generic transport-command/event framework

A framework could return a list of abstract emission instructions for every socket event. That
would replace straightforward Socket.IO callbacks with a second protocol and make event ordering
harder to trace. The server has one transport, so explicit typed outcomes are smaller and clearer.

## Runtime boundary

`RoomRuntime` owns:

- the `StateStore` reference;
- the per-room `GameEngine` map and engine replacement/recovery;
- the existing stable-player/socket identity maps;
- socket-to-room membership needed for disconnect handling;
- room destruction timers and the 30-second grace policy;
- room creation, join validation, RPS setup, rejoin decisions, and disconnect policy;
- player command execution, RPS completion, room persistence, and event-batch draining;
- card option queries;
- complete disposal of timers and engines.

It does not own sockets, Socket.IO rooms, event names, callbacks, Express, HTTP, or static files.

The constructor accepts the existing `StateStore` plus two narrow ports:

```ts
interface RoomRuntimePorts {
  publishDelta(request: RoomDeltaRequest): void;
  roomDestroyed(notice: RoomDestroyedNotice): void;
}
```

`RoomDeltaRequest` carries the old snapshot, current room, ordered mutations, command/action
metadata, drained event batches, and current player-to-socket recipients. The server adapter uses
the unchanged `SyncService` to build and broadcast the delta. `RoomDestroyedNotice` carries the
room id and resolved recipient socket ids; the adapter emits the existing `roomDestroyed` event.
Neither port exposes a Socket.IO type to the runtime.

## Use-case API

The transport calls explicit methods:

- `connect(socketId, authPlayerId, authRoomId)` returns no-op, rejoined, or rejoin-failed.
- `createRoom(socketId, authPlayerId)` returns the created room and stable player identity.
- `joinRoom(socketId, authPlayerId, roomId)` returns not-found, full, or joined with the prepared
  RPS snapshot.
- `executePlayerAction(socketId, packet)` returns an error payload or success, optionally with the
  post-RPS snapshot that must follow delta publication.
- `getOptions(socketId, roomId, cardUuid, zone)` returns the existing option list or `[]`.
- `disconnect(socketId)` unbinds the socket and applies the existing immediate/grace destruction
  policy.
- `dispose()` cancels every timer and disposes every retained engine exactly once.

Outcomes contain application data, not transport event names. `server.ts` maps them to the exact
existing emissions.

## Data and event flow

### Connect/rejoin

The transport decodes handshake auth, then calls `connect`. On a valid membership, the runtime
binds the new socket, records room membership, cancels pending destruction, and restores the room
engine if necessary. The transport joins the Socket.IO room and emits `rejoined` followed by
`roomSnapshot`. Invalid membership emits the unchanged `rejoinFailed` reason.

### Create/join

Creation binds identity, creates and stores the room, and initializes its engine. Joining first
performs the existing not-found/full checks, then binds identity, applies `joinRoom` and
`setupRPS`, replaces the engine, commits `SET_STATUS`, drains setup batches, and stores the
authoritative engine snapshot. The transport preserves the current `roomJoined`, `playerJoined`,
`startGame`, `rpsPhase`, and `roomSnapshot` order.

### Player command

The transport alone parses the flat packet. The runtime resolves the stable player, preserves the
existing command id behavior and logging context, executes the command through `GameEngine`, and
returns the same validation error when rejected. On success it performs the existing RPS
completion sequence when required, saves the current room, and invokes `publishDelta` only when
mutations exist. The adapter builds and broadcasts through `SyncService`; an RPS-completion
snapshot is emitted afterward exactly as today.

### Disconnect/destruction

The runtime records socket room membership instead of attaching an untyped `roomId` property to
the Socket.IO socket. Disconnect resolves the player before unbinding. A room with no other player
is destroyed immediately; a room with another player is scheduled for the unchanged 30-second
grace period in both pre-game and in-game states. Rejoin cancels that timer. Destruction is
idempotent, disposes the engine, deletes state, requests notifications for current recipients, and
removes room identity bindings.

## Error behavior

- Invalid player-action packet shape remains a transport error before the runtime call.
- Missing action rooms return the same `{ message: 'Room not found', commandId, action }` data.
- Engine rejections preserve the engine reason, command id, and action.
- Missing join rooms emit `error` with `Room not found`; full rooms emit `roomFull`.
- Invalid option input is decoded to no query and continues to produce `[]` through both callback
  and `optionsForCard` emission.
- Runtime recovery of a missing room engine follows the same initialization path as creation and
  join; a truly missing room remains an error.

## Testing

Add `tests/server/room-runtime.test.ts` using the real `GameEngine`, room factory, and in-memory
store without opening a socket. Tests cover:

- create/join ownership and the prepared RPS snapshot;
- engine replacement/disposal;
- command persistence, delta requests, and RPS completion;
- reconnect identity and timer cancellation;
- immediate and delayed destruction plus notification recipients;
- option queries and disposal cleanup;
- not-found/full/error outcomes.

The existing `live-routing.test.ts` remains the authoritative compatibility test for exact socket
events, payloads, ordering, reconnect behavior, game flow, and cleanup. The architecture test adds
an entry-point rule: `src/server.ts` has no direct imports under `src/engine/**`. All existing
non-live tests, live routing tests, both typechecks, and the production build must pass.

## Documentation

Update `ARCHITECTURE.md` and `docs/MAP.md` to describe the transport-to-runtime-to-engine flow.
Preserve the historical audit finding while marking the recommended extraction complete, and mark
Slice 6 complete in the modernization roadmap. Do not claim that room/game state has been split or
that synchronization internals were redesigned.
