export interface SetupConfig {
  startingLife: number;
  openingHandSize: number;
  firstPlayerDrawsOnFirstTurn: boolean;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
  landPlaysPerTurn?: number;
  /** Opt-in starter rule; the confirmed creature threshold is attack + maximum health. */
  scorch?: boolean;
}
