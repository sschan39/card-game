# Card game

A two-player, MTG-inspired card game with a TypeScript/Express/Socket.IO server and a React/Zustand client, organised as npm workspaces:

- `packages/engine/src/` — game rules, card data, helpers, and contracts (`@card-game/engine`).
- `packages/protocol/src/` — versioned player views, commands and validated auth contracts (`@card-game/protocol`).
- `apps/server/src/` — transport and multiplayer lifecycle (`@card-game/server`).
- `apps/game-client/` — React player app (`@card-game/client`).
- `apps/admin/` — independent administrator app (`@card-game/admin`).
- `apps/deck-builder/` — public catalog and account-owned deck editor (`@card-game/deck-builder`).
- `packages/ui/` — shared card face and styles (`@card-game/ui`).

- [Concept map — where things are and how flows run](docs/MAP.md) (start here to navigate the code)
- [Current architecture and verification](ARCHITECTURE.md)
- [Workspace architecture supplement](docs/workspace-architecture.md)
- [Enforced dependency rules](docs/architecture-import-policy.md)
- [Accounts, sessions and admin access](docs/authentication-architecture.md)
- [Persistence, saved decks and database operations](docs/persistence-deck-architecture.md)
- [Configuration folders, content and operator overrides](docs/configuration-architecture.md)
- [Admin app, account disabling and auditing](docs/admin-architecture.md)
- [Deck builder, text format and game handoff](docs/deck-builder-architecture.md)
- [Security lab plan — Linux hosting, pentest, detection, observability](docs/security-lab-plan.md) (account phase implemented; infrastructure phases planned)
- [Card JSON field reference and commented examples](packages/engine/src/library/README.md)
- [Platform roadmap](docs/platform-plan-2026-10-24.md)
- [Planned navigation, session integration and admin Test Lab](docs/navigation-test-lab-plan.md)

The next platform milestones are **6: navigation/session integration → 7: admin Test Lab and Scenario Builder → 8: game UI revamp**. The UI revamp was previously numbered 6; delivered Milestones 0–5 retain their numbers. This is planned work; current runtime behavior remains described below.

Use Node `^20.19.0 || >=22.12.0` and run these commands from the repository root:

```sh
npm ci
npm run verify
npm start
```

Open `http://localhost:3000` in two separate browser sessions and create/join a room. Development uses `npm run dev` for the backend and `npm run dev:client` for the Vite client on port 5173.

`verify` checks all seven TypeScript projects, runs all four Vitest projects (including architecture checks), and builds server, player, admin and deck builder. TypeScript emits only declaration/build metadata under ignored `build/types/`. Vite bundles the engine into `apps/server/dist/index.js`; the three frontends emit independent browser builds. Express serves the public player/builder apps; production admin serving uses its own origin. Internal packages export source, with no package JavaScript build to go stale.

The player app supports guest play, registration/login while seated and selection of saved decks. Sessions derive player identity on the server. Admin APIs require a separate admin-scoped login and operator provisioning; see [setup and API contracts](docs/authentication-architecture.md#admin-api-and-operator-setup). Production browser origins must be configured through `ALLOWED_ORIGINS`. Accounts, valid sessions and decks persist in SQLite (`data/card-game.sqlite`, overridable with `DATABASE_PATH`); rooms and seats disappear at restart. Production matches require an owned saved deck unless development fixtures are explicitly enabled.

Open the built builder at `http://localhost:3000/deck-builder/`, or run `npm run dev:deck-builder` and open `http://localhost:5175/deck-builder/`. Public users can browse/filter and draft; accounts can save/load/update decks and import/export stable-ID text. “Play this deck” passes only its ID to the game; sign in there with the same account to select it. The builder keeps its own per-tab credentials and a recoverable draft. See the [builder setup and architecture](docs/deck-builder-architecture.md).

Milestones 2–5 use focused logic/integration tests, typechecks and builds. The user waived browser smoke, long socket scenarios and a blocking full-suite run; the milestone completion reports record exact evidence, including the [Milestone 5 report](docs/phase-5-status-2026-10-28.md). The full `verify` command remains available for CI. See the [storage supplement](docs/persistence-deck-architecture.md#operations-and-failure-modes) for consistent backups, restore and log rotation.

Editable values now live in owned config folders; card definitions are grouped under `packages/engine/src/library/cards/`. Server defaults/profiles are bundled JSON; an external `CONFIG_FILE` supplies restart-loaded operator overrides. See the configuration guide for precedence and supported fields. Secrets remain in protected external sources.

For administration, provision an explicit admin username/password-file through the existing bootstrap environment and deliberately enable inspection. Run `npm run dev:admin` and open `http://localhost:5174/admin/`, or use the built development path at `http://localhost:3000/admin/`. The app provides room inspection, bounded game-log pages, account disabling and read-only effective settings. Production uses the dedicated-origin [nginx example](deploy/nginx/admin.conf.example); Linux/TLS installation remains deployment work.

The individual gates are `npm run typecheck:server`, `npm run typecheck:client`, `npm run test:architecture`, `npm test`, and `npm run build`. `npm run test:watch` watches the test projects. CI runs `npm ci` followed by `npm run verify` on Node 24. See the [RPS smoke checklist](docs/smoke-test-rps.md) for the production browser flow.
