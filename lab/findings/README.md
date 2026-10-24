# lab/findings/

**Status:** empty. Populated in Phases 5 and 6.

## Belongs here

- `register.md` — the findings table (created in Phase 5)
- `evidence/` — redacted artifacts: ZAP reports, PCAPs, fuzzer JSON, scan output

## Register columns

Every finding records:

| Column | Meaning |
|---|---|
| ID | `F-01`, `F-02`, … |
| Title | Short description |
| Severity | CVSS score and band |
| Component | File or endpoint affected |
| Reproduction | Steps a second person can follow |
| Evidence | Path under `evidence/` |
| Detected by | Suricata rule id or Grafana alert name, or `none` |
| Remediation | Commit hash |
| Re-test | Pass / fail with date |

## Rules

- Evidence is redacted before it is committed — no tokens, keys, or real credentials.
- A finding without reproduction steps is not a finding.
- A finding without a re-test result stays open.
