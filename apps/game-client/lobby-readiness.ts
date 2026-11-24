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
  if (!state.signedIn) return 'Sign in to play.';
  if (state.loading) return 'Loading your saved decks…';
  if (state.failed) return 'Couldn’t load your decks. Retry to continue.';
  if (state.handoffPending) return 'Resolve the requested deck link before continuing.';
  if (!state.hasDecks) return 'No saved decks yet.';
  if (!state.selectedDeck) return 'Select one of your saved decks to continue.';
  if (!state.connected) return 'Connecting to the game server…';
  if (state.pending) return 'Setting up your room…';
  return null;
}
