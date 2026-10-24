# lab/audit/

**Status:** empty. Planned in Phases 2 and 5.

Bash wrappers around standard Linux security-audit tooling. Each wrapper normalizes output to
JSON so runs can be compared.

## Belongs here

| Script | Wraps | Purpose |
|---|---|---|
| `lynis.sh` | `lynis audit system` | Host hardening baseline |
| `auditd-report.sh` | `ausearch`, `aureport` | Kernel audit trail summary |
| `aide-check.sh` | `aide --check` | File integrity verification |
| `ports.sh` | `ss -tulpn` | Listening socket inventory |
| `systemd-exposure.sh` | `systemd-analyze security` | Unit sandboxing score |

## Verification

Each script must exit non-zero on failure and write its JSON to a caller-supplied path, so the
Phase 6 re-scan can diff against the Phase 2 baseline.
