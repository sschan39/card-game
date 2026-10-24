# deploy/systemd/

**Status:** empty. Planned in Phase 2.

## Belongs here

- `cardgame.service` — unit file for the Node server.

## Required directives

Recorded in the plan (Phase 2 table). Summary:

- `User=cardgame`, `Group=cardgame`
- `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`
- `PrivateTmp=yes`, `PrivateDevices=yes`
- `RestrictAddressFamilies=AF_INET AF_INET6`
- `ReadWritePaths=/opt/cardgame/data`
- `MemoryMax=512M`
- `Environment=HOST=127.0.0.1` (nginx terminates TLS in front)

## Verification

- `systemctl status cardgame`
- `systemd-analyze security cardgame.service` — record the exposure score
- Reboot and confirm the service returns
