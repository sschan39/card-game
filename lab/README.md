# lab/

Offensive and audit tooling for the Linux target described in
[`../docs/security-lab-plan.md`](../docs/security-lab-plan.md).

**Status:** scaffolding only. No script here is implemented or verified.

## Layout

| Path | Contents | Plan phase |
|---|---|---|
| `fuzz/` | Python Socket.IO fuzzer — the differentiating deliverable | 5 |
| `audit/` | Bash wrappers around `lynis`, `auditd`, `aide`, `ss` | 2, 5 |
| `scan/` | `trivy`, `npm audit`, ZAP, Nuclei runners | 5 |
| `crypto/` | Delta-log encryption + HMAC verification tool | 6 |
| `findings/` | Findings register and evidence artifacts | 5, 6 |

## Rules

- **Run only against the lab VM.** Host-only network, no exceptions. See plan §5.
- `lab/` is additive. It does not import from `src/` and does not change application source.
- Every script writes machine-readable output (JSON) so results can be diffed between the
  baseline run and the post-remediation re-scan.
- No credentials, keys, or captured tokens are committed. Evidence is redacted before it
  lands in `findings/evidence/`.
