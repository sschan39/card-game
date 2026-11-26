# Battlefield overlay bug report

Reported November 20, 2026 in the Codex browser. Both findings were fixed and verified in a fresh Scenario Lab room.

## BOARD-08 — Duplicate artwork shows through a stacked card

**Priority** Medium. The card name, illustration and stats are harder to distinguish during play.

**Reproduce** Put two Frost Messengers in the same state on one side of the battlefield so they stack. Use newly placed copies to reproduce the marked example. Tapping multiple matching lands shows the same problem.

**Observed** The front card used reduced opacity for its tapped or summoning-sick state. Printed faces behind it showed through. The stack count and the new-card indicator also competed for the upper corner.

**Expected** The pile shows one readable face, visible card edges and a count. Tapped cards still tilt, and newly placed creatures still show their status.

**Fix and retest** The layers behind the front card now render as plain edges. Tapped and newly placed cards keep an opaque face, and the new-card indicator has its own corner. At 1280 × 631 and 615 × 720, the Frost Messenger pile displayed one opaque face and a ×2 count. The tapped-land pile stayed tilted. Opening the Frost Messenger picker showed both copies and left the battlefield height unchanged.

## BOARD-09 — Phase controls cover permanents in a crowded row

**Priority** Medium. A player can lose access to a card or its stack control.

**Reproduce** At desktop width, add enough different creatures and stacks for a row to reach the right-hand log and phase controls.

**Observed** The battlefield spanned the same grid column as the rail. The log and phase controls covered the rightmost cards.

**Expected** The battlefield and controls have separate space. Additional cards wrap within the battlefield.

**Fix and retest** The desktop battlefield ends before the rail. At narrow widths, the rail sits below the field. None of the 16 visible card faces intersected the rail at either retest size.
