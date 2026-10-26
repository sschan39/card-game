import type { PlayerView, CardView } from '@card-game/protocol';
export function battlefieldCardLabel(_room: PlayerView, card: CardView): string { return card.label; }
