export interface SetupConfig {
  startingLife: number;
  openingHandSize: number;
  firstPlayerDrawsOnFirstTurn: boolean;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
  /** Server-resolved copies selected before play; no account/database references enter the engine. */
  playerDecks?: Record<string, string[]>;
  landPlaysPerTurn?: number;
  /** Opt-in starter rule; the confirmed creature threshold is attack + maximum health. */
  scorch?: boolean;
}
