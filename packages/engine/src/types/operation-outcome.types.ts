import type { GameRoom } from './game.room.types';
import type { EventDraft } from './game-event.types';

/** Pure reduction result. Semantic success does not require a state difference. */
export type OperationOutcome =
  | { status: 'rejected'; state: GameRoom; reason: string }
  | { status: 'unchanged'; state: GameRoom }
  | { status: 'committed'; state: GameRoom;
      /** Omitted: derive existing semantics. Present (even []): operation owns them. */
      events?: EventDraft[] };
