# deploy/monitoring/

**Status:** empty. Planned in Phases 3 and 4.

## Belongs here

| File | Purpose | Phase |
|---|---|---|
| `docker-compose.yml` | Prometheus + Grafana + Suricata | 3, 4 |
| `prometheus.yml` | Scrape config for the app and Suricata exporter | 3 |
| `alerts.yml` | Alert rules with documented PromQL | 3 |
| `grafana/` | Provisioned datasource + dashboard JSON | 3 |
| `suricata/` | `suricata.yaml` and custom `cardgame.rules` | 4 |
| `README.md` | PromQL reference with expected output | 3 |

## Metric names the app must expose

Defined in the plan (Phase 3). Summary:

- `cardgame_actions_total{action,result}`
- `cardgame_action_duration_seconds` (histogram)
- `cardgame_rooms_active`
- `cardgame_socket_connections`
- `cardgame_auth_attempts_total{result}`
- `cardgame_delta_log_bytes`

## Verification

- All series present in Prometheus after a scrape
- Dashboard renders live data during a two-client game
- Each alert fires when triggered and resolves when cleared
- Each Suricata rule fires on its scripted reproduction and stays silent during normal play
