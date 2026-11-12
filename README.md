# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO server and a React/Zustand client, organised as npm workspaces:

- `packages/engine/src/` — game rules, card data, helpers, and contracts (`@card-game/engine`).
- `packages/protocol/src/` — versioned player views, commands and validated auth contracts (`@card-game/protocol`).
- `apps/server/src/` — transport and multiplayer lifecycle (`@card-game/server`).
- `apps/game-client/` — React player app (`@card-game/client`).
- `apps/admin/` — independent administrator app (`@card-game/admin`).
- `apps/deck-builder/` — public catalog and account-owned deck editor (`@card-game/deck-builder`).
- `packages/ui/` — shared card display and workspace navigation (`@card-game/ui`).
- `packages/browser-session/` — cookie/CSRF transport, public route and verified resume helpers (`@card-game/browser-session`).

- [Concept map — where things are and how flows run](docs/MAP.md) (start here to navigate the code)
- [Current architecture and verification](ARCHITECTURE.md)
- [Concede, room exit, refresh history and auto-pass assessment](docs/room-lifecycle-and-auto-pass.md)
- [Pure legal-action query and safe unknown results](docs/legal-action-query.md)
- [Client auto-pass toggle and five-second server countdown](docs/auto-pass-controls.md)
- [Workspace architecture supplement](docs/workspace-architecture.md)
- [Enforced dependency rules](docs/architecture-import-policy.md)
- [Readability and coverage gates](docs/readability-gate.md)
- [Software design principles and where they live](docs/design-principles.md)
- [Accounts, sessions and admin access](docs/authentication-architecture.md)
- [Persistence, saved decks and database operations](docs/persistence-deck-architecture.md)
- [Configuration folders, content and operator overrides](docs/configuration-architecture.md)
- [Admin app, account disabling and auditing](docs/admin-architecture.md)
- [Deck builder, text format and game handoff](docs/deck-builder-architecture.md)
- [Security lab plan — Linux hosting, pentest, detection, observability](docs/security-lab-plan.md) (account phase implemented; infrastructure phases planned)
- [Lab learning path, runbooks and evidence templates](lab/README.md) — isolated nginx assessment and a separate optional invited tunnel demo; implementation remains planned.
- [Card JSON field reference and commented examples](packages/engine/src/library/README.md)
- [Effective costs, deck policy, shared usage and causal outcomes](docs/shared-card-infrastructure.md)
- [Current card blockers, readiness definition and every missing workbook row](docs/card-blockers-current.md)
- [Atomic counter costs and optional payment branches](docs/counter-payment-architecture.md)
- [Workbook card readiness and complete named-row inventory](docs/workbook-card-readiness-2026-11-03.md)
- [Data-only card implementation and deferred-card audit](docs/workbook-data-only-batch-2026-11-03.md)
- [Shared card-query architecture, newly unblocked cards and poison cleanup](docs/card-query-architecture.md)
- [Strict rule contracts, functional effect families and legacy review](docs/rule-contract-architecture.md)
- [Temporary mill result sets, exact-card recovery and follow-up queries](docs/resolution-results-architecture.md)
- [Captured reveal/look windows and configurable visibility](docs/card-window-design.md)
- [Predefined token templates, creation and board-only lifecycle](docs/token-architecture.md)
- [Platform roadmap](docs/platform-plan-2026-10-24.md)
- [Navigation and Test Lab roadmap](docs/navigation-test-lab-plan.md)
- [Current navigation, shared sign-in and migration](docs/navigation-session-architecture.md)
- [Scenario Builder, lab startup and fixtures](docs/scenario-lab-architecture.md)
- [Milestone 7 completion evidence](docs/phase-7-status-2026-11-03.md)
- [Match UI prototype, extension points, and board recovery](docs/game-ui-poc.md)

Milestone **7 is implemented**: the isolated local admin Test Lab adds revisioned scenarios, assigned test seats, launch/reset/inspect/revise and fixture exports. **Next: 8 — game UI revamp**. See [lab setup and contracts](docs/scenario-lab-architecture.md). Shared navigation/public sessions from Milestone 6 remain in place. The UI revamp was previously numbered 6; completed milestone numbers/reports remain historical. See [navigation/session setup and migration](docs/navigation-session-architecture.md).

Use Node `^20.19.0 || >=22.12.0` and run these commands from the repository root:

```sh
npm ci
npm run verify
npm start
```

After building, run `npm start` and open `http://localhost:3000/home` or `/play`. This built mode serves public apps on one origin. For Vite, `npm run dev` selects the backend’s explicit Vite navigation mode; separately run `npm run dev:client`, `npm run dev:deck-builder` and optionally `npm run dev:admin`. Open `http://localhost:5173/home`.

`verify` checks all eight TypeScript projects, runs all four Vitest projects and builds server, player, admin and builder. Internal packages export source; TypeScript emits only declarations/incremental metadata under ignored `build/types/`. Public apps share an ordinary HttpOnly browser sign-in, while game tabs receive separate bearer/seat credentials. Admin stays a separately privileged origin/session.

The player app supports guest play, registration/login while seated and selection of saved decks. Sessions derive player identity on the server. Admin APIs require a separate admin-scoped login and operator provisioning; see [setup and API contracts](docs/authentication-architecture.md#admin-api-and-operator-setup). Production browser origins must be configured through `ALLOWED_ORIGINS`. Accounts, valid sessions and decks persist in SQLite (`data/card-game.sqlite`, overridable with `DATABASE_PATH`); rooms and seats disappear at restart. Production matches require an owned saved deck unless development fixtures are explicitly enabled.

Open `/deck-builder/` on the built public origin, or `http://localhost:5175/deck-builder/` in Vite mode. Public users browse/draft; signed-in accounts save/load/update and import/export. Play sends only a deck ID to a separate game tab without another password login. Drafts remain per-tab; the old dedicated builder credential key is cleared. See [builder architecture](docs/deck-builder-architecture.md) and [current public-session design](docs/navigation-session-architecture.md).

Milestones 2–7 use focused logic/short integration checks, all typechecks and builds. The user waived browser smoke, long socket scenarios and a blocking full suite; [Milestone 6 evidence](docs/phase-6-status-2026-10-29.md) records exact results. Full `verify` remains available for CI. Before upgrading, take the rollback backup with the pre-upgrade release; migration 003 adds browser families and binds the database to an instance ID/purpose. See [migration/operations](docs/navigation-session-architecture.md#persistence-isolation-and-rollout).

Editable values now live in owned config folders; card definitions are grouped under `packages/engine/src/library/cards/`. Server defaults/profiles are bundled JSON; an external `CONFIG_FILE` supplies restart-loaded operator overrides. See the configuration guide for precedence and supported fields. Secrets remain in protected external sources.

For administration, provision an explicit admin username/password-file through the existing bootstrap environment and deliberately enable inspection. Run `npm run dev:admin` and open `http://localhost:5174/admin/`, or use the built development path at `http://localhost:3000/admin/`. The app provides room inspection, bounded game-log pages, account disabling and read-only effective settings. Production uses the dedicated-origin [nginx example](deploy/nginx/admin.conf.example); Linux/TLS installation remains deployment work.

The individual gates are `npm run typecheck:server`, `npm run typecheck:client`, `npm run test:architecture`, `npm test`, and `npm run build`. `npm run test:watch` watches the test projects. CI runs `npm ci` followed by `npm run verify` on Node 24. See the [RPS smoke checklist](docs/smoke-test-rps.md) for the production browser flow.

For the built local Scenario Lab, provision external lab operator credentials, run `npm run build`, then `npm run start:lab`. Open `http://localhost:3001/admin/`. This uses separate lab storage and loopback binding. Ordinary development now requires saved decks by default; legacy fixture shortcuts remain explicit/test-only. See the lab guide for limits and migration.
