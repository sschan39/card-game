export interface LobbyReadiness {
  signedIn: boolean;
  loading: boolean;
  failed: boolean;
  hasDecks: boolean;
  selectedDeck: boolean;
  handoffPending: boolean;
  connected: boolean;
  pending: boolean;
}
/** One readiness policy for both Create and the keyboard/click Join paths. */
export function lobbyBlockReason(state: LobbyReadiness): string | null {
  if (!state.signedIn) return 'Sign in or create an account before creating or joining a room.';
  if (state.loading) return 'Loading your saved decks…';
  if (state.failed) return 'Unable to load your decks. Retry before creating or joining a room.';
  if (state.handoffPending) return 'Resolve the requested deck link before continuing.';
  if (!state.hasDecks) return 'Build and save your first deck, then return here to play.';
  if (!state.selectedDeck) return 'Select one of your saved decks to continue.';
  if (!state.connected) return 'Connecting to the game server. Room setup is unavailable until connected.';
  if (state.pending) return 'Setting up your room…';
  return null;
}
