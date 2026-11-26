# Orphaned room bug report: an account can be locked out of its own room

Reported November 26, 2026. Not fixed.

## Summary

An account reserves exactly one room at a time. The reservation is enforced by
`AuthService.assertRoomAvailable`, which throws `409 This account already has a room. Leave it
before joining another.` whenever the account holds a seat in a room that still exists.

The reservation is released in only two ways: the room is destroyed, or the account sends
`leaveRoom` naming the room. Both require the client to know the **room id**. Nothing in the
API lets an account ask which room it holds, and the room id is only ever delivered to the
socket that created or joined the room. If that socket is gone and the id was not persisted
client-side, the account holds a room it cannot name, cannot leave, and cannot replace.

In the ordinary case this is a self-healing annoyance: the room is destroyed 30 seconds after
the last socket drops, and the lockout clears on its own. But the destroy timer is only ever
armed from `disconnect` and `leaveRoom`. A room re-created by `restoreMatches` after a server
restart is never armed, so **the lockout is permanent** in that path. This was reproduced.

| Fact | Verified |
|---|---|
| Lockout after a socket drop, no restart | Clears in **~30–40 s** |
| Lockout after a server restart | **Never clears** (observed 85 s, then still held) |
| Room destroyed while the opponent is still connected | **Yes**, 30 s after one seat drops |
| API to list an account's rooms | **None** — `GET /api/rooms` → `404` |
| API to leave a room without naming it | **None** |
| Recovery if the room id is known | Works — `leaveRoom` frees the seat immediately |
| Rooms persisted across restart | Only as `active_matches` / `match_seats`; no `rooms` table |

## Priority

High. It is a permanent, unrecoverable lockout of a paying account's only game slot, reachable
by an ordinary sequence of events (play a match, restart the server, come back). The account
cannot create a room, cannot join a room, and the UI offers no control that would fix it. The
only escape is to know the room id and send `leaveRoom` by hand, or to register a new account.

The bounded variant is Medium: a 30-second dead window after any tab close, during which the
player sees `An active room is open in another tab.` with both Create and Join disabled and no
tab actually open.

## Reproduce

The permanent variant needs a server restart while a match is live.

```powershell
# 1. Start the server and create a live match between two accounts.
node apps/server/dist/index.js
node tem/repro-restart-setup.mjs          # writes tem/restart-state.json

# 2. Kill the server before the 30s grace timer fires.
Stop-Process -Id (Get-Process node).Id -Force

# 3. Confirm the match survived in SQLite.
Copy-Item tem/inspect-db.mjs apps/server/inspect-db.mjs
Push-Location apps/server
(Get-Content inspect-db.mjs) -replace 'data/card-game.sqlite', '../../data/card-game.sqlite' | Set-Content inspect-db.mjs
node inspect-db.mjs                        # active_matches -> 1 rows, match_seats -> 2 rows
Remove-Item inspect-db.mjs; Pop-Location

# 4. Restart and probe the host account.
node apps/server/dist/index.js
node tem/repro-restart-probe.mjs
```

The bounded variant needs no restart:

```powershell
node tem/repro-lockout-duration.mjs        # CASE A: solo room, CASE B: opponent still connected
```

## Observed

### The permanent variant: a restored room is never destroyed

`repro-restart-probe.mjs` signs in as the host of the restored room and does **not** know the
room id, exactly as a returning browser would not.

```
restored room: 236cdf48-1ff9-446e-8f03-4a94d2495158
createRoom after restart -> {"ok":false,"message":"This account already has a room. Leave it before joining another."}
resume -> {"protocolVersion":1,"sessionId":"0815a3b8-...","roomId":"236cdf48-...","playerId":"account:5324663f-..."}
  +20s -> createRoom: {"ok":false,"message":"This account already has a room. Leave it before joining another."}
  +20s -> createRoom: {"ok":false,"message":"This account already has a room. Leave it before joining another."}
```

The probe was then left running past the 30-second grace window and the database was inspected
again: `active_matches -> 1 rows`, `match_seats -> 2 rows`, unchanged. The room is alive, the
seat is held, and no timer exists that would ever release it.

Note the `resume` line. `GET /api/rooms/:roomId/resume` succeeds and returns the room id — but
only because the probe already had the id from `tem/restart-state.json`. A real client that
lost its `sessionStorage` has no way to reach this endpoint.

### The bounded variant: 30 seconds of dead time after any tab close

`repro-lockout-duration.mjs` opens a room, drops the socket, and polls `createRoom`:

| Case | +5 s | +20 s | +25 s | Cleared at |
|---|---|---|---|---|
| A — solo room, socket dropped | locked | locked | — | **~40 s** |
| B — two seats, host dropped, guest connected | locked | locked | locked | **~45 s** |

The extra 5–15 s over the 30-second grace period is the polling interval plus the time for the
destroy to propagate. The lockout is real but self-healing.

### The room is destroyed even though the opponent is still connected

`repro-opponent-destroy.mjs` and `repro-live-match-destroy.mjs` both hold a second socket open
and watch for `roomDestroyed`:

```
room: a458e3cc-... | match started: true
+40s -> roomDestroyed: YES | guest connected: true
```

The guest's next `requestRoomSnapshot` times out. The server log shows the sequence plainly:

```
room:destroy:scheduled  room a458e3cc-... scheduled for destruction in 30000ms
room:destroyed          room destroyed: a458e3cc-...
```

`disconnect` arms the timer without checking whether the other seat still has a live socket:

```ts
// apps/server/src/rooms/room-runtime.ts:449-458
const otherPlayerId = room.player1Id === playerId ? room.player2Id : room.player1Id;
if (!otherPlayerId && !preserveSeat) this.destroyRoom(roomId);
else if (!this.operatorTestRooms.has(roomId)) this.scheduleDestroy(roomId);
```

The `else if` branch is taken whenever a second seat exists, regardless of whether that seat is
connected. A player who closes one tab therefore kills the match for the player who is still
sitting in it.

### There is no way to ask which room an account holds

```
GET /api/rooms              -> 404 {"protocolVersion":1,"message":"API route not found."}
GET /api/auth/session       -> 404 {"protocolVersion":1,"message":"API route not found."}
GET /api/rooms/<id>/resume  -> 200 (requires the id)
```

The only room route is `resume`, and it is keyed by the id the client is missing. The platform
response does carry a boolean — `browser-routes.ts:47` sets `accountHasRoom: true` — but a
boolean is not an identifier. `StartScreen.tsx:83` turns it into a disabled button:

```ts
const blockReason = accountHasRoom ? 'An active room is open in another tab.' : lobbyBlockReason(...);
```

`Home.tsx` can render a resume link, but only from `sessionStorage`, which is per-tab and is
lost when the tab closes. That is precisely the situation that produces the orphan.

### Recovery works, if the id is known

`repro-recovery.mjs` rejoins the restored room by id and leaves it:

```
sessionReady -> {"roomId":"236cdf48-1ff9-446e-8f03-4a94d2495158", ...}
leaveRoom -> {"ok":true,"m":{"protocolVersion":1,"roomId":"236cdf48-..."}}
createRoom after recovery -> {"ok":true,"roomId":"d8979990-9804-44b4-834b-abe5e9cd3025"}
```

So the seat is not corrupt and the room is not wedged. The only missing piece is the id.

## Root cause

Two independent defects compound.

**1. The reservation outlives the information needed to release it.** `accountHasRoom` is
derived from persisted seats, but the room id is delivered only over the socket that created
the room and is never exposed through an account-scoped endpoint:

```ts
// apps/server/src/auth/service.ts:80-84
private assertAccountRoomAvailable(accountId: string, roomId?: string): void {
  if (this.accountHasRoom(accountId, roomId)) throw new AuthError(409, 'This account already has a room. Leave it before joining another.');
}
accountHasRoom(accountId: string, exceptRoomId?: string): boolean {
  return this.repository.accountSeats(accountId).some(seat => seat.roomId !== exceptRoomId && !!this.rooms.getRoom(seat.roomId));
}
```

The check is correct. The problem is that the client is told *that* it holds a room and never
*which* one, so it cannot satisfy the `exceptRoomId` escape hatch or send `leaveRoom`.

**2. `restoreMatches` re-creates rooms without arming a destroy timer.** Every other path that
leaves a room with no live socket calls `scheduleDestroy`. Recovery does not:

```ts
// apps/server/src/rooms/room-runtime.ts:147-165
restoreMatches(restoreSeq: (roomId: string, seq: number) => void): void {
  if (!this.recovery) return;
  for (const match of this.recovery.matches()) {
    try {
      const recovered = recoverMatch(match, this.recovery.matchCommands(match.roomId, match.checkpointOrdinal));
      this.replaceRoomEngine(recovered.room, recovered.lastBatchId);
      this.store.saveRoom(recovered.room);
      this.matchHeads.set(match.roomId, match);
      restoreSeq(match.roomId, match.viewSeq);
      serverLogger.info('match:recovered', 'Restored active match', { roomId: match.roomId, viewSeq: match.viewSeq });
    } catch (error) { /* ... */ }
  }
}
```

There is no `scheduleDestroy` here, and no socket is connected at restore time, so nothing will
ever call it. The room lives until the process exits. Because `destroyRoom` is also what calls
`recovery.deleteMatch`, the `active_matches` row survives too — so the lockout is not merely
per-process, it is re-created on every subsequent restart.

## Mitigation already shipped

`scripts/demo.mjs` works around the bounded variant. If `createRoom` fails with
`/already has a room/i`, it retries with freshly suffixed account names:

```js
if (/already has a room/i.test(message)) {
  console.log('The demo accounts still hold a room this run cannot name; using fresh ones.');
  return openRoom(`${HOST}-${suffix}`, `${GUEST}-${suffix}`);
}
```

This is a workaround for a demo, not a fix. It hides the bug from the demo path and leaves it
in place for real players.

The script also keeps a pointer to the room it opened so the next run can release it. That
pointer originally lived in `tem/`, which is scratch space and gets cleaned — so cleaning
`tem/` was enough to strand a room and force the fallback. It now lives in `data/demo-room.json`
beside the database. This is the bug reproducing itself against its own workaround: any
client-side pointer that is not durable produces an orphan.

## Recommended fix

Any one of these closes the permanent variant; the first two also close the bounded one.

1. **Expose the room id.** Add `roomId` to the platform/session response alongside
   `accountHasRoom`, so the client can render a real resume link or send `leaveRoom` without
   relying on `sessionStorage`. Smallest change, fixes both variants.
2. **Add an account-level leave.** Accept `leaveRoom` with no `roomId` and resolve it from
   `accountSeats(accountId)`. Removes the need for the client to know the id at all.
3. **Do not destroy a room while the other seat is connected.** In `disconnect`, only arm the
   timer when no seat in the room has a live socket. Fixes the opponent-killed-my-match case
   independently of the lockout.
4. **Arm the timer on restore.** In `restoreMatches`, call `scheduleDestroy(match.roomId)` for
   any recovered room with no connected socket, so a restart cannot produce an immortal room.

Recommend 1 and 3 together: 1 makes the lockout recoverable, 3 stops one player's disconnect
from ending the other player's match.
