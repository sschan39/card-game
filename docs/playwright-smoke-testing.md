# Playwright Smoke-Testing Reference

Reusable snippets for driving the live game in two browser tabs. The client is
React, so plain `.click()` frequently times out ("element is not stable"). Use
the patterns below instead.

## Setup

- Server: `npx tsc` then `node dist/server.js` (listens on `http://localhost:3000`).
- Open two tabs (one per player) and share them with the agent.
- Player identity is persisted in `sessionStorage`:
  - `cardgame.playerId`
  - `cardgame.roomId`

## Golden rules

1. **Never use `locator.click()` on cards/buttons** — it times out. Invoke the
   React handler directly, or call the DOM `.click()` inside `page.evaluate`.
2. **Scope card queries to the right container.** `document.querySelector('.card')`
   returns the *opponent's* first permanent. Hand cards live under the
   `Your Hand (N)` `<h3>`'s parent; battlefield permanents under the
   `Your Permanents` `<h4>`'s parent.
3. **After every action, wait ~800–1200 ms** for the socket round-trip + delta
   before reading state.
4. **Read state from `document.body.innerText`** — it contains `Phase: …`,
   `Mana: …`, `Life: N`, `Your Hand (N)`, `Stack (N)`, `You (your turn)`.

## Click a button by label

```js
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(x => x.textContent === 'Pass Priority');
  if (b) b.click();
});
await page.waitForTimeout(1000);
```

For prefix matches (e.g. `Declare Attackers (1)`):

```js
const b = Array.from(document.querySelectorAll('button'))
  .find(x => x.textContent.startsWith('Declare Attackers'));
```

## Click a card (invoke React handler)

```js
await page.evaluate(() => {
  const el = document.querySelector('.card');
  const k = Object.keys(el).find(k => k.startsWith('__reactProps'));
  el[k].onClick({ preventDefault() {}, stopPropagation() {} });
});
await page.waitForTimeout(1200);
```

## Click a card in a specific zone

```js
// Hand card
await page.evaluate(() => {
  const handHeading = Array.from(document.querySelectorAll('h3'))
    .find(h => h.textContent.includes('Your Hand'));
  const container = handHeading.parentElement;
  const card = Array.from(container.querySelectorAll('.card'))
    .find(c => c.textContent.includes('血炎山')); // match by name
  const k = Object.keys(card).find(k => k.startsWith('__reactProps'));
  card[k].onClick({ preventDefault() {}, stopPropagation() {} });
});

// Battlefield permanent
await page.evaluate(() => {
  const permHeading = Array.from(document.querySelectorAll('h4'))
    .find(h => h.textContent.includes('Your Permanents'));
  const container = permHeading.parentElement;
  const card = container.querySelector('.card');
  const k = Object.keys(card).find(k => k.startsWith('__reactProps'));
  card[k].onClick({ preventDefault() {}, stopPropagation() {} });
});
```

## Right-click a permanent for its context menu (e.g. Tap for Mana)

```js
await page.evaluate(() => {
  const permHeading = Array.from(document.querySelectorAll('h4'))
    .find(h => h.textContent.includes('Your Permanents'));
  const land = permHeading.parentElement.querySelector('.card');
  land.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(800);
// Then click the menu item
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(x => x.textContent === 'Tap for Mana');
  if (b) b.click();
});
```

## Targeting flow (spell that needs a target)

Clicking a hand card with `needsTargets()` enters targeting mode instead of
casting. The UI shows `Choose target — <name>` with `Cancel` / `Confirm`.

```js
// 1. Click the spell in hand → enters targeting mode
// 2. Click the opponent player (the "Opponent" heading's parent)
await page.evaluate(() => {
  const oppHeading = Array.from(document.querySelectorAll('h3'))
    .find(h => h.textContent === 'Opponent');
  oppHeading.parentElement.click();
});
await page.waitForTimeout(800);
// 3. Confirm
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find(x => x.textContent === 'Confirm');
  if (b) b.click();
});
```

## Read game state

```js
return await page.evaluate(() => ({
  phase: document.body.innerText.match(/Phase: [^\n]*/)?.[0],
  turn: document.body.innerText.match(/You[^\n]*turn[^\n]*/)?.[0] || 'not your turn',
  mana: document.body.innerText.match(/Mana: [^\n]*/)?.[0],
  life: document.body.innerText.match(/Life: \d+/g),
  hand: document.body.innerText.match(/Your Hand \((\d+)\)/)?.[1],
  stack: document.body.innerText.match(/Stack \(\d+\)/)?.[0] || 'none',
  btns: Array.from(document.querySelectorAll('button')).map(b => b.textContent),
  tapped: Array.from(document.querySelectorAll('.card.tapped')).map(c => c.textContent),
}));
```

## Useful selectors / signals

| Signal | Meaning |
| --- | --- |
| `Phase: <label>` | current phase (e.g. `Main Phase`, `Declare Attackers`) |
| `You (your turn)` vs `You` | whose turn it is |
| `Mana: red:1` / `Mana: none` | floating mana |
| `Your Hand (N)` | hand size |
| `Stack (N)` | stack depth |
| `.card.tapped` | tapped permanents |
| `Declare Attackers (N)` | count of legal attackers (sickness-aware) |
| `Confirm Blockers (N)` / `No Blocks` | blocker UI active (defending player, `declareBlockersStep`) |
| `Choose target — <name> (N selected)` | targeting mode active |

## Passing priority through a phase

Priority alternates between players. To advance a phase with no actions, pass in
whichever tab currently shows the `Pass Priority` button, then switch tabs and
pass again. Repeat until the phase label changes.

## Capturing server logs

The server logs to its terminal. After an action, read the terminal output to
confirm the event reached the server (e.g. `phase:advance`, `rps:played`). If no
log appears, the emit never reached the server — check the client error banner
(`document.body.innerText` will contain the server error message).

## Known client UX gaps (not engine bugs)

1. Blocker selection is hardcoded empty (`{ assignments: [] }`).
2. Attacker selection is all-or-nothing (sends every legal attacker).
3. Lands clicked in hand route to `castSpell` and go on the stack as `spell`.
4. Summoning sickness is not rendered visually (only via the attacker count).
