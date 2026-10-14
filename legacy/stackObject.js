const crypto = require('crypto');

class stackObject {
  /**
   * @param {Object} config
   * @param {string} config.type - 'spell' | 'activated' | 'triggered'
   * @param {string} config.controllerId - Socket ID of the player controlling this item
   * @param {Object} config.sourceCard - The live instance of the card causing this effect
   * @param {Object} config.effectPayload - The rules/logic metadata to execute on resolution
   * @param {Array|Object} [config.targets] - Singular target or array of targets
   */
  constructor({ type, controllerId, sourceCard, effectPayload, targets = [] }) {
    if (!sourceCard || !sourceCard.uuid) {
      throw new Error(`[stackObject] Cannot construct: Valid source card instance with a UUID is required.`);
    }

    // 1. Core Stack Identifiers
    this.uuid = crypto.randomUUID();
    this.type = type;
    this.controllerId = controllerId;
    this.timestamp = Date.now();

    // 2. MTG Last Known Information (LKI) Snapshot
    // We snapshot critical immutable identifiers right now in case the card leaves the board.
    this.source = {
      uuid: sourceCard.uuid,
      id: sourceCard.id,
      name: sourceCard.name,
      cardTypes: [...(sourceCard.cardTypes || [])],
      subTypes: [...(sourceCard.subTypes || [])]
    };

    // 3. Resolution Engine Payload
    this.payload = {
      effectId: effectPayload.effectId || null,
      params: effectPayload.params ? { ...effectPayload.params } : {},
      duration: effectPayload.duration || null,
      onPlayExec: typeof effectPayload.onPlay === 'function' ? effectPayload.onPlay : null
    };

    // 4. Locked Targets Normalization
    this.targets = Array.isArray(targets) ? targets : [targets].filter(Boolean);
  }

  // ==========================================
  // STATIC FACTORIES (Class-level constructors)
  // ==========================================

  /** Creates a spell stack item (casting a card from hand) */
  static createSpell(controllerId, cardInstance, targets) {
    return new stackObject({
      type: 'spell',
      controllerId,
      sourceCard: cardInstance,
      effectPayload: {
        effectId: 'CAST_SPELL',
        onPlay: cardInstance.onPlay
      },
      targets
    });
  }

  /** Creates an activated ability stack item (clicking an existing permanent's ability) */
  static createActivated(controllerId, sourceCard, abilityObj, targets) {
    return new stackObject({
      type: 'activated',
      controllerId,
      sourceCard,
      effectPayload: {
        effectId: abilityObj.effectId,
        params: abilityObj.params,
        duration: abilityObj.duration
      },
      targets
    });
  }

  /** Creates a triggered ability stack item (game states auto-triggering an effect) */
  static createTriggered(controllerId, sourceCard, abilityObj, targets) {
    return new stackObject({
      type: 'triggered',
      controllerId,
      sourceCard,
      effectPayload: {
        effectId: abilityObj.effectId,
        params: abilityObj.params,
        duration: abilityObj.duration
      },
      targets
    });
  }
}

module.exports = stackObject;