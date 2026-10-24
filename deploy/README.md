# deploy/

Deployment and host-hardening artifacts for the Linux target (Phase 2).

**Status:** scaffolding only. No file here is implemented or verified.

## Layout

| Path | Contents | Plan phase |
|---|---|---|
| `systemd/` | `cardgame.service` unit with sandboxing directives | 2 |
| `nginx/` | Reverse proxy + TLS + WebSocket upgrade config | 2 |
| `firewall/` | `ufw` rules and SSH hardening script | 2 |
| `auditd/` | `auditd` watch rules and `aide` baseline procedure | 2 |
| `monitoring/` | Prometheus, Grafana, Suricata compose stack | 3, 4 |

## Rules

- Nothing here runs on a host that was not built for this lab. See the topology and hard
  rule in the plan (§5).
- These files are additive. They do not change application source.
- Every artifact gets a verification command recorded next to it before it is called done.
