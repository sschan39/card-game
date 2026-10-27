# deploy/

Deployment and host-hardening artifacts for the Linux target described in
[`../docs/security-lab-plan.md`](../docs/security-lab-plan.md) Phase 2.

**Status:** most host-hardening artifacts remain scaffolding. Platform Milestone 3 adds `logrotate/deltas`; its Linux installation/rotation checks remain deployment work. Database backup/restore instructions are in the [storage supplement](../docs/persistence-deck-architecture.md#operations-and-failure-modes).

Platform Milestone 4 adds the [dedicated admin-origin nginx example](nginx/admin.conf.example), durable admin auditing and configuration profiles. The logrotate policy now covers diagnostic and admin-audit JSONL files. See [admin setup/deployment](../docs/admin-architecture.md#running-and-deployment) and [configuration precedence](../docs/configuration-architecture.md). nginx/TLS installation and Linux validation are not claimed by the local logic/build checks.

## Workspace build and runtime paths

Phase 0 establishes these build paths; the host-hardening artifacts below remain future work.
From the repository root on a supported Node runtime:

```sh
npm ci
npm run verify
npm start
```

- Server entry: `apps/server/dist/index.js` (bundled Node application).
- Player client: `apps/game-client/dist/` (served by Express).
- Admin client: `apps/admin/dist/` (independent production origin; development `/admin/` path supported).
- Internal engine: `packages/engine/src/`, bundled into the server; no engine JavaScript artifact is required at runtime.
- Typecheck metadata: `build/types/` (build-time only).
- Delta log: `data/deltas.jsonl`, resolved relative to the server build, independently of the working directory.
- Admin audit: `data/admin-audit.jsonl`, exported from the durable SQLite outbox; private and outside served folders.
- Database: `data/card-game.sqlite` plus WAL/SHM files, or `DATABASE_PATH`; keep private and outside served folders. Use the built server's `backup <new-file>` command for a consistent snapshot.

Keep both application output directories in that relative layout. Runtime third-party dependencies are installed at the repository root with npm workspaces. A future systemd unit should use the repository root as `WorkingDirectory` and the server entry above for `ExecStart`; its sandbox, service account, TLS proxy, firewall, and rotation still require Phase 2 implementation and verification.

## Layout

| Path | Contents | Plan phase |
|---|---|---|
| `systemd/` | `cardgame.service` unit with sandboxing directives | 2 |
| `nginx/` | Reverse proxy + TLS + WebSocket upgrade config | 2 |
| `nginx/admin.conf.example` | Separate admin static origin, API proxy, TLS/CSP placeholders | Platform 4; host validation pending |
| `firewall/` | `ufw` rules and SSH hardening script | 2 |
| `auditd/` | `auditd` watch rules and `aide` baseline procedure | 2 |
| `monitoring/` | Prometheus, Grafana, Suricata compose stack | 3, 4 |
| `logrotate/deltas` | Daily/10 MiB delta-log rotation policy; seven archives, service-owned files | Platform 3; host verification in security-lab 2 |

## Rules

- Nothing here runs on a host that was not built for this lab. See the topology and hard
  rule in the plan (§5).
- These files are additive. They do not change application source.
- Every artifact gets a verification command recorded next to it before it is called done.
