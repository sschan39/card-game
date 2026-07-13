"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeActionCost = normalizeActionCost;
exports.normalizeAbility = normalizeAbility;
exports.normalizeCard = normalizeCard;
exports.parseAll = parseAll;
function normalizeActionCost(cost) {
    if (!cost)
        return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };
    return {
        mana: cost.mana || {},
        tap: !!cost.tap,
        life: typeof cost.life === 'number' ? cost.life : 0,
        discard: typeof cost.discard === 'number' ? cost.discard : 0,
        sacrifice: !!cost.sacrifice,
    };
}
function normalizeAbility(ability) {
    if (!ability || typeof ability !== 'object')
        return null;
    const type = ability.type || 'activated';
    const effect = {
        effectId: typeof ability.effectId === 'string' ? ability.effectId.toUpperCase() : '',
        params: ability.params || {},
    };
    const base = {
        effect,
        castSpeed: ability.castSpeed || 'instant',
    };
    if (type === 'triggered') {
        return {
            type: 'triggered',
            triggerCondition: ability.triggerCondition || 'ON_ENTER_BATTLEFIELD',
            ...base,
        };
    }
    return {
        type: 'activated',
        cost: normalizeActionCost(ability.cost),
        duration: ability.duration || null,
        ...base,
    };
}
function normalizeCard(raw) {
    if (!raw.id) {
        throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
    }
    return {
        id: raw.id,
        name: raw.name || '',
        cardTypes: raw.cardTypes || [],
        subTypes: raw.subTypes || [],
        rulesText: raw.rulesText || '',
        power: raw.power,
        toughness: raw.toughness,
        // Fix: read both onPlay and onPlayEffect for backward compatibility
        onPlayEffect: (raw.onPlayEffect || raw.onPlay),
        castRequirements: {
            allowedZones: raw.castRequirements?.allowedZones || ['hand'],
            speed: raw.castRequirements?.speed || 'sorcery',
            cost: normalizeActionCost(raw.castRequirements?.cost),
            condition: raw.castRequirements?.condition || undefined,
        },
        abilities: (raw.abilities || [])
            .map(normalizeAbility)
            .filter((a) => a !== null),
    };
}
function parseAll(rawMap) {
    const out = {};
    Object.keys(rawMap).forEach(k => {
        out[k] = normalizeCard(rawMap[k]);
    });
    return out;
}
exports.default = {
    normalizeActionCost,
    normalizeAbility,
    normalizeCard,
    parseAll,
};
//# sourceMappingURL=card-parser.js.map