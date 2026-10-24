# deploy/nginx/

**Status:** empty. Planned in Phase 2.

## Belongs here

- `cardgame.conf` — server block for the target.

## Requirements

- TLS 1.2+ only; certificate path documented.
- Plain HTTP redirects to HTTPS.
- Socket.IO needs the upgrade headers, or the client silently falls back to polling:

  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```

- `proxy_read_timeout` must exceed the client's ping interval, or idle sockets drop.
- `/metrics` must **not** be proxied publicly — Prometheus scrapes loopback directly.

## Verification

- `curl -I https://<target>/` returns 200.
- `curl -I http://<target>/` returns a redirect.
- A two-client game completes through the proxy.
- `testssl.sh <target>` report captured.
