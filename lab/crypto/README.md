# lab/crypto/

**Status:** empty. Planned in Phase 6.

Encryption-at-rest tooling for the delta log (`data/deltas.jsonl`), which currently grows
unbounded via `appendFileSync` in `src/server/sync-service.ts`.

## Belongs here

- `encrypt_log.py` — AES-256-GCM envelope encryption of the delta log
- `verify_log.py` — HMAC integrity verification
- `keygen.py` — key generation helper (keys are never committed)

## Design constraints

- Key material comes from systemd `LoadCredential`, not from a file in the repo.
- Authenticated encryption only — GCM, never CBC without a MAC.
- Verification must fail loudly on tampering, not silently skip.
- The tool is a lab deliverable; wiring it into the running server is a separate decision
  recorded in the plan's Phase 6 work list.
