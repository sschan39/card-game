// library.js
const rawCardData = require('./data/card_data.json');
const { parseAll, normalizeCard } = require('./cardParser');
const { v4: uuidv4 } = require('uuid');

const blueprintCache = {};

function getBlueprint(cardId) {
    const raw = rawCardData[cardId];
    if (!raw) return undefined;
    if (!blueprintCache[cardId]) {
        blueprintCache[cardId] = normalizeCard(raw);
    }
    return blueprintCache[cardId];
}

function instantiateCard(cardId) {
    const blueprint = getBlueprint(cardId);
    if (!blueprint) return undefined;

    // Create a deep clone for the live game room
    return {
        ...blueprint,
        uuid: uuidv4(),
        manaCost: { ...blueprint.manaCost },
        abilities: blueprint.abilities.map(a => ({ ...a, cost: { ...a.cost } })),
        state: {
            zone: 'library',
            isTapped: false,
            isSick: blueprint.type === 'minion',
            damageTaken: 0,
            counters: {}
        }
    };
}

const cards = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== 'string') return Reflect.get(target, prop);
        if (prop === 'rawCardData') return rawCardData;
        if (prop === 'instantiateCard') return instantiateCard;
        
        return instantiateCard(prop);
    }
});

module.exports = { cards, rawCards: rawCardData, instantiateCard };