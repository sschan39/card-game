# Frontend issue table

**Status:** current · **Audited:** 2026-11-13 · **Branch:** `frontend/issue-audit` · **Round 2:** six rows closed (toast overlay, account panel, deck containers, catalog tiles)

A tracked inventory of layout and visual-design defects in the three front ends and the
shared surface they build on. Two tables matter: **Unfixed** is the work queue, **Fixed** is
the record. Everything below was found by reading the stylesheets and components *and* by
measuring the rendered pages; nothing here is a guess about how something "looks in theory".

Scope audited:

| Surface | Entry points | Stylesheet(s) |
|---|---|---|
| Shared UI layer | `packages/ui/src/` (`CardSurface`, `WorkspaceHeader`, `BuilderControls`) | `packages/ui/src/style.css` (292 lines) |
| Game client | `/home`, `/play`, `/play/rooms/:roomId` | `apps/game-client/style.css` (2010) + `presentation/board-effects.css` (186) |
| Deck builder | `/deck-builder/` | `apps/deck-builder/style.css` (574) |
| Admin console | `/admin/#rooms · #logs · #accounts · #config · #scenarios · #test-rooms` | `apps/admin/style.css` (810) |

41 `.tsx` components across the four surfaces; 3 872 CSS lines in total.

---

## How this table is maintained

1. **IDs are permanent.** `S-` shared · `G-` game client · `D-` deck builder · `A-` admin ·
   `X-` cross-app. Never renumber, never reuse. A new finding takes the next free number in
   its area, even if an earlier one was closed.
2. **One row per defect.** If a defect shows up in two apps, the row lives in the area that
   owns the code and the other area links to it (for example the card-face clipping is `S-01`
   and the deck builder references it instead of restating it).
3. **A row only becomes Fixed when the change and its proof both exist.** Concretely: the
   code change is on the branch, and the row carries the verification command that shows the
   defect gone. Moving a row without that proof is the failure mode this table exists to
   prevent.
4. **Status values:** `Open` (reproduced, not addressed) · `Fixed` (change + proof) ·
   `Won't fix` (deliberate, with a one-line reason — never a silent deletion).
5. **Evidence tags on every row:** `M` = measured in a browser at the viewport(s) named ·
   `S` = read from source (`path:line`). A row may carry both.
6. **Severity:** `Critical` = the interface cannot be used as intended · `High` = clearly
   wrong or unreadable for normal use · `Medium` = degrades comprehension, consistency or
   reach · `Low` = cosmetic or marginal.
7. **Re-auditing.** The measurement pass is reproducible without extra tooling beyond the
   repo's own build and a Playwright Chromium: start the built server against a throwaway
   database, then for each of 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768, 900×500 and
   390×844 record horizontal overflow, clipped content (`scrollHeight` vs `clientHeight`),
   computed font sizes, control boxes, text/background contrast, and fixed/sticky layers.
   The audit that produced this table used a second, isolated instance (`PORT=3100`,
   `DATABASE_PATH` and audit/delta logs in a temp directory, `NODE_ENV=test` fixtures, a
   bootstrapped admin account), so the developer instance on `:3000` and its database were
   never touched. Screenshots and raw JSON stayed in a temp directory and are deliberately
   not committed.

---

## Summary

| Severity | Shared | Game client | Deck builder | Admin | Cross-app | Total |
|---|---|---|---|---|---|---|
| Critical | – | 1 | – | – | – | **1** |
| High | 2 | 4 | 2 | – | 2 | **10** |
| Medium | 2 | 5 | 4 | 5 | 6 | **22** |
| Low | 2 | 2 | 2 | 1 | 2 | **9** |
| **Total** | **6** | **12** | **8** | **6** | **10** | **42** |

Open: **36** · Fixed: **6** · Won't fix: **0**

Three numbers explain most of the table:

- **8.8 px** — the smallest type in the product (`.card-type`); the shared card face has no
  size floor and its text is clipped at every card width (`S-01`, `S-02`).
- **45-52 px** — how much of every hand card sits below the viewport and is cut off by
  `.board-stage { overflow: clip }` (`G-01`).
- **361 px** — the overlap between the opened log drawer and the phase/action rail, i.e. the
  drawer covers the controls used to finish a turn (`G-03`).

---

## Unfixed issues

Every row below is `Open`. The area is given by the section heading; the columns are the
defect, where it lives (`path:line`), what is wrong, the evidence with its tag (`M`/`S`), and
the proposed fix.

### Shared UI layer

| ID | Sev | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| S-01 | High | `packages/ui/src/style.css:56-143` | The card face is a fixed `rem` type scale in a fluid box: the board sizes cards from `--card-w` (84-132 px) and renders lands at 68 px, but `.card-text` never reflows or shrinks, so rules text is cut off with no ellipsis and no scroll. | M: catalog `.card` 160 px content in a 130 px box (30 px over), `.card-text` 122 px rig in 10-49 px of space; board hand card 74 px wide → `74x85` in `74x35`; tapped permanent 58 px → `58x85` in `58x29` (56 px hidden). | Drive the card's type from the card width (container query units or a `--card-scale` custom property) and add a compact variant that clamps rules text to two lines. |
| S-02 | High | `packages/ui/src/style.css:104-143` | No size floor anywhere on the card face: `.card-type` 0.55 rem (8.8 px), `.card-text` 0.58 rem (9.28 px), `.card-mana` 0.6 rem (9.6 px), `.card` 0.62 rem (9.92 px). | M: 8.8 / 9.28 / 9.6 / 9.92 px in the catalog and on the board. | Raise the base card scale to an 11 px floor at 132 px width and scale it with the card. |
| S-03 | Low | `packages/ui/src/style.css:95-102` | `.card-mana` is `#e8cb7d` on the `.card-top` gradient `#4a5f4f` = 4.36:1, under the 4.5 floor, on 9.6 px text. | M: 4.36:1 (worst gradient stop) at 9.6 px. | Darken `.card-top` or lighten the mana colour until the pair clears 4.5:1. |
| S-04 | Low | `packages/ui/src/style.css:188-204`, `:241-244` | The environment chip is 10.56 px; `.lab-unavailable` is `#8d7f6a` on `#101d17` = 4.44:1. | M: 10.56 px at all seven viewports; 4.44:1. | 11-12 px chip and a colour at or above 4.5:1. |
| S-06 | Medium | `packages/ui/src/style.css` (whole file) | The shared layer has exactly one size for every context: a single `@media` rule, and it only disables a link transition. There is no small/medium/large card, no narrow-header rule, so every app inherits the same fixed face. | S: `rg "@media" packages/ui/src/style.css` → 1 hit, `prefers-reduced-motion` only. | Add the card and header variants here, once, so all three apps inherit them. |

### Game client

| ID | Sev | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| G-01 | Critical | `apps/game-client/style.css:457-473` (`.board-stage{overflow:clip}`), `:1131-1188` (hand dock and tuck) | The hand is tucked below the table edge on purpose, but the stage clips it, so 45-52 px of every hand card — bottom stats and the lower rules text — is outside the viewport and unreachable: it cannot be scrolled into view and hovering only lifts the card 0.7 rem. | M: 52 px hidden at 1920×1080 and 1440×900, 45 px at 1280×720, 49 px at 1024×768; `.board-stage` scroll height vs client height 1072/1019, 892/839, 758/707, 706/659, 758/707. | Put the hand in its own row outside the clipped stage, or reduce `--hand-tuck` until the card bottom stays inside. |
| G-02 | High | `apps/game-client/style.css:1186-1188`, `apps/game-client/components/Hand.tsx:11-23` | Hand overlap comes from three `rem` buckets (-1.8 / -3.2 / -4.2 rem) and ignores the card's actual width (`clamp(84px, min(8vw,13.5vh),132px)`). A twelve-card hand at 1024 px leaves a 14 px strip per card — unreadable and far under a usable target. The density engine's "≥ 34 % of a card" rule is applied to permanents but not here. | M (fan reproduced with the app's own `fanStyle` formula): 12 cards → 14 px step at 1024×768, 27 px at 1280×720, 44 px at 1440×900, 60 px at 1920×1080; card width 84-132 px. | Compute hand overlap from the measured card width, the way `planDensity` already does for permanents. |
| G-03 | High | `apps/game-client/style.css:1409-1430` | The log drawer is absolutely positioned over the right rail, so opening it covers the phase bar and the primary action buttons used to finish a turn. | M at 1440×900: panel x = 1036, width 384; phase pill right edge 1397 → 361 px overlap on a 241 px-wide pill, i.e. fully covered. | Give the drawer its own overlay layer with a backdrop, or dock it outside the rail. |
| G-04 | Medium | `apps/game-client/style.css:523-542` vs `:1360-1366` | `.game-outcome` is `z-index: 25` while `.log-drawer` is `60`, and both are siblings inside `.board-stage` — the win/lose banner can be painted underneath an open log drawer. | S: declarations above; M: log drawer computed `z-index: 60`. | Put the outcome banner on the top overlay layer (≥ 300) or close the drawer when the game ends. |
| G-05 | High | `apps/game-client/style.css:684-689`, `:717-729`, `:497-503`, `:1053-1062`, `:930-937` | Board chrome type runs 8.16-10.88 px: `.life-label` 8.16 px, `.seat-stats` terms 10.88 px, `.board-sync` 10.56 px, turn divider 10.4 px, empty-lane text 10.56 px. | M at 1024/1280/1366/1440/1920. | Raise board chrome to an 11-12 px floor and shorten labels instead of shrinking them. |
| G-06 | Medium | `apps/game-client/style.css:1481-1503` | Log metadata is `#4f6357` on `#14231c` = 2.53:1 at 10.88 px — effectively invisible. | M: 2.53:1 at 10.88 px (`.log-seq`, `.log-changes`). | Use `--muted` (5.4:1 on that surface) or brighter, at 12 px. |
| G-07 | High | `apps/game-client/style.css:1886-1898`, `apps/game-client/components/RotateGate.tsx` | Below 900×520 the board is `display: none` and replaced by "Turn your device sideways", with no scroll and no reduced layout — a 900×500 split-screen desktop window has no playable interface at all. | M: at 900×500 and 390×844 `gameScreenHidden = true`, `rotateGate = true`, every board rect 0×0, document does not scroll. | Provide a compact board above a much lower floor (stacked lanes, smaller rail) or allow vertical scroll in a narrow mode. |
| G-08 | Medium | `apps/game-client/style.css:568-574`, `:817-830`, `:865-880` | In the 166-184 px right rail at 1024 px the phase pill wraps to 182 px tall and its controls shrink to 16.8 px tall (`Debug actions`), with a 13×13 auto-pass checkbox — both under the 24 px target floor. | M: pill 241×80 at 1440 vs 166×182 at 1024; `debug-controls summary` height 16.8 px; auto-pass input 13×13. | Give the rail a minimum width, or move the pill to a bottom strip at narrow desktop widths. |
| G-09 | Medium | `apps/game-client/style.css:1016-1031` | `.stack-badge` — the only control on a token stack — is sized by `padding: .02rem .32rem` on `.6rem` text, roughly 9 px tall. | S: no token stack existed on the audited board; the declaration box is under 12 px tall. | Size it like a real chip (≥ 24×24, or pad the hit area with a pseudo-element). |
| G-10 | Medium | `apps/game-client/components/PlayerInfo.tsx:31-40`, `apps/game-client/style.css:1804-1817` | Player targeting is an `onClick` on a non-focusable `<div>`, while only `.life-seal` shows `cursor: pointer` — keyboard users cannot target a player, and the mouse affordance sits on a different element than the handler. | S: container has no `role`/`tabIndex`; CSS applies the pointer to the seal only. | Make the seal a real `<button>` with `aria-pressed` and keep the handler on it. |
| G-11 | Low | `apps/game-client/components/Hand.tsx:31-38` | Each hand card is a `div[role="button"]` wrapping the card's own clickable surface, and its accessible name is only the card name — no cost or type. | S. | One focusable element per card, with a fuller accessible name. |
| G-12 | Low | `apps/game-client/components/StartScreen.tsx:66-71` | The join-room field has only a placeholder — no `<label>`, no `aria-label` — so its purpose disappears as soon as the player types. | S. | Add a visible or `sr-only` label. |

### Deck builder

| ID | Sev | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| D-01 | High | `apps/deck-builder/style.css:355-364` | The editor aside is 721 px tall — taller than every audited viewport except 1920×1080 — and it is `position: sticky` with no internal scroll, so its lower part (saved decks, text import/export) stays below the fold for the whole length of the page and cannot be scrolled to on its own. | M: aside height 721 px; bottom past the viewport by 35 px at 1920×1080, 215 at 1440×900, 347 at 1366×768, 395 at 1280×720, 341 at 1024×768, 567 at 900×500, 547 at 390×844; setting `scrollTop = 9999` yields `maxScroll 0` (not scrollable). | `top: calc(header + gap)` with `max-height: calc(100dvh - …)` and `overflow-y: auto`, or fold the lower sections into disclosures. |
| D-02 | High | `apps/deck-builder/style.css:245`, `:289` | The aside keeps a fixed 400 px while the catalog column shrinks, so at 1024×768 the catalog gets 534 px → 2 columns → 30 492 px of page for 155 cards. Nothing between 1000 px and 1280 px reduces the aside. | M: workbench columns `534.406px 400px` at 1024 vs `1110.41px 400px` at 1920; catalog columns 5 at 1920/1440, 4 at 1366/1280, 2 at 1024, 1 at 390; document height 14 315 px at 1440×900 → 30 492 at 1024×768 → 57 176 at 390×844. | Reduce the aside progressively (≈ 360 px under 1200 px) and lower the catalog tile minimum width. |
| D-03 | Medium | `apps/deck-builder/style.css:275-288` | The "Deck-legal only" checkbox renders 13×13 px — under the 24 px target floor. | M: 13×13 at all seven viewports. | Give the control a 24 px hit area (sized wrapper or padding on the label). |
| D-04 | Medium | `apps/deck-builder/style.css:56-63`, `:314-352` | Catalog and aside copy sit below 12 px: card type 8.8, rules 9.28, mana 9.6, stats 9.92, card id 10.88, "Up to N copies" 11.2, eyebrow 10.88, deck counter 11.84, `code` 11.7 px. | M: twelve distinct runs at all seven viewports. | Raise the catalog and aside typography floor; the card-face values are `S-01`/`S-02`. |
| D-05 | Low | `apps/deck-builder/style.css:346-352` | The card id under each tile is `#5c6f65` on `#14231c` = 3.04:1 at 10.88 px; the mana row is 4.36:1 at 9.6 px. | M: 3.04:1 and 4.36:1. | Use `--muted` (5.4:1) or brighter, at 12 px. |

### Admin console

| ID | Sev | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| A-01 | Medium | `apps/admin/style.css:275-300`, `:750-760` | The shell's top bar is fully styled — height 77 px, borders, `.topbar > div`, `.topbar strong`, plus a media-query override — but no element renders it: `topbar` and `expiry` appear zero times in `apps/admin/**/*.tsx`. The shared header inside `.workspace` takes its place, starting after the 232/196 px sidebar. | S: `rg -c 'topbar' style.css` = 5, `'expiry'` = 2, both 0 in TSX. M: no `.topbar` element on any of the four routes. | Delete the dead rules, or render the bar the CSS was written for. |
| A-02 | Medium | `apps/admin/pages/Accounts.tsx:22`, `apps/admin/pages/Rooms.tsx:34` | Tables have no horizontal scroll container, so at 390 px the five-column accounts table is squeezed into 366 px and still bleeds 9 px past the viewport. | M at 390×844: `scrollWidth = clientWidth = 366`, `overflowContainer: null`, table right edge 399 px vs a 390 px viewport (8 overflowing descendants). | Wrap tables in an `overflow-x: auto` region so columns keep a readable minimum. |
| A-03 | Medium | `apps/admin/style.css:9-29`, `:148-154`, `:430-444`, `:589-607` | Muted text on the light surface fails contrast: `--admin-muted #7d8a82` on `#fffdf9` = 3.55:1 (used by `small`, pagination, `dl.settings dt`, the login note); table header cells are 3.34:1 on `#f8f6f1`. | M: 3.55:1 at 11.84-13.6 px, 3.34:1 at 11.2 px. | Darken `--admin-muted` to around `#5f6d64` (≥ 4.5:1 on both surfaces). |
| A-04 | Medium | `apps/admin/style.css:197-203`, `:219-226`, `:263-269`, `:323-333`, `:407-444` | Console chrome runs 9.98-11.84 px: nav label 10.24, eyebrow 10.24, brand sub-label 11.2, sidebar note 11.2, table header 11.2, badge 10.88, pagination 11.84, settings `code` 9.98 px. | M at all seven viewports on four routes. | Apply the same 12 px floor as the rest of the product. |
| A-05 | Medium | `apps/admin/style.css:804-810` | The Scenario workbench block is appended after the responsive section in a different style: one-line rules, `#64748b` borders (a Tailwind slate, not a token), `.5rem` radii, `textarea { width: min(60vw, 800px) }` sized from the viewport inside a panel, and no reduced-motion coverage. It only renders when the scenarios capability is enabled, so lab instances ship UI that does not match the console. | S: lines 804-810; the `.scenario-*` selectors exist in CSS only for lab builds. | Bring it into the token set and section order, or drop it until the capability ships. |
| A-06 | Low | `apps/admin/style.css:689-702` | The skip link is 113.7×20 px — under the 24 px floor — although it is the console's keyboard entry point. | M (pre-filter sweep): 113.7×20 at all seven viewports. | Add vertical padding so the focused control is at least 24 px tall. |

### Cross-app

| ID | Sev | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| X-01 | High | `apps/game-client/style.css:81-102`, `apps/deck-builder/style.css:95-120`, `apps/admin/style.css:46-66` | Each app re-implements the control layer instead of inheriting one: `button` font-size is .82 / .85 / .875 rem, padding `.42rem .85rem` / `.45rem .7rem` / `8px 13px`, radius `--radius-sm` / `--radius-sm` / `--radius`. Inputs drift the same way. | S: three independent base blocks; the shared layer exports tokens but no control styles. | Move the control base (button, input, select, textarea, focus ring) into `packages/ui/src/style.css` and let each app specialise only colour. |
| X-02 | High | All four stylesheets | Colours are hard-coded next to tokens: the game client has 198 hex literals (126 unique, **94 not in the shared token set**), the deck builder 35 (17 off-token), the console 41 (26 off-token), the shared layer 0. The same colours are redeclared in every file. | M (consistency scan): counts above. | Promote the recurring values (`#16261f`, `#14231c`, `#d8b45c`, `#b08c33`, `#1a1408`, `#0c1712`) to tokens and replace the literals. |
| X-03 | Medium | All four stylesheets | The "type scale" is not a scale: 30 distinct `font-size` values in the game client (0.56-1.9 rem, plus 15 px and 8 px), 23 in the console, 16 in the deck builder, 9 in the shared layer. The same role gets different sizes — `.eyebrow` is 0.68 rem in the deck builder
(`apps/deck-builder/style.css:192-198`) and 0.64 rem in the console
(`apps/admin/style.css:323-329`). | M: value inventories; S: both `.eyebrow` blocks. | Define a six-step scale as tokens and map every role to a step. |
| X-04 | Medium | `apps/game-client/style.css` | Radius drift: the game client mixes `0`, `2px`, `3px`, `6px`, `10px`, `.4rem`, `999px`, `20 %`, `50 %`, `inherit` alongside `--radius*`; the console adds `.5rem`; only the deck builder uses tokens exclusively. | M: radius inventory per file. | Snap every radius to `--radius-sm` / `--radius` / `--radius-lg` (percentages only for circles and pills). |
| X-05 | Medium | `apps/game-client/style.css` | Shadow drift: 35 `box-shadow` declarations in the game client against 5 in the console, 3 in the deck builder and 3 in the shared layer; `--shadow-panel` and `--shadow-card` exist but are bypassed. | M: declaration counts. | Replace ad-hoc shadows with the two existing tokens plus one elevated token. |
| X-06 | Low | `apps/game-client/style.css:9-13` vs `apps/deck-builder/style.css:9-11`, `apps/admin/style.css:31-33` | Reset drift: only the game client zeroes `margin`/`padding` globally; the other two keep the user-agent margins, so shared components get different spacing per app. | S: three reset blocks. | Put one reset in `packages/ui/src/style.css`. |
| X-07 | Low | `apps/admin/style.css:275-300`, `:750-760`, `:810` | Dead selectors: `.topbar` (5 references) and `.expiry` (2) style an element that never renders (see `A-01`); `.card-count-controls` (1 rule) has no reference in code. | M (unused-class scan) and S (`rg` finds 0 TSX hits). | Delete them, or wire up the markup. |
| X-08 | Medium | `apps/game-client/style.css`, `packages/ui/src/style.css:150-153` | There is no documented layer ladder: the game client uses ten unrelated `z-index` values (3, 25, 30, 40, 60, 100, 101, 200, 300, 310) around the shared header's 50. That is exactly how the outcome banner ended up beneath the log drawer (`G-04`). | M: z-index inventory; S: `G-04`. | Publish a named scale (`--z-board`, `--z-drawer`, `--z-overlay`, `--z-modal`) and use it everywhere. |

---

## Fixed issues

Round 2 (2026-11-13) closed six rows. The account panel, the deck container and the catalog
tile were requested changes; `X-10` (page-level banners), `D-07` and `D-08` were found while
making them and fixed in the same pass. Every row below carries the measurement that proves
the defect is gone.

| ID | Sev | Fixed in | What changed | Proof |
|---|---|---|---|---|
| S-05 | Medium | `packages/ui/src/style.css:275-295`, `WorkspaceHeader.tsx:24-39` | The account menu is an absolutely positioned panel (`.workspace-account-panel`, `top: calc(100% + .45rem); right: 0; z-index: 60`) instead of a `flex-basis: 100%` block, and it closes on an outside pointer or Escape. | M: header height 52 px → **52 px** with the panel open (delta 0) and shell top 52 px → 52 px; panel right edge 1422 px = summary right edge; outside click leaves `open=false`, height 52 px. |
| X-10 | Medium | `packages/ui/src/Toast.tsx` + `apps/*/App.tsx` | Every page-level banner (game-client `.action-error`, deck-builder `.error`/`.notice`, admin `<main>` `Notice`) was an in-flow block that pushed the page down. All three now render one shared `Toast`: a fixed, centred, `pointer-events: none` layer with `role="alert"` that dismisses itself. | M: toast centre 720/450 on a 1440×900 viewport = layer centre, `pointer-events: none`, `role="alert"`, removed from the DOM **3 099 ms** after appearing; at 390×844 still centred (w 342, x 24) with no horizontal scroll. |
| D-06 | Medium | `apps/deck-builder/App.tsx:130-133` | `WorkspaceHeader` moved out of `<main>`, so the sticky bar is no longer capped by `main { max-width }`. | M: header rect x 0 / width **1440** at a 1440 viewport (was 32/1376), matching home and play. |
| D-07 | Medium | `apps/deck-builder/style.css:295-344`, `packages/ui/src/BuilderControls.tsx:14` | Catalog tiles were `display: flex` with variable-length copy, so buttons stepped between cards in a row. They are now a four-row grid (art / id / description / action) with the description clamped to three lines (`-webkit-line-clamp: 3`, `min-height: calc(3 * 1.45em)`) and the button at `min-height: 2.25rem`. | M: every measured row reports `aligned: true` and `equalTiles: true` (button tops and tile heights identical within the row). |
| D-08 | Low | `apps/deck-builder/App.tsx:156-160` | The per-card copy limit lived in its own `<small>` line, away from the control it constrains. It now reads inside the button (`+ Add (Max 4)`), with `+ Add` for unlimited and disabled cards; the "not legal" reason moved to `title`/`aria-label`. | M: `.catalog-grid article small` count = **0**; row labels read `+ Add (Max 4)` / `+ Add`. |
| X-09 | Medium | `apps/deck-builder/style.css:30-34`, `:530-533` | The three pages used three container strategies: decks `1600px + 2rem`, home/play `1040px + 1.5rem`, and 1 rem vs 1.2 rem on small screens. Decks now uses the same strategy — `max-width: 1280px; margin: 0 auto; padding: 0 1.5rem 4rem` (1280 because the workbench needs the width), 1.2 rem under 1000 px. | M at 1440: home/play gutters 200/200, decks 80/80, `padding-left: 24px` on all three, no horizontal scroll. |

**Promoting a row.** Move it up here only when both halves exist:

1. the change on `frontend/issue-audit` that actually removes the defect (not a workaround
   that moves it), and
2. the proof: the re-measured value or the test/command that shows it gone, written into the
   `Proof` cell. For a measured row that means quoting the new number ("hand clipped 0 px at
   all seven viewports"); for a source row it means the verification command and its result.

Keep the original `ID` and `Sev`; if the severity changed while fixing, note it in the
`What changed` cell rather than rewriting history.

---

## Checked and found sound

Recorded so the audit is not read as incomplete. Each item was inspected at the same time as
the rows above.

- **Card preview placement** — `CardPreview` flips to the side with room and clamps to the
  viewport (`PREVIEW_WIDTH 300` / `PREVIEW_HEIGHT 420` + 16 px margin); at the smallest
  playable height (520 px) it still fits. It is `pointer-events: none`, so it cannot steal a
  click. No defect found.
- **Board lane geometry** — equal side lanes keep the combat line centred: 259 / 861 / 259 px
  at 1440×900, 288 / 1281 / 288 at 1920×1080, no horizontal overflow at any of the five
  playable desktop viewports.
- **Admin sidebar widths and the `.split` collapse** — 232 px above 1100 px, 196 px below,
  block at 680 px; `.split` collapses to one column at 1100 px as intended; `main` padding
  steps 34 → 25 → 22 px coherently.
- **Deck builder first screen** — the page `h1` starts 60 px below the sticky header (47 px
  under 1000 px), so nothing is hidden behind it.
- **Shared token contrast on dark surfaces** — `--muted` clears 4.5:1 on the surfaces it is
  actually used on: 5.12:1 on `#101d17`, 5.40:1 on `#0c1712`, 4.81:1 on `#14231c`.
  `--parchment-dim` is 10.23:1 on the header and 9.86:1 on the table.
- **Card face text contrast** — `.card-name` 5.67:1, `.card-type` 8.86:1 and `.card-text`
  9.53:1 all clear their thresholds; the problem there is size and clipping, not contrast.
- **Reduced motion** — all four stylesheets disable board, hand and header transitions under
  `prefers-reduced-motion`, and the targeting/counter animations are switched off.
- **Skip link** — present and functional in the console (`A-06` covers only its height).
