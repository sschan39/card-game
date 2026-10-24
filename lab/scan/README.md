# lab/scan/

**Status:** empty. Planned in Phase 5.

Vulnerability and dependency scanning runners.

## Belongs here

| Script | Tool | Target |
|---|---|---|
| `trivy.sh` | Trivy | Filesystem and container image |
| `npm-audit.sh` | `npm audit --json` | Node dependency tree |
| `zap-baseline.sh` | OWASP ZAP | Running HTTPS endpoint |
| `zap-active.sh` | OWASP ZAP | Active scan (lab only) |
| `nuclei.sh` | Nuclei | Template-based checks |

## Notes

- `npm audit` on this dependency tree will be noisy. Results are triaged, not blindly "fixed" —
  record accepted-risk decisions in the findings register.
- ZAP active scanning is intrusive. Lab VM only.
- Every run writes a timestamped report into `../findings/evidence/`.
