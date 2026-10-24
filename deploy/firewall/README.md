# deploy/firewall/

**Status:** empty. Planned in Phase 2.

## Belongs here

- `ufw.sh` — default-deny rules, allow 22 and 443 only.
- `ssh-hardening.md` — key-only auth, `PermitRootLogin no`, fail2ban setup.

## Verification

- `ufw status verbose`
- `ss -tulpn` shows only 22, 443, and loopback 3000
- `nmap -p-` from the Kali VM shows only the expected ports
