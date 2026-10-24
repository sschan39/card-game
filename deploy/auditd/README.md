# deploy/auditd/

**Status:** empty. Planned in Phase 2.

## Belongs here

- `cardgame.rules` — `auditd` watch rules on `/opt/cardgame`.
- `aide-baseline.md` — integrity baseline procedure and re-check cadence.

## Suggested watches

- Writes to `/opt/cardgame/dist` (code should not change at runtime)
- Writes to `/opt/cardgame/data` (delta log growth, unexpected files)
- `execve` by the `cardgame` user
- Changes to the unit file and nginx config

## Verification

- `auditctl -l` lists the loaded rules
- `ausearch -k cardgame` returns events after a deliberate test write
- `aide --check` reports no changes on a clean host
