# lab/fuzz/

**Status:** empty. Planned in Phase 5.

Python Socket.IO client that speaks the protocol directly, because ZAP and Burp do not.

## Belongs here

- `requirements.txt` — `python-socketio[client]`, `requests`, `rich`
- `client.py` — authenticated connection helper (reuses Phase 1 login)
- `cases/` — one module per test case
- `run.py` — runner that emits JSON results

## Test cases

From the plan (Phase 5):

1. Malformed `actionId` values and unknown action names
2. `roomId` for a room the account never joined (IDOR)
3. Oversized payloads and deeply nested `data` objects
4. Rapid-fire actions (rate limiting, engine stability)
5. Replayed packet with a substituted `playerId`
6. Actions sent out of turn / without priority
7. `getOptions` for a card in another player's hand

## Output contract

Each case emits: case id, target, request summary, response summary, verdict
(`vulnerable` / `blocked` / `inconclusive`), and a timestamp. The runner writes one JSON file
per run so baseline and re-scan can be diffed.
