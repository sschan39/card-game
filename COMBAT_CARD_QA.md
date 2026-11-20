# Combat and card behavior QA

## Overlapping battlefield stacks

The demo fit the battlefield, hand and phase controls in one view at 1,224 × 603 and 615 × 720, with eight lands and two creatures on each side, two attached Staffs, and an activation pending. Each set of eight matching lands initially took one slot. Clicking the count opened all eight individual cards and collapsed them again. Using Mana directly from the collapsed group tapped one land and left seven ready lands grouped together. An expanded pile can take additional rows.

## Mixed battlefield and Equipment retest

Tested in the Codex browser with eight lands and two creatures per player, plus five artifacts across both seats. The lands fit on one row per player at 1,224 px and two rows per player at 615 px, with no horizontal overflow. The last land in the narrow layout tapped successfully.

Resolved two Ice Dragon Staff Equip abilities through normal play. Both Staffs appeared once, under their host, and Aurora Ice Dragon showed 2/4. The unattached Staff and Dragon Tomb remained in their artifact rows. The tucked Staff still opened its ability picker. Equip showed its cost, and the bounce option explained why it was unavailable.

Open issue. The target prompt still exposes an internal group ID, such as `effect-0`, during Equip. Expected a player-facing prompt such as “Choose an Ice Dragon to equip.”

## Artifact and Equipment follow-up in the Codex browser

- Cast two Ice Dragon Staffs through the normal hand and stack controls. Each used one cold energy and appeared in the Artifacts row after resolving.
- Equipped both Staffs to Aurora Ice Dragon. The target arrow appeared on the stack, each attachment added +1 power, and the dragon changed from 0/4 to 1/4 to 2/4. Both Staffs remained visible as full cards in the Artifacts row and as identically named attachment buttons on the dragon.
- The bounce ability was disabled before the host had enough counters. After seeding two ice-crystal counters on the host through the editor, activating the ability consumed both counters and resolved through the stack. Frost Messenger left the opposing battlefield and appeared in that seat's hand. The attack-triggered production of those counters was outside this run.
- At 615 px, three full-size artifact slots and both attachment buttons fit inside the table without horizontal overflow. The attachment buttons remained keyboard-reachable. Focusing a card showed a large preview that covered most of the field at this width.
- The action menu showed internal IDs such as “Activate: attach” and “Activate: ice-crystal-bounce,” and the target prompt exposed `effect-0`. Dragon Tomb rendered in the Artifacts row after setup placement. Its cast and effects were outside this run.

November 20, 2026 · Windows · Microsoft Edge and Google Chrome · `localhost:3000`

Black-box test with Edge hosting and Chrome joining. Both players used matching 60-card cold-energy decks with cheap creatures, spells, and artifacts. The first room (`1e595adb-5de1-4b0a-a114-be77068701e8`) became unavailable after Windows locked. The fresh room (`0e190953-19b7-41f6-bba2-55742850d37d`) reused the saved decks and test accounts, with auto-pass enabled on both clients.

## Combat results in the fresh room

| Scenario | Observed result |
| --- | --- |
| No attackers | On Turn 2, Chrome’s newly cast creatures were ineligible to attack. **No attacks** advanced combat. |
| Blocked attack | On Turn 3, Edge attacked with Frost Messenger (1/2). Chrome assigned Frozen Snowball (2/2) as its blocker and confirmed. Edge assigned 1 damage to Snowball. Chrome assigned 2 damage to Messenger. Both players stayed at 20 life. Snowball survived with 1 marked damage, Messenger entered Edge’s graveyard, and its destruction ability drew exactly one card. The marked damage cleared by Turn 4. |
| Unblocked attack | On Turn 4, Chrome attacked with Frozen Snowball. Edge explicitly selected **No blocks** while two blockers were available. Chrome assigned 2 damage to the opponent. Both browsers showed Edge at 18 life, and the match advanced to Postcombat Main. |
| Auto-pass with choices | Auto-pass was enabled on both clients throughout the fresh run. Frost Messenger’s entry choice and the required combat declarations and damage assignments remained available for player input. |

## Card behavior verified

| Test | Observed result |
| --- | --- |
| Ancient Weapon Battlefield (`ancient-weapon-battlefield`) | Entered legally, tapped to produce one cold energy, and could produce one again after untapping on its controller’s next turn. |
| Frozen Snowball (`frozen-snowball`) | Chrome cast it for zero mana. It resolved as a 2/2, could block on the opposing turn, and could attack on Chrome’s next turn. |
| Ice Dragon Staff (`ice-dragon-staff`) | Chrome spent one cold energy to cast it. It resolved as an artifact, leaving no mana available. Equip, attack counters, and its return-to-hand ability remain untested. |
| Frost Messenger (`frost-messenger`) | Edge spent one cold energy to cast it. Its entry ability revealed three cards after opting in. The fresh room offered Aurora Ice Dragon and Frost Messenger for the top slot and excluded Ancient Weapon Battlefield. Edge chose the dragon, ordered the two remaining cards, and confirmed. Edge’s next regular draw was the dragon. Combat destruction drew exactly one card, with hand size 3 → 4 and library size 53 → 52. The bottom order was submitted and remains unverified by drawing through the deck. |
| Frost Soul | Chrome spent one cold energy to cast it with no Aurora-marked Ice Dragon under its control. Frost Soul resolved, the hand count fell by one, and the library count stayed unchanged, as expected for that condition. |
| Aurora Ice Dragon | Edge spent two cold energy to cast it. It entered as a 0/4 with one Aurora counter. On Edge’s next turn, **Tap for mana** tapped the dragon and added exactly one cold energy. The Aurora counter stayed in place. |

## Reproduced UI findings

- **Frost Messenger’s Confirm button is clipped.** Reproduced in Edge in both runs, at approximately 1031 × 733 in the fresh run. Cast Frost Messenger, opt in, choose a top card, then select both remaining cards for the bottom. The enabled **Confirm** appears below the visible panel. Scrolling down inside the right-hand panel exposes it and lets play resume. Keep the choice actions visible while the card list scrolls.
- **Forced damage still requires manual input on both sides.** The blocked attack required Edge to enter `1` and Chrome to enter `2` in separate damage prompts. The unblocked attack required Chrome to enter `2` against the sole target, **Opponent**. Assign damage automatically when it has one legal recipient and no legal split or ordering choice.
- **Pending blocker assignment sends mixed signals.** After selecting Snowball and its attacker, the main combat row still said **Unblocked** while a separate row showed the proposed block. The rows agreed after **Confirm Blockers (1)**. Show the proposed block or label it pending in the main row.
- **Additional land actions are easy to miss.** With two lands, the land column initially showed only the first, tapped land. Scrolling within the column exposed the second land’s **Tap for mana** control. A visible overflow cue would make it easier to discover why auto-pass is waiting on an available mana ability.
- **Frost Messenger’s entry trigger has a misleading stack label.** The stack displayed `onEnter: { draw 0 → You }` for an effect that reveals cards and lets the player reorder them. Use a player-facing label that describes the choice.

## Remaining card coverage

Aurora Ice Dragon’s damage prevention, Frost Soul’s conditional draw with an Aurora-marked Ice Dragon, Ice Dragon Staff’s equip and triggered abilities, and verification of Frost Messenger’s bottom-deck order remain open. Other cards and combat involving multiple blockers or damage that can be split were outside the scenarios exercised here.
