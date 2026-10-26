import type { PlayerView, StackView } from '@card-game/protocol';
export function describeStackObject(_room: PlayerView, object: StackView, _viewerId?: string | null): string { return object.description; }
