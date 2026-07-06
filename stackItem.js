class StackItem {
  constructor({ sourceCard, effectId, params, controllerId }) {
    this.id = crypto.randomUUID(); // Unique ID for this specific stack instance
    this.sourceCardId = sourceCard.instanceId; // Reference back to the physical card
    this.sourceCardName = sourceCard.name; // Kept for UI/logging convenience
    this.controllerId = controllerId; // The player who activated it
    
    this.effectId = effectId; // e.g., "DEAL_DAMAGE" or "ADD_MANA"
    
    // Snapshot of targets and choices chosen during activation
    this.params = { ...params }; 
  }

  // The stack item knows how to resolve itself using our Effect Registry
  resolve(gameState) {
    const effectFunction = AbilityEffects[this.effectId];
    const sourceCard = gameState.findCardById(this.sourceCardId);

    if (effectFunction) {
      // Pass the snapshot params (like locked-in targets) to the logic
      effectFunction(gameState, sourceCard, this.params);
    }
  }
}