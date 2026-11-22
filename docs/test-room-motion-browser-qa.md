# Test Room motion and browser QA

**22 November 2026 · Codex in-app browser on Windows · 1280 × 720 · localhost Scenario Lab**

One disposable Test Room used the shared match screen, with both seats controlled from one tab. Tests used the board editor for setup and normal player actions for play, draws, targeting, and passing priority. Reveal both hands stayed off.

## Motion retest

| Flow | Browser evidence | Result |
| --- | --- | --- |
| Play a land | Clicked Blood Flame Mountain from hand. It entered the land zone, the land play counter became 1/1, and its Mana action appeared. | Passed play and destination state. |
| Resolve a creature | Cast Frozen Snowball and passed priority from both seats. Observed a card-face flight while the stack cleared and the creature entered the battlefield. | Passed visible movement and final state. |
| Draw two cards | Resolved Rise of Power while remaining on the caster’s seat. Observed two Blood Flame Mountain flight faces and the hand count rose from three to five. | Passed. |
| Observe an opponent draw | Watched the other seat resolve Rise of Power. Observed two anonymous flight elements with empty text. The opponent’s hand count rose from two to four. | Passed. |
| Inspect a stack | Opened a three-copy Frozen Snowball stack and verified the picker identified copies #1, #2, and #3. Escape closed it and returned focus to the stack badge. | Passed outside targeting. |
| Resolve a targeted spell | Chose Fireball’s main-phase mode, selected the second repeated target option, and passed from both seats. Frozen Snowball #2 showed Scorch 2 and the stack cleared. | Effect passed. Target selection has a UI defect below. |
| Declare no attackers | With no eligible attackers, clicked **No attacks**. The board displayed **No attackers declared** and offered **Pass priority**. | Passed declaration. |

## Confirmed bugs

### MOTION UI 01 — Cards are clipped at the bottom of the hand

**Priority:** P2. **Reproduce:** At 1280 × 720, open a live Test Room with three or more cards in hand. Move the pointer away from the hand. Cast a card and leave the stack open.

**Observed:** The hand fanned downward off the viewport. In a three-card hand, the card bottoms measured approximately 770–773 px in a 720 px viewport. The document was exactly 720 px tall, so scrolling could not expose the clipped portion. A draw can land in the same clipped area.

**Expected:** The hand stays readable and reachable, and arrivals land in the visible hand. At shorter heights, the hand can compress or shift up while preserving the phase controls.

### MOTION UI 02 — Switching seats clears the visible room log

**Priority:** P2. **Reproduce:** In a fresh Test Room, play a land, cast a creature, then switch seats to pass priority. Switch back and open the log.

**Observed:** The casting seat showed **Log 2** before switching. The other seat showed **Log 0** on arrival. After resolving a draw and returning to the caster, the log again showed **Log 0** and **No events yet**, while the board retained the land, creature and drawn cards.

**Expected:** Each seat retains or restores its own permitted log history while the Test Room operator switches seats.

### MOTION UI 03 — Target choice hides which identical card will be selected

**Priority:** P2. **Reproduce:** Give the opponent three identical Frozen Snowballs and cast Fireball’s main-phase Scorch mode.

**Observed:** The target dialog showed three buttons all labeled **凍土雪球**, with no copy number, tooltip, or distinct accessible label. The battlefield stack picker did not open while the target prompt owned input. Selecting the second identically labeled button targeted copy **#2**, as shown on the stack afterward.

**Expected:** Every option identifies its battlefield copy before confirmation. The choice list can use the same copy labels as the stack picker and highlight the corresponding card.

### MOTION UI 04 — Player prompts display internal effect labels

**Priority:** P3. **Reproduce:** Cast Frozen Snowball and inspect the stack. Then cast Fireball and choose its Scorch mode.

**Observed:** The creature stack entry read **凍土雪球 · onPlay: { no effects }** and Fireball opened **Choose targets: effect-0**.

**Expected:** Use player-facing text, such as **Frozen Snowball** on the stack and **Choose a creature or relic for Scorch** when that is the legal target set.

## Scope

The browser run used one local Test Room at desktop size. It covers the interactions above. Reduced-motion and resync cleanup are exercised by client tests. Ordinary live matches, a completed block-and-damage sequence, and the full per-card browser matrix require separate passes.
